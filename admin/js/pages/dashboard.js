import { db, collection, query, orderBy, limit, onSnapshot } from "../fb.js";
import { $, esc, money, startOfToday } from "../ui.js";

export const isUnpaidOnline = (o) => o.paymentStatus === "pending" || o.paymentStatus === "failed";

export function render(view, { sections }) {
  view.innerHTML = `
    <div class="ph"><h1>Dashboard</h1></div>
    <div class="metrics" id="metrics">
      <div class="metric"><small>Naye orders</small><b id="m-new">-</b></div>
      <div class="metric"><small>Aaj ke orders</small><b id="m-today">-</b></div>
      <div class="metric"><small>Aaj ki sale</small><b id="m-sale">-</b></div>
      <div class="metric"><small>Stock kam (5 ya kam)</small><b id="m-low">-</b></div>
    </div>
    <div class="tiles">
      ${sections
        .map(
          (s) => `<a class="tile ${s[4] ? "" : "soon"}" href="#/${s[0]}"><i class="ti ${s[2]}"></i><div><b>${esc(s[1])}</b><span>${esc(s[3])}</span></div>${
            s[4] ? "" : '<em class="soon-tag" style="font-style:normal">jald</em>'
          }</a>`
        )
        .join("")}
    </div>`;

  const set = (id, v) => {
    const el = $("#" + id, view);
    if (el) el.textContent = v;
  };

  const unsubOrders = onSnapshot(
    query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(500)),
    (snap) => {
      const day = startOfToday();
      let fresh = 0, today = 0, sale = 0;
      snap.forEach((d) => {
        const o = d.data();
        if (isUnpaidOnline(o)) return;
        if (o.status === "placed") fresh++;
        if ((o.createdAt || 0) >= day) {
          today++;
          if (o.status !== "cancelled") sale += Number(o.totalAmount) || 0;
        }
      });
      set("m-new", fresh);
      set("m-today", today);
      set("m-sale", money(sale));
    },
    () => {
      set("m-new", "?");
      set("m-today", "?");
      set("m-sale", "?");
    }
  );

  const unsubProducts = onSnapshot(
    collection(db, "products"),
    (snap) => {
      let low = 0;
      snap.forEach((d) => {
        const p = d.data();
        if (p.active === false) return;
        const stock = p.variants && p.variants.length ? p.variants.reduce((a, v) => a + (v.stock || 0), 0) : p.stock || 0;
        if (stock <= 5) low++;
      });
      set("m-low", low);
    },
    () => set("m-low", "?")
  );

  return () => {
    unsubOrders();
    unsubProducts();
  };
}
