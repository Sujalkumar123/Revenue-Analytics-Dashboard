"""Loads configuration from environment variables (.env in dev)."""
import os
from pathlib import Path
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
DATA_DIR = BACKEND_DIR / "data"          # synced ledger cache — gitignored
USERS_FILE = DATA_DIR / "users.json"     # local user store — gitignored
# Both live under DATA_DIR so a single persistent-disk mount (e.g. Render's
# disk on backend/data) keeps synced data AND accounts across deploys —
# without it, Render's filesystem is ephemeral and both reset on every push.

load_dotenv(BACKEND_DIR / ".env")

ZOHO_CLIENT_ID = os.environ.get("ZOHO_CLIENT_ID", "")
ZOHO_CLIENT_SECRET = os.environ.get("ZOHO_CLIENT_SECRET", "")
ZOHO_REFRESH_TOKEN = os.environ.get("ZOHO_REFRESH_TOKEN", "")
ZOHO_ORGANIZATION_ID = os.environ.get("ZOHO_ORGANIZATION_ID", "")
ZOHO_ACCOUNTS_DOMAIN = os.environ.get("ZOHO_ACCOUNTS_DOMAIN", "https://accounts.zoho.com")
ZOHO_API_DOMAIN = os.environ.get("ZOHO_API_DOMAIN", "https://www.zohoapis.com")

SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-change-me")
FRONTEND_ORIGINS = [o.strip() for o in os.environ.get("FRONTEND_ORIGIN", "http://localhost:8000").split(",") if o.strip()]

# Frontend and backend deployed on different domains (e.g. Vercel + Render)
# means the session cookie is cross-site, which browsers only send with
# SameSite=None; Secure. Local dev (same-site, plain http) needs the
# opposite. Set COOKIE_CROSS_SITE=true in the Render env once the frontend
# is live on a different domain.
COOKIE_CROSS_SITE = os.environ.get("COOKIE_CROSS_SITE", "false").lower() == "true"


def zoho_configured():
    return bool(ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET and ZOHO_REFRESH_TOKEN and ZOHO_ORGANIZATION_ID)
