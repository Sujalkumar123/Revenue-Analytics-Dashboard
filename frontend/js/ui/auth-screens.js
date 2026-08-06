"use strict";

import { esc } from "../core/format.js";
import { AUTH } from "../state/auth.js";
import { HISTORY } from "../state/history.js";
import { startApp } from "../core/bus.js";
import { toast } from "./toast.js";

/* A password field with a show/hide toggle. Markup only — id/autocomplete
   are the caller's; wirePasswordToggles() below binds every one on the page. */
export function passwordFieldHTML(id, label, autocomplete, helpHTML, noWrap) {
  var inner = '<label for="' + id + '">' + label + "</label>" +
    '<div class="pw-wrap"><input type="password" id="' + id + '" autocomplete="' + autocomplete + '" />' +
    '<button type="button" class="pw-toggle" data-for="' + id + '" tabindex="-1" ' +
    'aria-label="Show password">👁</button></div>' +
    (helpHTML || "");
  return noWrap ? inner : '<div class="field">' + inner + "</div>";
}
export function wirePasswordToggles(root) {
  root.querySelectorAll(".pw-toggle").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var input = root.querySelector("#" + btn.getAttribute("data-for"));
      if (!input) return;
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.classList.toggle("on", show);
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
      input.focus();
      try { var v = input.value; input.setSelectionRange(v.length, v.length); } catch (e) {}
    });
  });
}

/* setup   — no admin exists anywhere in this browser yet: create the first
             (and only ever, via this screen) admin account.
   signin  — the normal case, every time after that.
   signup  — "request access": creates a "pending" account with no data
             access at all until an admin approves it and picks a role
             (see openUsersModal below) — reached via the link under the
             sign-in form, never shown when setup is true. */
export function renderAuthScreen() {
  var setup = !AUTH.anyUsers();
  var mode = setup ? "setup" : "signin";
  var el = document.createElement("div");
  el.className = "auth-screen";
  el.id = "authScreen";
  document.body.appendChild(el);

  var currentSubmit = function () {};
  /* Bound once on the persistent element, not inside paint() — paint() runs
     again every time the sign-in/request-access link is clicked, and a
     listener added straight to el on each of those calls would stack up
     instead of replacing the previous one. currentSubmit is the one thing
     that needs to change between paints, so it's a plain mutable reference
     paint() reassigns instead. */
  el.addEventListener("keydown", function (e) { if (e.key === "Enter") currentSubmit(); });

  paint();

  /* .auth-card is the direct grid child on purpose — an intermediate wrapper
     here previously broke centering (place-items:center only shrinks the
     item to fit-content when nothing forces it wide; a percentage-width
     descendant inside a spare wrapper div does exactly that). */
  function paint() {
    var isSignup = mode === "signup";
    var wantsPw2 = setup || isSignup;
    el.innerHTML =
      '<div class="auth-card">' +
      '<div class="auth-top"><div class="mark">RA</div>' +
      "<h2>" + (setup ? "Set up administrator" : isSignup ? "Request access" : "Revenue Analytics") + "</h2>" +
      "<p>" + (setup ? "Create the first admin account to begin"
        : isSignup ? "An administrator will need to approve this before you can see anything"
        : "Sign in to continue") + "</p></div>" +
      '<div class="auth-body">' +
      (setup ? '<div class="auth-msg info">The administrator can edit figures and create read-only accounts for everyone else.</div>' : "") +
      (isSignup ? '<div class="auth-msg info">This creates an account with no access yet. Once an administrator approves it and assigns a role, you’ll be able to sign in and see the dashboard.</div>' : "") +
      '<div class="field"><label for="auUser">Username</label>' +
      '<input type="text" id="auUser" autocomplete="username" autocapitalize="none" spellcheck="false" /></div>' +
      passwordFieldHTML("auPass", "Password", wantsPw2 ? "new-password" : "current-password") +
      (wantsPw2 ? passwordFieldHTML("auPass2", "Confirm password", "new-password") : "") +
      '<div class="auth-msg err" id="auErr" style="display:none"></div>' +
      '<button class="btn-primary" id="auGo">' + (setup ? "Create admin account" : isSignup ? "Request access" : "Sign in") + "</button>" +
      (!setup ? '<button type="button" class="auth-switch" id="auSwitch">' +
        (isSignup ? "Already approved? Sign in" : "Don’t have an account? Request access") + "</button>" : "") +
      "</div>" +
      '<div class="auth-foot">Accounts are stored in this browser. This gate controls who can change figures in the ' +
      "dashboard — it is not a security boundary, since the underlying data files are served directly. " +
      "Move authentication to the API before this holds anything confidential.</div>" +
      "</div>";
    wirePasswordToggles(el);
    bind();
  }

  function bind() {
    var err = el.querySelector("#auErr");
    function fail(m) { err.textContent = m; err.style.display = "block"; }

    function submit() {
      err.style.display = "none";
      var u = el.querySelector("#auUser").value.trim();
      var p = el.querySelector("#auPass").value;
      if (mode === "setup") {
        var p2 = el.querySelector("#auPass2").value;
        if (p !== p2) { fail("The two passwords do not match."); return; }
        AUTH.create(u, p, "admin")
          .then(function () { return AUTH.login(u, p); })
          .then(function () { el.remove(); startApp(); })
          .catch(function (e) { fail(e.message); });
      } else if (mode === "signup") {
        var p2b = el.querySelector("#auPass2").value;
        if (p !== p2b) { fail("The two passwords do not match."); return; }
        AUTH.requestAccess(u, p)
          .then(function () { return AUTH.login(u, p); })
          .then(function () { el.remove(); renderPendingScreen(); })
          .catch(function (e) { fail(e.message); });
      } else {
        AUTH.login(u, p)
          .then(function (s) { el.remove(); if (s.role === "pending") renderPendingScreen(); else startApp(); })
          .catch(function (e) { fail(e.message); });
      }
    }
    currentSubmit = submit;
    el.querySelector("#auGo").addEventListener("click", submit);
    var sw = el.querySelector("#auSwitch");
    if (sw) sw.addEventListener("click", function () { mode = mode === "signup" ? "signin" : "signup"; paint(); });
    setTimeout(function () { var f = el.querySelector("#auUser"); if (f) f.focus(); }, 30);
  }
}

/* Shown after signing in (or right after requesting access) when the
   account's role is still "pending" — deliberately the ONLY thing on
   screen, same as the auth screen itself: no tabs, no data, nothing to
   explore until an admin approves the account. */
export function renderPendingScreen() {
  var el = document.createElement("div");
  el.className = "auth-screen";
  el.id = "authScreen";
  var s = AUTH.session();
  el.innerHTML =
    '<div class="auth-card">' +
    '<div class="auth-top"><div class="mark">RA</div>' +
    "<h2>Access pending</h2><p>Waiting for an administrator to approve this account</p></div>" +
    '<div class="auth-body">' +
    '<div class="auth-msg info">Signed in as <b>' + esc(s ? s.username : "") + "</b>, but there’s nothing to see yet — " +
    "an administrator needs to approve this account and assign it a role (read-only or admin) first. " +
    "Check back later, or ask them directly.</div>" +
    '<button class="icon-btn" id="pendLogout" style="width:100%;justify-content:center">↩ Sign out</button>' +
    "</div>" +
    '<div class="auth-foot">Accounts are stored in this browser. This gate controls who can change figures in the ' +
    "dashboard — it is not a security boundary, since the underlying data files are served directly.</div>" +
    "</div>";
  document.body.appendChild(el);
  el.querySelector("#pendLogout").addEventListener("click", function () {
    AUTH.logout();
    HISTORY.clearSession();
    el.remove();
    renderAuthScreen();
  });
}

/* Shared by the account-menu's own buttons and by buildChrome()'s outside-
   click/Escape handling — one definition, so both stay in sync. */
export function closeAcctMenu() {
  var m = document.getElementById("acctMenu");
  if (m && m.classList.contains("open")) {
    m.classList.remove("open");
    var b = document.getElementById("acctBtn");
    if (b) b.setAttribute("aria-expanded", "false");
  }
}

/* Compact tab-styled control in the top-right of the brand row: shows who's
   signed in and their access level, opens a small menu for account actions.
   Lives in the brand row (not a separate full-width row) so the header stays
   two rows: brand+account, then tabs+theme. */
export function renderAccountTab(syncHeaderHeight) {
  var slot = document.getElementById("accountSlot");
  if (!slot) return;
  var s = AUTH.session();
  if (!s) { slot.innerHTML = ""; syncHeaderHeight(); return; }

  slot.innerHTML =
    '<button class="account-tab" id="acctBtn" aria-haspopup="true" aria-expanded="false">' +
    '<span class="who">' + esc(s.username) + "</span>" +
    '<span class="role-pill ' + (AUTH.isAdmin() ? "role-admin" : "role-read") + '">' +
    (AUTH.isAdmin() ? "Admin" : "Read only") + "</span>" +
    '<span class="chev">▾</span></button>' +
    '<div class="account-menu" id="acctMenu" role="menu">' +
    (AUTH.isAdmin() ? '<button role="menuitem" id="usersBtn">👥 Manage users</button><div class="div"></div>' : "") +
    '<button role="menuitem" class="danger" id="logoutBtn">↩ Sign out</button>' +
    "</div>";

  slot.querySelector("#acctBtn").addEventListener("click", function (e) {
    e.stopPropagation();
    var m = document.getElementById("acctMenu");
    var open = m.classList.toggle("open");
    this.setAttribute("aria-expanded", String(open));
  });

  slot.querySelector("#logoutBtn").addEventListener("click", function () {
    AUTH.logout();
    HISTORY.clearSession();
    document.getElementById("view").innerHTML = "";
    renderAccountTab(syncHeaderHeight);
    renderAuthScreen();
  });
  var ub = slot.querySelector("#usersBtn");
  if (ub) ub.addEventListener("click", function () { closeAcctMenu(); openUsersModal(); });
  syncHeaderHeight();
}

export function openUsersModal() {
  if (!AUTH.isAdmin()) return;
  var wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "usersModal";

  function pendingHTML(pending) {
    if (!pending.length) return "";
    return '<div class="form-note" style="margin-bottom:9px">' + pending.length +
      " request" + (pending.length === 1 ? "" : "s") + " waiting — pick a role and Approve, or Deny.</div>" +
      pending.map(function (u) {
        return '<div class="user-row pending-row"><span class="nm">' + esc(u.username) + "</span>" +
          '<select class="approve-role">' +
          '<option value="read">Read only</option><option value="admin">Admin</option></select>' +
          '<button class="btn-primary approve-btn" data-approve="' + esc(u.username) + '">Approve</button>' +
          '<button data-del="' + esc(u.username) + '">Deny</button></div>';
      }).join("") +
      '<div style="height:1px;background:var(--border);margin:12px 0"></div>';
  }
  function activeHTML(active) {
    return active.map(function (u) {
      return '<div class="user-row"><span class="nm">' + esc(u.username) + "</span>" +
        '<span class="rl' + (u.role === "admin" ? " admin" : "") + '">' +
        (u.role === "admin" ? "Admin" : "Read only") + "</span><span class=\"spacer\"></span>" +
        (u.username === AUTH.session().username
          ? '<span style="font-size:11px;color:var(--ink-3)">you</span>'
          : '<button data-del="' + esc(u.username) + '">Remove</button>') + "</div>";
    }).join("");
  }
  function listHTML() {
    var all = AUTH.list();
    var pending = all.filter(function (u) { return u.role === "pending"; });
    var active = all.filter(function (u) { return u.role !== "pending"; });
    return pendingHTML(pending) + activeHTML(active);
  }
  wrap.innerHTML =
    '<div class="modal" role="dialog" aria-modal="true">' +
    '<div class="modal-hd"><div><h3>Users &amp; access</h3>' +
    "<p>Admins can edit figures; read-only accounts can view and export</p></div>" +
    '<button class="x" id="uClose" aria-label="Close">×</button></div>' +
    '<div class="modal-body">' +
    '<div class="form-note">Create a <b>read-only</b> account for anyone who should see the numbers but not change ' +
    "them. They get every tab, search, selection and CSV export — editing, adding clients and user management stay " +
    "with admins. Anyone can also request their own account from the sign-in screen — those show up here as " +
    "pending until you approve or deny them.</div>" +
    '<div id="uList">' + listHTML() + "</div>" +
    '<div style="height:1px;background:var(--border);margin:15px 0"></div>' +
    '<div class="fgrid">' +
    '<div class="field"><label for="nuUser">New username</label><input type="text" id="nuUser" autocapitalize="none" spellcheck="false" /></div>' +
    '<div class="field"><label for="nuRole">Access</label><select id="nuRole">' +
    '<option value="read">Read only</option><option value="admin">Admin (can edit)</option></select></div>' +
    '<div class="field full">' + passwordFieldHTML("nuPass", "Password", "new-password",
      '<span class="help">At least 6 characters. Share it with the person directly — it cannot be read back later.</span>', true) +
    "</div>" +
    "</div></div>" +
    '<div class="modal-ft"><span class="err" id="uErr"></span><span class="spacer"></span>' +
    '<button class="icon-btn" id="uDone">Close</button>' +
    '<button class="btn-primary" id="uAdd">Create account</button></div></div>';
  document.body.appendChild(wrap);
  wirePasswordToggles(wrap);

  function refresh() {
    wrap.querySelector("#uList").innerHTML = listHTML();
    bindRowActions();
  }
  function bindRowActions() {
    wrap.querySelectorAll("[data-del]").forEach(function (b) {
      b.addEventListener("click", function () {
        var name = b.getAttribute("data-del");
        if (!AUTH.remove(name)) {
          wrap.querySelector("#uErr").textContent = "Cannot remove the only admin account.";
          return;
        }
        wrap.querySelector("#uErr").textContent = "";
        refresh();
      });
    });
    wrap.querySelectorAll(".approve-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        var name = b.getAttribute("data-approve");
        var role = b.closest(".user-row").querySelector(".approve-role").value;
        AUTH.approve(name, role);
        wrap.querySelector("#uErr").textContent = "";
        refresh();
        toast("Approved " + name + " as " + (role === "admin" ? "admin" : "read-only") + ".");
      });
    });
  }
  bindRowActions();

  function close() { wrap.remove(); }
  wrap.querySelector("#uClose").addEventListener("click", close);
  wrap.querySelector("#uDone").addEventListener("click", close);
  wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) close(); });

  wrap.querySelector("#uAdd").addEventListener("click", function () {
    var errEl = wrap.querySelector("#uErr");
    errEl.textContent = "";
    var u = wrap.querySelector("#nuUser").value.trim();
    var p = wrap.querySelector("#nuPass").value;
    var role = wrap.querySelector("#nuRole").value;
    AUTH.create(u, p, role).then(function () {
      wrap.querySelector("#nuUser").value = "";
      wrap.querySelector("#nuPass").value = "";
      refresh();
      toast("Created " + (role === "admin" ? "admin" : "read-only") + " account “" + u + "”.");
    }).catch(function (e) { errEl.textContent = e.message; });
  });
}
