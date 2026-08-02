"use strict";

import { esc } from "../core/format.js";
import { AUTH } from "../state/auth.js";
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

export function renderAuthScreen() {
  var setup = !AUTH.anyUsers();
  var el = document.createElement("div");
  el.className = "auth-screen";
  el.id = "authScreen";
  /* .auth-card is the direct grid child on purpose — an intermediate wrapper
     here previously broke centering (place-items:center only shrinks the
     item to fit-content when nothing forces it wide; a percentage-width
     descendant inside a spare wrapper div does exactly that). */
  el.innerHTML =
    '<div class="auth-card">' +
    '<div class="auth-top"><div class="mark">RA</div>' +
    "<h2>" + (setup ? "Set up administrator" : "Revenue Analytics") + "</h2>" +
    "<p>" + (setup ? "Create the first admin account to begin" : "Sign in to continue") + "</p></div>" +
    '<div class="auth-body">' +
    (setup ? '<div class="auth-msg info">The administrator can edit figures and create read-only accounts for everyone else.</div>' : "") +
    '<div class="field"><label for="auUser">Username</label>' +
    '<input type="text" id="auUser" autocomplete="username" autocapitalize="none" spellcheck="false" /></div>' +
    passwordFieldHTML("auPass", "Password", setup ? "new-password" : "current-password") +
    (setup ? passwordFieldHTML("auPass2", "Confirm password", "new-password") : "") +
    '<div class="auth-msg err" id="auErr" style="display:none"></div>' +
    '<button class="btn-primary" id="auGo">' + (setup ? "Create admin account" : "Sign in") + "</button>" +
    "</div>" +
    '<div class="auth-foot">Accounts are stored in this browser. This gate controls who can change figures in the ' +
    "dashboard — it is not a security boundary, since the underlying data files are served directly. " +
    "Move authentication to the API before this holds anything confidential.</div>" +
    "</div>";
  document.body.appendChild(el);
  wirePasswordToggles(el);

  var err = el.querySelector("#auErr");
  function fail(m) { err.textContent = m; err.style.display = "block"; }

  function submit() {
    err.style.display = "none";
    var u = el.querySelector("#auUser").value.trim();
    var p = el.querySelector("#auPass").value;
    if (setup) {
      var p2 = el.querySelector("#auPass2").value;
      if (p !== p2) { fail("The two passwords do not match."); return; }
      AUTH.create(u, p, "admin")
        .then(function () { return AUTH.login(u, p); })
        .then(function () { el.remove(); startApp(); })
        .catch(function (e) { fail(e.message); });
    } else {
      AUTH.login(u, p)
        .then(function () { el.remove(); startApp(); })
        .catch(function (e) { fail(e.message); });
    }
  }
  el.querySelector("#auGo").addEventListener("click", submit);
  el.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
  setTimeout(function () { el.querySelector("#auUser").focus(); }, 30);
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
  function listHTML() {
    return AUTH.list().map(function (u) {
      return '<div class="user-row"><span class="nm">' + esc(u.username) + "</span>" +
        '<span class="rl' + (u.role === "admin" ? " admin" : "") + '">' +
        (u.role === "admin" ? "Admin" : "Read only") + "</span><span class=\"spacer\"></span>" +
        (u.username === AUTH.session().username
          ? '<span style="font-size:11px;color:var(--ink-3)">you</span>'
          : '<button data-del="' + esc(u.username) + '">Remove</button>') + "</div>";
    }).join("");
  }
  wrap.innerHTML =
    '<div class="modal" role="dialog" aria-modal="true">' +
    '<div class="modal-hd"><div><h3>Users &amp; access</h3>' +
    "<p>Admins can edit figures; read-only accounts can view and export</p></div>" +
    '<button class="x" id="uClose" aria-label="Close">×</button></div>' +
    '<div class="modal-body">' +
    '<div class="form-note">Create a <b>read-only</b> account for anyone who should see the numbers but not change ' +
    "them. They get every tab, search, selection and CSV export — editing, adding clients and user management stay " +
    "with admins.</div>" +
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
    bindDel();
  }
  function bindDel() {
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
  }
  bindDel();

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
