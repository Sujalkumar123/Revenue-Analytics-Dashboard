"""Read endpoints that will replace the frontend's direct fetch() of
frontend/data/*.json, plus the admin-only sync trigger that pulls fresh data
from Zoho Books. Until a sync has been run, these serve whatever's in
backend/data/ (nothing, on a fresh checkout — see README for how to seed it
from the existing frontend/data/ files during the transition)."""
from flask import Blueprint, jsonify, current_app

from .. import config
from ..zoho.client import ZohoAuthError
from ..zoho.sync import run_full_sync
from .auth import require_admin

bp = Blueprint("ledger", __name__, url_prefix="/api")


def _serve_cached(filename):
    path = config.DATA_DIR / filename
    if not path.exists():
        return jsonify(error=f"{filename} has not been synced yet. POST /api/sync as an admin first."), 503
    return current_app.response_class(path.read_text(encoding="utf-8"), mimetype="application/json")


@bp.get("/consol")
def get_consol():
    return _serve_cached("consol.json")


@bp.get("/credit-notes")
def get_credit_notes():
    return _serve_cached("creditnotes.json")


@bp.get("/client-dims")
def get_client_dims():
    return _serve_cached("clientdims.json")


@bp.post("/sync")
def sync():
    err = require_admin()
    if err:
        return err
    if not config.zoho_configured():
        return jsonify(error="Zoho credentials are not configured — see backend/.env.example."), 400
    try:
        result = run_full_sync()
    except ZohoAuthError as e:
        return jsonify(error=str(e)), 400
    return jsonify(result)
