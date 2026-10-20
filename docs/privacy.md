# Browser Storage Privacy Policy

This document describes what data is persisted in browser storage, why it's persisted, and the privacy safeguards in place.

## Overview

The EarnProof frontend uses browser storage (primarily `localStorage`) to maintain application state across page reloads and browser sessions. All storage is scoped to the user's browser and domain; no data is shared across domains or with third parties.

## Storage Inventory

### Session Storage (`earnproof.session`)

**Purpose:** Maintain authentication state for wallet-connected users.

**Data Structure:**
```typescript
{
  version: 1,
  timestamp: string, // ISO timestamp
  key: 'SESSION',
  data: {
    token: string,    // JWT session token
    user: {
      id: string,     // User ID
      walletAddress: string, // Stellar wallet address
      email?: string  // Optional email (if provided)
    }
  }
}
```

**Retention:** Persists until explicit logout, browser data clearance, or token expiration (server-side).

**Cleanup Triggers:**
- User-initiated logout (wallet disconnect)
- Server-side token expiration
- Browser storage clearance

**Privacy Safeguards:**
- Token is a server-issued JWT with expiration
- No wallet private keys or seed phrases are stored
- Email is optional and only stored if provided during registration

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
Session data is scoped to the active wallet address. Changing wallets clears previous session data.

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
- Session token for authenticated API calls
- User ID for server reference
- Wallet address for Stellar operations

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
- **Data minimization:** Only essential session data
- **Storage limitation:** Session-bound with automatic expiration
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
2. Verify only `earnproof.session` exists
3. Verify data structure matches documented schema
4. Verify clearance on logout

## Security Notes

### Token Security
- JWT tokens have server-controlled expiration
- Tokens are transmitted over HTTPS only
- No refresh token mechanism (requires re-authentication)

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