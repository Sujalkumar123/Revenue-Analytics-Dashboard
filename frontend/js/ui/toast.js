"use strict";

export function toast(msg) {
  var t = document.createElement("div");
  t.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:90;" +
    "background:var(--surface);border:1px solid var(--border-strong);color:var(--ink);" +
    "padding:11px 16px;border-radius:11px;box-shadow:var(--shadow-lg);font-size:12.5px;max-width:min(560px,92vw)";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function () { t.style.transition = "opacity .3s"; t.style.opacity = "0"; }, 4200);
  setTimeout(function () { t.remove(); }, 4600);
}
