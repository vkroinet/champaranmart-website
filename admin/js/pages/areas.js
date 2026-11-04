import { db, collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc, writeBatch } from "../fb.js";
import { $, $$, esc, modal, confirmBox, toast, errMsg, busy } from "../ui.js";

// Same starter list as the app (StarterVillages.kt).
const STARTER_VILLAGES = [
  "मोतीछापर छोटा", "मोतीछापर बड़ा", "मंगहा", "नवकातोला", "बरोहिया छोटा", "बरोहिया बड़ा", "पश्चिमी चौबेतोला",
  "पूर्वी चौबेतोला", "बनकातवा", "बनवातोला", "छौनागंज", "अतिथिया", "डोमरहिया", "खुटिया डीह"
];

const norm = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
const serviceRef = () => doc(db, "settings", "service");

export function render(view) {
  let villages = [];
  let requests = [];
  let ordersEnabled = true;
  let gotVillages = false;
  let importing = false;

  view.innerHTML = `
    <div class="ph"><h1>Service areas</h1><div class="sp"></div><button class="btn" id="add" type="button"><i class="ti ti-plus"></i> Add village</button></div>
    <p class="hint" style="margin:-8px 0 16px;max-width:640px">Customers can only order from villages marked as allowed. Everyone can still browse the app.</p>
    <div class="card" style="max-width:640px;margin-bottom:16px">
      <label class="chk" style="justify-content:space-between">
        <span><span id="orders-label" style="display:block"></span><span class="hint" style="font-weight:400;display:block">Turn this off to stop all new orders (for example when the shop is closed).</span></span>
        <span class="sw"><input type="checkbox" id="orders-on" checked><span></span></span>
      </label>
    </div>
    <div id="reqs"></div>
    <div id="bar-actions" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
      <span id="count" style="font-weight:600;margin-right:auto"></span>
      <button class="btn ghost sm" id="allow-all" type="button">Allow all</button>
      <button class="btn ghost sm" id="deny-all" type="button">Not allow all</button>
    </div>
    <div class="list" id="list"><div class="loading">Loading villages…</div></div>`;

  const taken = (name, exceptId) => villages.some((v) => v.id !== exceptId && norm(v.name) === norm(name));

  function drawOrders() {
    $("#orders-on", view).checked = ordersEnabled;
    $("#orders-label", view).textContent = ordersEnabled ? "Taking orders: ON" : "Taking orders: OFF";
  }

  function drawList() {
    const list = $("#list", view);
    if (!gotVillages) return;
    const allowed = villages.filter((v) => v.active !== false).length;
    $("#count", view).textContent = villages.length ? `${villages.length} villages · ${allowed} allowed` : "";
    $("#bar-actions", view).style.display = villages.length ? "flex" : "none";
    if (!villages.length) {
      list.innerHTML = `<div class="empty"><i class="ti ti-map-pin"></i><p>No villages yet. Customers cannot order until you add at least one.</p>
        <button class="btn" id="starter" type="button">Add the starter list (${STARTER_VILLAGES.length} villages)</button></div>`;
      return;
    }
    list.innerHTML = villages
      .map(
        (v) => `<div class="row-card" data-id="${esc(v.id)}" tabindex="0" role="button">
        <div style="width:40px;height:40px;border-radius:12px;background:var(--surface);display:grid;place-items:center;flex:none"><i class="ti ti-map-pin"></i></div>
        <div><div class="t">${esc(v.name)}</div><div class="s">${v.active !== false ? "Customers can order" : "Not allowed"}</div></div>
        <div class="r"><label class="sw" title="Allow orders from this village"><input type="checkbox" data-sw="${esc(v.id)}" ${v.active !== false ? "checked" : ""} aria-label="Allow orders from ${esc(v.name)}"><span></span></label></div></div>`
      )
      .join("");
  }

  function drawRequests() {
    const groups = new Map();
    for (const r of requests) {
      const k = norm(r.name);
      if (!k) continue;
      const g = groups.get(k) || { name: String(r.name).trim(), ids: [] };
      g.ids.push(r.id);
      groups.set(k, g);
    }
    const arr = [...groups.values()].sort((a, b) => b.ids.length - a.ids.length);
    const box = $("#reqs", view);
    if (!arr.length) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = `<div class="card" style="max-width:640px;margin-bottom:16px">
      <h2 style="font-size:17px;margin:0 0 4px">Villages customers asked for</h2>
      <p class="hint" style="margin:0 0 10px">These customers said their village is not on the list.</p>
      ${arr
        .map(
          (g, i) => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--border)">
        <div style="flex:1;min-width:0"><div class="t" style="font-weight:600">${esc(g.name)}</div><div class="hint" style="margin:0">${g.ids.length} ${g.ids.length === 1 ? "customer" : "customers"}</div></div>
        <button class="btn sm" type="button" data-req-add="${i}">Add</button>
        <button class="btn ghost sm" type="button" data-req-del="${i}" aria-label="Dismiss request"><i class="ti ti-x"></i></button></div>`
        )
        .join("")}</div>`;
    box._groups = arr;
  }

  async function addVillage(name) {
    const ref = doc(collection(db, "villages"));
    await setDoc(ref, { id: ref.id, name: name.trim(), active: true, createdAt: Date.now() });
  }

  function openForm(existing) {
    const m = modal({ title: existing ? "Edit village" : "Add village" });
    m.body.innerHTML = `
      <div class="field"><label class="f" for="v-name">Village name *</label><input class="in" id="v-name" value="${esc(existing ? existing.name : "")}" maxlength="80"></div>
      <p class="err-line" id="verr" role="alert"></p>`;
    m.footer.innerHTML = `
      ${existing ? '<button class="btn ghost" type="button" id="del" style="color:var(--err);margin-right:auto"><i class="ti ti-trash"></i> Delete</button>' : ""}
      <button class="btn ghost" type="button" id="cancel">Close</button>
      <button class="btn" type="button" id="save">Save</button>`;
    setTimeout(() => $("#v-name", m.body).focus(), 50);
    $("#cancel", m.footer).onclick = m.close;
    $("#v-name", m.body).addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("#save", m.footer).click();
    });

    const del = $("#del", m.footer);
    if (del)
      del.onclick = async () => {
        if (!(await confirmBox(`Remove "${existing.name}"? Customers who chose this village will not be able to order until they pick another village.`, { okText: "Yes, remove", danger: true })))
          return;
        try {
          await deleteDoc(doc(db, "villages", existing.id));
          toast("Village removed");
          m.close();
        } catch (e) {
          toast(errMsg(e), "err");
        }
      };

    const save = $("#save", m.footer);
    save.onclick = () =>
      busy(save, async () => {
        const err = $("#verr", m.body);
        err.textContent = "";
        const name = $("#v-name", m.body).value.trim();
        if (!name) {
          err.textContent = "Please enter the village name.";
          return;
        }
        if (taken(name, existing && existing.id)) {
          err.textContent = existing ? "A village with this name already exists." : "This village is already on the list.";
          return;
        }
        try {
          if (existing) await updateDoc(doc(db, "villages", existing.id), { name });
          else await addVillage(name);
          toast(existing ? "Village updated" : "Village added");
          m.close();
        } catch (e) {
          err.textContent = errMsg(e);
        }
      });
  }

  async function setAll(active) {
    const todo = villages.filter((v) => (v.active !== false) !== active);
    if (!todo.length) {
      toast(active ? "All villages are already allowed" : "All villages are already set to not allowed");
      return;
    }
    const q = active ? "Allow orders from all villages?" : "Stop orders from all villages? Customers will not be able to place any order.";
    if (!(await confirmBox(q, { okText: active ? "Yes, allow all" : "Yes, not allow all", danger: !active }))) return;
    try {
      for (let i = 0; i < todo.length; i += 400) {
        const b = writeBatch(db);
        todo.slice(i, i + 400).forEach((v) => b.update(doc(db, "villages", v.id), { active }));
        await b.commit();
      }
      toast(active ? "All villages allowed" : "All villages set to not allowed");
    } catch (e) {
      toast(errMsg(e), "err");
    }
  }

  async function importStarter(btn) {
    if (importing) return;
    importing = true;
    try {
      await busy(btn, async () => {
        const missing = STARTER_VILLAGES.filter((n) => !taken(n));
        if (!missing.length) {
          toast("All of these villages are already on the list");
          return;
        }
        const b = writeBatch(db);
        const now = Date.now();
        missing.forEach((n, i) => {
          const ref = doc(collection(db, "villages"));
          b.set(ref, { id: ref.id, name: n, active: true, createdAt: now + i });
        });
        await b.commit();
        toast("Villages added");
      });
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      importing = false;
    }
  }

  view.addEventListener("click", async (e) => {
    if (e.target.closest("#add")) return openForm(null);
    if (e.target.closest("#allow-all")) return setAll(true);
    if (e.target.closest("#deny-all")) return setAll(false);
    const st = e.target.closest("#starter");
    if (st) return importStarter(st);

    const ra = e.target.closest("[data-req-add]");
    const rd = e.target.closest("[data-req-del]");
    if (ra || rd) {
      const g = $("#reqs", view)._groups[Number((ra || rd).dataset.reqAdd ?? (ra || rd).dataset.reqDel)];
      if (!g) return;
      try {
        if (ra && !taken(g.name)) await addVillage(g.name);
        const b = writeBatch(db);
        g.ids.forEach((id) => b.delete(doc(db, "villageRequests", id)));
        await b.commit();
        toast(ra ? "Village added" : "Request dismissed");
      } catch (err) {
        toast(errMsg(err), "err");
      }
      return;
    }

    if (e.target.closest(".sw")) return; // the switch handles itself (see "change")
    const row = e.target.closest(".row-card[data-id]");
    if (row) openForm(villages.find((v) => v.id === row.dataset.id));
  });

  view.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.target.closest("input,button")) return;
    const row = e.target.closest(".row-card[data-id]");
    if (row) openForm(villages.find((v) => v.id === row.dataset.id));
  });

  view.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.matches("#orders-on")) {
      const on = t.checked;
      if (!on && !(await confirmBox("Stop all new orders? Customers will see that the shop is closed until you turn this back on.", { okText: "Yes, stop orders", danger: true }))) {
        t.checked = true;
        return;
      }
      try {
        await setDoc(serviceRef(), { ordersEnabled: on }, { merge: true });
        ordersEnabled = on;
        drawOrders();
        toast(on ? "Taking orders: ON" : "Taking orders: OFF");
      } catch (err) {
        t.checked = ordersEnabled;
        toast(errMsg(err), "err");
      }
      return;
    }
    const id = t.dataset && t.dataset.sw;
    if (id) {
      try {
        await updateDoc(doc(db, "villages", id), { active: t.checked });
      } catch (err) {
        t.checked = !t.checked;
        toast(errMsg(err), "err");
      }
    }
  });

  const fail = (el) => (err) => {
    el.innerHTML = `<div class="empty"><i class="ti ti-alert-triangle"></i>${esc(errMsg(err))}</div>`;
  };
  const unsubs = [
    onSnapshot(
      collection(db, "villages"),
      (s) => {
        gotVillages = true;
        villages = s.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => String(a.name).localeCompare(String(b.name)) || a.id.localeCompare(b.id));
        drawList();
      },
      fail($("#list", view))
    ),
    onSnapshot(
      serviceRef(),
      (s) => {
        ordersEnabled = s.exists() ? s.data().ordersEnabled !== false : true;
        drawOrders();
      },
      () => {}
    ),
    onSnapshot(
      collection(db, "villageRequests"),
      (s) => {
        requests = s.docs.map((d) => ({ ...d.data(), id: d.id }));
        drawRequests();
      },
      () => {}
    )
  ];
  drawOrders();
  return () => {
    unsubs.forEach((u) => u());
    $$(".md-ov").forEach((o) => o.remove());
    document.body.classList.remove("noscroll");
  };
}
