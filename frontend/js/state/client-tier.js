/* Client -> business tier (SMB / Gold / Platinum / Trophy Win), the
   segmentation used in the MRR Movement tab. Doesn't exist anywhere in the
   Zoho-sourced ledger as a first-class field, but clientdims.json (loaded
   as S.dims, extracted from the same Category column the MRR
   reconciliation sheet uses) already carries it for most clients — that's
   the default; an explicit pick here (stored locally) always overrides it,
   and a client with neither is "–", not guessed. */
"use strict";

import { store } from "../core/store.js";
import { S } from "./app-state.js";

export var TIERS = ["SMB", "Gold", "Platinum", "Trophy Win"];

var TIER = store("ra_client_tier_v1");   // client name -> tier (explicit override)

function seedTier(client) {
  var d = S.dims && S.dims[client];
  var c = d && d.category ? d.category.trim() : "";
  return c === "Trophy win" ? "Trophy Win" : (TIERS.indexOf(c) !== -1 ? c : "");
}

export function getTier(client) {
  var explicit = TIER.get(client);
  return explicit !== undefined ? explicit : seedTier(client);
}
export function setTier(client, tier) {
  if (!client) return;
  if (tier) TIER.set(client, tier); else TIER.del(client);
}
export function tierCount() {
  var n = 0, all = TIER.all();
  for (var k in all) n++;
  return n;
}
