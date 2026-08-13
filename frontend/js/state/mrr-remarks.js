/* Free-text note per client on the MRR Movement tab — why a client's MRR
   moved (churn reason, name change, post-billing adjustment, etc). Mirrors
   the "Accruals check / Queries / Jun remarks" columns on the MRR
   reconciliation sheet this tab was built from; kept as one note per
   client rather than per client+month-pair, since in practice a remark
   explains the client's situation generally, not one specific comparison. */
"use strict";

import { store } from "../core/store.js";

var REMARKS = store("ra_mrr_remarks_v1");   // client name -> text

export function getRemark(client) { return REMARKS.get(client) || ""; }
export function setRemark(client, text) {
  if (!client) return;
  var t = (text || "").trim();
  if (t) REMARKS.set(client, t); else REMARKS.del(client);
}
