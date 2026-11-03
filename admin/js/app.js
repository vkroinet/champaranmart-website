import { auth, db, onAuthStateChanged, signOut, doc, getDoc } from "./fb.js";
import { $, esc, toast, errMsg } from "./ui.js";

// key -> [label, icon, subtitle, loader]. A null loader means "coming soon".
export const SECTIONS = [
  ["orders", "Orders", "ti-receipt-2", "Orders dekho aur status badlo", () => import("./pages/orders.js")],
  ["products", "Products", "ti-package", "Product, price aur stock", () => import("./pages/products.js")],
  ["categories", "Category", "ti-category", "Categories aur unki photo", () => import("./pages/categories.js")],
  ["banners", "Banners", "ti-photo", "Home page ke banners", null],
  ["coupons", "Coupons", "ti-ticket", "Coupon codes", null],
  ["customers", "Customers", "ti-users", "Customer list aur report", null],
  ["fees", "Fees", "ti-truck-delivery", "Delivery, handling, express", null],
  ["areas", "Service areas", "ti-map-pin", "Gaon aur order ON/OFF", null],
  ["delivery", "Delivery boys", "ti-motorbike", "Delivery accounts", null],
  ["reports", "Reports", "ti-chart-bar", "Sale aur profit", null],
  ["offers", "Send offer", "ti-bell", "Customers ko offer bhejo", null]
];

const view = $("#view");
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
  view.innerHTML = `<div class="loading">Khul raha hai…</div>`;
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
      view.innerHTML = `<div class="empty"><i class="ti ti-tools"></i><h1>Jald aa raha hai</h1><p>Ye section abhi ban raha hai. Tab tak app se kaam karo.</p><a class="btn" href="#/">Dashboard</a></div>`;
      return;
    }
    const mod = await loader();
    const mine = key;
    const result = await mod.render(view, { sections: SECTIONS });
    if (route() !== mine) {
      if (typeof result === "function") result();
      return;
    }
    cleanup = typeof result === "function" ? result : null;
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="empty"><i class="ti ti-alert-triangle"></i><p>${esc(errMsg(e))}</p></div>`;
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
