/* MRR Movement — a month-over-month "MRR bridge" for recurring clients:
   pick two months, see who's New, growing, declining, or churned between
   them, sorted by biggest movers first. Built from the same live ledger
   every other tab uses (aggregate() over onlyRecurring rows) rather than
   a frozen import, so it never drifts from Recurring Revenue's own
   numbers — the only genuinely new data here is the per-client Tier
   classification and Remarks, neither of which exists anywhere else in
   the ledger, so those are the only two editable things on this tab. */
"use strict";

import { fyMonths } from "../core/dates.js";
import { inr, inrShort, esc } from "../core/format.js";
import { aggregate, aggregateUsers, onlyRecurring, computeProvisional, recurringProduct } from "../data/revenue.js";
import { state, S } from "../state/app-state.js";
import { canEdit } from "../state/auth.js";
import { getTier, setTier, TIERS } from "../state/client-tier.js";
import { getRemark, setRemark } from "../state/mrr-remarks.js";
import { getProvStatus } from "../state/recurring-status.js";
import { HISTORY } from "../state/history.js";
import { kpiCard, wireSearchSort } from "./toolbar.js";
import { loadMoreHTML, attachInfinite } from "./infinite-scroll.js";
import { render } from "../core/bus.js";
import { attachDblClickEdit, stopEditingCell } from "./dblclick-edit.js";

function classify(a, b) {
  var A = Math.abs(a) >= 0.5, B = Math.abs(b) >= 0.5;
  if (!A && B) return "new";
  if (A && !B) return "churned";
  if (A && B) { var d = b - a; if (d > 0.5) return "growth"; if (d < -0.5) return "decline"; }
  return "flat";
}
var MOVE_LABEL = { new: "New", growth: "Growth", decline: "Decline", churned: "Churned", flat: "Flat" };
/* Same order (and the same "Other modules has no Users column") as the
   source sheet's own column layout — it tracks Users for every product
   except Other modules, which is revenue-only there too. Each gets its
   own color so its Users+Revenue pair reads as one visual "batch" in the
   header instead of two more columns in an undifferentiated wall of them. */
var PRODUCTS = [
  { key: "gt", label: "SFA GT", product: "GT subscription", color: "accent" },
  { key: "dms", label: "DMS", product: "DMS subscription", color: "gold" },
  { key: "flo", label: "Flo", product: "Flo subscription", color: "good" },
  { key: "mt", label: "SFA MT", product: "MT subscription", color: "edit" },
  { key: "other", label: "Other modules", product: "Other modules", noUsers: true, color: "ink3" }
];

export function renderMrrMovement() {
  var months = fyMonths({ y: null });
  var gross = aggregate(S.consol, "consol", months, onlyRecurring);
  /* Same overlay Recurring Revenue uses: a client with no invoice yet for
     a month isn't necessarily churned/declining, it's usually just not
     billed yet. Without this, comparing against the most recent month
     (which is always mostly unbilled at any given moment) would flag the
     majority of the client base as "Churned" every single time — noise,
     not signal. Sharing the same status store means confirming/rejecting
     a projection here or on Recurring Revenue is the same decision either
     place. */
  var overlay = computeProvisional(S.consol, onlyRecurring);
  function resolved(client, arr, idx) {
    var raw = arr[idx] || 0;
    if (Math.abs(raw) >= 0.5) return raw;
    var co = overlay.get(client);
    if (!co) return raw;
    var proj = co.get(months[idx].label);
    if (proj === undefined) return raw;
    return (getProvStatus(client, months[idx].label) || "pending") === "churned" ? 0 : proj;
  }

  /* Default to the two most recent consecutive months that actually have
     recurring revenue in them — the last thing an admin wants on first
     load is "May-26 vs Jun-26" both reading zero because the snapshot's
     real data stops earlier than the calendar grid does. */
  var colTot = months.map(function (_, i) {
    var s = 0; gross.forEach(function (arr) { s += arr[i]; }); return s;
  });
  var lastIdx = -1;
  for (var i = 0; i < colTot.length; i++) if (colTot[i] >= 0.5) lastIdx = i;
  if (lastIdx < 1) lastIdx = months.length - 1;
  if (state.mrrA === null) state.mrrA = months[lastIdx - 1] ? months[lastIdx - 1].label : months[0].label;
  if (state.mrrB === null) state.mrrB = months[lastIdx] ? months[lastIdx].label : months[months.length - 1].label;

  var idxA = months.findIndex(function (m) { return m.label === state.mrrA; });
  var idxB = months.findIndex(function (m) { return m.label === state.mrrB; });
  if (idxA === -1) idxA = Math.max(0, lastIdx - 1);
  if (idxB === -1) idxB = lastIdx;
  var monthA = months[idxA], monthB = months[idxB];

  var editable = canEdit();
  var rows = [];
  gross.forEach(function (arr, client) {
    var a = resolved(client, arr, idxA), b = resolved(client, arr, idxB);
    if (Math.abs(a) < 0.5 && Math.abs(b) < 0.5) return;
    rows.push({ name: client, a: a, b: b, delta: b - a, move: classify(a, b), tier: getTier(client), remark: getRemark(client) });
  });

  var term = state.search.trim().toLowerCase();
  if (term) rows = rows.filter(function (r) { return r.name.toLowerCase().indexOf(term) !== -1; });

  var moveCounts = { new: 0, growth: 0, decline: 0, churned: 0, flat: 0 };
  rows.forEach(function (r) { moveCounts[r.move]++; });
  if (state.mrrMoveFilter !== "all") rows = rows.filter(function (r) { return r.move === state.mrrMoveFilter; });

  rows.sort(function (x, y) { return Math.abs(y.delta) - Math.abs(x.delta); });

  /* Second section: a 3-month trend of each client's total Users + Revenue
     (revenue still provisional-aware, via resolved()) plus a per-product
     snapshot for the latest month only — same column order as the source
     sheet (SFA, DMS, Flo, SFA MT, then Other modules revenue-only).
     Product figures are real invoiced amounts only — computeProvisional()
     blends a client's projection at the whole-client level, not per
     product, so there's nothing to project a single product column from;
     a client currently running on a projected total will show 0s across
     every product here even though its trend/bridge total above is
     nonzero. Reuses the exact same (already filtered) client list as the
     bridge above, so the two sections never disagree about who's in view. */
  var trendIdx = [Math.max(0, idxB - 2), Math.max(0, idxB - 1), idxB];
  var trendMonths = trendIdx.map(function (i) { return months[i]; });
  var prodMaps = PRODUCTS.map(function (p) {
    return { gross: aggregate(S.consol, "consol", months, recurringProduct(p.product)), users: aggregateUsers(S.consol, "consol", months, recurringProduct(p.product)) };
  });
  /* Total Users = the sum of only the seat-licensed products (everything
     except Other modules), NOT a blind sum of every recurring row's
     "users" field. Found live while building this: several "Image
     Recognition-M" lines (an Other-modules item) carry values in the
     millions in that field — clearly a scan/image count, not a user
     seat count, for that specific item. Summing it in unfiltered inflated
     one client's "Users" trend to 42+ lakh. Reusing prodMaps here (rather
     than a fresh onlyRecurring aggregateUsers call) means this fix and
     the per-product Users columns can never drift apart. */
  var usersAll = new Map();
  prodMaps.forEach(function (pm, pi) {
    if (PRODUCTS[pi].noUsers) return;
    pm.users.forEach(function (arr, client) {
      var acc = usersAll.get(client);
      if (!acc) { acc = new Array(months.length).fill(0); usersAll.set(client, acc); }
      for (var m = 0; m < months.length; m++) acc[m] += arr[m];
    });
  });
  rows.forEach(function (r) {
    var garr = gross.get(r.name), uarr = usersAll.get(r.name);
    r.trend = trendIdx.map(function (idx) {
      return { users: uarr ? (uarr[idx] || 0) : 0, revenue: garr ? resolved(r.name, garr, idx) : 0 };
    });
    r.prod = prodMaps.map(function (pm) {
      var g = pm.gross.get(r.name), u = pm.users.get(r.name);
      return trendIdx.map(function (idx) {
        return { revenue: g ? (g[idx] || 0) : 0, users: u ? (u[idx] || 0) : 0 };
      });
    });
  });

  /* Third section: the Summary sheet's own view — MRR, Users and ARPU
     trended by Tier over a trailing 12 months (ending at Month B), ARPU
     being the formula the sheet used it for: MRR / Users. Independent of
     the bridge's search/movement filter above (a segment rollup shouldn't
     change because the client list happens to be filtered to "Churned"),
     but built from the same resolved()/provisional-aware totals. */
  var tierIdx = []; for (var ti = Math.max(0, idxB - 11); ti <= idxB; ti++) tierIdx.push(ti);
  var tierMonths = tierIdx.map(function (i) { return months[i]; });
  var TIER_ROWS = TIERS.concat(["Unclassified"]);
  var tierData = {};
  TIER_ROWS.forEach(function (t) { tierData[t] = { mrr: new Array(tierIdx.length).fill(0), users: new Array(tierIdx.length).fill(0) }; });
  gross.forEach(function (arr, client) {
    var t = getTier(client) || "Unclassified";
    var uarr = usersAll.get(client);
    tierIdx.forEach(function (globalIdx, li) {
      tierData[t].mrr[li] += resolved(client, arr, globalIdx);
      tierData[t].users[li] += uarr ? (uarr[globalIdx] || 0) : 0;
    });
  });
  var tierARPU = {};
  TIER_ROWS.forEach(function (t) {
    tierARPU[t] = tierData[t].mrr.map(function (m, li) { var u = tierData[t].users[li]; return u > 0.5 ? m / u : 0; });
  });

  var newMRR = 0, growthMRR = 0, declineMRR = 0, churnedMRR = 0;
  rows.forEach(function (r) {
    if (r.move === "new") newMRR += r.b;
    else if (r.move === "growth") growthMRR += r.delta;
    else if (r.move === "decline") declineMRR += r.delta;
    else if (r.move === "churned") churnedMRR -= r.a;
  });
  var netMRR = newMRR + growthMRR + declineMRR + churnedMRR;

  /* Fixed jump-nav, left edge — three sections stacked on one page reads
     as "mixed together" once you're scrolled past the first one, and
     scrolling back up to switch between them is dead time when you're in
     a hurry. position:fixed so it stays put regardless of scroll depth;
     each link just jumps straight to its section's anchor. */
  var html = '<div class="mrr-nav" aria-label="Jump to section">' +
    '<a href="#mrrBridge" class="mrr-nav-link mrr-nav-bridge" title="MRR Bridge">Bridge</a>' +
    '<a href="#mrrProduct" class="mrr-nav-link mrr-nav-product" title="Product breakdown">Products</a>' +
    '<a href="#mrrTier" class="mrr-nav-link mrr-nav-tier" title="Tier summary">Tiers</a>' +
    "</div>";

  html += '<div class="kpis">' +
    kpiCard("New MRR · " + monthB.label, inrShort(newMRR), moveCounts.new + " new client(s)") +
    kpiCard("Expansion", inrShort(growthMRR), moveCounts.growth + " growing", "up") +
    kpiCard("Contraction", inrShort(declineMRR), moveCounts.decline + " declining", "down") +
    kpiCard("Churned MRR", inrShort(churnedMRR), moveCounts.churned + " churned", "down") +
    kpiCard("Net movement", inrShort(netMRR), monthA.label + " → " + monthB.label, netMRR >= 0 ? "up" : "down") +
    "</div>";

  html += '<div class="card mrr-card mrr-card-bridge" id="mrrBridge"><div class="toolbar"><b style="font-size:13px">MRR Bridge</b>' +
    '<input type="search" id="q" placeholder="Search client…" value="' + esc(state.search) + '" />' +
    '<select id="moveSel" title="Filter by movement type">' +
    '<option value="all"' + (state.mrrMoveFilter === "all" ? " selected" : "") + ">All movement</option>" +
    '<option value="new"' + (state.mrrMoveFilter === "new" ? " selected" : "") + ">New (" + moveCounts.new + ")</option>" +
    '<option value="growth"' + (state.mrrMoveFilter === "growth" ? " selected" : "") + ">Growth (" + moveCounts.growth + ")</option>" +
    '<option value="decline"' + (state.mrrMoveFilter === "decline" ? " selected" : "") + ">Decline (" + moveCounts.decline + ")</option>" +
    '<option value="churned"' + (state.mrrMoveFilter === "churned" ? " selected" : "") + ">Churned (" + moveCounts.churned + ")</option>" +
    '<option value="flat"' + (state.mrrMoveFilter === "flat" ? " selected" : "") + ">Flat (" + moveCounts.flat + ")</option>" +
    "</select>" +
    '<span class="tb-right">' +
    '<select id="monthASel" title="Compare from">' +
    months.map(function (m) { return '<option value="' + esc(m.label) + '"' + (m.label === monthA.label ? " selected" : "") + ">" + m.label + "</option>"; }).join("") +
    "</select>" +
    '<span style="color:var(--ink-3);font-size:12.5px">→</span>' +
    '<select id="monthBSel" title="Compare to">' +
    months.map(function (m) { return '<option value="' + esc(m.label) + '"' + (m.label === monthB.label ? " selected" : "") + ">" + m.label + "</option>"; }).join("") +
    "</select>" +
    (editable ? "" : '<span class="badge-lock">🔒 Read-only — tier and remarks are admin-editable</span>') +
    "</span></div>";

  html += '<div class="grid-wrap" id="gw"><table class="grid"><thead><tr class="hdr-row">' +
    '<th class="rownum" style="width:38px"></th>' +
    '<th class="lbl sticky-l" style="width:270px">Client</th>' +
    '<th class="lbl" style="width:130px">Tier</th>' +
    '<th class="num" style="width:130px">' + esc(monthA.label) + "</th>" +
    '<th class="num" style="width:130px">' + esc(monthB.label) + "</th>" +
    '<th class="num" style="width:130px">Δ</th>' +
    '<th class="lbl" style="width:100px">Movement</th>' +
    '<th class="lbl" style="width:280px">Remarks</th></tr></thead><tbody id="tb">';

  if (!rows.length) {
    html += '<tr><td colspan="8" style="padding:26px;text-align:center;color:var(--ink-3)">No matching clients.</td></tr>';
  }
  html += '</tbody></table><div class="sentinel" aria-hidden="true"></div></div>' +
    (rows.length ? loadMoreHTML(rows.length, true) : "") + "</div>";

  /* Section 2: 3-month trend of Total Users + Revenue, plus product-level
     detail gated behind a dropdown instead of all five products' full
     trends laid out side by side — the original all-columns-at-once
     version hit 35 columns wide, which was more "scroll forever" than
     "identify instantly." Default ("All products") shows one compact
     key-value cell per product — revenue + user count together, latest
     month only. Picking a specific product swaps that whole row of
     summaries for just that one product's full 3-month trend (matching
     Total's own layout), so the detail is there when wanted without
     forcing everyone to pay for it by default. */
  var focusedProducts = state.mrrProductFocus === "all" ? PRODUCTS : PRODUCTS.filter(function (p) { return p.key === state.mrrProductFocus; });
  var focusedIsAll = state.mrrProductFocus === "all";
  var prodColCount = focusedIsAll ? PRODUCTS.length : focusedProducts.reduce(function (n, p) { return n + (p.noUsers ? 1 : 2) * trendMonths.length; }, 0);
  var leafCols = [{ w: 38 }, { w: 270 }];
  trendMonths.forEach(function () { leafCols.push({ w: 90 }, { w: 110 }); });
  if (focusedIsAll) {
    PRODUCTS.forEach(function () { leafCols.push({ w: 160 }); });
  } else {
    focusedProducts.forEach(function (p) {
      trendMonths.forEach(function () { if (!p.noUsers) leafCols.push({ w: 80 }); leafCols.push({ w: 110 }); });
    });
  }
  html += '<div class="card mrr-card mrr-card-product" id="mrrProduct"><div class="toolbar"><b style="font-size:13px">Product breakdown</b>' +
    '<input type="search" id="q2" placeholder="Search client…" value="' + esc(state.search) + '" />' +
    '<select id="prodFocusSel" title="Show one product\'s full 3-month trend">' +
    '<option value="all"' + (focusedIsAll ? " selected" : "") + ">All products (summary)</option>" +
    PRODUCTS.map(function (p) { return '<option value="' + p.key + '"' + (state.mrrProductFocus === p.key ? " selected" : "") + ">" + esc(p.label) + " (full trend)</option>"; }).join("") +
    "</select>" +
    '<span style="color:var(--ink-3);font-size:12px">Users + revenue, ' + esc(trendMonths[0].label) + ' → ' + esc(trendMonths[2].label) + '</span></div>';
  html += '<div class="grid-wrap" id="gw2"><table class="grid">' +
    "<colgroup>" + leafCols.map(function (c) { return '<col style="width:' + c.w + 'px">'; }).join("") + "</colgroup>" +
    '<thead><tr class="hdr-row hdr-batch-row">' +
    '<th class="rownum" rowspan="2"></th>' +
    '<th class="lbl sticky-l" rowspan="2">Client</th>' +
    '<th class="num hdr-batch-total" colspan="' + (trendMonths.length * 2) + '">Total</th>' +
    (focusedIsAll
      ? PRODUCTS.map(function (p) { return '<th class="num batch-' + p.color + ' grp-edge" rowspan="2">' + esc(p.label) + "</th>"; }).join("")
      : focusedProducts.map(function (p) {
        return '<th class="num batch-' + p.color + ' grp-edge" colspan="' + ((p.noUsers ? 1 : 2) * trendMonths.length) + '">' + esc(p.label) + " — full trend</th>";
      }).join("")) +
    '</tr><tr class="hdr-row hdr-subrow">' +
    trendMonths.map(function (m) {
      return '<th class="num">' + esc(m.label) + ' Users</th>' +
        '<th class="num">' + esc(m.label) + ' Revenue</th>';
    }).join("") +
    (focusedIsAll ? "" : focusedProducts.map(function (p) {
      return trendMonths.map(function (m, mi) {
        var edge = mi === 0 ? " grp-edge" : "";
        return (p.noUsers ? "" : '<th class="num batch-' + p.color + edge + '">' + esc(m.label) + ' Users</th>') +
          '<th class="num batch-' + p.color + (p.noUsers ? edge : "") + '">' + esc(m.label) + ' Revenue</th>';
      }).join("");
    }).join("")) +
    "</tr></thead><tbody id=\"tb2\">";
  if (!rows.length) {
    html += '<tr><td colspan="' + (2 + trendMonths.length * 2 + prodColCount) + '" style="padding:26px;text-align:center;color:var(--ink-3)">No matching clients.</td></tr>';
  }
  html += '</tbody></table><div class="sentinel" aria-hidden="true"></div></div>' +
    (rows.length ? loadMoreHTML(rows.length, false) : "") + "</div>";

  /* Section 3: MRR / Users / ARPU by Tier, trailing 12 months. */
  html += '<div class="card mrr-card mrr-card-tier" id="mrrTier"><div class="toolbar"><b style="font-size:13px">Tier summary</b>' +
    '<div class="seg" role="group" aria-label="Tier metric">' +
    '<button data-tiermetric="mrr" aria-pressed="' + (state.mrrTierMetric === "mrr") + '">MRR</button>' +
    '<button data-tiermetric="users" aria-pressed="' + (state.mrrTierMetric === "users") + '">Users</button>' +
    '<button data-tiermetric="arpu" aria-pressed="' + (state.mrrTierMetric === "arpu") + '">ARPU</button></div></div>';
  html += '<div class="grid-wrap"><table class="grid"><thead><tr class="hdr-row">' +
    '<th class="lbl sticky-l" style="width:150px">Tier</th>' +
    tierMonths.map(function (m) { return '<th class="num" style="width:110px">' + esc(m.label) + "</th>"; }).join("") +
    (state.mrrTierMetric === "mrr" ? '<th class="num" style="width:130px">Total</th>' : "") +
    "</tr></thead><tbody>";
  TIER_ROWS.forEach(function (t) {
    var series = state.mrrTierMetric === "mrr" ? tierData[t].mrr : state.mrrTierMetric === "users" ? tierData[t].users : tierARPU[t];
    var tot = tierData[t].mrr.reduce(function (a, b) { return a + b; }, 0);
    html += '<tr><td class="lbl sticky-l" title="' + esc(t) + '">' + esc(t) + "</td>" +
      series.map(function (v) {
        return '<td class="num ' + (Math.abs(v) < 0.5 ? "zero" : "") + '">' +
          (state.mrrTierMetric === "users" ? Math.round(v).toLocaleString("en-IN") : inr(v)) + "</td>";
      }).join("") +
      (state.mrrTierMetric === "mrr" ? '<td class="num"><b>' + inr(tot) + "</b></td>" : "") +
      "</tr>";
  });
  html += "</tbody></table></div></div>";

  var view = document.getElementById("view");
  view.innerHTML = html;

  function tierOptionsHTML(sel) {
    return '<option value=""' + (sel === "" ? " selected" : "") + ">–</option>" +
      TIERS.map(function (t) { return '<option value="' + esc(t) + '"' + (t === sel ? " selected" : "") + ">" + esc(t) + "</option>"; }).join("");
  }

  if (rows.length) {
    attachInfinite(view.querySelector("#gw"), view.querySelector("#tb"), rows.length, function (from, to) {
      var out = "";
      for (var i = from; i < to; i++) {
        var r = rows[i];
        out += '<tr><td class="rownum">' + (i + 1) + "</td>" +
          '<td class="sticky-l cname" title="' + esc(r.name) + '">' + esc(r.name) + "</td>" +
          '<td class="lbl">' + (editable
            ? '<select class="tier-sel" data-client="' + esc(r.name) + '">' + tierOptionsHTML(r.tier) + "</select>"
            : (esc(r.tier) || '<span style="color:var(--ink-3)">–</span>')) + "</td>" +
          '<td class="num">' + inr(r.a) + "</td>" +
          '<td class="num">' + inr(r.b) + "</td>" +
          '<td class="num ' + (r.delta > 0.5 ? "" : r.delta < -0.5 ? "neg" : "zero") + '">' + (r.delta > 0.5 ? "+" : "") + inr(r.delta) + "</td>" +
          '<td><span class="mv-badge mv-' + r.move + '">' + MOVE_LABEL[r.move] + "</span></td>" +
          '<td class="' + (editable ? "editable remark-cell" : "") + '"' +
          (editable ? ' data-client="' + esc(r.name) + '" data-orig="' + esc(r.remark) + '" title="Double-click to add a note"' : "") +
          ">" + esc(r.remark) + "</td></tr>";
      }
      return out;
    });

    var tbEl = view.querySelector("#tb");

    if (editable) {
      tbEl.addEventListener("change", function (e) {
        var sel = e.target.closest ? e.target.closest(".tier-sel") : null;
        if (!sel) return;
        var client = sel.getAttribute("data-client"), next = sel.value;
        var prev = getTier(client);
        HISTORY.perform({
          label: "set tier for " + client,
          apply: function () { setTier(client, next); },
          revert: function () { setTier(client, prev); }
        });
        render();
      });

      var commitRemark = function (td) {
        stopEditingCell(td);
        var nv = td.textContent.trim();
        var orig = (td.getAttribute("data-orig") || "").trim();
        if (nv === orig) return;
        var client = td.getAttribute("data-client");
        var prev = getRemark(client);
        HISTORY.perform({
          label: "set remark for " + client,
          apply: function () { setRemark(client, nv); },
          revert: function () { setRemark(client, prev); }
        });
        render();
      };
      tbEl.addEventListener("focusout", function (e) {
        var td = e.target && e.target.closest ? e.target.closest("td.remark-cell") : null;
        if (td) commitRemark(td);
      });
      tbEl.addEventListener("keydown", function (e) {
        var td = e.target && e.target.closest ? e.target.closest("td.remark-cell") : null;
        if (!td) return;
        if (e.key === "Enter") { e.preventDefault(); commitRemark(td); td.blur(); }
        if (e.key === "Escape") { td.textContent = td.getAttribute("data-orig") || ""; stopEditingCell(td); td.blur(); }
      });
      attachDblClickEdit(tbEl, "td.remark-cell");
    }

    attachInfinite(view.querySelector("#gw2"), view.querySelector("#tb2"), rows.length, function (from, to) {
      var out = "";
      for (var i = from; i < to; i++) {
        var r = rows[i];
        out += '<tr><td class="rownum">' + (i + 1) + "</td>" +
          '<td class="sticky-l cname" title="' + esc(r.name) + '">' + esc(r.name) + "</td>" +
          r.trend.map(function (t) {
            return '<td class="num ' + (t.users < 0.5 ? "zero" : "") + '">' + Math.round(t.users).toLocaleString("en-IN") + "</td>" +
              '<td class="num ' + (Math.abs(t.revenue) < 0.5 ? "zero" : "") + '">' + inr(t.revenue) + "</td>";
          }).join("") +
          (focusedIsAll
            ? PRODUCTS.map(function (pr, pi) {
              /* Key-value pair, one cell: revenue + user count together,
                 latest month only — this is the "summary" a client scans
                 fast; the full per-month breakdown is one dropdown pick
                 away instead of always taking up five groups of columns. */
              var latest = r.prod[pi][r.prod[pi].length - 1];
              var empty = Math.abs(latest.revenue) < 0.5;
              return '<td class="num batch-' + pr.color + ' grp-edge ' + (empty ? "zero" : "") + '">' +
                inrShort(latest.revenue) + (pr.noUsers || empty ? "" : '<span class="prod-users"> · ' + Math.round(latest.users).toLocaleString("en-IN") + "u</span>") +
                "</td>";
            }).join("")
            : focusedProducts.map(function (pr) {
              var pi = PRODUCTS.indexOf(pr);
              return r.prod[pi].map(function (p, mi) {
                var edge = mi === 0 ? " grp-edge" : "";
                return (pr.noUsers ? "" : '<td class="num batch-' + pr.color + edge + ' ' + (p.users < 0.5 ? "zero" : "") + '">' + Math.round(p.users).toLocaleString("en-IN") + "</td>") +
                  '<td class="num batch-' + pr.color + (pr.noUsers ? edge : "") + " " + (p.revenue < 0.5 ? "zero" : "") + '">' + inr(p.revenue) + "</td>";
              }).join("");
            }).join("")) +
          "</tr>";
      }
      return out;
    });
  }

  var moveSel = view.querySelector("#moveSel");
  if (moveSel) moveSel.addEventListener("change", function () { state.mrrMoveFilter = moveSel.value; render(); });
  var prodFocusSel = view.querySelector("#prodFocusSel");
  if (prodFocusSel) prodFocusSel.addEventListener("change", function () { state.mrrProductFocus = prodFocusSel.value; render(); });
  var mA = view.querySelector("#monthASel"), mB = view.querySelector("#monthBSel");
  if (mA) mA.addEventListener("change", function () { state.mrrA = mA.value; render(); });
  if (mB) mB.addEventListener("change", function () { state.mrrB = mB.value; render(); });
  view.querySelectorAll("[data-tiermetric]").forEach(function (b) {
    b.addEventListener("click", function () { state.mrrTierMetric = b.getAttribute("data-tiermetric"); render(); });
  });
  view.querySelectorAll(".mrr-nav-link").forEach(function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      var target = document.getElementById(a.getAttribute("href").slice(1));
      if (target) target.scrollIntoView({ behavior: "auto", block: "start" });
    });
  });
  wireSearchSort(view);
  /* Product breakdown's own search box — same shared state.search as the
     Bridge table's, just a second visible box so filtering doesn't mean
     jumping back up to the top section every time. Tier summary has no
     per-client rows (just 4 tier totals), so it has nothing to search. */
  var q2 = view.querySelector("#q2");
  if (q2) {
    var q2Timer;
    q2.addEventListener("input", function () {
      clearTimeout(q2Timer);
      q2Timer = setTimeout(function () { state.search = q2.value; render(true); }, 180);
    });
  }

  window.__csv = function () {
    var lines = [["Client", "Tier", monthA.label, monthB.label, "Delta", "Movement", "Remarks"].join(",")];
    rows.forEach(function (r) {
      lines.push(['"' + r.name.replace(/"/g, '""') + '"', r.tier, Math.round(r.a), Math.round(r.b), Math.round(r.delta),
        MOVE_LABEL[r.move], '"' + r.remark.replace(/"/g, '""') + '"'].join(","));
    });
    return { name: "MRR_Movement_" + monthA.label + "_to_" + monthB.label + ".csv", body: lines.join("\n") };
  };
}
