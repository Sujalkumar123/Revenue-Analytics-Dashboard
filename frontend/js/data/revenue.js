/* The recognition rule: day-weighted straight-line proration of an
   invoice/credit-note line across the months its service period overlaps,
   plus the client rollups built on top of it — this mirrors the workbook's
   own SUMIFS chains. */
"use strict";

import { effAmount, effPeriod, effRec, effProduct, fieldVal } from "./fields.js";

export function monthlyOf(ds, sheet, ri, months) {
  var out = new Array(months.length).fill(0);
  var p = effPeriod(ds, sheet, ri);
  if (!p) return out;                       // no service period → not recognised
  var amt = effAmount(ds, sheet, ri);
  var period = p.e - p.s + 1;
  if (period <= 0) return out;
  for (var i = 0; i < months.length; i++) {
    var m = months[i];
    if (p.e < m.s || p.s > m.e) continue;
    var lo = p.s > m.s ? p.s : m.s, hi = p.e < m.e ? p.e : m.e;
    var d = hi - lo + 1;
    if (d > 0) out[i] = amt * d / period;
  }
  return out;
}

export function aggregate(ds, sheet, months, filterFn) {
  var map = new Map();
  for (var i = 0; i < ds.rows.length; i++) {
    if (filterFn && !filterFn(ds, sheet, i)) continue;
    var name = fieldVal(ds, sheet, i, "client");
    var arr = map.get(name);
    if (!arr) { arr = new Array(months.length).fill(0); map.set(name, arr); }
    var mv = monthlyOf(ds, sheet, i, months);
    for (var m = 0; m < months.length; m++) arr[m] += mv[m];
  }
  return map;
}

export var onlyRecurring = function (ds, sheet, i) { return effRec(ds, sheet, i) === 1; };
export var onlyOneTime = function (ds, sheet, i) { return effRec(ds, sheet, i) === 0; };
export function recurringProduct(prod) {
  return function (ds, sheet, i) {
    return effRec(ds, sheet, i) === 1 && effProduct(ds, sheet, i) === prod;
  };
}
