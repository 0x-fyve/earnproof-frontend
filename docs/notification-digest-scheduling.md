# Security notification digest scheduling (#269)

Lets users group low-urgency security notices into a scheduled digest while
critical security events are always delivered immediately.

| Layer | File |
| --- | --- |
| Proposed contract, zod validation, client payload gate | [lib/api/notification-digest-settings.ts](../lib/api/notification-digest-settings.ts) |
| Time zone and DST scheduling | [lib/notifications/digest-schedule.ts](../lib/notifications/digest-schedule.ts) |
| Redacted preview content | [lib/notifications/digest-preview.ts](../lib/notifications/digest-preview.ts) |
| Form | [components/notifications/digest-settings-form.tsx](../components/notifications/digest-settings-form.tsx) |
| Synthetic fixtures | [tests/fixtures/notification-digest-fixtures.ts](../tests/fixtures/notification-digest-fixtures.ts) |

## Backend status: proposed contract, not wired

The API has no notification-preferences endpoint, channel list, critical
event list or settings version/ETag. Following #242/#245, this change adds
no fetcher, spec entry, `client-contracts.json` entry or
`app/settings/notifications` route. The form takes `loadSettings` and
`saveSettings` as props. When the backend exists, add the page (mark it
`PRIVATE` in `scripts/generate-route-manifest.js`, add page metadata, and link
it from `personalItems` in `components/settings/settings-navigation.tsx`).

Proposed (to be confirmed): `GET` / `PUT /users/me/notification-digest-settings`.

```ts
// GET response and PUT 200 response
{
  schemaVersion: 1,
  userId: string,                 // must equal the signed-in user
  version: number,                // optimistic concurrency
  frequency: "off" | "daily" | "weekly",
  deliveryTime: "HH:MM",          // 00:00–23:59, local to timeZone
  dayOfWeek: 1..7 | null,         // ISO weekday (1 = Monday), weekly only
  timeZone: string,               // IANA name; raw offsets rejected
  channel: string,
  supportedChannels: string[],
  digestEventTypes: string[],
  criticalEventTypes: string[],   // server-declared always-immediate types
}
// PUT body: the same editable fields plus { schemaVersion, version }.
// A stale `version` must return 409 (ideally with the current settings as `currentEntity`).
```

Event type names follow the activity log's action names
(`lib/api/activity.ts`). Channels mirror `REMINDER_CHANNELS` (`in-app`,
`webhook`); the API has no email delivery.

## Critical notices are never digested

- **Always immediate (client list):** `api-key-revoked`, `api-key-rotated`,
  `session-started`, `issuer-suspended`, `organization-status-changed`. The
  server's `criticalEventTypes` is merged in, so it can only **add** to this
  list.
- **Digestible:** only the known low-urgency types `api-key-created`,
  `session-refreshed`, `session-expired` and `issuer-approved`, and only if
  nobody declares them critical. Unknown types are never digestible.
- The UI shows critical types in a locked "🔒 Always sent immediately" list,
  with no checkbox for them.
- `validateDigestSettingsUpdate()` refuses any payload containing a critical
  or unknown type, so such a payload is never sent. If saved settings contain
  one, it is dropped from the editable selection, the user is told it will be
  sent immediately, and saving removes it.
- **The server must enforce this rule independently.** The client check is
  defence in depth; a modified client must not be able to delay critical
  notices.

## Preview

Preview lines are fixed, synthetic, already-redacted strings (e.g. "An API
key ending in ••••0000 was created."). They are never built from the user's
real events, so they cannot contain secrets, tokens, wallet data or private
claim values; a test checks them against JWT, long-hex, Stellar key, email and
long-number patterns.

## Scheduling boundaries

| Case | Rule |
| --- | --- |
| Next delivery | The first scheduled instant **at or after** now. At exactly the delivery instant, that instant is next; 1 ms later, the following one. |
| Midnight | `00:00` is valid and means local midnight; `24:00` is invalid. |
| Day of week | Evaluated in the schedule's time zone. For example, weekly Monday 00:00 in `Asia/Tokyo` is Sunday 15:00 UTC. |
| Skipped hour (spring forward) | A time inside the gap is sent at the same offset after the gap: New York 02:30 becomes 03:30 EDT. The preview explains this. |
| Repeated hour (fall back) | Sent **once**, at the first occurrence: New York 01:30 is sent at 01:30 EDT, not EST. The preview explains this. |
| Time zone change while pending | Unsaved: the preview shows the next delivery in the new zone plus "Currently scheduled: …" in the saved zone. In flight: every field, including the time zone, is disabled until the save settles. The saved schedule changes only after a successful save. |

## Optimistic concurrency

Every save sends the `version` it was based on. A `409` (either
`ApiConflictError` with the current settings, or a plain 409, after which the
form reloads) is never retried automatically and never silently overwrites.
The form:

1. adopts the latest server settings (and their new version);
2. keeps the user's unsaved values;
3. says "These settings were changed elsewhere. Nothing was saved." and lists
   the differing fields.

The user then chooses **Use the saved settings** or **Keep my changes**, and
must save again explicitly.

## Authorization and failure states

- No signed-in user: the form asks the user to sign in and nothing is loaded.
- `401` / `403` on load or save: an explicit message, and "Nothing was saved"
  on a save.
- Settings whose `userId` is not the viewer's are discarded ("different
  account"), so users only ever edit their own settings.
- An unsupported `schemaVersion` or malformed settings fail closed, and the
  form is not shown.
