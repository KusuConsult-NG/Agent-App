# User Acceptance Testing (UAT) Plan & Test Execution Scripts

> **This document is the conference-room walkthrough**: it confirms, against a
> demonstration build, that every feature is present and behaves. It is not a
> field trial and cannot tell you whether an agent can use the platform.
>
> For that, see **[UAT-FIELD-TRIAL.md](UAT-FIELD-TRIAL.md)** — real agents, real
> markets, real handsets — and **[UAT-OBSERVER-SHEET.md](UAT-OBSERVER-SHEET.md)**,
> the sheet an observer carries.
>
> Note in particular that no real citizen may pay real money through the
> platform until B-4 is closed: every external integration is still a mock, and
> a mock confirms everything.

**Document ID:** PSIRS-UAT-2026-V1  
**Target Roles:** PSIRS Revenue Officers, Finance Officers, Field Supervisors, Taxpayer Advocates  
**Acceptance Standard:** 100% Pass rate on critical financial and integrity journeys  

---

## 1. Scope of User Acceptance Testing

The UAT validates the end-to-end functionality, usability, and security compliance of the Plateau State Digital Grassroots Revenue Platform across 10 primary journeys:

1. **Journey 1: Field Agent Application & Clearance** (NIN KYC, Referee verification, Bank validation)
2. **Journey 2: Government Approval & Territory Assignment** (Supervisor maker-checker review)
3. **Journey 3: Taxpayer Onboarding & TIN Assignment** (Individual & Business registration, Ward mapping)
4. **Journey 4: Revenue Assessment & Payment Collection** (Catalogue selection, POS/Transfer payment)
5. **Journey 5: Digital Receipt Generation & QR Verification** (PDF download, Public verification portal)
6. **Journey 6: Motor Vehicle Licensing & Renewal** (Plate search, Renewal clearance slip)
7. **Journey 7: Offline PWA Draft Capture & Auto-Sync** (Airplane mode simulation, sync queue)
8. **Journey 8: Mobile Bluetooth Thermal Printing** (58mm/80mm ESC/POS paper receipt)
9. **Journey 9: Financial Reconciliation & Commission Settlement** (3-way match, 1.5% commission)
10. **Journey 10: Fraud Detection, Audit Trail & Suspension** (Rule trigger, session revocation)

---

## 2. Test Execution Matrix & Sign-Off Script

| Journey | Test Scenario | Expected Outcome | Pass/Fail | Sign-Off Officer |
| :--- | :--- | :--- | :---: | :--- |
| **J-01** | Apply as Field Agent via PWA (`http://localhost:5173`) | Application created, referee invitations sent, KYC in progress | [ ] | |
| **J-02** | Complete Referee response via portal link | Token validated, relationship declared, agent status becomes `READY_FOR_REVIEW` | [ ] | |
| **J-03** | Supervisor approves agent and assigns LGA/Ward | Agent status transitions to `ACTIVE`, mobile credentials unlocked | [ ] | |
| **J-04** | Agent registers taxpayer with Ward selection | Taxpayer created, TIN assigned or queued, duplicates flagged | [ ] | |
| **J-05** | Agent assesses informal trade fee and confirms payment | Payment verified, receipt generated with valid QR and tamper hash | [ ] | |
| **J-06** | Scan receipt QR via Public Portal (`http://localhost:5174/#/verify/CODE`) | Public portal displays genuine green check with matched amount & date | [ ] | |
| **J-07** | Perform Vehicle Renewal | Vehicle lookup succeeds, renewal fee calculated, renewal document issued | [ ] | |
| **J-08** | Disconnect Internet and capture taxpayer draft offline | Record saved to IndexedDB; automatically syncs when network restored | [ ] | |
| **J-09** | Execute Finance Reconciliation Run in Admin Portal | 3-way match reconciles platform, gateway, and bank balances | [ ] | |
| **J-10** | Suspend agent for security violation | Agent instantly logged out of mobile app, cannot initiate transactions | [ ] | |

---

## 3. Formal Acceptance Sign-Off

We, the undersigned representatives of the Plateau State Internal Revenue Service (PSIRS), confirm that the platform has undergone rigorous acceptance testing and meets all operational requirements.

- **Director of Grassroots Revenue:** ___________________________ Date: ____________
- **Director of Finance & Accounts:** ___________________________ Date: ____________
- **Director of Information Technology:** ___________________________ Date: ____________
- **Executive Chairman, PSIRS:** ___________________________ Date: ____________
