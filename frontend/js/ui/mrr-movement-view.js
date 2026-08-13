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
var PRODUCTS = [
  { key: "gt", label: "SFA GT", product: "GT subscription" },
  { key: "dms", label: "DMS", product: "DMS subscription" },
  { key: "mt", label: "SFA MT", product: "MT subscription" },
  { key: "flo", label: "Flo", product: "Flo subscription" },
  { key: "other", label: "Other modules", product: "Other modules" }
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

  /* Second section: a 3-month trend of each client's total (still
     provisional-aware, via resolved()) plus a per-product snapshot for
     the latest month only. Product figures are real invoiced amounts only
     — computeProvisional() blends a client's projection at the whole-
     client level, not per product, so there's nothing to project a single
     product column from; a client currently running on a projected total
     will show 0s across every product here even though its trend/bridge
     total above is nonzero. Reuses the exact same (already filtered)
     client list as the bridge above, so the two sections never disagree
     about who's in view. */
  var trendIdx = [Math.max(0, idxB - 2), Math.max(0, idxB - 1), idxB];
  var trendMonths = trendIdx.map(function (i) { return months[i]; });
  var prodMaps = PRODUCTS.map(function (p) {
    return { gross: aggregate(S.consol, "consol", months, recurringProduct(p.product)), users: aggregateUsers(S.consol, "consol", months, recurringProduct(p.product)) };
  });
  rows.forEach(function (r) {
    var garr = gross.get(r.name);
    r.trend = trendIdx.map(function (idx) { return garr ? resolved(r.name, garr, idx) : 0; });
    r.prod = prodMaps.map(function (pm) {
      var g = pm.gross.get(r.name), u = pm.users.get(r.name);
      return { revenue: g ? (g[idxB] || 0) : 0, users: u ? (u[idxB] || 0) : 0 };
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
  var usersAll = aggregateUsers(S.consol, "consol", months, onlyRecurring);
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

  var html = '<div class="kpis">' +
    kpiCard("New MRR · " + monthB.label, inrShort(newMRR), moveCounts.new + " new client(s)") +
    kpiCard("Expansion", inrShort(growthMRR), moveCounts.growth + " growing", "up") +
    kpiCard("Contraction", inrShort(declineMRR), moveCounts.decline + " declining", "down") +
    kpiCard("Churned MRR", inrShort(churnedMRR), moveCounts.churned + " churned", "down") +
    kpiCard("Net movement", inrShort(netMRR), monthA.label + " → " + monthB.label, netMRR >= 0 ? "up" : "down") +
    "</div>";

  html += '<div class="card"><div class="toolbar">' +
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

  /* Section 2: per-product User count + Revenue snapshot, plus a 3-month
     total-MRR trend leading up to it. */
  html += '<div class="card"><div class="toolbar"><b style="font-size:13px">Product breakdown</b>' +
    '<span style="color:var(--ink-3);font-size:12px">Users + revenue for ' + esc(monthB.label) +
    ' · trend through ' + esc(trendMonths[0].label) + ' → ' + esc(trendMonths[2].label) + '</span></div>';
  html += '<div class="grid-wrap" id="gw2"><table class="grid"><thead><tr class="hdr-row">' +
    '<th class="rownum" style="width:38px"></th>' +
    '<th class="lbl sticky-l" style="width:270px">Client</th>' +
    trendMonths.map(function (m) { return '<th class="num" style="width:110px">' + esc(m.label) + "</th>"; }).join("") +
    PRODUCTS.map(function (p) {
      return '<th class="num" style="width:80px">' + esc(p.label) + ' Users</th>' +
        '<th class="num" style="width:110px">' + esc(p.label) + ' MRR</th>';
    }).join("") +
    "</tr></thead><tbody id=\"tb2\">";
  if (!rows.length) {
    html += '<tr><td colspan="' + (2 + trendMonths.length + PRODUCTS.length * 2) + '" style="padding:26px;text-align:center;color:var(--ink-3)">No matching clients.</td></tr>';
  }
  html += '</tbody></table><div class="sentinel" aria-hidden="true"></div></div>' +
    (rows.length ? loadMoreHTML(rows.length, false) : "") + "</div>";

  /* Section 3: MRR / Users / ARPU by Tier, trailing 12 months. */
  html += '<div class="card"><div class="toolbar"><b style="font-size:13px">Tier summary</b>' +
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
          r.trend.map(function (v) { return '<td class="num ' + (Math.abs(v) < 0.5 ? "zero" : "") + '">' + inr(v) + "</td>"; }).join("") +
          r.prod.map(function (p) {
            return '<td class="num ' + (p.users < 0.5 ? "zero" : "") + '">' + Math.round(p.users).toLocaleString("en-IN") + "</td>" +
              '<td class="num ' + (p.revenue < 0.5 ? "zero" : "") + '">' + inr(p.revenue) + "</td>";
          }).join("") +
          "</tr>";
      }
      return out;
    });
  }

  var moveSel = view.querySelector("#moveSel");
  if (moveSel) moveSel.addEventListener("change", function () { state.mrrMoveFilter = moveSel.value; render(); });
  var mA = view.querySelector("#monthASel"), mB = view.querySelector("#monthBSel");
  if (mA) mA.addEventListener("change", function () { state.mrrA = mA.value; render(); });
  if (mB) mB.addEventListener("change", function () { state.mrrB = mB.value; render(); });
  view.querySelectorAll("[data-tiermetric]").forEach(function (b) {
    b.addEventListener("click", function () { state.mrrTierMetric = b.getAttribute("data-tiermetric"); render(); });
  });
  wireSearchSort(view);

  window.__csv = function () {
    var lines = [["Client", "Tier", monthA.label, monthB.label, "Delta", "Movement", "Remarks"].join(",")];
    rows.forEach(function (r) {
      lines.push(['"' + r.name.replace(/"/g, '""') + '"', r.tier, Math.round(r.a), Math.round(r.b), Math.round(r.delta),
        MOVE_LABEL[r.move], '"' + r.remark.replace(/"/g, '""') + '"'].join(","));
    });
    return { name: "MRR_Movement_" + monthA.label + "_to_" + monthB.label + ".csv", body: lines.join("\n") };
  };
}
