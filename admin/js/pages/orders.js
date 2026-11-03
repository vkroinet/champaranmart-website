import {
  db, collection, query, orderBy, limit, onSnapshot, doc, updateDoc, runTransaction, increment, getDocs, where
} from "../fb.js";
import { $, $$, esc, money, fmtDate, modal, confirmBox, toast, errMsg, busy } from "../ui.js";
import { isUnpaidOnline } from "./dashboard.js";

const STATUS = {
  placed: "Placed",
  packed: "Packed",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled"
};
const NEXT = { placed: "packed", packed: "out_for_delivery", out_for_delivery: "delivered" };
const NEXT_LABEL = { packed: "Mark as packed", out_for_delivery: "Send out for delivery", delivered: "Mark as delivered" };
const TS_FIELD = { packed: "packedAt", out_for_delivery: "outForDeliveryAt", delivered: "deliveredAt" };

const orderNo = (o) => String(o.orderNumber || 0).padStart(5, "0");
const itemsTotal = (o) => (o.items || []).reduce((a, i) => a + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
const handlingOf = (o) =>
  o.handlingFee != null && o.handlingFee >= 0
    ? o.handlingFee
    : Math.max(0, (Number(o.totalAmount) || 0) - itemsTotal(o) - (Number(o.deliveryFee) || 0));
const payLabel = (o) =>
  o.paymentMethod === "UPI" ? (o.paymentStatus === "paid" ? "UPI paid" : "UPI") : "COD";

async function setStatus(o, status) {
  const now = Date.now();
  const updates = { status, updatedAt: now };
  if (TS_FIELD[status]) updates[TS_FIELD[status]] = now;
  const ref = doc(db, "orders", o.id);
  if (status !== "cancelled") {
    await updateDoc(ref, updates);
    return;
  }
  // Cancel and put the stock back in one transaction, same as the app does.
  await runTransaction(db, async (tx) => {
    const os = await tx.get(ref);
    if (!os.exists()) throw new Error("Order not found.");
    const order = os.data();
    const restore = order.status !== "cancelled" && !isUnpaidOnline(order);
    const ids = restore ? [...new Set((order.items || []).map((i) => i.productId))] : [];
    const snaps = await Promise.all(ids.map((id) => tx.get(doc(db, "products", id))));
    snaps.forEach((ps) => {
      if (!ps.exists()) return;
      const p = ps.data();
      let variants = p.variants || [];
      let plain = 0;
      (order.items || [])
        .filter((i) => i.productId === ps.id)
        .forEach((line) => {
          const idx = line.variantId
            ? variants.findIndex((v) => v.id === line.variantId)
            : variants.findIndex((v) => v.label === line.unit);
          if (idx >= 0) variants = variants.map((v, k) => (k === idx ? { ...v, stock: (v.stock || 0) + line.qty } : v));
          else plain += line.qty;
        });
      const upd = {};
      if (plain > 0) upd.stock = increment(plain);
      if (JSON.stringify(variants) !== JSON.stringify(p.variants || [])) upd.variants = variants;
      if (Object.keys(upd).length) tx.update(ps.ref, upd);
    });
    tx.update(ref, updates);
  });
}

function printBill(o) {
  const w = window.open("", "_blank", "width=380,height=640");
  if (!w) {
    toast("Pop-up was blocked. Allow pop-ups and try again.", "err");
    return;
  }
  const rows = (o.items || [])
    .map(
      (i) => `<tr><td>${esc(i.name)}<br><small>${esc(i.unit)} x ${i.qty}</small></td><td style="text-align:right">${money(i.price * i.qty)}</td></tr>`
    )
    .join("");
  w.document.write(`<!doctype html><title>Bill ${orderNo(o)}</title>
  <body style="font-family:monospace;width:300px;margin:12px auto;font-size:13px">
  <h3 style="text-align:center;margin:0">Champaran Mart</h3>
  <p style="text-align:center;margin:2px 0 8px">Order #${orderNo(o)}<br>${esc(fmtDate(o.createdAt))}</p>
  <p>${esc(o.customerName)} ${esc(o.customerPhone)}<br>${esc(o.address)}</p><hr>
  <table style="width:100%;border-collapse:collapse">${rows}</table><hr>
  <table style="width:100%"><tr><td>Items</td><td style="text-align:right">${money(itemsTotal(o))}</td></tr>
  <tr><td>Delivery</td><td style="text-align:right">${money(o.deliveryFee)}</td></tr>
  <tr><td>Handling</td><td style="text-align:right">${money(handlingOf(o))}</td></tr>
  <tr><td><b>Total</b></td><td style="text-align:right"><b>${money(o.totalAmount)}</b></td></tr></table>
  <p style="text-align:center">${esc(payLabel(o))}<br>Thank you!</p>
  <script>window.onload=function(){window.print()}<\/script></body>`);
  w.document.close();
}

export function render(view) {
  let orders = [];
  let filter = "all";
  let search = "";
  let openId = null;
  let detail = null;
  let agents = null;

  view.innerHTML = `
    <div class="ph"><h1>Orders</h1></div>
    <div class="toolbar">
      <div class="chips" id="chips"></div>
      <input class="in" id="q" type="search" placeholder="Order no., name or phone" aria-label="Search orders">
    </div>
    <div class="list" id="list"><div class="loading">Loading orders…</div></div>`;

  function counts() {
    const c = { all: orders.length };
    Object.keys(STATUS).forEach((k) => (c[k] = orders.filter((o) => o.status === k).length));
    return c;
  }

  function drawChips() {
    const c = counts();
    $("#chips", view).innerHTML = [["all", "All"], ...Object.entries(STATUS)]
      .map(([k, l]) => `<button type="button" class="chip ${filter === k ? "on" : ""}" data-f="${k}">${esc(l)}<small>${c[k] ?? 0}</small></button>`)
      .join("");
  }

  function drawList() {
    drawChips();
    const q = search.trim().toLowerCase();
    const rows = orders.filter(
      (o) =>
        (filter === "all" || o.status === filter) &&
        (!q || orderNo(o).includes(q) || String(o.orderNumber).includes(q) ||
          (o.customerName || "").toLowerCase().includes(q) || (o.customerPhone || "").includes(q))
    );
    const list = $("#list", view);
    if (!rows.length) {
      list.innerHTML = `<div class="empty"><i class="ti ti-receipt-off"></i>No orders found.</div>`;
      return;
    }
    list.innerHTML = rows
      .map(
        (o) => `<div class="row-card" data-id="${esc(o.id)}" tabindex="0" role="button">
        <i class="ti ti-receipt-2" style="font-size:22px;color:var(--brand)"></i>
        <div><div class="t">#${orderNo(o)} · ${esc(o.customerName || "Customer")}</div>
          <div class="s">${(o.items || []).length} ${(o.items || []).length === 1 ? "item" : "items"} ·${esc(fmtDate(o.createdAt))}${o.deliveryType === "express" ? " · Express" : ""}</div></div>
        <div class="r"><b>${money(o.totalAmount)}</b>
          <span class="badge b-muted">${esc(payLabel(o))}</span>
          <span class="badge b-${esc(o.status)}">${esc(STATUS[o.status] || o.status)}</span></div>
      </div>`
      )
      .join("");
  }

  async function loadAgents() {
    if (agents) return agents;
    try {
      const s = await getDocs(query(collection(db, "users"), where("role", "==", "delivery")));
      agents = s.docs.map((d) => ({ id: d.id, name: d.data().name || d.data().email || "Delivery" }));
    } catch (e) {
      agents = [];
    }
    return agents;
  }

  async function drawDetail() {
    const o = orders.find((x) => x.id === openId);
    if (!detail || !o) return;
    const ag = await loadAgents();
    if (!detail || openId !== o.id) return;
    const next = NEXT[o.status];
    detail.body.innerHTML = `
      <div class="steps"><span class="badge b-${esc(o.status)}">${esc(STATUS[o.status] || o.status)}</span>
        ${o.deliveryType === "express" ? '<span class="badge b-warn">Express</span>' : ""}
        <span class="badge b-muted">${esc(payLabel(o))}</span></div>
      <dl class="kv">
        <dt>Customer</dt><dd>${esc(o.customerName)}${o.customerPhone ? ` · <a href="tel:${esc(o.customerPhone)}">${esc(o.customerPhone)}</a>` : ""}</dd>
        <dt>Address</dt><dd>${esc(o.address)}${o.lat ? ` <a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${o.lat},${o.lng}">Map</a>` : ""}</dd>
        <dt>Placed</dt><dd>${esc(fmtDate(o.createdAt))}</dd>
        ${o.packedAt ? `<dt>Packed</dt><dd>${esc(fmtDate(o.packedAt))}</dd>` : ""}
        ${o.outForDeliveryAt ? `<dt>Out for delivery</dt><dd>${esc(fmtDate(o.outForDeliveryAt))}</dd>` : ""}
        ${o.deliveredAt ? `<dt>Delivered</dt><dd>${esc(fmtDate(o.deliveredAt))}</dd>` : ""}
        ${o.razorpayPaymentId ? `<dt>Payment id</dt><dd>${esc(o.razorpayPaymentId)}</dd>` : ""}
      </dl>
      <div class="items">${(o.items || [])
        .map(
          (i) => `<div class="it">${i.imageUrl ? `<img class="thumb" src="${esc(i.imageUrl)}" alt="">` : '<div class="thumb ph"><i class="ti ti-photo"></i></div>'}
          <div class="nm"><b>${esc(i.name)}</b><div class="s muted">${esc(i.unit)} · ${money(i.price)} x ${i.qty}</div></div><b>${money(i.price * i.qty)}</b></div>`
        )
        .join("")}</div>
      <div class="bill">
        <div><span>Items</span><span>${money(itemsTotal(o))}</span></div>
        <div><span>Delivery fee</span><span>${money(o.deliveryFee)}</span></div>
        <div><span>Handling fee</span><span>${money(handlingOf(o))}</span></div>
        <div class="tot"><span>Total</span><span>${money(o.totalAmount)}</span></div>
      </div>
      <div class="field" style="margin-top:16px">
        <label class="f" for="agent">Delivery boy</label>
        <select class="in" id="agent"><option value="">Unassigned</option>
          ${ag.map((a) => `<option value="${esc(a.id)}" ${o.deliveryAgentId === a.id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select>
        ${o.deliveryAgentId && !ag.some((a) => a.id === o.deliveryAgentId) ? `<div class="hint">Current: ${esc(o.deliveryAgentName)}</div>` : ""}
      </div>`;
    detail.footer.innerHTML = `
      <button class="btn ghost" type="button" data-print><i class="ti ti-printer"></i> Bill</button>
      ${o.status !== "cancelled" && o.status !== "delivered" ? '<button class="btn ghost" type="button" data-cancel style="color:var(--err)">Cancel order</button>' : ""}
      ${next ? `<button class="btn" type="button" data-next="${next}">${esc(NEXT_LABEL[next])}</button>` : ""}`;

    $("#agent", detail.body).onchange = async (e) => {
      const id = e.target.value;
      const a = ag.find((x) => x.id === id);
      try {
        await updateDoc(doc(db, "orders", o.id), { deliveryAgentId: id, deliveryAgentName: a ? a.name : "" });
        toast("Delivery boy assigned");
      } catch (err) {
        toast(errMsg(err), "err");
      }
    };
    $("[data-print]", detail.footer).onclick = () => printBill(o);
    const nb = $("[data-next]", detail.footer);
    if (nb)
      nb.onclick = () =>
        busy(nb, async () => {
          try {
            await setStatus(o, nb.dataset.next);
            toast("Status updated");
          } catch (err) {
            toast(errMsg(err), "err");
          }
        });
    const cb = $("[data-cancel]", detail.footer);
    if (cb)
      cb.onclick = async () => {
        if (!(await confirmBox(`Order #${orderNo(o)} will be cancelled and its stock returned to the shelf. Continue?`, { okText: "Yes, cancel", cancelText: "No", danger: true }))) return;
        try {
          await setStatus(o, "cancelled");
          toast("Order cancelled");
        } catch (err) {
          toast(errMsg(err), "err");
        }
      };
  }

  function openOrder(id) {
    const o = orders.find((x) => x.id === id);
    if (!o) return;
    openId = id;
    detail = modal({ title: `Order #${orderNo(o)}`, wide: true, onClose: () => { detail = null; openId = null; } });
    detail.body.innerHTML = '<div class="loading">Loading…</div>';
    drawDetail();
  }

  view.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-f]");
    if (chip) {
      filter = chip.dataset.f;
      drawList();
      return;
    }
    const row = e.target.closest(".row-card[data-id]");
    if (row) openOrder(row.dataset.id);
  });
  view.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const row = e.target.closest(".row-card[data-id]");
    if (row) openOrder(row.dataset.id);
  });
  $("#q", view).addEventListener("input", (e) => {
    search = e.target.value;
    drawList();
  });

  const unsub = onSnapshot(
    query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(300)),
    (snap) => {
      // Unpaid / failed online orders are not real orders to fulfil, same as in the app.
      orders = snap.docs.map((d) => ({ ...d.data(), id: d.id })).filter((o) => !isUnpaidOnline(o));
      drawList();
      if (detail) drawDetail();
    },
    (err) => {
      $("#list", view).innerHTML = `<div class="empty"><i class="ti ti-alert-triangle"></i>${esc(errMsg(err))}</div>`;
    }
  );

  return () => {
    unsub();
    if (detail) detail.close();
  };
}
