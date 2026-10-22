# Browser Storage Privacy Policy

This document describes what data is persisted in browser storage, why it's persisted, and the privacy safeguards in place.

## Overview

The EarnProof frontend uses browser storage (primarily `localStorage`) to maintain application state across page reloads and browser sessions. All storage is scoped to the user's browser and domain; no data is shared across domains or with third parties.

## Storage Inventory

### Session (not stored)

The bearer token and signed-in user profile are held **in memory only** (`lib/session.ts`, backed by `lib/auth/token-manager.ts`). They are never written to `localStorage`, `sessionStorage`, cookies or the URL.

- **Reload:** a page reload drops the session. Protected views fall back to their "connect wallet" state and the user signs a fresh challenge. Nothing is replayed from disk.
- **Legacy entry:** older builds stored `{ token, user }` under `earnproof.session`. That key is *retired* in `lib/storage/registry.json`. It is never read as a session. It is deleted from `localStorage` and `sessionStorage` the first time `lib/session.ts` is used, and again on every sign-in and sign-out.
- **Revocation:** logout, expiry (30 second grace window in the token manager), a 401, and a wallet change clear the in-memory session and broadcast a token-free message so every other open tab clears its own copy.

### Registered persistence

Everything else the app persists is listed in [`lib/storage/registry.json`](../lib/storage/registry.json): key, area, scope, classification, schema version, owner, declared accessor files, retention and cleanup. See [Storage schema validation](./storage-schema-validation.md) for how this is enforced.

### Cross-tab sync message (`earnproof.tab-sync.v1`)

**Purpose:** Storage-event fallback for cross-tab auth/tenant sync when
`BroadcastChannel` is unavailable ([docs/cross-tab-sync.md](./cross-tab-sync.md)).

**Data:** `{ v, type, epoch, tabId, tenantId?, ts }` only: an event type,
a logical clock value, a random per-tab id, an optional organization id and a
timestamp. No token, session id, wallet address or claim value. Messages
with any other field are rejected.

**Retention:** None at rest. The value is written and removed in the same
call, existing only long enough to fire a `storage` event in other tabs.

## What We Explicitly Do NOT Store

### Sensitive Financial Data
- **Wallet private keys or seed phrases** - Never stored; all signing occurs in the Freighter extension
- **Transaction details** - Payment amounts, counterparties, and timestamps remain on the Stellar network
- **Bank account information** - Not applicable to this application

### Personal Identifiable Information (PII)
- **Government IDs** - Not collected
- **Social Security Numbers** - Not collected  
- **Phone numbers** - Not collected
- **Home addresses** - Not collected

### Credential Contents
- **Proof bodies** - Generated credentials are for download/export only
- **Raw credential JSON** - Not persisted in browser storage

## Storage Boundaries

### User/Wallet Scope
The in-memory session is scoped to the active wallet. Changing wallets clears it (and notifies other tabs). Per-account records in the registry are keyed by account id.

### Domain Scope
All storage is scoped to the application domain (`earnproof.com` in production). No cross-domain storage.

### Browser Scope
Storage is specific to the browser and device. No synchronization across browsers or devices.

## Migration and Versioning

### Versioned Schemas
All storage uses versioned schemas to enable safe migration. Each stored value includes:
- `version`: Schema version number
- `timestamp`: When the value was stored/updated
- `key`: Storage key for validation

### Migration Safety
- **Unknown versions** are rejected and removed
- **Corrupted data** is rejected and removed  
- **Future versions** are rejected and removed (fail-closed)
- **Legacy formats** are migrated when possible

## Privacy by Design

### Data Minimization
Only store what's necessary for core functionality:
- Bearer tokens are never persisted
- Per-account records are keyed by account id
- Preferences and drafts hold non-secret values only

### Default Privacy
- No analytics or tracking by default
- No third-party cookies
- No cross-site tracking

### User Control
- Clear session data on logout
- Browser-native controls for data clearance
- No persistent identifiers without user action

## Compliance

### GDPR Considerations
- **Lawful basis:** Contractual necessity (wallet authentication)
- **Data minimization:** No session data is persisted
- **Storage limitation:** Each registered key declares its retention and cleanup
- **User rights:** Clear data via logout or browser controls

### CCPA Considerations
- **No sale of personal information**
- **Right to know:** This document discloses storage practices
- **Right to delete:** Logout or browser data clearance

## Testing and Verification

### Automated Tests
Storage behavior is verified through:
- Migration path tests
- Corruption handling tests
- Privacy boundary tests
- Cleanup trigger tests

### Manual Verification
Review storage via browser Developer Tools:
1. Open Application > Local Storage
2. Verify no `earnproof.session` entry exists and no value contains a bearer token
3. Verify data structure matches documented schema
4. Verify clearance on logout

## Security Notes

### Token Security
- Tokens have server-controlled expiration and live in memory only
- Tokens are transmitted over HTTPS only
- No refresh token mechanism (a reload requires re-authentication)

### Storage Limitations
- Browser storage is not encrypted at rest
- Users should use browser security features
- Consider using browser profiles for additional isolation

## Future Considerations

### Potential Enhancements
- Encrypted storage for sensitive fields
- Session expiration reminders
- Cross-device session management (opt-in)

### Deprecation Policy
When storage schemas change:
1. Maintain migration paths for one major version
2. Document breaking changes in release notes
3. Provide clear upgrade instructions