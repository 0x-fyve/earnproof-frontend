# Session & Wallet Lifecycle Integration Guide

This guide explains how to integrate the new session and wallet lifecycle handling into existing pages and components.

## Architecture Overview

The implementation provides:

1. **SessionCoordinator** - Deduplicates concurrent 401 responses
2. **TokenManager** - Manages in-memory token storage (no persistence)
3. **WalletDetector** - Monitors Freighter account/network changes
4. **MultiTabSync** - Syncs session state across browser tabs
5. **AuthSessionProvider** - Context provider for centralized state
6. **authenticatedApiClient** - Enhanced API client with 401 recovery

## Setup

### 1. Wrap App with AuthSessionProvider

In `app/layout.tsx` or your root layout:

```tsx
import { AuthSessionProvider } from '@/lib/auth';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <AuthSessionProvider>
          {children}
        </AuthSessionProvider>
      </body>
    </html>
  );
}
```

### 2. Update Existing Authentication Pages

For proof creation flows or login pages using `useAuthSession()`:

```tsx
'use client';

import { useAuthSession } from '@/lib/auth';
import { SessionRecoveryModal, useSessionRecoveryModal } from '@/components/auth/session-recovery-modal';

export function CreateProofFlow() {
  const auth = useAuthSession();
  const recovery = useSessionRecoveryModal();

  // Connect wallet
  async function handleConnect() {
    try {
      const address = await getFreighterAddress();
      const challenge = await apiClient({
        path: '/auth/challenge',
        method: 'POST',
        body: JSON.stringify({ walletAddress: address }),
      });

      const signature = await signFreighterMessage(
        challenge.message,
        address,
      );

      const verified = await apiClient({
        path: '/auth/verify',
        method: 'POST',
        body: JSON.stringify({
          challengeId: challenge.id,
          walletAddress: address,
          signature,
        }),
      });

      // Store session via context (not localStorage)
      auth.setSession(
        verified.user,
        verified.session.token,
        verified.session.expiresAt,
      );
    } catch (error) {
      console.error('Connection failed:', error);
    }
  }

  // Disconnect wallet
  function handleDisconnect() {
    auth.clearSession('user_initiated');
  }

  return (
    <>
      {auth.isAuthenticated ? (
        <button onClick={handleDisconnect}>Disconnect</button>
      ) : (
        <button onClick={handleConnect}>Connect Wallet</button>
      )}

      <SessionRecoveryModal
        isOpen={recovery.isOpen}
        isRecovering={recovery.isRecovering}
        error={recovery.error}
        onRecover={async () => {
          recovery.startRecovery();
          try {
            // Re-auth: request new token
            const newVerified = await apiClient({
              path: '/auth/challenge',
              method: 'POST',
              body: JSON.stringify({
                walletAddress: auth.user?.walletAddress,
              }),
            });
            // ... sign and verify ...
            recovery.completeRecovery();
          } catch (error) {
            recovery.completeRecovery(
              error instanceof Error ? error.message : 'Recovery failed',
            );
          }
        }}
        onDismiss={recovery.closeModal}
      />
    </>
  );
}
```

### 3. Use authenticatedApiClient for Authenticated Requests

Replace direct `apiClient()` calls with `authenticatedApiClient()`:

```tsx
import { authenticatedApiClient } from '@/lib/api/client-with-auth';
import { useAuthSession } from '@/lib/auth';

export function SyncPayments() {
  const auth = useAuthSession();

  async function handleSync() {
    try {
      const payments = await authenticatedApiClient<Payment[]>({
        path: '/payments',
        method: 'GET',
        onRecoveryNeeded: async (signal) => {
          // Implement token refresh or re-auth
          // This is called when 401 is received
          const response = await apiClient({
            path: '/auth/refresh',
            method: 'POST',
            signal,
          });
          auth.setSession(response.user, response.token);
        },
      });

      setPayments(payments);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Sync failed');
    }
  }

  return (
    <button disabled={!auth.isAuthenticated} onClick={handleSync}>
      Sync Payments
    </button>
  );
}
```

### 4. Handle Session Changes Proactively

Use wallet change detection to clear stale data:

```tsx
export function PaymentList() {
  const auth = useAuthSession();
  const [payments, setPayments] = useState<Payment[]>([]);

  // Invalidate payments when wallet changes
  useEffect(() => {
    if (auth.walletState.address !== lastWalletRef.current) {
      lastWalletRef.current = auth.walletState.address;
      setPayments([]);
      auth.invalidateWalletData('wallet_switched');
    }
  }, [auth.walletState.address]);

  // ... rest of component
}
```

### 5. Multi-Tab Session Sync

Wallet logout (`clearStoredSession()`), session revocation, recent-auth expiry
(`useRecentAuth`) and organization switches (inside `OrganizationWorkspaceShell`)
are propagated to other tabs automatically. To react to them elsewhere,
subscribe to the coordinator and only ever downgrade:

```typescript
const sync = getTabSyncCoordinator();
useEffect(() => sync?.subscribe((event) => {
  if (event.level >= TAB_SYNC_RESTRICTIVENESS.wallet_logout) dropPrivateState();
}), [sync]);
```

Never use a received `tenantId` (or anything else in a message) to grant
access; re-fetch from the server. See
[docs/cross-tab-sync.md](../../docs/cross-tab-sync.md).

## Migration Path for Existing Code

### Before: Direct localStorage + apiClient

```tsx
// Old pattern (removed: bearer tokens are never persisted, see docs/privacy.md)
const session = JSON.parse(localStorage.getItem('earnproof.session') || '{}');
const token = session.token;

await apiClient({
  path: '/payments',
  headers: bearer(token),
});

// Logout
localStorage.removeItem('earnproof.session');

// Today: readStoredSession() / storeSession() / clearStoredSession() from
// "@/lib/session" keep the session in memory via the TokenManager.
```

### After: Auth context + authenticatedApiClient

```tsx
// New pattern
const auth = useAuthSession();
const token = auth.getToken(); // null if expired

await authenticatedApiClient({
  path: '/payments',
  onRecoveryNeeded: async (signal) => {
    // Refresh token or re-auth
  },
});

// Logout
auth.clearSession('user_initiated');
```

## Key Differences

| Aspect | Before | After |
|--------|--------|-------|
| **Token Storage** | localStorage | In-memory (TokenManager) |
| **Session Access** | Direct reads/writes | Context hook (useAuthSession) |
| **401 Handling** | Manual per-request | Centralized (SessionCoordinator) |
| **Concurrent 401s** | Multiple recoveries | Single coordinated recovery |
| **Token Expiry** | Backend-enforced | Pre-checked by TokenManager |
| **Wallet Changes** | Manual polling | Automatic (WalletDetector) |
| **Multi-Tab Sync** | None | Automatic (MultiTabSync) |

## Testing

### Unit Tests

```bash
npm run test -- lib/auth/__tests__
```

Tests cover:
- Concurrent 401 deduplication
- Token rotation atomicity
- Session state management
- Wallet change detection
- Multi-tab synchronization
- Open redirect prevention

### Integration

For components using the new auth system, mock `useAuthSession()`:

```tsx
jest.mock('@/lib/auth', () => ({
  useAuthSession: () => ({
    user: { id: 'test-user', walletAddress: '0x123' },
    isAuthenticated: true,
    getToken: () => 'test-token',
    setSession: jest.fn(),
    clearSession: jest.fn(),
    // ... other methods
  }),
}));
```

## Security Considerations

1. **No Token Persistence**: Tokens are never stored in localStorage or sessionStorage
2. **Atomic Rotation**: Token updates are atomic (all or nothing)
3. **Concurrent Safety**: 401s are deduplicated to prevent race conditions
4. **Open Redirect Prevention**: Redirect paths are validated to prevent open redirects
5. **No Sensitive Data in Messages**: Multi-tab sync never transmits token material
6. **Grace Period**: Token expiry checked with 30-second grace period

## Troubleshooting

### Session cleared unexpectedly

Check multi-tab sync messages via browser console. May indicate:
- Logout in another tab
- Wallet account switched
- Network changed

### 401 loop

Verify `onRecoveryNeeded` function:
- Should successfully refresh token or trigger re-auth
- Should call `auth.setSession()` with new token
- Should not rethrow the same error

### Token null after setting session

Check if token is expired:
- TokenManager checks expiry with 30-second grace period
- Verify `expiresAt` timestamp is in future

### Wallet changes not detected

Ensure `AuthSessionProvider` is mounted and `WalletDetector.initialize()` was called (automatic on mount).

## API Reference

See `lib/auth/index.ts` for exported types and `lib/auth/` for implementation details.
