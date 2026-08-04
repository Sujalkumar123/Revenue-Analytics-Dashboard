/* Item name -> Product lookup, mirroring backend/zoho/derive_consol.py's
   ITEM_PRODUCT_MAP (same 70 entries, majority-vote resolved from ~2,500
   real ground-truth rows the repo owner supplied directly from actual
   classified data). A blank product is a real, verified answer — several
   item types (mostly one-time "-O" setup/support charges) genuinely carry
   no product in the ground truth, not a missing value.

   Admin overrides/additions (for items not in the table — e.g. a brand
   new product line) are layered on top and persisted to localStorage,
   independent of this built-in table so re-deploying the app never loses
   an admin's manual mappings. This mirrors the item-name-keyed table the
   backend pipeline (not yet wired live) will eventually consult too —
   syncing the two is future work once that pipeline is live. */
"use strict";

import { store } from "../core/store.js";

export var DEFAULT_ITEM_PRODUCT_MAP = {
  "API / Integration Charges-M": "Other modules", "API / Integration Charges-O": "",
  "Analytics Studio-M": "Other modules", "Analytics Studio-O": "",
  "Asset Management Module-M": "Other modules", "Attendance Module-M": "Other modules",
  "Beat-o-Meter-M": "Other modules", "Change Request Charges-M": "", "Change Request Charges-O": "",
  "CoPilot-M": "Other modules", "DMS - Bundle Package - Subscription Charges-M": "DMS subscription",
  "DMS - Hypercare Charges-M": "Other modules", "DMS - Hypercare Charges-O": "Other modules",
  "DMS - Other Charges-M": "Other modules", "DMS - Other Charges-O": "Other modules",
  "DMS - ProRata Adjustments-M": "DMS subscription", "DMS - Project Management Cost-O": "",
  "DMS - Setup Charges-O": "", "DMS - Subscription Charges-M": "DMS subscription",
  "DMS - Support Charges-M": "Other modules", "DMS - Training Charges-O": "Other modules",
  "DMS ARS-M": "Other modules", "Delivery App - M": "Other modules",
  "Digital ASM Subscription cost-M": "Other modules", "FA ONE - Subscription Charges-M": "Other modules",
  "FA ONE - Support Charges-M": "Other modules", "FLO - Development Charges-M": "",
  "FLO - Development Charges-O": "", "FLO - Hypercare Charges-O": "Other modules",
  "FLO - Other Charges-M": "Other modules", "FLO - Setup Charges-O": "",
  "FLO - Subscription Charges-M": "Flo subscription", "FLO - Support Charges-M": "Other modules",
  "Flo Subscription Charge(s)-M": "Flo subscription", "Image Recognition-M": "Other modules",
  "Image Recognition-O": "", "Micro Market-O": "Other modules", "Power BI-M": "Other modules",
  "Power BI-O": "Other modules", "Product Recommendation Module-M": "Other modules",
  "Product Recommendation Module-O": "Other modules", "Quickviz & Flexible Reporting-M": "Other modules",
  "Reimbursement Charges-O": "", "Rental Income": "Other modules", "Retailer App - O": "Other modules",
  "Route Optimisation-M": "Other modules", "Route Optimisation-O": "Other modules",
  "SFA + DMS - Bundle Package - Subscription Charges-M": "GT subscription",
  "SFA GT - Analytics Subscription Charges-M": "Other modules",
  "SFA GT - Bundle Package - Subscription Charges-M": "GT subscription",
  "SFA GT - Development Charges-O": "Other modules", "SFA GT - Gamification Charges-M": "Other modules",
  "SFA GT - Hypercare Charges-O": "Other modules", "SFA GT - Other Charges-M": "Other modules",
  "SFA GT - Other Charges-O": "", "SFA GT - Outlet Data Sanitization Charges-M": "Other modules",
  "SFA GT - Pilot Cost-O": "", "SFA GT - ProRata Adjustments-M": "GT subscription",
  "SFA GT - Project Management Cost-M": "Other modules", "SFA GT - Project Management Cost-O": "",
  "SFA GT - Setup Charges": "", "SFA GT - Setup Charges-O": "",
  "SFA GT - Subscription Charges": "GT subscription", "SFA GT - Subscription Charges-M": "GT subscription",
  "SFA GT - Support Charges-M": "Other modules", "SFA GT - Training Charges-O": "",
  "SFA MT - Other Charges-M": "MT subscription", "SFA MT - ProRata Adjustments-M": "MT subscription",
  "SFA MT - Subscription Charges-M": "MT subscription", "TA / DA Module-M": "Other modules"
};

var OVERRIDES = store("ra_item_product_overrides_v1");

/* null = genuinely unmapped (neither the built-in table nor an admin
   override has an answer) — distinct from "" (mapped, but to "no product",
   which the ground truth confirms is a real answer for some item types). */
export function getProduct(itemName) {
  var key = (itemName || "").trim();
  var override = OVERRIDES.get(key);
  if (override !== undefined) return override;
  if (Object.prototype.hasOwnProperty.call(DEFAULT_ITEM_PRODUCT_MAP, key)) return DEFAULT_ITEM_PRODUCT_MAP[key];
  return null;
}
export function isMapped(itemName) { return getProduct(itemName) !== null; }
export function setProduct(itemName, product) {
  var key = (itemName || "").trim();
  if (!key) return;
  OVERRIDES.set(key, product);
}
export function clearOverride(itemName) { OVERRIDES.del((itemName || "").trim()); }
export function overrideCount() {
  var n = 0, all = OVERRIDES.all();
  for (var k in all) n++;
  return n;
}
