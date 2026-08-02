/* Display formatting + loose numeric parsing for typed-in cell values. */
"use strict";

export function inr(v) {
  if (!v || Math.abs(v) < 0.5) return "–";
  var neg = v < 0, n = Math.round(Math.abs(v)).toString();
  var last3 = n.slice(-3), rest = n.slice(0, -3);
  var s = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return (neg ? "-" : "") + s;
}

export function inrShort(v) {
  var neg = v < 0; v = Math.abs(v); var s;
  if (v >= 1e7) s = (v / 1e7).toFixed(2) + " Cr";
  else if (v >= 1e5) s = (v / 1e5).toFixed(2) + " L";
  else if (v >= 1e3) s = (v / 1e3).toFixed(1) + " K";
  else s = Math.round(v).toString();
  return (neg ? "-₹" : "₹") + s;
}

export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function parseNum(v) {
  var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? null : n;
}
