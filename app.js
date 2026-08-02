/* Revenue Analytics — client app
   Every figure is recomputed from the invoice & credit-note ledger using the
   workbook's own recognition rule (day-weighted straight-line proration):
      month_revenue = amount * overlap_days(period, month) / period_days
   Client rollups mirror the workbook's SUMIFS chains. */
(function () {
  "use strict";

  var EPOCH = Date.UTC(2022, 0, 1);
  var DAY = 86400000;
  var S = { consol: null, credit: null, dims: null };
  var ready = false;
  var MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  /* ---------------- dates ---------------- */
  function fromDnum(n) { return new Date(EPOCH + n * DAY); }
  function fmtDate(n) {
    if (n === null || n === undefined) return "";
    var d = fromDnum(n);
    return String(d.getUTCDate()).padStart(2, "0") + "-" + MN[d.getUTCMonth()] + "-" + String(d.getUTCFullYear()).slice(2);
  }
  function dnumFromISO(s) {
    if (!s) return null;
    var p = String(s).split("-");
    if (p.length !== 3) return null;
    var t = Date.UTC(+p[0], +p[1] - 1, +p[2]);
    if (isNaN(t)) return null;
    return Math.round((t - EPOCH) / DAY);
  }

  var FYS = [
    { id: "2022-23", label: "FY 2022–23", y: 2022 },
    { id: "2023-24", label: "FY 2023–24", y: 2023 },
    { id: "2024-25", label: "FY 2024–25", y: 2024 },
    { id: "2025-26", label: "FY 2025–26", y: 2025 },
    { id: "2026-27", label: "FY 2026–27 (part)", y: 2026 }
  ];
  var DATA_END = Date.UTC(2026, 5, 30);

  function fyMonths(fy) {
    var out = [], y = fy.y;
    for (var i = 0; i < 12; i++) {
      var mo = (3 + i) % 12, yy = y + (3 + i >= 12 ? 1 : 0);
      var start = Date.UTC(yy, mo, 1);
      if (start > DATA_END) break;
      out.push({
        s: Math.round((start - EPOCH) / DAY),
        e: Math.round((Date.UTC(yy, mo + 1, 0) - EPOCH) / DAY),
        label: MN[mo] + "-" + String(yy).slice(2)
      });
    }
    return out;
  }

  /* ---------------- formatting ---------------- */
  function inr(v) {
    if (!v || Math.abs(v) < 0.5) return "–";
    var neg = v < 0, n = Math.round(Math.abs(v)).toString();
    var last3 = n.slice(-3), rest = n.slice(0, -3);
    var s = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
    return (neg ? "-" : "") + s;
  }
  function inrShort(v) {
    var neg = v < 0; v = Math.abs(v); var s;
    if (v >= 1e7) s = (v / 1e7).toFixed(2) + " Cr";
    else if (v >= 1e5) s = (v / 1e5).toFixed(2) + " L";
    else if (v >= 1e3) s = (v / 1e3).toFixed(1) + " K";
    else s = Math.round(v).toString();
    return (neg ? "-₹" : "₹") + s;
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---------------- persistent stores ---------------- */
  function store(key) {
    var data = {};
    try { data = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) { data = {}; }
    function save() { try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {} }
    return {
      all: function () { return data; },
      get: function (k) { return data[k]; },
      set: function (k, v) { data[k] = v; save(); },
      del: function (k) { delete data[k]; save(); },
      clear: function () { data = {}; try { localStorage.removeItem(key); } catch (e) {} },
      /* Whole-object snapshot/restore — undoing a bulk "Reset edits" needs to
         put everything back in one step, not replay N individual sets. */
      snapshot: function () { return JSON.parse(JSON.stringify(data)); },
      restoreAll: function (snap) { data = JSON.parse(JSON.stringify(snap || {})); save(); },
      /* Copy-on-write array ops. The naive get()+push()+set() pattern mutates
         the SAME array the store already holds before set() ever runs, so the
         "old" and "new" values become indistinguishable — fatal for undo,
         since there'd be nothing left to revert to. */
      appendToArray: function (k, item) {
        var arr = (data[k] || []).slice();
        arr.push(item);
        data[k] = arr; save();
        return arr;
      },
      popFromArray: function (k) {
        var arr = (data[k] || []).slice();
        var popped = arr.pop();
        data[k] = arr; save();
        return popped;
      }
    };
  }
  var EDITS = store("ra_edits_v1");   // "sheet|rowIndex|field" -> value
  var ADDS = store("ra_adds_v1");     // "sheet" -> [rowArray, ...]
  var MXO = store("ra_matrix_v1");    // client×month overrides on the analytic sheet

  /* ---------------- undo / redo ----------------
     Every mutation (a cell edit, a matrix override, an added client, a bulk
     reset) is expressed as {apply, revert, label} and run through perform().
     One shared stack across all three stores, so Ctrl+Z always undoes
     whatever actually happened last, regardless of which sheet it was on. */
  var HISTORY = (function () {
    var stack = [], idx = -1, MAX = 100;
    function perform(action) {
      stack = stack.slice(0, idx + 1);   // drop any redo branch
      action.apply();
      stack.push(action);
      if (stack.length > MAX) stack.shift(); else idx++;
      idx = stack.length - 1;
    }
    function undo() {
      if (idx < 0) return null;
      var a = stack[idx]; a.revert(); idx--;
      return a;
    }
    function redo() {
      if (idx + 1 >= stack.length) return null;
      idx++; var a = stack[idx]; a.apply();
      return a;
    }
    return {
      perform: perform, undo: undo, redo: redo,
      canUndo: function () { return idx >= 0; },
      canRedo: function () { return idx + 1 < stack.length; }
    };
  })();

  /* Shared by the keyboard shortcuts and the toolbar Undo/Redo buttons, so
     both paths behave identically (re-render, toast, respect canEdit()). */
  function runUndo() {
    if (!canEdit() || !HISTORY.canUndo()) return;
    var a = HISTORY.undo();
    render();
    if (a) toast("Undid: " + a.label);
  }
  function runRedo() {
    if (!canEdit() || !HISTORY.canRedo()) return;
    var a = HISTORY.redo();
    render();
    if (a) toast("Redid: " + a.label);
  }

  /* Overrides typed straight onto the Recurring Revenue grid. Keyed by the
     things that identify the cell across re-renders and FY switches. */
  function mxKey(tab, metric, fy, monthLabel, client) {
    return [tab, metric, fy, monthLabel, client].join("|");
  }
  function mxCount() {
    var n = 0, all = MXO.all();
    for (var k in all) n++;
    return n;
  }
  function parseNum(v) {
    var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
    return isNaN(n) ? null : n;
  }

  /* ═════════════ auth / roles ═════════════
     NOTE: this is a front-end role gate, not a security boundary. The data
     files are served statically and anything enforced in the browser can be
     bypassed. Real enforcement belongs in the API (server sessions, per-role
     endpoints); this layer controls who can change figures in the UI. */
  var AUTH = (function () {
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

    return {
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
  })();

  /* single gate every editable surface consults */
  function canEdit() { return AUTH.isAdmin(); }

  function editKey(sheet, ri, f) { return sheet + "|" + ri + "|" + f; }
  function getEdit(sheet, ri, f) { return EDITS.get(editKey(sheet, ri, f)); }
  function setEdit(sheet, ri, f, v) { EDITS.set(editKey(sheet, ri, f), v); }
  function isEdited(sheet, ri, f) { return getEdit(sheet, ri, f) !== undefined; }
  function editCount(sheet) {
    var n = 0, all = EDITS.all();
    for (var k in all) if (k.indexOf(sheet + "|") === 0) n++;
    return n;
  }

  /* rows the user added, appended after the source rows on load */
  var addedFrom = { consol: Infinity, credit: Infinity };
  function applyAdds(sheet, ds) {
    var list = ADDS.get(sheet) || [];
    addedFrom[sheet] = ds.rows.length;
    for (var i = 0; i < list.length; i++) ds.rows.push(list[i]);
  }
  function isAdded(sheet, ri) { return ri >= addedFrom[sheet]; }

  function dictAdd(dict, val) {
    val = String(val == null ? "" : val);
    var i = dict.indexOf(val);
    if (i < 0) { dict.push(val); i = dict.length - 1; }
    return i;
  }

  /* ---------------- field access (edits win over source) ---------------- */
  function fieldVal(ds, sheet, ri, field) {
    var e = getEdit(sheet, ri, field);
    if (e !== undefined) return e;
    var r = ds.rows[ri], d = ds.dicts;
    switch (field) {
      case "inv": return d.inv[r[0]];
      case "client": return d.client[r[1]];
      case "invdate": return fmtDate(r[2]);
      case "item": return d.item[r[3]];
      case "product": return d.product[r[4]];
      case "desc": return d.desc[r[5]];
      case "rec": return r[6] ? "Recurring" : "One-time";
      case "users": return r[7];
      case "start": return fmtDate(r[8]);
      case "end": return fmtDate(r[9]);
      case "amount": return r[10];
    }
    return "";
  }
  function effAmount(ds, sheet, ri) {
    var e = getEdit(sheet, ri, "amount");
    if (e !== undefined) {
      var n = parseFloat(String(e).replace(/[^0-9.\-]/g, ""));
      if (!isNaN(n)) return n;
    }
    return ds.rows[ri][10];
  }
  function effRec(ds, sheet, ri) {
    var e = getEdit(sheet, ri, "rec");
    if (e !== undefined) return /recur/i.test(e) ? 1 : 0;
    return ds.rows[ri][6];
  }
  function effProduct(ds, sheet, ri) {
    var e = getEdit(sheet, ri, "product");
    return e !== undefined ? e : ds.dicts.product[ds.rows[ri][4]];
  }
  /* service period, honouring edited dates — so filling a blank date on a
     flagged row immediately brings its revenue into every total */
  function effPeriod(ds, sheet, ri) {
    var r = ds.rows[ri];
    var s = r[8], e = r[9];
    var es = getEdit(sheet, ri, "start"), ee = getEdit(sheet, ri, "end");
    if (es !== undefined) s = parseUserDate(es);
    if (ee !== undefined) e = parseUserDate(ee);
    if (s === null || s === undefined || e === null || e === undefined || e < s) return null;
    return { s: s, e: e };
  }
  function parseUserDate(v) {
    if (v === null || v === undefined || v === "") return null;
    var s = String(v).trim();
    var m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
    if (m) {
      var mi = MN.indexOf(m[2].charAt(0).toUpperCase() + m[2].slice(1, 3).toLowerCase());
      if (mi >= 0) return Math.round((Date.UTC(2000 + +m[3], mi, +m[1]) - EPOCH) / DAY);
    }
    var iso = dnumFromISO(s);
    if (iso !== null) return iso;
    var t = Date.parse(s);
    return isNaN(t) ? null : Math.round((t - EPOCH) / DAY);
  }

  /* ---------------- the recognition rule ---------------- */
  function monthlyOf(ds, sheet, ri, months) {
    var out = new Array(months.length).fill(0);
    var p = effPeriod(ds, sheet, ri);
    if (!p) return out;                       // no service period → not recognised
    var amt = effAmount(ds, sheet, ri);
    var period = p.e - p.s + 1;
    if (period <= 0) return out;
    for (var i = 0; i < months.length; i++) {
      var m = months[i];
      if (p.e < m.s || p.s > m.e) continue;
      var lo = p.s > m.s ? p.s : m.s, hi = p.e < m.e ? p.e : m.e;
      var d = hi - lo + 1;
      if (d > 0) out[i] = amt * d / period;
    }
    return out;
  }

  function aggregate(ds, sheet, months, filterFn) {
    var map = new Map();
    for (var i = 0; i < ds.rows.length; i++) {
      if (filterFn && !filterFn(ds, sheet, i)) continue;
      var name = fieldVal(ds, sheet, i, "client");
      var arr = map.get(name);
      if (!arr) { arr = new Array(months.length).fill(0); map.set(name, arr); }
      var mv = monthlyOf(ds, sheet, i, months);
      for (var m = 0; m < months.length; m++) arr[m] += mv[m];
    }
    return map;
  }

  var onlyRecurring = function (ds, sheet, i) { return effRec(ds, sheet, i) === 1; };
  var onlyOneTime = function (ds, sheet, i) { return effRec(ds, sheet, i) === 0; };
  function recurringProduct(prod) {
    return function (ds, sheet, i) {
      return effRec(ds, sheet, i) === 1 && effProduct(ds, sheet, i) === prod;
    };
  }

  /* ---------------- state ---------------- */
  var state = { tab: "recurr", fy: "2024-25", metric: "net", search: "", sort: "total_desc", flagOnly: false };

  var TABS = [
    { id: "recurr",  label: "Recurring Revenue by Client" },
    { id: "consol",  label: "Consol Sheet" },
    { id: "invoice", label: "Invoice Dump" },
    { id: "credit",  label: "Credit Notes" },
    { id: "sfagt",   label: "SFA GT",        product: "GT subscription" },
    { id: "dms",     label: "DMS",           product: "DMS subscription" },
    { id: "sfamt",   label: "SFA MT",        product: "MT subscription" },
    { id: "flo",     label: "Flo",           product: "Flo subscription" },
    { id: "other",   label: "Other Modules", product: "Other modules" },
    { id: "onetime", label: "One-time (OTC)" }
  ];
  function curFY() { return FYS.filter(function (f) { return f.id === state.fy; })[0] || FYS[2]; }

  /* ================= Excel-style range selection ================= */
  /* Drag across value cells to get Count / Sum / Average, like Excel's status
     bar. Only non-editable numeric cells take part, so cell editing in the
     ledger tabs is untouched. */
  /* Excel-style selection: plain drag = one rectangle (replaces any previous
     selection); Ctrl+drag/click = ADD a new, disjoint rectangle, keeping the
     others (matches Ctrl+click/drag in Excel/Sheets); Shift+click extends the
     most recently added rectangle from its own anchor. Row-number cells pick
     a whole row; column headers pick a whole column; both support the same
     Ctrl/Shift modifiers. */
  var SEL = (function () {
    var ranges = [];          // [{r0,r1,c0,c1}, ...] — committed + the live one being dragged
    var anchor = null;        // {r,c} fixed corner of the ACTIVE (last) range
    var excluded = {};        // "r,c" keys punched out of a range by Ctrl+click (Excel-style hole)
    var dragging = false, wrap = null, tbody = null, bar = null;
    var firstValCol = null, lastValCol = null;   // span of data-v columns, for row-number picks

    function cells() { return tbody ? tbody.rows : []; }

    function coveredBy(r, c) {
      for (var i = 0; i < ranges.length; i++) {
        var rg = ranges[i];
        if (r >= rg.r0 && r <= rg.r1 && c >= rg.c0 && c <= rg.c1) return true;
      }
      return false;
    }
    function isSelectedCell(r, c) { return coveredBy(r, c) && !excluded[r + "," + c]; }

    function clearMarks() {
      if (!tbody || !wrap) return;
      var marked = tbody.querySelectorAll("td.sel, td.sel-anchor");
      for (var i = 0; i < marked.length; i++) {
        marked[i].classList.remove("sel", "sel-anchor");
        marked[i].style.boxShadow = "";
      }
      var rn = tbody.querySelectorAll("td.rownum.row-sel");
      for (var j = 0; j < rn.length; j++) rn[j].classList.remove("row-sel");
      var head = wrap.querySelector("thead tr.hdr-row");
      if (head) {
        var ch = head.querySelectorAll("th.col-sel");
        for (var k = 0; k < ch.length; k++) ch[k].classList.remove("col-sel");
      }
    }
    function hideBar() { if (bar) { bar.remove(); bar = null; } }
    function clear() { clearMarks(); hideBar(); ranges = []; anchor = null; excluded = {}; }

    function edgeShadow(t, b, l, r) {
      var parts = [];
      if (t) parts.push("inset 0 1.5px 0 var(--sel-edge)");
      if (b) parts.push("inset 0 -1.5px 0 var(--sel-edge)");
      if (l) parts.push("inset 1.5px 0 0 var(--sel-edge)");
      if (r) parts.push("inset -1.5px 0 0 var(--sel-edge)");
      return parts.join(", ");
    }

    function paintAll() {
      clearMarks();
      var rows = cells();
      if (!ranges.length) { hideBar(); return; }
      var seen = {}, n = 0, sum = 0, min = Infinity, max = -Infinity;
      var head = wrap.querySelector("thead tr.hdr-row");

      ranges.forEach(function (rg) {
        for (var r = rg.r0; r <= rg.r1 && r < rows.length; r++) {
          var tr = rows[r];
          var rowHasSel = false;
          for (var c = rg.c0; c <= rg.c1 && c < tr.cells.length; c++) {
            var key = r + "," + c;
            if (excluded[key]) continue;   // punched-out hole — not part of the selection
            var td = tr.cells[c];
            td.classList.add("sel");
            td.style.boxShadow = edgeShadow(r === rg.r0, r === rg.r1, c === rg.c0, c === rg.c1);
            rowHasSel = true;
            if (!seen[key]) {
              seen[key] = 1;
              var v = td.getAttribute("data-v");
              if (v !== null && v !== "") {
                var num = parseFloat(v);
                if (!isNaN(num)) { n++; sum += num; if (num < min) min = num; if (num > max) max = num; }
              }
            }
          }
          if (rowHasSel && tr.cells[0] && tr.cells[0].classList.contains("rownum")) tr.cells[0].classList.add("row-sel");
        }
        var colFullySel = true;
        for (var rr = rg.r0; rr <= rg.r1 && rr < rows.length; rr++) if (excluded[rr + "," + rg.c0]) { colFullySel = false; break; }
        if (colFullySel && head && rg.c0 === rg.c1 && rg.r0 === 0 && rg.r1 >= rows.length - 1 && head.cells[rg.c0]) {
          head.cells[rg.c0].classList.add("col-sel");
        }
      });

      if (anchor && rows[anchor.r] && rows[anchor.r].cells[anchor.c]) {
        rows[anchor.r].cells[anchor.c].classList.add("sel-anchor");
      }
      showBar(n, sum, min, max, ranges);
    }

    function showBar(n, sum, min, max, rgs) {
      if (!bar) {
        bar = document.createElement("div");
        bar.className = "statusbar";
        document.body.appendChild(bar);
        bar.addEventListener("mousedown", function (e) { e.stopPropagation(); });
        bar.addEventListener("click", function (e) { if (e.target.closest(".clear")) clear(); });
      }
      var avg = n ? sum / n : 0;
      var num = function (v) { return Math.abs(v) < 0.5 ? "0" : inr(v); };
      bar.innerHTML =
        '<div class="stat"><div class="sk">Count</div><div class="sv tab-num">' + n.toLocaleString("en-IN") + "</div></div>" +
        '<div class="stat"><div class="sk">Sum</div><div class="sv accent tab-num">' + (n ? "₹" + num(sum) : "–") + "</div></div>" +
        '<div class="stat"><div class="sk">Average</div><div class="sv tab-num">' + (n ? "₹" + num(avg) : "–") + "</div></div>" +
        '<div class="stat"><div class="sk">Min / Max</div><div class="sv tab-num" style="font-size:11.5px">' +
          (n ? "₹" + num(min) + " / ₹" + num(max) : "–") + "</div></div>" +
        '<button class="clear" title="Clear selection (Esc)">×</button>';
    }

    function posOf(td) {
      var tr = td.parentElement;
      if (!tr || tr.parentElement !== tbody) return null;
      return { r: tr.sectionRowIndex, c: td.cellIndex };
    }
    function selectable(td) { return td && td.tagName === "TD" && td.hasAttribute("data-v"); }

    function startRange(r0, r1, c0, c1) { ranges = [{ r0: r0, r1: r1, c0: c0, c1: c1 }]; anchor = { r: r0, c: c0 }; excluded = {}; }
    function pushRange(r0, r1, c0, c1) { ranges.push({ r0: r0, r1: r1, c0: c0, c1: c1 }); anchor = { r: r0, c: c0 }; }
    /* Ctrl+click on a range that's already selected removes it (Excel's
       toggle-off behavior) instead of adding a duplicate on top of itself.
       Returns true if the range was removed, false if it was added. */
    function toggleRange(r0, r1, c0, c1) {
      for (var i = 0; i < ranges.length; i++) {
        var rg = ranges[i];
        if (rg.r0 === r0 && rg.r1 === r1 && rg.c0 === c0 && rg.c1 === c1) {
          ranges.splice(i, 1);
          var last = ranges[ranges.length - 1];
          anchor = last ? { r: last.r0, c: last.c0 } : null;
          return true;
        }
      }
      pushRange(r0, r1, c0, c1);
      return false;
    }
    function extendActive(r, c) {
      if (!ranges.length || !anchor) { startRange(r, r, c, c); return; }
      var rg = ranges[ranges.length - 1];
      rg.r0 = Math.min(anchor.r, r); rg.r1 = Math.max(anchor.r, r);
      rg.c0 = Math.min(anchor.c, c); rg.c1 = Math.max(anchor.c, c);
    }

    var pending = null, downXY = null;
    function beginDrag() {
      dragging = true; pending = null;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      window.getSelection && window.getSelection().removeAllRanges();
      wrap.classList.add("selecting");
    }

    function attach(gridWrap) {
      wrap = gridWrap;
      tbody = wrap.querySelector("tbody");
      ranges = []; anchor = null; pending = null; hideBar();
      firstValCol = lastValCol = null;
      if (!tbody) return;

      var firstRow = tbody.rows[0];
      if (firstRow) {
        for (var i = 0; i < firstRow.cells.length; i++) {
          if (firstRow.cells[i].hasAttribute("data-v")) {
            if (firstValCol === null) firstValCol = i;
            lastValCol = i;
          }
        }
      }

      wrap.addEventListener("mousedown", function (e) {
        /* Row-number cells and the column header have their own click
           handlers (below) with their own Ctrl/Shift handling — bail out here
           without clearing, or a Ctrl/Shift click on either would wipe the
           very selection those modifiers are meant to add to, before its own
           handler ever runs. */
        if (e.target.closest && (e.target.closest("td.rownum") || e.target.closest("thead"))) return;
        var td = e.target.closest ? e.target.closest("td") : null;
        if (!selectable(td)) { if (!e.target.closest(".statusbar")) clear(); return; }
        var p = posOf(td);
        if (!p) return;
        if (e.shiftKey) { e.preventDefault(); extendActive(p.r, p.c); paintAll(); return; }
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
          var key = p.r + "," + p.c;
          if (isSelectedCell(p.r, p.c)) {
            // Already selected: a standalone 1-cell range (added via a prior
            // Ctrl+click) is removed outright; a cell inside a bigger range
            // (e.g. the middle of a 3x3 drag) is punched out as a hole,
            // leaving the rest of that range selected — matches Excel.
            var idx = -1;
            for (var i = 0; i < ranges.length; i++) {
              var rg = ranges[i];
              if (rg.r0 === p.r && rg.r1 === p.r && rg.c0 === p.c && rg.c1 === p.c) { idx = i; break; }
            }
            if (idx >= 0) {
              ranges.splice(idx, 1);
              delete excluded[key];
              var last = ranges[ranges.length - 1];
              anchor = last ? { r: last.r0, c: last.c0 } : null;
            } else {
              excluded[key] = 1;
            }
          } else if (excluded[key]) {
            delete excluded[key];   // re-include a previously punched-out hole
          } else {
            pushRange(p.r, p.r, p.c, p.c);
            beginDrag();
          }
          paintAll();
          return;
        }
        /* Plain click/drag: this cell ALWAYS becomes the sole selection first
           — exactly like Excel, where clicking a cell (even one you're about
           to type into) immediately replaces whatever was selected before.
           Selecting and focusing-to-edit aren't in conflict: this only
           touches CSS classes on the cell, so the browser still places the
           caret normally right after. If the mouse then moves before release,
           this 1-cell selection grows into a drag range (see mousemove). */
        downXY = { x: e.clientX, y: e.clientY };
        startRange(p.r, p.r, p.c, p.c);
        paintAll();
        if (td.isContentEditable) {
          pending = p;   // might still grow into a drag — don't preventDefault, or native focus/caret breaks
        } else {
          e.preventDefault();
          beginDrag();
        }
      });
      wrap.addEventListener("mousemove", function (e) {
        if (pending && downXY) {
          var moved = Math.abs(e.clientX - downXY.x) + Math.abs(e.clientY - downXY.y);
          if (moved > 5) { beginDrag(); }
          else return;
        }
        if (!dragging) return;
        var td = e.target.closest ? e.target.closest("td") : null;
        if (!td) return;
        var p = posOf(td);
        if (p) { extendActive(p.r, p.c); paintAll(); }
      });

      /* column header: click = that column; Ctrl = add a disjoint column;
         Shift = extend from the active range's column to this one */
      var head = wrap.querySelector("thead tr.hdr-row");
      if (head) {
        head.addEventListener("click", function (e) {
          var th = e.target.closest("th");
          if (!th) return;
          var c = th.cellIndex;
          var rows = cells();
          if (!rows.length) return;
          var first = rows[0].cells[c];
          if (!selectable(first)) return;
          var lastRow = rows.length - 1;
          if (e.shiftKey) extendActive(lastRow, c);
          else if (e.ctrlKey || e.metaKey) toggleRange(0, lastRow, c, c);
          else startRange(0, lastRow, c, c);
          paintAll();
        });
      }

      /* row number: click = that row's value cells; Ctrl = add a disjoint
         row; Shift = extend from the active range's row to this one */
      tbody.addEventListener("click", function (e) {
        var td = e.target.closest ? e.target.closest("td.rownum") : null;
        if (!td || firstValCol === null) return;
        var p = posOf(td);
        if (!p) return;
        if (e.shiftKey) extendActive(p.r, lastValCol);
        else if (e.ctrlKey || e.metaKey) toggleRange(p.r, p.r, firstValCol, lastValCol);
        else startRange(p.r, p.r, firstValCol, lastValCol);
        paintAll();
      });
    }

    document.addEventListener("mouseup", function () {
      pending = null; downXY = null;
      if (dragging) { dragging = false; if (wrap) wrap.classList.remove("selecting"); }
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") clear(); });

    return { attach: attach, clear: clear };
  })();

  /* ================= streaming ================= */
  function loadMoreHTML(total) {
    return '<div class="load-more" id="loadMore">' +
      '<span class="bar"><i style="width:0%"></i></span>' +
      '<span id="loadTxt">0 of ' + total.toLocaleString("en-IN") + " rows</span></div>";
  }

  function attachInfinite(wrap, tbody, total, chunkHTML) {
    var CHUNK = 150, shown = 0, busy = false, io = null;
    var lm = document.getElementById("loadMore");
    var barEl = lm ? lm.querySelector(".bar i") : null;
    var txt = document.getElementById("loadTxt");
    var sentinel = wrap.querySelector(".sentinel");

    function paint() {
      if (barEl) barEl.style.width = (total ? (shown / total) * 100 : 100).toFixed(1) + "%";
      if (txt) txt.textContent = shown.toLocaleString("en-IN") + " of " + total.toLocaleString("en-IN") +
        " rows" + (shown >= total ? " — all loaded" : " · scroll for more");
    }
    function rawGrow() {
      if (busy || shown >= total) return;
      busy = true;
      var next = Math.min(shown + CHUNK, total);
      tbody.insertAdjacentHTML("beforeend", chunkHTML(shown, next));
      shown = next;
      paint();
      busy = false;
      if (shown >= total && io) { io.disconnect(); if (sentinel) sentinel.style.display = "none"; }
    }
    /* Dimensions are cached and refreshed after each append, so the scroll
       handler never reads scrollHeight — that read forces a synchronous layout
       which costs hundreds of ms once the table is large. */
    var contentH = 0, clientH = 0, measuring = false;
    function measure() {
      contentH = wrap.scrollHeight; clientH = wrap.clientHeight; measuring = false;
      if (contentH <= clientH + 40 && shown < total) grow();
    }
    function grow() {
      if (measuring) return;
      measuring = true;
      rawGrow();
      setTimeout(measure, 0);
    }
    wrap.addEventListener("scroll", function () {
      if (measuring || shown >= total || !contentH) return;
      if (wrap.scrollTop + clientH >= contentH - 700) grow();
    }, { passive: true });
    if (sentinel && "IntersectionObserver" in window) {
      io = new IntersectionObserver(function (en) {
        if (en.some(function (x) { return x.isIntersecting; })) grow();
      }, { root: wrap, rootMargin: "800px 0px" });
      io.observe(sentinel);
    }
    grow();
  }

  /* ================= shared chrome ================= */
  function kpiCard(k, v, s, cls) {
    return '<div class="kpi"><div class="k">' + k + '</div><div class="v tab-num">' + v + "</div>" +
      (s ? '<div class="s tab-num ' + (cls || "") + '">' + s + "</div>" : "") + "</div>";
  }
  function toolbarControlsHTML() {
    return '<span class="tb-right">' +
      (canEdit()
        ? '<span class="undo-redo">' +
          '<button class="icon-btn" id="undoBtn" title="Undo (Ctrl+Z)"' + (HISTORY.canUndo() ? "" : " disabled") + ">↺</button>" +
          '<button class="icon-btn" id="redoBtn" title="Redo (Ctrl+U, or Ctrl+Shift+Z)"' + (HISTORY.canRedo() ? "" : " disabled") + ">↻</button>" +
          "</span>" +
          '<button class="btn-primary" id="addBtn" title="Add a new client line">+ Add client</button>'
        : "") +
      '<select id="fySel" title="Financial year">' +
      FYS.map(function (f) {
        return '<option value="' + f.id + '"' + (f.id === state.fy ? " selected" : "") + ">" + f.label + "</option>";
      }).join("") +
      "</select>" +
      '<button class="icon-btn" id="exportBtn" title="Download this view as CSV">↓ CSV</button>' +
      "</span>";
  }
  function wireSearchSort(view) {
    var q = view.querySelector("#q");
    if (q) {
      var t;
      q.addEventListener("input", function () {
        clearTimeout(t);
        t = setTimeout(function () { state.search = q.value; render(true); }, 180);
      });
    }
    var ss = view.querySelector("#sortSel");
    if (ss) ss.addEventListener("change", function () { state.sort = ss.value; render(); });
  }

  var MONTH_W = 108;
  var LEDGER_COLS = [
    { label: "Invoice No.", f: "inv", w: 158 },
    { label: "Client Name", f: "client", w: 270 },
    { label: "Invoice Date", f: "invdate", w: 112 },
    { label: "Item", f: "item", edit: true, w: 220 },
    { label: "Product", f: "product", edit: true, w: 150 },
    { label: "Item Description", f: "desc", edit: true, w: 300 },
    { label: "One-time / Recurring", f: "rec", edit: true, w: 150 },
    { label: "User Count", f: "users", num: true, edit: true, w: 100 },
    { label: "Start Date", f: "start", edit: true, w: 112 },
    { label: "End Date", f: "end", edit: true, w: 112 },
    { label: "Amount", f: "amount", num: true, edit: true, w: 125 }
  ];
  var CREDIT_COLS = LEDGER_COLS.map(function (c) {
    return c.f === "inv" ? { label: "Credit Note No.", f: "inv", w: 158 }
      : c.f === "invdate" ? { label: "Credit Note Date", f: "invdate", w: 118 } : c;
  });

  /* ================= client × month matrix ================= */
  function renderMatrix(opts) {
    var months = fyMonths(curFY());
    var gross = aggregate(S.consol, "consol", months, opts.filter);
    var credit = opts.netable ? aggregate(S.credit, "credit", months, opts.filter) : new Map();

    var names = new Set();
    gross.forEach(function (_, k) { names.add(k); });
    credit.forEach(function (_, k) { names.add(k); });

    var metric = opts.netable ? state.metric : "gross";
    var editable = !!opts.editable && canEdit();
    var rows = [];
    names.forEach(function (n) {
      var g = gross.get(n) || new Array(months.length).fill(0);
      var c = credit.get(n) || new Array(months.length).fill(0);
      var ov = [];
      var vals = months.map(function (m, i) {
        var v = metric === "gross" ? g[i] : metric === "credit" ? c[i] : g[i] - c[i];
        if (editable) {
          var o = MXO.get(mxKey(state.tab, metric, state.fy, m.label, n));
          if (o !== undefined) { var p = parseNum(o); if (p !== null) { ov[i] = true; v = p; } }
        }
        return v;
      });
      /* totals come from the overridden values, so a typed figure flows into
         the month total, the FY total and the KPI cards */
      var tot = vals.reduce(function (a, b) { return a + b; }, 0);
      if (Math.abs(tot) < 0.5 && !vals.some(function (v) { return Math.abs(v) >= 0.5; }) && !ov.length) return;
      rows.push({ name: n, vals: vals, total: tot, ov: ov });
    });

    var term = state.search.trim().toLowerCase();
    if (term) rows = rows.filter(function (r) { return r.name.toLowerCase().indexOf(term) !== -1; });
    rows.sort(state.sort === "name_asc"
      ? function (a, b) { return a.name.localeCompare(b.name); }
      : state.sort === "total_asc"
        ? function (a, b) { return a.total - b.total; }
        : function (a, b) { return b.total - a.total; });

    var colTot = months.map(function (_, i) {
      return rows.reduce(function (s, r) { return s + r.vals[i]; }, 0);
    });
    var grand = colTot.reduce(function (a, b) { return a + b; }, 0);
    var metricLabel = metric === "gross" ? "Gross revenue" : metric === "credit" ? "Credit notes" : "Net revenue";
    var peak = colTot.indexOf(Math.max.apply(null, colTot));

    var html = '<div class="kpis">' +
      kpiCard(metricLabel + " · " + curFY().label, inrShort(grand), months.length + " months") +
      kpiCard("Clients with activity", rows.length.toLocaleString("en-IN"), "in this financial year") +
      kpiCard("Peak month", months[peak] ? months[peak].label : "–", months[peak] ? inrShort(colTot[peak]) : "") +
      kpiCard("Monthly average", inrShort(grand / (months.length || 1)), "across " + months.length + " months") +
      "</div>";

    html += '<div class="card">';
    html += '<div class="toolbar">' +
      '<input type="search" id="q" placeholder="Search client…" value="' + esc(state.search) + '" />' +
      '<select id="sortSel">' +
      '<option value="total_desc"' + (state.sort === "total_desc" ? " selected" : "") + ">Total (high → low)</option>" +
      '<option value="total_asc"' + (state.sort === "total_asc" ? " selected" : "") + ">Total (low → high)</option>" +
      '<option value="name_asc"' + (state.sort === "name_asc" ? " selected" : "") + ">Client name (A → Z)</option>" +
      "</select>" +
      (opts.netable
        ? '<div class="seg" role="group" aria-label="Metric">' +
          '<button data-metric="gross" aria-pressed="' + (metric === "gross") + '">Gross</button>' +
          '<button data-metric="credit" aria-pressed="' + (metric === "credit") + '">Credit notes</button>' +
          '<button data-metric="net" aria-pressed="' + (metric === "net") + '">Net</button></div>'
        : "") +
      (editable
        ? (mxCount() ? '<button class="icon-btn" id="clrMx">Reset ' + mxCount() + " override(s)</button>" : "")
        : '<span class="badge-lock">🔒 ' + (opts.editable ? "Read-only access" : "Derived — read-only") + "</span>") +
      toolbarControlsHTML() + "</div>";

    html += '<div class="grid-wrap" id="gw"><table class="grid"><thead>' +
      '<tr class="hdr-row"><th class="rownum" style="width:38px"></th><th class="lbl sticky-l" style="width:300px">Client</th>' +
      months.map(function (m) { return '<th class="num" style="width:' + MONTH_W + 'px" title="Click to select this column · Ctrl+click to add another">' + m.label + "</th>"; }).join("") +
      '<th class="num" style="width:130px">FY Total</th></tr>' +
      '<tr class="total-row"><th class="rownum"></th><th class="lbl sticky-l"></th>' +
      colTot.map(function (v) { return '<th class="num">' + inr(v) + "</th>"; }).join("") +
      '<th class="num">' + inr(grand) + "</th></tr></thead><tbody id=\"tb\">";

    if (!rows.length) {
      html += '<tr><td colspan="' + (months.length + 3) + '" style="padding:26px;text-align:center;color:var(--ink-3)">No matching clients.</td></tr>';
    }
    html += '</tbody></table><div class="sentinel" aria-hidden="true"></div></div>' +
      (rows.length ? loadMoreHTML(rows.length) : "") + "</div>";

    var view = document.getElementById("view");
    view.innerHTML = html;

    if (rows.length) {
      attachInfinite(view.querySelector("#gw"), view.querySelector("#tb"), rows.length, function (from, to) {
        var out = "";
        for (var i = from; i < to; i++) {
          var r = rows[i];
          out += '<tr><td class="rownum" title="Click to select this row · Ctrl+click to add another">' + (i + 1) + "</td>" +
            '<td class="sticky-l cname" title="' + esc(r.name) + '">' + esc(r.name) + "</td>" +
            r.vals.map(function (v, mi) {
              var disp = inr(v);
              return '<td class="num ' + (Math.abs(v) < 0.5 ? "zero " : v < 0 ? "neg " : "") +
                (editable ? "editable " : "") + (r.ov[mi] ? "edited" : "") +
                '" data-v="' + (Math.round(v * 100) / 100) + '"' +
                (editable ? ' contenteditable="true" data-mx="1" data-client="' + esc(r.name) +
                  '" data-month="' + esc(months[mi].label) + '" data-orig="' + esc(disp) +
                  '" title="Type a figure to override this month for this client — marked A for admin-edited"' : "") +
                ">" + disp + "</td>";
            }).join("") +
            '<td class="num" data-v="' + (Math.round(r.total * 100) / 100) + '"><b>' + inr(r.total) + "</b></td></tr>";
        }
        return out;
      });
      SEL.attach(view.querySelector("#gw"));

      if (editable) {
        var tbEl = view.querySelector("#tb");
        var commitMx = function (td) {
          var nv = td.textContent.trim();
          if (nv === (td.getAttribute("data-orig") || "").trim()) return;
          var key = mxKey(state.tab, metric, state.fy, td.getAttribute("data-month"), td.getAttribute("data-client"));
          var clearing = nv === "" || nv === "–" || nv === "-";
          var n = null;
          if (!clearing) {
            n = parseNum(nv);
            if (n === null) { td.textContent = td.getAttribute("data-orig") || ""; return; }
          }
          var prev = MXO.get(key);   // undefined if this cell had no override yet
          HISTORY.perform({
            label: "override " + td.getAttribute("data-month") + " for " + td.getAttribute("data-client"),
            apply: function () { if (clearing) MXO.del(key); else MXO.set(key, n); },
            revert: function () { if (prev === undefined) MXO.del(key); else MXO.set(key, prev); }
          });
          render();
        };
        tbEl.addEventListener("focusout", function (e) {
          var td = e.target && e.target.closest ? e.target.closest("td[data-mx]") : null;
          if (td) commitMx(td);
        });
        tbEl.addEventListener("keydown", function (e) {
          var td = e.target && e.target.closest ? e.target.closest("td[data-mx]") : null;
          if (!td) return;
          if (e.key === "Enter") { e.preventDefault(); commitMx(td); td.blur(); }
          if (e.key === "Escape") { td.textContent = td.getAttribute("data-orig") || ""; td.blur(); }
        });
      }
    }

    var clrMx = view.querySelector("#clrMx");
    if (clrMx) clrMx.addEventListener("click", function () {
      var snap = MXO.snapshot();
      HISTORY.perform({
        label: "reset all overrides",
        apply: function () { MXO.clear(); },
        revert: function () { MXO.restoreAll(snap); }
      });
      render();
    });

    view.querySelectorAll("[data-metric]").forEach(function (b) {
      b.addEventListener("click", function () { state.metric = b.getAttribute("data-metric"); render(); });
    });
    wireSearchSort(view);
    window.__csv = function () { return matrixCSV(months, rows, colTot, grand, opts.title); };
  }

  function matrixCSV(months, rows, colTot, grand, title) {
    var lines = [["Client"].concat(months.map(function (m) { return m.label; })).concat(["Total"]).join(",")];
    lines.push(["TOTAL"].concat(colTot.map(function (v) { return Math.round(v); })).concat([Math.round(grand)]).join(","));
    rows.forEach(function (r) {
      lines.push(['"' + r.name.replace(/"/g, '""') + '"']
        .concat(r.vals.map(function (v) { return Math.round(v); }))
        .concat([Math.round(r.total)]).join(","));
    });
    return { name: title.replace(/[^\w]+/g, "_") + "_" + state.fy + ".csv", body: lines.join("\n") };
  }

  /* ================= ledger (Consol / Invoice / Credit) ================= */
  function renderLedger(opts) {
    var ds = opts.ds, sheet = opts.sheet;
    var months = fyMonths(curFY());
    var term = state.search.trim().toLowerCase();

    var idx = [];
    for (var i = 0; i < ds.rows.length; i++) {
      if (opts.filter && !opts.filter(ds, sheet, i)) continue;
      if (state.flagOnly && effPeriod(ds, sheet, i)) continue;
      if (term) {
        var hay = (fieldVal(ds, sheet, i, "client") + " " + fieldVal(ds, sheet, i, "inv") + " " +
          fieldVal(ds, sheet, i, "item") + " " + fieldVal(ds, sheet, i, "desc")).toLowerCase();
        if (hay.indexOf(term) === -1) continue;
      }
      idx.push(i);
    }

    var colTot = new Array(months.length).fill(0), grand = 0, flagged = 0, added = 0;
    for (var k = 0; k < idx.length; k++) {
      var ri = idx[k];
      if (!effPeriod(ds, sheet, ri)) flagged++;
      if (isAdded(sheet, ri)) added++;
      var mv = monthlyOf(ds, sheet, ri, months);
      for (var m = 0; m < months.length; m++) { colTot[m] += mv[m]; grand += mv[m]; }
    }

    var edits = editCount(sheet);
    var html = '<div class="kpis">' +
      kpiCard("Line items", idx.length.toLocaleString("en-IN"), opts.kpiSub || "in ledger") +
      kpiCard("Recognised · " + curFY().label, inrShort(grand), months.length + " months") +
      kpiCard("Manual edits", edits.toLocaleString("en-IN"), edits ? "overriding source data" : "none — all from source") +
      kpiCard("Needs attention", flagged.toLocaleString("en-IN"),
        flagged ? "missing service period" : "every row has a service period", flagged ? "down" : "") +
      "</div>";

    var locked = opts.readOnly || !canEdit();

    html += '<div class="card"><div class="toolbar">' +
      '<input type="search" id="q" placeholder="Search invoice no, client, item…" value="' + esc(state.search) + '" />' +
      (opts.readOnly
        ? '<span class="badge-lock">🔒 Read-only — sourced from ' + esc(opts.source) + "</span>"
        : (canEdit() ? '<span class="prov"><span class="dot usr"></span><b>A</b> = admin-edited</span>'
                     : '<span class="badge-lock">🔒 Read-only access</span>')) +
      (added ? '<span class="prov"><span class="dot new"></span>Added (' + added + ")</span>" : "") +
      '<span class="chip"><b>' + idx.length.toLocaleString("en-IN") + "</b> rows</span>" +
      (flagged ? '<button class="icon-btn" id="onlyFlag" style="border-color:var(--gold);color:var(--gold)">' +
        (state.flagOnly ? "✓ " : "") + "Needs attention (" + flagged + ")</button>" : "") +
      (edits && !locked ? '<button class="icon-btn" id="clrEdits">Reset ' + edits + " edit(s)</button>" : "") +
      toolbarControlsHTML() + "</div>";

    var cols = locked
      ? opts.cols.map(function (c) { var d = {}; for (var k in c) d[k] = c[k]; d.edit = false; return d; })
      : opts.cols;
    html += '<div class="grid-wrap' + (locked ? " locked" : "") + '" id="gw"><table class="grid"><thead><tr class="hdr-row">' +
      '<th class="rownum" style="width:38px"></th>' +
      cols.map(function (c, ci) {
        return '<th style="width:' + c.w + 'px" class="' + (c.num ? "num" : "lbl") + (ci === 0 ? " sticky-l" : "") + '">' + esc(c.label) + "</th>";
      }).join("") +
      months.map(function (m) { return '<th class="num" style="width:' + MONTH_W + 'px" title="Click to select this column · Ctrl+click to add another">' + m.label + "</th>"; }).join("") +
      '<th class="num" style="width:130px">FY Total</th></tr>' +
      '<tr class="total-row"><th class="rownum"></th><th class="lbl sticky-l"></th>' +
      cols.slice(1).map(function () { return "<th></th>"; }).join("") +
      colTot.map(function (v) { return '<th class="num">' + inr(v) + "</th>"; }).join("") +
      '<th class="num">' + inr(grand) + "</th></tr></thead><tbody id=\"tb\">";

    function rowHTML(ri, rank) {
      var period = effPeriod(ds, sheet, ri);
      var mv = monthlyOf(ds, sheet, ri, months);
      var rowTot = mv.reduce(function (a, b) { return a + b; }, 0);
      var cls = [];
      if (!period) cls.push("flagged");
      if (isAdded(sheet, ri)) cls.push("isnew");
      return "<tr" + (cls.length ? ' class="' + cls.join(" ") + '"' : "") +
        (!period ? ' title="No service period — add Start and End dates to bring this line into revenue."' : "") + ">" +
        '<td class="rownum" title="Click to select this row · Ctrl+click to add another">' + rank + "</td>" +
        cols.map(function (c, ci) {
          var val = fieldVal(ds, sheet, ri, c.f);
          var disp = c.f === "amount" ? inr(val) : val;
          var ed = isEdited(sheet, ri, c.f);
          return '<td class="' + (c.num ? "num " : "") + (ci === 0 ? "sticky-l " : "") +
            (c.f === "client" ? "cname " : "") + (c.edit ? "editable " : "") + (ed ? "edited" : "") + '"' +
            (c.edit ? ' contenteditable="true" data-ri="' + ri + '" data-f="' + c.f +
              '" data-orig="' + esc(disp) + '" title="Click to edit — marked A for admin-edited"' : "") +
            ">" + esc(disp) + "</td>";
        }).join("") +
        mv.map(function (v) {
          return '<td class="num ' + (Math.abs(v) < 0.5 ? "zero" : v < 0 ? "neg" : "") +
            '" data-v="' + (Math.round(v * 100) / 100) + '">' + inr(v) + "</td>";
        }).join("") +
        '<td class="num" data-v="' + (Math.round(rowTot * 100) / 100) + '"><b>' + inr(rowTot) + "</b></td></tr>";
    }

    if (!idx.length) {
      html += '<tr><td colspan="' + (cols.length + months.length + 2) + '" style="padding:26px;text-align:center;color:var(--ink-3)">No matching rows.</td></tr>';
    }
    html += '</tbody></table><div class="sentinel" aria-hidden="true"></div></div>' +
      (idx.length ? loadMoreHTML(idx.length) : "") + "</div>";

    var view = document.getElementById("view");
    view.innerHTML = html;

    /* One delegated pair of listeners covers every streamed row. */
    var tbEl = view.querySelector("#tb");
    if (tbEl) {
      var commitCell = function (td) {
        var nv = td.textContent.trim();
        var orig = (td.getAttribute("data-orig") || "").trim();
        if (nv === orig) return;
        var ri = +td.getAttribute("data-ri"), field = td.getAttribute("data-f");
        var prev = getEdit(sheet, ri, field);   // undefined if not edited before
        HISTORY.perform({
          label: "edit " + field + " on row " + ri,
          apply: function () { setEdit(sheet, ri, field, nv); },
          revert: function () { if (prev === undefined) EDITS.del(editKey(sheet, ri, field)); else setEdit(sheet, ri, field, prev); }
        });
        render();
      };
      tbEl.addEventListener("focusout", function (e) {
        var td = e.target && e.target.closest ? e.target.closest("td.editable") : null;
        if (td) commitCell(td);
      });
      tbEl.addEventListener("keydown", function (e) {
        var td = e.target && e.target.closest ? e.target.closest("td.editable") : null;
        if (!td) return;
        if (e.key === "Enter") { e.preventDefault(); commitCell(td); td.blur(); }
        if (e.key === "Escape") { td.textContent = td.getAttribute("data-orig") || ""; td.blur(); }
      });
    }

    if (idx.length) {
      attachInfinite(view.querySelector("#gw"), tbEl, idx.length, function (from, to) {
        var out = "";
        for (var i = from; i < to; i++) out += rowHTML(idx[i], i + 1);
        return out;
      });
      SEL.attach(view.querySelector("#gw"));
    }

    var clr = view.querySelector("#clrEdits");
    if (clr) clr.addEventListener("click", function () {
      var snap = EDITS.snapshot();
      HISTORY.perform({
        label: "reset all edits",
        apply: function () { EDITS.clear(); },
        revert: function () { EDITS.restoreAll(snap); }
      });
      render();
    });
    var of = view.querySelector("#onlyFlag");
    if (of) of.addEventListener("click", function () { state.flagOnly = !state.flagOnly; render(); });
    wireSearchSort(view);

    window.__csv = function () {
      var lines = [cols.map(function (c) { return c.label; })
        .concat(months.map(function (m) { return m.label; })).concat(["FY Total"]).join(",")];
      idx.forEach(function (ri) {
        var mv = monthlyOf(ds, sheet, ri, months);
        var tot = mv.reduce(function (a, b) { return a + b; }, 0);
        lines.push(cols.map(function (c) {
          var v = fieldVal(ds, sheet, ri, c.f);
          return typeof v === "string" ? '"' + v.replace(/"/g, '""') + '"' : v;
        }).concat(mv.map(function (v) { return Math.round(v); })).concat([Math.round(tot)]).join(","));
      });
      return { name: opts.title.replace(/[^\w]+/g, "_") + "_" + state.fy + ".csv", body: lines.join("\n") };
    };
  }

  /* ================= add-client modal ================= */
  function productOptions(sel) {
    var list = S.consol ? S.consol.dicts.product.filter(function (p) { return p && p !== "Unknown"; }) : [];
    var seen = {}, out = [];
    list.forEach(function (p) { if (!seen[p]) { seen[p] = 1; out.push(p); } });
    out.sort();
    return out.map(function (p) {
      return '<option value="' + esc(p) + '"' + (p === sel ? " selected" : "") + ">" + esc(p) + "</option>";
    }).join("");
  }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function openAddModal() {
    var fy = curFY();
    var startISO = fy.y + "-04-01";
    var endISO = (fy.y + 1) + "-03-31";
    var wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.id = "modal";
    wrap.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mTitle">' +
      '<div class="modal-hd"><div><h3 id="mTitle">Add client</h3>' +
      "<p>Creates one invoice line — the rest of the dashboard derives from it</p></div>" +
      '<button class="x" id="mClose" aria-label="Close">×</button></div>' +
      '<div class="modal-body">' +
      '<div class="form-note">This line is added to <b>Consol Sheet</b> and <b>Invoice Dump</b>. ' +
      "The <b>Recurring Revenue</b> tab (and the matching product tab) will pick the client up automatically, " +
      "because those views are computed from this ledger rather than stored separately. " +
      "Nothing is written to <b>Credit Notes</b> — a credit note only exists once one is actually raised.</div>" +
      '<div class="fgrid">' +
      '<div class="field full"><label for="fClient">Client name</label>' +
      '<input type="text" id="fClient" placeholder="e.g. ACME FOODS PRIVATE LIMITED" autocomplete="off" list="clientList" />' +
      '<datalist id="clientList"></datalist>' +
      '<span class="help">Existing names autocomplete — reuse one so revenue rolls up to the same client.</span></div>' +

      '<div class="field"><label for="fInv">Invoice number</label>' +
      '<input type="text" id="fInv" placeholder="F2K/2026-27/0001" /></div>' +

      /* Default inside the selected FY so the line shows up in Invoice Dump
         straight away — that tab filters on invoice date, not service period. */
      '<div class="field"><label for="fInvDate">Invoice date</label>' +
      '<input type="date" id="fInvDate" value="' + (todayISO() >= startISO && todayISO() <= endISO ? todayISO() : startISO) + '" />' +
      '<span class="help">Invoice Dump lists lines by this date.</span></div>' +

      '<div class="field"><label for="fProduct">Product</label>' +
      '<select id="fProduct">' + productOptions("GT subscription") + "</select></div>" +

      '<div class="field"><label for="fRec">Type</label>' +
      '<select id="fRec"><option value="1">Recurring</option><option value="0">One-time</option></select></div>' +

      '<div class="field"><label for="fStart">Service start</label>' +
      '<input type="date" id="fStart" value="' + startISO + '" /></div>' +

      '<div class="field"><label for="fEnd">Service end</label>' +
      '<input type="date" id="fEnd" value="' + endISO + '" /></div>' +

      '<div class="field"><label for="fUsers">User count</label>' +
      '<input type="number" id="fUsers" min="0" step="1" value="0" /></div>' +

      '<div class="field"><label for="fAmount">Amount (₹)</label>' +
      '<input type="number" id="fAmount" min="0" step="0.01" placeholder="0.00" /></div>' +

      '<div class="field full"><label for="fItem">Item</label>' +
      '<input type="text" id="fItem" placeholder="SFA GT - Subscription Charges" /></div>' +

      '<div class="field full"><label for="fDesc">Item description</label>' +
      '<input type="text" id="fDesc" placeholder="@ INR 500 / User * 12 Months" /></div>' +
      "</div></div>" +
      '<div class="modal-ft"><span class="err" id="mErr"></span><span class="spacer"></span>' +
      '<button class="icon-btn" id="mCancel">Cancel</button>' +
      '<button class="btn-primary" id="mSave">Add client line</button></div></div>';

    document.body.appendChild(wrap);

    var dl = wrap.querySelector("#clientList");
    if (dl && S.consol) {
      var names = S.consol.dicts.client.slice(0, 4000);
      dl.innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join("");
    }
    setTimeout(function () { var f = wrap.querySelector("#fClient"); if (f) f.focus(); }, 30);

    function close() { wrap.remove(); }
    wrap.querySelector("#mClose").addEventListener("click", close);
    wrap.querySelector("#mCancel").addEventListener("click", close);
    wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) close(); });
    document.addEventListener("keydown", function esc2(e) {
      if (e.key === "Escape" && document.getElementById("modal")) { close(); document.removeEventListener("keydown", esc2); }
    });

    wrap.querySelector("#mSave").addEventListener("click", function () {
      var err = wrap.querySelector("#mErr");
      var g = function (id) { return wrap.querySelector(id).value.trim(); };
      var client = g("#fClient");
      var amount = parseFloat(g("#fAmount"));
      var sDn = dnumFromISO(g("#fStart")), eDn = dnumFromISO(g("#fEnd"));
      if (!client) { err.textContent = "Client name is required."; return; }
      if (isNaN(amount)) { err.textContent = "Enter an amount."; return; }
      if (sDn === null || eDn === null) { err.textContent = "Service start and end dates are required."; return; }
      if (eDn < sDn) { err.textContent = "Service end cannot be before service start."; return; }

      var ds = S.consol, d = ds.dicts;
      var row = [
        dictAdd(d.inv, g("#fInv") || "MANUAL/" + (Date.now() % 100000)),
        dictAdd(d.client, client),
        dnumFromISO(g("#fInvDate")),
        dictAdd(d.item, g("#fItem") || wrap.querySelector("#fProduct").value),
        dictAdd(d.product, wrap.querySelector("#fProduct").value),
        dictAdd(d.desc, g("#fDesc")),
        +wrap.querySelector("#fRec").value,
        parseInt(g("#fUsers"), 10) || 0,
        sDn, eDn, amount
      ];
      HISTORY.perform({
        label: "add client " + client,
        apply: function () { ADDS.appendToArray("consol", row); ds.rows.push(row); },
        revert: function () { ADDS.popFromArray("consol"); ds.rows.pop(); }
      });

      close();
      state.search = "";
      render();
      toast("Added “" + client + "”. It now appears in Consol Sheet, Invoice Dump and the Recurring Revenue rollup.");
    });
  }

  /* ═════════════ auth screens ═════════════ */
  /* A password field with a show/hide toggle. Markup only — id/autocomplete
     are the caller's; wirePasswordToggles() below binds every one on the page. */
  function passwordFieldHTML(id, label, autocomplete, helpHTML, noWrap) {
    var inner = '<label for="' + id + '">' + label + "</label>" +
      '<div class="pw-wrap"><input type="password" id="' + id + '" autocomplete="' + autocomplete + '" />' +
      '<button type="button" class="pw-toggle" data-for="' + id + '" tabindex="-1" ' +
      'aria-label="Show password">👁</button></div>' +
      (helpHTML || "");
    return noWrap ? inner : '<div class="field">' + inner + "</div>";
  }
  function wirePasswordToggles(root) {
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

  function renderAuthScreen() {
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

  /* Compact tab-styled control in the top-right of the brand row: shows who's
     signed in and their access level, opens a small menu for account actions.
     Lives in the brand row (not a separate full-width row) so the header stays
     two rows: brand+account, then tabs+theme. */
  function renderAccountTab() {
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
      renderAccountTab();
      renderAuthScreen();
    });
    var ub = slot.querySelector("#usersBtn");
    if (ub) ub.addEventListener("click", function () { closeAcctMenu(); openUsersModal(); });
    syncHeaderHeight();
  }

  /* Shared by the account-menu's own buttons and by buildChrome()'s outside-
     click/Escape handling — one definition, so both stay in sync. */
  function closeAcctMenu() {
    var m = document.getElementById("acctMenu");
    if (m && m.classList.contains("open")) {
      m.classList.remove("open");
      var b = document.getElementById("acctBtn");
      if (b) b.setAttribute("aria-expanded", "false");
    }
  }

  function openUsersModal() {
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

  function toast(msg) {
    var t = document.createElement("div");
    t.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:90;" +
      "background:var(--surface);border:1px solid var(--border-strong);color:var(--ink);" +
      "padding:11px 16px;border-radius:11px;box-shadow:var(--shadow-lg);font-size:12.5px;max-width:min(560px,92vw)";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.style.transition = "opacity .3s"; t.style.opacity = "0"; }, 4200);
    setTimeout(function () { t.remove(); }, 4600);
  }

  /* ================= dispatch ================= */
  function render(keepFocus) {
    if (!ready) return;
    var t = TABS.filter(function (x) { return x.id === state.tab; })[0];
    var focusId = keepFocus && document.activeElement ? document.activeElement.id : null;
    var selStart = focusId === "q" ? document.activeElement.selectionStart : null;
    SEL.clear();

    /* Editability follows where the data comes from:
       Invoice Dump and Credit Notes mirror the Zoho API and stay read-only;
       the Recurring Revenue sheet is the analytic layer and is editable. */
    if (state.tab === "recurr") {
      renderMatrix({ title: "Recurring Revenue by Client", filter: onlyRecurring, netable: true, editable: true });
    } else if (state.tab === "onetime") {
      renderMatrix({ title: "One-time Charges (OTC) by Client", filter: onlyOneTime, netable: false });
    } else if (t && t.product) {
      renderMatrix({ title: t.label + " — Recurring Revenue", filter: recurringProduct(t.product), netable: false });
    } else if (state.tab === "consol") {
      renderLedger({
        ds: S.consol, sheet: "consol", cols: LEDGER_COLS,
        title: "Consol Sheet", source: "Zoho Books", kpiSub: "invoice lines"
      });
    } else if (state.tab === "invoice") {
      renderLedger({
        ds: S.consol, sheet: "consol", cols: LEDGER_COLS, readOnly: true,
        title: "Invoice Dump", source: "Zoho Books", kpiSub: "invoices raised this FY",
        filter: (function () {
          var ms = fyMonths(curFY());
          if (!ms.length) return null;
          var lo = ms[0].s, hi = ms[ms.length - 1].e;
          return function (ds, sheet, i) { var d = ds.rows[i][2]; return d !== null && d >= lo && d <= hi; };
        })()
      });
    } else if (state.tab === "credit") {
      renderLedger({
        ds: S.credit, sheet: "credit", cols: CREDIT_COLS, readOnly: true,
        title: "Credit Notes Register", source: "Zoho Books", kpiSub: "credit-note lines"
      });
    }

    if (focusId === "q") {
      var q = document.getElementById("q");
      if (q) { q.focus(); try { q.setSelectionRange(selStart, selStart); } catch (e) {} }
    }
  }

  /* ================= chrome ================= */
  function syncHeaderHeight() {
    var bar = document.getElementById("topbar");
    if (bar) document.documentElement.style.setProperty("--nav-h", bar.offsetHeight + "px");
  }

  function buildChrome() {
    syncHeaderHeight();
    window.addEventListener("resize", syncHeaderHeight);

    /* Account-menu close behaviour (closeAcctMenu is defined once, near
       renderAccountTab), bound HERE once — renderAccountTab() rebuilds the
       menu's innerHTML on every login/logout, so listeners attached inside it
       would pile up across a long session instead of being replaced. */
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

  function startApp() {
    renderAccountTab();
    if (dataLoaded) { render(); return; }
    document.getElementById("view").innerHTML =
      '<div class="loading"><div class="spinner"></div>Loading ledger…</div>';
    loadData();
  }

  function boot() {
    buildChrome();
    if (!AUTH.signedIn()) {
      document.getElementById("view").innerHTML = "";
      renderAuthScreen();
      return;
    }
    startApp();
  }

  function loadData() {
    Promise.all([
      fetch("data/consol.json").then(function (r) { return r.json(); }),
      fetch("data/creditnotes.json").then(function (r) { return r.json(); }),
      fetch("data/clientdims.json").then(function (r) { return r.json(); }).catch(function () { return {}; })
    ]).then(function (res) {
      S.consol = res[0]; S.credit = res[1]; S.dims = res[2];
      applyAdds("consol", S.consol);
      applyAdds("credit", S.credit);
      ready = true;
      dataLoaded = true;
      render();
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
})();
