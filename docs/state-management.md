# Frontend State Management Guide

This document defines the state-management patterns used by EarnProof
and explains when each approach should be used.

The goal is to keep state predictable, avoid unnecessary duplication,
and ensure sensitive session data is not retained after logout.

Logout, session revocation, recent-auth expiry and tenant switches are
propagated across open tabs by the tab-sync coordinator; see
[cross-tab-sync.md](./cross-tab-sync.md). Received events may only
downgrade local state.

---
 
## 1. Choosing the right state mechanism

Use the smallest state mechanism that correctly represents the data.

| State type | Preferred approach |
| --- | --- |
| Short-lived UI state | React `useState` |
| Form state and validation | `react-hook-form` |
| Server/API state | TanStack Query |
| Small persisted browser preferences/session metadata | `localStorage` |
| Derived state | Compute from existing state |
| Sensitive secrets | Do not persist in client state |

Do not introduce a global state library unless the existing patterns
cannot reasonably support the requirement.

---

# 2. localStorage session pattern

The application uses a defined session key rather than scattering
arbitrary localStorage keys throughout components.

A persisted value should always have:

1. A named storage key.
2. Explicit serialization.
3. Explicit parsing.
4. Safe handling of malformed data.
5. Cleanup during logout.

Example:

```ts
const SESSION_KEY = "earnproof_session";

type SessionState = {
  walletAddress: string;
  expiresAt: number;
};

export function saveSession(session: SessionState) {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify(session),
  );
}

export function readSession(): SessionState | null {
  const raw = localStorage.getItem(SESSION_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as SessionState;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}




---

 # 3. Status and verification pages

Verification/status pages should prefer TanStack Query for
server-backed status.

Typical lifecycle:

route/input
   ↓
query key
   ↓
TanStack Query
   ↓
loading
   ↓
success / error


Example:

```ts
const query = useQuery({
  queryKey: ["verification", proofId],
  queryFn: () => verifyProof(proofId),
  enabled: Boolean(proofId),
});
