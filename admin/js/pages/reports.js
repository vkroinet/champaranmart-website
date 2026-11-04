import { db, collection, onSnapshot } from "../fb.js";
import { $, $$, esc, money, errMsg, toast, fromDateInput } from "../ui.js";
import { isUnpaidOnline } from "./dashboard.js";

const DAY = 86400000;
const sod = (ms) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const eod = (ms) => sod(ms) + DAY - 1;
// yyyy-mm-dd in the admin's own time zone
const ymd = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 10);

const PERIODS = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["7d", "7 days"],
  ["30d", "1 month"],
  ["custom", "Custom"]
];

function range(period, from, to) {
  const now = Date.now();
  switch (period) {
    case "yesterday": return [sod(now - DAY), eod(now - DAY)];
    case "7d": return [sod(now - 6 * DAY), eod(now)];
    case "30d": return [sod(now - 29 * DAY), eod(now)];
    case "custom": return [sod(from), eod(to)];
    default: return [sod(now), eod(now)];
  }
}

const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const num = (n) => Number(n) || 0;

export function render(view) {
  let orders = [];
  let buying = new Map(); // product id -> buying price
  let period = "today";
  let from = Date.now();
  let to = Date.now();
  let metric = "amount"; // chart: "amount" | "units"
  let gotOrders = false;
  let gotProducts = false;
  let summary = null;

  view.innerHTML = `
    <div class="ph"><h1>Reports</h1><div class="sp"></div><button class="btn ghost" id="csv" type="button"><i class="ti ti-download"></i> Download CSV</button></div>
    <div class="chips" id="periods" style="margin-bottom:10px">${PERIODS.map(([k, t]) => `<button class="chip ${k === period ? "on" : ""}" type="button" data-p="${k}">${t}</button>`).join("")}</div>
    <div id="custom" style="display:none;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
      <input class="in" type="date" id="d-from" style="max-width:170px" aria-label="From date"> <span class="hint" style="margin:0">to</span>
      <input class="in" type="date" id="d-to" style="max-width:170px" aria-label="To date"></div>
    <div id="body"><div class="loading">Loading report…</div></div>`;

  function compute() {
    const [a, b] = range(period, from, to);
    const inRange = orders.filter((o) => {
      const t = o.createdAt || 0;
      return t >= a && t <= b && o.status !== "cancelled";
    });
    const groups = new Map();
    for (const o of inRange) {
      for (const it of o.items || []) {
        const key = it.productId || it.name;
        const g = groups.get(key) || { key, name: it.name || "-", qty: 0, revenue: 0, profit: 0 };
        g.qty += num(it.qty) || 0;
        g.revenue += num(it.price) * (num(it.qty) || 0);
        const buy = buying.get(key) || 0;
        if (buy > 0) g.profit += (num(it.price) - buy) * (num(it.qty) || 0);
        groups.set(key, g);
      }
    }
    const lines = [...groups.values()].sort((x, y) => y.revenue - x.revenue);
    return {
      orders: inRange.length,
      sales: inRange.reduce((s, o) => s + num(o.totalAmount), 0),
      profit: lines.reduce((s, l) => s + l.profit, 0),
      lines
    };
  }

  function draw() {
    if (!gotOrders || !gotProducts) return;
    summary = compute();
    const s = summary;
    const top = [...s.lines].sort((x, y) => (metric === "units" ? y.qty - x.qty : y.revenue - x.revenue)).slice(0, 8);
    const max = Math.max(1, ...top.map((l) => (metric === "units" ? l.qty : l.revenue)));
    const body = $("#body", view);
    if (!s.orders) {
      body.innerHTML = `<div class="metrics" style="margin-bottom:14px">
        <div class="metric"><small>Orders</small><b>0</b></div><div class="metric"><small>Sales</small><b>₹0</b></div></div>
        <div class="empty"><i class="ti ti-chart-bar"></i>No orders in this period.</div>`;
      return;
    }
    body.innerHTML = `
      <div class="metrics" style="margin-bottom:6px">
        <div class="metric"><small>Orders</small><b>${s.orders}</b></div>
        <div class="metric"><small>Sales</small><b>${money(s.sales)}</b></div>
        <div class="metric"><small>Profit</small><b>${s.profit > 0 ? money(s.profit) : "-"}</b></div>
      </div>
      <p class="hint" style="margin:0 0 18px;max-width:680px">Sales include delivery and handling fees. Profit is worked out from the buying price saved on each product (products without a buying price are left out), so it is an estimate. Cancelled orders are not counted.</p>

      <div class="card" style="margin-bottom:18px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
          <h2 style="font-size:17px;margin:0;margin-right:auto">Top products</h2>
          <div class="chips"><button class="chip ${metric === "amount" ? "on" : ""}" type="button" data-m="amount">Sales</button><button class="chip ${metric === "units" ? "on" : ""}" type="button" data-m="units">Units sold</button></div>
        </div>
        ${top
          .map((l) => {
            const v = metric === "units" ? l.qty : l.revenue;
            return `<div style="display:grid;grid-template-columns:minmax(90px,1.2fr) 3fr auto;gap:10px;align-items:center;padding:5px 0">
            <div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:13px" title="${esc(l.name)}">${esc(l.name)}</div>
            <div style="background:var(--surface);border-radius:999px;height:12px;overflow:hidden"><div style="width:${Math.max(2, Math.round((v / max) * 100))}%;height:100%;background:var(--brand);border-radius:999px"></div></div>
            <div style="font-weight:700;font-size:13px;min-width:56px;text-align:right">${metric === "units" ? l.qty : money(l.revenue)}</div></div>`;
          })
          .join("")}
      </div>

      <h2 style="font-size:17px;margin:0 0 10px">All products sold <span class="hint" style="font-weight:400">(${s.lines.length})</span></h2>
      <div class="list">${s.lines
        .map(
          (l) => `<div class="row-card" style="cursor:default">
        <div><div class="t">${esc(l.name)}</div><div class="s">${l.qty} sold${l.profit > 0 ? ` · Profit ${money(l.profit)}` : ""}</div></div>
        <div class="r"><b>${money(l.revenue)}</b></div></div>`
        )
        .join("")}</div>`;
  }

  function downloadCsv() {
    if (!summary || !summary.lines.length) return toast("Nothing to download for this period", "err");
    const [a, b] = range(period, from, to);
    const head = ["Product", "Units sold", "Sales", "Profit"];
    const rows = summary.lines.map((l) => [l.name, l.qty, l.revenue, l.profit > 0 ? l.profit : ""]);
    const csv = "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `sales-report-${ymd(a)}${ymd(a) === ymd(b) ? "" : "-to-" + ymd(Math.min(b, Date.now()))}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
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
    const m = e.target.closest("[data-m]");
    if (m) {
      metric = m.dataset.m;
      return draw();
    }
    if (e.target.closest("#csv")) downloadCsv();
  });
  view.addEventListener("change", (e) => {
    if (e.target.id !== "d-from" && e.target.id !== "d-to") return;
    const f = fromDateInput($("#d-from", view).value);
    const g = fromDateInput($("#d-to", view).value);
    if (f) from = f;
    if (g) to = g;
    if (from > to) [from, to] = [to, from];
    draw();
  });

  const fail = (err) => {
    $("#body", view).innerHTML = `<div class="empty"><i class="ti ti-alert-triangle"></i>${esc(errMsg(err))}</div>`;
  };
  const unsubs = [
    onSnapshot(
      collection(db, "orders"),
      (s) => {
        gotOrders = true;
        orders = s.docs.map((d) => ({ ...d.data(), id: d.id })).filter((o) => !isUnpaidOnline(o));
        draw();
      },
      fail
    ),
    onSnapshot(
      collection(db, "products"),
      (s) => {
        gotProducts = true;
        buying = new Map(s.docs.map((d) => [d.id, num(d.data().buyingPrice)]));
        draw();
      },
      fail
    )
  ];
  return () => unsubs.forEach((u) => u());
}
