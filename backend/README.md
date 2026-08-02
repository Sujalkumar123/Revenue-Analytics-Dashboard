# Backend

A Flask API that will replace the frontend's direct `fetch()` of static
JSON files with real Zoho Books data, plus real server-side authentication
(the frontend's own `auth.js` is explicit that its login gate is a UI
convenience only, not a security boundary, since it runs entirely in the
browser — this is what makes it actually one).

## What's here

- **`zoho/client.py`** — OAuth access-token refresh against Zoho's standard
  flow, and a generic paginated GET against the Books API. This part is
  standard Zoho OAuth, not specific to this org.
- **`zoho/sync.py`** — pulls invoices + credit notes from Zoho Books and
  writes them into **the exact JSON shape the frontend already reads**
  (`dicts` + `rows`, same column order as `frontend/data/consol.json`), so
  pointing the frontend at this API later is just changing two fetch URLs.
  `CUSTOM_FIELD_LABELS` at the top of that file is the one thing you need to
  edit — Zoho Books doesn't have built-in fields for "Product", "Recurring
  vs One-time", "User count" or a service period, so those have to be your
  org's actual custom field labels (Zoho Books → Settings → Customization →
  Custom Fields). Until they're confirmed, unmapped rows are still written
  out (not dropped) with a blank service period — the frontend already has
  a "Needs attention" filter built for exactly that case.
- **`store.py`** + **`api/auth.py`** — session-cookie auth backed by a local
  JSON user store (`backend/users.json`, gitignored), hashed with
  Werkzeug's `pbkdf2`. Mirrors the frontend's admin / read-only roles.
- **`api/ledger.py`** — `GET /api/consol`, `/api/credit-notes`,
  `/api/client-dims` (served from the local sync cache), and
  `POST /api/sync` (admin-only, pulls fresh data from Zoho).

## Running it

```bash
pip install -r backend/requirements.txt
cp backend/.env.example backend/.env      # fill in Zoho credentials once you have them
py -3 -m backend.app                       # from the repo root — serves http://localhost:8787
```

Without Zoho credentials configured, everything else still works: you can
create the admin account, log in, manage users, and hit `/api/consol` —
it'll just 503 until `/api/sync` has run at least once. `/api/health`
reports whether Zoho credentials are currently configured.

## Not done yet

The frontend still fetches `frontend/data/*.json` directly and keeps its
own edits (Consol Sheet field edits, added clients, Recurring Revenue
overrides) in `localStorage` — this API doesn't have write endpoints for
those yet, and the frontend hasn't been pointed at this API at all. That's
the next step once Zoho credentials exist: swap the three `fetch()` calls in
`frontend/js/main.js` for `/api/consol` etc., add CORS-aware credentials to
those fetches, and build write endpoints so admin edits persist centrally
instead of per-browser.
