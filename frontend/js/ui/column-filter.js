/* Excel-style per-column filter: click the funnel on a header cell to get
   Sort A→Z / Z→A, a search box, and a checklist of that column's unique
   values (deduplicated) with "(Select All)". Filters across columns AND
   together; a column with nothing unchecked has no filter applied. */
"use strict";

var openPopover = null;

function closePopover() {
  if (openPopover) { openPopover.remove(); openPopover = null; }
}
document.addEventListener("mousedown", function (e) {
  if (openPopover && !openPopover.contains(e.target) && !e.target.closest(".colf-btn")) closePopover();
});
document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePopover(); });

/* uniqueValuesFn(colKey) -> string[] (already deduped, unsorted is fine).
   onApply(colKey, selectedSet|null) -> null means "no filter" (all values). */
export function attachColumnFilters(theadRow, state, onSort, onFilter, uniqueValuesFn) {
  theadRow.querySelectorAll("th[data-colkey]").forEach(function (th) {
    var key = th.getAttribute("data-colkey");
    var btn = th.querySelector(".colf-btn");
    if (!btn) return;
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (openPopover && openPopover.dataset.col === key) { closePopover(); return; }
      closePopover();
      openFilterPopover(th, key, state, onSort, onFilter, uniqueValuesFn);
    });
  });
}

function openFilterPopover(th, key, state, onSort, onFilter, uniqueValuesFn) {
  var values = uniqueValuesFn(key);
  var activeSet = state.filters[key]; // Set|undefined (undefined = all pass)

  var pop = document.createElement("div");
  pop.className = "colf-pop";
  pop.dataset.col = key;
  pop.innerHTML =
    '<button class="colf-item" data-act="asc">↑ Sort A to Z</button>' +
    '<button class="colf-item" data-act="desc">↓ Sort Z to A</button>' +
    '<div class="colf-div"></div>' +
    '<input type="search" class="colf-search" placeholder="Search values…" />' +
    '<label class="colf-item colf-all"><input type="checkbox" id="colfAll" checked /> (Select All)</label>' +
    '<div class="colf-list" id="colfList"></div>' +
    '<div class="colf-ft"><button class="icon-btn" data-act="cancel">Cancel</button>' +
    '<button class="btn-primary" data-act="ok">OK</button></div>';
  document.body.appendChild(pop);
  openPopover = pop;

  var r = th.getBoundingClientRect();
  pop.style.left = Math.min(r.left, window.innerWidth - 260) + "px";
  pop.style.top = (r.bottom + 4) + "px";

  var checked = activeSet ? new Set(activeSet) : new Set(values);
  var listEl = pop.querySelector("#colfList");
  var allBox = pop.querySelector("#colfAll");

  function paintList(filterText) {
    var ft = (filterText || "").toLowerCase();
    var shown = values.filter(function (v) { return v.toLowerCase().indexOf(ft) !== -1; });
    listEl.innerHTML = shown.map(function (v) {
      return '<label class="colf-item"><input type="checkbox" data-val="' + v.replace(/"/g, "&quot;") +
        '" ' + (checked.has(v) ? "checked" : "") + " /> " +
        (v === "" ? '<i style="color:var(--ink-3)">(blank)</i>' : v.replace(/&/g, "&amp;").replace(/</g, "&lt;")) +
        "</label>";
    }).join("") || '<div style="padding:8px;color:var(--ink-3);font-size:12px">No matches</div>';
    allBox.checked = shown.every(function (v) { return checked.has(v); }) && shown.length > 0;
    listEl.querySelectorAll("input[type=checkbox]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        var v = cb.getAttribute("data-val");
        if (cb.checked) checked.add(v); else checked.delete(v);
        allBox.checked = shown.every(function (x) { return checked.has(x); });
      });
    });
  }
  paintList("");

  /* Matches Excel: typing a search term doesn't just narrow the visible
     list, it also selects exactly the matching values (so Search + OK
     filters straight to what you typed, without an extra "check all"
     step) — clearing the search box back to empty restores every value. */
  pop.querySelector(".colf-search").addEventListener("input", function (e) {
    var ft = e.target.value.toLowerCase();
    var shown = values.filter(function (v) { return v.toLowerCase().indexOf(ft) !== -1; });
    checked = ft ? new Set(shown) : new Set(values);
    paintList(e.target.value);
  });
  allBox.addEventListener("change", function () {
    var ft = pop.querySelector(".colf-search").value.toLowerCase();
    var shown = values.filter(function (v) { return v.toLowerCase().indexOf(ft) !== -1; });
    if (allBox.checked) shown.forEach(function (v) { checked.add(v); });
    else shown.forEach(function (v) { checked.delete(v); });
    paintList(pop.querySelector(".colf-search").value);
  });

  pop.addEventListener("click", function (e) {
    var act = e.target.closest("[data-act]") && e.target.closest("[data-act]").getAttribute("data-act");
    if (!act) return;
    if (act === "cancel") { closePopover(); return; }
    if (act === "asc" || act === "desc") { onSort(key, act); closePopover(); return; }
    if (act === "ok") {
      onFilter(key, checked.size >= values.length ? null : checked);
      closePopover();
    }
  });
}
