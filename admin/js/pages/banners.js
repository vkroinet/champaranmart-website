import { db, storage, collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc, storageRef, uploadBytes, getDownloadURL, deleteObject } from "../fb.js";
import { $, $$, esc, modal, confirmBox, toast, errMsg, busy } from "../ui.js";

const HERO = "hero";
const SECONDARY = "secondary";
const ASPECT = 2.2; // width : height, same as the app (BANNER_ASPECT_RATIO)
const OUT_W = 1320;
const OUT_H = Math.round(OUT_W / ASPECT);
const PLACEMENTS = [
  [HERO, "Main banners", "Top of the Home page, under the search bar"],
  [SECONDARY, "Ad banners", "Second carousel further down the Home page"]
];

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "b" + Date.now() + Math.random().toString(16).slice(2));
const isOurs = (url) => typeof url === "string" && url.includes("/o/banners%2F");

/** Centre-crops the picked photo to the banner shape and returns a JPEG blob. */
function cropToBanner(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      let sw = w, sh = w / ASPECT;
      if (sh > h) {
        sh = h;
        sw = h * ASPECT;
      }
      const sx = (w - sw) / 2, sy = (h - sh) / 2;
      const c = document.createElement("canvas");
      const scale = Math.min(1, OUT_W / sw);
      c.width = Math.round(sw * scale);
      c.height = Math.round(sh * scale);
      c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read this photo."))), "image/jpeg", 0.88);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read this photo. Please choose a JPG or PNG."));
    };
    img.src = url;
  });
}

export function render(view) {
  let banners = [];
  let got = false;

  view.innerHTML = `
    <div class="ph"><h1>Banners</h1><div class="sp"></div><button class="btn" id="add" type="button"><i class="ti ti-plus"></i> New banner</button></div>
    <p class="hint" style="margin:-8px 0 16px;max-width:640px">Banners rotate on the Home page of the app. Use a wide photo, about ${OUT_W} × ${OUT_H} px. Other shapes are cropped from the centre.</p>
    <div id="body"><div class="loading">Loading banners…</div></div>`;

  const label = (b, i) => b.title || `Banner ${i + 1}`;

  function draw() {
    if (!got) return;
    const body = $("#body", view);
    if (!banners.length) {
      body.innerHTML = `<div class="empty"><i class="ti ti-photo"></i>No banners yet. Add your first banner.</div>`;
      return;
    }
    body.innerHTML = PLACEMENTS.map(([key, title, sub]) => {
      const list = banners.filter((b) => (b.placement || HERO) === key);
      return `<h2 style="font-size:17px;margin:18px 0 2px">${esc(title)}</h2><p class="hint" style="margin:0 0 10px">${esc(sub)}</p>
        <div class="list">${
          list.length
            ? list
                .map(
                  (b, i) => `<div class="row-card" data-id="${esc(b.id)}" tabindex="0" role="button">
          ${b.imageUrl ? `<img class="thumb" style="width:110px;height:50px;object-fit:cover" src="${esc(b.imageUrl)}" alt="" loading="lazy">` : `<div class="thumb ph" style="width:110px;height:50px"><i class="ti ti-photo"></i></div>`}
          <div><div class="t">${esc(label(b, i))}</div><div class="s">${esc(b.subtitle || "")}${b.active === false ? (b.subtitle ? " · " : "") + "Hidden in the app" : ""}</div></div>
          <div class="r"><label class="sw" title="Show in the app"><input type="checkbox" data-sw="${esc(b.id)}" ${b.active !== false ? "checked" : ""} aria-label="Show this banner in the app"><span></span></label></div></div>`
                )
                .join("")
            : '<div class="hint" style="padding:8px 0">No banners here.</div>'
        }</div>`;
    }).join("");
  }

  function openForm(existing) {
    const b = existing ? { ...existing } : { title: "", subtitle: "", imageUrl: "", placement: HERO, active: true };
    let blob = null; // cropped replacement photo
    let blobUrl = "";
    const m = modal({ title: existing ? "Edit banner" : "New banner", onClose: () => blobUrl && URL.revokeObjectURL(blobUrl) });
    m.body.innerHTML = `
      <div class="field"><label class="f">Photo *</label>
        <div id="prev" style="width:100%;aspect-ratio:${ASPECT};border-radius:12px;background:var(--surface);overflow:hidden;display:grid;place-items:center;color:var(--muted)"></div>
        <input type="file" id="file" accept="image/*" hidden>
        <button class="btn ghost sm" type="button" id="pick" style="margin-top:8px"><i class="ti ti-photo-plus"></i> Choose photo</button></div>
      <div class="field"><label class="f" for="b-title">Title (optional)</label><input class="in" id="b-title" value="${esc(b.title)}" maxlength="80"></div>
      <div class="field"><label class="f" for="b-sub">Subtitle (optional)</label><input class="in" id="b-sub" value="${esc(b.subtitle)}" maxlength="120"></div>
      <div class="field"><label class="f" for="b-place">Show in</label>
        <select class="in" id="b-place">${PLACEMENTS.map(([k, t]) => `<option value="${k}" ${(b.placement || HERO) === k ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
      <p class="err-line" id="berr" role="alert"></p>`;
    m.footer.innerHTML = `
      ${existing ? '<button class="btn ghost" type="button" id="del" style="color:var(--err);margin-right:auto"><i class="ti ti-trash"></i> Delete</button>' : ""}
      <button class="btn ghost" type="button" id="cancel">Close</button>
      <button class="btn" type="button" id="save">Save</button>`;

    const drawPrev = () => {
      const src = blobUrl || b.imageUrl;
      $("#prev", m.body).innerHTML = src ? `<img src="${esc(src)}" alt="" style="width:100%;height:100%;object-fit:cover">` : '<span class="hint">No photo yet.</span>';
    };
    drawPrev();
    $("#pick", m.body).onclick = () => $("#file", m.body).click();
    $("#file", m.body).onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 15 * 1024 * 1024) return toast("Photo must be under 15 MB", "err");
      try {
        blob = await cropToBanner(f);
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        blobUrl = URL.createObjectURL(blob);
        drawPrev();
      } catch (err) {
        toast(err.message || "Could not read this photo.", "err");
      }
    };
    $("#cancel", m.footer).onclick = m.close;

    const del = $("#del", m.footer);
    if (del)
      del.onclick = async () => {
        if (!(await confirmBox("Delete this banner?", { okText: "Yes, delete", danger: true }))) return;
        try {
          await deleteDoc(doc(db, "banners", existing.id));
          if (isOurs(existing.imageUrl)) deleteObject(storageRef(storage, existing.imageUrl)).catch(() => {});
          toast("Banner deleted");
          m.close();
        } catch (e) {
          toast(errMsg(e), "err");
        }
      };

    const save = $("#save", m.footer);
    save.onclick = () =>
      busy(save, async () => {
        const err = $("#berr", m.body);
        err.textContent = "";
        if (!blob && !b.imageUrl) {
          err.textContent = "Please choose a banner photo.";
          return;
        }
        try {
          let url = b.imageUrl;
          if (blob) {
            const ref = storageRef(storage, `banners/${uid()}.jpg`);
            await uploadBytes(ref, blob, { contentType: "image/jpeg" });
            url = await getDownloadURL(ref);
          }
          const ref = existing ? doc(db, "banners", existing.id) : doc(collection(db, "banners"));
          const data = {
            id: ref.id,
            title: $("#b-title", m.body).value.trim(),
            subtitle: $("#b-sub", m.body).value.trim(),
            imageUrl: url,
            placement: $("#b-place", m.body).value
          };
          if (!existing) Object.assign(data, { bgColorHex: "#E63946", active: true, order: Date.now() });
          await setDoc(ref, data, { merge: true });
          if (blob && existing && isOurs(existing.imageUrl) && existing.imageUrl !== url) deleteObject(storageRef(storage, existing.imageUrl)).catch(() => {});
          toast(existing ? "Banner updated" : "Banner added");
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
    if (row) openForm(banners.find((x) => x.id === row.dataset.id));
  });
  view.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.target.closest("input,button")) return;
    const row = e.target.closest(".row-card[data-id]");
    if (row) openForm(banners.find((x) => x.id === row.dataset.id));
  });
  view.addEventListener("change", async (e) => {
    const t = e.target;
    const id = t.dataset && t.dataset.sw;
    if (!id) return;
    try {
      await updateDoc(doc(db, "banners", id), { active: t.checked });
      toast(t.checked ? "Banner is now shown in the app" : "Banner hidden from the app");
    } catch (err) {
      t.checked = !t.checked;
      toast(errMsg(err), "err");
    }
  });

  const unsub = onSnapshot(
    collection(db, "banners"),
    (s) => {
      got = true;
      banners = s.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => (a.order || 0) - (b.order || 0));
      draw();
    },
    (err) => {
      $("#body", view).innerHTML = `<div class="empty"><i class="ti ti-alert-triangle"></i>${esc(errMsg(err))}</div>`;
    }
  );
  return () => {
    unsub();
    $$(".md-ov").forEach((o) => o.remove());
    document.body.classList.remove("noscroll");
  };
}
