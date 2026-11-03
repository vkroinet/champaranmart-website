export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const money = (n) => "₹" + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-IN");

export const fmtDate = (ms) =>
  ms
    ? new Date(ms).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "-";

export const fmtDay = (ms) =>
  ms ? new Date(ms).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

/** yyyy-mm-dd for <input type="date"> from epoch millis ("" when 0). */
export const toDateInput = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");
export const fromDateInput = (v) => (v ? new Date(v + "T00:00:00").getTime() : 0);

export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Plain-language message for a Firebase error. */
export function errMsg(e) {
  const code = e && (e.code || "");
  if (code.includes("permission-denied")) return "You don't have permission to do this. Are you logged in as an admin?";
  if (code.includes("unauthenticated")) return "Your session has expired. Please log in again.";
  if (code.includes("unavailable") || code.includes("network")) return "Network or server problem. Please try again shortly.";
  if (code.includes("not-found")) return "Record not found.";
  if (code.includes("failed-precondition") && /index/i.test(e.message || "")) return "Firestore needs an index. Create it using the link in the browser console.";
  return (e && e.message) || "Something went wrong. Please try again.";
}

let toastTimer;
export function toast(msg, kind = "ok") {
  let t = $("#toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.setAttribute("role", "status");
    document.body.appendChild(t);
  }
  t.className = "toast " + kind + " show";
  t.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), kind === "err" ? 5000 : 2600);
}

/** Opens a dialog. Returns { body, footer, close }. */
export function modal({ title, wide = false, onClose } = {}) {
  const ov = document.createElement("div");
  ov.className = "md-ov";
  ov.innerHTML = `
    <div class="md ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="md-h"><h2>${esc(title)}</h2><button class="icon-btn" type="button" data-x aria-label="Close"><i class="ti ti-x"></i></button></div>
      <div class="md-b"></div>
      <div class="md-f"></div>
    </div>`;
  document.body.appendChild(ov);
  document.body.classList.add("noscroll");
  const close = () => {
    document.removeEventListener("keydown", onKey);
    ov.remove();
    if (!$(".md-ov")) document.body.classList.remove("noscroll");
    if (onClose) onClose();
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);
  $("[data-x]", ov).onclick = close;
  ov.addEventListener("mousedown", (e) => {
    if (e.target === ov) close();
  });
  return { body: $(".md-b", ov), footer: $(".md-f", ov), close, root: ov };
}

/** Yes/no question inside the page (the browser's confirm() looks poor and can be blocked). */
export function confirmBox(message, { okText = "Yes", cancelText = "No", danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({ title: "Are you sure?", onClose: () => !done && resolve(false) });
    m.body.innerHTML = `<p class="confirm-msg">${esc(message)}</p>`;
    m.footer.innerHTML = `<button class="btn ghost" type="button" data-no>${esc(cancelText)}</button>
      <button class="btn ${danger ? "danger" : ""}" type="button" data-yes>${esc(okText)}</button>`;
    $("[data-no]", m.footer).onclick = () => m.close();
    $("[data-yes]", m.footer).onclick = () => {
      done = true;
      m.close();
      resolve(true);
    };
  });
}

/** Disables a button while an async job runs, so a double click can't save twice. */
export async function busy(btn, job, label) {
  const old = btn.innerHTML;
  btn.disabled = true;
  if (label) btn.textContent = label;
  try {
    return await job();
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
}

export const num = (v, d = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
};
