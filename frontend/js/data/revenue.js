/* The recognition rule: day-weighted straight-line proration of an
   invoice/credit-note line across the months its service period overlaps,
   plus the client rollups built on top of it — this mirrors the workbook's
   own SUMIFS chains. */
"use strict";

import { effAmount, effPeriod, effRec, effProduct, fieldVal } from "./fields.js";
import { fyMonths, DATA_END, EPOCH, DAY } from "../core/dates.js";

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

/* Net = Gross minus Credit, but netted per INVOICE LINE rather than at the
   aggregate client+month level: for each Invoice working line, find any
   Credit Note Working line raised against that exact invoice number and
   item, and subtract it right there, before either side gets bifurcated
   into months. Matters because the two sides used to be bifurcated and
   summed independently (own period, own client-name string) and only
   subtracted after aggregating — correct in total, but a credit note
   whose client name string didn't exactly match its invoice's (spacing,
   casing, a legal-entity suffix) would land under a different client
   bucket than the revenue it was actually offsetting. Matching by invoice
   number instead ties it to the right client unconditionally.
   creditDs.rows[i][11] is the associated invoice number, backfilled
   from the raw Credit Note export (see backend/zoho scripts) — not a
   dict-encoded field like the rest of the row, just a plain string, since
   it exists purely for this lookup and isn't rendered anywhere.
   A credit note that can't be tied to a specific invoice line this way
   (no invoice number resolved, or that invoice isn't in Invoice working)
   still reduces revenue — it just falls back to the old independent
   per-client-name bifurcation, same as before this existed. */
export function netAggregate(consolDs, creditDs, months, filterFn) {
  var creditByKey = new Map();
  for (var ci = 0; ci < creditDs.rows.length; ci++) {
    if (filterFn && !filterFn(creditDs, "credit", ci)) continue;
    var assocInv = (creditDs.rows[ci][11] || "").trim();
    if (!assocInv) continue;
    var key = assocInv + "||" + fieldVal(creditDs, "credit", ci, "item");
    var arr = creditByKey.get(key);
    if (!arr) { arr = []; creditByKey.set(key, arr); }
    arr.push(ci);
  }
  var claimed = new Array(creditDs.rows.length).fill(false);

  var map = new Map();
  function addTo(client, mv, sign) {
    var arr = map.get(client);
    if (!arr) { arr = new Array(months.length).fill(0); map.set(client, arr); }
    for (var m = 0; m < months.length; m++) arr[m] += sign * mv[m];
  }

  for (var i = 0; i < consolDs.rows.length; i++) {
    if (filterFn && !filterFn(consolDs, "consol", i)) continue;
    var client = fieldVal(consolDs, "consol", i, "client");
    addTo(client, monthlyOf(consolDs, "consol", i, months), 1);
    var key2 = fieldVal(consolDs, "consol", i, "inv") + "||" + fieldVal(consolDs, "consol", i, "item");
    var matches = creditByKey.get(key2);
    if (!matches) continue;
    for (var k = 0; k < matches.length; k++) {
      var ci2 = matches[k];
      if (claimed[ci2]) continue;
      claimed[ci2] = true;
      addTo(client, monthlyOf(creditDs, "credit", ci2, months), -1);
    }
  }

  for (var cj = 0; cj < creditDs.rows.length; cj++) {
    if (claimed[cj]) continue;
    if (filterFn && !filterFn(creditDs, "credit", cj)) continue;
    var cclient = fieldVal(creditDs, "credit", cj, "client");
    addTo(cclient, monthlyOf(creditDs, "credit", cj, months), -1);
  }

  return map;
}

/* A recurring client's revenue is predictable — same user count roughly
   bills the same amount every month — so a month with no invoice yet
   isn't necessarily "zero revenue," it's usually just "not billed/synced
   yet." For every recurring client, projects their last actual month's
   user count × per-user rate forward into every month after that up
   through DATA_END (the latest date this snapshot actually covers) that
   still has no real invoice. Computed across the FULL history regardless
   of which FY is on screen, keyed by month label, so switching FY tabs
   doesn't recompute a different answer.
   Deliberately per-CLIENT, not per-item/product: Recurring Revenue itself
   is a client×month grid, not broken down by product, so a blended
   per-client number is what actually gets displayed and edited. */
export function computeProvisional(consolDs, filterFn) {
  var allMonths = fyMonths({ y: null });
  var todayDnum = Math.round((DATA_END - EPOCH) / DAY);
  var gross = aggregate(consolDs, "consol", allMonths, filterFn);

  var usersByClient = new Map();
  for (var i = 0; i < consolDs.rows.length; i++) {
    if (filterFn && !filterFn(consolDs, "consol", i)) continue;
    var client = fieldVal(consolDs, "consol", i, "client");
    var p = effPeriod(consolDs, "consol", i);
    if (!p) continue;
    var arr = usersByClient.get(client);
    if (!arr) { arr = new Array(allMonths.length).fill(0); usersByClient.set(client, arr); }
    var u = parseFloat(fieldVal(consolDs, "consol", i, "users")) || 0;
    for (var m = 0; m < allMonths.length; m++) {
      if (allMonths[m].e < p.s || allMonths[m].s > p.e) continue;
      arr[m] += u;
    }
  }

  var overlay = new Map();   // client -> Map(monthLabel -> projected amount)
  gross.forEach(function (arr, client) {
    var lastIdx = -1;
    for (var i = 0; i < allMonths.length; i++) {
      if (allMonths[i].s > todayDnum) break;
      if (arr[i] > 0.5) lastIdx = i;
    }
    if (lastIdx === -1) return;   // this client has no actual recurring history at all
    var uArr = usersByClient.get(client);
    var lastUsers = uArr ? uArr[lastIdx] : 0;
    var lastAmount = arr[lastIdx];
    var rate = lastUsers > 0 ? lastAmount / lastUsers : null;
    var perMonth = new Map();
    for (var j = lastIdx + 1; j < allMonths.length; j++) {
      var mo = allMonths[j];
      if (mo.s > todayDnum) break;
      if (arr[j] > 0.5) continue;   // real data already showed up for this month — not a gap
      perMonth.set(mo.label, rate !== null ? rate * lastUsers : lastAmount);
    }
    if (perMonth.size) overlay.set(client, perMonth);
  });
  return overlay;
}

export var onlyRecurring = function (ds, sheet, i) { return effRec(ds, sheet, i) === 1; };
export var onlyOneTime = function (ds, sheet, i) { return effRec(ds, sheet, i) === 0; };
export function recurringProduct(prod) {
  return function (ds, sheet, i) {
    return effRec(ds, sheet, i) === 1 && effProduct(ds, sheet, i) === prod;
  };
}
