/* Admin tool: view and assign the Product for every item seen in the
   ledger — both the ones that don't have one yet (flagged, prompting
   attention) and already-mapped ones (shown with their current product,
   editable in place, in case a past classification needs correcting).
   "Unmapped only" narrows it down to just the ones that need attention
   when that's all you want to work through.

   Each row commits on its own (blur or Enter) instead of requiring one big
   "Save" for the whole list — with hundreds of items to review in one
   sitting, a single save-and-close was both easy to lose progress on and
   gave no feedback about which rows had actually changed. A row that's
   been committed this session stays visible with a "Saved" mark rather
   than disappearing. */
"use strict";

import { esc } from "../core/format.js";
import { getProduct, setProduct, listKnownProducts, addKnownProduct } from "../state/item-product-map.js";
import { toast } from "./toast.js";
import { render } from "../core/bus.js";

export function unmappedItemCount(itemNames) {
  var items = Array.from(new Set(itemNames.filter(Boolean)));
  return items.filter(function (it) { return getProduct(it) === null; }).length;
}

export function openItemProductMappingModal(itemNames) {
  var wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "itemMapModal";

  var allItems = Array.from(new Set(itemNames.filter(Boolean))).sort();
  var saved = {};        // item -> product string, for rows committed this session (drives the "Saved" mark)
  var unmappedOnly = false;

  function currentProduct(it) { return it in saved ? saved[it] : (getProduct(it) === null ? "" : getProduct(it)); }
  function isUnmapped(it) { return !(it in saved) && getProduct(it) === null; }
  function remainingUnmapped() { return allItems.filter(isUnmapped).length; }

  function datalistHTML() {
    return '<datalist id="imapProducts">' +
      listKnownProducts().map(function (p) { return '<option value="' + esc(p) + '">'; }).join("") +
      "</datalist>";
  }

  function rowHTML(it) {
    var justSaved = it in saved;
    var unmapped = isUnmapped(it);
    var cls = justSaved ? " imap-saved" : unmapped ? " imap-unmapped" : "";
    return '<div class="imap-row' + cls + '" data-item="' + esc(it) + '">' +
      '<span class="imap-name" title="' + esc(it) + '">' + esc(it) + "</span>" +
      '<input class="imap-input" list="imapProducts" placeholder="Type a product…" value="' + esc(currentProduct(it)) + '" />' +
      (justSaved ? '<span class="imap-ok" title="Saved">✓ Saved</span>'
        : unmapped ? '<span class="imap-flag" title="No mapping yet">⚠</span>'
        : '<span class="imap-mapped-tag" title="Currently mapped">mapped</span>') +
      "</div>";
  }

  function visibleItems(filterText) {
    var ft = (filterText || "").toLowerCase();
    return allItems.filter(function (it) {
      if (unmappedOnly && !isUnmapped(it)) return false;
      return it.toLowerCase().indexOf(ft) !== -1;
    });
  }
  function rowsHTML(filterText) {
    return visibleItems(filterText).map(rowHTML).join("") ||
      '<div style="padding:16px;text-align:center;color:var(--ink-3)">No items match.</div>';
  }

  function paintHeader() {
    var left = remainingUnmapped();
    wrap.querySelector("#imSub").textContent =
      allItems.length.toLocaleString("en-IN") + " item" + (allItems.length === 1 ? "" : "s") + " total" +
      (left ? " · " + left.toLocaleString("en-IN") + " unmapped" : " · all mapped");
  }

  wrap.innerHTML =
    '<div class="modal" role="dialog" aria-modal="true">' +
    '<div class="modal-hd"><div><h3>Item → Product mapping</h3>' +
    '<p id="imSub"></p></div>' +
    '<button class="x" id="imClose" aria-label="Close">×</button></div>' +
    '<div class="modal-body">' +
    '<div class="form-note">Every item name seen in the ledger, with its current product. Type a product and ' +
    "press Enter or click away to save that row — it's remembered going forward and applied automatically the " +
    "next time that item shows up. Leave blank if it genuinely has no product (many one-time/setup charges " +
    "don't). Unmapped items are flagged in amber.</div>" +
    datalistHTML() +
    '<div class="toolbar" style="padding:0 0 10px;border:none;background:none">' +
    '<input type="search" id="imSearch" placeholder="Search item names…" />' +
    '<label class="colf-item" style="width:auto;padding:6px 9px;border:1px solid var(--border);border-radius:var(--radius-sm)">' +
    '<input type="checkbox" id="imUnmappedOnly" /> Unmapped only</label>' +
    '<span style="margin-left:auto;display:flex;gap:8px">' +
    '<button class="icon-btn" id="imNewItem">+ New item</button>' +
    '<button class="icon-btn" id="imNewProduct">+ New product</button>' +
    "</span></div>" +
    '<div id="imNewItemForm" class="imap-row imap-new-form" style="display:none">' +
    '<input type="text" id="imNewItemName" class="imap-name-input" placeholder="New item name…" />' +
    '<input class="imap-input" list="imapProducts" id="imNewItemProduct" placeholder="Product (optional)…" />' +
    '<button class="btn-primary" id="imNewItemAdd">Add</button>' +
    "</div>" +
    '<div id="imList" class="imap-list">' + rowsHTML("") + "</div>" +
    "</div>" +
    '<div class="modal-ft"><span class="err" id="imErr"></span><span class="spacer"></span>' +
    '<button class="btn-primary" id="imDone">Done</button></div></div>';
  document.body.appendChild(wrap);
  paintHeader();

  var listEl = wrap.querySelector("#imList");
  var searchEl = wrap.querySelector("#imSearch");
  var unmappedOnlyEl = wrap.querySelector("#imUnmappedOnly");
  function repaint() { listEl.innerHTML = rowsHTML(searchEl.value); }
  searchEl.addEventListener("input", repaint);
  unmappedOnlyEl.addEventListener("change", function () { unmappedOnly = unmappedOnlyEl.checked; repaint(); });

  function commitRow(row) {
    var item = row.getAttribute("data-item");
    var input = row.querySelector(".imap-input");
    var typed = input.value.trim();
    var prev = currentProduct(item);
    if (typed === prev) return;   // nothing actually changed
    setProduct(item, typed);
    saved[item] = typed;
    row.className = "imap-row imap-saved";
    var flag = row.querySelector(".imap-flag, .imap-ok, .imap-mapped-tag");
    if (flag) flag.outerHTML = '<span class="imap-ok" title="Saved">✓ Saved</span>';
    paintHeader();
    render();   // Product column reflects the new mapping immediately, not just on next tab switch
  }
  listEl.addEventListener("focusout", function (e) {
    var row = e.target.closest ? e.target.closest(".imap-row") : null;
    if (row && e.target.classList.contains("imap-input")) commitRow(row);
  });
  listEl.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    var row = e.target.closest ? e.target.closest(".imap-row") : null;
    if (row && e.target.classList.contains("imap-input")) { e.preventDefault(); commitRow(row); e.target.blur(); }
  });

  wrap.querySelector("#imNewProduct").addEventListener("click", function () {
    var errEl = wrap.querySelector("#imErr");
    var name = window.prompt("New product / module name:");
    if (name === null) return;
    name = name.trim();
    if (!name) return;
    if (listKnownProducts().indexOf(name) !== -1) { errEl.textContent = "That product already exists."; return; }
    addKnownProduct(name);
    errEl.textContent = "";
    var oldList = wrap.querySelector("#imapProducts");
    if (oldList) oldList.outerHTML = datalistHTML();
    toast("Added “" + name + "” — it's available for every item now.");
  });

  /* Registering a brand new item name — one that hasn't shown up on any
     invoice/credit-note line yet — rather than waiting for it to appear.
     Once Zoho actually sends a row with this exact item name, effProduct()
     picks it up automatically since this writes to the same override store
     a normal row-save does. Form stays open after each Add so several new
     SKUs can be registered back to back without re-opening it each time. */
  var newItemForm = wrap.querySelector("#imNewItemForm");
  wrap.querySelector("#imNewItem").addEventListener("click", function () {
    var showing = newItemForm.style.display !== "none";
    newItemForm.style.display = showing ? "none" : "flex";
    if (!showing) wrap.querySelector("#imNewItemName").focus();
  });
  function addNewItem() {
    var errEl = wrap.querySelector("#imErr");
    var nameEl = wrap.querySelector("#imNewItemName");
    var prodEl = wrap.querySelector("#imNewItemProduct");
    var name = nameEl.value.trim();
    if (!name) { errEl.textContent = "Item name is required."; return; }
    var exists = allItems.some(function (it) { return it.toLowerCase() === name.toLowerCase(); });
    if (exists) { errEl.textContent = "That item already exists — find it in the list below to edit its product."; return; }
    var product = prodEl.value.trim();
    setProduct(name, product);
    saved[name] = product;
    allItems.push(name);
    allItems.sort();
    errEl.textContent = "";
    nameEl.value = ""; prodEl.value = ""; nameEl.focus();
    repaint();
    paintHeader();
    render();
    toast("Added “" + name + "”.");
  }
  wrap.querySelector("#imNewItemAdd").addEventListener("click", addNewItem);
  newItemForm.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addNewItem(); } });

  function close() { wrap.remove(); }
  wrap.querySelector("#imClose").addEventListener("click", close);
  wrap.querySelector("#imDone").addEventListener("click", close);
  wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) close(); });
}
