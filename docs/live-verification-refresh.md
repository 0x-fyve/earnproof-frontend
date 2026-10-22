# Live verification refresh with source selection (#268)

Gives verifiers an explicit way to request fresh evidence when cached
verification is too old for their policy, without ever passing stale
evidence off as fresh.

| Layer | File |
| --- | --- |
| Proposed contract, hand-written validation | [lib/api/live-verification-refresh.ts](../lib/api/live-verification-refresh.ts) |
| Pure rules (freshness, Retry-After, cooldown, sources, role gate) | [lib/verification/live-refresh.ts](../lib/verification/live-refresh.ts) |
| Bounded refresh state machine | [lib/verification/use-live-verification-refresh.ts](../lib/verification/use-live-verification-refresh.ts) |
| Panel | [components/verification/live-verification-refresh.tsx](../components/verification/live-verification-refresh.tsx) |
| Synthetic fixtures | [tests/fixtures/live-verification-fixtures.ts](../tests/fixtures/live-verification-fixtures.ts) |

## Backend status: proposed contract, not wired

`GET /proofs/{id}/verify` is the only verification endpoint. It takes no
source, refresh mode or max-age, and the API exposes no verifier freshness
policy or list of supported sources. Following #242/#245, this change adds
no fetcher, spec entry or `client-contracts.json` entry. The panel takes
`refresh`, `supportedSources` and `policy` as props and is not mounted in
`app/verify` yet. Validation is hand-written because zod would push `/verify`
past its bundle budget (~16 KB headroom).

Proposed (to be confirmed): `POST /proofs/{id}/verify/refresh { source }` →

```ts
{
  schemaVersion: 1,
  proofId: string,                         // must equal the requested proof
  source: "cached_indexer" | "live_contract", // must equal the requested source
  observedAt: string,                      // ISO 8601: when the source observed the proof state
  result: VerifyProofResponse["result"],
}
```

The backend should also expose the deployment's supported sources and the
verifier's `maxEvidenceAgeMs`, and must enforce authorization and rate limits
server-side. `lib/api/client.ts` does not expose response headers, so a real
loader must read `Retry-After` itself and throw `LiveRefreshHttpError`.

## Freshness: exact boundary

`age = now - observedAt`. Evidence is **fresh only while `age <
maxEvidenceAgeMs`**; at `age == maxEvidenceAgeMs` it is **stale**. This
matches the repository's other freshness window (`RECENT_AUTH_WINDOW_MS`, also
strict); the backend defines none today.

- `observedAt` up to 30 s in the future counts as age 0. Anything further
  ahead is an invalid timestamp ("freshness unknown").
- With no valid policy (missing, `<= 0` or non-finite), freshness is "not
  confirmed" and never shown as fresh.

## Sources

Known sources are `cached_indexer` ("Cached (indexer)") and `live_contract`
("Live contract (RPC)"). Every known source is listed, but only those the
backend advertises are selectable; the others say "not supported by this
server". An advertised source this client does not recognise is listed as
"unknown source, not selectable". With no selectable source, refresh is
disabled.

## Bounded refresh

| Bound | Value | Boundary |
| --- | --- | --- |
| In flight | 1 | Further clicks are ignored synchronously, so a double-click sends one request. |
| Timeout | 15 s (`AbortController`) | At exactly 15 s the request is aborted and reported as timed out; a later response is ignored. |
| Cooldown | 30 s, from when a request is **sent** | Visible countdown; the button re-enables at exactly the end. Switching source does not reset it. |
| 429 | `Retry-After` (seconds or HTTP-date), clamped to 10 min | Extends the cooldown; an unparseable value falls back to 30 s. |

Progress is announced in a polite live region: *Requesting refresh… →
Fetching evidence from the selected source… → Validating evidence… → Refresh
complete* (or the failure).

## Fallback: never silently stale

After a failed or timed-out refresh, cached evidence is shown under **"Cached
evidence (live refresh failed)"** with its own freshness assessment. If it
does not meet the policy it reads **"STALE: … old. Does not meet policy
freshness"**, and the progress region says "Showing cached evidence, which
is not live." Cached evidence is never relabelled as refreshed or fresh, and
never replaces a refresh result without that label.

## Replay and concurrency

- A refresh result is applied only if it is the newest request for the same
  proof, tenant and source, and the response's `proofId` and `source` equal
  the requested ones. Otherwise it is discarded as a mismatch.
- Changing the proof, tenant or source aborts the in-flight request and
  discards its outcome.
- Cached evidence whose `proofId` differs from the panel's proof is never shown.

## Authorization

A refresh requires a signed-in session with a known role (`WORKER`,
`ISSUER`, `ADMIN`, `DEVELOPER`). Without one the button is disabled with a
reason, and the loader is never called.

| Server response | Behaviour |
| --- | --- |
| `401` | Explicit message; further refreshes for this proof are blocked until the panel is remounted. |
| `403` | Explicit message; further refreshes for this proof are blocked until the panel is remounted. |
| `429` | Rate-limited message and the Retry-After cooldown above. |
