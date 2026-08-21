# Standard Operating Procedure: Agent KYC Clearance, Territorial Assignment & Suspension

**Document ID:** PSIRS-SOP-AGT-002  
**Target Audience:** Revenue Supervisors, KYC Review Officers, Administrators  
**Relevant PRD Sections:** PRD §31-§36; Addendum §1-§26  

---

## 1. Purpose

This Standard Operating Procedure defines the mandatory lifecycle gates governing field revenue agents in Plateau State. Under the **Addendum Rule**, no person may collect revenue on behalf of the state without completing identity KYC, referee clearance, training certification, and territory assignment.

---

## 2. The 5-Stage Agent Clearance Pipeline

```
Stage 1: Application Submitted   --> NIN, Bank Account, Smartphone Registration
Stage 2: KYC & Liveness Check    --> Biometric / NIMC Verification (Clearance)
Stage 3: Referee Endorsement     --> 2 Independent Referees (Community Leader / Officer)
Stage 4: Training & Assessment   --> 100% Completion of 12 PSIRS Field Modules
Stage 5: Government Review       --> Supervisor / Admin Review & Territory Allocation
                 |
                 v
       ACTIVE & AUTHORISED FOR REVENUE COLLECTION
```

---

## 3. Reviewer Instructions

### 3.1 Reviewing an Applicant
1. Sign in as `supervisor` or `admin` on the **Government Portal** (`http://localhost:5174`).
2. Navigate to **Agent Clearance & KYC** (`/agents`).
3. Select an applicant in `READY_FOR_REVIEW`.
4. Inspect:
   - **Identity Status:** Must be `VERIFIED` with face photograph and name matching NIN database.
   - **Bank Account Status:** Must be verified in the applicant's exact legal name (name containment $\ge 2$ tokens).
   - **Referee Declarations:** Verify that 2 referee responses have been received with all 4 statutory declarations confirmed.
   - **Training Modules:** Check that all 12 modules have a passing score.

### 3.2 Territorial Assignment
- Every agent must be assigned to an explicit **LGA** and **Ward** (or set of wards).
- An agent's collections outside their assigned territory will flag operational audit warnings.

### 3.3 Emergency Suspension & Reactivation
- **Trigger:** Fraud detection rule triggered (e.g. >5 consecutive failed payments, abnormal cash volume spikes, or taxpayer complaint).
- **Procedure:**
  1. Open agent profile in Government Portal.
  2. Click **Suspend Agent**.
  3. Enter mandatory audit reason (e.g., `INVESTIGATION_PENDING: Disputed cash collection complaint in Jos North`).
  4. System immediately terminates all active mobile sessions and invalidates JWT tokens.
  5. PWA will instantly block revenue collection attempts with code `AGENT_SUSPENDED`.
