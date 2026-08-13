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
import { aggregate, onlyRecurring, computeProvisional } from "../data/revenue.js";
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
  }

  var moveSel = view.querySelector("#moveSel");
  if (moveSel) moveSel.addEventListener("change", function () { state.mrrMoveFilter = moveSel.value; render(); });
  var mA = view.querySelector("#monthASel"), mB = view.querySelector("#monthBSel");
  if (mA) mA.addEventListener("change", function () { state.mrrA = mA.value; render(); });
  if (mB) mB.addEventListener("change", function () { state.mrrB = mB.value; render(); });
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
