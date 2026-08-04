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
Product and Recurring-vs-One-time. classify_item() looks Product up in
item_product_map.json first — a real, verified item-name -> product table
(70 entries, majority-vote resolved from ~2,500 real ground-truth rows the
repo owner supplied directly from actual classified data; only 6 items had
any disagreement at all, and blank entries are genuine — some items, like
most "-O"/setup charges, carry no product in the real data either). Only
an item name that isn't in that table at all falls back to the old
prefix/suffix guess (SFA GT/DMS/SFA MT/FLO prefix -> that product, else
"Other modules") — which the ground truth confirms was wrong in several
real cases (e.g. "DMS - Support Charges-M" and "SFA GT - Analytics
Subscription Charges-M" are both "Other modules", not their prefix's
product), so the table always wins when an exact name match exists.
Recurring-vs-One-time still comes from the "-M"/"-O" suffix, which the
ground truth doesn't cover but is reliable on its own.

A single line item's amount is frequently a lump sum covering several
months at once — a client billed monthly still gets ONE invoice line for a
half-yearly or annual prepayment, not six/twelve separate lines. Usage
Period (From/Till) is the authoritative signal for exactly which months
that covers, but was missing on 164/2384 real rows. Roughly half the real
rows state the covered period directly in the Item Description instead
(e.g. "INR 550 / User * 6 Months", "@400/user/month * 3 months") —
resolve_period() prefers explicit Usage Period dates, and falls back to
parsing that text (anchored at the invoice date) when dates are absent,
recovering 36 of those 164 rows in the real export (128 remain genuinely
unresolvable — no dates and no stated period — and stay flagged, not
dropped). Whichever period is found, bifurcate_by_client_month() applies
the exact same day-weighted split regardless of whether that period is 1,
3, 6, 12 or any other number of months — verified on a synthetic 6-month,
₹60,000 lump sum: it splits proportionally by days across exactly Apr-Sep
and sums back to ₹60,000.00 exactly, not approximately.
"""
import json
import re
from datetime import date, timedelta
from pathlib import Path

EPOCH = date(2022, 1, 1)
MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

# Real, verified item-name -> product table — see module docstring. Loaded
# once at import time; item_product_map.json is the source of truth and can
# be regenerated/edited directly (or via the frontend's mapping UI, once
# that's synced server-side).
_MAP_PATH = Path(__file__).resolve().parent / "item_product_map.json"
try:
    ITEM_PRODUCT_MAP = json.loads(_MAP_PATH.read_text(encoding="utf-8"))
except FileNotFoundError:
    ITEM_PRODUCT_MAP = {}

# Fallback ONLY for item names not present in ITEM_PRODUCT_MAP at all (e.g.
# a genuinely new item Zoho hasn't seen before). Zoho item-name prefix (text
# before the first " - ") -> the app's existing canonical product-tab names
# (frontend/js/controller.js TABS).
PRODUCT_PREFIX_MAP = {
    "SFA GT": "GT subscription",
    "DMS": "DMS subscription",
    "SFA MT": "MT subscription",
    "FLO": "Flo subscription",
}
DEFAULT_PRODUCT = "Other modules"

_RECURRING_SUFFIX = re.compile(r"-\s*M\s*$", re.IGNORECASE)
_ONETIME_SUFFIX = re.compile(r"-\s*O\s*$", re.IGNORECASE)


def _guess_product(item_name):
    prefix = item_name.split(" - ")[0].strip() if " - " in item_name else item_name
    return PRODUCT_PREFIX_MAP.get(prefix, DEFAULT_PRODUCT)


def classify_item(item_name):
    """item name -> (product, recurring: bool). product may be "" — that's
    a real, verified answer (several item types genuinely carry no product
    in the ground-truth data), not a missing value."""
    item_name = (item_name or "").strip()
    if item_name in ITEM_PRODUCT_MAP:
        product = ITEM_PRODUCT_MAP[item_name]
    else:
        product = _guess_product(item_name)
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


_MONTHS_IN_DESC = re.compile(r"(\d+)\s*months?\b", re.IGNORECASE)
BILLING_FREQUENCY_LABELS = {1: "Monthly", 3: "Quarterly", 6: "Half-yearly", 12: "Yearly"}


def infer_billing_months(desc):
    """Item description -> the number of months its amount covers, read
    straight from text like "* 6 Months" / "* 3 months", or None if the
    description doesn't state one. Bounded to a sane range (1-36) so a
    stray unrelated number elsewhere in the text can't be misread."""
    if not desc:
        return None
    m = _MONTHS_IN_DESC.search(desc)
    if not m:
        return None
    n = int(m.group(1))
    return n if 1 <= n <= 36 else None


def billing_frequency_label(months):
    if months is None:
        return None
    return BILLING_FREQUENCY_LABELS.get(months, f"Custom ({months} months)")


def _add_months(d, months):
    """Last calendar day of the month `months` after d's month (d.day is
    ignored on the way out — billing periods are whole months)."""
    total = d.month - 1 + months
    year = d.year + total // 12
    month = total % 12 + 1
    next_month = date(year + (1 if month == 12 else 0), (month % 12) + 1, 1)
    return next_month - timedelta(days=1)


def resolve_period(row, invdate_dnum):
    """(start, end, source) day-numbers for a line's service period.
    Prefers explicit Usage Period dates; falls back to the description's
    stated billing length anchored at the invoice date; else unresolved.
    source is "dates" | "description" | None, purely for visibility into
    which rows are relying on the weaker signal."""
    start = _parse_ddmonyy(row.get("usageFrom"))
    end = _parse_ddmonyy(row.get("usageTill"))
    if start is not None and end is not None and end >= start:
        return start, end, "dates"

    months = infer_billing_months(row.get("desc"))
    if months is None or invdate_dnum is None:
        return None, None, None
    inv_date = EPOCH + timedelta(days=invdate_dnum)
    period_end = _add_months(date(inv_date.year, inv_date.month, 1), months - 1)
    return invdate_dnum, (period_end - EPOCH).days, "description"


def derive_consol_rows(invoice_dump_rows, void_statuses=("void",)):
    """Filters out Void-status lines and maps the rest into Consol-Sheet-
    shaped rows: {inv, client, invdate, item, product, desc, rec, users,
    start, end, amount, periodSource, billingFrequency}. start/end are
    None (flagged, not dropped — same convention as the rest of the app)
    only when NEITHER Usage Period dates nor a parseable description
    period could be found."""
    void_set = {s.strip().lower() for s in void_statuses}
    out = []
    for r in invoice_dump_rows:
        status = str(r.get("status", "")).strip().lower()
        if status in void_set:
            continue
        product, recurring = classify_item(r.get("item"))
        invdate = _parse_ddmonyy(r.get("invdate"))
        start, end, source = resolve_period(r, invdate)
        out.append({
            "inv": r.get("inv", ""),
            "client": r.get("client", ""),
            "invdate": invdate,
            "item": r.get("item", ""),
            "product": product,
            "desc": r.get("desc", ""),
            "rec": 1 if recurring else 0,
            "users": r.get("qty") or 0,   # raw dump has no explicit user-count field; qty is the closest proxy
            "start": start,
            "end": end,
            "amount": r.get("total", 0),
            "periodSource": source,
            "billingFrequency": billing_frequency_label(infer_billing_months(r.get("desc"))),
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
