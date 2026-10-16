# Offline verification bundle workflow

Implements [#294](https://github.com/veridatum-labs/earnproof-frontend/issues/294):
prepare and verify bounded signed evidence when temporary network access is
unavailable.

## Where it lives

| Concern | Module |
| --- | --- |
| Bundle model, scoping, integrity, verification, freshness | `lib/credentials/offline-bundle.ts` |
| Workflow UI | `components/verification/offline-bundle-workflow.tsx` |
| Route | `app/verify/offline/page.tsx` |
| Export filename registration | `lib/credentials/export.ts` |

## Lifecycle

1. **Request** — choose disclosure scopes and a validity window
   (`OFFLINE_BUNDLE_MIN_VALIDITY_HOURS`–`OFFLINE_BUNDLE_MAX_VALIDITY_HOURS`,
   1–72 hours).
2. **Download** — `earnproof-offline-bundle.json`, written through the existing
   safe-export path (`downloadTextFile`).
3. **Local integrity check** — SHA-256 via `verifyDigest` over
   `bundleDigestInput()` (every field except `digest`).
4. **Offline result** — `verifyOfflineBundle()`.
5. **Freshness refresh** — `refreshOfflineBundle()` once back online.

## The three offline invariants

- **Time-bounded.** The bundle carries `validUntil`; verification at or before
  it is `verified-offline` (the exact boundary still counts as valid), one
  millisecond after it is `expired`.
- **No revocation claims offline.** Offline verification always reports
  `revocation: "not-checked-offline"`. Only an *online* refresh may report
  `revocation: "current"`; when it cannot reach the network it reports
  `offline` + `unknown` rather than guessing.
- **Scoped disclosure.** `scopedPayload()` copies the public record plus only
  the private scopes (`subject`, `amount`, `sender`) that were requested *and*
  present in the source. `includedFields()` lists exactly what a bundle
  discloses, and the download warns for each private scope.

## Deterministic failure behavior

`verifyOfflineBundle()` checks in a fixed order — schema → integrity → expiry →
replay — so a bundle that is both tampered with and expired always reports
`integrity-failed`:

| Status | When |
| --- | --- |
| `unsupported-schema` | `schemaVersion` is not the supported one |
| `integrity-failed` | the computed digest does not match `bundle.digest.value` |
| `expired` | `now > validUntil` |
| `replayed` | the bundle's `nonce` was already verified in this session |
| `verified-offline` | otherwise |

Request validation is a separate, explicit step: a bundle cannot be prepared
without a proof ID, with a validity outside 1–72 hours, or without the `public`
scope.

## Synthetic fixtures only

`fetchMockOfflineBundleSource()` provides synthetic demo evidence. No secrets,
wallet material, private proof data or production credentials are committed.
