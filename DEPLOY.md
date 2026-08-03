# Deploying

I can't create Render or Vercel accounts or sign into them — both configs
below are prepped so connecting your GitHub repo is a few clicks on each
dashboard.

## Backend → Render

1. [render.com](https://render.com) → **New +** → **Blueprint** → connect
   `Sujalkumar123/Revenue-Analytics-Dashboard`. Render reads
   [`render.yaml`](render.yaml) at the repo root and creates the service —
   Python runtime, `pip install -r backend/requirements.txt`, started with
   `gunicorn backend.app:app`. It'll ask for a **Blueprint Name** (just a
   label, e.g. `revenue-analytics`) — branch and blueprint path are already
   correct as `main` / blank (defaults to `render.yaml` at the root).
   Free-tier services don't support persistent disks, so `backend/data/`
   (synced ledger cache + local accounts) resets on every deploy/restart —
   fine for now; move to a paid plan and mount a disk there once that
   matters.
2. Once it deploys, it'll have a URL like
   `https://revenue-analytics-backend.onrender.com`. Check
   `/api/health` — should return `{"ok": true, "zohoConfigured": false}`.
3. In the Render dashboard → your service → **Environment**, fill in the
   four `ZOHO_*` variables marked `sync: false` in `render.yaml` (client ID,
   secret, refresh token, organization ID) once you have them from
   [api-console.zoho.com](https://api-console.zoho.com). `/api/sync` won't
   work without them, but everything else (auth, `/api/health`) does.
4. Free-tier Render services spin down after inactivity and take ~30s to
   wake on the next request — expected, not a bug.

## Frontend → Vercel

1. [vercel.com](https://vercel.com) → **Add New** → **Project** → import the
   same repo.
2. In the import screen, set **Root Directory** to `frontend`. Framework
   preset: **Other** (no build step — it's static HTML/CSS/ES modules).
   Build Command and Output Directory can stay blank.
3. Deploy. **`frontend/data/` — the real ledger, with real client names and
   revenue — is committed to this repo at the owner's explicit request, so
   it deploys to Vercel and is publicly fetchable from the live URL.** If
   that data shouldn't be public, remove it from the repo (and add a
   `frontend/data/` gitignore entry back) before deploying — without it,
   the app falls back to the fictional `frontend/sample-data/` automatically
   and shows a toast saying so.
4. To use it with real data instead, either run it locally
   (`py -3 frontend/serve.py`, see the root README) or finish wiring the
   frontend to the Render API (see `backend/README.md` → "Not done yet") and
   deploy that way instead.

## Connecting the two later

Once the frontend fetches from the backend instead of static files:
- Update `FRONTEND_ORIGIN` in the Render service's env to your real Vercel
  URL (replace the placeholder in `render.yaml`/the dashboard).
- `COOKIE_CROSS_SITE=true` is already set in `render.yaml` — required
  because the session cookie will be cross-site (Vercel domain talking to a
  Render domain), which only works with `SameSite=None; Secure`.
