/* Confirm/churn state for provisional (projected) months in Recurring
   Revenue — see data/revenue.js's computeProvisional() for what makes a
   client+month provisional in the first place. No entry here = "pending":
   still just a projection, counted in revenue, waiting on a real invoice
   or an admin decision either way. */
"use strict";

import { store } from "../core/store.js";

var STATUS = store("ra_recurring_status_v1");   // "client|monthLabel" -> "confirmed" | "churned"

function key(client, monthLabel) { return client + "|" + monthLabel; }

export function getProvStatus(client, monthLabel) { return STATUS.get(key(client, monthLabel)); }
export function setProvStatus(client, monthLabel, status) { STATUS.set(key(client, monthLabel), status); }
export function clearProvStatus(client, monthLabel) { STATUS.del(key(client, monthLabel)); }
