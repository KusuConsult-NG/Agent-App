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
- Automatically promotes accrued agent commission to `ELIGIBLE` once the
  holding period elapses. That period is a property of the commission policy
  (`commission_policies.hold_period_hours`), not a platform constant; it
  defaults to 72 hours and an administrator can set it per policy, so check the
  policy before quoting a figure to an agent.

### 3.2 Manual Daily Reconciliation by Finance Officer
1. Sign in to the **Officer Portal** at the address for your deployment —
   `http://localhost:5174` is the development server and is not reachable from
   a PSIRS workstation — using credentials with the `finance_officer` role.
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
  1. Finance Officer raises a reversal request in the portal — a
     `PAYMENT_REVERSAL` approval (`POST /government/approvals`), which needs
     `payment:reverse:request` as well as `approval:request`.
  2. **A second officer decides it** (`POST /government/approvals/:id/decide`).
     The officer who raised it cannot decide it; the platform refuses.
  3. **A third officer executes it**
     (`POST /government/approvals/:id/execute-reversal`), holding
     `payment:reverse:approve` and confirming a one-time code. The officer who
     approved it cannot execute it either.
  4. Upon execution:
     - Transaction marked `REVERSED`.
     - Receipt marked `REVERSED` — not `VOID`. Both are statuses the receipt
       can hold and they are not interchangeable: `VOID` is a receipt
       cancelled on its own, `REVERSED` is one whose money went back.

> Three officers, not two. There is no "Director of Finance" role in this
> platform; the roles are `admin`, `supervisor`, `revenue_officer`,
> `finance_officer` and `auditor`. Which of them may perform each of the three
> steps is decided by permission, not by title, and an administrator can move
> those permissions between roles.

This procedure previously named `POST /payments/:id/refund`, a single endpoint
that does not exist and never did, with one approver. Anybody following it
during a live chargeback would have found nothing at that address and would
have been looking for the wrong number of signatures.
     - Agent commission wallet automatically debited/clawed back (`owedBackKobo`).
     - Verification portal will now report receipt as `VOID / CANCELLED`.
