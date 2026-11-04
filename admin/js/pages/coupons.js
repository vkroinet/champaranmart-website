import { db, collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc } from "../fb.js";
import { $, $$, esc, fmtDay, modal, confirmBox, toast, errMsg, busy, fromDateInput } from "../ui.js";

// yyyy-mm-dd in the admin's own time zone (toDateInput in ui.js uses UTC, which can be a day off in India)
const ymd = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
// A coupon is valid until the end of its last day, like in the app (23:59:59).
const endOfDay = (dateStr) => fromDateInput(dateStr) + 86399000;

const status = (c) => {
  if (c.active === false) return ["Hidden", "b-muted"];
  if (c.validUntil && c.validUntil < Date.now()) return ["Expired", "b-err"];
  return ["Active", "b-ok"];
};

export function render(view) {
  let coupons = [];
  let got = false;

  view.innerHTML = `
    <div class="ph"><h1>Coupons</h1><div class="sp"></div><button class="btn" id="add" type="button"><i class="ti ti-plus"></i> New coupon</button></div>
    <p class="hint" style="margin:-8px 0 16px;max-width:640px">Customers see active coupons on the Home page and in the Coupons page of the app, and copy the code. The discount is not applied automatically at checkout.</p>
    <div class="list" id="list"><div class="loading">Loading coupons…</div></div>`;

  function draw() {
    if (!got) return;
    const list = $("#list", view);
    if (!coupons.length) {
      list.innerHTML = `<div class="empty"><i class="ti ti-ticket"></i>No coupons yet. Add your first coupon.</div>`;
      return;
    }
    list.innerHTML = coupons
      .map((c) => {
        const [label, cls] = status(c);
        return `<div class="row-card" data-id="${esc(c.id)}" tabindex="0" role="button">
        <div style="width:40px;height:40px;border-radius:12px;background:var(--surface);display:grid;place-items:center;flex:none"><i class="ti ti-ticket"></i></div>
        <div style="min-width:0"><div class="t">${esc(c.title)} <span style="font-weight:700;color:var(--brand);margin-left:6px;letter-spacing:.5px">${esc(c.code)}</span></div>
          <div class="s">${esc(c.description || "")}${c.description ? " · " : ""}${c.validUntil ? "Valid until " + esc(fmtDay(c.validUntil)) : "No end date"}</div></div>
        <div class="r" style="display:flex;align-items:center;gap:10px"><span class="badge ${cls}">${label}</span>
          <label class="sw" title="Show in the app"><input type="checkbox" data-sw="${esc(c.id)}" ${c.active !== false ? "checked" : ""} aria-label="Show this coupon in the app"><span></span></label></div></div>`;
      })
      .join("");
  }

  function openForm(existing) {
    const c = existing ? { ...existing } : { title: "", description: "", code: "", validUntil: 0, active: true };
    const m = modal({ title: existing ? "Edit coupon" : "New coupon" });
    m.body.innerHTML = `
      <div class="field"><label class="f" for="c-title">Title *</label><input class="in" id="c-title" value="${esc(c.title)}" maxlength="60" placeholder="Flat ₹50 off" autocomplete="off"></div>
      <div class="field"><label class="f" for="c-desc">Description</label><input class="in" id="c-desc" value="${esc(c.description)}" maxlength="120" placeholder="On your first order above ₹299" autocomplete="off"></div>
      <div class="grid2">
        <div class="field"><label class="f" for="c-code">Coupon code *</label><input class="in" id="c-code" value="${esc(c.code)}" maxlength="20" style="text-transform:uppercase" autocomplete="off"></div>
        <div class="field"><label class="f" for="c-date">Valid until (optional)</label><input class="in" type="date" id="c-date" value="${c.validUntil ? ymd(c.validUntil) : ""}"></div>
      </div>
      <label class="chk" style="margin-bottom:6px"><input type="checkbox" id="c-act" ${c.active !== false ? "checked" : ""}> Show in the app</label>
      <p class="err-line" id="cerr" role="alert"></p>`;
    m.footer.innerHTML = `
      ${existing ? '<button class="btn ghost" type="button" id="del" style="color:var(--err);margin-right:auto"><i class="ti ti-trash"></i> Delete</button>' : ""}
      <button class="btn ghost" type="button" id="cancel">Close</button>
      <button class="btn" type="button" id="save">Save</button>`;
    setTimeout(() => $("#c-title", m.body).focus(), 50);
    $("#cancel", m.footer).onclick = m.close;

    const del = $("#del", m.footer);
    if (del)
      del.onclick = async () => {
        if (!(await confirmBox(`Delete the coupon "${existing.title}"?`, { okText: "Yes, delete", danger: true }))) return;
        try {
          await deleteDoc(doc(db, "coupons", existing.id));
          toast("Coupon deleted");
          m.close();
        } catch (e) {
          toast(errMsg(e), "err");
        }
      };

    const save = $("#save", m.footer);
    save.onclick = () =>
      busy(save, async () => {
        const err = $("#cerr", m.body);
        err.textContent = "";
        const title = $("#c-title", m.body).value.trim();
        const code = $("#c-code", m.body).value.trim().toUpperCase();
        const dateStr = $("#c-date", m.body).value;
        if (!title) {
          err.textContent = "Please enter a title.";
          return;
        }
        if (!code) {
          err.textContent = "Please enter a coupon code.";
          return;
        }
        if (/\s/.test(code)) {
          err.textContent = "The code cannot contain spaces.";
          return;
        }
        if (coupons.some((x) => x.id !== (existing && existing.id) && String(x.code).toUpperCase() === code)) {
          err.textContent = "Another coupon already uses this code.";
          return;
        }
        try {
          const ref = existing ? doc(db, "coupons", existing.id) : doc(collection(db, "coupons"));
          const data = {
            id: ref.id,
            title,
            description: $("#c-desc", m.body).value.trim(),
            code,
            validUntil: dateStr ? endOfDay(dateStr) : 0,
            active: $("#c-act", m.body).checked
          };
          if (!existing) data.createdAt = Date.now();
          await setDoc(ref, data, { merge: true });
          toast(existing ? "Coupon updated" : "Coupon added");
          m.close();
        } catch (e) {
          err.textContent = errMsg(e);
        }
      });
  }

  view.addEventListener("click", (e) => {
    if (e.target.closest("#add")) return openForm(null);
    if (e.target.closest(".sw")) return;
    const row = e.target.closest(".row-card[data-id]");
    if (row) openForm(coupons.find((x) => x.id === row.dataset.id));
  });
  view.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.target.closest("input,button")) return;
    const row = e.target.closest(".row-card[data-id]");
    if (row) openForm(coupons.find((x) => x.id === row.dataset.id));
  });
  view.addEventListener("change", async (e) => {
    const t = e.target;
    const id = t.dataset && t.dataset.sw;
    if (!id) return;
    try {
      await updateDoc(doc(db, "coupons", id), { active: t.checked });
      toast(t.checked ? "Coupon is now shown in the app" : "Coupon hidden from the app");
    } catch (err) {
      t.checked = !t.checked;
      toast(errMsg(err), "err");
    }
  });

  const unsub = onSnapshot(
    collection(db, "coupons"),
    (s) => {
      got = true;
      coupons = s.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      draw();
    },
    (err) => {
      $("#list", view).innerHTML = `<div class="empty"><i class="ti ti-alert-triangle"></i>${esc(errMsg(err))}</div>`;
    }
  );
  return () => {
    unsub();
    $$(".md-ov").forEach((o) => o.remove());
    document.body.classList.remove("noscroll");
  };
}
