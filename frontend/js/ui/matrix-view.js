/* Client × month matrix — the Recurring Revenue tab and every product tab
   (SFA GT, DMS, SFA MT, Flo, Other modules, OTC) are this same view with a
   different filter/edit configuration. */
"use strict";

import { fyMonths } from "../core/dates.js";
import { inr, inrShort, esc } from "../core/format.js";
import { aggregate, netAggregate, computeProvisional } from "../data/revenue.js";
import { state, S, curFY } from "../state/app-state.js";
import { canEdit } from "../state/auth.js";
import { MXO, mxKey, mxCount } from "../state/stores.js";
import { getProvStatus, setProvStatus, clearProvStatus } from "../state/recurring-status.js";
import { HISTORY } from "../state/history.js";
import { parseNum } from "../core/format.js";
import { kpiCard, toolbarControlsHTML, wireSearchSort, MONTH_W } from "./toolbar.js";
import { loadMoreHTML, attachInfinite } from "./infinite-scroll.js";
import { SEL } from "./selection.js";
import { render } from "../core/bus.js";
import { attachColumnFilters } from "./column-filter.js";
import { attachDblClickEdit, stopEditingCell } from "./dblclick-edit.js";

/* One filter/sort state per tab (recurr, onetime, each product tab), keyed
   by state.tab so switching tabs doesn't leak one tab's client filter into
   another's. Only the Client column is filterable here — month columns are
   computed revenue figures, not natural filter targets. */
var vstateByTab = {};
function getVstate(tab) {
  return vstateByTab[tab] || (vstateByTab[tab] = { filters: {}, sort: null });
}

export function renderMatrix(opts) {
  var vstate = getVstate(state.tab);
  var months = fyMonths(curFY());
  var gross = aggregate(S.consol, "consol", months, opts.filter);
  var credit = opts.netable ? aggregate(S.credit, "credit", months, opts.filter) : new Map();
  /* Net isn't just gross-minus-credit off the two maps above — see
     netAggregate()'s own comment — it's netted per invoice line first, so
     it's computed independently rather than derived from `gross`/`credit`. */
  var net = opts.netable ? netAggregate(S.consol, S.credit, months, opts.filter) : new Map();

  /* Provisional (projected) revenue for recurring clients with no invoice
     yet in a current/future month — see computeProvisional()'s own comment.
     Computed once here (across full history, keyed by month label) so it
     can be spliced into whichever months are on screen. */
  var overlay = opts.projectable ? computeProvisional(S.consol, opts.filter) : new Map();

  var names = new Set();
  gross.forEach(function (_, k) { names.add(k); });
  credit.forEach(function (_, k) { names.add(k); });
  net.forEach(function (_, k) { names.add(k); });
  /* A client can be entirely provisional for the FY on screen (no real
     invoice at all this year) and so absent from the three maps above —
     pull those in too, but only if one of their projected months actually
     falls inside the months currently shown. */
  overlay.forEach(function (perMonth, client) {
    perMonth.forEach(function (_, monthLabel) {
      if (months.some(function (m) { return m.label === monthLabel; })) names.add(client);
    });
  });

  var metric = opts.netable ? state.metric : "gross";
  var editable = !!opts.editable && canEdit();
  var rows = [];
  names.forEach(function (n) {
    var g = gross.get(n) || new Array(months.length).fill(0);
    var c = credit.get(n) || new Array(months.length).fill(0);
    var nt = net.get(n) || new Array(months.length).fill(0);
    /* prov[i]: undefined (no projection here) or the status of the ONE cell
       that's actionable — the most recent month with no invoice yet (the
       last key inserted into clientOverlay, since computeProvisional()
       walks months forward in order). Every provisional month still counts
       toward revenue (spliced into g/nt below regardless), but only that
       edge month gets the visible badge/border and Confirm/Reject controls
       — a client that's gone 8 months without an invoice doesn't need 8
       identical flagged cells, just the one that's actually new/undecided. */
    var prov = [];
    var clientOverlay = overlay.get(n);
    if (clientOverlay) {
      var lastProvLabel = null;
      clientOverlay.forEach(function (_, ml) { lastProvLabel = ml; });
      for (var pi = 0; pi < months.length; pi++) {
        if (Math.abs(g[pi]) >= 0.5) continue;
        var projAmt = clientOverlay.get(months[pi].label);
        if (projAmt === undefined) continue;
        var st = getProvStatus(n, months[pi].label) || "pending";
        if (months[pi].label === lastProvLabel) prov[pi] = st;
        if (st === "churned") continue;   // stays zero — excluded from revenue
        g[pi] = projAmt;
        nt[pi] = projAmt;
      }
    }
    var ov = [];
    var vals = months.map(function (m, i) {
      var v = metric === "gross" ? g[i] : metric === "credit" ? c[i] : nt[i];
      if (editable) {
        var o = MXO.get(mxKey(state.tab, metric, state.fy, m.label, n));
        if (o !== undefined) { var p = parseNum(o); if (p !== null) { ov[i] = true; v = p; } }
      }
      return v;
    });
    /* totals come from the overridden values, so a typed figure flows into
       the month total, the FY total and the KPI cards */
    var tot = vals.reduce(function (a, b) { return a + b; }, 0);
    if (Math.abs(tot) < 0.5 && !vals.some(function (v) { return Math.abs(v) >= 0.5; }) && !ov.length && !prov.length) return;
    rows.push({ name: n, vals: vals, total: tot, ov: ov, prov: prov });
  });

  var term = state.search.trim().toLowerCase();
  if (term) rows = rows.filter(function (r) { return r.name.toLowerCase().indexOf(term) !== -1; });

  /* Counts reflect the search box but not the dropdown's own filter (so the
     dropdown's option labels stay meaningful no matter which one is
     currently selected) — same "has" check the filter below uses. */
  function hasProv(status) { return function (r) { return r.prov.some(function (s) { return s === status; }); }; }
  var pendingCount = opts.projectable ? rows.filter(hasProv("pending")).length : 0;
  var confirmedCount = opts.projectable ? rows.filter(hasProv("confirmed")).length : 0;
  var churnedCount = opts.projectable ? rows.filter(hasProv("churned")).length : 0;

  if (opts.projectable && state.provFilter !== "all") {
    rows = rows.filter(hasProv(state.provFilter));
  }
  rows.sort(state.sort === "name_asc"
    ? function (a, b) { return a.name.localeCompare(b.name); }
    : state.sort === "total_asc"
      ? function (a, b) { return a.total - b.total; }
      : function (a, b) { return b.total - a.total; });

  /* Column-filter's own sort (from the header funnel) overrides the
     toolbar's sort dropdown when set — last sort action wins, like Excel. */
  if (vstate.sort) {
    var cfDir = vstate.sort.dir === "desc" ? -1 : 1;
    rows.sort(function (a, b) { return a.name.localeCompare(b.name) * cfDir; });
  }
  if (vstate.filters.name) {
    rows = rows.filter(function (r) { return vstate.filters.name.has(r.name); });
  }

  var colTot = months.map(function (_, i) {
    return rows.reduce(function (s, r) { return s + r.vals[i]; }, 0);
  });
  var grand = colTot.reduce(function (a, b) { return a + b; }, 0);
  var metricLabel = metric === "gross" ? "Gross revenue" : metric === "credit" ? "Credit notes" : "Net revenue";
  var peak = colTot.indexOf(Math.max.apply(null, colTot));

  var html = '<div class="kpis">' +
    kpiCard(metricLabel + " · " + curFY().label, inrShort(grand), months.length + " months") +
    kpiCard("Clients with activity", rows.length.toLocaleString("en-IN"), "in this financial year") +
    kpiCard("Peak month", months[peak] ? months[peak].label : "–", months[peak] ? inrShort(colTot[peak]) : "") +
    kpiCard("Monthly average", inrShort(grand / (months.length || 1)), "across " + months.length + " months") +
    "</div>";

  html += '<div class="card">';
  html += '<div class="toolbar">' +
    '<input type="search" id="q" placeholder="Search client…" value="' + esc(state.search) + '" />' +
    '<select id="sortSel">' +
    '<option value="total_desc"' + (state.sort === "total_desc" ? " selected" : "") + ">Total (high → low)</option>" +
    '<option value="total_asc"' + (state.sort === "total_asc" ? " selected" : "") + ">Total (low → high)</option>" +
    '<option value="name_asc"' + (state.sort === "name_asc" ? " selected" : "") + ">Client name (A → Z)</option>" +
    "</select>" +
    (opts.netable
      ? '<div class="seg" role="group" aria-label="Metric">' +
        '<button data-metric="gross" aria-pressed="' + (metric === "gross") + '">Gross</button>' +
        '<button data-metric="credit" aria-pressed="' + (metric === "credit") + '">Credit notes</button>' +
        '<button data-metric="net" aria-pressed="' + (metric === "net") + '">Net</button></div>'
      : "") +
    (editable
      ? (mxCount() ? '<button class="icon-btn" id="clrMx">Reset ' + mxCount() + " override(s)</button>" : "")
      : '<span class="badge-lock">🔒 ' + (opts.editable ? "Read-only access" : "Derived — read-only") + "</span>") +
    (vstate.filters.name ? '<button class="icon-btn" id="clrFilters">Clear filter</button>' : "") +
    (opts.projectable
      ? '<select id="provSel" title="Filter by projected-revenue status" class="prov-filter-sel' +
        (state.provFilter !== "all" ? " active" : "") + '">' +
        '<option value="all"' + (state.provFilter === "all" ? " selected" : "") + ">All clients</option>" +
        '<option value="pending"' + (state.provFilter === "pending" ? " selected" : "") + ">⏳ Pending confirmation (" + pendingCount + ")</option>" +
        '<option value="confirmed"' + (state.provFilter === "confirmed" ? " selected" : "") + ">✓ Confirmed actual (" + confirmedCount + ")</option>" +
        '<option value="churned"' + (state.provFilter === "churned" ? " selected" : "") + ">✕ Marked churn (" + churnedCount + ")</option>" +
        "</select>"
      : "") +
    toolbarControlsHTML({ noExport: true }) + "</div>";

  html += '<div class="grid-wrap" id="gw"><table class="grid"><thead>' +
    '<tr class="hdr-row"><th class="rownum" style="width:38px"></th>' +
    '<th class="lbl sticky-l" style="width:300px" data-colkey="name">' +
    '<span class="colf-hd"><span class="colf-lbl">Client</span>' +
    '<button class="colf-btn' + (vstate.filters.name ? " active" : "") + '" title="Filter / sort Client">▾</button></span></th>' +
    months.map(function (m) { return '<th class="num" style="width:' + MONTH_W + 'px" title="Click to select this column · Ctrl+click to add another">' + m.label + "</th>"; }).join("") +
    '<th class="num" style="width:130px">FY Total</th></tr>' +
    '<tr class="total-row"><th class="rownum"></th><th class="lbl sticky-l"></th>' +
    colTot.map(function (v) { return '<th class="num">' + inr(v) + "</th>"; }).join("") +
    '<th class="num">' + inr(grand) + "</th></tr></thead><tbody id=\"tb\">";

  if (!rows.length) {
    html += '<tr><td colspan="' + (months.length + 3) + '" style="padding:26px;text-align:center;color:var(--ink-3)">No matching clients.</td></tr>';
  }
  html += '</tbody></table><div class="sentinel" aria-hidden="true"></div></div>' +
    (rows.length ? loadMoreHTML(rows.length, true) : "") + "</div>";

  var view = document.getElementById("view");
  view.innerHTML = html;

  if (rows.length) {
    attachInfinite(view.querySelector("#gw"), view.querySelector("#tb"), rows.length, function (from, to) {
      var out = "";
      for (var i = from; i < to; i++) {
        var r = rows[i];
        out += '<tr><td class="rownum" title="Click to select this row · Ctrl+click to add another">' + (i + 1) + "</td>" +
          '<td data-sel="1" class="sticky-l cname" title="' + esc(r.name) + '">' + esc(r.name) + "</td>" +
          r.vals.map(function (v, mi) {
            var disp = inr(v);
            /* Provisional status only means anything for the metric it was
               computed against (gross/net) — a plain Credit notes view has
               no projected figures, so never badge those cells. */
            var provSt = metric !== "credit" ? r.prov[mi] : undefined;
            /* Pending/churned cells carry action buttons inside the cell —
               those buttons' own text would pollute td.textContent (which
               commitMx()/contentEditable rely on being just the figure), so
               those two states are deliberately NOT double-click-editable;
               use Confirm/Reject/Undo instead. A confirmed cell has no
               in-cell text beyond the figure (just a border treatment), so
               it stays a normal editable/overridable cell like any other. */
            var provInteractive = provSt === "pending" || provSt === "churned";
            var cellEditable = editable && !provInteractive;
            var provClass = provSt === "churned" ? "prov-churned " : provSt === "confirmed" ? "prov-confirmed " : provSt === "pending" ? "prov-pending " : "";
            var provBadge = "";
            if (provSt === "pending") {
              provBadge = editable
                ? '<span class="prov-actions"><button type="button" class="prov-btn prov-confirm" title="Confirm as actual">✓</button><button type="button" class="prov-btn prov-reject" title="Mark as churn">✕</button></span>'
                : '<span class="prov-badge" title="Projected — no invoice yet">Projected</span>';
            } else if (provSt === "churned") {
              provBadge = editable
                ? '<span class="prov-actions"><button type="button" class="prov-btn prov-undo" title="Undo — revert to pending">↺ Undo</button></span>'
                : '<span class="prov-badge prov-badge-churned" title="Marked churned — excluded from revenue">Churned</span>';
            }
            return '<td data-sel="1" class="num ' + (Math.abs(v) < 0.5 ? "zero " : v < 0 ? "neg " : "") +
              (cellEditable ? "editable " : "") + (r.ov[mi] ? "edited " : "") + provClass +
              '" data-v="' + (Math.round(v * 100) / 100) + '"' +
              (cellEditable ? ' data-mx="1" data-client="' + esc(r.name) +
                '" data-month="' + esc(months[mi].label) + '" data-orig="' + esc(disp) +
                '" title="Double-click to type a figure and override this month for this client — marked A for admin-edited"' : "") +
              (provInteractive ? ' data-prov="1" data-prov-status="' + provSt + '" data-prov-client="' + esc(r.name) + '" data-prov-month="' + esc(months[mi].label) + '"' : "") +
              ">" + disp + provBadge + "</td>";
          }).join("") +
          '<td data-sel="1" class="num" data-v="' + (Math.round(r.total * 100) / 100) + '"><b>' + inr(r.total) + "</b></td></tr>";
      }
      return out;
    });
    SEL.attach(view.querySelector("#gw"));

    var tbAll = view.querySelector("#tb");
    /* Confirm/Reject/Undo buttons live inside a data-sel="1" cell, so their
       own mousedown would otherwise be picked up by SEL's drag-to-select
       first — stop it reaching SEL before it starts. */
    tbAll.addEventListener("mousedown", function (e) {
      if (e.target && e.target.closest && e.target.closest(".prov-btn")) e.stopPropagation();
    });
    tbAll.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest(".prov-btn") : null;
      if (!btn) return;
      e.stopPropagation();
      var td = btn.closest("td[data-prov]");
      if (!td) return;
      var client = td.getAttribute("data-prov-client"), monthLabel = td.getAttribute("data-prov-month");
      var prevStatus = getProvStatus(client, monthLabel);
      var action = btn.classList.contains("prov-confirm") ? "confirmed"
        : btn.classList.contains("prov-reject") ? "churned"
          : null;   // undo -> back to pending (no stored status)
      HISTORY.perform({
        label: (action === "confirmed" ? "confirm " : action === "churned" ? "mark churn for " : "undo churn for ") + monthLabel + " · " + client,
        apply: function () { if (action) setProvStatus(client, monthLabel, action); else clearProvStatus(client, monthLabel); },
        revert: function () { if (prevStatus) setProvStatus(client, monthLabel, prevStatus); else clearProvStatus(client, monthLabel); }
      });
      render();
    });

    if (editable) {
      var tbEl = view.querySelector("#tb");
      var commitMx = function (td) {
        stopEditingCell(td);
        var nv = td.textContent.trim();
        if (nv === (td.getAttribute("data-orig") || "").trim()) return;
        var key = mxKey(state.tab, metric, state.fy, td.getAttribute("data-month"), td.getAttribute("data-client"));
        var clearing = nv === "" || nv === "–" || nv === "-";
        var n = null;
        if (!clearing) {
          n = parseNum(nv);
          if (n === null) { td.textContent = td.getAttribute("data-orig") || ""; return; }
        }
        var prev = MXO.get(key);   // undefined if this cell had no override yet
        HISTORY.perform({
          label: "override " + td.getAttribute("data-month") + " for " + td.getAttribute("data-client"),
          apply: function () { if (clearing) MXO.del(key); else MXO.set(key, n); },
          revert: function () { if (prev === undefined) MXO.del(key); else MXO.set(key, prev); }
        });
        render();
      };
      tbEl.addEventListener("focusout", function (e) {
        var td = e.target && e.target.closest ? e.target.closest("td[data-mx]") : null;
        if (td) commitMx(td);
      });
      tbEl.addEventListener("keydown", function (e) {
        var td = e.target && e.target.closest ? e.target.closest("td[data-mx]") : null;
        if (!td) return;
        if (e.key === "Enter") { e.preventDefault(); commitMx(td); td.blur(); }
        if (e.key === "Escape") { td.textContent = td.getAttribute("data-orig") || ""; stopEditingCell(td); td.blur(); }
      });
      attachDblClickEdit(tbEl, "td[data-mx]");
    }
  }

  var clrMx = view.querySelector("#clrMx");
  if (clrMx) clrMx.addEventListener("click", function () {
    var snap = MXO.snapshot();
    HISTORY.perform({
      label: "reset all overrides",
      apply: function () { MXO.clear(); },
      revert: function () { MXO.restoreAll(snap); }
    });
    render();
  });

  view.querySelectorAll("[data-metric]").forEach(function (b) {
    b.addEventListener("click", function () { state.metric = b.getAttribute("data-metric"); render(); });
  });
  var provSel = view.querySelector("#provSel");
  if (provSel) provSel.addEventListener("change", function () { state.provFilter = provSel.value; render(); });
  wireSearchSort(view);

  var clrF = view.querySelector("#clrFilters");
  if (clrF) clrF.addEventListener("click", function () {
    var prev = vstate.filters.name;
    HISTORY.perform({
      label: "clear client filter",
      apply: function () { delete vstate.filters.name; },
      revert: function () { vstate.filters.name = prev; }
    });
    render();
  });
  attachColumnFilters(view.querySelector("thead tr.hdr-row"), vstate,
    function onSort(key, dir) {
      var prev = vstate.sort, next = { col: key, dir: dir };
      HISTORY.perform({
        label: "sort by client",
        apply: function () { vstate.sort = next; },
        revert: function () { vstate.sort = prev; }
      });
      render();
    },
    function onFilterApply(key, set) {
      var prev = vstate.filters[key];
      HISTORY.perform({
        label: "filter client",
        apply: function () { if (set) vstate.filters[key] = set; else delete vstate.filters[key]; },
        revert: function () { if (prev) vstate.filters[key] = prev; else delete vstate.filters[key]; }
      });
      render();
    },
    function uniqueValuesFn() { return Array.from(names).sort(); }
  );

  window.__csv = function () { return matrixCSV(months, rows, colTot, grand, opts.title); };
}

export function matrixCSV(months, rows, colTot, grand, title) {
  var lines = [["Client"].concat(months.map(function (m) { return m.label; })).concat(["Total"]).join(",")];
  lines.push(["TOTAL"].concat(colTot.map(function (v) { return Math.round(v); })).concat([Math.round(grand)]).join(","));
  rows.forEach(function (r) {
    lines.push(['"' + r.name.replace(/"/g, '""') + '"']
      .concat(r.vals.map(function (v) { return Math.round(v); }))
      .concat([Math.round(r.total)]).join(","));
  });
  return { name: title.replace(/[^\w]+/g, "_") + "_" + state.fy + ".csv", body: lines.join("\n") };
}
