# Standard Operating Procedure: 3-Way Financial Reconciliation & Settlement

**Document ID:** PSIRS-SOP-FIN-001  
**Target Audience:** Finance Officers, Auditors, Revenue Directors  
**Relevant PRD Sections:** PRD §26, §27, §61, §84  

---

## 1. Purpose

This Standard Operating Procedure (SOP) outlines the mandatory steps for executing three-way financial reconciliation between:
1. **Platform Ledger (`transactions`, `payments`, `receipts`)**
2. **Payment Gateway Statement (Remita RRR Settlements)**
3. **Consolidated Revenue Account Bank Statement (Plateau State Treasury Account)**

---

## 2. The 3-Way Reconciliation Principle

```
+------------------------------------+
| 1. Platform Verified Revenue       |
|    (Issued receipts with valid QR) |
+------------------------------------+
                 |
                 v  (Match Reference & Amount)
+------------------------------------+
| 2. Gateway Settlement Statement    |
|    (Remita collected funds)        |
+------------------------------------+
                 |
                 v  (Match Net Remittance Batch)
+------------------------------------+
| 3. Commercial Bank Account Credit  |
|    (State Treasury Account Credit) |
+------------------------------------+
```

---

## 3. Reconciliation Workflows

### 3.1 Automated Scheduled Reconciliation
The background worker executes every 6 hours over a trailing window:
- Fetches unsettled payments marked `VERIFIED`.
- Queries the payment gateway settlement batch report.
- Marks transactions as `SETTLED` once credited to the government account.
- Automatically promotes accrued agent commission to `ELIGIBLE` once the 72-hour holding period elapses.

### 3.2 Manual Daily Reconciliation by Finance Officer
1. Sign in to the **Government Portal** (`http://localhost:5174`) using credentials with `finance_officer` role.
2. Navigate to **Finance & Reconciliation** -> **Reconciliation Runs**.
3. Select date window (e.g. Previous Day `00:00:00` to `23:59:59`).
4. Click **Start Reconciliation Run**.
5. Review the generated match report:
   - **Matched (Green):** Revenue, Gateway, and Bank entries agree in amount and reference.
   - **Pending Settlement (Yellow):** Payment verified at gateway, awaiting bank batch transfer.
   - **Exception / Discrepancy (Red):** Amount mismatch or missing settlement line.

---

## 4. Exception Investigation & Dispute Handling

### Case 1: Gateway Paid, Webhook Not Delivered
- **Symptom:** Taxpayer shows gateway debit receipt, platform transaction displays `INITIATED` or `PENDING`.
- **Action:**
  1. Open **Transactions** in Government Portal.
  2. Search by `gateway_reference` (RRR).
  3. Click **Query Gateway Status** -> The API queries Remita directly and promotes the transaction to `VERIFIED` and issues the official digital receipt.

### Case 2: Fraudulent Chargeback / Payment Reversal
- **Symptom:** Gateway reports a chargeback on an already verified receipt.
- **Action:**
  1. Finance Officer initiates reversal request in portal (`POST /payments/:id/refund`).
  2. Maker-Checker approval required: An Administrator or Director of Finance must approve.
  3. Upon approval:
     - Transaction marked `REVERSED`.
     - Receipt marked `VOID`.
     - Agent commission wallet automatically debited/clawed back (`owedBackKobo`).
     - Verification portal will now report receipt as `VOID / CANCELLED`.
