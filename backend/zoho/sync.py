"""Pulls invoices + credit notes from Zoho Books and writes them into the
exact JSON shape frontend/js/main.js already fetches (consol.json /
creditnotes.json / clientdims.json), so switching the frontend over later is
just changing two fetch URLs — the row/dict encoding doesn't change.

Row encoding (one row per invoice/credit-note LINE ITEM, matching how the
dashboard already treats one row = one line item):
    [invIdx, clientIdx, invoiceDateDnum, itemIdx, productIdx, descIdx,
     recFlag(1|0), userCount, startDnum, endDnum, amount]
Date fields are "day numbers": whole days since EPOCH (see config below).
String fields are indexes into dicts.{inv,client,item,product,desc} — each
distinct string is stored once and referenced by index, which is what keeps
the JSON small with 26k+ rows.

IMPORTANT — this file cannot know your Zoho org's exact setup: which custom
fields (if any) carry "Product", "Recurring vs One-time", "User count" and
the service start/end dates. Those aren't standard Zoho Books invoice
fields — they're almost certainly custom fields specific to this business.
CUSTOM_FIELD_LABELS below is the one thing to edit once you've confirmed the
real labels in Zoho Books (Settings → Customization → Custom Fields).
Until then, rows with unmapped/missing service dates are still written out
(not dropped) with start=end=None — the frontend already has a "Needs
attention" filter built for exactly that case.
"""
from datetime import date, datetime
import json

from .. import config
from .client import ZohoClient

EPOCH = date(2022, 1, 1)

# Edit these to match your Zoho Books custom-field labels once confirmed.
CUSTOM_FIELD_LABELS = {
    "product": "Product",
    "recurring": "Recurring",          # expected value like "Recurring" / "One-time"
    "user_count": "User Count",
    "service_start": "Service Start Date",
    "service_end": "Service End Date",
}


def _dnum(d):
    """date -> whole days since EPOCH, or None."""
    if not d:
        return None
    if isinstance(d, str):
        try:
            d = datetime.strptime(d, "%Y-%m-%d").date()
        except ValueError:
            return None
    return (d - EPOCH).days


def _custom_field(fields, label):
    for f in fields or []:
        if f.get("label") == label or f.get("customfield_id") == label:
            return f.get("value")
    return None


class DictEncoder:
    """String -> index table, matching the frontend's dictAdd() semantics."""
    def __init__(self):
        self.values = []
        self._index = {}

    def add(self, value):
        value = value or ""
        if value not in self._index:
            self._index[value] = len(self.values)
            self.values.append(value)
        return self._index[value]


def _rows_from_documents(documents, doc_date_key):
    """Shared by invoices and credit notes — both are a list of documents,
    each with .line_items, and both need the same row/dict encoding."""
    dicts = {k: DictEncoder() for k in ("inv", "client", "item", "product", "desc")}
    rows = []
    bad_period = 0

    for doc in documents:
        inv_idx = dicts["inv"].add(doc.get("invoice_number") or doc.get("creditnote_number") or "")
        client_idx = dicts["client"].add(doc.get("customer_name") or "")
        doc_dnum = _dnum(doc.get(doc_date_key))
        custom = doc.get("custom_fields")

        for li in doc.get("line_items", []) or []:
            li_custom = li.get("item_custom_fields") or custom
            item_idx = dicts["item"].add(li.get("name") or "")
            product = _custom_field(li_custom, CUSTOM_FIELD_LABELS["product"]) or li.get("name") or ""
            product_idx = dicts["product"].add(product)
            desc_idx = dicts["desc"].add(li.get("description") or "")

            rec_raw = _custom_field(li_custom, CUSTOM_FIELD_LABELS["recurring"])
            rec_flag = 1 if rec_raw and "recur" in str(rec_raw).lower() else 0

            users_raw = _custom_field(li_custom, CUSTOM_FIELD_LABELS["user_count"])
            try:
                users = int(users_raw)
            except (TypeError, ValueError):
                users = 0

            start = _dnum(_custom_field(li_custom, CUSTOM_FIELD_LABELS["service_start"]))
            end = _dnum(_custom_field(li_custom, CUSTOM_FIELD_LABELS["service_end"]))
            if start is None or end is None or end < start:
                bad_period += 1
                start = end = None

            amount = li.get("item_total")
            if amount is None:
                amount = li.get("rate", 0) * li.get("quantity", 1)

            rows.append([
                inv_idx, client_idx, doc_dnum, item_idx, product_idx, desc_idx,
                rec_flag, users, start, end, amount,
            ])

    return {
        "epoch": EPOCH.isoformat(),
        "badPeriod": bad_period,
        "cols": ["inv", "client", "invdate", "item", "product", "desc", "rec", "users", "start", "end", "amount"],
        "dicts": {k: v.values for k, v in dicts.items()},
        "rows": rows,
    }


def sync_invoices(client: ZohoClient):
    documents = list(client.get_all_pages("invoices", "invoices"))
    # the list endpoint doesn't include line_items — fetch each invoice's detail
    full = [client.get(f"invoices/{d['invoice_id']}")["invoice"] for d in documents]
    return _rows_from_documents(full, "date")


def sync_credit_notes(client: ZohoClient):
    documents = list(client.get_all_pages("creditnotes", "creditnotes"))
    full = [client.get(f"creditnotes/{d['creditnote_id']}")["creditnote"] for d in documents]
    return _rows_from_documents(full, "date")


def run_full_sync():
    """Pulls both ledgers from Zoho and writes them to backend/data/, in the
    same shape the frontend already knows how to read. Raises ZohoAuthError
    if credentials aren't configured."""
    client = ZohoClient()
    consol = sync_invoices(client)
    credit = sync_credit_notes(client)

    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    (config.DATA_DIR / "consol.json").write_text(json.dumps(consol), encoding="utf-8")
    (config.DATA_DIR / "creditnotes.json").write_text(json.dumps(credit), encoding="utf-8")

    return {
        "invoices_rows": len(consol["rows"]),
        "credit_notes_rows": len(credit["rows"]),
        "synced_at": datetime.utcnow().isoformat() + "Z",
    }
