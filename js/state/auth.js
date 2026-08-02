/* Front-end role gate — NOT a security boundary. The data files are served
   statically and anything enforced in the browser can be bypassed. Real
   enforcement belongs in the API (server sessions, per-role endpoints);
   this layer only controls who can change figures in the UI. */
"use strict";

import { store } from "../core/store.js";

var USERS = store("ra_users_v1");        // username -> {salt, hash, role, created}
var SKEY = "ra_session_v1";
var session = null;
try { session = JSON.parse(sessionStorage.getItem(SKEY) || "null"); } catch (e) { session = null; }

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
  signedIn: function () { return !!session; }
};

/* single gate every editable surface consults */
export function canEdit() { return AUTH.isAdmin(); }
