/* Front-end role gate — NOT a security boundary. The data files are served
   statically and anything enforced in the browser can be bypassed. Real
   enforcement belongs in the API (server sessions, per-role endpoints);
   this layer only controls who can change figures in the UI. */
"use strict";

import { store } from "../core/store.js";

var UKEY = "ra_users_v1";
var USERS = store(UKEY);                 // username -> {salt, hash, role, created}
var SKEY = "ra_session_v1";
var session = null;
try { session = JSON.parse(sessionStorage.getItem(SKEY) || "null"); } catch (e) { session = null; }

/* A stored session is just a claim ("I am X, role Y") — nothing re-checks it
   against the actual user list once it's set, so an admin removing someone
   (or changing their role) had no effect on that person's own already-open
   tab: they'd kept seeing data until they happened to sign out themselves.
   Runs once here at load (catches "removed, then the removed person reloads
   their tab") — USERS was just constructed from a fresh localStorage read
   above, so this pass is trustworthy. */
function dropStaleSession() {
  if (!session) return;
  var rec = USERS.get(session.username);
  if (!rec || rec.role !== session.role) {
    session = null;
    try { sessionStorage.removeItem(SKEY); } catch (e) {}
  }
}
dropStaleSession();
/* Catches the OTHER case — removed (or promoted/demoted) while their tab is
   already open, no reload. "storage" fires in every OTHER same-origin tab
   the instant localStorage changes in one of them, which is exactly the
   removed person's tab reacting to the admin's tab making the change.
   Deliberately reads e.newValue directly rather than going through USERS:
   USERS was built from a ONE-TIME localStorage read back when this tab
   first loaded, and nothing in this tab's own activity would ever cause it
   to notice a DIFFERENT tab rewriting that key underneath it — asking it
   here would just re-confirm the same stale answer that let this bug happen
   in the first place. */
if (typeof window !== "undefined") {
  window.addEventListener("storage", function (e) {
    if (e.key !== UKEY || !session) return;
    var fresh = {};
    try { fresh = JSON.parse(e.newValue || "{}"); } catch (err) {}
    var rec = fresh[session.username];
    if (!rec || rec.role !== session.role) {
      session = null;
      try { sessionStorage.removeItem(SKEY); } catch (err) {}
      location.reload();   // was signed in, now isn't — land back on the sign-in screen
    }
  });
}

function rand(n) {
  var a = new Uint8Array(n || 16);
  (window.crypto || window.msCrypto).getRandomValues(a);
  return Array.prototype.map.call(a, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}
function digest(pw, salt) {
  var subtle = window.crypto && (window.crypto.subtle || window.crypto.webkitSubtle);
  if (!subtle) return Promise.reject(new Error("Secure crypto unavailable — open the app over http://localhost."));
  var bytes = new TextEncoder().encode(salt + "|" + pw);
  return subtle.digest("SHA-256", bytes).then(function (buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  });
}

export var AUTH = {
  anyUsers: function () { return Object.keys(USERS.all()).length > 0; },
  list: function () {
    var all = USERS.all();
    return Object.keys(all).sort().map(function (u) {
      return { username: u, role: all[u].role, created: all[u].created };
    });
  },
  create: function (username, password, role) {
    username = String(username || "").trim();
    if (!username) return Promise.reject(new Error("Username is required."));
    if (USERS.get(username)) return Promise.reject(new Error("That username already exists."));
    if (!password || password.length < 6) return Promise.reject(new Error("Password must be at least 6 characters."));
    var salt = rand(16);
    return digest(password, salt).then(function (h) {
      USERS.set(username, { salt: salt, hash: h, role: role, created: Date.now() });
      return true;
    });
  },
  remove: function (username) {
    var u = USERS.get(username);
    if (!u) return false;
    if (u.role === "admin") {
      var admins = AUTH.list().filter(function (x) { return x.role === "admin"; });
      if (admins.length <= 1) return false;       // never strand the last admin
    }
    USERS.del(username);
    return true;
  },
  /* Public self-signup: creates the account with role "pending" — same
     shape as an admin-created one, just with no access yet. Reuses create()
     rather than a separate path so the username-taken / password-length
     checks stay in one place. */
  requestAccess: function (username, password) {
    return AUTH.create(username, password, "pending");
  },
  /* Admin turns a pending request into a real account by assigning it a
     role. If the requester already has their own "Access pending" tab open
     in this SAME browser, dropStaleSession()'s storage listener reloads it
     the moment this write lands, so they land straight on the dashboard —
     no server push involved, just localStorage changing under a tab that's
     watching for it. A different browser/device entirely still needs a
     fresh sign-in, since nothing here is shared beyond one browser. */
  approve: function (username, role) {
    var u = USERS.get(username);
    if (!u || u.role !== "pending") return false;
    if (role !== "admin" && role !== "read") return false;
    USERS.set(username, { salt: u.salt, hash: u.hash, role: role, created: u.created });
    return true;
  },
  login: function (username, password) {
    var rec = USERS.get(String(username || "").trim());
    if (!rec) return Promise.reject(new Error("Incorrect username or password."));
    return digest(password, rec.salt).then(function (h) {
      if (h !== rec.hash) throw new Error("Incorrect username or password.");
      session = { username: String(username).trim(), role: rec.role, at: Date.now() };
      try { sessionStorage.setItem(SKEY, JSON.stringify(session)); } catch (e) {}
      return session;
    });
  },
  logout: function () {
    session = null;
    try { sessionStorage.removeItem(SKEY); } catch (e) {}
  },
  session: function () { return session; },
  isAdmin: function () { return !!session && session.role === "admin"; },
  isPending: function () { return !!session && session.role === "pending"; },
  signedIn: function () { return !!session; }
};

/* single gate every editable surface consults */
export function canEdit() { return AUTH.isAdmin(); }
