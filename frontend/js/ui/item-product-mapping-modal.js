/* Admin tool: assign the Product for items that don't have one yet — a
   future/new SKU showing up in Invoice working or Credit Note Working with
   no known Product. Deliberately scoped to just those rows, not a browsable
   directory of every item ever seen: the button only appears when there's
   something new to classify, and the modal opens straight to that list. */
"use strict";

import { esc } from "../core/format.js";
import { getProduct, setProduct } from "../state/item-product-map.js";
import { toast } from "./toast.js";
import { render } from "../core/bus.js";

var KNOWN_PRODUCTS = ["GT subscription", "DMS subscription", "MT subscription", "Flo subscription", "Other modules"];

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

  function rowsHTML(filterText) {
    var ft = (filterText || "").toLowerCase();
    return items
      .filter(function (it) { return it.toLowerCase().indexOf(ft) !== -1; })
      .map(function (it) {
        return '<div class="imap-row imap-unmapped" data-item="' + esc(it) + '">' +
          '<span class="imap-name" title="' + esc(it) + '">' + esc(it) + "</span>" +
          '<input class="imap-input" list="imapProducts" placeholder="Type a product…" value="" />' +
          '<span class="imap-flag" title="No mapping yet">⚠</span>' +
          "</div>";
      }).join("") || '<div style="padding:16px;text-align:center;color:var(--ink-3)">No new items — everything\'s mapped.</div>';
  }

  wrap.innerHTML =
    '<div class="modal" role="dialog" aria-modal="true">' +
    '<div class="modal-hd"><div><h3>New items</h3>' +
    "<p>" + items.length + " item" + (items.length === 1 ? "" : "s") + " need a product assigned</p></div>" +
    '<button class="x" id="imClose" aria-label="Close">×</button></div>' +
    '<div class="modal-body">' +
    '<div class="form-note">These are item names showing up in the ledger that don\'t have a product yet — ' +
    "usually a brand new SKU. Type a product and click Save; it's remembered going forward and applied " +
    "automatically the next time that item name shows up. Leave blank if it genuinely has no product " +
    "(many one-time/setup charges don't).</div>" +
    '<datalist id="imapProducts">' + KNOWN_PRODUCTS.map(function (p) { return '<option value="' + esc(p) + '">'; }).join("") + "</datalist>" +
    (items.length > 8
      ? '<div class="toolbar" style="padding:0 0 10px;border:none;background:none">' +
        '<input type="search" id="imSearch" placeholder="Search item names…" /></div>'
      : "") +
    '<div id="imList" class="imap-list">' + rowsHTML("") + "</div>" +
    "</div>" +
    '<div class="modal-ft"><span class="err" id="imErr"></span><span class="spacer"></span>' +
    '<button class="icon-btn" id="imCancel">Close</button>' +
    '<button class="btn-primary" id="imSave">Save changes</button></div></div>';
  document.body.appendChild(wrap);

  var listEl = wrap.querySelector("#imList");
  var searchEl = wrap.querySelector("#imSearch");
  if (searchEl) searchEl.addEventListener("input", function () { listEl.innerHTML = rowsHTML(searchEl.value); });

  function close() { wrap.remove(); }
  wrap.querySelector("#imClose").addEventListener("click", close);
  wrap.querySelector("#imCancel").addEventListener("click", close);
  wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) close(); });

  wrap.querySelector("#imSave").addEventListener("click", function () {
    var rows = listEl.querySelectorAll(".imap-row");
    var changed = 0;
    rows.forEach(function (row) {
      var item = row.getAttribute("data-item");
      var typed = row.querySelector(".imap-input").value.trim();
      if (typed === "") return;   // still unmapped, nothing to save
      setProduct(item, typed);
      changed++;
    });
    if (changed) {
      toast("Saved " + changed + " item→product mapping" + (changed === 1 ? "" : "s") + ".");
      render();   // Product column reflects the new mapping immediately, not just on next tab switch
    }
    close();
  });
}
