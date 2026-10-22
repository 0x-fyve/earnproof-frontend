# Live API contract smoke suite

Opt-in Playwright specs (`npm run test:e2e:api`, config:
`playwright.api-smoke.config.ts`) that execute representative requests
against a real, deployed-or-ephemeral `earnproof-backend` — proving a
*built* frontend can actually talk to a live server with real headers,
status codes, and response bodies. This complements, but does not
replace:

- `tests/contracts/schema-drift.test.ts` (validates the checked-in OpenAPI
  file against generated types — never makes a network call), and
- the mocked `e2e/*.spec.ts` functional suite (`npm run test:e2e`, which
  intercepts every request via `e2e/fixtures/api-mock.ts` and never
  touches a real backend either).

## Running it

```sh
EARNPROOF_API_SMOKE_URL=https://api-staging.example.com/api/v1 \
EARNPROOF_API_SMOKE_TOKEN=<a real bearer token for a synthetic test account> \
npm run test:e2e:api
```

| Env var | Required | Purpose |
| --- | --- | --- |
| `EARNPROOF_API_SMOKE_URL` | Always | The backend origin to hit. No default — never targets production or any hardcoded origin by accident. |
| `EARNPROOF_API_SMOKE_ALLOW_PROD` | Only if the URL looks like a production host (`*.earnproof.{com,io,app}`) | Explicit confirmation to run against what looks like production. Without it, those specs skip rather than risk mutating real data. |
| `EARNPROOF_API_SMOKE_TOKEN` | Only for the authenticated specs | A bearer token for a synthetic/test account. Specs requiring it skip with a clear reason when absent. |

Without `EARNPROOF_API_SMOKE_URL` set, every spec in this directory skips
with a clear, human-readable reason — this is intentional, not a failure,
and `npm run test:e2e` (the default suite) never runs these specs at all
(see `playwright.config.ts`'s `testIgnore`).

## What's covered

- `health.spec.ts` — `GET /health`
- `auth-challenge.spec.ts` — `POST /auth/challenge` (create + validation)
- `organizations.spec.ts` — `GET /organizations` (unauthenticated, authenticated, malformed-token)
- `issuers.spec.ts` — `GET /issuers`, `GET /issuers/{id}`
- `payments.spec.ts` — `GET /payments` (authenticated only — no safe unauthenticated read path)
- `proof-verification.spec.ts` — `GET /proofs/{id}/verify`
- `capability-discovery.spec.ts` — deliberately skipped: no real capability-document
  endpoint exists yet (see that file's own comment for detail and a pointer
  for whoever adds the real endpoint)

## Safety rules this suite enforces (see `smoke-env.ts`)

- **Never targets production by default.** `EARNPROOF_API_SMOKE_URL` must
  be set explicitly, and a URL that looks like production additionally
  requires `EARNPROOF_API_SMOKE_ALLOW_PROD`.
- **Never performs a mutation.** Every spec here is a read (`GET`) or an
  idempotent, side-effect-free `POST` (`/auth/challenge`, which only
  issues a short-lived challenge nonce — it does not create a session or
  any durable resource).
- **Redacts tokens, wallet signatures, and response bodies from
  artifacts.** `redactForArtifact()` and `summarizeShape()` in
  `smoke-env.ts` are the only approved way a spec attaches a response to
  the Playwright report/trace — never `JSON.stringify(body)` directly,
  since a real backend's response can carry real proof/payment data even
  from a read-only check.
