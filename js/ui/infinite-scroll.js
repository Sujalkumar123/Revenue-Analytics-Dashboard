/* Streams big tables in 150-row chunks instead of rendering everything at
   once. IntersectionObserver is the primary trigger; the scroll listener
   uses cached dimensions rather than reading scrollHeight on every event,
   since that read forces a synchronous layout that gets very expensive on
   large tables. */
"use strict";

export function loadMoreHTML(total) {
  return '<div class="load-more" id="loadMore">' +
    '<span class="bar"><i style="width:0%"></i></span>' +
    '<span id="loadTxt">0 of ' + total.toLocaleString("en-IN") + " rows</span></div>";
}

export function attachInfinite(wrap, tbody, total, chunkHTML) {
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
