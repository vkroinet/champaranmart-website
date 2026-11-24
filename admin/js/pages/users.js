import { db, functions, collection, onSnapshot, query, where, getDocs, doc, updateDoc, httpsCallable } from "../fb.js";
import { $, esc, money, fmtDate, modal, confirmBox, toast, errMsg } from "../ui.js";
import { isUnpaidOnline } from "./dashboard.js";

// The same list as "Users" in the app (Admin > Users): every customer account with its contact details, an admin-only
// "Free delivery" switch, the customer's order history, and delete. A customer who joined today gets a NEW badge.
const STATUS = { placed: "Placed", packed: "Packed", out_for_delivery: "Out for delivery", delivered: "Delivered", cancelled: "Cancelled" };
const NOT_PROVIDED = "Not provided";
// Phones write order and profile fields, so every number is forced to a plain number before it goes into HTML.
const orderNo = (o) => {
  const n = Math.trunc(Number(o.orderNumber));
  return String(Number.isFinite(n) ? n : 0).padStart(5, "0");
};
const DAY = 86400000;
const dayStart = () => new Date().setHours(0, 0, 0, 0);
// "This week" = the last 7 days, today included.
const weekStart = () => dayStart() - 6 * DAY;
const FILTERS = [
  ["all", "All"],
  ["new", "New today"],
  ["week", "This week"],
  ["none", "Never ordered"],
  ["ordered", "Ordered"]
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "24 Nov 2026, 10:42 AM" (English month and AM/PM, in the admin's own time zone). */
const fmtLogin = (ms) => {
  const d = new Date(ms);
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return day + ", " + time;
};
const isRealOrder = (o) => o.status !== "cancelled"; // a cancelled order does not count as an order

/** The address as one line: the saved address is an object (line1, city) in the app; older data may be plain text. */
function addressLine(u) {
  const a = u.address;
  if (!a) return "";
  if (typeof a === "string") return a.trim();
  return [a.line1, a.city].map((x) => String(x || "").trim()).filter(Boolean).join(", ");
}

/** Cloud Function errors arrive as "functions/<code>" with the server's own sentence as the message. */
function fnErr(e) {
  const code = (e && e.code) || "";
  if (code.includes("not-found") && /function/i.test(e.message || "")) return "This feature is not available on the server yet.";
  if (code.includes("internal") && (e.message || "").toLowerCase() === "internal") return "Server problem. Please try again.";
  return errMsg(e);
}

export function render(view) {
  let users = [];
  let orders = [];
  let gotUsers = false;
  let gotOrders = false;
  let q = "";
  let filter = "all";

  view.innerHTML = `
    <style>
      @keyframes usrRing{0%{transform:scale(1);opacity:.9}70%,100%{transform:scale(2.6);opacity:0}}
      @keyframes usrPop{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
      .unew{position:absolute;top:-7px;right:-6px;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;padding:2px 9px 2px 6px;border-radius:999px;background:#E63946;color:#fff;font-size:10.5px;font-weight:700;letter-spacing:.5px;line-height:1.4;animation:usrPop 1.6s ease-in-out infinite}
      .unew i{position:relative;width:6px;height:6px;border-radius:50%;background:#fff;display:inline-block}
      .unew i:after{content:"";position:absolute;inset:0;border-radius:50%;background:#fff;animation:usrRing 1.4s ease-out infinite}
      .ucount{display:inline-block;margin-left:10px;padding:3px 11px;border-radius:999px;background:#E63946;color:#fff;font-size:12px;font-weight:700;vertical-align:middle;white-space:nowrap}
      .utotal{display:inline-block;margin-left:10px;padding:3px 11px;border-radius:999px;background:var(--surface);color:var(--ink);border:1px solid var(--border);font-size:12px;font-weight:700;vertical-align:middle;white-space:nowrap}
      .uchips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
      .uchip{border:1px solid var(--border);background:var(--card);color:var(--ink);font:inherit;font-size:13px;padding:6px 14px;border-radius:999px;cursor:pointer}
      .uchip:hover{border-color:var(--brand)}
      .uchip.on{background:#D6304A;border-color:#D6304A;color:#fff}
      .uchip span{opacity:.75;margin-left:4px}
      .utag{display:inline-block;font-size:12px;padding:3px 10px;border-radius:999px}
      .utag.l{background:#E8EEFB;color:#2F4A8F}
      .utag.z{background:#FFF3D6;color:#8A5A00}
      .utag.o{background:#E6F4EA;color:#1F7A3D}
      .ucard{position:relative;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:14px;margin-bottom:10px}
      .utop{display:flex;gap:12px;align-items:center}
      .uav{width:40px;height:40px;border-radius:50%;background:var(--surface);display:grid;place-items:center;flex:none;font-weight:700;color:var(--brand)}
      .uline{font-size:13px;color:var(--muted);margin-top:4px;word-break:break-word}
      .uact{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px}
      @media (prefers-reduced-motion:reduce){.unew,.unew i:after{animation:none}}
    </style>
    <div class="ph"><h1>Users<span id="totalcount"></span><span id="newcount"></span></h1></div>
    <div style="margin-bottom:14px"><input class="in" id="q" placeholder="Search by name, mobile or email" style="max-width:360px" aria-label="Search users"></div>
    <div class="uchips" id="chips"></div>
    <div id="list"><div class="loading">Loading users…</div></div>`;

  // How many orders each customer has placed (cancelled ones do not count).
  function orderCounts() {
    const m = new Map();
    for (const o of orders) if (isRealOrder(o)) m.set(o.customerId, (m.get(o.customerId) || 0) + 1);
    return m;
  }

  const inFilter = (u, key, n, today, week) =>
    key === "all" ||
    (key === "new" && Number(u.createdAt) >= today) ||
    (key === "week" && Number(u.createdAt) >= week) ||
    (key === "none" && n === 0) ||
    (key === "ordered" && n > 0);

  function draw() {
    if (!gotUsers || !gotOrders) return;
    const today = dayStart();
    const week = weekStart();
    const counts = orderCounts();
    const count = (u) => counts.get(u.id) || 0;

    const newToday = users.filter((u) => Number(u.createdAt) >= today).length;
    $("#totalcount", view).innerHTML = users.length ? `<span class="utotal">${users.length} total</span>` : "";
    $("#newcount", view).innerHTML = newToday ? `<span class="ucount">${newToday} new today</span>` : "";
    // The chips with how many customers each holds (the search does not change these numbers).
    $("#chips", view).innerHTML = FILTERS.map(
      ([key, label]) =>
        `<button class="uchip ${filter === key ? "on" : ""}" type="button" data-filter="${key}">${label}<span>${users.filter((u) => inFilter(u, key, count(u), today, week)).length}</span></button>`
    ).join("");

    const ql = q.trim().toLowerCase();
    const shown = users.filter(
      (u) =>
        inFilter(u, filter, count(u), today, week) &&
        (!ql ||
          String(u.name || "").toLowerCase().includes(ql) ||
          String(u.phone || "").toLowerCase().includes(ql) ||
          String(u.email || "").toLowerCase().includes(ql))
    );
    const list = $("#list", view);
    if (!shown.length) {
      list.innerHTML = `<div class="empty"><i class="ti ti-users"></i>No users found.</div>`;
      return;
    }
    list.innerHTML = shown
      .map((u) => {
        const isNew = Number(u.createdAt) >= today;
        const name = u.name || NOT_PROVIDED;
        const addr = addressLine(u);
        return `<div class="ucard" data-uid="${esc(u.id)}">
          ${isNew ? '<span class="unew"><i></i>NEW</span>' : ""}
          <div class="utop">
            <div class="uav">${esc(name.trim().charAt(0).toUpperCase() || "?")}</div>
            <div style="min-width:0${isNew ? ";padding-right:56px" : ""}">
              <div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</div>
              <div class="hint" style="margin:0">${esc(u.phone || NOT_PROVIDED)}</div>
            </div>
          </div>
          <div class="uline">${esc(u.email || NOT_PROVIDED)}</div>
          <div class="uline">Address: ${esc(addr || NOT_PROVIDED)}</div>
          <div class="uact" style="margin-top:10px;gap:6px">
            <span class="utag l"><i class="ti ti-login" style="margin-right:3px"></i>First login: ${Number(u.createdAt) > 0 ? esc(fmtLogin(Number(u.createdAt))) : "-"}</span>
            ${count(u) === 0 ? '<span class="utag z">No order yet</span>' : `<span class="utag o">${count(u)} ${count(u) === 1 ? "order" : "orders"}</span>`}
          </div>
          <div class="uact">
            <label class="chk" style="margin:0 12px 0 0"><span class="sw"><input type="checkbox" data-free="${esc(u.id)}" ${u.freeDelivery === true ? "checked" : ""}><span></span></span>Free delivery</label>
            <button class="btn ghost sm" type="button" data-history="${esc(u.id)}"><i class="ti ti-history"></i> History</button>
            <button class="btn ghost sm" type="button" data-del="${esc(u.id)}" style="color:var(--err)"><i class="ti ti-trash"></i> Delete</button>
          </div>
        </div>`;
      })
      .join("");
  }

  const find = (id) => users.find((u) => u.id === id);

  async function showHistory(uid) {
    const u = find(uid) || {};
    const m = modal({ title: `${u.name || "Customer"}: orders`, wide: true });
    m.body.innerHTML = `<div class="loading">Loading orders…</div>`;
    m.footer.innerHTML = `<button class="btn ghost" type="button" id="uclose">Close</button>`;
    $("#uclose", m.footer).onclick = m.close;
    try {
      const snap = await getDocs(query(collection(db, "orders"), where("customerId", "==", uid)));
      const orders = snap.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      m.body.innerHTML = orders.length
        ? orders
            .map(
              (o) => `<a href="#/orders/${esc(o.id)}" data-order style="display:flex;gap:10px;align-items:center;padding:9px 0;border-top:1px solid var(--border);color:inherit;text-decoration:none">
              <div style="flex:1;min-width:0"><div style="font-weight:600">Order #${orderNo(o)}</div>
                <div class="hint" style="margin:0">${esc(fmtDate(o.createdAt))} · ${(o.items || []).length} ${(o.items || []).length === 1 ? "item" : "items"} · ${o.paymentMethod === "UPI" ? "UPI" : "COD"}</div></div>
              <span class="badge b-${esc(o.status)}">${esc(STATUS[o.status] || o.status)}</span>
              <b>${money(o.totalAmount)}</b></a>`
            )
            .join("")
        : '<p class="hint">This customer has not placed any order yet.</p>';
      // Opening an order closes this window first, so the order page is not hidden behind it.
      m.body.addEventListener("click", (e) => {
        if (e.target.closest("[data-order]")) m.close();
      });
    } catch (err) {
      m.body.innerHTML = `<div class="empty"><i class="ti ti-alert-triangle"></i>${esc(errMsg(err))}</div>`;
    }
  }

  async function deleteUser(uid, btn) {
    const u = find(uid) || {};
    const name = u.name || "this customer";
    const ok = await confirmBox(`Delete ${name}'s account? Their profile and login are removed for good and this cannot be undone. The server refuses while they still have an order to deliver.`, {
      okText: "Yes, delete",
      danger: true
    });
    if (!ok) return;
    btn.disabled = true;
    try {
      await httpsCallable(functions, "deleteCustomerAccountAsAdmin")({ uid });
      toast("The customer's account has been deleted");
    } catch (err) {
      btn.disabled = false;
      toast(fnErr(err), "err");
    }
  }

  view.addEventListener("input", (e) => {
    if (e.target.id === "q") {
      q = e.target.value;
      draw();
    }
  });

  // The Free delivery switch applies at once (like in the app) and goes back if it could not be saved.
  view.addEventListener("change", async (e) => {
    const id = e.target.dataset && e.target.dataset.free;
    if (!id) return;
    const box = e.target;
    const on = box.checked;
    try {
      await updateDoc(doc(db, "users", id), { freeDelivery: on });
      const u = find(id);
      if (u) u.freeDelivery = on;
      toast(`Free delivery ${on ? "ON" : "OFF"} for ${(u && u.name) || "this customer"}`);
    } catch (err) {
      box.checked = !on;
      toast(errMsg(err), "err");
    }
  });

  view.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-filter]");
    if (chip) {
      filter = chip.dataset.filter;
      return draw();
    }
    const h = e.target.closest("[data-history]");
    if (h) return showHistory(h.dataset.history);
    const d = e.target.closest("[data-del]");
    if (d) return deleteUser(d.dataset.del, d);
  });

  const unsub = onSnapshot(
    query(collection(db, "users"), where("role", "==", "customer")),
    (s) => {
      gotUsers = true;
      // Newest first. A user with no join time (an old account) goes to the end and is never marked NEW.
      users = s.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
      draw();
    },
    (err) => {
      $("#list", view).innerHTML = `<div class="empty"><i class="ti ti-alert-triangle"></i>${esc(errMsg(err))}</div>`;
    }
  );
  // The orders tell who has never ordered (unpaid online orders are not real orders, as everywhere in the admin).
  const unsubOrders = onSnapshot(
    collection(db, "orders"),
    (s) => {
      gotOrders = true;
      orders = s.docs.map((d) => ({ ...d.data(), id: d.id })).filter((o) => !isUnpaidOnline(o));
      draw();
    },
    (err) => {
      $("#list", view).innerHTML = `<div class="empty"><i class="ti ti-alert-triangle"></i>${esc(errMsg(err))}</div>`;
    }
  );
  return () => {
    unsub();
    unsubOrders();
  };
}
