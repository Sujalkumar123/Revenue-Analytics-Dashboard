/* Line-item ledger view — Invoice working (Consol Sheet) and Credit Note
   Working. */
"use strict";

import { fyMonths } from "../core/dates.js";
import { inr, inrShort, esc } from "../core/format.js";
import { fieldVal, effPeriod } from "../data/fields.js";
import { monthlyOf } from "../data/revenue.js";
import { state, curFY } from "../state/app-state.js";
import { canEdit } from "../state/auth.js";
import { EDITS, editKey, getEdit, setEdit, isEdited, editCount, isAdded } from "../state/stores.js";
import { HISTORY } from "../state/history.js";
import { kpiCard, toolbarControlsHTML, wireSearchSort, MONTH_W } from "./toolbar.js";
import { loadMoreHTML, attachInfinite } from "./infinite-scroll.js";
import { SEL } from "./selection.js";
import { render } from "../core/bus.js";
import { attachColumnFilters } from "./column-filter.js";
import { attachDblClickEdit, stopEditingCell } from "./dblclick-edit.js";
import { openItemProductMappingModal, unmappedItemCount } from "./item-product-mapping-modal.js";

/* One filter/sort state per sheet (consol vs credit), so filtering Consol
   Sheet doesn't affect Credit Notes — persists across tab switches, like a
   spreadsheet, until "Clear filters" or Ctrl+Z. */
var vstateBySheet = {};
function getVstate(sheet) {
  return vstateBySheet[sheet] || (vstateBySheet[sheet] = { filters: {}, sort: null });
}

export function renderLedger(opts) {
  var ds = opts.ds, sheet = opts.sheet;
  var vstate = getVstate(sheet);
  var months = fyMonths(curFY());
  var term = state.search.trim().toLowerCase();

  var baseIdx = [];
  for (var i = 0; i < ds.rows.length; i++) {
    if (opts.filter && !opts.filter(ds, sheet, i)) continue;
    if (state.flagOnly && effPeriod(ds, sheet, i)) continue;
    if (term) {
      var hay = (fieldVal(ds, sheet, i, "client") + " " + fieldVal(ds, sheet, i, "inv") + " " +
        fieldVal(ds, sheet, i, "item") + " " + fieldVal(ds, sheet, i, "desc")).toLowerCase();
      if (hay.indexOf(term) === -1) continue;
    }
    baseIdx.push(i);
  }

  var idx = baseIdx;
  var activeFilterKeys = Object.keys(vstate.filters).filter(function (k) { return vstate.filters[k]; });
  if (activeFilterKeys.length) {
    idx = idx.filter(function (ri) {
      return activeFilterKeys.every(function (key) {
        return vstate.filters[key].has(String(fieldVal(ds, sheet, ri, key)));
      });
    });
  }
  if (vstate.sort) {
    var sortCol = opts.cols.filter(function (c) { return c.f === vstate.sort.col; })[0];
    var dir = vstate.sort.dir === "desc" ? -1 : 1;
    idx = idx.slice().sort(function (a, b) {
      var av = fieldVal(ds, sheet, a, vstate.sort.col), bv = fieldVal(ds, sheet, b, vstate.sort.col);
      if (sortCol && sortCol.num) return ((parseFloat(av) || 0) - (parseFloat(bv) || 0)) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  var colTot = new Array(months.length).fill(0), grand = 0, flagged = 0, added = 0;
  for (var k = 0; k < idx.length; k++) {
    var ri = idx[k];
    if (!effPeriod(ds, sheet, ri)) flagged++;
    if (isAdded(sheet, ri)) added++;
    var mv = monthlyOf(ds, sheet, ri, months);
    for (var m = 0; m < months.length; m++) { colTot[m] += mv[m]; grand += mv[m]; }
  }

  var edits = editCount(sheet);
  var html = '<div class="kpis">' +
    kpiCard("Line items", idx.length.toLocaleString("en-IN"), opts.kpiSub || "in ledger") +
    kpiCard("Recognised · " + curFY().label, inrShort(grand), months.length + " months") +
    kpiCard("Manual edits", edits.toLocaleString("en-IN"), edits ? "overriding source data" : "none — all from source") +
    kpiCard("Needs attention", flagged.toLocaleString("en-IN"),
      flagged ? "missing service period" : "every row has a service period", flagged ? "down" : "") +
    "</div>";

  var locked = opts.readOnly || !canEdit();

  var allItems = [];
  for (var aj = 0; aj < ds.rows.length; aj++) allItems.push(fieldVal(ds, sheet, aj, "item"));
  var newItems = locked ? 0 : unmappedItemCount(allItems);

  html += '<div class="card"><div class="toolbar">' +
    '<input type="search" id="q" placeholder="Search invoice no, client, item…" value="' + esc(state.search) + '" />' +
    (opts.readOnly
      ? '<span class="badge-lock">🔒 Read-only — sourced from ' + esc(opts.source) + "</span>"
      : (canEdit() ? "" : '<span class="badge-lock">🔒 Read-only access</span>')) +
    (added ? '<span class="prov"><span class="dot new"></span>Added (' + added + ")</span>" : "") +
    (flagged ? '<button class="chip-warn" id="onlyFlag" aria-pressed="' + state.flagOnly + '">⚠ ' +
      (state.flagOnly ? "Showing needs attention (" : "Needs attention (") + flagged + ")</button>" : "") +
    (edits && !locked ? '<button class="icon-btn" id="clrEdits">Reset ' + edits + " edit(s)</button>" : "") +
    (activeFilterKeys.length ? '<button class="icon-btn" id="clrFilters">Clear ' + activeFilterKeys.length + " filter(s)</button>" : "") +
    (newItems ? '<button class="chip-tool" id="itemMapBtn">⚠ New items (' + newItems + ") — assign a product</button>" : "") +
    toolbarControlsHTML({ noExport: true }) + "</div>";

  var cols = locked
    ? opts.cols.map(function (c) { var d = {}; for (var k in c) d[k] = c[k]; d.edit = false; return d; })
    : opts.cols;
  html += '<div class="grid-wrap' + (locked ? " locked" : "") + '" id="gw"><table class="grid"><thead><tr class="hdr-row">' +
    '<th class="rownum" style="width:38px"></th>' +
    cols.map(function (c, ci) {
      var active = vstate.filters[c.f];
      return '<th data-colkey="' + c.f + '" style="width:' + c.w + 'px" class="' + (c.num ? "num" : "lbl") + (ci === 0 ? " sticky-l" : "") + '">' +
        '<span class="colf-hd"><span class="colf-lbl">' + esc(c.label) + '</span>' +
        '<button class="colf-btn' + (active ? " active" : "") + '" title="Filter / sort ' + esc(c.label) + '">▾</button></span></th>';
    }).join("") +
    months.map(function (m) { return '<th class="num" style="width:' + MONTH_W + 'px" title="Click to select this column · Ctrl+click to add another">' + m.label + "</th>"; }).join("") +
    '<th class="num" style="width:130px">FY Total</th></tr>' +
    '<tr class="total-row"><th class="rownum"></th><th class="lbl sticky-l"></th>' +
    cols.slice(1).map(function () { return "<th></th>"; }).join("") +
    colTot.map(function (v) { return '<th class="num">' + inr(v) + "</th>"; }).join("") +
    '<th class="num">' + inr(grand) + "</th></tr></thead><tbody id=\"tb\">";

  function rowHTML(ri, rank) {
    var period = effPeriod(ds, sheet, ri);
    var mv = monthlyOf(ds, sheet, ri, months);
    var rowTot = mv.reduce(function (a, b) { return a + b; }, 0);
    var cls = [];
    if (!period) cls.push("flagged");
    if (isAdded(sheet, ri)) cls.push("isnew");
    return "<tr" + (cls.length ? ' class="' + cls.join(" ") + '"' : "") +
      (!period ? ' title="No service period — add Start and End dates to bring this line into revenue."' : "") + ">" +
      '<td class="rownum" title="Click to select this row · Ctrl+click to add another">' + rank + "</td>" +
      cols.map(function (c, ci) {
        var val = fieldVal(ds, sheet, ri, c.f);
        var disp = c.f === "amount" ? inr(val) : val;
        var ed = isEdited(sheet, ri, c.f);
        return '<td data-sel="1" class="' + (c.num ? "num " : "") + (ci === 0 ? "sticky-l " : "") +
          (c.f === "client" ? "cname " : "") + (c.edit ? "editable " : "") + (ed ? "edited" : "") + '"' +
          (c.num ? ' data-v="' + (Math.round((parseFloat(String(val).replace(/[^0-9.\-]/g, "")) || 0) * 100) / 100) + '"' : "") +
          (c.edit ? ' data-ri="' + ri + '" data-f="' + c.f +
            '" data-orig="' + esc(disp) + '" title="Double-click to edit — marked A for admin-edited"' : "") +
          ">" + esc(disp) + "</td>";
      }).join("") +
      mv.map(function (v) {
        return '<td data-sel="1" class="num ' + (Math.abs(v) < 0.5 ? "zero" : v < 0 ? "neg" : "") +
          '" data-v="' + (Math.round(v * 100) / 100) + '">' + inr(v) + "</td>";
      }).join("") +
      '<td data-sel="1" class="num" data-v="' + (Math.round(rowTot * 100) / 100) + '"><b>' + inr(rowTot) + "</b></td></tr>";
  }

  if (!idx.length) {
    html += '<tr><td colspan="' + (cols.length + months.length + 2) + '" style="padding:26px;text-align:center;color:var(--ink-3)">No matching rows.</td></tr>';
  }
  html += '</tbody></table><div class="sentinel" aria-hidden="true"></div></div>' +
    (idx.length ? loadMoreHTML(idx.length, true) : "") + "</div>";

  var view = document.getElementById("view");
  view.innerHTML = html;

  /* One delegated pair of listeners covers every streamed row. */
  var tbEl = view.querySelector("#tb");
  if (tbEl) {
    var commitCell = function (td) {
      stopEditingCell(td);
      var nv = td.textContent.trim();
      var orig = (td.getAttribute("data-orig") || "").trim();
      if (nv === orig) return;
      var ri = +td.getAttribute("data-ri"), field = td.getAttribute("data-f");
      var prev = getEdit(sheet, ri, field);   // undefined if not edited before
      HISTORY.perform({
        label: "edit " + field + " on row " + ri,
        apply: function () { setEdit(sheet, ri, field, nv); },
        revert: function () { if (prev === undefined) EDITS.del(editKey(sheet, ri, field)); else setEdit(sheet, ri, field, prev); }
      });
      render();
    };
    tbEl.addEventListener("focusout", function (e) {
      var td = e.target && e.target.closest ? e.target.closest("td.editable") : null;
      if (td) commitCell(td);
    });
    tbEl.addEventListener("keydown", function (e) {
      var td = e.target && e.target.closest ? e.target.closest("td.editable") : null;
      if (!td) return;
      if (e.key === "Enter") { e.preventDefault(); commitCell(td); td.blur(); }
      if (e.key === "Escape") { td.textContent = td.getAttribute("data-orig") || ""; stopEditingCell(td); td.blur(); }
    });
    attachDblClickEdit(tbEl, "td.editable");
  }

  if (idx.length) {
    attachInfinite(view.querySelector("#gw"), tbEl, idx.length, function (from, to) {
      var out = "";
      for (var i = from; i < to; i++) out += rowHTML(idx[i], i + 1);
      return out;
    });
    SEL.attach(view.querySelector("#gw"));
  }

  var clr = view.querySelector("#clrEdits");
  if (clr) clr.addEventListener("click", function () {
    var snap = EDITS.snapshot();
    HISTORY.perform({
      label: "reset all edits",
      apply: function () { EDITS.clear(); },
      revert: function () { EDITS.restoreAll(snap); }
    });
    render();
  });
  var of = view.querySelector("#onlyFlag");
  if (of) of.addEventListener("click", function () { state.flagOnly = !state.flagOnly; render(); });
  var imBtn = view.querySelector("#itemMapBtn");
  if (imBtn) imBtn.addEventListener("click", function () { openItemProductMappingModal(allItems); });
  var clrF = view.querySelector("#clrFilters");
  if (clrF) clrF.addEventListener("click", function () {
    var prev = vstate.filters;
    HISTORY.perform({
      label: "clear filters",
      apply: function () { vstate.filters = {}; },
      revert: function () { vstate.filters = prev; }
    });
    render();
  });
  wireSearchSort(view);

  attachColumnFilters(view.querySelector("thead tr.hdr-row"), vstate,
    function onSort(key, dir) {
      var prev = vstate.sort, next = { col: key, dir: dir };
      HISTORY.perform({
        label: "sort by " + key,
        apply: function () { vstate.sort = next; },
        revert: function () { vstate.sort = prev; }
      });
      render();
    },
    function onFilterApply(key, set) {
      var prev = vstate.filters[key];
      HISTORY.perform({
        label: "filter " + key,
        apply: function () { if (set) vstate.filters[key] = set; else delete vstate.filters[key]; },
        revert: function () { if (prev) vstate.filters[key] = prev; else delete vstate.filters[key]; }
      });
      render();
    },
    function uniqueValuesFn(key) {
      var seen = {}, out = [];
      baseIdx.forEach(function (ri) {
        var v = String(fieldVal(ds, sheet, ri, key));
        if (!seen[v]) { seen[v] = 1; out.push(v); }
      });
      return out.sort();
    }
  );

  window.__csv = function () {
    var lines = [cols.map(function (c) { return c.label; })
      .concat(months.map(function (m) { return m.label; })).concat(["FY Total"]).join(",")];
    idx.forEach(function (ri) {
      var mv = monthlyOf(ds, sheet, ri, months);
      var tot = mv.reduce(function (a, b) { return a + b; }, 0);
      lines.push(cols.map(function (c) {
        var v = fieldVal(ds, sheet, ri, c.f);
        return typeof v === "string" ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).concat(mv.map(function (v) { return Math.round(v); })).concat([Math.round(tot)]).join(","));
    });
    return { name: opts.title.replace(/[^\w]+/g, "_") + "_" + state.fy + ".csv", body: lines.join("\n") };
  };
}
