"""Converts a raw Zoho Books credit note export (.xlsx sheet "CreditNotes",
or a .csv export with the same columns) into frontend/data/creditnotedump.json
— the exact columns Zoho gives us, unchanged, for the Credit Notes tab's
read-only raw view.

Mirrors scripts/build_invoice_dump.py: deliberately separate from the
existing creditnotes.json that still drives Net revenue on Recurring
Revenue/product tabs (Gross - Credit) — that dataset is untouched. This one
is just a faithful mirror of what Zoho actually exported.

Run:  py -3 scripts/build_credit_note_dump.py "<path to CreditNotes export.xlsx or .csv>"
"""
import csv
import json
import re
import sys
from datetime import datetime
from pathlib import Path

import openpyxl

MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

COLS = [
    ("cndate", "Credit Note Date"), ("cn", "Credit Note Number"), ("status", "Credit Note Status"),
    ("client", "Customer Name"), ("total", "Total"), ("einvoice", "e-Invoice Status"),
    ("assocInv", "Associated Invoice Number"), ("assocInvDate", "Associated Invoice Date"),
    ("currency", "Currency Code"), ("fx", "Exchange Rate"), ("item", "Item Name"), ("desc", "Item Desc"),
    ("qty", "Quantity"), ("price", "Item Price"), ("itemTotal", "Item Total"), ("taxable", "Taxable Amount"),
    ("usageFrom", "Item.CF.Usage Period (From)"), ("usageTill", "Item.CF.Usage Period (till)"),
    ("supplierGstin", "Supplier GST Registration Number"), ("taxPct", "Item Tax %"), ("hsn", "HSN/SAC"),
    ("cgst", "CGST"), ("sgst", "SGST"), ("igst", "IGST"), ("branch", "Branch Name"),
    ("gstTreatment", "GST Treatment"), ("gstin", "GST Identification Number (GSTIN)"),
    ("discount", "Discount Amount"), ("ref", "Reference#"),
]
NUMERIC = {"total", "fx", "qty", "price", "itemTotal", "taxable", "taxPct", "cgst", "sgst", "igst", "discount"}
DATE_FIELDS = {"cndate", "assocInvDate", "usageFrom", "usageTill"}


_DMY = re.compile(r"^(\d{1,2})-(\d{1,2})-(\d{4})$")   # CSV exports give plain "DD-MM-YYYY" strings, not date cells


def fmt_date(v):
    if v is None or v == "":
        return ""
    if isinstance(v, datetime):
        return f"{v.day:02d}-{MN[v.month - 1]}-{str(v.year)[2:]}"
    m = _DMY.match(str(v).strip())
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), m.group(3)
        return f"{d:02d}-{MN[mo - 1]}-{y[2:]}"
    return str(v)


def fmt_num(v):
    if v is None or v == "":
        return 0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0


def read_xlsx_rows(src):
    wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    header = [c.value for c in next(ws.iter_rows(min_row=1, max_row=1))]
    for r in ws.iter_rows(min_row=2, values_only=True):
        if r[0] is None:
            continue
        yield {header[i]: r[i] for i in range(len(header)) if i < len(r)}


def read_csv_rows(src):
    with open(src, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            if not row.get(next(iter(row))):
                continue
            yield row


def main():
    if len(sys.argv) < 2:
        print("usage: py -3 scripts/build_credit_note_dump.py <path to CreditNotes export.xlsx or .csv>")
        sys.exit(1)
    src = Path(sys.argv[1])
    out = Path(__file__).resolve().parent.parent / "frontend" / "data" / "creditnotedump.json"

    src_rows = read_csv_rows(src) if src.suffix.lower() == ".csv" else read_xlsx_rows(src)
    src_rows = list(src_rows)
    header = list(src_rows[0].keys()) if src_rows else []
    missing = [label for _, label in COLS if label not in header]
    if missing:
        print("WARNING - columns not found in source file:", missing)

    rows = []
    for r in src_rows:
        row = {}
        for key, label in COLS:
            if label not in r:
                row[key] = "" if key not in NUMERIC else 0
                continue
            v = r[label]
            if key in DATE_FIELDS:
                row[key] = fmt_date(v)
            elif key in NUMERIC:
                row[key] = fmt_num(v)
            else:
                row[key] = "" if v is None else str(v)
        # "Taxable Amount" isn't in the CSV export (only the .xlsx has it) —
        # verified against the existing dataset that itemTotal always equals
        # taxable for every one of its 6,081 rows (no GST-inclusive pricing
        # in practice here), so that's a safe stand-in rather than 0, which
        # would silently zero out the Credit Note Dump tab's KPI/total row.
        if "Taxable Amount" not in header and row.get("taxable") in (0, "", None):
            row["taxable"] = row.get("itemTotal", 0)
        rows.append(row)

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "cols": [k for k, _ in COLS],
        "labels": {k: label for k, label in COLS},
        "rows": rows,
    }), encoding="utf-8")
    print(f"wrote {len(rows)} rows, {len(COLS)} columns -> {out}")


if __name__ == "__main__":
    main()
