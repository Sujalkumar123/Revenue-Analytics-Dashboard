"""Session-based auth — replaces the frontend's own AUTH module (which is
explicit in its own comments that it's a UI convenience, not a security
boundary, since it runs entirely in the browser). Here, the password check
and the session actually live on the server."""
from flask import Blueprint, jsonify, request, session

from .. import store

bp = Blueprint("auth", __name__, url_prefix="/api/auth")


def current_user():
    if "username" not in session:
        return None
    return {"username": session["username"], "role": session["role"]}


def require_admin():
    user = current_user()
    if not user or user["role"] != "admin":
        return jsonify(error="Admin access required."), 403
    return None


@bp.get("/session")
def get_session():
    return jsonify(user=current_user(), setupRequired=not store.any_users())


@bp.post("/setup")
def setup_admin():
    if store.any_users():
        return jsonify(error="An administrator account already exists."), 409
    body = request.get_json(silent=True) or {}
    try:
        store.create_user(body.get("username"), body.get("password"), "admin")
    except ValueError as e:
        return jsonify(error=str(e)), 400
    login_result = store.verify_login(body.get("username"), body.get("password"))
    session["username"] = login_result["username"]
    session["role"] = login_result["role"]
    return jsonify(user=current_user())


@bp.post("/login")
def login():
    body = request.get_json(silent=True) or {}
    user = store.verify_login(body.get("username"), body.get("password"))
    if not user:
        return jsonify(error="Incorrect username or password."), 401
    session["username"] = user["username"]
    session["role"] = user["role"]
    return jsonify(user=current_user())


@bp.post("/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@bp.get("/users")
def list_users():
    err = require_admin()
    if err:
        return err
    return jsonify(users=store.list_users())


@bp.post("/users")
def create_user():
    err = require_admin()
    if err:
        return err
    body = request.get_json(silent=True) or {}
    try:
        store.create_user(body.get("username"), body.get("password"), body.get("role"))
    except ValueError as e:
        return jsonify(error=str(e)), 400
    return jsonify(ok=True), 201


@bp.delete("/users/<username>")
def delete_user(username):
    err = require_admin()
    if err:
        return err
    if not store.remove_user(username):
        return jsonify(error="Cannot remove the only admin account, or user does not exist."), 400
    return jsonify(ok=True)
