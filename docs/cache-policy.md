# Cache Policy

Proof and status data have different freshness and privacy requirements
than the marketing pages. This document is the source of truth for how
`earnproof-frontend` sets `Cache-Control`, and it is enforced by
[tests/cache/cache-headers.test.ts](../tests/cache/cache-headers.test.ts) and
[tests/cache/api-client-cache.test.ts](../tests/cache/api-client-cache.test.ts),
not just described here.

## Policy by route

| Policy        | Routes                                                                                                                            | `Cache-Control`                      | Why                                                                                                                                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public static | Everything not listed below (`/`, `/how-it-works`, `/privacy`, `/developers`, `/faq`, `/about`, `/contact`, `/terms`, `/issuers`) | `public, max-age=0, must-revalidate` | Non-sensitive marketing/education content. Safe for a shared cache or browser to store, but must always revalidate rather than serve indefinitely, since these pages ship over normal deploys, not a CDN-fingerprinted build. |
| Health        | `/status`                                                                                                                         | `no-store, private`                  | This app's own health/monitoring surface (the actual `GET /health` endpoint lives on `earnproof-backend`, see [lib/health-check.ts](../lib/health-check.ts)). A cached status page defeats the point of a status page.        |
| Verification  | `/verify/:path*` (`/verify`, `/verify/credential`, `/verify/scan`)                                                                | `no-store, private`                  | Public but privacy- and time-sensitive: a `VALID`/`EXPIRED`/`REVOKED` result must never be served stale from a shared cache, and must not linger in browser history/back-forward navigation as if it were still current.      |
| Authenticated | `/proofs/:path*` (`/proofs`), `/settings/:path*` (`/settings`)                                                                    | `no-store, private`                  | Wallet-authenticated payment sync, classification, proof creation, and account/organization settings (API keys, payment methods, sessions, audit log, trusted sources). Never eligible for any shared caching.                |

The rule source of truth is [config/cache-headers.ts](../config/cache-headers.ts),
consumed by [next.config.ts](../next.config.ts) alongside the security
headers in [config/security-headers.ts](../config/security-headers.ts).
Next.js applies every matching rule for a path and, when two rules set the
same header key, the last matching rule wins — see the "Header Overriding
Behavior" section of `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md`
in this fork's bundled Next.js docs (this repo pins a Next.js version with
documented behavior differences from the public release — see
[AGENTS.md](../AGENTS.md)). `config/cache-headers.ts` relies on that
ordering: the public-static default is listed first, then the
health/verification/authenticated overrides after it, so their `no-store`
always wins over the public default on the routes they target.

## API responses

Every request through [lib/api/client.ts](../lib/api/client.ts) sets
`cache: "no-store"` on the `fetch()` call itself (opting out of Next's own
fetch data cache) and an explicit `Cache-Control: no-store` request header,
regardless of caller-supplied headers or cache mode. There is no route
served by this client that is safe to cache: verification lookups,
payments, and proof creation are either time-sensitive or
wallet-authenticated. [lib/health-check.ts](../lib/health-check.ts) applies
the same `no-store` fetch options directly (it calls `fetch` rather than
going through `apiClient`).

This frontend does not control the actual HTTP response headers the
backend (`earnproof-backend`) sends for those API calls — that's tracked in
that repository, not here. What this repo controls, and does, is: never ask
for a cached copy, and never provide the request-side signals a caching
proxy would need to store one.

## Revalidation cannot replace newer state with an older response

Two places in this app poll or re-fetch data where an in-flight request can
be superseded before it resolves:

- **[lib/health-check.ts](../lib/health-check.ts)** (`useHealthCheck`,
  used by the status page): every fetch is tied to an `AbortController`,
  and the previous controller is aborted before a new request starts. On
  top of that, both the success and failure handlers check that the
  request that just settled is still the _current_ one
  (`controllerRef.current === controller`) before calling `setState` —
  guarding against an environment where an aborted fetch's promise still
  settles instead of rejecting. See
  [tests/cache/health-check-stale-response.test.ts](../tests/cache/health-check-stale-response.test.ts)
  for the regression coverage (a slow superseded request resolving after a
  faster newer one, and the same for a superseded request's late failure).
- **Proof form submissions** (`components/proofs/create-proof-flow.tsx`):
  the equivalent guarantee for form submissions — only the response
  belonging to the current submission may update success state — is
  covered separately under the proof-form idempotency work tracked in
  issue #86, not by this document.

## Offline / stale UI

`useHealthCheck` retains the last successfully fetched `data` across a
failed refresh (so the status page doesn't blank out on a transient
network blip) but now also reports `isDataLive: boolean`. It is `true`
only immediately after the _most recent_ check succeeded; a failed refresh
flips it to `false` without discarding the retained data. The status page
(`app/status/page.tsx`) uses this to render an explicit "Showing the last
known status as of `<time>`... this is not necessarily the current state"
notice whenever it is displaying carried-over data, instead of presenting
a stale result as if it were live.

## Known limitation: back/forward cache (bfcache)

`Cache-Control: no-store` is the standard signal browsers use to exclude a
page from the back/forward cache, and Chromium and WebKit both honor it.
Firefox's bfcache implementation does not currently key off
`Cache-Control` the same way, so a `no-store` verification or proof page
can still be restored from Firefox's bfcache on back/forward navigation in
some versions. There is no purely header-based fix for this; treat it as a
documented gap, not a bug to silently work around with JavaScript
`pagehide`/`pageshow` handlers without discussing the UX trade-off first
(those handlers can themselves break bfcache for browsers that _do_ support
it). If `docs/browser-support.md` exists in this repository (tracked
separately — see issue #85), it names the specific browsers this is
validated against.

## Validation

```bash
npx jest tests/cache
```

Covers: the four Cache-Control policies resolve to the values in the table
above (and that overrides always win over the public-static default);
`apiClient` always requests `no-store` and cannot be overridden by a
caller; and the stale-response-ordering guarantees described above.
`npm run test` (the full suite) runs this alongside everything else in CI.
