/* Per-row field access, honouring edits over source values. A row is a
   fixed-shape array (dictionary-encoded strings, numeric-encoded dates);
   these are the only functions that know that shape. */
"use strict";

import { fmtDate, parseUserDate } from "../core/dates.js";
import { getEdit } from "../state/stores.js";
import { getProduct } from "../state/item-product-map.js";

/* Item -> Product map takes precedence over the value baked into the
   dataset at build time — that's the whole point of the mapping tool: an
   admin assigns a product for an item once, and it applies to every row
   carrying that item name from then on, without needing new data to be
   rebuilt. A per-row inline edit on the Product cell itself still wins
   over both, same as every other editable field here. */
function mappedProduct(ds, r) {
  var mapped = getProduct(ds.dicts.item[r[3]]);
  return mapped !== null ? mapped : ds.dicts.product[r[4]];
}

export function fieldVal(ds, sheet, ri, field) {
  var e = getEdit(sheet, ri, field);
  if (e !== undefined) return e;
  var r = ds.rows[ri], d = ds.dicts;
  switch (field) {
    case "inv": return d.inv[r[0]];
    case "client": return d.client[r[1]];
    case "invdate": return fmtDate(r[2]);
    case "item": return d.item[r[3]];
    case "product": return mappedProduct(ds, r);
    case "desc": return d.desc[r[5]];
    case "rec": return r[6] ? "Recurring" : "One-time";
    case "users": return r[7];
    case "start": return fmtDate(r[8]);
    case "end": return fmtDate(r[9]);
    case "amount": return r[10];
  }
  return "";
}

export function effAmount(ds, sheet, ri) {
  var e = getEdit(sheet, ri, "amount");
  if (e !== undefined) {
    var n = parseFloat(String(e).replace(/[^0-9.\-]/g, ""));
    if (!isNaN(n)) return n;
  }
  return ds.rows[ri][10];
}
export function effRec(ds, sheet, ri) {
  var e = getEdit(sheet, ri, "rec");
  if (e !== undefined) return /recur/i.test(e) ? 1 : 0;
  return ds.rows[ri][6];
}
export function effProduct(ds, sheet, ri) {
  var e = getEdit(sheet, ri, "product");
  return e !== undefined ? e : mappedProduct(ds, ds.rows[ri]);
}
/* service period, honouring edited dates — so filling a blank date on a
   flagged row immediately brings its revenue into every total */
export function effPeriod(ds, sheet, ri) {
  var r = ds.rows[ri];
  var s = r[8], e = r[9];
  var es = getEdit(sheet, ri, "start"), ee = getEdit(sheet, ri, "end");
  if (es !== undefined) s = parseUserDate(es);
  if (ee !== undefined) e = parseUserDate(ee);
  if (s === null || s === undefined || e === null || e === undefined || e < s) return null;
  return { s: s, e: e };
}
