/**
 * Capability gating — UX layer only, never a security boundary.
 * =================================================================
 *
 * This module lets routes/actions show or hide themselves based on a
 * "capability document" the client holds. It exists purely to avoid
 * showing controls for backend functionality that isn't available yet
 * (a route behind a partial rollout, a network the API doesn't support,
 * an API version the deployed frontend has outdated assumptions about).
 *
 * IMPORTANT — read before using `useCapability`/`isCapabilityEnabled`
 * anywhere:
 *
 * 1. This is NOT an authorization system. The backend is the only thing
 *    that may decide whether a request is actually allowed to succeed.
 *    Every mutation and every read of sensitive data MUST still be
 *    enforced server-side, exactly as if this module did not exist.
 * 2. Treat every value here as attacker-controlled UX hint, not fact. A
 *    user can trivially edit the cached document in devtools, disable
 *    JS execution of the fail-closed check, or hand-craft a request that
 *    never goes through gated UI at all. None of that should grant them
 *    anything the server wouldn't otherwise allow.
 * 3. Do not use this module to decide whether to render sensitive data
 *    that was already fetched — only whether to *offer* the action that
 *    would fetch/submit it. The server response (or its absence) is the
 *    actual gate.
 * 4. This client-side mock provider (`fetchMockCapabilityDocument`) is a
 *    stand-in for a future server endpoint. The real EarnProof API
 *    (`lib/api/openapi/earnproof-api.v1.json`) does not expose a
 *    capability document today — nothing here talks to a real backend
 *    path. When/if a real endpoint ships, only the fetcher needs to
 *    change; the gating contract (fail closed, cache invalidation,
 *    "never a security boundary") must not.
 *
 * Fail-closed contract: any capability key not present (or not `true`)
 * in the resolved document is treated as disabled. A stale, missing, or
 * malformed document also resolves to "no capabilities enabled" rather
 * than throwing — callers should never crash because this module 404s.
 */

import { appConfig } from "@/config/app";
import { API_SPEC_VERSION } from "@/lib/api/generated/v1";

/**
 * Capability keys the frontend currently knows how to gate on. Adding a
 * new gated route/action means adding its key here first — the type
 * system then forces every call site to handle the "capability missing"
 * case explicitly instead of assuming a feature is on.
 */
export const CAPABILITY_KEYS = [
  "activity-log",
  "embeddable-verification-widget",
  "recurring-income-proofs",
  "payment-receipt-proofs",
  "organization-management",
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export type CapabilityState = {
  /** Fully rolled out and safe to offer to every user. */
  enabled: boolean;
  /**
   * Optional rollout note surfaced in the unavailable state (e.g. "Rolling
   * out to a subset of organizations"). Never used to bypass `enabled`.
   */
  note?: string;
};

/**
 * A versioned capability document, as (eventually) served by the backend.
 * `apiVersion` is the API contract version the document was computed
 * against — the frontend fails closed if it can't parse that version or
 * if it is incompatible with `API_SPEC_VERSION`.
 */
export type CapabilityDocument = {
  documentVersion: number;
  apiVersion: string;
  network: string;
  generatedAt: string;
  capabilities: Partial<Record<CapabilityKey, CapabilityState>>;
};

export const CAPABILITY_DOCUMENT_SHAPE_VERSION = 1;

/**
 * "Deployment identity" for cache-invalidation purposes: the combination
 * of values that, if any of them changes, means a cached capability
 * document can no longer be trusted. Built entirely from state this
 * codebase already tracks (`config/app.ts`, the generated API spec
 * version) — no new source of truth is introduced.
 */
export type DeploymentIdentity = {
  apiUrl: string;
  stellarNetwork: string;
  apiSpecVersion: string;
};

export function currentDeploymentIdentity(): DeploymentIdentity {
  return {
    apiUrl: appConfig.apiUrl,
    stellarNetwork: appConfig.stellarNetwork,
    apiSpecVersion: API_SPEC_VERSION,
  };
}

function identityKey(identity: DeploymentIdentity): string {
  return [identity.apiUrl, identity.stellarNetwork, identity.apiSpecVersion].join("|");
}

export function deploymentIdentityChanged(
  a: DeploymentIdentity,
  b: DeploymentIdentity,
): boolean {
  return identityKey(a) !== identityKey(b);
}

/**
 * A minimal semver-ish major.minor.patch compatibility check: the
 * document is considered incompatible if its major version differs from
 * the frontend's known API spec major version. This mirrors how
 * `API_SPEC_VERSION` (from the generated client) is already versioned —
 * see `lib/api/generated/v1.ts`.
 */
export function isApiVersionCompatible(documentApiVersion: string, knownApiVersion: string): boolean {
  const documentMajor = documentApiVersion.split(".")[0];
  const knownMajor = knownApiVersion.split(".")[0];

  if (!documentMajor || !knownMajor) {
    return false;
  }

  return documentMajor === knownMajor;
}

/**
 * Fail-closed lookup: returns `false` for any key absent from the
 * document, any document that is `null`/`undefined`, or any document
 * whose shape/API version this frontend doesn't recognize.
 */
export function isCapabilityEnabled(
  document: CapabilityDocument | null | undefined,
  key: CapabilityKey,
): boolean {
  if (!document) {
    return false;
  }

  if (document.documentVersion !== CAPABILITY_DOCUMENT_SHAPE_VERSION) {
    return false;
  }

  if (!isApiVersionCompatible(document.apiVersion, API_SPEC_VERSION)) {
    return false;
  }

  return document.capabilities[key]?.enabled === true;
}

/**
 * Local mock/stub capability provider.
 * =====================================
 * This is a fixture, not a network call to a real backend path — there is
 * no `/capabilities` (or similar) route in `earnproof-api.v1.json`. It
 * simulates network latency and returns a document shaped exactly like a
 * real one would be, so the gating/caching/UI code around it does not
 * need to change when a real endpoint is introduced later.
 *
 * `overrides` exists so tests and local development can simulate partial
 * rollout, downgrades, or incompatible versions without needing a real
 * server.
 */
export async function fetchMockCapabilityDocument(
  overrides: Partial<CapabilityDocument> = {},
): Promise<CapabilityDocument> {
  const identity = currentDeploymentIdentity();

  const document: CapabilityDocument = {
    documentVersion: CAPABILITY_DOCUMENT_SHAPE_VERSION,
    apiVersion: identity.apiSpecVersion,
    network: identity.stellarNetwork,
    generatedAt: new Date().toISOString(),
    capabilities: {
      "activity-log": { enabled: true },
      "embeddable-verification-widget": { enabled: true },
      "recurring-income-proofs": { enabled: true },
      "payment-receipt-proofs": { enabled: true },
      "organization-management": { enabled: true },
    },
    ...overrides,
  };

  return document;
}
