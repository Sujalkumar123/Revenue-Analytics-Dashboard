/* Client -> business tier (SMB / Gold / Platinum / Trophy Win), the
   segmentation used in the MRR Movement tab. Doesn't exist anywhere in the
   Zoho-sourced ledger — it's a manual classification the ops team keeps
   (mirrors the "Category" column on the MRR reconciliation sheet this tab
   was built from). No entry = unclassified, shown as "–", not guessed. */
"use strict";

import { store } from "../core/store.js";

export var TIERS = ["SMB", "Gold", "Platinum", "Trophy Win"];

var TIER = store("ra_client_tier_v1");   // client name -> tier

export function getTier(client) { return TIER.get(client) || ""; }
export function setTier(client, tier) {
  if (!client) return;
  if (tier) TIER.set(client, tier); else TIER.del(client);
}
export function tierCount() {
  var n = 0, all = TIER.all();
  for (var k in all) n++;
  return n;
}
