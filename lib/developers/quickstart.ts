/**
 * Developer integration quickstart logic (#232).
 *
 * Pure, side-effect-free helpers that back the guided quickstart workspace:
 * code example generation for the currently supported runtimes, synthetic
 * (non-secret) verification requests, and checklist progress tracking.
 *
 * Hard privacy/security rule enforced throughout this module: a real API
 * secret is never accepted as an argument that gets embedded in a URL,
 * logged, or returned as part of persisted checklist state. Callers pass a
 * placeholder token (see `SECRET_PLACEHOLDER`) into the generated examples;
 * the real secret is only ever handled transiently by
 * components/developers/one-time-secret.tsx, which already keeps it out of
 * storage and clears it from the DOM on unmount.
 */

import { AVAILABLE_SCOPES, type ApiKeyScope } from "@/lib/api/keys";
import { CLIENT_CONTRACTS } from "@/lib/api/client-contracts";
import openapiSpec from "@/lib/api/openapi/earnproof-api.v1.json";

/** Runtimes the quickstart can generate a verification request for. */
export const SUPPORTED_RUNTIMES = ["curl", "node", "python"] as const;
export type QuickstartRuntime = (typeof SUPPORTED_RUNTIMES)[number];

/**
 * Never a real secret. Every generated example embeds this literal string
 * instead of an actual API key value, so copy-pasting an example can never
 * leak a credential even if a user pastes it somewhere public.
 */
export const SECRET_PLACEHOLDER = "YOUR_API_SECRET";

/** The ordered steps that make up the guided quickstart checklist. */
export const QUICKSTART_STEPS = [
  "select-scopes",
  "create-key",
  "save-secret",
  "test-request",
] as const;
export type QuickstartStep = (typeof QUICKSTART_STEPS)[number];

export interface QuickstartChecklistState {
  completedSteps: QuickstartStep[];
  updatedAt: string;
}

/** The active API contract version, read from the OpenAPI fixture's own info block. */
export function getActiveApiVersion(): string {
  return (openapiSpec as { info?: { version?: string } }).info?.version ?? "unknown";
}

/**
 * The verification route contract, derived from the hand-authored client
 * contracts rather than hard-coded, so an example never drifts from what
 * lib/api/verify-proof.ts actually calls.
 */
export function getVerificationRoute(): string {
  // Matches the GET /proofs/{id}/verify contract specifically (not the
  // unrelated POST /auth/verify route, which also contains "/verify").
  for (const contract of CLIENT_CONTRACTS) {
    const route = contract.routes.find((r) => r.startsWith("GET") && r.includes("/proofs/{id}/verify"));
    if (route) {
      return route.split(" ")[1];
    }
  }
  // Fall back to the known literal route if the contract fixture ever
  // drops this entry, so quickstart generation never throws.
  return "/proofs/{id}/verify";
}

function scopeIsKnown(scope: string): scope is ApiKeyScope {
  return (AVAILABLE_SCOPES as readonly string[]).includes(scope);
}

/**
 * Validate a set of scope selections against the live scope catalog.
 * Returns an empty array when every scope is recognized; otherwise returns
 * the unrecognized entries so the caller can block progression (an
 * unrecognized scope must never silently appear "selected").
 */
export function unknownScopes(scopes: string[]): string[] {
  return scopes.filter((scope) => !scopeIsKnown(scope));
}

export interface GenerateExampleOptions {
  runtime: QuickstartRuntime;
  organizationId: string | null;
  apiBaseUrl: string;
  proofId?: string;
}

/**
 * Generate a redacted, synthetic test-request code example for the given
 * runtime. The request always targets a clearly fake proof id
 * ("SYNTHETIC-TEST-PROOF") unless the caller supplies a real one, and the
 * secret is always the placeholder - never a real value - so copying the
 * example is always safe. Every example is labeled as synthetic in a
 * leading comment, satisfying the "test requests are visibly marked as
 * synthetic" acceptance criterion.
 */
export function generateVerificationExample({
  runtime,
  organizationId,
  apiBaseUrl,
  proofId = "SYNTHETIC-TEST-PROOF",
}: GenerateExampleOptions): string {
  const route = getVerificationRoute().replace("{id}", encodeURIComponent(proofId));
  const url = `${apiBaseUrl}${route}`;
  const orgHeaderLine = organizationId
    ? `  -H "X-Organization-Id: ${organizationId}" \\\n`
    : "";
  const orgHeaderNode = organizationId
    ? `    "X-Organization-Id": "${organizationId}",\n`
    : "";
  const orgHeaderPython = organizationId
    ? `    "X-Organization-Id": "${organizationId}",\n`
    : "";

  switch (runtime) {
    case "curl":
      return [
        "# SYNTHETIC test request - safe to run against a sandbox key.",
        `# API contract version: ${getActiveApiVersion()}`,
        `curl -X GET "${url}" \\`,
        `  -H "Authorization: Bearer ${SECRET_PLACEHOLDER}" \\`,
        `${orgHeaderLine}  -H "Content-Type: application/json"`,
      ]
        .filter(Boolean)
        .join("\n");

    case "node":
      return [
        "// SYNTHETIC test request - safe to run against a sandbox key.",
        `// API contract version: ${getActiveApiVersion()}`,
        `const response = await fetch("${url}", {`,
        "  method: \"GET\",",
        "  headers: {",
        `    Authorization: "Bearer ${SECRET_PLACEHOLDER}",`,
        orgHeaderNode.trimEnd(),
        '    "Content-Type": "application/json",',
        "  },",
        "});",
        "const result = await response.json();",
      ]
        .filter((line) => line.length > 0)
        .join("\n");

    case "python":
      return [
        "# SYNTHETIC test request - safe to run against a sandbox key.",
        `# API contract version: ${getActiveApiVersion()}`,
        "import requests",
        "",
        `response = requests.get(`,
        `    "${url}",`,
        "    headers={",
        `        "Authorization": "Bearer ${SECRET_PLACEHOLDER}",`,
        orgHeaderPython.trimEnd(),
        '        "Content-Type": "application/json",',
        "    },",
        ")",
      ]
        .filter((line) => line.length > 0)
        .join("\n");

    default: {
      const exhaustive: never = runtime;
      throw new Error(`Unsupported runtime: ${exhaustive}`);
    }
  }
}

/**
 * Validate that no generated example leaked a real secret into a URL.
 * Used defensively by callers (and by tests) to assert the placeholder
 * contract holds; a real caller should never be able to pass a secret into
 * `generateVerificationExample` in the first place since it has no
 * parameter for one, but this guards against future refactors that might
 * accidentally add one.
 */
export function exampleContainsNoSecretInUrl(example: string): boolean {
  const urlLines = example.split("\n").filter((line) => line.includes("http"));
  return urlLines.every((line) => !line.includes(SECRET_PLACEHOLDER));
}

/**
 * Toggle a step's completion in an existing checklist state, returning a
 * new state object. Steps must be completed in order; attempting to
 * complete a step out of order is a no-op (returns the state unchanged)
 * so the checklist can't show false progress.
 */
export function markStepComplete(
  state: QuickstartChecklistState,
  step: QuickstartStep,
): QuickstartChecklistState {
  if (state.completedSteps.includes(step)) {
    return state;
  }

  const stepIndex = QUICKSTART_STEPS.indexOf(step);
  const allPriorComplete = QUICKSTART_STEPS.slice(0, stepIndex).every((prior) =>
    state.completedSteps.includes(prior),
  );

  if (!allPriorComplete) {
    return state;
  }

  return {
    completedSteps: [...state.completedSteps, step],
    updatedAt: new Date().toISOString(),
  };
}

export function createEmptyChecklistState(): QuickstartChecklistState {
  return { completedSteps: [], updatedAt: new Date().toISOString() };
}

export function isChecklistComplete(state: QuickstartChecklistState): boolean {
  return QUICKSTART_STEPS.every((step) => state.completedSteps.includes(step));
}

/**
 * Classify a failed verification test request into the quickstart's
 * diagnostic categories, matching this issue's required test coverage:
 * missing scope, expired key, version mismatch, and a generic failure.
 * This is pure classification logic over an already-normalized API error
 * shape (see lib/errors/types.ts's ApiError, which exposes `status` - an
 * HTTP status code, not a provider-specific error code) - it does not make
 * network calls itself.
 */
export type QuickstartVerificationOutcome =
  | "success"
  | "missing-scope"
  | "expired-key"
  | "version-mismatch"
  | "unknown-error";

export function classifyVerificationOutcome(error: { status: number } | null): QuickstartVerificationOutcome {
  if (!error) {
    return "success";
  }

  switch (error.status) {
    case 403:
      return "missing-scope";
    case 401:
      return "expired-key";
    case 409:
      return "version-mismatch";
    default:
      return "unknown-error";
  }
}
