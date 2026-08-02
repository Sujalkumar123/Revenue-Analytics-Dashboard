"""Backend API entrypoint.

Run from the repo root:
    py -3 -m backend.app

Serves on http://localhost:8787 by default. The frontend (frontend/serve.py,
http://localhost:8000) is a separate process — this API is CORS-enabled for
FRONTEND_ORIGIN (see backend/.env.example) rather than serving the static
site itself, so each half can be deployed independently later.
"""
import os

from flask import Flask
from flask_cors import CORS

from . import config
from .api.auth import bp as auth_bp
from .api.ledger import bp as ledger_bp


def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = config.SECRET_KEY
    if config.COOKIE_CROSS_SITE:
        app.config["SESSION_COOKIE_SAMESITE"] = "None"
        app.config["SESSION_COOKIE_SECURE"] = True
    else:
        app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

    CORS(app, supports_credentials=True, origins=config.FRONTEND_ORIGINS)

    app.register_blueprint(auth_bp)
    app.register_blueprint(ledger_bp)

    @app.get("/api/health")
    def health():
        return {"ok": True, "zohoConfigured": config.zoho_configured()}

    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8787))
    app.run(host="0.0.0.0", port=port, debug=True)
