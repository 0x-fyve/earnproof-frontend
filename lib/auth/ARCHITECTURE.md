# Session & Wallet Lifecycle Architecture

## Problem Statement

The original implementation had several issues:

1. **No centralized 401 handling** - Each request handles 401 independently, causing:
   - Multiple concurrent recovery attempts
   - Race conditions in token refresh
   - Inconsistent session state

2. **Token persisted insecurely** - Token stored in localStorage vulnerable to:
   - XSS attacks via JavaScript
   - Accidental logging of token material
   - Session hijacking via storage events

3. **No wallet change detection** - User switching accounts/networks causes:
   - Stale wallet data rendering under new wallet context
   - No cache invalidation before display

4. **No multi-tab synchronization** - Logout/token rotation in one tab:
   - Not visible to other tabs
   - Each tab maintains separate session state
   - Inconsistent behavior across tabs

5. **No graceful session expiry** - Session expiration causes:
   - Repeated 401s with no recovery
   - Silent failure of requests
   - Poor user experience

## Solution Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    App Root (layout.tsx)                    │
│                 <AuthSessionProvider>                       │
└─────────────────────────────────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
    ┌───▼──────┐  ┌─────────▼──────┐  ┌────────▼────┐
    │ TokenMgr │  │ SessionCoord   │  │WalletDetect │
    │ (in-mem) │  │ (401 dedup)    │  │(account/net)│
    └──────────┘  └────────────────┘  └─────────────┘
        │                    │                    │
        │                    └────────────────────┤
        │                                        │
    ┌───▼────────────────────────────────────────▼──────┐
    │         AuthSessionContext (centralized state)    │
    │  • user: SessionUser | null                       │
    │  • isAuthenticated: boolean                       │
    │  • walletState: WalletState                       │
    │  • isRecovering: boolean                          │
    └────────────────────────────────────────────────────┘
        │
        └──────────────────────────────────────────────────┐
             │                                            │
       ┌─────▼──────────┐                    ┌───────────▼────┐
       │ useAuthSession │                    │MultiTabSync    │
       │ (hook)         │                    │(BroadcastChan) │
       └────────────────┘                    └────────────────┘
             │
       ┌─────▼──────────────────────────────┐
       │   Components & Pages               │
       │  • CreateProofFlow                 │
       │  • PaymentSync                     │
       │  • SessionRecoveryModal            │
       └───────────────────────────────────┘
```

## Core Components

### 1. TokenManager (In-Memory Token Storage)

**Purpose**: Securely store JWT token in memory (never persisted)

**Key Features**:
- No localStorage/sessionStorage (prevents XSS exposure)
- Atomic token rotation (no race conditions)
- Expiry checking with 30-second grace period
- Change notifications via listeners

**API**:
```typescript
tokenManager.setToken(token, expiresAt);
tokenManager.getToken(); // null if expired
tokenManager.hasToken();
tokenManager.rotateToken(newToken);
tokenManager.clearToken();
tokenManager.onTokenChange(() => { /* react */ });
```

**Behavior**:
- `setToken()` triggers all listeners immediately
- `rotateToken()` is atomic (prevents mid-rotation state reads)
- `getToken()` returns null if token is within 30-second grace period of expiry
- Listeners receive no token data (just notified of change)

### 2. SessionCoordinator (401 Deduplication)

**Purpose**: Ensure exactly ONE recovery attempt when multiple concurrent requests receive 401

**Key Features**:
- Tracks recovery state (idle → recovering → recovered/failed → idle)
- Queues requests during recovery
- Retries failed requests after successful recovery
- Graceful degradation on recovery failure
- Abort signal support for request cancellation

**State Machine**:
```
    idle
     │
     ├─ handle401() called (first request)
     ▼
  recovering  ◄─ subsequent requests queue here
     │
     ├─ recovery succeeds
     ▼
  recovered
     │
     └─ auto-transitions to idle after 0ms
        (or stays failed if recovery failed)
```

**API**:
```typescript
coordinator.handle401(recoveryFn, signal);
coordinator.getState();
coordinator.getPendingCount();
coordinator.reset();
```

**Example Flow** (concurrent 401s):
```
Request1: GET /payments → 401
Request2: GET /proofs → 401 (arrives while recovering)
Request3: POST /sync → 401 (arrives while recovering)

All three call coordinator.handle401()
├─ Request1: starts recovery, calls recoveryFn
├─ Request2: queued (waits)
└─ Request3: queued (waits)

Recovery succeeds
├─ Request1: resumes
├─ Request2: resumes and retries
└─ Request3: resumes (not retried, it's a mutation)
```

### 3. WalletDetector (Account/Network Change Detection)

**Purpose**: Detect when user switches Freighter account or network

**Key Features**:
- Periodic polling of wallet state (default 3s)
- Distinguishes account changes from network changes
- Emits change events with previous/current state
- No token data in events

**Change Types**:
- `connected` - Wallet went from disconnected → connected
- `disconnected` - Wallet disconnected
- `account_changed` - Switched to different Freighter account
- `network_changed` - Switched networks (testnet ↔ mainnet)

**API**:
```typescript
detector.initialize(checkIntervalMs);
detector.getState();
detector.onChange((event, newState) => { /* react */ });
detector.forceCheck();
detector.destroy();
```

**Integration with Auth**:
- On account/network change, `AuthSessionProvider` calls `auth.clearSession()`
- Broadcasts `wallet_changed` message to other tabs
- Components re-fetch wallet-specific data

### 4. Cross-tab sync (TabSyncCoordinator; MultiTabSync is a deprecated adapter)

**Purpose**: Propagate wallet logout, session revocation, recent-auth expiry
and tenant switches to every open same-origin tab (#274). Full reference:
[docs/cross-tab-sync.md](../../docs/cross-tab-sync.md).

**Key Features**:
- BroadcastChannel, with a `storage`-event fallback on a dedicated key
- Versioned message `{ v, type, epoch, tabId, tenantId?, ts }`, validated on
  receipt; malformed, oversized (> 256 bytes), unknown-version,
  unknown-type and extra-field (e.g. token-bearing) messages are dropped
- Downgrade-only: no message can authenticate a tab or grant a role
- Hybrid logical clock epochs; replays ignored; concurrent events resolved
  most-restrictive-first (revocation > logout > recent-auth expiry >
  tenant switch), then by tabId
- Publish dedupe (500 ms) and rate limit (5/s); inbound cap (20/s)
- Transport closed on `pagehide`, reopened on bfcache `pageshow`

**API**:
```typescript
const sync = getTabSyncCoordinator(); // null during SSR
sync?.publish('tenant_switched', { tenantId }); // -> 'sent' | 'deduplicated' | 'rate_limited' | ...
const unsubscribe = sync?.subscribe((event) => { /* downgrade only */ });
```

`MultiTabSync` keeps its old API as an adapter: `broadcast('logout' |
'wallet_changed')` sends `wallet_logout`, `broadcast('session_expired')`
sends `session_revoked`, and `token_rotated` / `session_recovered` are no
longer transmitted.

### 5. AuthSessionProvider (Centralized State)

**Purpose**: Provide single source of truth for session and wallet state

**Key Features**:
- Integrates all four managers
- Handles lifecycle events (wallet change, multi-tab sync, etc.)
- Validates redirect paths (prevents open redirects)
- Notifies on session changes

**State**:
```typescript
user: SessionUser | null;
isAuthenticated: boolean;
isRecovering: boolean;
recoveryError: string | null;
walletState: WalletState;
```

**API**:
```typescript
auth.setSession(user, token, expiresAt);
auth.clearSession(reason);
auth.attemptRecovery(recoveryFn);
auth.getToken();
auth.getRedirectPath();
auth.setRedirectPath(path); // validated
auth.invalidateWalletData(reason);
```

**Lifecycle**:
```
Mount
 ├─ Initialize WalletDetector (start polling)
 ├─ Initialize MultiTabSync (start listening)
 └─ Load session from existing storage (if any)

While mounted:
 ├─ Listen to wallet changes → clear session if mismatched
 ├─ Listen to multi-tab messages → sync state
 └─ Update context on setSession/clearSession

Unmount
 ├─ Stop WalletDetector polling
 └─ Close MultiTabSync channel
```

## Data Flow: Handling a 401

```
[Component] makes authenticated request
    │
    ▼
[authenticatedApiClient]
    │
    ├─ Get token from TokenManager
    ├─ Add Authorization header
    └─ Make request
         │
         ├─ Success (200)
         │   └─ Return response
         │
         ├─ Other error (4xx, 5xx)
         │   └─ Throw error
         │
         └─ 401 Unauthorized
             │
             ▼
         [SessionCoordinator.handle401()]
             │
             ├─ Is already recovering?
             │   ├─ Yes: Queue this request, wait
             │   └─ No: Start recovery
             │
             ▼
         [Recovery Function]
             │ (e.g., token refresh endpoint)
             │
             ├─ Success
             │   ├─ New token obtained
             │   ├─ TokenManager.rotateToken(newToken)
             │   ├─ [Broadcast] token_rotated to other tabs
             │   ├─ Resume queued requests
             │   └─ Retry original request with new token
             │
             └─ Failure
                 ├─ [Broadcast] session_expired to other tabs
                 ├─ auth.clearSession('recovery_failed')
                 ├─ Show SessionRecoveryModal
                 └─ Reject all queued requests
```

## Security Properties

### No Token Persistence
✅ Tokens stored in memory only  
✅ Cleared on logout or page refresh  
✅ Never sent to analytics/telemetry  
✅ Never logged in console  

### Atomic Token Rotation
✅ All requests use old token XOR new token (no hybrid state)  
✅ No window where different requests use different tokens  
✅ Rotation prevents concurrent rotation attempts  

### 401 Deduplication
✅ Multiple concurrent 401s trigger exactly one recovery  
✅ No race conditions in token refresh  
✅ All affected requests complete together (no orphaned requests)  

### Open Redirect Prevention
✅ Return destination validated on `getRedirectPath()`  
✅ Must start with `/` and not contain `://`  
✅ Defaults to `/` on validation failure  

### Multi-Tab Safety
✅ Logout, revocation, recent-auth expiry and tenant switches synced across tabs  
✅ Schema-validated, token-free messages; extra fields rejected  
✅ Received messages can only downgrade; tenant access re-checked with the server  
✅ Deterministic conflict order and replay protection (see docs/cross-tab-sync.md)  

## Testing Strategy

### Unit Tests
- SessionCoordinator: concurrent 401s, recovery retry, cleanup
- TokenManager: storage, rotation, expiry, listeners
- WalletDetector: account changes, network changes, polling
- Tab sync protocol/coordinator: validation, replay, concurrency, bounds, storage fallback
- MultiTabSync adapter: legacy mapping (downgrades only)

### Integration Tests
- End-to-end auth flows (login, logout, wallet change)
- Multi-tab convergence (logout sync, token rotation sync)
- Redirect validation (open redirect prevention)

### Not Covered (Requires Dependencies)
- Full build validation (`npm run build`)
- Linting (`npm run lint`)
- Real Freighter wallet integration
- Actual BroadcastChannel in test environment (tests use an in-memory fake and a two-window storage fake)

## Migration Guide

See `INTEGRATION_GUIDE.md` for step-by-step migration from old pattern to new pattern.

## Performance Considerations

- **WalletDetector**: Default 3s poll interval (configurable)
- **TokenManager**: In-memory O(1) operations
- **SessionCoordinator**: O(n) for n pending requests (typically < 10)
- **MultiTabSync**: One BroadcastChannel per app (negligible overhead)

## Browser Compatibility

- **TokenManager**: All modern browsers
- **SessionCoordinator**: All modern browsers
- **WalletDetector**: Requires Freighter extension availability
- **MultiTabSync**: Modern browsers with BroadcastChannel; graceful degradation without it

## Future Enhancements

- Token refresh before expiry (pre-emptive refresh)
- Local storage cache of public user data (not tokens)
- Session analytics (login/logout events without token data)
- Device fingerprinting for security
- Rate limiting on recovery attempts
