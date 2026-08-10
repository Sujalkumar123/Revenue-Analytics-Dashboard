/* Admin tool: assign the Product for items that don't have one yet — a
   future/new SKU showing up in Invoice working or Credit Note Working with
   no known Product. Deliberately scoped to just those rows, not a browsable
   directory of every item ever seen: the button only appears when there's
   something new to classify, and the modal opens straight to that list.

   Each row commits on its own (blur or Enter) instead of requiring one big
   "Save" for the whole list — with 100+ items to classify in one sitting,
   a single save-and-close was both easy to lose progress on and gave no
   feedback about which rows had actually been saved. A row that's been
   committed stays visible with a "Saved" mark rather than disappearing, so
   there's no ambiguity about what happened when you save one. */
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

  var items = Array.from(new Set(itemNames.filter(Boolean)))
    .filter(function (it) { return getProduct(it) === null; })
    .sort();
  var saved = {};   // item -> true, once its row has been committed this session

  function remaining() { return items.filter(function (it) { return !saved[it]; }).length; }

  function datalistHTML() {
    return '<datalist id="imapProducts">' +
      listKnownProducts().map(function (p) { return '<option value="' + esc(p) + '">'; }).join("") +
      "</datalist>";
  }

  function rowHTML(it) {
    var isSaved = !!saved[it];
    return '<div class="imap-row' + (isSaved ? " imap-saved" : " imap-unmapped") + '" data-item="' + esc(it) + '">' +
      '<span class="imap-name" title="' + esc(it) + '">' + esc(it) + "</span>" +
      '<input class="imap-input" list="imapProducts" placeholder="Type a product…" value="' + esc(isSaved ? saved[it] : "") + '" />' +
      (isSaved
        ? '<span class="imap-ok" title="Saved">✓ Saved</span>'
        : '<span class="imap-flag" title="No mapping yet">⚠</span>') +
      "</div>";
  }

  function rowsHTML(filterText) {
    var ft = (filterText || "").toLowerCase();
    return items
      .filter(function (it) { return it.toLowerCase().indexOf(ft) !== -1; })
      .map(rowHTML).join("") || '<div style="padding:16px;text-align:center;color:var(--ink-3)">No items match.</div>';
  }

  function paintHeader() {
    var left = remaining();
    wrap.querySelector("#imSub").textContent = left
      ? left + " item" + (left === 1 ? "" : "s") + " still need a product"
      : "All done — every item has a product";
  }

  wrap.innerHTML =
    '<div class="modal" role="dialog" aria-modal="true">' +
    '<div class="modal-hd"><div><h3>New items</h3>' +
    '<p id="imSub">' + items.length + " item" + (items.length === 1 ? "" : "s") + " need a product assigned</p></div>" +
    '<button class="x" id="imClose" aria-label="Close">×</button></div>' +
    '<div class="modal-body">' +
    '<div class="form-note">These are item names showing up in the ledger that don\'t have a product yet — ' +
    "usually a brand new SKU. Type a product and press Enter or click away; it saves that row immediately " +
    "and it's remembered going forward. Leave blank if it genuinely has no product " +
    "(many one-time/setup charges don't).</div>" +
    datalistHTML() +
    '<div class="toolbar" style="padding:0 0 10px;border:none;background:none">' +
    (items.length > 8 ? '<input type="search" id="imSearch" placeholder="Search item names…" />' : "") +
    '<button class="icon-btn" id="imNewProduct" style="margin-left:auto">+ New product</button>' +
    "</div>" +
    '<div id="imList" class="imap-list">' + rowsHTML("") + "</div>" +
    "</div>" +
    '<div class="modal-ft"><span class="err" id="imErr"></span><span class="spacer"></span>' +
    '<button class="btn-primary" id="imDone">Done</button></div></div>';
  document.body.appendChild(wrap);

  var listEl = wrap.querySelector("#imList");
  var searchEl = wrap.querySelector("#imSearch");
  if (searchEl) searchEl.addEventListener("input", function () { listEl.innerHTML = rowsHTML(searchEl.value); });

  function commitRow(row) {
    var item = row.getAttribute("data-item");
    var input = row.querySelector(".imap-input");
    var typed = input.value.trim();
    if (typed === "" && !(item in saved)) return;         // nothing typed, nothing to do
    if (saved[item] === typed) return;                    // unchanged since last save
    setProduct(item, typed);
    saved[item] = typed;
    row.className = "imap-row imap-saved";
    var flag = row.querySelector(".imap-flag, .imap-ok");
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

  function close() { wrap.remove(); }
  wrap.querySelector("#imClose").addEventListener("click", close);
  wrap.querySelector("#imDone").addEventListener("click", close);
  wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) close(); });
}
