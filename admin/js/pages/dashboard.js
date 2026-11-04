import { db, collection, query, orderBy, limit, onSnapshot } from "../fb.js";
import { $, esc, money, startOfToday } from "../ui.js";

export const isUnpaidOnline = (o) => o.paymentStatus === "pending" || o.paymentStatus === "failed";

const DAY = 86400000;
const OPEN = ["placed", "packed", "out_for_delivery"];
const STATUS = { placed: "Placed", packed: "Packed", out_for_delivery: "Out for delivery", delivered: "Delivered", cancelled: "Cancelled" };
// Customers' phones write order fields, so the number is forced to a plain number before it goes into HTML.
const orderNo = (o) => {
  const n = Math.trunc(Number(o.orderNumber));
  return String(Number.isFinite(n) ? n : 0).padStart(5, "0");
};
const norm = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
const num = (n) => Number(n) || 0;

function ago(ms) {
  const m = Math.max(0, Math.round((Date.now() - (ms || 0)) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}

export function render(view) {
  let orders = [];
  let products = [];
  let requestGroups = 0;
  let gotOrders = false;
  let gotProducts = false;

  view.innerHTML = `<div class="loading">Loading dashboard…</div>`;

  function draw() {
    if (!gotOrders || !gotProducts) return;
    const day = startOfToday();
    const real = orders.filter((o) => !isUnpaidOnline(o));
    const sold = (from, to) => real.filter((o) => o.status !== "cancelled" && (o.createdAt || 0) >= from && (o.createdAt || 0) < to);

    const today = sold(day, day + DAY);
    const yest = sold(day - DAY, day);
    const salesToday = today.reduce((s, o) => s + num(o.totalAmount), 0);
    const salesYest = yest.reduce((s, o) => s + num(o.totalAmount), 0);
    let vs;
    if (salesYest > 0) {
      const pct = Math.round(((salesToday - salesYest) / salesYest) * 100);
      vs = `${pct >= 0 ? "+" : ""}${pct}% vs yesterday`;
    } else {
      vs = "no sales yesterday";
    }

    const open = real.filter((o) => OPEN.includes(o.status));
    const placed = open.filter((o) => o.status === "placed").length;
    const outNow = open.filter((o) => o.status === "out_for_delivery").length;
    const needAgent = open.filter((o) => o.status !== "placed" && !o.deliveryAgentId).length;
    const avg = today.length ? Math.round(salesToday / today.length) : 0;

    let outOfStock = 0;
    products.forEach((p) => {
      if (p.active === false) return;
      const stock = p.variants && p.variants.length ? p.variants.reduce((a, v) => a + num(v.stock), 0) : num(p.stock);
      if (stock <= 0) outOfStock++;
    });

    const liveOrders = [...open]
      .sort((a, b) => (b.deliveryType === "express") - (a.deliveryType === "express") || (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 6);

    // last 7 days of sales (today is the last bar)
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const from = day - i * DAY;
      const total = sold(from, from + DAY).reduce((s, o) => s + num(o.totalAmount), 0);
      week.push([i === 0 ? "Today" : new Date(from).toLocaleDateString("en-IN", { weekday: "short" }), total]);
    }
    const max = Math.max(1, ...week.map((w) => w[1]));

    view.innerHTML = `
      <div class="hero">
        <div><small>Today's sales</small><div class="big">${money(salesToday)}</div>
          <div class="sm">${today.length} ${today.length === 1 ? "order" : "orders"} · ${esc(vs)}</div></div>
        <div class="st">
          <div><b>${placed}</b><span>New orders</span></div>
          <div><b>${outNow}</b><span>Out for delivery</span></div>
          <div><b>${avg ? money(avg) : "-"}</b><span>Average order</span></div>
        </div>
      </div>

      <div class="attrow">
        <a class="attc" href="#/orders"><div class="ic b-err"><i class="ti ti-clock-exclamation"></i></div><div><b>${placed}</b><span>Orders waiting</span></div></a>
        <a class="attc" href="#/orders"><div class="ic b-warn"><i class="ti ti-motorbike"></i></div><div><b>${needAgent}</b><span>Need a delivery boy</span></div></a>
        <a class="attc" href="#/products"><div class="ic" style="background:var(--info-bg);color:var(--info)"><i class="ti ti-package-off"></i></div><div><b>${outOfStock}</b><span>Out of stock</span></div></a>
        <a class="attc" href="#/areas"><div class="ic" style="background:var(--surface);color:var(--brand)"><i class="ti ti-map-pin"></i></div><div><b>${requestGroups}</b><span>Village requests</span></div></a>
      </div>

      <div class="dgrid">
        <div class="card"><div class="dhd"><h3>Live orders</h3><a href="#/orders">View all</a></div>
          ${
            liveOrders.length
              ? `<div class="ocards">${liveOrders
                  .map(
                    (o) => `<div class="oc"><div class="r"><b>#${orderNo(o)}</b><span class="badge b-${esc(o.status)}">${esc(STATUS[o.status] || o.status)}</span></div>
              <div style="margin-top:6px;font-weight:600;overflow-wrap:anywhere">${esc(o.customerName || "-")}</div>
              <div class="tiny">${esc(ago(o.createdAt))}${o.deliveryType === "express" ? " · Express" : ""}${o.deliveryAgentName ? " · " + esc(o.deliveryAgentName) : ""}</div>
              <div style="margin-top:8px;display:flex;align-items:center"><b>${money(o.totalAmount)}</b><a class="btn sm" style="margin-left:auto" href="#/orders/${esc(o.id)}">Open</a></div></div>`
                  )
                  .join("")}</div>`
              : '<div class="empty" style="padding:24px 8px"><i class="ti ti-circle-check"></i>No open orders right now.</div>'
          }
        </div>
        <div class="card"><div class="dhd"><h3>Sales, last 7 days</h3><a href="#/reports">Reports</a></div>
          <div class="dbars">${week
            .map(
              (w, i) => `<div class="dbar ${i === 6 ? "today" : ""}"><em>${w[1] ? money(w[1]) : ""}</em><i style="height:${Math.round((w[1] / max) * 100)}%"></i><span>${esc(w[0])}</span></div>`
            )
            .join("")}</div>
        </div>
      </div>

      <div class="card" style="margin-top:14px"><div class="dhd"><h3>Shortcuts</h3></div>
        <div class="dq">
          <a href="#/products"><i class="ti ti-plus"></i>Add product</a>
          <a href="#/banners"><i class="ti ti-photo-plus"></i>New banner</a>
          <a href="#/coupons"><i class="ti ti-ticket"></i>New coupon</a>
          <a href="#/offers"><i class="ti ti-send"></i>Send offer</a>
          <a href="#/fees"><i class="ti ti-truck-delivery"></i>Change fees</a>
          <a href="#/areas"><i class="ti ti-map-pin"></i>Villages</a>
        </div>
      </div>`;
  }

  const unsubs = [
    onSnapshot(
      query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(500)),
      (snap) => {
        gotOrders = true;
        orders = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
        draw();
      },
      (err) => {
        view.innerHTML = `<div class="empty"><i class="ti ti-alert-triangle"></i>${esc(err && err.message ? err.message : "Could not load the dashboard.")}</div>`;
      }
    ),
    onSnapshot(
      collection(db, "products"),
      (snap) => {
        gotProducts = true;
        products = snap.docs.map((d) => d.data());
        draw();
      },
      () => {
        gotProducts = true;
        draw();
      }
    ),
    onSnapshot(
      collection(db, "villageRequests"),
      (snap) => {
        requestGroups = new Set(snap.docs.map((d) => norm(d.data().name)).filter(Boolean)).size;
        draw();
      },
      () => {}
    )
  ];
  return () => unsubs.forEach((u) => u());
}
