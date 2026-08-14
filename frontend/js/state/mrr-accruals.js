/* Client -> "Accruals check" note, the free-text flag column the MRR
   reconciliation sheet keeps next to Category (things like "Post billing",
   "Name change", "Churn"). mrr-accruals-seed.json (loaded as S.mrrSeed)
   carries the sheet's own values as of the last import; an explicit edit
   here always overrides it, same pattern as client-tier.js's Category
   fallback. */
"use strict";

import { store } from "../core/store.js";
import { S } from "./app-state.js";

var ACCRUALS = store("ra_mrr_accruals_v1");   // client name -> text (explicit override)

function seedAccruals(client) {
  var s = S.mrrSeed && S.mrrSeed[client];
  return (s && s.accruals) || "";
}

export function getAccruals(client) {
  var explicit = ACCRUALS.get(client);
  return explicit !== undefined ? explicit : seedAccruals(client);
}
export function setAccruals(client, text) {
  if (!client) return;
  var t = (text || "").trim();
  ACCRUALS.set(client, t);
}
