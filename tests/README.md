# `tests/`

Unit/integration tests that don't map 1:1 onto a single component (those
live in `__tests__/` next to the component instead — see
[`docs/testing-guide.md`](../docs/testing-guide.md) for the full picture
of how testing works across this repo). Everything here runs under Jest
(`npm run test`), same as the co-located component tests.

## Layout

```
tests/
├── api/            fetchWithTimeout / retry / cancellation behavior of lib/api/client.ts
├── components/     a reference hook + its test (see note below)
├── contracts/      OpenAPI schema-drift check against lib/api/client-contracts.ts
├── exports/        credential/verification-link export safety (filenames, no leaked PII)
├── fixtures/       shared JSON fixtures, organized by feature (qr/, ...)
├── qr/             VerifyScan component: QR decode states, safety, keyboard recovery
├── security/       CSP/security-header policy and external-URL safety checks
└── proof-input.test.ts   proof-ID / verification-link parsing (lib/validation/proof-input.ts)
```

## Running

```bash
npm run test                        # whole repo, including tests/
npm run test -- tests/qr            # just one directory
npm run test -- tests/proof-input.test.ts   # just one file
```

## Fixtures (`tests/fixtures/`)

Plain JSON, imported directly (`import x from "@/tests/fixtures/..."`,
using the `@/` path alias — works because `jest.config.mjs` resolves it
the same way the app does). `tests/fixtures/qr/` is the current example:

- `image-states.json` — synthetic `BarcodeDetector` outcomes (blurred,
  rotated, multiple-codes, oversized payload) since raster QR decoding
  isn't available under jsdom; `tests/qr/verify-scan.test.tsx` mocks
  `window.BarcodeDetector` and feeds it these fixtures to exercise
  `VerifyScan`'s error/recovery states deterministically.
- `malicious.json` — adversarial QR payloads (e.g. non-`https` schemes,
  wrong origin) used to assert the scanner rejects them instead of
  navigating.
- `round-trip.json` — a valid payload used to assert the happy path.

Each feature area under `tests/` that needs fixtures keeps its own
`fixtures/` subdirectory (`tests/contracts/fixtures/`,
`tests/exports/fixtures/`, `tests/security/fixtures/`) rather than
sharing one flat pool — keep that convention: put new fixture JSON next
to the tests that use it, not in the top-level `tests/fixtures/`, unless
it's genuinely shared across more than one of these directories the way
the QR fixtures currently aren't.

## Mocking Freighter for a QR/verification test

`tests/qr/verify-scan.test.tsx` doesn't mock Freighter directly (QR
scanning and verification don't require a wallet), but it's the
reference for mocking browser APIs that don't exist in jsdom the same
way you'd mock Freighter: define the missing global right on `window`
inside `beforeEach`, and restore the original in `afterEach`.

```tsx
function mockDetector(detect: (source: unknown) => Promise<Array<{ rawValue: string }>>) {
  Object.defineProperty(window, "BarcodeDetector", {
    configurable: true,
    writable: true,
    value: class {
      detect = detect;
    },
  });
}
```

For a component that actually calls `@stellar/freighter-api` (i.e.
anything downstream of `CreateProofFlow`'s wallet-connect step), see
["Mocking Freighter (unit-test level)"](../docs/testing-guide.md#mocking-freighter-unit-test-level)
in the main testing guide — the short version is: seed the in-memory
session with `storeSession()` from `@/lib/session` to skip past wallet-connect
UI entirely for tests that only care about what happens *after*
authentication, and reach for the Playwright `freighter` fixture
(`e2e/fixtures/freighter-mock.ts`) for anything that needs to exercise
the actual wallet-connect handshake.

## `components/use-api-data.ts` — reference implementation, not app code

`tests/components/use-api-data.ts` is a standalone example hook
(`useApiData`) demonstrating the correct request-cancellation pattern on
top of `fetchWithTimeout` — it documents itself as "Example hook
demonstrating the correct cancellation pattern" and isn't imported by any
route or component in `app/` or `components/`. Its test,
`use-api-data.test.tsx`, is really testing the pattern (abort on unmount,
abort on dependency change, timeout handling), not a shipped feature. If
you're building a new data-fetching hook, this is the pattern to copy;
don't be surprised that grepping the app for its usage comes up empty.

## Known pre-existing issues in this directory

Flagging these so they aren't mistaken for something a new test change
broke:

- **`tests/api/timeout-retry-cancel.test.ts`** fails to even parse today
  — it contains a genuine syntax error (`new Promise(() {})`, missing the
  `=>`) at several call sites, plus it's written against `vitest`'s API
  (`import { vi } from 'vitest'`) while everything else in this repo runs
  under Jest. Both are pre-existing; a fix needs to correct the syntax
  error(s) and either port the `vi.*` calls to their `jest.*`
  equivalents or move the file to a vitest-run location — worth its own
  follow-up rather than folding into an unrelated change.
- **`tests/components/use-api-data.test.tsx`** has the same `vitest`
  import as above and fails for the same reason.

Run `npm run test -- --runInBand` (what CI runs) locally before opening a
PR to confirm you haven't added to this list.
