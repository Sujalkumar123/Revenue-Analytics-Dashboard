"""Regenerates the fictional demo dataset in this folder.

This is what the live Vercel deployment shows — the real dataset
(frontend/data/*.json) is gitignored since it carries real client names and
revenue. Every name and figure here is made up.

Run:  py -3 frontend/sample-data/generate.py
"""
import json
import random
from datetime import date
from pathlib import Path

EPOCH = date(2022, 1, 1)
OUT = Path(__file__).resolve().parent
random.seed(7)


def dnum(y, m, d):
    return (date(y, m, d) - EPOCH).days


CLIENTS = [
    "Acme Foods Private Limited", "Bluepeak Retail Solutions", "Nimbus Traders LLP",
    "Solstice Apparel Co", "Riverside Distributors", "Copperline Industries",
    "Vantage Point Logistics", "Greenfield Agro Supplies", "Northwind Hardware",
    "Cascade Beverages Pvt Ltd", "Silverline Electronics", "Harborview Exports",
]
PRODUCTS = ["GT subscription", "DMS subscription", "MT subscription", "Flo subscription", "Other modules"]
ITEMS = {p: p.replace(" subscription", "") + " - Subscription Charges" for p in PRODUCTS}


class Dict_:
    def __init__(self):
        self.values = []
        self._i = {}

    def add(self, v):
        v = v or ""
        if v not in self._i:
            self._i[v] = len(self.values)
            self.values.append(v)
        return self._i[v]


def build_ledger(is_credit):
    dicts = {k: Dict_() for k in ("inv", "client", "item", "product", "desc")}
    rows = []
    n = 0
    for client in CLIENTS:
        for month in range(4, 16):  # Apr-24 .. Mar-25
            y = 2024 + (1 if month > 12 else 0)
            m = month if month <= 12 else month - 12
            if random.random() < (0.12 if is_credit else 0.02):
                continue  # some months have no line for this client
            product = random.choice(PRODUCTS)
            n += 1
            inv_idx = dicts["inv"].add(f"{'CN' if is_credit else 'F2K'}/2024-25/{n:04d}")
            client_idx = dicts["client"].add(client)
            item_idx = dicts["item"].add(ITEMS[product])
            product_idx = dicts["product"].add(product)
            desc_idx = dicts["desc"].add(f"@ INR 500 / User * 1 Month")
            users = random.randint(5, 60)
            amount = round(users * random.uniform(400, 650), 2)
            start = dnum(y, m, 1)
            end = dnum(y, m + 1 if m < 12 else 1, 1) - 1 if m < 12 else dnum(y + 1, 1, 1) - 1
            rows.append([
                inv_idx, client_idx, start, item_idx, product_idx, desc_idx,
                1, users, start, end, amount if not is_credit else -amount * random.uniform(0.05, 0.2),
            ])
    return {
        "epoch": EPOCH.isoformat(),
        "badPeriod": 0,
        "cols": ["inv", "client", "invdate", "item", "product", "desc", "rec", "users", "start", "end", "amount"],
        "dicts": {k: v.values for k, v in dicts.items()},
        "rows": rows,
    }


consol = build_ledger(is_credit=False)
credit = build_ledger(is_credit=True)
dims = {c: {"product": "SFA", "category": "Demo", "region": "Domestic", "geo": "Sample"} for c in CLIENTS}

(OUT / "consol.json").write_text(json.dumps(consol), encoding="utf-8")
(OUT / "creditnotes.json").write_text(json.dumps(credit), encoding="utf-8")
(OUT / "clientdims.json").write_text(json.dumps(dims), encoding="utf-8")
print(f"wrote {len(consol['rows'])} consol rows, {len(credit['rows'])} credit rows for {len(CLIENTS)} fictional clients")
