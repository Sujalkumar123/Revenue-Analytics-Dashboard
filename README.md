# Revenue Analytics Dashboard

A multi-tab revenue-tracking dashboard (Recurring Revenue by Client, Consol
Sheet, Invoice Dump, Credit Notes, per-product tabs, One-time charges) built
to replace a legacy Excel workbook, with Excel-style range selection,
role-based editing, and undo/redo.

## Layout

```
frontend/     the dashboard — static HTML/CSS/ES-modules, no build step
backend/      Flask API — Zoho Books sync + real server-side auth
```

The frontend today still fetches its ledger straight from local JSON files
(`frontend/data/`, gitignored — real client/revenue data) and keeps admin
edits in `localStorage`. The backend exists to replace that: it pulls
invoices and credit notes from Zoho Books into the same JSON shape the
frontend already reads, and holds the things that must never live in
browser-shipped code — the Zoho client secret/refresh token, and real
session-based authentication. The frontend hasn't been switched over to it
yet (see `backend/README.md` → "Not done yet").

## Running it today

```bash
py -3 frontend/serve.py
```

Then open `http://localhost:8000/`. You'll need `frontend/data/consol.json`,
`creditnotes.json` and `clientdims.json` locally — they're not in the repo
since it's public and those files carry real business data.

## Running the backend

```bash
pip install -r backend/requirements.txt
cp backend/.env.example backend/.env      # Zoho credentials, once you have them
py -3 -m backend.app                       # serves http://localhost:8787
```

Works without Zoho credentials too — you can create the admin account, log
in, and manage users; only `/api/sync` and the data it feeds need real
credentials. See [`backend/README.md`](backend/README.md) for the full
endpoint list and what's still missing.

See [`frontend/js/`](frontend/js) for the frontend's module structure.
