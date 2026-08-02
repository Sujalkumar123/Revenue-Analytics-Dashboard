/* App-wide mutable state: the loaded ledger, UI state (current tab/FY/
   search/sort), the tab list, and the ready flag the very first render
   waits on. */
"use strict";

import { FYS } from "../core/dates.js";

export var S = { consol: null, credit: null, dims: null };
export var readyFlag = { value: false };

export var state = { tab: "recurr", fy: "2024-25", metric: "net", search: "", sort: "total_desc", flagOnly: false };

export var TABS = [
  { id: "recurr",  label: "Recurring Revenue by Client" },
  { id: "consol",  label: "Consol Sheet" },
  { id: "invoice", label: "Invoice Dump" },
  { id: "credit",  label: "Credit Notes" },
  { id: "sfagt",   label: "SFA GT",        product: "GT subscription" },
  { id: "dms",     label: "DMS",           product: "DMS subscription" },
  { id: "sfamt",   label: "SFA MT",        product: "MT subscription" },
  { id: "flo",     label: "Flo",           product: "Flo subscription" },
  { id: "other",   label: "Other Modules", product: "Other modules" },
  { id: "onetime", label: "One-time (OTC)" }
];

export function curFY() { return FYS.filter(function (f) { return f.id === state.fy; })[0] || FYS[2]; }
