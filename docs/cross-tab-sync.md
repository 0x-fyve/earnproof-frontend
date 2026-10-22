# Cross-tab auth and tenant sync (#274)

Wallet logout, session revocation, recent-auth expiry and tenant
(organization) switches made in one tab are reflected in every other open
tab of the same origin.

| Layer | File |
| --- | --- |
| Wire protocol (schema, validation, conflict rules) | [lib/auth/tab-sync-protocol.ts](../lib/auth/tab-sync-protocol.ts) |
| Transport (BroadcastChannel, storage-event fallback) | [lib/storage/tab-sync-transport.ts](../lib/storage/tab-sync-transport.ts) |
| Coordinator (publish/subscribe, clock, bounds, lifecycle) | [lib/auth/tab-sync-coordinator.ts](../lib/auth/tab-sync-coordinator.ts) |
| Applying downgrades in a workspace | [components/auth/tab-sync-bridge.tsx](../components/auth/tab-sync-bridge.tsx), mounted by [OrganizationWorkspaceShell](../components/layout/organization-workspace-shell.tsx) |
| Legacy adapter (deprecated) | [lib/auth/multi-tab-sync.ts](../lib/auth/multi-tab-sync.ts) |

## Message schema (v1)

```ts
{
  v: 1,                    // protocol version
  type: "session_revoked" | "wallet_logout" | "recent_auth_expired" | "tenant_switched",
  epoch: number,           // hybrid logical clock (see below)
  tabId: string,           // 16-64 lowercase hex chars, random per tab
  tenantId?: string,       // tenant_switched only; [A-Za-z0-9_-]{1,64}; informational
  ts: number,              // sender wall clock, epoch ms
}
```

Messages are rejected (never applied, never partially applied) when:

| Reason | Rule |
| --- | --- |
| `oversized` | Serialized payload > **256 UTF-8 bytes**, checked on the raw string before parsing. Exactly 256 is accepted. |
| `malformed` | Not a string on the wire, invalid JSON, or not a plain object. |
| `unsupported_version` | `v` is not exactly the number `1` (checked before any other field). |
| `unknown_type` | `type` is not one of the four above, e.g. `login`, `session_recovered`, `role_granted`. |
| `unexpected_field` | Any field outside the schema (for example `token`, `sessionId`, `walletAddress`, `role`), or `tenantId` on a non-tenant event. Extra fields are rejected, not stripped. |
| `invalid_epoch` | Not a positive safe integer, or more than 30 s ahead of the receiver's clock. |
| `invalid_tab_id` / `invalid_tenant_id` / `invalid_timestamp` | Field fails its pattern or type. |
| `stale_timestamp` | `|now - ts| > 30 000 ms`. A difference of exactly 30 000 ms is accepted. |

Outbound messages pass the same validator before sending, so a tab can
never emit something a receiver would reject.

## Guarantees

- **No secrets.** The schema has no field that can carry a token, session
  id, wallet address, proof or claim value; anything extra is rejected.
- **Same origin only.** BroadcastChannel and `localStorage` are scoped to
  the origin by the browser. There is no `postMessage`, and nothing is
  sent cross-origin.
- **Downgrade only.** Every event type logs out, locks, expires recent auth
  or drops tenant-scoped data. There is no event that authenticates a tab
  or grants a role, and the bridge only unlocks when the page is reloaded
  or navigated and the stored session is read again.
- **Tenant data is never trusted from a message.** On `tenant_switched` the
  receiving tab drops its organization-scoped state immediately (bumping the
  organization context `generation`), re-fetches organizations from the
  server, and restores the stored selection only if that fresh list says it
  is selectable. If the re-check fails, no organization is selected.
- **No echo.** A tab never receives its own messages, and a tab that
  clears its session because of a received message calls
  `clearStoredSession({ broadcast: false })`.

## Ordering, conflicts and replay

The epoch is a hybrid logical clock: each publish uses
`max(previous epoch + 1, Date.now())`, and receiving a message raises the
local clock to at least its epoch. A tab that has seen an event therefore
always stamps a strictly later epoch.

Each coordinator remembers the last applied (or locally published) message
`{epoch, tabId, type}`. For an incoming message:

1. From this tab → ignored (`own_message`).
2. `epoch > last.epoch` → applied.
3. `epoch < last.epoch` → ignored (`replay`).
4. `epoch == last.epoch` and same `tabId` → ignored (`replay`).
5. `epoch == last.epoch` from a different tab (concurrent events) → the
   **more restrictive** type wins: `session_revoked (4) > wallet_logout (3)
   > recent_auth_expired (2) > tenant_switched (1)`. If both are equally
   restrictive, the lexicographically greater `tabId` wins.

Effects are cumulative: applying a level also performs every lower level's
downgrade (logout and revocation also drop tenant data and recent auth;
recent-auth expiry also re-checks tenant access). Dropping a less
restrictive concurrent message therefore never loses a downgrade, and the
final state of a tab is the same whatever order concurrent messages arrive
in.

## Bounds

| Bound | Value | Boundary behaviour |
| --- | --- | --- |
| Publish rate | 5 per rolling 1 000 ms per tab | The 6th is `rate_limited`; a slot frees at exactly 1 000 ms after it was used. |
| Publish dedupe | Same `type` (+ `tenantId`) within 500 ms | `deduplicated` at 499 ms, sent at exactly 500 ms. |
| Inbound processing | 20 per rolling 1 000 ms | Excess messages are dropped before parsing. |
| Message size | 256 UTF-8 bytes | 256 accepted, 257 rejected. |

`publish()` returns `"sent" | "deduplicated" | "rate_limited" | "invalid" |
"unavailable" | "closed"`, so callers can tell when a message was not sent.

## Events and where they originate

| Event | Published by | Effect in other tabs |
| --- | --- | --- |
| `wallet_logout` | `clearStoredSession()` in `lib/session.ts` (every "Disconnect" flow that uses it) | Clear session and in-memory token, lock the workspace, cancel any pending recent-auth action. |
| `session_revoked` | `AuthSessionProvider.attemptRecovery` when 401 recovery fails | Same as logout, with "Session revoked" copy. |
| `recent_auth_expired` | `useRecentAuth`, at exactly `lastVerifiedAt + RECENT_AUTH_WINDOW_MS` | Freshness dropped; the next sensitive action prompts again. |
| `tenant_switched` | `OrganizationWorkspaceShell` after a local `switchOrganization` / `clearOrganization` | Drop tenant data, re-check access with the server. |

Recent-auth boundary: freshness is `now - lastVerifiedAt < RECENT_AUTH_WINDOW_MS`.
At exactly the window end, auth is expired and the event is published.

## Lifecycle

- The coordinator is a lazily created per-tab singleton
  (`getTabSyncCoordinator()`, `null` during server rendering).
- Subscribers unsubscribe on unmount.
- On `pagehide` the transport is closed (nothing is received or sent while
  the page is hidden or frozen); a bfcache `pageshow` reopens it.
- Fallback: if `BroadcastChannel` is missing or throws, the coordinator
  writes the message to `earnproof.tab-sync.v1` in `localStorage` and
  removes it immediately, so receivers get a `storage` event and nothing
  stays at rest.

## Compatibility and migration

- `MultiTabSync` (and its `SyncMessage` types) is kept as a deprecated
  adapter. `broadcast('logout' | 'wallet_changed')` sends `wallet_logout`;
  `broadcast('session_expired')` sends `session_revoked`; `token_rotated`
  and `session_recovered` are no longer transmitted. `onSync` listeners
  receive `logout` / `session_expired`.
- The wire protocol changed from the unvalidated `earnproof-session-sync`
  channel to `earnproof.tab-sync.v1`. During a rollout, a tab still running
  the old bundle does not sync with updated tabs until it reloads. This is
  fail-safe: neither side can gain authorization from the other.
- A future `v: 2` must keep v1 receivers safe: v1 tabs reject v2 messages
  as `unsupported_version`, which can only skip a downgrade, never apply one
  wrongly.

## Known limitations

- Only routes rendered inside `OrganizationWorkspaceShell` apply received
  events with the bridge. At the time of writing, no route renders that
  shell yet. `useRecentAuth` and `MultiTabSync` subscribers work wherever
  they are mounted.
- `components/organizations/organization-members.tsx` removes
  `earnproof.session` directly instead of calling `clearStoredSession`, so
  its "Sign out" does not publish `wallet_logout` yet (outside this
  change's scope; switching it to `clearStoredSession()` is the fix).
- There is no server push for revocation; other tabs learn about it only
  when a 401 recovery fails in some tab. The server remains the authority
  for every session and permission check.
