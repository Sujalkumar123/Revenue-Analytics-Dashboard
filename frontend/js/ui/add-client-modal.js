"use strict";

import { esc } from "../core/format.js";
import { dnumFromISO } from "../core/dates.js";
import { S, curFY, state } from "../state/app-state.js";
import { ADDS, dictAdd } from "../state/stores.js";
import { HISTORY } from "../state/history.js";
import { render } from "../core/bus.js";
import { toast } from "./toast.js";

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

export function openAddModal() {
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
