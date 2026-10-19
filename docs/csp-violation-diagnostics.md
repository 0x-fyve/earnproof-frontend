# CSP violation diagnostics

Operator view at `/settings/security/csp` (linked from the security posture page). It shows how often the browser blocked something under our Content Security Policy, grouped so a bad deploy stands out, without collecting anything that could identify a person or a page.

## What a row contains

Directive, route category, release, a coarse blocked-source kind, a count, and first/last seen times. That is the whole contract (`CspViolationGroup` in `lib/api/openapi/earnproof-api.v1.json`).

| Field | Allowed values |
| --- | --- |
| `directive` | The directives set in `config/security-headers.ts` (`script-src-elem`, `img-src`, ...). |
| `routeCategory` | `public`, `verify`, `embed`, `proofs`, `settings`, `issuers`, `developers`, `other`. A bucket, never a path. |
| `release` / `firstSeenRelease` | Short build labels: `A-Z a-z 0-9 . _ + -`, 1 to 64 characters, starting with a letter or digit. Anything shaped like a JWT or a `sk_`/`key_`/`token` prefix is refused. |
| `blockedKind` | `inline`, `eval`, `data`, `blob`, `same-origin`, `third-party`, `unknown`. The kind of source, not which one. |
| `count` | Whole number from 1 up to `Number.MAX_SAFE_INTEGER`. |

## Privacy rules (enforced by the client, not trusted from the server)

- **No full URLs, DOM content, tokens or typed values.** A group that carries a field such as `blockedUri`, `documentUri`, `sourceFile`, `sample`, `snippet`, `referrer`, `url`, `token`, `authorization`, `walletAddress`, `userAgent` or `ipAddress` (any casing, with or without `-`/`_`) is **withheld whole** and counted ("N groups were withheld"). It is not trimmed and shown.
- Fields the contract does not list are dropped when the response is parsed.
- Every remaining string is an enum member or a short identifier, so a URL cannot get through either route.
- Remediation links come from a fixed table in `lib/api/csp-violations.ts`, never from the response.
- Nothing is persisted. The view holds data in memory only and adds no browser-storage keys.
- This view does not collect reports. Ingestion, aggregation and sample stripping happen on the server; the browser never sends violation reports from this app.

## Access

`GET /csp-violations` is scoped to the caller's organization by the bearer token and requires an administrator. The view only opens for `ADMIN` and `ISSUER` sessions and never calls the API for other roles, but the server is the authority.

| Situation | Result |
| --- | --- |
| No in-memory session | "Sign in to view CSP diagnostics", nothing fetched |
| Role other than ADMIN or ISSUER | "Access Denied", nothing fetched |
| 401 | Session cleared in this tab and broadcast to the others |
| 403 | "CSP diagnostics access denied", terminal |
| 404 or 501 | "CSP diagnostics unavailable", terminal |
| 400, 422, 5xx, network error, malformed body | Alert with the request reference and a retry button |
| Logout, expiry, wallet change, revocation in another tab | In-flight request aborted, data cleared |

## Regressions, staleness and boundaries

- **Regression:** a group whose `release` and `firstSeenRelease` both equal `currentRelease`. These get a "New in <release>" badge and are counted in the summary.
- **Stale:** a report is stale when `generatedAt` is strictly more than 15 minutes old. Exactly 15 minutes is fresh. A future `generatedAt` (clock skew) counts as fresh.
- **Page size:** 1 to 200 (default 50). **Cursor:** 1 to 512 characters from `A-Z a-z 0-9 _ - . = : ~`. A response that returns the cursor it was sent ends pagination.
- **Releases list:** at most 50, de-duplicated.
- **Counts:** a group with a count below 1, a fractional or unsafe-integer count, or `firstSeenAt` after `lastSeenAt` is dropped and counted as "could not be displayed".
- **Replay:** ids already shown are not added again; the first of duplicate ids inside a response wins.
- **Concurrency:** each filter or window change aborts the previous request and ignores whatever it returns later, including errors.
- **Correlation:** every request carries a fresh random `X-Request-Id`, shown on errors so support can find the request. It is not stored.

## Recovery workflow

Open the row's **Steps**. The guidance depends on the blocked kind: move inline code behind a nonce or hash, remove `eval`, review third-party origins, check the deploy for missing same-origin assets. The rules the steps repeat: widen one directive only after you know what is blocked, never `default-src`, never add `unsafe-eval`. After the fix ships, counts for the new release should stop growing.

Each row links to a help page for its directive (`<HELP_URL>/csp/<directive>`, rendered only if the origin is on the external-link allow-list), the public security overview and the system status page.

## Accessibility

Real `<table>` with a caption, column headers and a row header per directive. Controls are native labelled `select` elements. Loading and empty states use `role="status"`, errors use `role="alert"`. Recovery steps use `<details>`, so they work with the keyboard and screen readers without script.

## Changing the contract

Update `lib/api/openapi/earnproof-api.v1.json`, `lib/api/client-contracts.json` and `lib/api/generated/v1.ts` together, then the parser in `lib/api/csp-violations.ts` and its tests. Adding a field that could hold free text or a URL is a privacy change and needs review first.
