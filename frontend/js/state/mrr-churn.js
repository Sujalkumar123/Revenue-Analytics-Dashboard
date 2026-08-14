/* Client -> Churn flag, mirroring the "Churn" tag the MRR reconciliation
   sheet's Queries/Accruals-check columns carry for a fully-dead account.
   mrr-accruals-seed.json (S.mrrSeed) seeds it from that sheet; toggling
   the checkbox on the dashboard always overrides the seed, tri-state style
   (no explicit entry = defer to seed) same as Tier and Accruals check. */
"use strict";

import { store } from "../core/store.js";
import { S } from "./app-state.js";

var CHURN = store("ra_mrr_churn_v1");   // client name -> "1"/"0" (explicit override)

function seedChurn(client) {
  var s = S.mrrSeed && S.mrrSeed[client];
  return !!(s && s.churn);
}

export function getChurn(client) {
  var explicit = CHURN.get(client);
  return explicit !== undefined ? explicit === "1" : seedChurn(client);
}
export function setChurn(client, on) {
  if (!client) return;
  CHURN.set(client, on ? "1" : "0");
}
