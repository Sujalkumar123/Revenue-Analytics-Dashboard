/* Excel-style range selection over a grid's value cells: plain drag = one
   rectangle (replaces any previous selection); Ctrl+drag/click = ADD a new,
   disjoint rectangle, or punch/un-punch a single cell out of a bigger one;
   Shift+click extends the most recently added rectangle from its own
   anchor. Row-number cells pick a whole row; column headers pick a whole
   column; both support the same Ctrl/Shift modifiers. */
"use strict";

import { inr } from "../core/format.js";

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

export var SEL = { attach: attach, clear: clear };
