"""Server-side user store — a local JSON file, same shape as the frontend's
existing localStorage-based AUTH module (username -> {hash, role}), but this
one is the real thing: passwords never leave the server, and a session
cookie (not a client-readable flag) is what actually gates the write
endpoints in api/ledger.py.
"""
import json

from werkzeug.security import generate_password_hash, check_password_hash

from . import config


def _load():
    if not config.USERS_FILE.exists():
        return {}
    return json.loads(config.USERS_FILE.read_text(encoding="utf-8"))


def _save(users):
    config.USERS_FILE.write_text(json.dumps(users, indent=2), encoding="utf-8")


def any_users():
    return len(_load()) > 0


def list_users():
    return [{"username": u, "role": r["role"]} for u, r in sorted(_load().items())]


def create_user(username, password, role):
    username = (username or "").strip()
    if not username:
        raise ValueError("Username is required.")
    if role not in ("admin", "read"):
        raise ValueError("Role must be 'admin' or 'read'.")
    if not password or len(password) < 6:
        raise ValueError("Password must be at least 6 characters.")
    users = _load()
    if username in users:
        raise ValueError("That username already exists.")
    users[username] = {"hash": generate_password_hash(password), "role": role}
    _save(users)


def verify_login(username, password):
    users = _load()
    rec = users.get((username or "").strip())
    if not rec or not check_password_hash(rec["hash"], password or ""):
        return None
    return {"username": username.strip(), "role": rec["role"]}


def remove_user(username):
    users = _load()
    rec = users.get(username)
    if not rec:
        return False
    if rec["role"] == "admin":
        admins = [u for u, r in users.items() if r["role"] == "admin"]
        if len(admins) <= 1:
            return False  # never strand the last admin
    del users[username]
    _save(users)
    return True
