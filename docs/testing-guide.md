# Testing guide

This guide covers how tests are organized in this repo, how to run each
kind, and how to write a new one that follows the patterns already in use.
It's aimed at anyone adding a component, a page, or a flow and needing to
know "what test do I write, and what does it look like here."

For the automated accessibility gate specifically (axe rules, keyboard
tests, what's scanned, what still needs a manual screen-reader pass), see
[`docs/accessibility-testing.md`](./accessibility-testing.md) — this guide
covers accessibility testing mechanics (how to write an a11y test) while
that one covers accessibility testing *coverage* (what's scanned and why).

## The three layers

| Layer | Tool | Where | Run with |
| --- | --- | --- | --- |
| Component tests | Jest + React Testing Library | co-located `__tests__/` next to the component, or `*.test.tsx` beside it | `npm run test` |
| End-to-end / integration | Playwright | `e2e/` | `npm run test:e2e` |
| Accessibility (axe + keyboard) | Playwright + `@axe-core/playwright` | `e2e/accessibility/` | `npm run test:e2e:a11y` |

There's also a visual regression suite (`npm run test:e2e:visual`, under
`e2e/visual/`) and an API contract check (`npm run test:contracts`,
comparing generated types against the backend's OpenAPI spec) — both exist
today but aren't covered in depth here since they're not something you
typically hand-write a new test for; see their existing specs for the
pattern if you need to add a route to either.

## Component tests (Jest + React Testing Library)

### Where they live

Two conventions are both in active use in this repo — match whichever your
target file already uses, or use `__tests__/` for new component
directories:

- `components/<area>/__tests__/<name>.test.tsx` — e.g.
  `components/common/__tests__/confirmation-dialog.test.tsx`,
  `components/proofs/__tests__/wizard-steps.test.tsx`.
- `app/<route>/page.test.tsx` next to the page it tests — e.g.
  `app/status/page.test.tsx`, `app/proof-types/__tests__/page.test.tsx`
  (the `app/` tree has both conventions in different routes).
- A top-level `tests/` directory for suites that don't map 1:1 to a single
  component: `tests/api/`, `tests/components/`, `tests/contracts/`,
  `tests/exports/`, `tests/qr/`, each with fixtures in `tests/fixtures/`.

### Running them

```bash
npm run test                    # run once
npm run test -- --watch         # watch mode
npm run test -- path/to/file    # a single file or glob
npm run test -- --runInBand     # what CI actually runs
```

Config lives in `jest.config.mjs` (built on `next/jest`, `testEnvironment:
"jsdom"`, `@/` path alias) and `jest.setup.ts` (imports
`@testing-library/jest-dom` matchers, and polyfills `TextEncoder`/
`TextDecoder` — jsdom doesn't provide them, and anything that imports
`lib/validation/qr-payload.ts`, directly or transitively, needs them for
byte-length checks on proof IDs).

### Anatomy of a component test

Every test file in this repo starts with the jsdom environment pragma,
even though the global config already sets `testEnvironment: "jsdom"` —
keep doing this for consistency with the rest of the suite:

```tsx
/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { MyComponent } from "../my-component";

describe("MyComponent", () => {
  it("renders with basic props", () => {
    render(<MyComponent title="Test" />);
    expect(screen.getByText("Test")).toBeInTheDocument();
  });
});
```

Real example worth reading end to end for the house style:
`components/common/__tests__/confirmation-dialog.test.tsx`. It covers
rendering with default/custom props, variant styling
(`toHaveClass("bg-rose-600")`), initial focus management
(`toHaveFocus()`), click handlers, an Escape-key handler, a disabled/
processing state, and ARIA attributes (`aria-modal`, `aria-labelledby`,
`aria-describedby`) — that spread is a good checklist for any interactive
component: happy path, variants, keyboard, disabled state, ARIA.

### Mocking `apiClient`

Components that call the backend go through `lib/api/client.ts`'s
`apiClient()`. Mock the module, not `fetch` — it's simpler and keeps the
test decoupled from `apiClient`'s retry/timeout internals:

```tsx
import { apiClient } from "@/lib/api/client";

jest.mock("@/lib/api/client", () => ({
  apiClient: jest.fn(),
  bearer: (token: string) => ({ Authorization: `Bearer ${token}` }),
}));

const mockedApiClient = apiClient as jest.MockedFunction<typeof apiClient>;

beforeEach(() => {
  mockedApiClient.mockReset();
});

it("shows a loading state while the request is in flight", async () => {
  let resolve!: (value: MyResponse) => void;
  mockedApiClient.mockReturnValue(new Promise((r) => { resolve = r; }));

  render(<MyComponent />);
  // ...trigger the request...

  expect(await screen.findByRole("status")).toBeInTheDocument();

  resolve(myFixtureResponse);
  await waitFor(() => {
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
```

See `components/verification/__tests__/verify-proof-form.test.tsx` and
`components/proofs/__tests__/create-proof-flow.test.tsx` for full working
examples of this pattern, including asserting on which specific
`apiClient` path was called when a component hits more than one endpoint
(match on `options.path` inside `mockImplementation`).

For a page that reads `window.fetch` directly instead of going through
`apiClient` (the health-check hook, `lib/health-check.ts`, is the one
current example), mock `global.fetch` instead — see
`app/status/page.test.tsx` for the full pattern, including faking timers
to test the poll interval and the abort-on-timeout path.

### Mocking Freighter (unit-test level)

Most components never touch `@stellar/freighter-api` directly — they call
through `CreateProofFlow`'s internal `getFreighterAddress()` /
`signFreighterMessage()` helpers, which dynamically `import()` the
package on demand. For a unit test that needs an authenticated session
without exercising the wallet-connect UI at all, skip Freighter
entirely and seed the in-memory session with `storeSession` from
`@/lib/session` (the session is never in `localStorage`; `jest.setup.ts`
resets it between tests):

```tsx
import { storeSession, clearStoredSession } from "@/lib/session";

beforeEach(() => {
  storeSession({
    token: "test-token",
    user: { id: "user-1", walletAddress: "GABC...TEST", walletHash: "wh_test", role: "WORKER" },
  });
});

afterEach(() => {
  clearStoredSession();
});
```

See `components/proofs/__tests__/create-proof-flow.test.tsx` for this in
context. If you specifically need to unit-test the wallet-connect flow
itself (not just code that runs after a session exists), you'd need to
mock the `@stellar/freighter-api` module the same way the e2e suite mocks
the extension's `postMessage` protocol (see the next section) — there's
no existing unit-test example of that in the repo today, so reach for the
Playwright fixtures below instead for anything that actually exercises
wallet connect end to end.

### React error boundaries

`ProofErrorBoundary` and `VerifyErrorBoundary`
(`components/common/proof-error-boundary.tsx`,
`components/common/verify-error-boundary.tsx`) are tested by rendering a
child that conditionally throws:

```tsx
function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("boom");
  return <div>Content</div>;
}

it("catches a thrown error and renders the fallback instead of crashing", () => {
  render(
    <ProofErrorBoundary>
      <Bomb shouldThrow={true} />
    </ProofErrorBoundary>,
  );
  expect(screen.getByText("Proof creation hit a problem")).toBeInTheDocument();
});
```

React logs caught errors to `console.error` itself (dev-mode noise, not
a real test failure) — silence it with a `beforeAll`/`afterAll` pair around
the whole suite, then use `jest.spyOn(console, "error")` inside the one
test that actually asserts on the boundary's own log call. See
`components/common/__tests__/proof-error-boundary.test.tsx` for the full
pattern, including asserting `role="alert"` / `aria-live="assertive"`,
that focus moves to the error heading (flush a microtask first — the
boundaries set focus from `componentDidCatch`, not `componentDidUpdate`,
so it lands one microtask after the fallback commits: `await
Promise.resolve();` before asserting `toHaveFocus()`), and that clicking
"Try again" re-renders children once the underlying error condition is
gone.

## End-to-end tests (Playwright)

### Where they live

- `e2e/*.spec.ts` — top-level flows: `wallet-auth.spec.ts`,
  `proof-creation.spec.ts`, `public-verification.spec.ts`.
- `e2e/fixtures/` — shared building blocks (below).
- `e2e/accessibility/` — the axe + keyboard suite, see
  [`docs/accessibility-testing.md`](./accessibility-testing.md).
- `e2e/visual/` — screenshot regression, its own config
  (`playwright.visual.config.ts` if present, or documented in
  `e2e/visual/README.md`).

### Running them

```bash
npm run test:e2e              # full e2e suite (e2e/*.spec.ts)
npm run test:e2e:a11y         # accessibility suite (e2e/accessibility/)
npm run test:e2e:visual       # visual regression (e2e/visual/)
npm run test:e2e:visual:update  # regenerate visual baselines
```

`playwright.config.ts` builds the app and runs `next start` against it
(not `next dev`) specifically so Fast Refresh/Turbopack recompilation
never remounts a component mid-test — see the comment in that file if a
spec is flaking around a click that "should" have landed.
`NEXT_PUBLIC_API_URL` points at an intentionally-unreachable synthetic
loopback address; every request to it is intercepted by the `ApiMock`
fixture, so no spec ever depends on a live backend.

### The fixture system (`e2e/fixtures/`)

`e2e/fixtures/test.ts` extends Playwright's base `test` with two fixtures
every worker-flow spec needs — import from there, not from
`@playwright/test` directly, for any spec that needs either:

```ts
import { test, expect } from "./fixtures/test";

test("does the thing", async ({ page, freighter }) => {
  await freighter(); // installs the Freighter mock for this test
  // apiMock is auto-installed for every test (`auto: true`), so
  // /auth/challenge, /payments, etc. are already intercepted here.
});
```

- **`apiMock`** (`e2e/fixtures/api-mock.ts`) — a stateful in-memory double
  of the EarnProof backend, installed via `page.route()`. It answers
  `/auth/challenge`, `/auth/verify`, `/payments/sync`, `GET /payments`,
  `PATCH /payments/:id/classification`, `POST /proofs/minimum-income`, and
  `GET /proofs/:id/verify` from synthetic fixture data
  (`e2e/fixtures/synthetic-data.ts`), tracks `authRequests`/
  `verifyRequests` for specs that want to assert on what was called, and
  lets a spec swap the verify outcome mid-test via `setVerifyOutcome()`
  (`"valid" | "expired" | "revoked" | "invalid"` etc., matching
  `SYNTHETIC_VERIFY_RESPONSES`). Any request that doesn't match a known
  route/method 404s with an explicit "unmocked route" body instead of
  hanging — if a spec times out waiting on a network response, check here
  first for a route this fixture doesn't yet handle.
- **`freighter`** (`e2e/fixtures/freighter-mock.ts`, wired through the
  `freighter` fixture in `test.ts`) — answers the Freighter extension's
  `window.postMessage` protocol (`FREIGHTER_EXTERNAL_MSG_REQUEST` /
  `FREIGHTER_EXTERNAL_MSG_RESPONSE`, matched by `messageId`) the way a real
  unlocked wallet would, since no real extension is installed in the test
  browser. Call it with no args for the happy path (a fixed synthetic
  testnet address + a static, non-cryptographic "signature" string), or
  `{ denyAccess: true }` to simulate the user rejecting the connection —
  see `e2e/wallet-auth.spec.ts` for that case.
- **`e2e/accessibility/fixtures/`** has its own, near-identical
  `mock-freighter.ts` / `mock-api.ts` pair rather than sharing the ones
  above — the accessibility suite predates/parallels the main e2e fixture
  set. If you're adding a route to one API mock and it also needs
  scanning for accessibility, check whether it needs adding to both.

### Page objects and shared flows

`e2e/fixtures/pages.ts` wraps each page's locators behind a small class
(e.g. `ProofCreationPage`, exposing `.connectButton`, `.syncButton`,
`.paymentCheckbox(index)`, `.createProofButton`, etc.) so specs read as
actions/assertions, not raw selectors. `e2e/fixtures/flows.ts` layers
multi-step sequences on top — `connectAndAuthenticate(page)` navigates to
proof creation and completes the wallet-connect handshake, since nearly
every proof-creation spec needs an authenticated session as its starting
point:

```ts
import { test, expect } from "./fixtures/test";
import { connectAndAuthenticate } from "./fixtures/flows";

test("syncs payments and only allows selecting eligible income rows", async ({ page, freighter }) => {
  await freighter();
  const proofPage = await connectAndAuthenticate(page);

  await proofPage.syncButton.click();
  await expect(page.getByText("Payments synced.")).toBeVisible();
});
```

See `e2e/proof-creation.spec.ts` in full for more of this pattern,
including a documented workaround for a real (pre-existing, flagged)
responsive-layout bug — worth reading as an example of how to handle a
spec that surfaces an app bug you're not there to fix: comment the root
cause precisely, use the minimal workaround (`{ force: true }`) needed to
still exercise the intended behavior, and link the follow-up rather than
silently masking it.

### Accessibility tests specifically

Covered in depth in
[`docs/accessibility-testing.md`](./accessibility-testing.md): the axe
rule set, which routes are scanned (`e2e/accessibility/routes.ts` — add a
route there to have `scans.spec.ts` pick it up automatically), the
dynamic-states suite that scans loading/error/success states beyond the
initial HTML, and the keyboard-interaction suite that drives real
`page.keyboard` automation for things axe can't verify (tab order, skip
links, focus restoration). That doc also lists what still needs a manual
screen-reader pass and isn't (and can't be) automated.

The short version for writing a *new* a11y test: use `runAxeScan(page,
testInfo, { routeName })` from `e2e/accessibility/fixtures/axe.ts` — it
scans WCAG 2.0/2.1 A+AA rules, attaches the full JSON report to the test
run, and throws a formatted error naming the route, rule ID, and affected
DOM nodes for any `critical`/`serious` violation (minor/moderate
violations are recorded but don't fail the test, so the gate stays
actionable).

## Fixtures and synthetic data

- **E2e/Playwright**: `e2e/fixtures/synthetic-data.ts` is the single
  source of truth for worker addresses, payment records, proof IDs,
  credential hashes, and verify-response bodies used across the whole e2e
  suite — reuse constants from there (`SYNTHETIC_WORKER_ADDRESS`,
  `SYNTHETIC_PROOF_ID`, `SYNTHETIC_CREDENTIAL_HASH`, etc.) rather than
  hardcoding new magic strings in a spec, so a spec's assertions stay
  traceable to what the mock actually returned.
- **Jest/unit**: fixtures live under `tests/fixtures/` as plain JSON,
  imported directly — e.g. `tests/fixtures/qr/image-states.json` models
  synthetic `BarcodeDetector` outcomes (blurred/rotated/multiple-codes/
  oversized) since raster QR decoding isn't available under jsdom; see
  `tests/qr/verify-scan.test.tsx` for how it's consumed
  (`import imageStates from "@/tests/fixtures/qr/image-states.json"`).
  Add new fixture JSON here rather than inlining large literal objects in
  a test file when more than one test (or one future test) will want the
  same shape.
- Every fixture in both systems is explicitly synthetic — no real wallet
  keys, signatures, or backend data. Comments in `synthetic-data.ts` and
  the mock modules call this out; keep that invariant when adding new
  fixtures.

## Writing a new test — quick checklist

1. **Component test?** Put it in `__tests__/` next to the component (or
   `<name>.test.tsx` beside it, matching the existing sibling files in
   that directory). Start with the `@jest-environment jsdom` pragma.
   Mock `apiClient` (not `fetch`) unless the component reads `fetch`
   directly. If it renders an async/loading state, assert the loading UI
   appears before resolving the mock and disappears after.
2. **New page or multi-step flow?** Add a Playwright spec under `e2e/`.
   Reuse `e2e/fixtures/test.ts`'s `apiMock`/`freighter` fixtures rather
   than writing new `page.route()` calls inline. If the flow needs an
   authenticated session, reuse or extend `connectAndAuthenticate` in
   `e2e/fixtures/flows.ts`.
3. **New route?** Add it to `e2e/accessibility/routes.ts` so it's covered
   by the automated axe scan with zero extra harness work. If it has a
   meaningful loading/error/success state beyond the initial HTML,
   consider adding it to `e2e/accessibility/dynamic-states.spec.ts` too.
4. **New interactive component (dialog, form, disclosure)?** Cover: happy
   path render, every documented prop/variant, keyboard interaction if
   applicable (Enter/Space/Escape), a disabled/loading state if it has
   one, and its ARIA attributes (role, aria-live, aria-busy,
   aria-describedby, etc. — whatever the component actually sets).
5. **New error boundary or fallback UI?** Follow
   `proof-error-boundary.test.tsx`'s pattern: a component that
   conditionally throws, assert the fallback replaces the crashed
   subtree, assert the error is logged without propagating, assert
   `role="alert"`/`aria-live`, assert focus moves into the fallback, and
   assert retry actually recovers once the underlying condition clears.
6. Run `npm run lint` and `npm run test -- <your file>` before opening a
   PR. If you touched anything under `e2e/`, also run the relevant
   `npm run test:e2e*` script locally — CI will run it, but Playwright
   failures are much faster to debug locally with `--headed` or the
   trace viewer than from a CI artifact.

## Known gaps (call these out if you're picking one up)

- No current unit-test example mocks `@stellar/freighter-api` directly at
  the module level (only the e2e suite mocks the extension's
  `postMessage` protocol) — see "Mocking Freighter (unit-test level)"
  above.
- `e2e/accessibility/fixtures/` duplicates `e2e/fixtures/`'s Freighter
  and API mocks rather than sharing them; consolidating is a reasonable
  follow-up but out of scope here since it'd touch both suites' fixture
  wiring at once.
- `.github/workflows/ci.yml` has a YAML key collision worth knowing about
  if a job here seems to "not run": the `accessibility:` job key is
  immediately overwritten by the `visual-regression:` key right below it,
  so the accessibility job never runs as its own CI job today — its steps
  only execute merged into the `visual-regression` job (which is why that
  job's steps start with "Run accessibility scans" before getting to
  visual regression). `npm run test:e2e:a11y` still works correctly when
  run directly (locally or from another job); only the standalone
  `accessibility` CI job entry is affected. Worth a dedicated fix; flagged
  here so it isn't mistaken for intended behavior while reading the
  workflow file.
