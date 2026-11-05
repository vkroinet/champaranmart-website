import {
  db, storage, collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc, increment, query, orderBy, storageRef, uploadBytes, getDownloadURL, deleteObject
} from "../fb.js";
import { $, $$, esc, money, modal, confirmBox, toast, errMsg, busy, num, toDateInput, fromDateInput } from "../ui.js";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "v" + Date.now() + Math.random().toString(16).slice(2));
const totalStock = (p) => (p.variants && p.variants.length ? p.variants.reduce((a, v) => a + (v.stock || 0), 0) : p.stock || 0);

async function uploadImage(file) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const ref = storageRef(storage, `products/${uid()}.${ext}`);
  await uploadBytes(ref, file, { contentType: file.type || "image/jpeg" });
  return getDownloadURL(ref);
}

/** Best effort: removes a picture we uploaded; never blocks the delete. */
async function removeImage(url) {
  if (!url || !url.includes("/o/products%2F")) return;
  try {
    await deleteObject(storageRef(storage, url));
  } catch (e) {
    /* already gone */
  }
}

export function render(view) {
  let products = [];
  let categories = [];
  let search = "";
  let catFilter = "";
  let stockFilter = "";
  let sortBy = "";
  const DAY = 24 * 60 * 60 * 1000;

  view.innerHTML = `
    <div class="ph"><h1>Products</h1><div class="sp"></div><button class="btn" id="add" type="button"><i class="ti ti-plus"></i> New product</button></div>
    <div class="toolbar">
      <input class="in" id="q" type="search" placeholder="Name, brand or SKU" aria-label="Search products">
      <select class="in" id="cf" style="max-width:200px" aria-label="Category"><option value="">All categories</option></select>
      <select class="in" id="sf" style="max-width:170px" aria-label="Stock"><option value="">All</option><option value="low">Low stock</option><option value="out">Out of stock</option><option value="off">Inactive (hidden)</option></select>
      <select class="in" id="so" style="max-width:170px" aria-label="Sort"><option value="">Default order</option><option value="az">A to Z</option><option value="za">Z to A</option><option value="7d">Last 7 days</option><option value="1m">Last 1 month</option><option value="exp">Expiry date</option></select>
    </div>
    <div class="list" id="list"><div class="loading">Loading products…</div></div>`;

  const catName = (id) => (categories.find((c) => c.id === id) || {}).name || "";

  function drawList() {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    const rows = products
      .filter((p) => {
        if (sortBy === "7d" && now - (p.createdAt || 0) > 7 * DAY) return false;
        if (sortBy === "1m" && now - (p.createdAt || 0) > 30 * DAY) return false;
        if (sortBy === "exp" && !(p.expiryDate > 0)) return false;
        if (q && !`${p.name} ${p.brand} ${p.sku}`.toLowerCase().includes(q)) return false;
        if (catFilter && ![p.categoryId, ...(p.extraCategoryIds || [])].includes(catFilter)) return false;
        const s = totalStock(p);
        if (stockFilter === "low") return p.active !== false && s > 0 && s <= 5;
        if (stockFilter === "out") return s <= 0;
        if (stockFilter === "off") return p.active === false;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "az") return (a.name || "").localeCompare(b.name || "");
        if (sortBy === "za") return (b.name || "").localeCompare(a.name || "");
        if (sortBy === "exp") return (a.expiryDate || 0) - (b.expiryDate || 0);
        return (a.displayOrder || 0) - (b.displayOrder || 0) || (a.name || "").localeCompare(b.name || "");
      });
    const list = $("#list", view);
    if (!rows.length) {
      list.innerHTML = `<div class="empty"><i class="ti ti-package-off"></i>No products found.</div>`;
      return;
    }
    list.innerHTML = rows
      .map((p) => {
        const s = totalStock(p);
        const img = p.imageUrl || (p.imageUrls || [])[0];
        return `<div class="row-card" data-id="${esc(p.id)}" tabindex="0" role="button">
        ${img ? `<img class="thumb" src="${esc(img)}" alt="" loading="lazy">` : '<div class="thumb ph"><i class="ti ti-photo"></i></div>'}
        <div><div class="t">${esc(p.name)} <span class="muted" style="font-weight:500">${esc(p.unit)}</span></div>
          <div class="s">${esc(catName(p.categoryId) || "No category")}${p.brand ? " · " + esc(p.brand) : ""}${p.variants && p.variants.length > 1 ? ` · ${p.variants.length} sizes` : ""}</div></div>
        <div class="r"><b>${money(p.price)}</b>${p.mrp > p.price ? ` <s class="muted">${money(p.mrp)}</s>` : ""}
          <span class="badge ${s <= 0 ? "b-err" : s <= 5 ? "b-warn" : "b-ok"}">Stock ${s}</span>
          ${p.active === false ? '<span class="badge b-muted">Inactive</span>' : ""}</div></div>`;
      })
      .join("");
  }

  function drawCatFilter() {
    const sel = $("#cf", view);
    sel.innerHTML =
      `<option value="">All categories</option>` +
      categories.map((c) => `<option value="${esc(c.id)}" ${c.id === catFilter ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  }

  function openForm(existing) {
    const p = existing ? JSON.parse(JSON.stringify(existing)) : { active: true, price: "", mrp: "", stock: 0, variants: [], imageUrls: [] };
    const hadVariants = (p.variants || []).length > 1;
    // images: first is the main one. Keep as [{url} | {file, preview}]
    let imgs = (p.imageUrls && p.imageUrls.length ? p.imageUrls : p.imageUrl ? [p.imageUrl] : []).map((u) => ({ url: u }));
    const removed = [];
    let extra = hadVariants ? p.variants.slice(1).map((v) => ({ ...v })) : [];

    const m = modal({ title: existing ? "Edit product" : "New product", wide: true });
    const catOpts = categories.map((c) => `<option value="${esc(c.id)}" ${p.categoryId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("");
    m.body.innerHTML = `
      <form id="pf" novalidate>
        <div class="sec-h">Photos</div>
        <div class="imgs" id="imgs"></div>
        <input type="file" id="file" accept="image/*" multiple hidden>
        <button class="btn ghost sm" type="button" id="pick"><i class="ti ti-photo-plus"></i> Add photos</button>
        <div class="hint">The first photo is the main photo.</div>

        <div class="sec-h">Basic</div>
        <div class="field"><label class="f" for="f-name">Name *</label><input class="in" id="f-name" value="${esc(p.name)}" maxlength="120"></div>
        <div class="field"><label class="f" for="f-desc">Description</label><textarea class="in" id="f-desc">${esc(p.description)}</textarea></div>
        <div class="grid2">
          <div class="field"><label class="f" for="f-unit">Unit (e.g. 500 g) *</label><input class="in" id="f-unit" value="${esc(p.unit)}"></div>
          <div class="field"><label class="f" for="f-price">Price (₹) *</label><input class="in" id="f-price" inputmode="decimal" value="${esc(p.price)}"></div>
          <div class="field"><label class="f" for="f-mrp">MRP (₹)</label><input class="in" id="f-mrp" inputmode="decimal" value="${esc(p.mrp || "")}"></div>
          <div class="field"><label class="f" for="f-buy">Buying price (₹)</label><input class="in" id="f-buy" inputmode="decimal" value="${esc(p.buyingPrice || "")}"></div>
          <div class="field"><label class="f" for="f-stock">Stock *</label><input class="in" id="f-stock" inputmode="numeric" value="${esc(hadVariants ? p.variants[0].stock : p.stock || 0)}"></div>
          <div class="field"><label class="f" for="f-order">Display order</label><input class="in" id="f-order" inputmode="numeric" value="${esc(p.displayOrder || 0)}"></div>
        </div>

        <div class="sec-h">Category</div>
        <div class="field"><label class="f" for="f-cat">Main category *</label>
          <select class="in" id="f-cat"><option value="">Select</option>${catOpts}</select></div>
        <div class="field"><label class="f">Also show in these categories</label><div class="catpick" id="extra-cats"></div></div>

        <div class="sec-h">More details</div>
        <div class="grid2">
          <div class="field"><label class="f" for="f-brand">Brand</label><input class="in" id="f-brand" value="${esc(p.brand)}"></div>
          <div class="field"><label class="f" for="f-sku">SKU</label><input class="in" id="f-sku" value="${esc(p.sku)}"></div>
          <div class="field"><label class="f" for="f-exp">Expiry date</label><input class="in" id="f-exp" type="date" value="${toDateInput(p.expiryDate)}"></div>
        </div>
        <div class="grid2">
          <div class="field"><label class="f" for="f-a1n">Attribute 1 name</label><input class="in" id="f-a1n" value="${esc(p.attribute1Name)}" placeholder="e.g. Type"></div>
          <div class="field"><label class="f" for="f-a1v">Attribute 1 value</label><input class="in" id="f-a1v" value="${esc(p.attribute1Value)}"></div>
          <div class="field"><label class="f" for="f-a2n">Attribute 2 name</label><input class="in" id="f-a2n" value="${esc(p.attribute2Name)}"></div>
          <div class="field"><label class="f" for="f-a2v">Attribute 2 value</label><input class="in" id="f-a2v" value="${esc(p.attribute2Value)}"></div>
        </div>
        <div style="display:flex;gap:22px;flex-wrap:wrap;margin-bottom:8px">
          <label class="chk"><input type="checkbox" id="f-best" ${p.bestSeller ? "checked" : ""}> Best seller</label>
          <label class="chk"><input type="checkbox" id="f-hot" ${p.hotDeal ? "checked" : ""}> Hot deal</label>
          <label class="chk"><input type="checkbox" id="f-act" ${p.active !== false ? "checked" : ""}> Active (visible)</label>
        </div>

        <div class="sec-h">More sizes (variants)</div>
        <div class="hint" style="margin:0 0 8px">The unit, price and stock above are the first size. Add other sizes here.</div>
        <div id="vars"></div>
        <button class="btn ghost sm" type="button" id="addv"><i class="ti ti-plus"></i> Add size</button>
        <p class="err-line" id="ferr" role="alert"></p>
      </form>`;
    m.footer.innerHTML = `
      ${existing ? '<button class="btn ghost" type="button" id="del" style="color:var(--err);margin-right:auto"><i class="ti ti-trash"></i> Delete</button>' : ""}
      <button class="btn ghost" type="button" id="cancel">Close</button>
      <button class="btn" type="button" id="save">Save</button>`;

    const extraSet = new Set(p.extraCategoryIds || []);
    function drawExtraCats() {
      const main = $("#f-cat", m.body).value;
      $("#extra-cats", m.body).innerHTML = categories
        .filter((c) => c.id !== main)
        .map((c) => `<label class="chk"><input type="checkbox" value="${esc(c.id)}" ${extraSet.has(c.id) ? "checked" : ""}> ${esc(c.name)}</label>`)
        .join("") || '<span class="hint">No other categories.</span>';
    }
    drawExtraCats();
    $("#f-cat", m.body).onchange = drawExtraCats;
    $("#extra-cats", m.body).onchange = (e) => {
      if (e.target.checked) extraSet.add(e.target.value);
      else extraSet.delete(e.target.value);
    };

    function drawImgs() {
      $("#imgs", m.body).innerHTML = imgs
        .map(
          (im, i) => `<div class="im"><img src="${esc(im.url || im.preview)}" alt="">${i === 0 ? "<em>Main</em>" : ""}<button type="button" data-rm="${i}" aria-label="Remove">×</button></div>`
        )
        .join("");
    }
    drawImgs();
    $("#imgs", m.body).onclick = (e) => {
      const b = e.target.closest("[data-rm]");
      if (!b) return;
      const [gone] = imgs.splice(Number(b.dataset.rm), 1);
      if (gone.url) removed.push(gone.url);
      drawImgs();
    };
    $("#pick", m.body).onclick = () => $("#file", m.body).click();
    $("#file", m.body).onchange = (e) => {
      [...e.target.files].forEach((f) => {
        if (f.size > 8 * 1024 * 1024) return toast(`${f.name} is larger than 8 MB`, "err");
        imgs.push({ file: f, preview: URL.createObjectURL(f) });
      });
      e.target.value = "";
      drawImgs();
    };

    function drawVars() {
      $("#vars", m.body).innerHTML = extra
        .map(
          (v, i) => `<div class="vrow" data-i="${i}">
          <input class="in" data-k="label" placeholder="Size (e.g. 1 kg)" value="${esc(v.label)}" aria-label="Size">
          <input class="in" data-k="price" inputmode="decimal" placeholder="Price" value="${esc(v.price || "")}" aria-label="Price">
          <input class="in" data-k="mrp" inputmode="decimal" placeholder="MRP" value="${esc(v.mrp || "")}" aria-label="MRP">
          <input class="in" data-k="stock" inputmode="numeric" placeholder="Stock" value="${esc(v.stock ?? "")}" aria-label="Stock">
          <button class="icon-btn" type="button" data-rv="${i}" aria-label="Remove size"><i class="ti ti-trash"></i></button></div>`
        )
        .join("");
    }
    drawVars();
    $("#vars", m.body).oninput = (e) => {
      const row = e.target.closest(".vrow");
      if (row && e.target.dataset.k) extra[Number(row.dataset.i)][e.target.dataset.k] = e.target.value;
    };
    $("#vars", m.body).onclick = (e) => {
      const b = e.target.closest("[data-rv]");
      if (!b) return;
      extra.splice(Number(b.dataset.rv), 1);
      drawVars();
    };
    $("#addv", m.body).onclick = () => {
      extra.push({ id: uid(), label: "", price: "", mrp: "", stock: "" });
      drawVars();
    };

    $("#cancel", m.footer).onclick = m.close;

    const del = $("#del", m.footer);
    if (del)
      del.onclick = async () => {
        if (!(await confirmBox(`Delete "${p.name}" permanently?`, { okText: "Yes, delete", danger: true }))) return;
        try {
          await deleteDoc(doc(db, "products", p.id));
          [p.imageUrl, ...(p.imageUrls || [])].forEach(removeImage);
          toast("Product deleted");
          m.close();
        } catch (e) {
          toast(errMsg(e), "err");
        }
      };

    const save = $("#save", m.footer);
    save.onclick = () =>
      busy(save, async () => {
        const err = $("#ferr", m.body);
        const fail = (t) => {
          err.textContent = t;
        };
        fail("");
        const name = $("#f-name", m.body).value.trim();
        const unit = $("#f-unit", m.body).value.trim();
        const price = num($("#f-price", m.body).value, NaN);
        const stock = parseInt($("#f-stock", m.body).value || "0", 10);
        const categoryId = $("#f-cat", m.body).value;
        if (!name) return fail("Enter the product name.");
        if (!unit) return fail("Enter the unit (e.g. 500 g).");
        if (!(price > 0)) return fail("Enter a valid price.");
        if (!(stock >= 0)) return fail("Enter a valid stock quantity.");
        if (!categoryId) return fail("Select a category.");
        const mrp = num($("#f-mrp", m.body).value, price) || price;

        const built = [];
        for (const [i, v] of extra.entries()) {
          const vp = num(v.price, NaN);
          const vs = parseInt(v.stock === "" || v.stock == null ? "0" : v.stock, 10);
          if (!String(v.label).trim()) return fail(`Enter a name for size ${i + 2}.`);
          if (!(vp > 0)) return fail(`Enter a valid price for '${v.label}'.`);
          if (!(vs >= 0)) return fail(`Enter a valid stock quantity for '${v.label}'.`);
          built.push({ id: v.id || uid(), label: String(v.label).trim(), price: vp, mrp: num(v.mrp, vp) || vp, stock: vs });
        }
        const variants = built.length
          ? [{ id: (hadVariants && p.variants[0].id) || uid(), label: unit, price, mrp, stock }, ...built]
          : [];

        save.textContent = "Uploading photos…";
        const urls = [];
        try {
          for (const im of imgs) urls.push(im.url || (await uploadImage(im.file)));
        } catch (e) {
          return fail("Photo upload failed: " + errMsg(e));
        }

        const ref = existing ? doc(db, "products", p.id) : doc(collection(db, "products"));
        const data = {
          id: ref.id,
          name,
          description: $("#f-desc", m.body).value.trim(),
          unit,
          price,
          mrp,
          buyingPrice: num($("#f-buy", m.body).value, 0),
          brand: $("#f-brand", m.body).value.trim(),
          sku: $("#f-sku", m.body).value.trim(),
          expiryDate: fromDateInput($("#f-exp", m.body).value),
          attribute1Name: $("#f-a1n", m.body).value.trim(),
          attribute1Value: $("#f-a1v", m.body).value.trim(),
          attribute2Name: $("#f-a2n", m.body).value.trim(),
          attribute2Value: $("#f-a2v", m.body).value.trim(),
          categoryId,
          extraCategoryIds: [...extraSet].filter((id) => id !== categoryId),
          stock,
          displayOrder: parseInt($("#f-order", m.body).value || "0", 10) || 0,
          imageUrl: urls[0] || "",
          imageUrls: urls,
          active: $("#f-act", m.body).checked,
          bestSeller: $("#f-best", m.body).checked,
          hotDeal: $("#f-hot", m.body).checked,
          variants
        };
        if (!existing) data.createdAt = Date.now();
        try {
          await setDoc(ref, data, { merge: true });
          removed.forEach(removeImage);
          toast(existing ? "Product updated" : "Product added");
          m.close();
        } catch (e) {
          fail(errMsg(e));
        }
      });
  }

  view.addEventListener("click", (e) => {
    if (e.target.closest("#add")) return openForm(null);
    const row = e.target.closest(".row-card[data-id]");
    if (row) openForm(products.find((p) => p.id === row.dataset.id));
  });
  view.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const row = e.target.closest(".row-card[data-id]");
    if (row) openForm(products.find((p) => p.id === row.dataset.id));
  });
  $("#q", view).oninput = (e) => {
    search = e.target.value;
    drawList();
  };
  // Picking a filter empties the search box first, otherwise the old text plus the new filter shows a blank list.
  const clearSearch = () => {
    search = "";
    $("#q", view).value = "";
  };
  $("#cf", view).onchange = (e) => {
    clearSearch();
    catFilter = e.target.value;
    drawList();
  };
  $("#sf", view).onchange = (e) => {
    clearSearch();
    stockFilter = e.target.value;
    drawList();
  };
  $("#so", view).onchange = (e) => {
    clearSearch();
    sortBy = e.target.value;
    drawList();
  };

  const unsubC = onSnapshot(collection(db, "categories"), (s) => {
    categories = s.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => (a.order || 0) - (b.order || 0));
    drawCatFilter();
    drawList();
  });
  const unsubP = onSnapshot(
    collection(db, "products"),
    (s) => {
      products = s.docs.map((d) => ({ ...d.data(), id: d.id }));
      drawList();
    },
    (err) => {
      $("#list", view).innerHTML = `<div class="empty"><i class="ti ti-alert-triangle"></i>${esc(errMsg(err))}</div>`;
    }
  );
  return () => {
    unsubC();
    unsubP();
    $$(".md-ov").forEach((o) => o.remove());
    document.body.classList.remove("noscroll");
  };
}
