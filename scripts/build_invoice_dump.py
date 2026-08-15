"""Converts a raw Zoho Books invoice export (.xlsx, sheet "Invoice") into
frontend/data/invoicedump.json — the exact columns Zoho gives us, unchanged,
for the Invoice Dump tab's read-only raw view.

This is deliberately separate from consol.json: Consol Sheet/Recurring
Revenue keep using their own existing dataset (product classification,
recurring flag, service period) untouched — see merge_consol_from_dump.py
for bringing a refresh into that side too.

A source export is usually a partial window (e.g. "last 4 months", not
"everything since 2022"), so this MERGES into the existing
invoicedump.json by default: rows dated on/after --cutoff are replaced
with the new export's rows, everything before is left alone. A blind
overwrite here would silently delete years of history that just isn't in
the new file — found the hard way once already. Pass --full-replace only
if the source file genuinely is a complete re-export of everything.

Run:  py -3 scripts/build_invoice_dump.py "<path to Invoice export.xlsx>" [--cutoff YYYY-MM-DD] [--full-replace]

--cutoff defaults to the 1st of the earliest invoice date found in the
source file itself.
"""
import argparse
import json
from datetime import date, datetime
from pathlib import Path

import openpyxl

MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

COLS = [
    ("invdate", "Invoice Date"), ("inv", "Invoice Number"), ("status", "Invoice Status"),
    ("client", "Customer Name"), ("currency", "Currency Code"), ("fx", "Exchange Rate"),
    ("item", "Item Name"), ("desc", "Item Desc"), ("qty", "Quantity"),
    ("price", "Item Price"), ("total", "Item Total"), ("taxable", "Taxable amount"),
    ("usageFrom", "Item.CF.Usage Period (From)"), ("usageTill", "Item.CF.Usage Period (till)"),
    ("gstin", "GST Identification Number (GSTIN)"), ("po", "PurchaseOrder"),
    ("so", "Sales Order Number"), ("discount", "Discount Amount"),
    ("branch", "Branch Name"), ("cgst", "CGST"), ("sgst", "SGST"), ("igst", "IGST"),
]
NUMERIC = {"fx", "qty", "price", "total", "taxable", "discount", "cgst", "sgst", "igst"}
DATE_FIELDS = {"invdate", "usageFrom", "usageTill"}


def fmt_date(v):
    if v is None or v == "":
        return ""
    if isinstance(v, datetime):
        return f"{v.day:02d}-{MN[v.month - 1]}-{str(v.year)[2:]}"
    return str(v)


def fmt_num(v):
    if v is None or v == "":
        return 0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0


def parse_ddmonyy(s):
    if not s:
        return None
    try:
        return datetime.strptime(s.strip(), "%d-%b-%y").date()
    except ValueError:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source", help="Path to the Invoice export .xlsx")
    ap.add_argument("--cutoff", help="YYYY-MM-DD; defaults to the earliest invoice date in the source file")
    ap.add_argument("--full-replace", action="store_true",
                     help="Overwrite invoicedump.json entirely instead of merging by cutoff date")
    args = ap.parse_args()
    src = Path(args.source)
    out = Path(__file__).resolve().parent.parent / "frontend" / "data" / "invoicedump.json"

    wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
    ws = wb["Invoice"]
    header = [c.value for c in next(ws.iter_rows(min_row=1, max_row=1))]
    idx = {label: header.index(label) for _, label in COLS if label in header}
    missing = [label for _, label in COLS if label not in header]
    if missing:
        print("WARNING - columns not found in source file:", missing)

    rows = []
    earliest = None
    for r in ws.iter_rows(min_row=2, values_only=True):
        if r[0] is None and (len(r) <= idx.get("Invoice Number", 1) or not r[idx.get("Invoice Number", 1)]):
            continue
        row = {}
        for key, label in COLS:
            if label not in idx:
                row[key] = "" if key not in NUMERIC else 0
                continue
            v = r[idx[label]]
            if key in DATE_FIELDS:
                row[key] = fmt_date(v)
            elif key in NUMERIC:
                row[key] = fmt_num(v)
            else:
                row[key] = "" if v is None else str(v)
        rows.append(row)
        d = row.get("invdate") and parse_ddmonyy(row["invdate"])
        if d and (earliest is None or d < earliest):
            earliest = d

    if args.full_replace or not out.exists():
        final_rows = rows
        print(f"full replace: {len(rows)} rows")
    else:
        cutoff = date.fromisoformat(args.cutoff) if args.cutoff else date(earliest.year, earliest.month, 1)
        old = json.loads(out.read_text(encoding="utf-8"))
        kept = [r for r in old["rows"] if not (r.get("invdate") and (parse_ddmonyy(r["invdate"]) or date.max) >= cutoff)]
        print(f"cutoff {cutoff.isoformat()}: kept {len(kept)} existing rows before it, "
              f"replacing with {len(rows)} rows from the new export")
        final_rows = kept + rows

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "cols": [k for k, _ in COLS],
        "labels": {k: label for k, label in COLS},
        "rows": final_rows,
    }, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {len(final_rows)} total rows, {len(COLS)} columns -> {out}")


if __name__ == "__main__":
    main()
