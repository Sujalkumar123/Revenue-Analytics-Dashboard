/* Tab dispatch: picks the right view (matrix or ledger) and options for the
   current state.tab, mirroring where each tab's data actually comes from —
   Invoice Dump and Credit Notes mirror the Zoho API and stay read-only; the
   Recurring Revenue sheet is the analytic layer and is editable. */
"use strict";

import { state, TABS, S, readyFlag } from "./state/app-state.js";
import { onlyRecurring, onlyOneTime, recurringProduct } from "./data/revenue.js";
import { renderMatrix } from "./ui/matrix-view.js";
import { renderLedger } from "./ui/ledger-view.js";
import { renderInvoiceDump } from "./ui/invoice-dump-view.js";
import { LEDGER_COLS, CREDIT_COLS } from "./ui/toolbar.js";
import { SEL } from "./ui/selection.js";

export function render(keepFocus) {
  if (!readyFlag.value) return;
  var t = TABS.filter(function (x) { return x.id === state.tab; })[0];
  var focusId = keepFocus && document.activeElement ? document.activeElement.id : null;
  var selStart = focusId === "q" ? document.activeElement.selectionStart : null;
  SEL.clear();

  if (state.tab === "recurr") {
    renderMatrix({ title: "Recurring Revenue by Client", filter: onlyRecurring, netable: true, editable: true });
  } else if (state.tab === "onetime") {
    renderMatrix({ title: "One-time Charges (OTC) by Client", filter: onlyOneTime, netable: false });
  } else if (t && t.product) {
    renderMatrix({ title: t.label + " — Recurring Revenue", filter: recurringProduct(t.product), netable: false });
  } else if (state.tab === "consol") {
    renderLedger({
      ds: S.consol, sheet: "consol", cols: LEDGER_COLS,
      title: "Consol Sheet", source: "Zoho Books", kpiSub: "invoice lines"
    });
  } else if (state.tab === "invoice") {
    renderInvoiceDump();
  } else if (state.tab === "credit") {
    renderLedger({
      ds: S.credit, sheet: "credit", cols: CREDIT_COLS, readOnly: true,
      title: "Credit Notes Register", source: "Zoho Books", kpiSub: "credit-note lines"
    });
  }

  if (focusId === "q") {
    var q = document.getElementById("q");
    if (q) { q.focus(); try { q.setSelectionRange(selStart, selStart); } catch (e) {} }
  }
}
