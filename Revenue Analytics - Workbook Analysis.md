# Revenue Analytics Workbook — Full Analysis

**Scope of this document:** a complete, verified breakdown of `Revenue analytics 25-26 (5).xlsx` (25 sheets), `Invoice - ....xlsx`, and `Credit_Note - ....xlsx`. Every formula quoted below was read directly from the workbook with a script (not inferred/guessed) and cross-checked against real data rows. This is the **mandatory first step** before any backend/frontend work, per your instructions — no code has been written yet.

---

## 1. Executive Summary

The workbook is a **manually-maintained revenue recognition ledger** built on three layers:

1. **Raw imports** — `Invoice` and `CreditNotes` sheets are unmodified Zoho Books exports (one row per invoice/credit-note line item).
2. **Recognition engine** — `Consol Sheet working` and `Credit notes register` take every historical invoice/credit-note line item (accumulated since ~2022, ~26,000 and ~6,000 rows respectively) and use **day-weighted straight-line proration** to spread each line's amount across the months it covers, producing a cumulative "revenue recognized as of month-end X" matrix (163 and 132 columns respectively).
3. **Reporting layer** — ~18 sheets (`Recurr Revenue by client *`, `SFA GT`/`DMS`/`Flo`/`SFA MT`/`Other modules`, `One time`, `Recurr Users *`, `Billing MOM`, geography/category/product "slicer" views, `Walk`, `For PPT`) re-aggregate the recognition engine per client/product/month via `SUMIFS`, then take month-over-month deltas to produce MRR movements.

**The single most important finding:** credit notes are netted against revenue **only in one place** — the top-level `Recurr Revenue by client *` sheets (columns `CR:DS`, net = gross monthly delta − credit-note monthly delta). Every other report (the 5 product sheets, `One time`, `Billing MOM`) shows **gross revenue only, not net of credit notes**. A legacy credit-note-offset block inside `Consol Sheet working` itself (columns `O:AR`) is completely dead — 26,347 rows, all but one are blank, so it silently contributes zero. See §5 for full detail. This inconsistency needs a deliberate decision in the new system (recommend: net everywhere, always).

---

## 2. Source Files

### 2.1 `Invoice - 2026-07-10T161750.466 (1).xlsx` → sheet `Invoice`
Raw Zoho Books invoice-line export. 2,385 rows × 22 columns, Apr–Jun 2026 only (i.e. this file is one quarter's incremental upload, not the full history — the full history lives inside `Consol Sheet working`).

| Col | Header | Type | Notes |
|---|---|---|---|
| A | Invoice Date | date | |
| B | Invoice Number | text | Unique-ish; format `F2K/YYYY-YY/NNNN` |
| C | Invoice Status | text | `Closed` / `Open` |
| D | Customer Name | text | Free text, **not deduplicated** (see Utility sheet, §4.5) |
| E | Currency Code | text | `INR`, `USD`, others |
| F | Exchange Rate | number | 1 for INR |
| G | Item Name | text | e.g. `SFA GT - Subscription Charges-M`. Drives Product/Recurring classification downstream |
| H | Item Desc | text | Free text, e.g. `@INR 550/User * 12 Months`. Human-readable rate — **not machine-parsed anywhere** in the workbook (User Count and Period come from separate columns, not parsed from this text) |
| I | Quantity | int | |
| J | Item Price | number | |
| K | Item Total | number | Qty × Price |
| L | Taxable amount | **formula** | `=(F*I*J)-(F*R)` — (Qty × Price − Discount) × Exchange Rate |
| M | Item.CF.Usage Period (From) | date | Service period start — **the field the whole recognition engine keys off** |
| N | Item.CF.Usage Period (till) | date | Service period end |
| O | GSTIN | text | |
| P | PurchaseOrder | text | |
| Q | Sales Order Number | text | |
| R | Discount Amount | number | |
| S | Branch Name | text | Always "Head Office" in sample |
| T–V | CGST / SGST / IGST | text (numeric) | Tax breakdown |

All columns except L are **literal values from Zoho**, not formulas — this is a straight system export. **Source of truth**, should map 1:1 to an `invoices` / `invoice_lines` table.

### 2.2 `Credit_Note - 2026-07-10T162020.927.xlsx` → sheet `CreditNotes`
Same shape, Zoho credit-note export. 391 rows × 29 columns.

| Col | Header | Notes |
|---|---|---|
| A | Credit Note Date | |
| B | Credit Note Number | `F2K/YYYY/CN/NNNN` |
| C | Credit Note Status | |
| D | Customer Name | |
| E | Total | |
| F | e-Invoice Status | |
| G | **Associated Invoice Number** | FK back to `Invoice.Invoice Number` — this is how a credit note ties to the original sale |
| H | Associated Invoice Date | |
| I–J | Currency / Exchange Rate | |
| K | Item Name | |
| L | Item Desc | |
| M | Quantity | |
| N | Item Price | |
| O | Item Total | |
| P | Taxable Amount | **formula** `=(J*M*N)-(J*AB)` (same pattern as Invoice col L) |
| Q | Item.CF.Usage Period (From) | Service period being credited |
| R | Item.CF.Usage Period (till) | |
| S–AC | Tax/GST/branch/reference fields | literal |

Everything else literal. Also a raw Zoho export — should map to `credit_notes` / `credit_note_lines`, FK'd to `invoices` via Associated Invoice Number.

---

## 3. The Recognition Engine

### 3.1 `Consol Sheet working` — the core table (163 cols × 26,347 data rows, header row 7, data from row 8)

This is the **full historical accumulation** of every invoice line item since ~Apr 2022 (the 2,385-row `Invoice.xlsx` you gave me is just the latest quarter's slice that eventually gets appended here). Column groups:

**A–N: line-item detail (source of truth fields)**
| Col | Header | Source | Formula / Notes |
|---|---|---|---|
| A | Invoice No. | Invoice.B | literal |
| B | Client Name | Invoice.D | literal (raw, un-deduplicated) |
| C | **Name Clean** | derived | literal value in most rows, but the *pattern* used elsewhere is `=IFERROR(VLOOKUP(B,Utility!B:C,2,0),B)` — canonicalized client name. **This is the field every downstream SUMIFS groups by.** |
| D | Invoice date | Invoice.A | literal |
| E | End date | derived | literal (appears to be month-end of invoice date) |
| F | Item | Invoice.G | literal |
| G | **Product** | derived | literal, manually classified from Item. Only 5 distinct values in the whole 26k-row history: `GT subscription` (16,055), `Other modules` (3,353), `Flo subscription` (2,032), `DMS subscription` (1,400), `MT subscription` (1,315) |
| H | Item description | Invoice.H | literal |
| I | **Onetime/recurring** | derived | literal, manual classification. Only 2 values: `Recurring` (24,091), `One-time` (2,253) |
| J | **User count** | derived | literal — manually keyed per line (not parsed from Item Desc text) |
| K | Start Date | Invoice.M (Usage Period From) | literal |
| L | End Date | Invoice.N (Usage Period Till) | literal |
| M | **Period** | formula | `=IFERROR(L-K+1,0)` — inclusive day-count of the service period |
| N | **Amount** | Invoice.L (Taxable amount) | literal |

**O–AR (30 cols): "Credit notes FY23/24/25" — DEAD/VESTIGIAL.** Header claims a per-month credit-note offset per invoice line. In reality: **scanned all 26,347 rows, only ONE cell in the entire block is populated** (a literal `0` pasted manually into row 12602, clearly a one-off fix, not a formula). Every other cell is completely empty (not even a zero formula). Because the recognition formulas below reference these columns and Excel treats blank as 0, this block currently has **zero effect** — it's an abandoned earlier design.

**AS–CQ (57 cols): days-elapsed helper matrix.** One column per month-end from Apr-2022 to Jun-2026 (row 7 holds the month-end date). Formula (identical pattern, just the anchor column changes):
```
=IFERROR(MIN(MAX(AS$7-$K8,0),$M8),0)
```
= cumulative days of the line's service period that have elapsed as of that month-end, clamped to `[0, Period]`. (Columns before FY25 use `AS$7-$K8`, FY25+ columns use `BE$6-$K8+1` — same idea, off-by-one adjusted because the anchor row/format differs.)

**CR–EP (57 cols): "Revenue FY23/24/25" — cumulative recognized revenue.**
```
CR8 = IFERROR(($N8-O8)*AS8/$M8, 0)      ' = Amount * (days elapsed / total period days)
```
Since `O8` (dead credit-note column) is always 0, this simplifies to `Amount × (days-elapsed / Period)` — **straight-line day-prorated cumulative revenue recognized through that month-end.** This is gross of credit notes.

**EQ–FF (16 cols): incremental monthly deltas** for the most recent months only:
```
EQ8 = EA8 - DZ8   (this month's cumulative minus last month's cumulative = this month's revenue)
```

**Business rule (MRR/revenue recognition), in plain terms:**
> For each invoice line item with Amount `A`, service Start `S`, End `E` (Period `P = E-S+1` days): the revenue recognized in any month is `A × (days of [S,E] falling in that month) / P`. Cumulative-to-date is a running sum of this; the reporting layer takes the difference between consecutive month-end cumulatives to get "this month's revenue."

### 3.2 `Credit notes register` — parallel engine for credit notes (132 cols × ~6,033 data rows, header row 7, data from row 8)

Same shape as 3.1 but for credit notes, and it's the **authoritative, currently-used** side of credit-note netting (unlike the dead block in Consol Sheet).

| Col | Header | Formula | Notes |
|---|---|---|---|
| A | Credit note number | literal | |
| B | Client Name | literal | |
| C | Name Clean | `=IFERROR(VLOOKUP(B,Utility!B:C,2,0),B)` | Same canonicalization as Consol Sheet |
| D | Credit note date | literal | |
| E | End date | `=EOMONTH(D,0)` | |
| F | Item | literal | |
| G | Product | `=VLOOKUP(F,'Consol Sheet working'!F:G,2,0)` | **Reuses Consol Sheet's own Item→Product mapping** — Product taxonomy is defined once, in Consol Sheet Working, and referenced everywhere else |
| H | Item description | literal | |
| I | User count | literal | |
| J | Associated invoice number | literal | FK to the original invoice |
| K | Credit note date (dup) | literal | |
| L | Start Date | literal | period being credited |
| M | End Date | literal | |
| N | Period | `=IFERROR(M-L+1,0)` | |
| O | **One time/Recurring** | `=VLOOKUP(J,'Consol Sheet working'!A:I,9,0)` | **Classification is inherited from the original invoice line**, not re-entered |
| P | Amount | literal | credit amount (positive number, meaning "amount to reduce") |
| Q–BO | days-elapsed helper | `=$AL$7-L+1` (start) then `=$AM$7-$AL$7` (successive month-lengths) | **Unlike Consol Sheet's uniform MIN/MAX formula, this is filled in manually only for the months the credit note actually affects** — sparse/fragile. Most cells in this block are blank for any given row. |
| CD–EB | cumulative credit recognized | `=IFERROR($P/$N*Q, 0)` (per month) | Day-prorated cumulative credit-note amount, mirroring 3.1's Revenue block |

### 3.3 User-count engine (`Consol Sheet working -Users`, `Credit notes register- Users`)

Structurally different from the revenue engine: instead of day-prorated *amounts*, each month column is a **Y/N "was this line active" flag** that, if Y, surfaces the line's User Count:
```
N4 = IF( (EOMONTH($J4,0)=N$7) OR (EOMONTH($K4,0)=N$7) OR (N$7 within (J4,K4]) , $I4, "")
```
(`J`/`K` = Start/End Date, `I` = User Count, `N$7` = month-end being evaluated). This produces a per-line-item, per-month "active user count" matrix that downstream sheets `SUMIFS` by client to get total concurrent users. `Credit notes register- Users` mirrors this for credited lines. **Business rule:** unlike revenue, users are not prorated by days — a line contributes its full user count to every month it overlaps at all.

---

## 4. Reporting Layer (all derived, all via `SUMIFS` against §3)

### 4.1 `Recurr Revenue by client 24-25` / `23-24` / `22-23` (per-client, all-products)
Structurally identical across the three fiscal-year sheets (only the referenced column range in Consol Sheet Working differs, since that sheet accumulates history). Column blocks:

| Block | Cols (24-25 sheet) | Formula pattern | Meaning |
|---|---|---|---|
| Dimensions | B–F | `D = VLOOKUP(B, [EXTERNAL FILE] 'MRR June vs May'!B:D, 3, 0)` | **B is the raw/typed client name (not FK'd)**. **D (Client category) points to an external workbook not provided to us** — broken/unavailable link (see §5). |
| Gross cumulative | G–AI | `=SUMIFS('Consol Sheet working'!<RevCol>:<RevCol>, ...$C:$C, B, ...$I:$I, "Recurring")` | monthly cumulative recognized revenue, this client, all products |
| Gross monthly delta | AK–BL | `=H-G` (etc.) | gross MRR movement that month |
| Credit-note cumulative | BN–CP | `=SUMIFS('Credit notes register'!<col>, ...$C:$C, B, ...$O:$O, "Recurring")` | cumulative credit-note reduction |
| **Net monthly revenue** | CR–DS | `=AK6-BO6` (gross-delta − credit-note figure, column-offset aligned) | **This is the only place in the whole workbook where net (revenue − credit notes) is actually computed.** |

### 4.2 Product sheets: `SFA GT`, `DMS`, `Flo`, `SFA MT`, `Other modules`
All five are byte-for-byte identical in structure — only the Product filter literal changes:
```
G5 = SUMIFS('Consol Sheet working'!DZ:DZ,
             'Consol Sheet working'!$C:$C, <ThisSheet>!$B5,
             'Consol Sheet working'!$I:$I, "Recurring",
             'Consol Sheet working'!$G:$G, "GT subscription")   ' or "DMS subscription" / "Flo subscription" / "MT subscription" / "Other modules"
```
Cumulative block, then a delta block (`Y = H-G` etc.) for monthly movement. **No credit-note netting anywhere in these 5 sheets — gross only.** Dimension columns: Product (redundant/static — always "SFA" in sampled rows, looks vestigial), Client category, Region, Geography (all literal, manually maintained).

### 4.3 `One time` (OTC revenue)
Same cumulative+delta pattern, filtered `$I:$I = "One-time"`, no product filter (all one-time charges pooled per client). **Also gross only, no credit-note netting.**

### 4.4 `Recurr Users 24-25` / `23-24`
Three blocks per client: gross users (`SUMIFS` from `Consol Sheet working -Users`), credit-note user reduction (`SUMIFS` from `Credit notes register- Users`), and **net users = gross − credit-note** (`AG5 = E5-S5`). Unlike the product-revenue sheets, this sheet *does* net credit notes. One data-quality note: cell `AQ5` in the sample was a hardcoded literal `4` instead of the expected formula — a manual override that will silently drift from the source data.

### 4.5 `Utility` (lookup table, B2:C105)
Pure manual data: raw client-name variant (col B) → canonical clean name (col C), e.g. `WIPRO ENTERPRISES PRIVATE LTD - Mumbai - Yardley` → `WIPRO ENTERPRISES PRIVATE LTD`. Every `VLOOKUP(..., Utility!B:C, 2, 0)` in the workbook depends on this table being kept current by a human. **This must become a proper `clients` master table with alias resolution in the new system**, not a flat lookup sheet.

### 4.6 `Billing MOM`
Month-on-month **billing** (not revenue-recognition) view: `SUMIFS('Consol Sheet working'!$N:$N, ...$C:$C=client, ...$E:$E=invoice-month, ...$I:$I="Recurring")` — sums invoiced amount by the month the invoice was *raised* (col E, not the day-prorated recognition columns). This is a cash/billing cadence view, distinct from revenue recognition. One `Name` cell uses an Excel **array formula** (not decoded in detail — low business-logic risk, likely a `TEXTJOIN`/dedup list).

### 4.7 `Walk` / `For PPT` — **deep-dive update**
`Walk` has two parts:
- **Rows 4–7 (summary):** `MRR from invoice rationalization = Total − Post-paid − Billing pending` (row 4), where `Post-paid`/`Billing pending` (rows 5–6) are `SUMIFS(B11:B162, $K$11:$K$162, <label>)` against the per-client detail table below. **Row 7 ("Total") is `=#REF!` — a broken formula (a referenced row/column was deleted at some point).** This summary block is currently non-functional in the live workbook.
- **Rows 11–162 (per-client detail):** one row per client. Revenue columns pull net figures straight from `'Recurr Revenue by client 24-25'!CZ.../DA...` (i.e. reuses §4.1's net-revenue output, not a new calculation). Column K ("PP/BP") = `VLOOKUP(client, 'Recurr Revenue by client 24-25'!B:D, 4, 0)` — a **Post-paid vs. Billing-pending status tag per client**. This VLOOKUP errors for some rows (index 4 against a 3-column B:D range), and in those rows someone manually typed the literal text `"Billing pending"` over the formula — another silent manual override. Column L ("Category") re-pulls the same broken-external-link Client Category as §4.1.
- `For PPT` is purely `='Walk'!cell / 10^5` (rupees → lakhs) for slide export — no logic of its own.
- **Verdict: no new revenue-calculation logic here** — it's a client-tagging (Post-paid/Billing-pending status, currently partly manual/partly broken) + a broken summary row. The "Post-paid / Billing pending" status is a real business attribute worth carrying into the new system as a per-client editable field, but the bridge arithmetic itself doesn't need to be replicated exactly since it's currently broken in the source.

### 4.8 Geography/Category/Product "slicer" views — **deep-dive update**
Each sheet is a 2-level nested breakdown, not a single filter as first assessed:
- `Geography view- Domestic-1`: selector `B1` = one Region (`East India/West India/North India/Central India/South India/Unassigned`); rows are grouped in blocks of 7 — an outer **Client Category** label (`Gold/Platinum/Silver/Million dollar/SMB/Unassigned`) followed by 6 inner **Product-mix** rows (`DMS/Flo/SFA/SFA+DMS/SFA+Flo/Unassigned`). So this view cross-cuts Region × Category × Product-mix.
- `Geography view- International-2`: same shape, but the Region enum is entirely different: `East Africa/GCC/Europe/Sub-Continent/SEA/West Africa/Unassigned`. **Domestic and International are two separate, non-overlapping Region enumerations** selected by which sheet you're on, not one shared list.
- `Category- Domestic-3` / `Product view-Domestic-5` are the same data cross-cut with a different selector dimension (Category-selector × Region-rows, and Product-selector × Category-rows respectively) — same underlying `Recurr Revenue by client` SUMIFS pattern, just re-arranged axes.
- **New finding — a second broken external reference.** `Geography view- Domestic-1!B11` = `='[3]MRR- WIP'!B7` — a category-label cell pulled from **another external workbook, `MRR- WIP.xlsx`, also not provided**. This is separate from the `MRR June vs May.xlsx` link found in §4.1/§5.4.
- **New finding — "Product-mix" is a distinct client attribute from line-item Product.** Values like `SFA+DMS` / `SFA+Flo` don't exist anywhere in the line-item-level Product field (§3.1, which only has the 5 discrete values GT/DMS/Flo/MT/Other subscription). This is a **separate, client-level "which products does this account use" tag**, apparently maintained in one of the external MRR files, not derivable purely from Consol Sheet Working. Needs your input on where this should now live (likely: derived automatically in the new system as "distinct products this client has active recurring lines for," replacing the manual tag).
- **Verdict:** confirmed no new revenue-calculation logic (same SUMIFS-against-net-revenue pattern throughout) — but two additional master-data enumerations (Domestic Region, International Region, Client Category, Product-mix) and a second broken external file dependency were surfaced that the schema needs to account for.

---

## 5. Key Findings & Data-Quality Issues (read before designing the schema)

1. **Credit notes are inconsistently netted.** Only `Recurr Revenue by client *` and `Recurr Users *` compute a true net figure. The 5 product sheets and `One time` report **gross revenue**, with credit notes tracked only in the separate `Credit notes register`. **Decision needed:** should the new system always net credit notes (recommended), even at the product/OTC level where Excel currently doesn't?
2. **Dead code in the core engine.** `Consol Sheet working` columns O:AR ("Credit notes FY23/24/25") are a fully abandoned first attempt at line-level netting — 26,346 of 26,347 rows are blank. Do not port this pattern; the correct pattern is the two-parallel-cumulative-matrices approach actually used downstream (§3.1 + §3.2 + §4.1).
3. **Client identity is text-matched, not FK'd.** Every `SUMIFS`/`VLOOKUP` join across sheets matches on **typed client-name strings**, resolved through a manually-curated 104-row alias table (`Utility!B:C`). Confirmed failure mode: `Recurr Users 24-25` has both `"3M INDIA LIMITED"` and `"3M INDIA Ltd."` as separate rows — the second is a typo variant that won't match the canonical name and will silently report zero. **The new system must use a `client_id` foreign key**, with name variants resolved once at import time, not re-matched by string on every report.
4. **Broken external dependency.** `Recurr Revenue by client *` column D ("Client category") is `=VLOOKUP(B, '[1]MRR June vs May'!$B:$D, 3, 0)` — a reference to an **external workbook not included** in what you gave me (`MRR June vs May.xlsx`). This field's values are effectively frozen/stale in the current file and its logic can't be reconstructed from what we have. **Needs your input**: either supply that file, or confirm "Client category" (Platinum/Gold/Silver/SMB/Million dollar/Unassigned) is now manually maintained per client and should just be a stored/editable field.
5. **User count is not prorated by days**, unlike revenue — a subscription contributes its full user count to any month it overlaps at all (even one day). This is a deliberate, different rule from the revenue engine and must be implemented as its own function, not reused from the revenue prorater.
6. **`Item Desc` free text is never parsed.** Fields that look like they'd be extracted from text (e.g. `"@INR 550/User * 12 Months"`) are actually separate, independently-entered columns (User Count, Start/End Date, Amount). This confirms User Count, Period, and Amount are **manual/entered data**, not derived from description text — important for deciding what's editable vs. computed in the new UI.
7. **Manual overrides break formula chains silently** — e.g. `Recurr Users 24-25!AQ5` is a hardcoded `4` where a formula was expected. Any Excel-parity validation must tolerate/flag these, not assume every cell is formula-driven.
8. **Two different "clean name" formulas exist** depending on sheet (`Credit notes register!C` looks up `Credit notes register'!B:C` in its own header sample but the live formula actually points at `Utility!B:C` in Consol Sheet Working and at `'Credit notes register'!B:C` in `Credit notes register- Users` — i.e. some sheets alias off Utility directly, others alias off another sheet's already-resolved clean name). Needs consolidating into one canonical resolution step in the new system.
9. **Product/Onetime-Recurring/Client-category/Region/Geography are all closed, small manually-maintained enumerations** (confirmed distinct values: Product ∈ {GT subscription, DMS subscription, Flo subscription, MT subscription, Other modules}; Recurring-flag ∈ {Recurring, One-time}; Region (Domestic) ∈ {East/West/North/Central/South India, Unassigned}; Region (International) ∈ {East Africa, GCC, Europe, Sub-Continent, SEA, West Africa, Unassigned} — **a separate enum from Domestic, not a shared list**; Client Category ∈ {Gold, Platinum, Silver, Million dollar, SMB, Unassigned}; Product-mix ∈ {DMS, Flo, SFA, SFA+DMS, SFA+Flo, Unassigned}). These should become lookup tables/enums, not free text.
10. **A second broken external file dependency**, found while digging into the Geography slicer sheets: `Geography view- Domestic-1!B11` = `='[3]MRR- WIP'!B7`, referencing `MRR- WIP.xlsx` — not provided, separate file from `MRR June vs May.xlsx` (§5.4/§4.1). Please locate/supply this one too if possible.
11. **"Product-mix" is a client-level attribute distinct from line-item Product.** Values like `SFA+DMS`/`SFA+Flo` (used in the Product-mix slicer view) never appear in the line-item Product field and aren't derivable from Consol Sheet Working alone — they look like they were manually maintained in one of the external MRR files. Recommend the new system **derive this automatically** ("distinct products this client has active recurring revenue for," computed from actual line-item data) rather than carry it as another manually-typed field.
12. **The `Walk` sheet's summary block is currently broken** — row 7 ("Total") is `=#REF!` in the live workbook, and its "Post-paid vs. Billing pending" per-client classification (`Walk!K11:K162`) partly falls back to manually-typed text where its VLOOKUP errors. The classification itself (Post-paid/Billing-pending) is a real, useful per-client status worth carrying forward as an editable field; the broken bridge arithmetic around it does not need to be replicated as-is.

---

## 6. Business Rules Catalog (backend-ready, formula-free restatement)

**BR-1 — Revenue recognition (straight-line, day-weighted).**
For an invoice line with amount `A`, service period `[start, end]` (inclusive, `period_days = end-start+1`): the revenue recognized in a given month = `A × (days of [start,end] that fall within that month) / period_days`. Applies identically to credit-note lines (as a negative/reduction amount) with their own `[start,end]`/amount.

**BR-2 — Net monthly revenue.**
`net_revenue(client, month) = Σ invoice_recognized(client, month) − Σ creditnote_recognized(client, month)`, computed consistently at every aggregation level (client, product, OTC) — closing the inconsistency found in §5.1.

**BR-3 — User count (concurrency, not proration).**
A line item contributes its full `user_count` to every month its `[start,end]` period overlaps at all (no day-weighting). Net users = gross active users − credited users, per client per month.

**BR-4 — Recurring vs. One-time classification.**
Manually entered per invoice line at data-entry time (`Onetime/recurring` field); not derived from item name or description. Credit notes inherit this classification from their associated invoice line.

**BR-5 — Product classification.**
Manually entered per invoice line (`Product` field), one of a fixed small set (§5.9). Credit notes inherit Product by looking up the associated invoice's Item→Product mapping.

**BR-6 — Client identity resolution.**
Raw customer name (as typed in Zoho) → canonical client via an alias table. Must be enforced at ingestion (assign `client_id`), not re-resolved per report.

**BR-7 — MRR movement.**
`mrr_delta(client, month) = cumulative_recognized(client, month) − cumulative_recognized(client, month-1)`. This is how "new/expansion/contraction" MRR movement is derived in every reporting sheet — always as a difference of two cumulative points, never computed directly.

---

## 7. Decisions (resolved 2026-08-01)

| # | Question | Decision |
|---|---|---|
| 1 | Net vs. gross of credit notes | **Match Excel exactly**: net only at the client-level rollup (`Recurr Revenue by client *` / `Recurr Users *`); product-line and OTC reports stay gross-only, matching current behavior. |
| 2 | "Client category" source | **You will supply the file(s).** Still outstanding: `MRR June vs May.xlsx` (§5.4) **and** `MRR- WIP.xlsx` (§5.10, found during the slicer-view deep-dive) — both are external links the workbook depends on and neither was in the original upload. Blocks finalizing Client Category and Product-mix logic until received. |
| 3 | Editable vs. read-only field split | **Confirmed as proposed** — see the split in the old §7.3 text, now folded into §6 (BR-4/BR-5) and the field list above. |
| 4 | Historical backfill | **Migrate full history** — all ~26,000 `Consol Sheet working` rows and ~6,000 `Credit notes register` rows will be imported into the new database. |
| 5 | Geography/Category/Product slicer views + Walk/For PPT | **They matter — dug deeper** (done, see updated §4.7/§4.8). Conclusion: no *new* revenue-calculation logic was hiding in them, but they surfaced 3 more master-data enumerations (Domestic Region, International Region, Product-mix), a second broken external file (`MRR- WIP.xlsx`), and a broken `Walk` summary row (`=#REF!`). None of that blocks schema design — it's additional lookup-table content to include. |

**Outstanding blocker:** item 2 needs `MRR June vs May.xlsx`/`.xlsb` and `MRR- WIP.xlsx` (or their current equivalents) before Client Category and Product-mix can be fully specified. Everything else is unblocked.

### 7.1 New file received: `MRR_Apr_May_Jun_Reco_vs_SOT (4).xlsx` — major finding

This is **not** `MRR June vs May.xlsb` or `MRR- WIP.xlsx` themselves — it's a **separate reconciliation report** someone already built, comparing the Excel-side MRR tracking (`xlsb` = `MRR_June_vs_May.xlsb`, the very file referenced by the broken links in §5.4/§4.1) against an **entirely different system of record**: `customer-monthly-mrr_2026-07-16.csv`, labeled in the file as **"SOT" (Source of Truth)**.

**This changes the picture materially:**
- The two sources disagree by **₹56.6L (Apr), ₹58.5L (May), ₹80.4L (Jun)** — i.e. the Excel-based MRR tracker is under-reporting vs. the SOT CSV by 6–8% each month.
- Client counts differ too: 1,151 unique clients in the xlsb side vs. 888 in the SOT — reconciliation found 756 matched (739 exact, 6 name-change, 11 fuzzy), 395 only in xlsb, 132 only in SOT.
- The SOT CSV has its **own classification scheme, "Segment"** (sample value seen: `"Trophy Win"`), which is **different from the xlsb's "Tier"** classification (sample: `"International+FLO"`) — these are not the same as each other, nor as the "Client category" (Gold/Platinum/Silver/SMB) referenced elsewhere in the workbook. There appear to be **at least 3 different client-classification schemes** in circulation (Client Category, Tier, Segment) with no confirmed mapping between them.
- A `GP Reco Extract` tab holds manual Apr/May/Jun adjustment entries specifically for Gold/Platinum-tier clients — another layer of manual correction on top of the base numbers.
- The `Name Changes` and `Fuzzy Review` tabs are a **directly useful, real-world dataset for the client-identity problem flagged in Finding #3** — concrete examples of name variants needing canonicalization (e.g. branch/region suffixes like `-CC`, `-TN`, `-E`, `-MIC`, `-DCA`, `-GCL`, `-GR` appended to an otherwise-identical client name).

**Resolved (2026-08-01):**
- **SOT relationship:** confirmed the SOT is a **separate/newer system**, out of scope for the new backend — it does not need to match or ingest SOT numbers. The new system is built from Invoice + Credit Note data per the original brief, independent of the SOT CSV.
- **Classification schemes:** rather than reconcile Client Category / Tier / Segment now, model a **single unified, manually-editable client-classification field** in the new schema and revisit the mapping later once/if the source files arrive. Do not block schema design on this.

With both of these resolved, item 2 (Client category / Product-mix source) is **unblocked for schema purposes**: model it as a nullable, editable field on the client entity now; the `MRR June vs May.xlsb` / `MRR- WIP.xlsx` files remain nice-to-have for backfilling historical values, not a blocker.

---

## 8. Next Step

Analysis is complete except for the two external files above. I'll proceed to **schema design** (step 3 of your Implementation Order) now: normalized tables for `clients` (with alias resolution replacing `Utility!B:C`), `invoices`/`invoice_lines`, `credit_notes`/`credit_note_lines`, enums for Product/Recurring-flag/Region(Domestic)/Region(International)/Client-category, and a `revenue_recognition` computed layer implementing BR-1–BR-7. Client Category and Product-mix will be modeled as nullable/manually-editable fields for now, to be reconciled once the two external files arrive — this won't block the rest of the schema. I have not started building anything yet; will share the schema design for your review before touching the FastAPI backend.
