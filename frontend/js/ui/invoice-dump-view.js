/* Invoice Dump — a faithful, read-only mirror of the raw Zoho invoice
   export (same columns, same rows, no reclassification or revenue
   recognition). Deliberately separate from Consol Sheet, which keeps its
   own dataset (product/recurring/service-period classification) untouched. */
"use strict";

import { esc, inr } from "../core/format.js";
import { S } from "../state/app-state.js";
import { kpiCard } from "./toolbar.js";
import { loadMoreHTML, attachInfinite } from "./infinite-scroll.js";
import { SEL } from "./selection.js";
import { attachColumnFilters } from "./column-filter.js";

export var INVOICE_DUMP_COLS = [
  { key: "invdate", label: "Invoice Date", w: 100 },
  { key: "inv", label: "Invoice Number", w: 150 },
  { key: "status", label: "Status", w: 110 },
  { key: "client", label: "Customer Name", w: 260 },
  { key: "currency", label: "Currency", w: 85 },
  { key: "fx", label: "Exchange Rate", w: 105, num: true },
  { key: "item", label: "Item Name", w: 220 },
  { key: "desc", label: "Item Description", w: 260 },
  { key: "qty", label: "Quantity", w: 90, num: true },
  { key: "price", label: "Item Price", w: 110, num: true },
  { key: "total", label: "Item Total", w: 120, num: true },
  { key: "taxable", label: "Taxable Amount", w: 130, num: true },
  { key: "usageFrom", label: "Usage Period (From)", w: 145 },
  { key: "usageTill", label: "Usage Period (Till)", w: 145 },
  { key: "gstin", label: "GSTIN", w: 150 },
  { key: "po", label: "Purchase Order", w: 150 },
  { key: "so", label: "Sales Order No.", w: 150 },
  { key: "discount", label: "Discount Amount", w: 135 },
  { key: "branch", label: "Branch", w: 110 },
  { key: "cgst", label: "CGST", w: 90, num: true },
  { key: "sgst", label: "SGST", w: 90, num: true },
  { key: "igst", label: "IGST", w: 90, num: true },
];

/* Filters/sort persist while switching tabs and coming back, like a
   spreadsheet — only cleared by the "Clear filters" button. */
var vstate = { search: "", filters: {}, sort: null };

function rowText(row) {
  return (row.inv + " " + row.client + " " + row.item + " " + row.gstin + " " + row.po + " " + row.so).toLowerCase();
}
function displayVal(row, c) {
  var v = row[c.key];
  return c.num ? inr(v) : String(v == null ? "" : v);
}

export function renderInvoiceDump() {
  var focused = document.activeElement && document.activeElement.id === "idq";
  var selStart = focused ? document.activeElement.selectionStart : null;

  var ds = S.invoiceDump;
  var all = (ds && ds.rows) || [];

  var term = vstate.search.trim().toLowerCase();
  var rows = term ? all.filter(function (r) { return rowText(r).indexOf(term) !== -1; }) : all.slice();

  Object.keys(vstate.filters).forEach(function (key) {
    var allowed = vstate.filters[key];
    if (!allowed) return;
    rows = rows.filter(function (r) { return allowed.has(String(r[key] == null ? "" : r[key])); });
  });

  if (vstate.sort) {
    var sc = INVOICE_DUMP_COLS.filter(function (c) { return c.key === vstate.sort.col; })[0];
    var dir = vstate.sort.dir === "desc" ? -1 : 1;
    rows.sort(function (a, b) {
      var av = a[vstate.sort.col], bv = b[vstate.sort.col];
      if (sc && sc.num) return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  var activeFilterCount = Object.keys(vstate.filters).filter(function (k) { return vstate.filters[k]; }).length;
  var totalAmt = rows.reduce(function (s, r) { return s + (r.total || 0); }, 0);
  var distinctClients = new Set(rows.map(function (r) { return r.client; })).size;

  var html = '<div class="kpis">' +
    kpiCard("Line items", rows.length.toLocaleString("en-IN"), all.length !== rows.length ? "of " + all.length.toLocaleString("en-IN") + " total" : "raw Zoho export") +
    kpiCard("Distinct clients", distinctClients.toLocaleString("en-IN"), "in this view") +
    kpiCard("Item total (view)", inr(totalAmt), "sum of Item Total column") +
    "</div>";

  html += '<div class="card"><div class="toolbar">' +
    '<input type="search" id="idq" placeholder="Search invoice no, client, item, GSTIN, PO, SO…" value="' + esc(vstate.search) + '" />' +
    '<span class="badge-lock">🔒 Read-only — raw export from Zoho Books</span>' +
    (activeFilterCount ? '<button class="icon-btn" id="idClrFilters">Clear ' + activeFilterCount + " filter(s)</button>" : "") +
    '<span class="tb-right"><button class="icon-btn" id="idExport">↓ CSV</button></span>' +
    "</div>";

  html += '<div class="grid-wrap" id="gw"><table class="grid"><thead><tr class="hdr-row">' +
    '<th class="rownum" style="width:38px"></th>' +
    INVOICE_DUMP_COLS.map(function (c, ci) {
      var active = vstate.filters[c.key];
      return '<th data-colkey="' + c.key + '" style="width:' + c.w + 'px" class="' + (c.num ? "num" : "lbl") + (ci === 0 ? " sticky-l" : "") + '">' +
        '<span class="colf-hd"><span class="colf-lbl">' + esc(c.label) + '</span>' +
        '<button class="colf-btn' + (active ? " active" : "") + '" title="Filter / sort ' + esc(c.label) + '">▾</button></span></th>';
    }).join("") +
    "</tr></thead><tbody id=\"tb\">";

  if (!rows.length) {
    html += '<tr><td colspan="' + (INVOICE_DUMP_COLS.length + 1) + '" style="padding:26px;text-align:center;color:var(--ink-3)">' +
      (all.length ? "No rows match the current search/filters." : "No invoice data loaded.") + "</td></tr>";
  }
  html += '</tbody></table><div class="sentinel" aria-hidden="true"></div></div>' +
    (rows.length ? loadMoreHTML(rows.length) : "") + "</div>";

  var view = document.getElementById("view");
  view.innerHTML = html;

  if (rows.length) {
    attachInfinite(view.querySelector("#gw"), view.querySelector("#tb"), rows.length, function (from, to) {
      var out = "";
      for (var i = from; i < to; i++) {
        var r = rows[i];
        out += '<tr><td class="rownum" title="Click to select this row · Ctrl+click to add another">' + (i + 1) + "</td>" +
          INVOICE_DUMP_COLS.map(function (c, ci) {
            var disp = displayVal(r, c);
            return '<td class="' + (c.num ? "num " : "") + (ci === 0 ? "sticky-l " : "") + (c.key === "client" ? "cname" : "") + '"' +
              (c.num ? ' data-v="' + (Math.round((r[c.key] || 0) * 100) / 100) + '"' : "") +
              ' title="' + esc(disp) + '">' + esc(disp) + "</td>";
          }).join("") + "</tr>";
      }
      return out;
    });
    SEL.attach(view.querySelector("#gw"));
  }

  attachColumnFilters(view.querySelector("thead tr.hdr-row"), INVOICE_DUMP_COLS, vstate,
    function onSort(key, dir) { vstate.sort = { col: key, dir: dir }; renderInvoiceDump(); },
    function onFilterApply(key, set) {
      if (set) vstate.filters[key] = set; else delete vstate.filters[key];
      renderInvoiceDump();
    },
    function uniqueValuesFn(key) {
      var seen = {}, out = [];
      all.forEach(function (r) {
        var v = String(r[key] == null ? "" : r[key]);
        if (!seen[v]) { seen[v] = 1; out.push(v); }
      });
      return out.sort();
    }
  );

  var q = view.querySelector("#idq");
  if (q) {
    if (focused) { q.focus(); try { q.setSelectionRange(selStart, selStart); } catch (e) {} }
    var t;
    q.addEventListener("input", function () {
      clearTimeout(t);
      t = setTimeout(function () { vstate.search = q.value; renderInvoiceDump(); }, 180);
    });
  }
  var clr = view.querySelector("#idClrFilters");
  if (clr) clr.addEventListener("click", function () { vstate.filters = {}; renderInvoiceDump(); });

  var exportBtn = view.querySelector("#idExport");
  if (exportBtn) exportBtn.addEventListener("click", function () {
    var lines = [INVOICE_DUMP_COLS.map(function (c) { return c.label; }).join(",")];
    rows.forEach(function (r) {
      lines.push(INVOICE_DUMP_COLS.map(function (c) {
        var v = r[c.key];
        return typeof v === "string" ? '"' + v.replace(/"/g, '""').replace(/\n/g, " ") + '"' : v;
      }).join(","));
    });
    var blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "Invoice_Dump.csv"; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });
}
