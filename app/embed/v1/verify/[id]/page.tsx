import type { Metadata } from "next";
import { VerificationWidgetGate } from "@/components/verification/embed/verification-widget-gate";
import { isApprovedProofId } from "@/lib/validation/qr-payload";

export const metadata: Metadata = {
  title: "EarnProof verification widget",
  // Embedded on third-party ("relying party") pages by design — this route
  // itself should never show up as a standalone search result.
  robots: { index: false, follow: false },
};

// #332: explicitly public, same as the rest of /verify — embedding on a
// relying-party page by design is exactly why it must stay reachable
// without authentication. Declared here instead of inherited so the
// embed exception stays visible and auditable at this exact route rather
// than relying on the app-root default.
export const routeAuth = {
  access: "public",
  role: null,
  capability: null,
  cache: "no-store",
};

// This is the one route family that carries the narrowly-scoped
// `frame-ancestors *` CSP exception (see `config/security-headers.ts`'s
// `allowEmbedding` option and `proxy.ts`). Every other route in this app
// keeps `frame-ancestors 'none'` / `X-Frame-Options: DENY` exactly as
// before — see tests/security/headers.test.ts and
// tests/security/proxy.test.ts.
//
// Same dynamic-rendering requirement as the rest of the app (see
// app/layout.tsx) — the widget always reflects a live verification check,
// never a stale cached one.
export const dynamic = "force-dynamic";

function InvalidIdShell() {
  return (
    <div
      className="grid min-h-[120px] w-full max-w-[420px] gap-1 rounded-lg border border-white/10 bg-slate-950 p-4 text-white"
      role="alert"
    >
      <p className="text-sm font-semibold text-rose-200">Invalid verification link</p>
      <p className="text-xs leading-5 text-slate-400">
        This embedded widget was not given a recognizable proof identifier.
      </p>
    </div>
  );
}

/**
 * The embeddable public proof-verification widget entry point (issue
 * #196). Deliberately minimal: no `PublicShell` nav/header chrome (that
 * component links to internal EarnProof routes that make no sense inside
 * a small third-party-embedded iframe), just the widget itself on a plain
 * dark background sized to fit a compact iframe.
 *
 * `params.id` is the ONLY input this route accepts from its embedding
 * context — see `lib/api/verification-widget.ts` and
 * `components/verification/embed/verification-widget.tsx` for the full
 * trust-boundary contract (no bearer credentials, no private credential
 * JSON, no postMessage listener, id validated against the same allow-list
 * used for QR/URL proof-id input elsewhere in this app).
 */
export default function EmbedVerifyPage({ params }: { params: { id: string } }) {
  const proofId = params.id?.trim() ?? "";

  return (
    <div className="flex min-h-screen items-start justify-center bg-slate-950 p-3 sm:p-4">
      <main aria-label="EarnProof proof verification" id="main-content">
        {isApprovedProofId(proofId) ? (
          <VerificationWidgetGate proofId={proofId} />
        ) : (
          <InvalidIdShell />
        )}
      </main>
    </div>
  );
}
