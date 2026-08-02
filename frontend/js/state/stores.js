/* The three mutable data stores layered on top of the read-only source
   ledger: manual field edits, admin-added rows, and Recurring-Revenue
   matrix overrides — plus the small helpers every render path uses to
   read/write them consistently. */
"use strict";

import { store } from "../core/store.js";

export var EDITS = store("ra_edits_v1");   // "sheet|rowIndex|field" -> value
export var ADDS = store("ra_adds_v1");     // "sheet" -> [rowArray, ...]
export var MXO = store("ra_matrix_v1");    // client×month overrides on the analytic sheet

export function editKey(sheet, ri, f) { return sheet + "|" + ri + "|" + f; }
export function getEdit(sheet, ri, f) { return EDITS.get(editKey(sheet, ri, f)); }
export function setEdit(sheet, ri, f, v) { EDITS.set(editKey(sheet, ri, f), v); }
export function isEdited(sheet, ri, f) { return getEdit(sheet, ri, f) !== undefined; }
export function editCount(sheet) {
  var n = 0, all = EDITS.all();
  for (var k in all) if (k.indexOf(sheet + "|") === 0) n++;
  return n;
}

/* rows the user added, appended after the source rows on load */
export var addedFrom = { consol: Infinity, credit: Infinity };
export function applyAdds(sheet, ds) {
  var list = ADDS.get(sheet) || [];
  addedFrom[sheet] = ds.rows.length;
  for (var i = 0; i < list.length; i++) ds.rows.push(list[i]);
}
export function isAdded(sheet, ri) { return ri >= addedFrom[sheet]; }

export function dictAdd(dict, val) {
  val = String(val == null ? "" : val);
  var i = dict.indexOf(val);
  if (i < 0) { dict.push(val); i = dict.length - 1; }
  return i;
}

/* Overrides typed straight onto the Recurring Revenue grid. Keyed by the
   things that identify the cell across re-renders and FY switches. */
export function mxKey(tab, metric, fy, monthLabel, client) {
  return [tab, metric, fy, monthLabel, client].join("|");
}
export function mxCount() {
  var n = 0, all = MXO.all();
  for (var k in all) n++;
  return n;
}
