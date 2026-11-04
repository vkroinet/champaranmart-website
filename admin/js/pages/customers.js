import { db, collection, onSnapshot, query, where } from "../fb.js";
import { $, $$, esc, money, fmtDate, fmtDay, modal, toast, errMsg, fromDateInput } from "../ui.js";
import { isUnpaidOnline } from "./dashboard.js";

const DAY = 86400000;
const sod = (ms) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const eod = (ms) => sod(ms) + DAY - 1;

const PERIODS = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["7d", "7 days"],
  ["30d", "1 month"],
  ["all", "All time"],
  ["custom", "Custom"]
];
const STATUS = { placed: "Placed", packed: "Packed", out_for_delivery: "Out for delivery", delivered: "Delivered", cancelled: "Cancelled" };
const orderNo = (o) => String(o.orderNumber || 0).padStart(5, "0");
const counts = (o) => o.status !== "cancelled"; // spending counts every order except cancelled

function range(period, from, to) {
  const now = Date.now();
  switch (period) {
    case "today": return [sod(now), eod(now)];
    case "yesterday": return [sod(now - DAY), eod(now - DAY)];
    case "7d": return [sod(now - 6 * DAY), eod(now)];
    case "30d": return [sod(now - 29 * DAY), eod(now)];
    case "custom": return [sod(from), eod(to)];
    default: return [0, Infinity];
  }
}

// yyyy-mm-dd in the admin's own time zone (toDateInput in ui.js uses UTC, which is a day off after midnight in India)
const ymd = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function render(view) {
  let users = [];
  let orders = [];
  let period = "30d";
  let from = Date.now();
  let to = Date.now();
  let village = "";
  let sort = "spend";
  let q = "";
  let includeNone = false;
  let gotUsers = false;
  let gotOrders = false;
  let shown = [];

  view.innerHTML = `
    <div class="ph"><h1>Customers</h1><div class="sp"></div><button class="btn ghost" id="csv" type="button"><i class="ti ti-download"></i> Download CSV</button></div>
    <div class="chips" id="periods" style="margin-bottom:10px">${PERIODS.map(([k, t]) => `<button class="chip ${k === period ? "on" : ""}" type="button" data-p="${k}">${t}</button>`).join("")}</div>
    <div id="custom" style="display:none;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
      <input class="in" type="date" id="d-from" style="max-width:170px" aria-label="From date"> <span class="hint" style="margin:0">to</span>
      <input class="in" type="date" id="d-to" style="max-width:170px" aria-label="To date"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <input class="in" id="q" placeholder="Search name or phone" style="flex:2 1 200px;max-width:320px" aria-label="Search customers">
      <select class="in" id="village" style="flex:1 1 150px;max-width:220px" aria-label="Village"><option value="">All villages</option></select>
      <select class="in" id="sort" style="flex:1 1 150px;max-width:220px" aria-label="Sort by">
        <option value="spend">Top spenders</option><option value="recent">Most recent</option><option value="orders">Most orders</option></select>
    </div>
    <label class="chk" style="margin-bottom:14px;font-weight:500"><input type="checkbox" id="none"> Include customers with no orders</label>
    <div class="metrics" id="sum" style="margin-bottom:14px"></div>
    <div class="list" id="list"><div class="loading">Loading customers…</div></div>`;

  const userById = () => new Map(users.map((u) => [u.id, u]));

  function compute() {
    const [a, b] = range(period, from, to);
    const byCust = new Map();
    for (const o of orders) {
      const t = o.createdAt || 0;
      if (t < a || t > b || !counts(o)) continue;
      const list = byCust.get(o.customerId) || [];
      list.push(o);
      byCust.set(o.customerId, list);
    }
    const um = userById();
    const stats = [];
    for (const [uid, list] of byCust) {
      const u = um.get(uid);
      const latest = list.reduce((x, y) => ((y.createdAt || 0) > (x.createdAt || 0) ? y : x));
      stats.push({
        uid,
        name: (u && u.name) || latest.customerName || "-",
        phone: (u && u.phone) || latest.customerPhone || "",
        village: (u && u.village) || "",
        count: list.length,
        spent: list.reduce((s, o) => s + (Number(o.totalAmount) || 0), 0),
        last: latest.createdAt || 0
      });
    }
    if (includeNone) {
      for (const u of users) if (!byCust.has(u.id)) stats.push({ uid: u.id, name: u.name || "-", phone: u.phone || "", village: u.village || "", count: 0, spent: 0, last: 0 });
    }
    const ql = q.trim().toLowerCase();
    shown = stats
      .filter((s) => !village || s.village.trim() === village)
      .filter((s) => !ql || s.name.toLowerCase().includes(ql) || String(s.phone).includes(ql))
      .sort((x, y) => (sort === "recent" ? y.last - x.last : sort === "orders" ? y.count - x.count : y.spent - x.spent));
  }

  function draw() {
    if (!gotUsers || !gotOrders) return;
    compute();
    const withOrders = shown.filter((s) => s.count > 0).length;
    const totalOrders = shown.reduce((s, c) => s + c.count, 0);
    const totalSales = shown.reduce((s, c) => s + c.spent, 0);
    $("#sum", view).innerHTML = `
      <div class="metric"><small>Customers who ordered</small><b>${withOrders}</b></div>
      <div class="metric"><small>Orders</small><b>${totalOrders}</b></div>
      <div class="metric"><small>Total sales</small><b>${money(totalSales)}</b></div>`;
    const list = $("#list", view);
    if (!shown.length) {
      list.innerHTML = `<div class="empty"><i class="ti ti-users"></i>No customers found for this period.</div>`;
      return;
    }
    list.innerHTML = shown
      .map(
        (s) => `<div class="row-card" data-id="${esc(s.uid)}" tabindex="0" role="button">
        <div style="width:40px;height:40px;border-radius:50%;background:var(--surface);display:grid;place-items:center;flex:none;font-weight:700;color:var(--brand)">${esc((s.name || "?").trim().charAt(0).toUpperCase())}</div>
        <div><div class="t">${esc(s.name)}</div><div class="s">${esc(s.phone)}${s.village ? " · " + esc(s.village) : ""}</div>
          <div class="s">${s.count ? `${s.count} ${s.count === 1 ? "order" : "orders"} · last ${esc(fmtDay(s.last))}` : "No orders in this period"}</div></div>
        <div class="r"><b>${money(s.spent)}</b></div></div>`
      )
      .join("");
  }

  function fillVillages() {
    const names = [...new Set(users.map((u) => String(u.village || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const sel = $("#village", view);
    sel.innerHTML = `<option value="">All villages</option>` + names.map((n) => `<option value="${esc(n)}" ${n === village ? "selected" : ""}>${esc(n)}</option>`).join("");
  }

  function openCustomer(uid) {
    const u = userById().get(uid) || {};
    const mine = orders.filter((o) => o.customerId === uid).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const valid = mine.filter(counts);
    const spent = valid.reduce((s, o) => s + (Number(o.totalAmount) || 0), 0);
    const fallback = mine[0] || {};
    const name = u.name || fallback.customerName || "-";
    const phone = u.phone || fallback.customerPhone || "";
    const m = modal({ title: name, wide: true });
    m.body.innerHTML = `
      <dl class="kv" style="margin-bottom:14px">
        <dt>Phone</dt><dd>${phone ? `<a href="tel:${esc(phone)}">${esc(phone)}</a>` : "-"}</dd>
        <dt>Village</dt><dd>${esc(u.village || "-")}</dd>
        ${u.email ? `<dt>Email</dt><dd>${esc(u.email)}</dd>` : ""}
        <dt>Joined</dt><dd>${esc(fmtDay(u.createdAt))}</dd>
      </dl>
      <div class="metrics" style="margin-bottom:14px">
        <div class="metric"><small>Orders</small><b>${valid.length}</b></div>
        <div class="metric"><small>Total spent</small><b>${money(spent)}</b></div>
        <div class="metric"><small>Average order</small><b>${money(valid.length ? spent / valid.length : 0)}</b></div>
      </div>
      <h3 style="font-size:15px;margin:0 0 8px">All orders</h3>
      ${
        mine.length
          ? mine
              .map(
                (o) => `<div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--border)">
          <div style="flex:1;min-width:0"><div style="font-weight:600">Order #${orderNo(o)}</div>
            <div class="hint" style="margin:0">${esc(fmtDate(o.createdAt))} · ${(o.items || []).length} ${(o.items || []).length === 1 ? "item" : "items"} · ${o.paymentMethod === "UPI" ? "UPI" : "COD"}</div></div>
          <span class="badge b-${esc(o.status)}">${esc(STATUS[o.status] || o.status)}</span>
          <b>${money(o.totalAmount)}</b></div>`
              )
              .join("")
          : '<p class="hint">This customer has not placed any order yet.</p>'
      }`;
    m.footer.innerHTML = `<button class="btn ghost" type="button" id="close">Close</button>`;
    $("#close", m.footer).onclick = m.close;
  }

  function downloadCsv() {
    if (!shown.length) return toast("Nothing to download for this period", "err");
    const head = ["Name", "Phone", "Village", "Orders", "Total spent", "Last order"];
    const rows = shown.map((s) => [s.name, s.phone, s.village, s.count, s.spent, s.last ? ymd(s.last) : ""]);
    const csv = "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `customers-${ymd(Date.now())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  view.addEventListener("click", (e) => {
    const p = e.target.closest("[data-p]");
    if (p) {
      period = p.dataset.p;
      $$("#periods .chip", view).forEach((c) => c.classList.toggle("on", c === p));
      $("#custom", view).style.display = period === "custom" ? "flex" : "none";
      if (period === "custom") {
        $("#d-from", view).value = ymd(from);
        $("#d-to", view).value = ymd(to);
      }
      return draw();
    }
    if (e.target.closest("#csv")) return downloadCsv();
    const row = e.target.closest(".row-card[data-id]");
    if (row) openCustomer(row.dataset.id);
  });
  view.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.target.closest("input,select,button")) return;
    const row = e.target.closest(".row-card[data-id]");
    if (row) openCustomer(row.dataset.id);
  });
  view.addEventListener("input", (e) => {
    if (e.target.id === "q") {
      q = e.target.value;
      draw();
    }
  });
  view.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "village") village = t.value;
    else if (t.id === "sort") sort = t.value;
    else if (t.id === "none") includeNone = t.checked;
    else if (t.id === "d-from" || t.id === "d-to") {
      const f = fromDateInput($("#d-from", view).value);
      const g = fromDateInput($("#d-to", view).value);
      if (f) from = f;
      if (g) to = g;
      if (from > to) [from, to] = [to, from];
    } else return;
    draw();
  });

  const fail = (err) => {
    $("#list", view).innerHTML = `<div class="empty"><i class="ti ti-alert-triangle"></i>${esc(errMsg(err))}</div>`;
  };
  const unsubs = [
    onSnapshot(
      query(collection(db, "users"), where("role", "==", "customer")),
      (s) => {
        gotUsers = true;
        users = s.docs.map((d) => ({ ...d.data(), id: d.id }));
        fillVillages();
        draw();
      },
      fail
    ),
    onSnapshot(
      collection(db, "orders"),
      (s) => {
        gotOrders = true;
        orders = s.docs.map((d) => ({ ...d.data(), id: d.id })).filter((o) => !isUnpaidOnline(o));
        draw();
      },
      fail
    )
  ];
  return () => {
    unsubs.forEach((u) => u());
    $$(".md-ov").forEach((o) => o.remove());
    document.body.classList.remove("noscroll");
  };
}
