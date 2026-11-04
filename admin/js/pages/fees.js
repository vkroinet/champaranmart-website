import { db, doc, onSnapshot, setDoc } from "../fb.js";
import { $, esc, toast, errMsg, busy } from "../ui.js";

// Same defaults as the app (FeeSettings.kt). They apply until the admin saves their own.
const DEFAULTS = { deliveryFee: 25, freeDeliveryAbove: 99, handlingFee: 5, expressFee: 30, expressEnabled: true };
const ref = () => doc(db, "settings", "fees");

export function render(view) {
  let filled = false;
  let saved = { ...DEFAULTS };

  view.innerHTML = `
    <div class="ph"><h1>Delivery &amp; Fees</h1></div>
    <p class="hint" style="margin:-8px 0 16px;max-width:640px">Customers see these charges in their cart and on the bill. Changes apply to new orders straight away; orders already placed keep the fees they were charged. Enter 0 to switch a fee off.</p>
    <div id="body"><div class="loading">Loading fees…</div></div>`;

  function draw(f) {
    $("#body", view).innerHTML = `
      <div class="card" style="max-width:640px;margin-bottom:16px">
        <h2 style="font-size:17px;margin:0 0 12px">Delivery fee</h2>
        <div class="grid2">
          <div class="field"><label class="f" for="f-del">Delivery fee (₹)</label><input class="in" id="f-del" inputmode="decimal" value="${esc(f.deliveryFee)}"></div>
          <div class="field"><label class="f" for="f-free">Free delivery from (₹)</label><input class="in" id="f-free" inputmode="decimal" value="${esc(f.freeDeliveryAbove)}"></div>
        </div>
      </div>
      <div class="card" style="max-width:640px;margin-bottom:16px">
        <h2 style="font-size:17px;margin:0 0 12px">Handling fee</h2>
        <div class="field" style="max-width:260px"><label class="f" for="f-hand">Handling fee per order (₹)</label><input class="in" id="f-hand" inputmode="decimal" value="${esc(f.handlingFee)}"></div>
      </div>
      <div class="card" style="max-width:640px;margin-bottom:16px">
        <h2 style="font-size:17px;margin:0 0 4px">Express delivery (30-45 min)</h2>
        <p class="hint" style="margin:0 0 12px">Customers can pick Express at checkout. Its fee replaces the normal delivery fee and is always charged (never free). Works with COD and UPI, in every village.</p>
        <label class="chk" style="margin-bottom:14px"><span class="sw"><input type="checkbox" id="f-exp-on" ${f.expressEnabled ? "checked" : ""}><span></span></span><span id="exp-label"></span></label>
        <div class="field" style="max-width:260px"><label class="f" for="f-exp">Express fee (₹)</label><input class="in" id="f-exp" inputmode="decimal" value="${esc(f.expressFee)}"></div>
      </div>
      <div class="card" style="max-width:640px;margin-bottom:16px;background:var(--surface)">
        <div class="hint" style="margin:0 0 6px;font-weight:700">What customers will see</div>
        <div id="preview" style="white-space:pre-line;font-size:14px"></div>
      </div>
      <p class="err-line" id="ferr" role="alert"></p>
      <button class="btn" id="save" type="button"><i class="ti ti-device-floppy"></i> Save fees</button>`;
    renderLabel();
    renderPreview();
  }

  const val = (id) => {
    const s = ($(id, view).value || "").trim();
    return s === "" ? null : Number(s);
  };
  const fmt = (n) => "₹" + n;

  function renderLabel() {
    const on = $("#f-exp-on", view).checked;
    $("#exp-label", view).textContent = on ? "Express delivery is ON" : "Express delivery is OFF";
  }

  function renderPreview() {
    const del = val("#f-del"), free = val("#f-free"), hand = val("#f-hand"), exp = val("#f-exp");
    const on = $("#f-exp-on", view).checked;
    const lines = [];
    if (del != null && free != null && !isNaN(del) && !isNaN(free))
      lines.push(del > 0 ? `Delivery: ${fmt(del)} if the cart is below ${fmt(free)}, free from ${fmt(free)} up.` : "Delivery: no delivery fee.");
    if (hand != null && !isNaN(hand)) lines.push(hand > 0 ? `Handling: ${fmt(hand)} on every order.` : "Handling: no handling fee.");
    if (!on) lines.push("Express: switched OFF. Customers only see standard delivery.");
    else if (exp != null && !isNaN(exp)) lines.push(`Express: ${fmt(exp)} delivery fee, always.`);
    $("#preview", view).textContent = lines.join("\n");
  }

  view.addEventListener("input", (e) => {
    if (e.target.matches(".in")) renderPreview();
  });

  view.addEventListener("change", async (e) => {
    if (!e.target.matches("#f-exp-on")) return;
    const box = e.target;
    const on = box.checked;
    renderLabel();
    renderPreview();
    // The switch applies at once, like in the app.
    try {
      await setDoc(ref(), { expressEnabled: on }, { merge: true });
      saved.expressEnabled = on;
      toast(on ? "Express delivery ON" : "Express delivery OFF");
    } catch (err) {
      box.checked = saved.expressEnabled;
      renderLabel();
      renderPreview();
      toast(errMsg(err), "err");
    }
  });

  view.addEventListener("click", (e) => {
    const btn = e.target.closest("#save");
    if (!btn) return;
    busy(btn, async () => {
      const err = $("#ferr", view);
      err.textContent = "";
      const vals = [val("#f-del"), val("#f-free"), val("#f-hand"), val("#f-exp")];
      if (vals.some((v) => v == null || isNaN(v))) {
        err.textContent = "Enter an amount in every field (enter 0 to switch a fee off).";
        return;
      }
      if (vals.some((v) => v < 0)) {
        err.textContent = "Amounts cannot be negative.";
        return;
      }
      const [deliveryFee, freeDeliveryAbove, handlingFee, expressFee] = vals;
      const expressEnabled = $("#f-exp-on", view).checked;
      try {
        await setDoc(ref(), { deliveryFee, freeDeliveryAbove, handlingFee, expressFee, expressEnabled }, { merge: true });
        saved = { deliveryFee, freeDeliveryAbove, handlingFee, expressFee, expressEnabled };
        toast("Fees saved");
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
      saved = { ...DEFAULTS, ...(s.exists() ? s.data() : {}) };
      draw(saved);
    },
    (err) => {
      $("#body", view).innerHTML = `<div class="empty"><i class="ti ti-alert-triangle"></i>${esc(errMsg(err))}</div>`;
    }
  );
  return () => unsub();
}
