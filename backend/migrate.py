"""One-time migration: loads the existing frontend/data/*.json ledger files
into Postgres. Safe to re-run — each function clears its own table first
(this is a full re-load from the JSON snapshot, not an incremental sync;
the real Zoho sync in zoho/sync.py is what keeps things current afterward).

Run from the repo root:
    py -3 -m backend.migrate
"""
import datetime as dt
import json
import sys
from pathlib import Path

from . import db

REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DATA = REPO_ROOT / "frontend" / "data"

EPOCH = dt.date(2022, 1, 1)


def dnum_to_date(n):
    if n is None:
        return None
    return EPOCH + dt.timedelta(days=int(n))


def num_or_none(v):
    """Some dump rows carry "" (blank cell in the Zoho export) where a
    number is expected — several other columns in the same source, like
    cgst/sgst on non-taxable lines, do this too; Postgres's numeric type
    rejects an empty string outright where NULL is what's actually meant."""
    if v is None or v == "":
        return None
    return v


def parse_ddmonyy(s):
    """'02-Mar-23' -> date(2023, 3, 2). Blank/unparseable -> None."""
    if not s:
        return None
    try:
        return dt.datetime.strptime(s.strip(), "%d-%b-%y").date()
    except ValueError:
        return None


def migrate_invoice_lines():
    data = json.loads((FRONTEND_DATA / "consol.json").read_text(encoding="utf-8"))
    dicts, cols, rows = data["dicts"], data["cols"], data["rows"]
    idx = {c: i for i, c in enumerate(cols)}
    out = []
    for r in rows:
        out.append((
            dicts["inv"][r[idx["inv"]]],
            dicts["client"][r[idx["client"]]],
            dnum_to_date(r[idx["invdate"]]),
            dicts["item"][r[idx["item"]]],
            dicts["product"][r[idx["product"]]],
            dicts["desc"][r[idx["desc"]]],
            r[idx["rec"]],
            r[idx["users"]],
            dnum_to_date(r[idx["start"]]),
            dnum_to_date(r[idx["end"]]),
            r[idx["amount"]],
        ))
    with db.get_conn() as conn:
        conn.execute("TRUNCATE invoice_lines RESTART IDENTITY")
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO invoice_lines
                   (invoice_no, client, invoice_date, item, product, description,
                    recurring, users, service_start, service_end, amount)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                out,
            )
    print(f"invoice_lines: {len(out)} rows")


def migrate_credit_note_lines():
    data = json.loads((FRONTEND_DATA / "creditnotes.json").read_text(encoding="utf-8"))
    dicts, cols, rows = data["dicts"], data["cols"], data["rows"]
    idx = {c: i for i, c in enumerate(cols)}
    out = []
    for r in rows:
        assoc = r[idx["assocInv"]] if "assocInv" in idx and len(r) > idx["assocInv"] else ""
        out.append((
            dicts["inv"][r[idx["inv"]]],
            dicts["client"][r[idx["client"]]],
            dnum_to_date(r[idx["invdate"]]),
            dicts["item"][r[idx["item"]]],
            dicts["product"][r[idx["product"]]],
            dicts["desc"][r[idx["desc"]]],
            r[idx["rec"]],
            r[idx["users"]],
            dnum_to_date(r[idx["start"]]),
            dnum_to_date(r[idx["end"]]),
            r[idx["amount"]],
            assoc or "",
        ))
    with db.get_conn() as conn:
        conn.execute("TRUNCATE credit_note_lines RESTART IDENTITY")
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO credit_note_lines
                   (credit_note_no, client, credit_note_date, item, product, description,
                    recurring, users, service_start, service_end, amount, assoc_invoice_no)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                out,
            )
    print(f"credit_note_lines: {len(out)} rows")


def migrate_invoice_dump():
    data = json.loads((FRONTEND_DATA / "invoicedump.json").read_text(encoding="utf-8"))
    out = [(
        r.get("inv"), r.get("client"), parse_ddmonyy(r.get("invdate")),
        r.get("item"), num_or_none(r.get("total")), num_or_none(r.get("taxable")),
    ) for r in data["rows"]]
    with db.get_conn() as conn:
        conn.execute("TRUNCATE invoice_dump_lines RESTART IDENTITY")
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO invoice_dump_lines
                   (invoice_no, client, invoice_date, item, item_total, taxable)
                   VALUES (%s,%s,%s,%s,%s,%s)""",
                out,
            )
    print(f"invoice_dump_lines: {len(out)} rows")


def migrate_credit_note_dump():
    data = json.loads((FRONTEND_DATA / "creditnotedump.json").read_text(encoding="utf-8"))
    out = [(
        r.get("cn"), r.get("client"), parse_ddmonyy(r.get("cndate")),
        r.get("item"), num_or_none(r.get("itemTotal")), num_or_none(r.get("taxable")), r.get("assocInv") or "",
    ) for r in data["rows"]]
    with db.get_conn() as conn:
        conn.execute("TRUNCATE credit_note_dump_lines RESTART IDENTITY")
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO credit_note_dump_lines
                   (credit_note_no, client, credit_note_date, item, item_total, taxable, assoc_invoice_no)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                out,
            )
    print(f"credit_note_dump_lines: {len(out)} rows")


def main():
    print("Connecting and ensuring schema exists...")
    db.init_schema()
    print("Schema OK. Migrating...")
    migrate_invoice_lines()
    migrate_credit_note_lines()
    migrate_invoice_dump()
    migrate_credit_note_dump()
    print("Done.")


if __name__ == "__main__":
    sys.exit(main())
