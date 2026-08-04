/* Shared pieces of every grid's toolbar: KPI cards, the right-aligned
   undo/redo + add-client + FY-select + CSV cluster, and search/sort wiring. */
"use strict";

import { canEdit } from "../state/auth.js";
import { HISTORY } from "../state/history.js";
import { render } from "../core/bus.js";
import { FYS } from "../core/dates.js";
import { state } from "../state/app-state.js";

export function kpiCard(k, v, s, cls) {
  return '<div class="kpi"><div class="k">' + k + '</div><div class="v tab-num">' + v + "</div>" +
    (s ? '<div class="s tab-num ' + (cls || "") + '">' + s + "</div>" : "") + "</div>";
}

export function toolbarControlsHTML() {
  return '<span class="tb-right">' +
    /* Undo/redo isn't admin-only — filtering/sorting (also on the shared
       HISTORY stack) is something every role can do and undo. Only adding
       a client is an actual data edit, gated to admins. */
    '<span class="undo-redo">' +
    '<button class="icon-btn" id="undoBtn" title="Undo (Ctrl+Z)"' + (HISTORY.canUndo() ? "" : " disabled") + ">↺</button>" +
    '<button class="icon-btn" id="redoBtn" title="Redo (Ctrl+U, or Ctrl+Shift+Z)"' + (HISTORY.canRedo() ? "" : " disabled") + ">↻</button>" +
    "</span>" +
    (canEdit() ? '<button class="btn-primary" id="addBtn" title="Add a new client line">+ Add client</button>' : "") +
    '<select id="fySel" title="Financial year">' +
    FYS.map(function (f) {
      return '<option value="' + f.id + '"' + (f.id === state.fy ? " selected" : "") + ">" + f.label + "</option>";
    }).join("") +
    "</select>" +
    '<button class="icon-btn" id="exportBtn" title="Download this view as CSV">↓ CSV</button>' +
    "</span>";
}

/* Standalone undo/redo cluster for toolbars that don't use the full
   toolbarControlsHTML() (no FY select / add-client) — e.g. Invoice Dump. */
export function undoRedoHTML() {
  return '<span class="undo-redo">' +
    '<button class="icon-btn" id="undoBtn" title="Undo (Ctrl+Z)"' + (HISTORY.canUndo() ? "" : " disabled") + ">↺</button>" +
    '<button class="icon-btn" id="redoBtn" title="Redo (Ctrl+U, or Ctrl+Shift+Z)"' + (HISTORY.canRedo() ? "" : " disabled") + ">↻</button>" +
    "</span>";
}

export function wireSearchSort(view) {
  var q = view.querySelector("#q");
  if (q) {
    var t;
    q.addEventListener("input", function () {
      clearTimeout(t);
      t = setTimeout(function () { state.search = q.value; render(true); }, 180);
    });
  }
  var ss = view.querySelector("#sortSel");
  if (ss) ss.addEventListener("change", function () { state.sort = ss.value; render(); });
}

export var MONTH_W = 108;
export var LEDGER_COLS = [
  { label: "Invoice No.", f: "inv", w: 158 },
  { label: "Client Name", f: "client", w: 270 },
  { label: "Invoice Date", f: "invdate", w: 112 },
  { label: "Item", f: "item", edit: true, w: 220 },
  { label: "Product", f: "product", edit: true, w: 150 },
  { label: "Item Description", f: "desc", edit: true, w: 300 },
  { label: "One-time / Recurring", f: "rec", edit: true, w: 150 },
  { label: "User Count", f: "users", num: true, edit: true, w: 100 },
  { label: "Start Date", f: "start", edit: true, w: 112 },
  { label: "End Date", f: "end", edit: true, w: 112 },
  { label: "Amount", f: "amount", num: true, edit: true, w: 125 }
];
export var CREDIT_COLS = LEDGER_COLS.map(function (c) {
  return c.f === "inv" ? { label: "Credit Note No.", f: "inv", w: 158 }
    : c.f === "invdate" ? { label: "Credit Note Date", f: "invdate", w: 118 } : c;
});
