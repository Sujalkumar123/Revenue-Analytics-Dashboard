/* Entry point: wires the fixed page chrome (tabs, theme toggle, account
   menu, keyboard shortcuts, delegated toolbar clicks), loads the ledger
   data, and boots straight into the auth screen or the app. */
"use strict";

import { esc } from "./core/format.js";
import { state, TABS, S, readyFlag } from "./state/app-state.js";
import { AUTH, canEdit } from "./state/auth.js";
import { runUndo, runRedo } from "./state/history.js";
import { applyAdds } from "./state/stores.js";
import { setRender, setStartApp } from "./core/bus.js";
import { render } from "./controller.js";
import { renderAuthScreen, renderAccountTab, closeAcctMenu } from "./ui/auth-screens.js";
import { openAddModal } from "./ui/add-client-modal.js";
import { toast } from "./ui/toast.js";

setRender(render);

function syncHeaderHeight() {
  var bar = document.getElementById("topbar");
  if (bar) document.documentElement.style.setProperty("--nav-h", bar.offsetHeight + "px");
}

function buildChrome() {
  syncHeaderHeight();
  window.addEventListener("resize", syncHeaderHeight);

  /* Account-menu close behaviour (closeAcctMenu lives in ui/auth-screens.js),
     bound HERE once — renderAccountTab() rebuilds the menu's innerHTML on
     every login/logout, so listeners attached inside it would pile up
     across a long session instead of being replaced. */
  document.addEventListener("click", function (e) {
    var slot = document.getElementById("accountSlot");
    if (slot && !slot.contains(e.target)) closeAcctMenu();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeAcctMenu(); });

  /* Ctrl+Z undo, Ctrl+U redo (as asked) — Ctrl+U is the browser's reserved
     "View Page Source" shortcut in Chrome/Edge/Firefox, so most browsers
     intercept it before page JS ever runs; preventDefault() here can't
     override that. Ctrl+Shift+Z (the conventional redo binding) is wired as
     a fallback that will always work, and the toolbar Undo/Redo buttons
     give a non-keyboard path to the same thing. */
  document.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    var editingNow = document.activeElement && (
      document.activeElement.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)
    );
    if (editingNow) return;   // let native undo run inside an open field
    var k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); runUndo(); }
    else if (k === "u" || (k === "z" && e.shiftKey)) { e.preventDefault(); runRedo(); }
  });

  var nav = document.getElementById("tabNav");
  nav.innerHTML = TABS.map(function (t) {
    return '<button role="tab" data-tab="' + t.id + '" aria-selected="' + (t.id === state.tab) + '">' + esc(t.label) + "</button>";
  }).join("");
  nav.addEventListener("click", function (e) {
    var b = e.target.closest("[data-tab]");
    if (!b) return;
    state.tab = b.getAttribute("data-tab");
    state.search = ""; state.flagOnly = false;
    nav.querySelectorAll("[data-tab]").forEach(function (x) {
      x.setAttribute("aria-selected", x.getAttribute("data-tab") === state.tab);
    });
    render();
  });

  /* Theme: the balanced default (dark header over a light canvas) or full
     dark mode, switched from the fixed corner button — it lives outside the
     per-tab toolbars (in the page shell, wired once here) so it stays put
     across every tab and scroll position instead of being rebuilt/lost on
     every render. */
  var fab = document.getElementById("themeFab");
  function paintFab() {
    var isDark = document.documentElement.getAttribute("data-theme") === "dark";
    if (fab) { fab.textContent = isDark ? "☀" : "☾"; fab.title = isDark ? "Switch to default theme" : "Switch to dark theme"; }
  }
  var savedTheme = null;
  try { savedTheme = localStorage.getItem("ra_theme"); } catch (e) {}
  if (savedTheme === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
  paintFab();
  if (fab) fab.addEventListener("click", function () {
    var isDark = document.documentElement.getAttribute("data-theme") === "dark";
    if (isDark) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", "dark");
    try { localStorage.setItem("ra_theme", isDark ? "default" : "dark"); } catch (err) {}
    paintFab();
  });

  /* Delegated — the toolbar is rebuilt on every render, so per-element
     binding would go stale. */
  document.addEventListener("click", function (e) {
    if (!e.target.closest) return;
    if (e.target.closest("#addBtn")) { if (canEdit()) openAddModal(); return; }
    if (e.target.closest("#undoBtn")) { runUndo(); return; }
    if (e.target.closest("#redoBtn")) { runRedo(); return; }
    if (e.target.closest("#exportBtn")) {
      if (!window.__csv) return;
      var out = window.__csv();
      var blob = new Blob(["﻿" + out.body], { type: "text/csv;charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = out.name; a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }
  });
  document.addEventListener("change", function (e) {
    if (e.target && e.target.id === "fySel") { state.fy = e.target.value; render(); }
  });
}

/* ================= boot ================= */
var dataLoaded = false;
var usingSampleData = false;

function startApp() {
  renderAccountTab(syncHeaderHeight);
  if (dataLoaded) { render(); return; }
  document.getElementById("view").innerHTML =
    '<div class="loading"><div class="spinner"></div>Loading ledger…</div>';
  loadData();
}
setStartApp(startApp);

function boot() {
  buildChrome();
  if (!AUTH.signedIn()) {
    document.getElementById("view").innerHTML = "";
    renderAuthScreen();
    return;
  }
  startApp();
}

/* data/ (the real ledger) is gitignored — it never ships to a public
   deployment. sample-data/ is a small fictional dataset that IS committed,
   so a fresh checkout or a public deployment (e.g. Vercel) still shows a
   working dashboard instead of a blank error screen. */
function fetchJSON(base, name) {
  return fetch(base + "/" + name).then(function (r) {
    if (!r.ok) throw new Error(name + " " + r.status);
    return r.json();
  });
}
function loadFrom(base) {
  return Promise.all([
    fetchJSON(base, "consol.json"),
    fetchJSON(base, "creditnotes.json"),
    fetchJSON(base, "clientdims.json").catch(function () { return {}; })
  ]);
}

function loadData() {
  loadFrom("data")
    .catch(function () {
      usingSampleData = true;
      return loadFrom("sample-data");
    })
    .then(function (res) {
      S.consol = res[0]; S.credit = res[1]; S.dims = res[2];
      applyAdds("consol", S.consol);
      applyAdds("credit", S.credit);
      readyFlag.value = true;
      dataLoaded = true;
      render();
      if (usingSampleData) toast("Showing sample data — the real ledger (data/) isn't present in this deployment.");
    }).catch(function (err) {
      document.getElementById("view").innerHTML =
        '<div class="card" style="position:static;height:auto"><div style="padding:20px;font-size:13px;line-height:1.6">' +
        "<b>Could not load ledger data.</b><br/>This page must be served over HTTP — open " +
        "<code>http://localhost:8000/</code> rather than double-clicking the file.<br/><br/>" +
        esc(err.message) + "</div></div>";
    });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
