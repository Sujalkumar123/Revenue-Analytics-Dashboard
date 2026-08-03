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
(`frontend/data/`) and keeps admin edits in `localStorage`. The backend
exists to replace that: it pulls invoices and credit notes from Zoho Books
into the same JSON shape the frontend already reads, and holds the things
that must never live in browser-shipped code — the Zoho client
secret/refresh token, and real session-based authentication. The frontend
hasn't been switched over to it yet (see `backend/README.md` → "Not done
yet").

**`frontend/data/` contains real client names and revenue figures and is
committed to this repo at the owner's explicit request — it is public.** If
that data shouldn't be public, remove it and restore a `frontend/data/`
gitignore entry before pushing further.

## Running it today

```bash
py -3 frontend/serve.py
```

Then open `http://localhost:8000/`. If `frontend/data/` is ever missing
locally, the app automatically falls back to the fictional dataset in
`frontend/sample-data/`.

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

See [`frontend/js/`](frontend/js) for the frontend's module structure, and
[`DEPLOY.md`](DEPLOY.md) for hosting the backend on Render and the frontend
on Vercel.
