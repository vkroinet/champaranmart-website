import {
  db, storage, collection, onSnapshot, doc, setDoc, deleteDoc, getDocs, query, where, limit, storageRef, uploadBytes, getDownloadURL, deleteObject
} from "../fb.js";
import { $, $$, esc, modal, confirmBox, toast, errMsg, busy } from "../ui.js";

const MAIN = "MAIN";
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "c" + Date.now() + Math.random().toString(16).slice(2));

export function render(view) {
  let cats = [];
  let search = "";
  let typeFilter = "";

  view.innerHTML = `
    <div class="ph"><h1>Categories</h1><div class="sp"></div><button class="btn" id="add" type="button"><i class="ti ti-plus"></i> New category</button></div>
    <div class="toolbar">
      <input class="in" id="q" type="search" placeholder="Search category" aria-label="Search categories">
      <select class="in" id="tf" style="max-width:200px" aria-label="Show"><option value="">All</option><option value="main">Main categories</option><option value="sub">Sub-categories</option><option value="off">Inactive</option></select>
    </div>
    <div class="list" id="list"><div class="loading">Loading categories…</div></div>`;

  const parentName = (c) => (c.parentCategory && c.parentCategory !== MAIN ? (cats.find((x) => x.id === c.parentCategory) || {}).name || "" : "");

  function drawList() {
    const list = $("#list", view);
    if (!cats.length) {
      list.innerHTML = `<div class="empty"><i class="ti ti-category"></i>No categories yet.</div>`;
      return;
    }
    const q = search.trim().toLowerCase();
    const isMain = (c) => !c.parentCategory || c.parentCategory === MAIN;
    const rows = cats.filter((c) => {
      if (q && !(c.name || "").toLowerCase().includes(q)) return false;
      if (typeFilter === "main") return isMain(c);
      if (typeFilter === "sub") return !isMain(c);
      if (typeFilter === "off") return c.active === false;
      return true;
    });
    if (!rows.length) {
      list.innerHTML = `<div class="empty"><i class="ti ti-category"></i>No categories found.</div>`;
      return;
    }
    list.innerHTML = rows
      .map(
        (c) => `<div class="row-card" data-id="${esc(c.id)}" tabindex="0" role="button">
        ${c.imageUrl ? `<img class="thumb" src="${esc(c.imageUrl)}" alt="" loading="lazy">` : '<div class="thumb ph"><i class="ti ti-photo"></i></div>'}
        <div><div class="t">${esc(c.name)}</div><div class="s">${parentName(c) ? "Sub-category of " + esc(parentName(c)) : "Main category"} · order ${c.order || 0}</div></div>
        <div class="r">${c.active === false ? '<span class="badge b-muted">Inactive</span>' : '<span class="badge b-ok">Active</span>'}</div></div>`
      )
      .join("");
  }

  function openForm(existing) {
    const c = existing ? { ...existing } : { name: "", imageUrl: "", parentCategory: MAIN, active: true, order: cats.length };
    let imageUrl = c.imageUrl || "";
    let file = null;
    let oldUrl = existing ? existing.imageUrl : "";
    const m = modal({ title: existing ? "Edit category" : "New category" });
    const parents = cats.filter((x) => (!x.parentCategory || x.parentCategory === MAIN) && x.id !== c.id);
    m.body.innerHTML = `
      <div class="field"><label class="f">Photo</label>
        <div class="imgs" id="img"></div>
        <input type="file" id="file" accept="image/*" hidden>
        <button class="btn ghost sm" type="button" id="pick"><i class="ti ti-photo-plus"></i> Choose photo</button></div>
      <div class="field"><label class="f" for="c-name">Name *</label><input class="in" id="c-name" value="${esc(c.name)}" maxlength="60"></div>
      <div class="field"><label class="f" for="c-parent">Show under</label>
        <select class="in" id="c-parent"><option value="${MAIN}">Main category (home page)</option>
          ${parents.map((p) => `<option value="${esc(p.id)}" ${c.parentCategory === p.id ? "selected" : ""}>Inside ${esc(p.name)}</option>`).join("")}</select></div>
      <div class="grid2">
        <div class="field"><label class="f" for="c-order">Order</label><input class="in" id="c-order" inputmode="numeric" value="${esc(c.order || 0)}"></div>
        <div class="field"><label class="chk" style="margin-top:28px"><input type="checkbox" id="c-act" ${c.active !== false ? "checked" : ""}> Active (visible)</label></div>
      </div>
      <p class="err-line" id="cerr" role="alert"></p>`;
    m.footer.innerHTML = `
      ${existing ? '<button class="btn ghost" type="button" id="del" style="color:var(--err);margin-right:auto"><i class="ti ti-trash"></i> Delete</button>' : ""}
      <button class="btn ghost" type="button" id="cancel">Close</button>
      <button class="btn" type="button" id="save">Save</button>`;

    const drawImg = () => {
      const src = file ? URL.createObjectURL(file) : imageUrl;
      $("#img", m.body).innerHTML = src ? `<div class="im"><img src="${esc(src)}" alt=""></div>` : '<span class="hint">No photo.</span>';
    };
    drawImg();
    $("#pick", m.body).onclick = () => $("#file", m.body).click();
    $("#file", m.body).onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) return toast("Photo must be under 5 MB", "err");
      file = f;
      drawImg();
    };
    $("#cancel", m.footer).onclick = m.close;

    const del = $("#del", m.footer);
    if (del)
      del.onclick = async () => {
        try {
          const used = await getDocs(query(collection(db, "products"), where("categoryId", "==", c.id), limit(1)));
          const kids = cats.some((x) => x.parentCategory === c.id);
          if (!used.empty || kids) {
            toast("This category still has products or sub-categories. Move or remove them first.", "err");
            return;
          }
          if (!(await confirmBox(`Delete "${c.name}"?`, { okText: "Yes, delete", danger: true }))) return;
          await deleteDoc(doc(db, "categories", c.id));
          if (c.imageUrl && c.imageUrl.includes("/o/categories%2F")) deleteObject(storageRef(storage, c.imageUrl)).catch(() => {});
          toast("Category deleted");
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
        const name = $("#c-name", m.body).value.trim();
        if (!name) {
          err.textContent = "Enter the category name.";
          return;
        }
        try {
          let url = imageUrl;
          if (file) {
            const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
            const ref = storageRef(storage, `categories/${uid()}.${ext}`);
            await uploadBytes(ref, file, { contentType: file.type || "image/jpeg" });
            url = await getDownloadURL(ref);
          }
          const ref = existing ? doc(db, "categories", c.id) : doc(collection(db, "categories"));
          await setDoc(
            ref,
            {
              id: ref.id,
              name,
              imageUrl: url,
              parentCategory: $("#c-parent", m.body).value,
              active: $("#c-act", m.body).checked,
              order: parseInt($("#c-order", m.body).value || "0", 10) || 0
            },
            { merge: true }
          );
          if (file && oldUrl && oldUrl !== url && oldUrl.includes("/o/categories%2F")) deleteObject(storageRef(storage, oldUrl)).catch(() => {});
          toast(existing ? "Category updated" : "Category added");
          m.close();
        } catch (e) {
          err.textContent = errMsg(e);
        }
      });
  }

  view.addEventListener("click", (e) => {
    if (e.target.closest("#add")) return openForm(null);
    const row = e.target.closest(".row-card[data-id]");
    if (row) openForm(cats.find((c) => c.id === row.dataset.id));
  });
  view.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const row = e.target.closest(".row-card[data-id]");
    if (row) openForm(cats.find((c) => c.id === row.dataset.id));
  });

  $("#q", view).oninput = (e) => {
    search = e.target.value;
    drawList();
  };
  // Picking a filter empties the search box first, otherwise the old text plus the new filter shows a blank list.
  $("#tf", view).onchange = (e) => {
    search = "";
    $("#q", view).value = "";
    typeFilter = e.target.value;
    drawList();
  };

  const unsub = onSnapshot(
    collection(db, "categories"),
    (s) => {
      cats = s.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => (a.order || 0) - (b.order || 0));
      drawList();
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
