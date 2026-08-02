"""Loads configuration from environment variables (.env in dev)."""
import os
from pathlib import Path
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
DATA_DIR = BACKEND_DIR / "data"          # synced ledger cache — gitignored
USERS_FILE = BACKEND_DIR / "users.json"  # local user store — gitignored

load_dotenv(BACKEND_DIR / ".env")

ZOHO_CLIENT_ID = os.environ.get("ZOHO_CLIENT_ID", "")
ZOHO_CLIENT_SECRET = os.environ.get("ZOHO_CLIENT_SECRET", "")
ZOHO_REFRESH_TOKEN = os.environ.get("ZOHO_REFRESH_TOKEN", "")
ZOHO_ORGANIZATION_ID = os.environ.get("ZOHO_ORGANIZATION_ID", "")
ZOHO_ACCOUNTS_DOMAIN = os.environ.get("ZOHO_ACCOUNTS_DOMAIN", "https://accounts.zoho.com")
ZOHO_API_DOMAIN = os.environ.get("ZOHO_API_DOMAIN", "https://www.zohoapis.com")

SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-change-me")
FRONTEND_ORIGINS = [o.strip() for o in os.environ.get("FRONTEND_ORIGIN", "http://localhost:8000").split(",") if o.strip()]


def zoho_configured():
    return bool(ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET and ZOHO_REFRESH_TOKEN and ZOHO_ORGANIZATION_ID)
