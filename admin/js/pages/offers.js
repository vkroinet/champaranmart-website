import { db, storage, functions, collection, onSnapshot, query, where, orderBy, limit, httpsCallable, storageRef, uploadBytes, getDownloadURL } from "../fb.js";
import { $, $$, esc, fmtDate, toast, errMsg, busy, confirmBox } from "../ui.js";

const TITLE_MAX = 65;
const BODY_MAX = 240;
const MAX_W = 1200;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "o" + Date.now() + Math.random().toString(16).slice(2));

/** Shrinks the picked photo (long side MAX_W) and returns a JPEG blob, so the notification loads fast on slow phones. */
function shrink(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_W / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read this photo."))), "image/jpeg", 0.85);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read this photo. Please choose a JPG or PNG."));
    };
    img.src = url;
  });
}

function fnErr(e) {
  const code = (e && e.code) || "";
  if (code.includes("resource-exhausted")) return "An offer was just sent. Please wait a few seconds and try again.";
  if (code.includes("not-found") && /function/i.test(e.message || "")) return "This feature is not available on the server yet.";
  return errMsg(e);
}

export function render(view) {
  let villages = [];
  let users = [];
  let history = [];
  let audience = "all"; // "all" | "some"
  let picked = new Set();
  let file = null; // shrunk photo blob
  let fileUrl = "";
  let sending = false;
  let gotVillages = false;

  view.innerHTML = `
    <div class="ph"><h1>Send offer</h1></div>
    <p class="hint" style="margin:-8px 0 16px;max-width:640px">Send a notification to your customers' phones, for example for a festival deal. Customers who switched offers off in the app are skipped.</p>
    <div class="card" style="max-width:640px;margin-bottom:18px">
      <div class="field"><label class="f" for="o-title">Title *</label><input class="in" id="o-title" maxlength="${TITLE_MAX}" placeholder="Diwali sale: 20% off on sweets" autocomplete="off">
        <div class="hint" style="text-align:right"><span id="tcount">0</span>/${TITLE_MAX}</div></div>
      <div class="field"><label class="f" for="o-body">Message *</label><textarea class="in" id="o-body" maxlength="${BODY_MAX}" placeholder="Order today and get free delivery on orders above ₹199."></textarea>
        <div class="hint" style="text-align:right"><span id="bcount">0</span>/${BODY_MAX}</div></div>
      <div class="field"><label class="f">Photo (optional)</label>
        <div id="photo"></div>
        <input type="file" id="file" accept="image/*" hidden>
        <button class="btn ghost sm" type="button" id="pick"><i class="ti ti-photo-plus"></i> Choose photo</button>
        <button class="btn ghost sm" type="button" id="unpick" style="display:none">Remove photo</button></div>
      <div class="field"><label class="f">Send to</label>
        <label class="chk" style="font-weight:500;margin-bottom:6px"><input type="radio" name="aud" value="all" checked> All villages</label>
        <label class="chk" style="font-weight:500"><input type="radio" name="aud" value="some"> Only some villages</label>
        <div id="vbox" style="display:none;margin-top:10px">
          <div style="display:flex;gap:8px;margin-bottom:6px"><button class="btn ghost sm" type="button" id="v-all">Select all</button><button class="btn ghost sm" type="button" id="v-none">Clear all</button></div>
          <div id="vlist" style="max-height:240px;overflow:auto;border:1px solid var(--border);border-radius:12px;padding:6px 12px"></div></div></div>
      <div class="card" style="background:var(--surface);margin-bottom:14px"><div class="hint" style="margin:0 0 4px;font-weight:700">Preview</div>
        <div id="prev" style="font-size:14px"></div></div>
      <div id="reach" class="hint" style="margin:0 0 10px;font-weight:600"></div>
      <p class="err-line" id="oerr" role="alert"></p>
      <button class="btn" id="send" type="button"><i class="ti ti-send"></i> Send offer</button>
    </div>
    <h2 style="font-size:17px;margin:0 0 10px">Recently sent</h2>
    <div class="list" id="hist"><div class="loading">Loading…</div></div>`;

  const reachCount = () =>
    users.filter((u) => typeof u.fcmToken === "string" && u.fcmToken && u.offersEnabled !== false && (audience === "all" || picked.has(u.villageId))).length;

  function drawVillages() {
    const box = $("#vlist", view);
    if (!gotVillages) return;
    box.innerHTML = villages.length
      ? villages
          .map((v) => `<label class="chk" style="font-weight:500;padding:5px 0"><input type="checkbox" data-v="${esc(v.id)}" ${picked.has(v.id) ? "checked" : ""}> ${esc(v.name)}${v.active === false ? ' <span class="hint" style="margin:0">(not allowed)</span>' : ""}</label>`)
          .join("")
      : '<div class="hint" style="padding:8px 0">No villages yet.</div>';
  }

  function drawMeta() {
    const title = $("#o-title", view).value.trim();
    const body = $("#o-body", view).value.trim();
    $("#tcount", view).textContent = $("#o-title", view).value.length;
    $("#bcount", view).textContent = $("#o-body", view).value.length;
    $("#prev", view).innerHTML = `<div style="display:flex;gap:10px;align-items:flex-start">
      <img src="/favicon-96.png" alt="" width="36" height="36" style="border-radius:8px;flex:none">
      <div style="min-width:0"><div style="font-weight:700;overflow-wrap:anywhere">${esc(title || "Your title")}</div>
      <div style="color:var(--muted);overflow-wrap:anywhere">${esc(body || "Your message")}</div>
      ${fileUrl ? `<img src="${esc(fileUrl)}" alt="" style="margin-top:8px;max-width:100%;max-height:160px;border-radius:10px">` : ""}</div></div>`;
    const n = reachCount();
    $("#reach", view).textContent = `This will reach about ${n} ${n === 1 ? "phone" : "phones"} right now.`;
    $("#vbox", view).style.display = audience === "some" ? "block" : "none";
    const has = !!file;
    $("#unpick", view).style.display = has ? "" : "none";
    $("#photo", view).innerHTML = has ? `<img src="${esc(fileUrl)}" alt="" style="max-width:240px;max-height:140px;border-radius:10px;margin-bottom:8px;display:block">` : "";
  }

  function drawHistory() {
    const list = $("#hist", view);
    if (!history.length) {
      list.innerHTML = `<div class="empty"><i class="ti ti-bell"></i>No offers sent yet.</div>`;
      return;
    }
    list.innerHTML = history
      .map(
        (o) => `<div class="row-card" style="cursor:default;align-items:flex-start">
        ${o.imageUrl ? `<img class="thumb" src="${esc(o.imageUrl)}" alt="" loading="lazy">` : '<div class="thumb ph"><i class="ti ti-bell"></i></div>'}
        <div style="min-width:0"><div class="t">${esc(o.title)}</div>
          <div class="s" style="white-space:normal;overflow-wrap:anywhere">${esc(o.body)}</div>
          <div class="s">${esc(fmtDate(o.sentAt))} · ${Array.isArray(o.villageIds) && o.villageIds.length ? o.villageIds.length + (o.villageIds.length === 1 ? " village" : " villages") : "All villages"}</div></div>
        <div class="r" style="text-align:right"><span class="badge b-ok">${Number(o.sent) || 0} sent</span>${Number(o.failed) ? `<div class="hint" style="margin:4px 0 0">${Number(o.failed)} failed</div>` : ""}</div></div>`
      )
      .join("");
  }

  async function send(btn) {
    if (sending) return;
    const err = $("#oerr", view);
    err.textContent = "";
    const title = $("#o-title", view).value.trim();
    const body = $("#o-body", view).value.trim();
    if (!title || !body) {
      err.textContent = "Please enter both a title and a message.";
      return;
    }
    if (audience === "some" && !picked.size) {
      err.textContent = "Choose at least one village, or select All villages.";
      return;
    }
    // Ticking every village means "everyone" (it also reaches customers with no village saved), like in the app.
    const allPicked = audience === "some" && villages.length > 0 && villages.every((v) => picked.has(v.id));
    const villageIds = audience === "all" || allPicked ? [] : [...picked];
    const n = reachCount();
    if (n === 0) {
      err.textContent = "No phone would receive this offer. Customers need the app installed and offers switched on.";
      return;
    }
    const where_ = villageIds.length ? `${villageIds.length} ${villageIds.length === 1 ? "village" : "villages"}` : "all villages";
    if (!(await confirmBox(`Send "${title}" to about ${n} ${n === 1 ? "phone" : "phones"} (${where_})? This cannot be undone.`, { okText: "Yes, send" }))) return;
    sending = true;
    try {
      await busy(btn, async () => {
        let imageUrl = "";
        if (file) {
          btn.textContent = "Uploading photo…";
          const ref = storageRef(storage, `offers/${uid()}.jpg`);
          await uploadBytes(ref, file, { contentType: "image/jpeg" });
          imageUrl = await getDownloadURL(ref);
        }
        btn.textContent = "Sending…";
        const res = await httpsCallable(functions, "sendOffer")({ title, body, imageUrl, villageIds });
        const d = res.data || {};
        toast(`Offer sent to ${d.sent || 0} of ${d.targeted || 0} phones${d.failed ? ` (${d.failed} failed)` : ""}`);
        $("#o-title", view).value = "";
        $("#o-body", view).value = "";
        file = null;
        if (fileUrl) URL.revokeObjectURL(fileUrl);
        fileUrl = "";
        drawMeta();
      });
    } catch (e) {
      err.textContent = fnErr(e);
    } finally {
      sending = false;
    }
  }

  view.addEventListener("input", (e) => {
    if (e.target.id === "o-title" || e.target.id === "o-body") drawMeta();
  });
  view.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.name === "aud") {
      audience = t.value;
      drawMeta();
    } else if (t.dataset && t.dataset.v) {
      if (t.checked) picked.add(t.dataset.v);
      else picked.delete(t.dataset.v);
      drawMeta();
    } else if (t.id === "file") {
      const f = t.files[0];
      t.value = "";
      if (!f) return;
      if (f.size > 15 * 1024 * 1024) return toast("Photo must be under 15 MB", "err");
      try {
        file = await shrink(f);
        if (fileUrl) URL.revokeObjectURL(fileUrl);
        fileUrl = URL.createObjectURL(file);
        drawMeta();
      } catch (er) {
        toast(er.message || "Could not read this photo.", "err");
      }
    }
  });
  view.addEventListener("click", (e) => {
    if (e.target.closest("#pick")) return $("#file", view).click();
    if (e.target.closest("#unpick")) {
      file = null;
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      fileUrl = "";
      return drawMeta();
    }
    if (e.target.closest("#v-all")) {
      picked = new Set(villages.map((v) => v.id));
      drawVillages();
      return drawMeta();
    }
    if (e.target.closest("#v-none")) {
      picked = new Set();
      drawVillages();
      return drawMeta();
    }
    const sb = e.target.closest("#send");
    if (sb) send(sb);
  });

  drawMeta();
  const unsubs = [
    onSnapshot(
      collection(db, "villages"),
      (s) => {
        gotVillages = true;
        villages = s.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
        picked = new Set([...picked].filter((id) => villages.some((v) => v.id === id)));
        drawVillages();
        drawMeta();
      },
      () => {}
    ),
    onSnapshot(
      query(collection(db, "users"), where("role", "==", "customer")),
      (s) => {
        users = s.docs.map((d) => d.data());
        drawMeta();
      },
      () => {}
    ),
    onSnapshot(
      query(collection(db, "offers"), orderBy("sentAt", "desc"), limit(20)),
      (s) => {
        history = s.docs.map((d) => ({ ...d.data(), id: d.id }));
        drawHistory();
      },
      (err) => {
        $("#hist", view).innerHTML = `<div class="empty"><i class="ti ti-alert-triangle"></i>${esc(errMsg(err))}</div>`;
      }
    )
  ];
  return () => {
    unsubs.forEach((u) => u());
    if (fileUrl) URL.revokeObjectURL(fileUrl);
  };
}
