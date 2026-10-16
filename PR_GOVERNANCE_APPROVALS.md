# PR: Add Governance Approval Intent Confirmation Receipts

**Closes #262**

## Summary

Implements immutable, server-confirmed governance approval intent receipts with deterministic validation, comprehensive error handling, and 2,700+ lines of focused tests.

Receipts record **intent only** (never claiming execution), are generated exclusively from server data, and support export, verification, and replay detection.

## What Changed

### Core Implementation (1,800+ lines)
- **`lib/api/governance-approvals.ts`** — Versioned types, validation, authorization
  - `GovernanceApprovalIntentConfirmation` with schema v1.0
  - Type guards and comprehensive validation
  - Authorization checks (approver-only, expiration-aware)
  
- **`lib/governance/receipt-export.ts`** — Deterministic export pipeline
  - JSON, plain text, and CSV formatting
  - Safe filename validation (blocks credential injection)
  - Disclosure warnings (wallet, contract, proposal)
  
- **`lib/governance/verify-receipt.ts`** — Verification and integrity
  - SHA256 digest computation (Web Crypto API)
  - Action hash reproducibility checking
  - Replay detection (network/wallet/state/schema mismatches)
  
- **`lib/governance/approval-context.tsx`** — React Context state management
  - Receipt storage with TTL tracking
  - Authorization-aware hooks
  - Expiration polling and wallet sync
  
- **`components/governance/approval-receipt.tsx`** — UI component
  - Server-confirmed receipt display
  - Authorization checks and expiration status
  - Responsive design, accessibility (ARIA, semantic HTML)
  - Copy/download actions

### Tests (2,700+ lines)
- **`lib/governance/__tests__/governance-approvals.test.ts`** — 750 lines
  - Type guards, validation, authorization, expiration, boundaries
  
- **`lib/governance/__tests__/receipt-export.test.ts`** — 650 lines
  - Export plans, safe filenames, disclosure warnings, formatting
  
- **`lib/governance/__tests__/verify-receipt.test.ts`** — 700 lines
  - Digest verification, action hash reproducibility, replay detection
  
- **`components/governance/__tests__/approval-receipt.test.tsx`** — 700 lines
  - Component rendering, authorization, state transitions, accessibility

## Design

**Intent vs. Execution:** Receipts always record intent only. The `intentType` field is hardcoded to `"intent"` and validated. Execution must be verified independently.

**Server-Confirmed Data:** All receipt fields come from the server. Client state (wallet, signature) is not stored, maintaining a clear boundary.

**Deterministic Action Hash:** Computed from `(targetContract, proposalId, approvalRole, walletAddress, nonce)` for reproducibility and replay detection.

**Time-Aware Expiration:** Uses server time (not client time) to prevent client-side manipulation. Expired intents deny signing but remain viewable.

**Authorization Boundary:** Only the approver's wallet can view the receipt. Check is case-insensitive.

**Replay Detection:** Identifies network/wallet/state/schema mismatches that indicate replay attempts.

**Disclosure Warnings:** Export includes explicit warnings about wallet/contract/proposal disclosure.

## Acceptance Criteria - Met

✅ Receipt generated only from server-confirmed data  
✅ Never claims execution (intent only)  
✅ Displays canonical hash, target, network, proposal, role, timestamp  
✅ Deterministic failure, stale-state, replay, authorization, boundary behavior  
✅ 2,700+ lines of focused tests (positive, negative, auth, boundary, regression)  
✅ Synthetic fixtures only; no production secrets  
✅ Reuses established patterns (credentials export, verification, auth context)  

## Testing

All tests follow repository conventions:
- Jest for unit tests (validation, export, verification)
- React Testing Library for component tests
- Synthetic fixtures; no external dependencies added

Test results summary:
- **governance-approvals.test.ts**: 40+ test cases
- **receipt-export.test.ts**: 35+ test cases
- **verify-receipt.test.ts**: 40+ test cases
- **approval-receipt.test.tsx**: 50+ test cases

## Files Created

```
lib/api/
  ├─ governance-approvals.ts               [400 lines]

lib/governance/
  ├─ receipt-export.ts                     [350 lines]
  ├─ verify-receipt.ts                     [400 lines]
  ├─ approval-context.tsx                  [350 lines]
  └─ __tests__/
      ├─ governance-approvals.test.ts      [750 lines]
      ├─ receipt-export.test.ts            [650 lines]
      └─ verify-receipt.test.ts            [700 lines]

components/governance/
  ├─ approval-receipt.tsx                  [500 lines]
  └─ __tests__/
      └─ approval-receipt.test.tsx         [700 lines]

Documentation:
  ├─ GOVERNANCE_APPROVALS_IMPLEMENTATION.md
  └─ PR_GOVERNANCE_APPROVALS.md (this file)
```

## Migration & Compatibility

- **Additive only**: No breaking changes to existing code
- **No external dependencies**: Uses Web Crypto API (browser native)
- **TypeScript strict**: All files pass strict type checking
- **Backward compatible**: Credentials, auth, proofs unaffected

## Next Steps

1. Backend: Implement `/governance/approvals` endpoint
2. Integration: Wire up to frontend approval submission flow
3. Audit: Log receipt downloads via activity system
4. Public verification: Implement `/verify/{receiptId}` endpoint

## References

- Issue: #262
- Related: #192 (Digest verification), #161 (Controlled export)
- Patterns: lib/credentials/export.ts, lib/auth/auth-context.tsx
