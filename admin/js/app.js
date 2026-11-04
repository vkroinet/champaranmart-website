import { auth, db, onAuthStateChanged, signOut, doc, getDoc } from "./fb.js";
import { $, esc, toast, errMsg } from "./ui.js";

// key -> [label, icon, subtitle, loader]. A null loader means "coming soon".
export const SECTIONS = [
  ["orders", "Orders", "ti-receipt-2", "View orders and update status", () => import("./pages/orders.js")],
  ["products", "Products", "ti-package", "Products, prices and stock", () => import("./pages/products.js")],
  ["categories", "Category", "ti-category", "Categories and their photos", () => import("./pages/categories.js")],
  ["banners", "Banners", "ti-photo", "Home page banners", () => import("./pages/banners.js")],
  ["coupons", "Coupons", "ti-ticket", "Coupon codes", () => import("./pages/coupons.js")],
  ["customers", "Customers", "ti-users", "Customer list and report", () => import("./pages/customers.js")],
  ["fees", "Fees", "ti-truck-delivery", "Delivery, handling and express fees", () => import("./pages/fees.js")],
  ["areas", "Service areas", "ti-map-pin", "Villages and order on/off", () => import("./pages/areas.js")],
  ["delivery", "Delivery boys", "ti-motorbike", "Delivery accounts", () => import("./pages/delivery.js")],
  ["reports", "Reports", "ti-chart-bar", "Sales and profit", () => import("./pages/reports.js")],
  ["offers", "Send offer", "ti-bell", "Send offers to customers", () => import("./pages/offers.js")]
];

let view = $("#view");
let cleanup = null;
let started = false;

function route() {
  return (location.hash.replace(/^#\/?/, "") || "").split("/")[0];
}

function drawTabs(current) {
  $("#tabs").innerHTML =
    `<a href="#/" class="${current === "" ? "on" : ""}">Dashboard</a>` +
    SECTIONS.filter((s) => s[4])
      .map((s) => `<a href="#/${s[0]}" class="${current === s[0] ? "on" : ""}">${esc(s[1])}</a>`)
      .join("");
}

async function show() {
  const key = route();
  drawTabs(key);
  if (cleanup) {
    try {
      cleanup();
    } catch (e) {
      /* ignore */
    }
    cleanup = null;
  }
  // Pages attach click/change listeners to their container. A fresh container for every page keeps the
  // previous page's listeners from also reacting to clicks on the new page.
  const fresh = view.cloneNode(false);
  view.replaceWith(fresh);
  view = fresh;
  const v = fresh; // this page's own container (the global may point at a newer page by the time loading ends)
  v.innerHTML = `<div class="loading">Loading…</div>`;
  window.scrollTo(0, 0);
  try {
    let loader;
    if (key === "") {
      loader = () => import("./pages/dashboard.js");
    } else {
      const s = SECTIONS.find((x) => x[0] === key);
      loader = s && s[4];
    }
    if (!loader) {
      v.innerHTML = `<div class="empty"><i class="ti ti-tools"></i><h1>Coming soon</h1><p>This section is still being built. Please use the app for now.</p><a class="btn" href="#/">Dashboard</a></div>`;
      return;
    }
    const mod = await loader();
    const mine = key;
    const result = await mod.render(v, { sections: SECTIONS });
    if (route() !== mine) {
      if (typeof result === "function") result();
      return;
    }
    cleanup = typeof result === "function" ? result : null;
  } catch (e) {
    console.error(e);
    v.innerHTML = `<div class="empty"><i class="ti ti-alert-triangle"></i><p>${esc(errMsg(e))}</p></div>`;
  }
}

async function start(user) {
  $("#who").textContent = user.email || "";
  $("#bar").hidden = false;
  if (!started) {
    started = true;
    window.addEventListener("hashchange", show);
    $("#logout").onclick = async () => {
      await signOut(auth);
      location.replace("/login/");
    };
  }
  show();
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.replace("/login/");
    return;
  }
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists() || snap.data().role !== "admin") {
      await signOut(auth);
      location.replace("/login/?denied=1");
      return;
    }
    start(user);
  } catch (e) {
    view.innerHTML = `<div class="empty"><i class="ti ti-alert-triangle"></i><p>${esc(errMsg(e))}</p><a class="btn" href="/login/">Login page</a></div>`;
    toast(errMsg(e), "err");
  }
});
