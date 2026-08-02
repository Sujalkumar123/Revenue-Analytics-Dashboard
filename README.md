# Revenue Analytics Dashboard

A multi-tab revenue-tracking dashboard (Recurring Revenue by Client, Consol
Sheet, Invoice Dump, Credit Notes, per-product tabs, One-time charges) built
to replace a legacy Excel workbook, with Excel-style range selection,
role-based editing, and undo/redo.

## Layout

```
frontend/     the dashboard itself — static HTML/CSS/ES-modules, no build step
backend/      not built yet — see backend/README.md for the planned Zoho Books integration
```

The split exists because of what's coming next: Zoho Books API integration.
Today the frontend fetches its ledger straight from local JSON files
(`frontend/data/`, gitignored — real client/revenue data). Once the backend
exists, those fetches point at a real API instead, and things that must
never live in browser-shipped code — the Zoho client secret, refresh token,
and real authentication — move into `backend/` where they belong.

## Running it today

```bash
py -3 frontend/serve.py
```

Then open `http://localhost:8000/`. You'll need `frontend/data/consol.json`,
`creditnotes.json` and `clientdims.json` locally — they're not in the repo
since it's public and those files carry real business data.

See [`frontend/js/`](frontend/js) for the module structure and
[`backend/README.md`](backend/README.md) for what's planned there.
