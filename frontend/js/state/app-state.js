/* App-wide mutable state: the loaded ledger, UI state (current tab/FY/
   search/sort), the tab list, and the ready flag the very first render
   waits on. */
"use strict";

import { FYS } from "../core/dates.js";

export var S = { consol: null, credit: null, dims: null, invoiceDump: null, creditNoteDump: null, mrrSeed: null };
export var readyFlag = { value: false };

var TAB_IDS = ["mrr", "recurr", "consol", "invoice", "creditworking", "credit", "onetime"];
function lastTab() {
  try {
    var saved = localStorage.getItem("ra_last_tab");
    if (saved && TAB_IDS.indexOf(saved) !== -1) return saved;
  } catch (e) {}
  return "recurr";
}

export var state = {
  tab: lastTab(), fy: "2024-25", metric: "net", search: "", sort: "total_desc", flagOnly: false, provFilter: "all",
  /* MRR Movement's own two-month picker — null means "not chosen yet",
     resolved to the two most recent months with data on first render. */
  mrrA: null, mrrB: null, mrrMoveFilter: "all", mrrTierMetric: "mrr",
  /* Product breakdown's own 3-month trend picker — null means "not chosen
     yet", each defaults to trailing off Bridge's Month B (Month B and the
     two months before it) until the admin picks something else. */
  mrrTrend1: null, mrrTrend2: null, mrrTrend3: null,
  /* Tier summary's FY picker — null means "not chosen yet", defaults to
     whichever FY Bridge's Month B falls in. */
  mrrTierFY: null
};

export var TABS = [
  { id: "mrr",            label: "MRR" },
  { id: "recurr",        label: "Recurring Revenue" },
  { id: "consol",        label: "Invoice working" },
  { id: "invoice",       label: "Invoice Dump" },
  { id: "creditworking", label: "Credit Note Working" },
  { id: "credit",        label: "Credit Note" },
  { id: "onetime",       label: "One time" }
];

export function curFY() { return FYS.filter(function (f) { return f.id === state.fy; })[0] || FYS[2]; }
