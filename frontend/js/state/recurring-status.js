/* Confirm/churn state for provisional (projected) months in Recurring
   Revenue — see data/revenue.js's computeProvisional() for what makes a
   client+month provisional in the first place. No entry here = "pending":
   still just a projection, counted in revenue, waiting on a real invoice
   or an admin decision either way.

   Confirmed/churned aren't permanent flags — they're a 2-real-month
   reminder. The colored border + button on the cell disappears once
   either a real invoice lands for that month (handled in matrix-view.js,
   which stops treating a month as provisional at all once it has real
   gross) or once 2 calendar months pass since the click, whichever comes
   first — at that point it quietly becomes a plain cell, same as any
   other. The underlying number is untouched either way: confirming never
   changed the figure, and churning stays excluded from revenue even after
   its border fades — expiry only retires the visual reminder, not the
   decision itself. */
"use strict";

import { store } from "../core/store.js";

var STATUS = store("ra_recurring_status_v1");   // "client|monthLabel" -> { status: "confirmed"|"churned", setAt: <ms timestamp> }
var EXPIRE_MONTHS = 2;

function key(client, monthLabel) { return client + "|" + monthLabel; }

export function getProvStatus(client, monthLabel) {
  var v = STATUS.get(key(client, monthLabel));
  if (v == null) return undefined;
  return typeof v === "string" ? v : v.status;   // tolerate the old plain-string format
}
export function setProvStatus(client, monthLabel, status) {
  STATUS.set(key(client, monthLabel), { status: status, setAt: Date.now() });
}
export function clearProvStatus(client, monthLabel) { STATUS.del(key(client, monthLabel)); }

/* True once EXPIRE_MONTHS real calendar months have passed since the
   status was set — an entry in the old plain-string format has no
   timestamp to check, so it's treated as already past due. Only ever
   meaningful for "confirmed"/"churned"; a "pending" cell has no stored
   entry and never expires on its own. */
export function isProvExpired(client, monthLabel) {
  var v = STATUS.get(key(client, monthLabel));
  if (!v || typeof v === "string") return true;
  var set = new Date(v.setAt), now = new Date();
  var months = (now.getFullYear() - set.getFullYear()) * 12 + (now.getMonth() - set.getMonth());
  return months >= EXPIRE_MONTHS;
}
