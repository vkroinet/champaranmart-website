import { auth, db, onAuthStateChanged, signOut, doc, getDoc, setDoc, collection, query, where, onSnapshot } from "./fb.js";
import { $, esc, toast, errMsg, confirmBox } from "./ui.js";

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

// How the left menu is grouped (section keys from SECTIONS).
const GROUPS = [
  ["Sell", ["orders", "customers", "delivery"]],
  ["Catalog", ["products", "categories", "banners", "coupons"]],
  ["Store", ["fees", "areas"]],
  ["Marketing", ["offers", "reports"]]
];
const MOBILE_MAIN = ["", "orders", "products", "customers"]; // bottom bar; "More" opens the full list

const sec = (key) => SECTIONS.find((s) => s[0] === key);
let view = $("#view");
let cleanup = null;
let started = false;
let current = "";
let newOrders = 0;

function route() {
  return (location.hash.replace(/^#\/?/, "") || "").split("/")[0];
}

const badge = (key) => (key === "orders" && newOrders ? `<span class="n">${newOrders > 99 ? "99+" : newOrders}</span>` : "");
const link = (key, cls = "") => {
  const s = key === "" ? ["", "Dashboard", "ti-layout-dashboard"] : sec(key);
  return `<a href="#/${s[0]}" class="${current === key ? "on" : ""} ${cls}"><i class="ti ${s[2]}"></i>${esc(s[1])}${badge(key)}</a>`;
};

function drawNav() {
  $("#nav").innerHTML =
    link("") +
    GROUPS.map(([title, keys]) => `<h4>${esc(title)}</h4>${keys.map((k) => link(k)).join("")}`).join("") +
    `<h4>Account</h4>
     <a href="/" target="_blank" rel="noopener"><i class="ti ti-external-link"></i>Open website</a>
     <button class="nl" type="button" data-act="logout"><i class="ti ti-logout"></i>Logout</button>`;

  const mb = MOBILE_MAIN.map((k) => {
    const s = k === "" ? ["", "Home", "ti-layout-dashboard"] : sec(k);
    return `<a href="#/${s[0]}" class="${current === k ? "on" : ""}"><i class="ti ${s[2]}"></i>${esc(k === "" ? "Home" : s[1])}${badge(k)}</a>`;
  }).join("");
  const moreOn = current !== "" && !MOBILE_MAIN.includes(current);
  $("#mbar").innerHTML = mb + `<button type="button" class="${moreOn ? "on" : ""}" data-act="more"><i class="ti ti-menu-2"></i>More</button>`;

  $("#sheetBody").innerHTML =
    GROUPS.map(([title, keys]) => `<h4>${esc(title)}</h4>${keys.map((k) => link(k)).join("")}`).join("") +
    `<h4>Account</h4>
     <a href="/" target="_blank" rel="noopener"><i class="ti ti-external-link"></i>Open website</a>
     <button class="nl" type="button" data-act="logout"><i class="ti ti-logout"></i>Logout</button>`;
}

async function show() {
  const key = route();
  current = key;
  drawNav();
  $("#sheet").classList.remove("open");
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
      const s = sec(key);
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

const isUnpaidOnline = (o) => o.paymentStatus === "pending" || o.paymentStatus === "failed";

function watchShell() {
  // Orders waiting (status "placed"), shown as a badge on Orders.
  onSnapshot(
    query(collection(db, "orders"), where("status", "==", "placed")),
    (s) => {
      const n = s.docs.filter((d) => !isUnpaidOnline(d.data())).length;
      if (n !== newOrders) {
        newOrders = n;
        drawNav();
      }
    },
    () => {}
  );
  // The shop-wide "taking orders" switch (same setting as Service areas).
  onSnapshot(
    doc(db, "settings", "service"),
    (s) => {
      const on = s.exists() ? s.data().ordersEnabled !== false : true;
      $("#shopOn").checked = on;
      $("#shopLbl").textContent = on ? "Taking orders" : "Orders paused";
    },
    () => {}
  );
}

async function start(user) {
  const email = user.email || "";
  $("#who").textContent = (email || "A").trim().charAt(0).toUpperCase();
  $("#who").title = email;
  const boot = $("#boot");
  if (boot) boot.remove();
  $("#app").classList.add("ready");
  if (!started) {
    started = true;
    window.addEventListener("hashchange", show);

    document.addEventListener("click", async (e) => {
      const act = e.target.closest("[data-act]");
      if (act) {
        if (act.dataset.act === "logout") {
          await signOut(auth);
          location.replace("/login/");
        } else if (act.dataset.act === "more") {
          $("#sheet").classList.add("open");
        }
        return;
      }
      if (e.target.id === "sheet") $("#sheet").classList.remove("open");
    });

    $("#search").addEventListener("submit", (e) => {
      e.preventDefault();
      const q = $("#q").value.trim();
      if (!q) return;
      try {
        sessionStorage.setItem("adminOrderSearch", q);
      } catch (err) {
        /* the search just won't be pre-filled */
      }
      $("#q").value = "";
      if (route() === "orders") show();
      else location.hash = "#/orders";
    });

    $("#shopOn").addEventListener("change", async (e) => {
      const box = e.target;
      const on = box.checked;
      if (!on && !(await confirmBox("Stop all new orders? Customers will see that the shop is closed until you turn this back on.", { okText: "Yes, stop orders", danger: true }))) {
        box.checked = true;
        return;
      }
      try {
        await setDoc(doc(db, "settings", "service"), { ordersEnabled: on }, { merge: true });
        toast(on ? "Taking orders: ON" : "Taking orders: OFF");
      } catch (err) {
        box.checked = !on;
        toast(errMsg(err), "err");
      }
    });
    watchShell();
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
    $("#boot").innerHTML = `<div class="empty"><i class="ti ti-alert-triangle"></i><p>${esc(errMsg(e))}</p><a class="btn" href="/login/">Login page</a></div>`;
    toast(errMsg(e), "err");
  }
});
