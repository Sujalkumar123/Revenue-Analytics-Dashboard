/* App-wide mutable state: the loaded ledger, UI state (current tab/FY/
   search/sort), the tab list, and the ready flag the very first render
   waits on. */
"use strict";

import { FYS } from "../core/dates.js";

export var S = { consol: null, credit: null, dims: null, invoiceDump: null, creditNoteDump: null };
export var readyFlag = { value: false };

export var state = { tab: "recurr", fy: "2024-25", metric: "net", search: "", sort: "total_desc", flagOnly: false };

export var TABS = [
  { id: "recurr",        label: "Recurring Revenue" },
  { id: "consol",        label: "Invoice working" },
  { id: "invoice",       label: "Invoice Dump" },
  { id: "creditworking", label: "Credit Note Working" },
  { id: "credit",        label: "Credit Note" },
  { id: "onetime",       label: "One time" }
];

export function curFY() { return FYS.filter(function (f) { return f.id === state.fy; })[0] || FYS[2]; }
