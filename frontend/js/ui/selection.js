/* Excel-style range selection over every column of a grid (not just numeric
   ones): plain drag = one rectangle (replaces any previous selection);
   Ctrl+drag/click = ADD a new, disjoint rectangle, or punch/un-punch a
   single cell out of a bigger one; Shift+click extends the most recently
   added rectangle from its own anchor. Row-number cells AND the sticky
   "title" column (first data column — Client/Invoice No./Date, whichever a
   given tab uses) both pick a whole row; column headers pick a whole
   column; all three support the same Ctrl/Shift modifiers. Middle-mouse-
   button drag pans/scrolls the grid — deliberately a different gesture
   from left-click, so it never competes with range selection. */
"use strict";

import { inr } from "../core/format.js";

var ranges = [];          // [{r0,r1,c0,c1}, ...] — committed + the live one being dragged
var anchor = null;        // {r,c} fixed corner of the ACTIVE (last) range
var excluded = {};        // "r,c" keys punched out of a range by Ctrl+click (Excel-style hole)
var dragging = false, wrap = null, tbody = null, bar = null;
var firstSelCol = null, lastSelCol = null;   // span of selectable columns, for row-number/title picks
var rowDragMode = false;   // true while dragging FROM a row handle — extends whole rows, not just one column
var autoScrollActive = false, autoScrollDy = 0, autoScrollX = 0, autoScrollY = 0, autoScrollRAF = null, autoScrollTimer = null;
/* A "straight down/up" drag from a plain cell still has a few px of natural
   hand jitter side to side — without this, that jitter alone was enough to
   smear the selection across neighbouring columns instead of staying in
   the one column the user actually meant to drag down. Column stays
   pinned to whatever cell the drag started on until the cursor moves
   COL_LOCK_PX away from its starting X, which reads as a deliberate
   sideways drag (for picking an actual multi-column rectangle) rather
   than jitter. */
var COL_LOCK_PX = 18;
var dragStartC = null, dragStartX = 0;
function dragCol(hoverC, curX) {
  if (rowDragMode || dragStartC === null) return hoverC;
  return Math.abs(curX - dragStartX) < COL_LOCK_PX ? dragStartC : hoverC;
}

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
  var rn = tbody.querySelectorAll("td.row-sel");
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
  var seen = {}, cellCount = 0, numCount = 0, sum = 0, min = Infinity, max = -Infinity;
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
          cellCount++;
          var v = td.getAttribute("data-v");
          if (v !== null && v !== "") {
            var num = parseFloat(v);
            if (!isNaN(num)) { numCount++; sum += num; if (num < min) min = num; if (num > max) max = num; }
          }
        }
      }
      if (rowHasSel && tr.cells[0]) tr.cells[0].classList.add("row-sel");
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
  showBar(cellCount, numCount, sum, min, max);
}

function showBar(cellCount, numCount, sum, min, max) {
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "statusbar";
    document.body.appendChild(bar);
    bar.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    bar.addEventListener("click", function (e) { if (e.target.closest(".clear")) clear(); });
  }
  var avg = numCount ? sum / numCount : 0;
  var num = function (v) { return Math.abs(v) < 0.5 ? "0" : inr(v); };
  bar.innerHTML =
    '<div class="stat"><div class="sk">Count</div><div class="sv tab-num">' + cellCount.toLocaleString("en-IN") + "</div></div>" +
    '<div class="stat"><div class="sk">Sum</div><div class="sv accent tab-num">' + (numCount ? "₹" + num(sum) : "–") + "</div></div>" +
    '<div class="stat"><div class="sk">Average</div><div class="sv tab-num">' + (numCount ? "₹" + num(avg) : "–") + "</div></div>" +
    '<div class="stat"><div class="sk">Min / Max</div><div class="sv tab-num" style="font-size:11.5px">' +
      (numCount ? "₹" + num(min) + " / ₹" + num(max) : "–") + "</div></div>" +
    '<button class="clear" title="Clear selection (Esc)">×</button>';
}

function posOf(td) {
  var tr = td.parentElement;
  if (!tr || tr.parentElement !== tbody) return null;
  return { r: tr.sectionRowIndex, c: td.cellIndex };
}
/* Any td with content participates in range selection now — not just
   numeric ones. data-v (present only on numeric cells) still separately
   drives the Sum/Average/Min-Max stats. */
function selectable(td) { return td && td.tagName === "TD" && td.hasAttribute("data-sel"); }
function isRowHandle(td) { return td && (td.classList.contains("rownum") || td.classList.contains("sticky-l")); }

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

/* Middle-mouse-button drag pans the grid — a different gesture from
   left-click, so it never competes with range selection above. */
var panning = false, panX = 0, panY = 0, panL = 0, panT = 0;
function beginPan(e) {
  panning = true;
  panX = e.clientX; panY = e.clientY;
  panL = wrap.scrollLeft; panT = wrap.scrollTop;
  wrap.classList.add("panning");
}
function endPan() {
  if (!panning) return;
  panning = false;
  if (wrap) wrap.classList.remove("panning");
}

/* While a range/row drag is held near the top or bottom edge of the grid,
   auto-scroll it (like Excel) so selection can extend past what's on
   screen — infinite-scroll's own listeners react to scrollTop changes no
   matter how they happen, so more rows stream in as this scrolls. Re-reads
   whatever's under the (clamped) cursor every frame so the selection keeps
   growing even while the mouse itself sits still. */
function autoScrollStep() {
  if (!autoScrollActive || !wrap) return;
  wrap.scrollTop += autoScrollDy;
  var rect = wrap.getBoundingClientRect();
  var y = Math.max(rect.top + 1, Math.min(autoScrollY, rect.bottom - 1));
  var el = document.elementFromPoint(autoScrollX, y);
  var td = el && el.closest ? el.closest("td") : null;
  if (td) {
    var p = posOf(td);
    if (p) {
      if (rowDragMode) extendActive(p.r, lastSelCol);
      else extendActive(p.r, dragCol(p.c, autoScrollX));
      paintAll();
    }
  }
  autoScrollRAF = requestAnimationFrame(autoScrollStep);
}
/* setInterval as a second, independent driver alongside the rAF loop
   above — rAF can stall out mid-drag in some browsers/conditions (heavy
   synchronous work on the main thread from paintAll, or frame throttling
   while a native drag is held), and when it does, the auto-scroll would
   otherwise just quietly stop. The interval doesn't depend on frame
   compositing at all, so it keeps things moving even then. */
function autoScrollTick() { autoScrollStep(); }
function startAutoScroll() {
  if (autoScrollActive) return;
  autoScrollActive = true;
  autoScrollStep();
  autoScrollTimer = setInterval(autoScrollTick, 60);
}
function stopAutoScroll() {
  autoScrollActive = false;
  if (autoScrollRAF) cancelAnimationFrame(autoScrollRAF);
  autoScrollRAF = null;
  if (autoScrollTimer) clearInterval(autoScrollTimer);
  autoScrollTimer = null;
}
function maybeAutoScroll(clientX, clientY) {
  if (!wrap) return;
  var rect = wrap.getBoundingClientRect();
  var EDGE = 48, SPEED = 18;
  var dy = 0;
  if (clientY < rect.top + EDGE) dy = -SPEED * ((rect.top + EDGE - clientY) / EDGE);
  else if (clientY > rect.bottom - EDGE) dy = SPEED * ((clientY - (rect.bottom - EDGE)) / EDGE);
  autoScrollX = clientX; autoScrollY = clientY;
  if (dy) {
    autoScrollDy = dy;
    startAutoScroll();
  } else {
    stopAutoScroll();
  }
}

function attach(gridWrap) {
  wrap = gridWrap;
  tbody = wrap.querySelector("tbody");
  ranges = []; anchor = null; pending = null; hideBar();
  firstSelCol = lastSelCol = null; rowDragMode = false; stopAutoScroll();
  dragStartC = null; dragStartX = 0;
  if (!tbody) return;

  var firstRow = tbody.rows[0];
  if (firstRow) {
    for (var i = 0; i < firstRow.cells.length; i++) {
      if (firstRow.cells[i].hasAttribute("data-sel")) {
        if (firstSelCol === null) firstSelCol = i;
        lastSelCol = i;
      }
    }
  }

  wrap.addEventListener("mousedown", function (e) {
    if (e.button === 1) { e.preventDefault(); beginPan(e); return; }
    /* The column header has its own click handler (below) with its own
       Ctrl/Shift handling — bail out here without clearing, or a Ctrl/Shift
       click on it would wipe the very selection those modifiers are meant
       to add to, before its own handler ever runs. */
    if (e.target.closest && e.target.closest("thead")) return;
    var td = e.target.closest ? e.target.closest("td") : null;
    /* Row handle (row-number or sticky title column): mousedown starts a
       whole-row selection AND arms drag mode, so dragging up/down from here
       multi-selects rows (for a running sum) instead of only picking one
       row per click. */
    if (isRowHandle(td) && firstSelCol !== null) {
      var rp = posOf(td);
      if (!rp) return;
      e.preventDefault();
      if (e.shiftKey) extendActive(rp.r, lastSelCol);
      else if (e.ctrlKey || e.metaKey) toggleRange(rp.r, rp.r, firstSelCol, lastSelCol);
      else startRange(rp.r, rp.r, firstSelCol, lastSelCol);
      paintAll();
      rowDragMode = true;
      beginDrag();
      return;
    }
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
      dragStartC = p.c; dragStartX = e.clientX;
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
    dragStartC = p.c; dragStartX = e.clientX;
    startRange(p.r, p.r, p.c, p.c);
    paintAll();
    if (td.isContentEditable) {
      pending = p;   // might still grow into a drag — don't preventDefault, or native focus/caret breaks
    } else {
      e.preventDefault();
      beginDrag();
    }
  });
  wrap.addEventListener("auxclick", function (e) { if (e.button === 1) e.preventDefault(); });

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

}

/* Deliberately on document, not wrap: once a drag is armed, the pointer
   routinely strays off the grid element itself — over the fixed status bar
   sitting right at the bottom of the screen (exactly where a downward drag
   heads), past the table's edges, over the header row, whatever. A
   listener scoped to wrap only fires while the pointer is directly over
   it, so the selection would appear to freeze mid-drag the moment the
   cursor left that box. elementFromPoint sidesteps that by finding
   whatever's under the cursor regardless of which element the event
   actually landed on. */
document.addEventListener("mousemove", function (e) {
  if (!wrap) return;
  if (panning) {
    wrap.scrollLeft = panL - (e.clientX - panX);
    wrap.scrollTop = panT - (e.clientY - panY);
    return;
  }
  if (pending && downXY) {
    var moved = Math.abs(e.clientX - downXY.x) + Math.abs(e.clientY - downXY.y);
    if (moved > 5) { beginDrag(); }
    else return;
  }
  if (!dragging) return;
  maybeAutoScroll(e.clientX, e.clientY);
  var el = document.elementFromPoint(e.clientX, e.clientY);
  var td = el && el.closest ? el.closest("td") : null;
  if (!td) return;
  var p = posOf(td);
  if (!p) return;
  if (rowDragMode) extendActive(p.r, lastSelCol);
  else extendActive(p.r, dragCol(p.c, e.clientX));
  paintAll();
});
document.addEventListener("mouseup", function (e) {
  pending = null; downXY = null;
  if (e.button === 1) endPan();
  if (dragging) { dragging = false; rowDragMode = false; dragStartC = null; if (wrap) wrap.classList.remove("selecting"); }
  stopAutoScroll();
});
document.addEventListener("keydown", function (e) { if (e.key === "Escape") clear(); });

export var SEL = { attach: attach, clear: clear };
