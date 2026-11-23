import { db, doc, onSnapshot, setDoc } from "../fb.js";
import { $, esc, toast, errMsg, busy, confirmBox } from "../ui.js";

// settings/appUpdate: the admin's control for forcing an app update. Same fields as the app (AppUpdateSettings.kt).
// Everything is OFF until the admin switches it on: with no document, or with the switch OFF, nobody is blocked.
const ref = () => doc(db, "settings", "appUpdate");

export function render(view) {
  let filled = false;

  view.innerHTML = `
    <div class="ph"><h1>App update</h1></div>
    <p class="hint" style="margin:-8px 0 16px;max-width:640px">Make customers update the app when you choose. It is OFF until you switch it on. Turn it on only after the new version is live on Google Play. It works for app versions that already include this feature (from version code 8).</p>
    <div id="body"><div class="loading">Loading…</div></div>`;

  function draw(s) {
    $("#body", view).innerHTML = `
      <div class="card" style="max-width:640px;margin-bottom:16px">
        <label class="chk" style="margin-bottom:6px"><span class="sw"><input type="checkbox" id="u-on" ${s.forceEnabled === true ? "checked" : ""}><span></span></span><b id="u-label"></b></label>
        <p class="hint" style="margin:0 0 14px">While it is OFF nobody is ever blocked, whatever the numbers below say.</p>
        <div class="grid2">
          <div class="field"><label class="f" for="u-min">Oldest version code allowed</label><input class="in" id="u-min" inputmode="numeric" value="${s.minVersionCode > 0 ? esc(s.minVersionCode) : ""}" placeholder="e.g. 8"></div>
          <div class="field"><label class="f" for="u-latest">Newest version code on Google Play</label><input class="in" id="u-latest" inputmode="numeric" value="${s.latestVersionCode > 0 ? esc(s.latestVersionCode) : ""}" placeholder="e.g. 8"></div>
        </div>
        <div class="field"><label class="f" for="u-msg">Message for customers (optional)</label><textarea class="in" id="u-msg" rows="2" maxlength="160" placeholder="A new version of Champaran Mart is ready. Please update to keep ordering.">${esc(s.message || "")}</textarea></div>
      </div>
      <div class="card" style="max-width:640px;margin-bottom:16px;background:var(--surface)">
        <div class="hint" style="margin:0 0 6px;font-weight:700">What will happen</div>
        <div id="preview" style="white-space:pre-line;font-size:14px"></div>
      </div>
      <p class="err-line" id="uerr" role="alert"></p>
      <button class="btn" id="save" type="button"><i class="ti ti-device-floppy"></i> Save</button>`;
    renderPreview();
  }

  const num = (id) => {
    const t = ($(id, view).value || "").trim();
    return t === "" ? 0 : Number(t);
  };

  function renderPreview() {
    const on = $("#u-on", view).checked;
    const min = num("#u-min"), latest = num("#u-latest");
    $("#u-label", view).textContent = on ? "Force update is ON" : "Force update is OFF";
    const lines = [];
    if (!on) lines.push("Force update is OFF: nobody is blocked.");
    else if (!(min > 0)) lines.push("Enter the oldest version code that may still use the app.");
    else lines.push(`Apps with a version code below ${min} show "Update required" and cannot be used until they update.`);
    if (latest > 0) lines.push(`Apps below ${latest} are also offered a skippable "Update available" message.`);
    $("#preview", view).textContent = lines.join("\n");
  }

  view.addEventListener("input", (e) => {
    if (e.target.matches("#u-min, #u-latest")) renderPreview();
  });
  view.addEventListener("change", (e) => {
    if (e.target.matches("#u-on")) renderPreview();
  });

  view.addEventListener("click", (e) => {
    const btn = e.target.closest("#save");
    if (!btn) return;
    busy(btn, async () => {
      const err = $("#uerr", view);
      err.textContent = "";
      const on = $("#u-on", view).checked;
      const min = num("#u-min"), latest = num("#u-latest");
      const message = ($("#u-msg", view).value || "").trim();
      if ([min, latest].some((n) => isNaN(n) || n < 0 || !Number.isInteger(n))) {
        err.textContent = "Version codes must be whole numbers (for example 8).";
        return;
      }
      if (on && !(min > 0)) {
        err.textContent = "Enter the oldest version code allowed before switching it on.";
        return;
      }
      if (on && latest > 0 && min > latest) {
        err.textContent = "The oldest version cannot be higher than the newest version.";
        return;
      }
      if (on) {
        const ok = await confirmBox(`Every customer whose app is older than version code ${min} will be blocked until they update from Google Play. Be sure the new version is already live there.`, { okText: "Yes, force it", danger: true });
        if (!ok) return;
      }
      try {
        await setDoc(ref(), { forceEnabled: on, minVersionCode: min, latestVersionCode: latest, message, updatedAt: Date.now() });
        toast(on ? "Saved. Force update is ON." : "Saved. Force update is OFF.");
      } catch (e2) {
        err.textContent = errMsg(e2);
      }
    });
  });

  // Fill the form once; later live updates must not overwrite what the admin is typing.
  const unsub = onSnapshot(
    ref(),
    (s) => {
      if (filled) return;
      filled = true;
      draw(s.exists() ? s.data() : {});
    },
    (err) => {
      $("#body", view).innerHTML = `<div class="empty"><i class="ti ti-alert-triangle"></i>${esc(errMsg(err))}</div>`;
    }
  );
  return () => unsub();
}
