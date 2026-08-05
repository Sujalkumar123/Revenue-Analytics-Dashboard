/* Generic read-only raw-export mirror — same columns, same rows as the
   source Zoho file, no reclassification or revenue recognition. Invoice
   Dump and Credit Notes are both this view with different column sets and
   data sources; anything genuinely revenue-driving (Consol Sheet, the
   creditnotes.json Net calc on Recurring Revenue/product tabs) keeps its
   own separate dataset, untouched. */
"use strict";

import { esc, inr } from "../core/format.js";
import { fyMonths, parseUserDate } from "../core/dates.js";
import { state, curFY } from "../state/app-state.js";
import { kpiCard, toolbarControlsHTML, wireSearchSort } from "./toolbar.js";
import { loadMoreHTML, attachInfinite } from "./infinite-scroll.js";
import { SEL } from "./selection.js";
import { attachColumnFilters } from "./column-filter.js";
import { HISTORY } from "../state/history.js";
import { render } from "../core/bus.js";

/* One filter/sort state per view (keyed by opts.key), independent of every
   other tab's — persists across tab switches like a spreadsheet. */
var vstateByKey = {};
function getVstate(key) { return vstateByKey[key] || (vstateByKey[key] = { filters: {}, sort: null }); }

/* opts: {
 *   key            unique id for this view's filter/sort state
 *   cols           [{key,label,w,num}], same shape as INVOICE_DUMP_COLS
 *   getRows        () -> row objects (plain {colKey: value})
 *   dateKey        column key used to scope rows to the selected FY
 *   searchFields   column keys the free-text search box matches against
 *   title, badge   toolbar copy
 *   csvName        download filename
 * } */
export function renderRawDump(opts) {
  var vstate = getVstate(opts.key);
  var all = opts.getRows();

  var months = fyMonths(curFY());
  var lo = months.length ? months[0].s : null, hi = months.length ? months[months.length - 1].e : null;
  var inFY = (lo === null) ? all : all.filter(function (r) {
    var d = parseUserDate(r[opts.dateKey]);
    return d !== null && d >= lo && d <= hi;
  });

  var term = state.search.trim().toLowerCase();
  var rows = term
    ? inFY.filter(function (r) {
        return opts.searchFields.some(function (k) { return String(r[k] == null ? "" : r[k]).toLowerCase().indexOf(term) !== -1; });
      })
    : inFY.slice();

  var activeFilterKeys = Object.keys(vstate.filters).filter(function (k) { return vstate.filters[k]; });
  if (activeFilterKeys.length) {
    rows = rows.filter(function (r) {
      return activeFilterKeys.every(function (key) { return vstate.filters[key].has(String(r[key] == null ? "" : r[key])); });
    });
  }
  if (vstate.sort) {
    var sc = opts.cols.filter(function (c) { return c.key === vstate.sort.col; })[0];
    var dir = vstate.sort.dir === "desc" ? -1 : 1;
    rows.sort(function (a, b) {
      var av = a[vstate.sort.col], bv = b[vstate.sort.col];
      if (sc && sc.num) return ((av || 0) - (bv || 0)) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  var totalAmt = opts.totalField ? rows.reduce(function (s, r) { return s + (r[opts.totalField] || 0); }, 0) : null;
  var distinctClients = new Set(rows.map(function (r) { return r.client; })).size;

  var html = '<div class="kpis">' +
    kpiCard("Line items · " + curFY().label, rows.length.toLocaleString("en-IN"), all.length !== rows.length ? "of " + all.length.toLocaleString("en-IN") + " total" : "raw Zoho export") +
    kpiCard("Distinct clients", distinctClients.toLocaleString("en-IN"), "in this view") +
    (totalAmt !== null ? kpiCard(opts.totalLabel || "Total (view)", inr(totalAmt), "sum of " + (opts.totalColLabel || "Total") + " column") : "") +
    "</div>";

  html += '<div class="card"><div class="toolbar">' +
    '<input type="search" id="q" placeholder="' + esc(opts.searchPlaceholder) + '" value="' + esc(state.search) + '" />' +
    '<span class="badge-lock">🔒 ' + esc(opts.badge) + "</span>" +
    (activeFilterKeys.length ? '<button class="icon-btn" id="clrFilters">Clear ' + activeFilterKeys.length + " filter(s)</button>" : "") +
    toolbarControlsHTML({ noAdd: true }) + "</div>";

  html += '<div class="grid-wrap" id="gw"><table class="grid"><thead><tr class="hdr-row">' +
    '<th class="rownum" style="width:38px"></th>' +
    opts.cols.map(function (c, ci) {
      var active = vstate.filters[c.key];
      return '<th data-colkey="' + c.key + '" style="width:' + c.w + 'px" class="' + (c.num ? "num" : "lbl") + (ci === 0 ? " sticky-l" : "") + '">' +
        '<span class="colf-hd"><span class="colf-lbl">' + esc(c.label) + '</span>' +
        '<button class="colf-btn' + (active ? " active" : "") + '" title="Filter / sort ' + esc(c.label) + '">▾</button></span></th>';
    }).join("") +
    "</tr></thead><tbody id=\"tb\">";

  if (!rows.length) {
    html += '<tr><td colspan="' + (opts.cols.length + 1) + '" style="padding:26px;text-align:center;color:var(--ink-3)">' +
      (all.length ? "No rows match the current FY/search/filters." : "No data loaded.") + "</td></tr>";
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
          opts.cols.map(function (c, ci) {
            var v = r[c.key];
            var disp = c.num ? inr(v) : String(v == null ? "" : v);
            return '<td data-sel="1" class="' + (c.num ? "num " : "") + (ci === 0 ? "sticky-l " : "") + (c.key === "client" ? "cname" : "") + '"' +
              (c.num ? ' data-v="' + (Math.round((v || 0) * 100) / 100) + '"' : "") +
              ' title="' + esc(disp) + '">' + esc(disp) + "</td>";
          }).join("") + "</tr>";
      }
      return out;
    });
    SEL.attach(view.querySelector("#gw"));
  }

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
      inFY.forEach(function (r) {
        var v = String(r[key] == null ? "" : r[key]);
        if (!seen[v]) { seen[v] = 1; out.push(v); }
      });
      return out.sort();
    }
  );

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

  window.__csv = function () {
    var lines = [opts.cols.map(function (c) { return c.label; }).join(",")];
    rows.forEach(function (r) {
      lines.push(opts.cols.map(function (c) {
        var v = r[c.key];
        return typeof v === "string" ? '"' + v.replace(/"/g, '""').replace(/\n/g, " ") + '"' : v;
      }).join(","));
    });
    return { name: opts.csvName.replace(/\.csv$/, "") + "_" + state.fy + ".csv", body: lines.join("\n") };
  };
}
