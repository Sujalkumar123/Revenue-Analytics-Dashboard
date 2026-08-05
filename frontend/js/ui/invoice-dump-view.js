/* Invoice Dump — a faithful, read-only mirror of the raw Zoho invoice
   export. See raw-dump-view.js for the shared table/filter/sort machinery. */
"use strict";

import { S } from "../state/app-state.js";
import { renderRawDump } from "./raw-dump-view.js";

export var INVOICE_DUMP_COLS = [
  { key: "invdate", label: "Invoice Date", w: 100 },
  { key: "inv", label: "Invoice Number", w: 150 },
  { key: "status", label: "Status", w: 110 },
  { key: "client", label: "Customer Name", w: 260 },
  { key: "currency", label: "Currency", w: 85 },
  { key: "fx", label: "Exchange Rate", w: 105, num: true },
  { key: "item", label: "Item Name", w: 220 },
  { key: "desc", label: "Item Description", w: 260 },
  { key: "qty", label: "Quantity", w: 90, num: true },
  { key: "price", label: "Item Price", w: 110, num: true },
  { key: "total", label: "Item Total", w: 120, num: true },
  { key: "taxable", label: "Taxable Amount", w: 130, num: true },
  { key: "usageFrom", label: "Usage Period (From)", w: 145 },
  { key: "usageTill", label: "Usage Period (Till)", w: 145 },
  { key: "po", label: "Purchase Order", w: 150 },
  { key: "so", label: "Sales Order No.", w: 150 },
  { key: "discount", label: "Discount Amount", w: 135 },
];

export function renderInvoiceDump() {
  renderRawDump({
    key: "invoiceDump",
    cols: INVOICE_DUMP_COLS,
    getRows: function () { return (S.invoiceDump && S.invoiceDump.rows) || []; },
    dateKey: "invdate",
    searchFields: ["inv", "client", "item", "po", "so"],
    searchPlaceholder: "Search invoice no, client, item, PO, SO…",
    badge: "Read-only — raw export from Zoho Books",
    hasItemCol: true,
    totalField: "taxable",
    totalLabel: "Taxable value (view)",
    totalColLabel: "Taxable Amount",
    csvName: "Invoice_Dump.csv"
  });
}
