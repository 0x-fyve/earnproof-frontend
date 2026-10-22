# Browser Support Policy

This document defines which browsers and devices `earnproof-frontend` is
validated against, and how unsupported environments are handled. It is
tracked separately from [docs/dependency-policy.md](./dependency-policy.md),
which covers how upstream dependency upgrades are evaluated.

`scripts/check-doc-freshness.js` (see [Keeping this current](#keeping-this-current))
fails CI if the version numbers below drift from `package.json` without this
file being updated, so the matrix below cannot go stale silently.

<!-- doc-freshness:start -->
Reviewed against: next 16.3.0, react 19.2.4, @stellar/freighter-api ^6.0.1
Last reviewed: 2026-08-28
<!-- doc-freshness:end -->

## Supported browsers

| Browser | Supported versions | Notes |
| --- | --- | --- |
| Chrome (desktop) | latest 2 stable releases | Primary development and QA target; only browser with `BarcodeDetector` support today (see [QR scanning](#qr-scanning-verifyscan)) |
| Edge (desktop, Chromium) | latest 2 stable releases | Same engine as Chrome; same feature support |
| Firefox (desktop) | latest 2 stable releases (ESR also supported) | No `BarcodeDetector`; QR scan falls back automatically |
| Safari (desktop, macOS) | latest 2 stable releases | No `BarcodeDetector`; QR scan falls back automatically |
| Chrome (Android) | latest stable | Primary mobile target |
| Safari (iOS) | latest 2 stable releases (current and previous major iOS) | `navigator.clipboard.writeText` and `getUserMedia` both require a secure context (HTTPS), which production and preview deployments already provide |

Anything outside this matrix (older browser versions, non-Chromium mobile
browsers, in-app webviews without camera permission plumbing) is
**untested**, not blocked. The app degrades through the feature fallbacks
below rather than refusing to load, except where noted.

## Required feature fallbacks

Every browser-only API in this codebase is feature-detected before use, and
every one of them has a fallback path a supported browser can still
complete the task through:

| Feature | Used for | Detection | Fallback when unavailable |
| --- | --- | --- | --- |
| `navigator.clipboard.writeText` | Copying exported credentials/verification links ([lib/credentials/export.ts](../lib/credentials/export.ts)) | `!navigator.clipboard?.writeText` | Copy action reports failure instead of throwing; the exported value remains selectable/downloadable through the rest of the export UI |
| `navigator.sendBeacon` | Best-effort web-vitals reporting ([lib/diagnostics/web-vitals-sink.ts](../lib/diagnostics/web-vitals-sink.ts)) | `typeof navigator === "undefined" \|\| !navigator.sendBeacon` | Reporting is silently skipped — this is telemetry, not a user-facing flow, so there is no user-visible fallback state |
| `navigator.mediaDevices.getUserMedia` | Camera access for QR scanning ([components/verification/verify-scan.tsx](../components/verification/verify-scan.tsx)) | `!navigator.mediaDevices?.getUserMedia` | User sees "Camera scanning is not available in this browser. Upload an image or enter the proof ID." and can complete verification through the upload or manual-entry path on the same page |
| `window.BarcodeDetector` | Live QR decoding once the camera stream is open | `!window.BarcodeDetector` | Same accessible fallback message and upload/manual-entry path as above |
| `BroadcastChannel` | Cross-tab logout/revocation/tenant sync ([lib/storage/tab-sync-transport.ts](../lib/storage/tab-sync-transport.ts)) | `typeof window.BroadcastChannel !== "function"` or the constructor throws | `storage` events on the `earnproof.tab-sync.v1` key; if storage is also unavailable, sync is off and each tab still enforces auth with the server on its own |

### QR scanning (`/verify/scan`)

`BarcodeDetector` is currently Chromium-only. Firefox and Safari users are
expected to hit the fallback message on every visit until those engines add
support — this is a known, accepted gap, not a bug, and is exercised by
[e2e/accessibility/scans.spec.ts](../e2e/accessibility/scans.spec.ts) and the
accessibility suite so the fallback stays screen-reader-usable. Do not "fix"
this by adding a polyfill without discussing the trust model first — a
JS-based barcode decoder polyfill changes the code path a security reviewer
would need to audit for a flow that scans wallet-adjacent proof data.

## Unsupported-environment messaging

There is currently no dedicated global "unsupported browser" banner. An
unsupported browser is expected to run the app normally except where it
hits one of the feature gates above, each of which renders an explicit,
accessible, non-blocking message rather than failing silently or throwing.
If a future change adds a global compatibility gate, it must follow the
same rule: state what is unavailable and what the user can do instead,
never a bare "unsupported browser" dead end.

## Validation

- Automated: [e2e/accessibility](../e2e/accessibility) and
  [e2e/visual](../e2e/visual) run against Chromium projects in CI (see
  [.github/workflows/ci.yml](../.github/workflows/ci.yml)) and are the
  primary automated signal for this matrix.
- Manual: if `docs/release-runbook.md` exists in this repository (tracked
  separately — see issue #83), its pre-release checklist should require a
  Freighter wallet smoke test in a Chromium-based browser before every
  release, deferring to this document for the full matrix.
- Manual verification (no current automated cross-browser suite): the
  Firefox/Safari fallback paths above should be spot-checked on a real
  device or BrowserStack-equivalent before a release that touches
  `verify-scan.tsx`, `export.ts`, or `web-vitals-sink.ts`.

## Keeping this current

Run:

```bash
node scripts/check-doc-freshness.js
```

This compares the `next`, `react`, and `@stellar/freighter-api` versions
recorded in the `doc-freshness` block above (and in
[docs/dependency-policy.md](./dependency-policy.md)) against the versions
actually pinned in [package.json](../package.json). It fails if they no
longer match, which is the signal that this matrix needs a human review
before merging the dependency bump — see
[docs/dependency-policy.md](./dependency-policy.md) for when that's
required. CI runs this as part of the `frontend` job.
