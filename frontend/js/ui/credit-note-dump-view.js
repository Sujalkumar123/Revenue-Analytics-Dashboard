/* Credit Notes tab — a faithful, read-only mirror of the raw Zoho credit
   note export. Deliberately separate from the existing creditnotes.json
   dataset, which still drives Net revenue (Gross - Credit) on Recurring
   Revenue and the product tabs — that stays untouched. See
   raw-dump-view.js for the shared table/filter/sort machinery. */
"use strict";

import { S } from "../state/app-state.js";
import { renderRawDump } from "./raw-dump-view.js";

export var CREDIT_NOTE_DUMP_COLS = [
  { key: "cndate", label: "Credit Note Date", w: 120 },
  { key: "cn", label: "Credit Note Number", w: 150 },
  { key: "status", label: "Status", w: 100 },
  { key: "client", label: "Customer Name", w: 260 },
  { key: "total", label: "Total", w: 110, num: true },
  { key: "einvoice", label: "e-Invoice Status", w: 120 },
  { key: "assocInv", label: "Associated Invoice No.", w: 160 },
  { key: "assocInvDate", label: "Associated Invoice Date", w: 150 },
  { key: "currency", label: "Currency", w: 85 },
  { key: "fx", label: "Exchange Rate", w: 105, num: true },
  { key: "item", label: "Item Name", w: 220 },
  { key: "desc", label: "Item Description", w: 260 },
  { key: "qty", label: "Quantity", w: 90, num: true },
  { key: "price", label: "Item Price", w: 110, num: true },
  { key: "itemTotal", label: "Item Total", w: 120, num: true },
  { key: "taxable", label: "Taxable Amount", w: 130, num: true },
  { key: "usageFrom", label: "Usage Period (From)", w: 145 },
  { key: "usageTill", label: "Usage Period (Till)", w: 145 },
];

export function renderCreditNoteDump() {
  renderRawDump({
    key: "creditNoteDump",
    cols: CREDIT_NOTE_DUMP_COLS,
    getRows: function () { return (S.creditNoteDump && S.creditNoteDump.rows) || []; },
    dateKey: "cndate",
    searchFields: ["cn", "client", "item", "assocInv"],
    searchPlaceholder: "Search credit note no, client, item, associated invoice…",
    totalField: "taxable",
    totalLabel: "Taxable value (view)",
    totalColLabel: "Taxable Amount",
    csvName: "Credit_Notes.csv"
  });
}
