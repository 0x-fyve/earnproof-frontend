# Account activity (live API)

The settings activity page (`app/settings/activity`) reads recent account events from the versioned API. `lib/api/activity.ts` is the only client; the old local mock provider is gone and the client never builds events of its own.

## Endpoint

`GET {API_URL}/activity` (v1, see `lib/api/openapi/earnproof-api.v1.json`, `ActivityPage` and `ActivityEvent`).

| Part | Rule |
| --- | --- |
| Auth | `Authorization: Bearer <in-memory session token>`. No token means no request. |
| `limit` | Integer 1 to 100, default 20. Anything else is rejected before sending. |
| `cursor` | Opaque, 1 to 512 characters from `A-Z a-z 0-9 _ - . = : ~`. Exactly 512 is accepted, 513 is rejected. |
| `category`, `outcome` | Filters are applied by the server. Values must be ones this build knows. |
| `X-Request-Id` | A fresh random 128-bit hex id per request (`lib/telemetry/correlation.ts`). Not derived from anything, never stored, never an authenticator. Shown to the user on errors so support can find the request. |

## What renders

- Only fields the server returned **and** the client allow-listed. Extra fields (a raw IP, a token, a full wallet) are dropped at parse time.
- Identifiers are masked again by `redactActivityEvent`, which leaves already-masked values unchanged.
- An event with an unknown category, unknown action, bad timestamp, bad outcome or missing field becomes an id-and-time-only stub and shows the "Unrecognized activity event" row. Entries with no usable `id` are dropped and counted ("N entries could not be displayed").
- Nothing is ever substituted on failure: errors show an error, an empty response shows the empty state.

## States

| Situation | Result |
| --- | --- |
| Capability `activity-log` off or failed to load | "Activity log unavailable" (fails closed; nothing fetched) |
| No in-memory session | "Sign in to view account activity"; nothing fetched |
| 401 | Session cleared in this tab and broadcast to others, sign-in state shown, list removed |
| 403 | "Activity access denied", terminal, no retry |
| 404 / 501 | "Activity log unavailable", terminal |
| 400 / 422, 5xx, network error, malformed body | Alert with the request reference; "Try again" when nothing is loaded |
| Failure while loading a later page | Loaded events stay, alert shown, "Load more" still works |
| Logout, expiry, wallet change, revocation in another tab | In-flight request aborted, list cleared, sign-in state shown |

## Pagination, replay and staleness

- Cursor pagination only. "Load more" sends the server's `nextCursor` and the current filters.
- A response whose `nextCursor` equals the cursor it was sent for ends pagination (no loops). A malformed cursor is an `invalid-response` error.
- Duplicate ids within a page keep the first; ids already on screen are not added again.
- Changing a filter aborts the in-flight request, resets the list and starts again from the first page. A response that arrives after being superseded, unmounted or signed out is ignored, including its errors.
- Aborts are never retried and never shown as errors.

## Accessibility

Loading and empty states use `role="status"`, errors use `role="alert"`, the loaded count is announced through a polite live region, and every action is a native button or select.

## Compatibility

`fetchActivityEvents` now takes `{ token, signal, cursor?, filter?, limit? }` and returns the page plus `requestId` and `droppedCount`. The event types, masking helpers, `ACTIVITY_CATEGORIES` and `ACTIVITY_OUTCOMES` keep their names and shapes. The `activity-log` capability document itself is still served by the capability layer; replacing that stub is separate work.
