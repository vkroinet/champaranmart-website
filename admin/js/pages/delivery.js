import { db, functions, collection, onSnapshot, query, where, httpsCallable } from "../fb.js";
import { $, $$, esc, modal, confirmBox, toast, errMsg, busy } from "../ui.js";

const call = (name, data) => httpsCallable(functions, name)(data);
const OPEN = ["placed", "packed", "out_for_delivery"];
const emailOk = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** Cloud Function errors arrive as "functions/<code>" with the server's own sentence as the message. */
function fnErr(e) {
  const code = (e && e.code) || "";
  if (code.includes("not-found") && /function/i.test(e.message || "")) return "This feature is not available on the server yet.";
  if (code.includes("internal") && (e.message || "").toLowerCase() === "internal") return "Server problem. Please try again.";
  return errMsg(e);
}

export function render(view) {
  let boys = [];
  let active = new Map(); // agent uid -> number of orders still to deliver
  let got = false;

  view.innerHTML = `
    <div class="ph"><h1>Delivery boys</h1><div class="sp"></div><button class="btn" id="add" type="button"><i class="ti ti-plus"></i> New delivery boy</button></div>
    <p class="hint" style="margin:-8px 0 16px;max-width:640px">Delivery boys log in to the app with the email and password you set here. You can then assign orders to them from the Orders page.</p>
    <div class="list" id="list"><div class="loading">Loading delivery boys…</div></div>`;

  function draw() {
    if (!got) return;
    const list = $("#list", view);
    if (!boys.length) {
      list.innerHTML = `<div class="empty"><i class="ti ti-motorbike"></i>No delivery boys yet. Add your first one.</div>`;
      return;
    }
    list.innerHTML = boys
      .map((b) => {
        const n = active.get(b.id) || 0;
        return `<div class="row-card" data-id="${esc(b.id)}" tabindex="0" role="button">
        <div style="width:40px;height:40px;border-radius:12px;background:var(--surface);display:grid;place-items:center;flex:none"><i class="ti ti-motorbike"></i></div>
        <div><div class="t">${esc(b.name || "-")}</div><div class="s">${esc(b.phone || "No phone")}${b.email ? " · " + esc(b.email) : ""}</div></div>
        <div class="r">${n ? `<span class="badge b-warn">${n} to deliver</span>` : '<span class="badge b-muted">Free</span>'}</div></div>`;
      })
      .join("");
  }

  function openForm(existing) {
    const m = modal({ title: existing ? "Edit delivery boy" : "New delivery boy" });
    m.body.innerHTML = `
      <div class="field"><label class="f" for="d-name">Name *</label><input class="in" id="d-name" value="${esc(existing ? existing.name : "")}" maxlength="60" autocomplete="off"></div>
      <div class="field"><label class="f" for="d-phone">Phone</label><input class="in" id="d-phone" inputmode="numeric" value="${esc(existing ? existing.phone : "")}" maxlength="15" autocomplete="off"></div>
      ${
        existing
          ? `<div class="field"><label class="f">Login email</label><div class="in" style="display:flex;align-items:center;opacity:.8">${esc(existing.email || "-")}</div><div class="hint">The email cannot be changed.</div></div>
             <div class="field"><label class="f" for="d-pass">New password (optional)</label><input class="in" id="d-pass" type="text" placeholder="Leave empty to keep the current password" autocomplete="new-password"><div class="hint">At least 6 characters.</div></div>`
          : `<div class="field"><label class="f" for="d-email">Login email *</label><input class="in" id="d-email" type="email" autocomplete="off"></div>
             <div class="field"><label class="f" for="d-pass">Password *</label><input class="in" id="d-pass" type="text" autocomplete="new-password"><div class="hint">At least 6 characters. Tell the delivery boy this password; they use it to log in to the app.</div></div>`
      }
      <p class="err-line" id="derr" role="alert"></p>`;
    m.footer.innerHTML = `
      ${existing ? '<button class="btn ghost" type="button" id="del" style="color:var(--err);margin-right:auto"><i class="ti ti-trash"></i> Delete</button>' : ""}
      <button class="btn ghost" type="button" id="cancel">Close</button>
      <button class="btn" type="button" id="save">${existing ? "Save" : "Create account"}</button>`;
    setTimeout(() => $("#d-name", m.body).focus(), 50);
    $("#cancel", m.footer).onclick = m.close;

    const del = $("#del", m.footer);
    if (del)
      del.onclick = async () => {
        const n = active.get(existing.id) || 0;
        if (n) {
          toast(`${existing.name} still has ${n} order${n === 1 ? "" : "s"} to deliver. Give them to someone else first.`, "err");
          return;
        }
        if (!(await confirmBox(`Delete ${existing.name}? Their login will stop working. Past orders keep their name.`, { okText: "Yes, delete", danger: true }))) return;
        try {
          await busy(del, () => call("deleteDeliveryAccount", { uid: existing.id }));
          toast("Delivery boy deleted");
          m.close();
        } catch (e) {
          toast(fnErr(e), "err");
        }
      };

    const save = $("#save", m.footer);
    save.onclick = () =>
      busy(save, async () => {
        const err = $("#derr", m.body);
        err.textContent = "";
        const name = $("#d-name", m.body).value.trim();
        const phone = $("#d-phone", m.body).value.trim();
        const pass = $("#d-pass", m.body).value;
        if (!name) {
          err.textContent = "Please enter the name.";
          return;
        }
        try {
          if (existing) {
            if (pass && pass.length < 6) {
              err.textContent = "The new password must be at least 6 characters.";
              return;
            }
            await call("updateDeliveryAccount", { uid: existing.id, name, phone, newPassword: pass });
            toast("Delivery boy updated");
          } else {
            const email = $("#d-email", m.body).value.trim();
            if (!emailOk(email)) {
              err.textContent = "Please enter a valid email.";
              return;
            }
            if (pass.length < 6) {
              err.textContent = "The password must be at least 6 characters.";
              return;
            }
            await call("createDeliveryAccount", { name, phone, email, password: pass });
            toast("Delivery account created");
          }
          m.close();
        } catch (e) {
          err.textContent = fnErr(e);
        }
      });
  }

  view.addEventListener("click", (e) => {
    if (e.target.closest("#add")) return openForm(null);
    const row = e.target.closest(".row-card[data-id]");
    if (row) openForm(boys.find((b) => b.id === row.dataset.id));
  });
  view.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.target.closest("input,button")) return;
    const row = e.target.closest(".row-card[data-id]");
    if (row) openForm(boys.find((b) => b.id === row.dataset.id));
  });

  const unsubs = [
    onSnapshot(
      query(collection(db, "users"), where("role", "==", "delivery")),
      (s) => {
        got = true;
        boys = s.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
        draw();
      },
      (err) => {
        $("#list", view).innerHTML = `<div class="empty"><i class="ti ti-alert-triangle"></i>${esc(errMsg(err))}</div>`;
      }
    ),
    onSnapshot(
      query(collection(db, "orders"), where("status", "in", OPEN)),
      (s) => {
        active = new Map();
        s.docs.forEach((d) => {
          const o = d.data();
          if (o.paymentStatus === "pending" || o.paymentStatus === "failed") return; // unpaid online orders are not real orders yet
          if (o.deliveryAgentId) active.set(o.deliveryAgentId, (active.get(o.deliveryAgentId) || 0) + 1);
        });
        draw();
      },
      () => {}
    )
  ];
  return () => {
    unsubs.forEach((u) => u());
    $$(".md-ov").forEach((o) => o.remove());
    document.body.classList.remove("noscroll");
  };
}
