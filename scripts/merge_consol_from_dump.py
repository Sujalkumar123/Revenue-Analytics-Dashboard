"""Brings a refreshed frontend/data/invoicedump.json into
frontend/data/consol.json (Invoice working — the dataset that actually
drives Recurring Revenue and MRR Movement), for whichever invoice dates
the dump was just refreshed past.

Unlike backend/zoho/derive_consol.py's own classify_item() (a suffix
guess + item_product_map.json), this derives each item's Recurring flag
and Product from the EXISTING consol.json's own history by majority vote
first — verified necessary: e.g. "Change Request Charges-M" ends in "-M"
but is One-time in every one of its 12 existing occurrences, and the
naive suffix rule would have gotten it wrong. classify_item() is only the
fallback for an item name genuinely never seen before.

Run after scripts/build_invoice_dump.py, once invoicedump.json has been
refreshed:
    py -3 scripts/merge_consol_from_dump.py [--cutoff YYYY-MM-DD]

--cutoff (default 2026-04-01) must match whatever date the refreshed
invoicedump.json actually starts covering from — rows in consol.json
dated on/after it are dropped and rebuilt from the dump; rows before it
are left untouched.
"""
import argparse
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from backend.zoho.derive_consol import EPOCH, _parse_ddmonyy, classify_item, resolve_period  # noqa: E402


def ground_truth_maps(old_rows, cols_idx, dicts):
    """item name -> (majority Recurring flag, majority Product), built
    from consol.json's own existing rows rather than guessed."""
    rec_votes = defaultdict(lambda: [0, 0])
    prod_votes = defaultdict(lambda: defaultdict(int))
    for r in old_rows:
        item = dicts["item"][r[cols_idx["item"]]]
        rec_votes[item][r[cols_idx["rec"]]] += 1
        prod_votes[item][dicts["product"][r[cols_idx["product"]]]] += 1

    def rec(item):
        if item not in rec_votes:
            return None
        onetime, recurring = rec_votes[item]
        return 1 if recurring >= onetime else 0

    def product(item):
        if item not in prod_votes:
            return None
        return max(prod_votes[item].items(), key=lambda kv: kv[1])[0]

    return rec, product


def dict_appender(dicts, name):
    arr = dicts[name]
    lookup = {s: i for i, s in enumerate(arr)}

    def get(s):
        s = s or ""
        if s in lookup:
            return lookup[s]
        arr.append(s)
        lookup[s] = len(arr) - 1
        return lookup[s]

    return get


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cutoff", default="2026-04-01", help="Rows on/after this date are rebuilt from invoicedump.json")
    args = ap.parse_args()
    cutoff_date = date.fromisoformat(args.cutoff)
    cutoff_dnum = (cutoff_date - EPOCH).days

    consol_path = ROOT / "frontend" / "data" / "consol.json"
    dump_path = ROOT / "frontend" / "data" / "invoicedump.json"
    old = json.loads(consol_path.read_text(encoding="utf-8"))
    dump = json.loads(dump_path.read_text(encoding="utf-8"))

    cols = old["cols"]
    ci = {c: i for i, c in enumerate(cols)}
    dicts = old["dicts"]

    rec_of, product_of = ground_truth_maps(old["rows"], ci, dicts)

    kept_rows = [r for r in old["rows"] if r[ci["invdate"]] is not None and r[ci["invdate"]] < cutoff_dnum]
    print(f"kept {len(kept_rows)} existing rows before {args.cutoff}, "
          f"dropping {len(old['rows']) - len(kept_rows)} on/after it")

    get_inv = dict_appender(dicts, "inv")
    get_client = dict_appender(dicts, "client")
    get_item = dict_appender(dicts, "item")
    get_product = dict_appender(dicts, "product")
    get_desc = dict_appender(dicts, "desc")

    new_rows = []
    fallback_items = set()
    for r in dump["rows"]:
        if str(r.get("status", "")).strip().lower() == "void":
            continue
        invdate = _parse_ddmonyy(r.get("invdate"))
        if invdate is None or invdate < cutoff_dnum:
            continue
        item = r.get("item", "")
        rec, product = rec_of(item), product_of(item)
        if rec is None or product is None:
            guess_product, guess_rec = classify_item(item)
            if rec is None:
                rec = 1 if guess_rec else 0
            if product is None:
                product = guess_product
            fallback_items.add(item)
        start, end, _source = resolve_period(r, invdate)
        new_rows.append([
            get_inv(r.get("inv", "")), get_client(r.get("client", "")), invdate,
            get_item(item), get_product(product), get_desc(r.get("desc", "")),
            rec, r.get("qty") or 0, start, end, r.get("total") or 0,
        ])

    print(f"derived {len(new_rows)} rows from invoicedump.json on/after {args.cutoff}")
    if fallback_items:
        print("items with no existing history (used classify_item() guess):", sorted(fallback_items))

    all_rows = kept_rows + new_rows
    bad_period = sum(1 for r in all_rows if r[ci["start"]] is None or r[ci["end"]] is None)
    print(f"total rows: {len(all_rows)}, badPeriod: {bad_period} (was {old['badPeriod']})")

    consol_path.write_text(json.dumps({
        "epoch": old["epoch"],
        "badPeriod": bad_period,
        "dicts": dicts,
        "cols": cols,
        "rows": all_rows,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("written", consol_path)


if __name__ == "__main__":
    main()
