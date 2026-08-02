# Backend (planned)

Nothing runs here yet. The dashboard currently reads its ledger straight from
static JSON files in `frontend/data/` (gitignored — real client/revenue data,
kept out of this public repo).

## What this will become

A small API that replaces those static files with live data pulled from
**Zoho Books**, and takes over the responsibilities that a static frontend
can't safely own:

- **Zoho Books integration** — OAuth against Zoho's API, refresh-token
  handling, and scheduled/on-demand sync of invoices and credit notes. The
  Zoho **client ID / secret / refresh token belong here only** — they must
  never be embedded in `frontend/` code, since anything shipped to the
  browser is public.
- **Read endpoints** to replace the three files `frontend/js/main.js`
  currently fetches directly:
  - `GET /api/consol` → `frontend/data/consol.json`
  - `GET /api/credit-notes` → `frontend/data/creditnotes.json`
  - `GET /api/client-dims` → `frontend/data/clientdims.json`
- **Real authentication** — `frontend/js/state/auth.js` is explicit that its
  admin/read-only gate is a front-end-only convenience, not a security
  boundary, because the data files it protects are served statically and
  directly fetchable. Moving login to real server-side sessions here is what
  makes that gate actually mean something.
- **Write endpoints** for the mutations the frontend currently keeps in
  `localStorage` only (Consol Sheet field edits, added clients, Recurring
  Revenue matrix overrides), so admin changes persist centrally instead of
  per-browser.

## Suggested shape (not yet built)

```
backend/
  app.py               # API entrypoint
  zoho/
    client.py           # OAuth + Zoho Books API calls
    sync.py              # pulls invoices/credit notes, writes the ledger
  api/
    consol.py             # GET /api/consol
    credit_notes.py        # GET /api/credit-notes
    auth.py                 # login/session endpoints
  .env.example              # ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN (never committed)
```

Until this exists, `frontend/serve.py` remains a plain static-file dev
server — it has no knowledge of Zoho and never will.
