/* Day-number date handling. Every date in the dataset is stored as an
   integer count of days since EPOCH, which is what makes the recognition
   rule's overlap arithmetic (see data/revenue.js) plain integer math. */
"use strict";

export const EPOCH = Date.UTC(2022, 0, 1);
export const DAY = 86400000;
export const MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function fromDnum(n) { return new Date(EPOCH + n * DAY); }

export function fmtDate(n) {
  if (n === null || n === undefined) return "";
  var d = fromDnum(n);
  return String(d.getUTCDate()).padStart(2, "0") + "-" + MN[d.getUTCMonth()] + "-" + String(d.getUTCFullYear()).slice(2);
}

export function dnumFromISO(s) {
  if (!s) return null;
  var p = String(s).split("-");
  if (p.length !== 3) return null;
  var t = Date.UTC(+p[0], +p[1] - 1, +p[2]);
  if (isNaN(t)) return null;
  return Math.round((t - EPOCH) / DAY);
}

export function parseUserDate(v) {
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

export const FYS = [
  { id: "2022-23", label: "FY 2022–23", y: 2022 },
  { id: "2023-24", label: "FY 2023–24", y: 2023 },
  { id: "2024-25", label: "FY 2024–25", y: 2024 },
  { id: "2025-26", label: "FY 2025–26", y: 2025 },
  { id: "2026-27", label: "FY 2026–27 (part)", y: 2026 }
];
export const DATA_END = Date.UTC(2026, 5, 30);

export function fyMonths(fy) {
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
