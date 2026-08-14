"""Postgres connection + schema. One hosted database (Supabase/Neon/any
Postgres) holding both the ledger itself and everything an admin types into
the dashboard — replaces frontend/data/*.json (static files, reset by
re-deploying) and every localStorage-backed store in frontend/js/state/
(per-browser, lost on a cleared cache) with one durable source of truth.

Denormalized on purpose: the frontend's dict-encoding (dicts.client,
dicts.item, ... + rows referencing indices into them) exists purely to keep
the static JSON files small over the wire — a real database doesn't need
that trick, so each ledger line is just a plain row here. The API layer
(api/ledger.py) re-encodes into that same dict+rows shape when it serves
/api/consol etc., so the existing frontend code that expects it keeps
working unchanged; only the fetch() target moves from a static file to this
API.
"""
import os
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

from . import config

DATABASE_URL = os.environ.get("DATABASE_URL", "")


@contextmanager
def get_conn():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set.")
    # prepare_threshold=None disables psycopg's server-side prepared
    # statements — required on Supabase's pooled connection (Supavisor in
    # transaction mode): a prepared statement is tied to one physical
    # backend connection, but the pooler can hand out a different one per
    # transaction, so a second query reusing the same statement name blows
    # up with "prepared statement already exists".
    conn = psycopg.connect(DATABASE_URL, row_factory=dict_row, prepare_threshold=None)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


SCHEMA = """
-- Invoice working (Consol Sheet) — the day-weighted-proration source of
-- truth for every revenue view in the app.
CREATE TABLE IF NOT EXISTS invoice_lines (
  id BIGSERIAL PRIMARY KEY,
  invoice_no TEXT NOT NULL,
  client TEXT NOT NULL,
  invoice_date DATE,
  item TEXT NOT NULL DEFAULT '',
  product TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  recurring SMALLINT NOT NULL DEFAULT 0,
  users INTEGER NOT NULL DEFAULT 0,
  service_start DATE,
  service_end DATE,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'sync',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_client ON invoice_lines(client);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice_no ON invoice_lines(invoice_no);

-- Invoice Dump — the raw, unbifurcated mirror of Zoho Books invoice lines.
CREATE TABLE IF NOT EXISTS invoice_dump_lines (
  id BIGSERIAL PRIMARY KEY,
  invoice_no TEXT,
  client TEXT,
  invoice_date DATE,
  item TEXT,
  item_total NUMERIC(14,2),
  taxable NUMERIC(14,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_dump_client ON invoice_dump_lines(client);

-- Credit Note Working — same shape as invoice_lines, plus the associated
-- invoice number used to net credit notes against a specific invoice line
-- (see frontend/js/data/revenue.js's netAggregate()).
CREATE TABLE IF NOT EXISTS credit_note_lines (
  id BIGSERIAL PRIMARY KEY,
  credit_note_no TEXT NOT NULL,
  client TEXT NOT NULL,
  credit_note_date DATE,
  item TEXT NOT NULL DEFAULT '',
  product TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  recurring SMALLINT NOT NULL DEFAULT 0,
  users INTEGER NOT NULL DEFAULT 0,
  service_start DATE,
  service_end DATE,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  assoc_invoice_no TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'sync',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_lines_client ON credit_note_lines(client);

-- Credit Note Dump — raw mirror, same relationship to credit_note_lines
-- that invoice_dump_lines has to invoice_lines.
CREATE TABLE IF NOT EXISTS credit_note_dump_lines (
  id BIGSERIAL PRIMARY KEY,
  credit_note_no TEXT,
  client TEXT,
  credit_note_date DATE,
  item TEXT,
  item_total NUMERIC(14,2),
  taxable NUMERIC(14,2),
  assoc_invoice_no TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_dump_client ON credit_note_dump_lines(client);

-- Admin-entered data — previously scattered across per-browser localStorage
-- (frontend/js/state/*.js); each of these mirrors one of those stores.
CREATE TABLE IF NOT EXISTS client_tiers (
  client TEXT PRIMARY KEY,
  tier TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mrr_remarks (
  client TEXT PRIMARY KEY,
  remark TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Provisional/Actual status on Recurring Revenue + MRR Movement — see
-- computeProvisional() and recurring-status.js's own comments for what
-- "confirmed"/"churned" mean here. set_at drives the 2-real-month expiry.
CREATE TABLE IF NOT EXISTS recurring_status (
  client TEXT NOT NULL,
  month_label TEXT NOT NULL,
  status TEXT NOT NULL,
  set_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client, month_label)
);

-- Manual cell overrides on any matrix view (Recurring Revenue, product
-- tabs) — mirrors stores.js's MXO.
CREATE TABLE IF NOT EXISTS cell_overrides (
  tab TEXT NOT NULL,
  metric TEXT NOT NULL,
  fy TEXT NOT NULL,
  month_label TEXT NOT NULL,
  client TEXT NOT NULL,
  value NUMERIC(14,2) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tab, metric, fy, month_label, client)
);

-- Item -> Product mapping overrides layered on top of the built-in ground
-- truth table (item-product-map.js's DEFAULT_ITEM_PRODUCT_MAP, which stays
-- a static JS table — only admin additions/corrections live here).
CREATE TABLE IF NOT EXISTS item_product_overrides (
  item TEXT PRIMARY KEY,
  product TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS custom_products (
  name TEXT PRIMARY KEY
);

-- Accounts + the self-signup pending-approval queue (auth-screens.js).
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_requests (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


def init_schema():
    with get_conn() as conn:
        conn.execute(SCHEMA)
