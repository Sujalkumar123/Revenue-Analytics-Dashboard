/* Tab dispatch: picks the right view (matrix or ledger) and options for the
   current state.tab, mirroring where each tab's data actually comes from —
   Invoice Dump and Credit Note mirror the Zoho API and stay read-only;
   Invoice working and Credit Note Working are the editable classification
   layers (same renderLedger component, one per dataset). */
"use strict";

import { state, S, readyFlag } from "./state/app-state.js";
import { onlyRecurring, onlyOneTime } from "./data/revenue.js";
import { renderMatrix } from "./ui/matrix-view.js";
import { renderLedger } from "./ui/ledger-view.js";
import { renderInvoiceDump } from "./ui/invoice-dump-view.js";
import { renderCreditNoteDump } from "./ui/credit-note-dump-view.js";
import { LEDGER_COLS, CREDIT_COLS } from "./ui/toolbar.js";
import { SEL } from "./ui/selection.js";

export function render(keepFocus) {
  if (!readyFlag.value) return;
  var focusId = keepFocus && document.activeElement ? document.activeElement.id : null;
  var selStart = focusId === "q" ? document.activeElement.selectionStart : null;
  SEL.clear();

  if (state.tab === "recurr") {
    renderMatrix({ title: "Recurring Revenue by Client", filter: onlyRecurring, netable: true, editable: true });
  } else if (state.tab === "onetime") {
    renderMatrix({ title: "One-time Charges (OTC) by Client", filter: onlyOneTime, netable: false });
  } else if (state.tab === "consol") {
    renderLedger({
      ds: S.consol, sheet: "consol", cols: LEDGER_COLS,
      title: "Invoice working", source: "Zoho Books", kpiSub: "invoice lines"
    });
  } else if (state.tab === "creditworking") {
    renderLedger({
      ds: S.credit, sheet: "credit", cols: CREDIT_COLS,
      title: "Credit Note Working", source: "Zoho Books", kpiSub: "credit-note lines"
    });
  } else if (state.tab === "invoice") {
    renderInvoiceDump();
  } else if (state.tab === "credit") {
    renderCreditNoteDump();
  }

  if (focusId === "q") {
    var q = document.getElementById("q");
    if (q) { q.focus(); try { q.setSelectionRange(selStart, selStart); } catch (e) {} }
  }
}
