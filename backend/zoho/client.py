"""Thin client for the Zoho Books v3 API: OAuth access-token refresh plus a
generic paginated GET. This part is standard Zoho OAuth — nothing here is
specific to this org's data.

Docs: https://www.zoho.com/books/api/v3/oauth/
"""
import time
import requests

from .. import config


class ZohoAuthError(RuntimeError):
    pass


class ZohoClient:
    def __init__(self):
        self._access_token = None
        self._expires_at = 0

    def _refresh_access_token(self):
        if not config.zoho_configured():
            raise ZohoAuthError(
                "Zoho credentials are not configured — set ZOHO_CLIENT_ID, "
                "ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN and ZOHO_ORGANIZATION_ID "
                "in backend/.env (see backend/.env.example)."
            )
        resp = requests.post(
            f"{config.ZOHO_ACCOUNTS_DOMAIN}/oauth/v2/token",
            params={
                "refresh_token": config.ZOHO_REFRESH_TOKEN,
                "client_id": config.ZOHO_CLIENT_ID,
                "client_secret": config.ZOHO_CLIENT_SECRET,
                "grant_type": "refresh_token",
            },
            timeout=20,
        )
        resp.raise_for_status()
        body = resp.json()
        if "access_token" not in body:
            raise ZohoAuthError(f"Zoho token refresh failed: {body}")
        self._access_token = body["access_token"]
        # refresh a little early, not right at the edge of expiry
        self._expires_at = time.time() + body.get("expires_in", 3600) - 60

    def _access_token_valid(self):
        if not self._access_token or time.time() >= self._expires_at:
            self._refresh_access_token()
        return self._access_token

    def get(self, path, params=None):
        """One authenticated GET against the Books API, e.g. path='invoices'."""
        token = self._access_token_valid()
        params = dict(params or {})
        params["organization_id"] = config.ZOHO_ORGANIZATION_ID
        resp = requests.get(
            f"{config.ZOHO_API_DOMAIN}/books/v3/{path}",
            headers={"Authorization": f"Zoho-oauthtoken {token}"},
            params=params,
            timeout=30,
        )
        if resp.status_code == 401:
            # token may have been revoked/expired server-side — refresh once and retry
            self._refresh_access_token()
            resp = requests.get(
                f"{config.ZOHO_API_DOMAIN}/books/v3/{path}",
                headers={"Authorization": f"Zoho-oauthtoken {self._access_token}"},
                params=params,
                timeout=30,
            )
        resp.raise_for_status()
        return resp.json()

    def get_all_pages(self, path, list_key, params=None, per_page=200):
        """Follows Zoho's page_context.has_more_page pagination, yielding every
        record across all pages."""
        page = 1
        while True:
            body = self.get(path, {**(params or {}), "page": page, "per_page": per_page})
            for item in body.get(list_key, []):
                yield item
            ctx = body.get("page_context", {})
            if not ctx.get("has_more_page"):
                break
            page += 1
