/* Admin tool: view/assign the Product for every distinct item name seen in
   the current ledger (Invoice working or Credit Note Working). Exists for
   exactly the case described when this was built — a future item (e.g. a
   brand new product's SKU) shows up with no known Product, and an admin
   needs a way to assign one without editing code. */
"use strict";

import { esc } from "../core/format.js";
import { getProduct, setProduct, clearOverride } from "../state/item-product-map.js";
import { toast } from "./toast.js";

var KNOWN_PRODUCTS = ["GT subscription", "DMS subscription", "MT subscription", "Flo subscription", "Other modules"];

export function openItemProductMappingModal(itemNames) {
  var wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "itemMapModal";

  var items = Array.from(new Set(itemNames.filter(Boolean))).sort();

  function rowsHTML(filterText, unmappedOnly) {
    var ft = (filterText || "").toLowerCase();
    return items
      .filter(function (it) { return it.toLowerCase().indexOf(ft) !== -1; })
      .filter(function (it) { return !unmappedOnly || getProduct(it) === null; })
      .map(function (it) {
        var current = getProduct(it);
        var unmapped = current === null;
        return '<div class="imap-row' + (unmapped ? " imap-unmapped" : "") + '" data-item="' + esc(it) + '">' +
          '<span class="imap-name" title="' + esc(it) + '">' + esc(it) + "</span>" +
          '<input class="imap-input" list="imapProducts" placeholder="' + (unmapped ? "Unmapped — type a product…" : "(blank = no product)") +
          '" value="' + esc(current === null ? "" : current) + '" />' +
          (unmapped ? '<span class="imap-flag" title="No mapping found">⚠</span>' : "") +
          "</div>";
      }).join("") || '<div style="padding:16px;text-align:center;color:var(--ink-3)">No items match.</div>';
  }

  var unmappedCount = items.filter(function (it) { return getProduct(it) === null; }).length;

  wrap.innerHTML =
    '<div class="modal" role="dialog" aria-modal="true">' +
    '<div class="modal-hd"><div><h3>Item → Product mapping</h3>' +
    "<p>" + items.length + " distinct items in this view" + (unmappedCount ? " · " + unmappedCount + " unmapped" : "") + "</p></div>" +
    '<button class="x" id="imClose" aria-label="Close">×</button></div>' +
    '<div class="modal-body">' +
    '<div class="form-note">This is what a new item (e.g. a future product\'s SKU) that hasn\'t been seen before ' +
    "looks like — the ⚠ rows below. Type a product for any row and click Save; it's remembered here going forward " +
    "and applied automatically the next time that item name shows up. Leave blank if that item genuinely has no " +
    "product (many one-time/setup charges don't).</div>" +
    '<datalist id="imapProducts">' + KNOWN_PRODUCTS.map(function (p) { return '<option value="' + esc(p) + '">'; }).join("") + "</datalist>" +
    '<div class="toolbar" style="padding:0 0 10px;border:none;background:none">' +
    '<input type="search" id="imSearch" placeholder="Search item names…" />' +
    '<label class="colf-item" style="width:auto;padding:6px 9px;border:1px solid var(--border);border-radius:var(--radius-sm)">' +
    '<input type="checkbox" id="imUnmappedOnly"' + (unmappedCount ? "" : " disabled") + ' /> Unmapped only</label>' +
    "</div>" +
    '<div id="imList" class="imap-list">' + rowsHTML("", false) + "</div>" +
    "</div>" +
    '<div class="modal-ft"><span class="err" id="imErr"></span><span class="spacer"></span>' +
    '<button class="icon-btn" id="imCancel">Close</button>' +
    '<button class="btn-primary" id="imSave">Save changes</button></div></div>';
  document.body.appendChild(wrap);

  var listEl = wrap.querySelector("#imList");
  var searchEl = wrap.querySelector("#imSearch");
  var unmappedOnlyEl = wrap.querySelector("#imUnmappedOnly");
  function repaint() { listEl.innerHTML = rowsHTML(searchEl.value, unmappedOnlyEl.checked); }
  searchEl.addEventListener("input", repaint);
  unmappedOnlyEl.addEventListener("change", repaint);

  function close() { wrap.remove(); }
  wrap.querySelector("#imClose").addEventListener("click", close);
  wrap.querySelector("#imCancel").addEventListener("click", close);
  wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) close(); });

  wrap.querySelector("#imSave").addEventListener("click", function () {
    var rows = listEl.querySelectorAll(".imap-row");
    var changed = 0;
    rows.forEach(function (row) {
      var item = row.getAttribute("data-item");
      var input = row.querySelector(".imap-input");
      var typed = input.value.trim();
      var before = getProduct(item);
      if (typed === "" && before === null) return;   // still unmapped, nothing to save
      if (typed === (before === null ? "" : before)) return;
      if (typed === "" && before !== null) { clearOverride(item); changed++; return; }
      setProduct(item, typed);
      changed++;
    });
    if (changed) toast("Saved " + changed + " item→product mapping" + (changed === 1 ? "" : "s") + ".");
    close();
  });
}
