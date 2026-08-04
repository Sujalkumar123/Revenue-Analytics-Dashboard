"""Derives Consol Sheet entries from raw Invoice Dump rows — the "inject
Invoice Dump into Consol Sheet, skip Void, bifurcate into months per
client" pipeline. This is prep for when Invoice Dump is synced live from
Zoho Books (see zoho/sync.py); it is NOT wired into what the frontend
currently displays. Consol Sheet's live dataset (frontend/data/consol.json)
already has its own multi-year history — most of what Invoice Dump
currently contains is already represented there, so actually replacing that
dataset with this function's output right now would double-count revenue.
This module exists to be tested and ready for that future sync, not to run
today.

Two things Invoice Dump's raw columns don't carry that Consol Sheet needs:
Product and Recurring-vs-One-time. classify_item() infers both from the
Zoho item name, which — checked against the real 2,384-row export — reliably
ends in "-M" (Monthly/recurring) or "-O" (One-time) for ~92% of distinct
items; the rest fall back to one-time (the conservative choice — it never
overstates recurring revenue).
"""
import re
from datetime import date, timedelta

EPOCH = date(2022, 1, 1)
MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

# Zoho item-name prefix (text before the first " - ") -> the app's existing
# canonical product-tab names (frontend/js/controller.js TABS). Confirmed
# against the real export: SFA GT/DMS/SFA MT/FLO each map 1:1 to one tab;
# every other prefix (Analytics Studio, Power BI, Route Optimisation, "SFA +
# DMS" bundles, etc.) falls under the app's existing "Other modules" tab.
PRODUCT_PREFIX_MAP = {
    "SFA GT": "GT subscription",
    "DMS": "DMS subscription",
    "SFA MT": "MT subscription",
    "FLO": "Flo subscription",
}
DEFAULT_PRODUCT = "Other modules"

_RECURRING_SUFFIX = re.compile(r"-\s*M\s*$", re.IGNORECASE)
_ONETIME_SUFFIX = re.compile(r"-\s*O\s*$", re.IGNORECASE)


def classify_item(item_name):
    """item name -> (product, recurring: bool)"""
    item_name = (item_name or "").strip()
    prefix = item_name.split(" - ")[0].strip() if " - " in item_name else item_name
    product = PRODUCT_PREFIX_MAP.get(prefix, DEFAULT_PRODUCT)
    if _RECURRING_SUFFIX.search(item_name):
        recurring = True
    elif _ONETIME_SUFFIX.search(item_name):
        recurring = False
    else:
        recurring = False  # unmarked items default to one-time, not recurring
    return product, recurring


def _parse_ddmonyy(s):
    """'01-Apr-26' -> day-number since EPOCH, or None. Matches the date
    format scripts/build_invoice_dump.py writes into invoicedump.json."""
    if not s:
        return None
    m = re.match(r"^(\d{1,2})-([A-Za-z]{3})-(\d{2})$", s.strip())
    if not m:
        return None
    day, mon, yy = m.groups()
    try:
        month = MN.index(mon.capitalize()) + 1
    except ValueError:
        return None
    year = 2000 + int(yy)
    return (date(year, month, int(day)) - EPOCH).days


def derive_consol_rows(invoice_dump_rows, void_statuses=("void",)):
    """Filters out Void-status lines and maps the rest into Consol-Sheet-
    shaped rows: {inv, client, invdate, item, product, desc, rec, users,
    start, end, amount}. start/end are None (flagged, not dropped — same
    convention as the rest of the app) when Usage Period wasn't set."""
    void_set = {s.strip().lower() for s in void_statuses}
    out = []
    for r in invoice_dump_rows:
        status = str(r.get("status", "")).strip().lower()
        if status in void_set:
            continue
        product, recurring = classify_item(r.get("item"))
        start = _parse_ddmonyy(r.get("usageFrom"))
        end = _parse_ddmonyy(r.get("usageTill"))
        if start is None or end is None or end < start:
            start = end = None
        out.append({
            "inv": r.get("inv", ""),
            "client": r.get("client", ""),
            "invdate": _parse_ddmonyy(r.get("invdate")),
            "item": r.get("item", ""),
            "product": product,
            "desc": r.get("desc", ""),
            "rec": 1 if recurring else 0,
            "users": r.get("qty") or 0,   # raw dump has no explicit user-count field; qty is the closest proxy
            "start": start,
            "end": end,
            "amount": r.get("total", 0),
        })
    return out


def _fy_months(fy_start_year, data_end=None):
    """Apr fy_start_year .. Mar fy_start_year+1, as {s,e,label} day-number
    ranges — mirrors frontend/js/core/dates.js's fyMonths()."""
    out = []
    for i in range(12):
        month = (3 + i) % 12 + 1
        year = fy_start_year + (1 if 3 + i >= 12 else 0)
        start = date(year, month, 1)
        if data_end and start > data_end:
            break
        end = date(year + (1 if month == 12 else 0), (month % 12) + 1, 1)
        end = end - timedelta(days=1)
        out.append({
            "s": (start - EPOCH).days,
            "e": (end - EPOCH).days,
            "label": f"{MN[month - 1]}-{str(year)[2:]}",
        })
    return out


def bifurcate_by_client_month(consol_rows, months, recurring_only=True):
    """Day-weighted straight-line proration of each row's amount across the
    months its [start,end] service period overlaps — the same rule the
    frontend's monthlyOf()/aggregate() use. Returns
    {client: {month_label: amount}}."""
    result = {}
    for row in consol_rows:
        if recurring_only and not row["rec"]:
            continue
        start, end = row["start"], row["end"]
        if start is None or end is None:
            continue
        period = end - start + 1
        if period <= 0:
            continue
        client = row["client"]
        bucket = result.setdefault(client, {m["label"]: 0.0 for m in months})
        for m in months:
            if end < m["s"] or start > m["e"]:
                continue
            lo, hi = max(start, m["s"]), min(end, m["e"])
            days = hi - lo + 1
            if days > 0:
                bucket[m["label"]] += row["amount"] * days / period
    return result
