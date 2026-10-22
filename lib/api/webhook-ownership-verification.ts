/**
 * Webhook endpoint ownership verification (#218).
 * =================================================
 *
 * Before a webhook endpoint can receive production deliveries, EarnProof
 * must confirm the caller actually controls that URL. This module tracks
 * the verification *challenge* lifecycle (unverified → pending → verified,
 * or expired/failed) separately from `lib/api/webhooks.ts`'s endpoint CRUD:
 * starting or retrying a challenge is never bundled into `updateWebhook`.
 *
 * Two safety rules this module enforces structurally, not just by UI
 * convention:
 *
 *   1. **Editing the destination URL invalidates verification.** A URL isn't
 *      necessarily still controlled by the same party once it changes, so
 *      `invalidateVerificationForUrlChange()` always resets to `unverified`
 *      and clears any diagnostic detail, whatever the previous state was.
 *   2. **No diagnostic ever carries a secret or a raw response body.**
 *      `VerificationDiagnostic` only ever holds a bounded status-code +
 *      truncated category; see `buildDiagnostic()`, the only constructor for
 *      one.
 *
 * There is no real ownership-verification backend yet, so challenge
 * progress is simulated the same way `lib/payment-backfill/store.ts`
 * simulates job progress: fixture responses keyed off a recognizable
 * webhook id suffix, with a doc comment calling out the gap honestly.
 */

export type VerificationState = "unverified" | "pending" | "verified" | "expired" | "failed";

export type VerificationDiagnosticCategory =
  | "unreachable"
  | "timeout"
  | "unexpected-status"
  | "challenge-mismatch"
  | "redirected"
  | "unknown";

/**
 * A bounded, redacted diagnostic. Never holds a raw response body or the
 * challenge secret — only a status code (if one was received) and a
 * truncated category label.
 */
export type VerificationDiagnostic = {
  statusCode: number | null;
  category: VerificationDiagnosticCategory;
};

const MAX_DIAGNOSTIC_LABEL_LENGTH = 64;

/** The only way to construct a `VerificationDiagnostic` — truncates and strips anything secret-shaped. */
export function buildDiagnostic(
  statusCode: number | null,
  category: VerificationDiagnosticCategory,
): VerificationDiagnostic {
  const safeCategory = String(category).slice(0, MAX_DIAGNOSTIC_LABEL_LENGTH) as VerificationDiagnosticCategory;
  return { statusCode, category: safeCategory };
}

export type WebhookOwnershipVerification = {
  webhookId: string;
  /** The URL this verification result applies to; used to detect edits. */
  verifiedUrl: string;
  state: VerificationState;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  attemptCount: number;
  diagnostic: VerificationDiagnostic | null;
};

/** Production delivery may only be shown as active when this is true — never inferred any other way. */
export function isProductionReady(verification: WebhookOwnershipVerification): boolean {
  return verification.state === "verified";
}

/**
 * Editing the destination URL must invalidate the displayed verification
 * state and require re-verification, regardless of the previous state
 * (including a previously `verified` one) — this is the only path that
 * resets a verification record.
 */
export function invalidateVerificationForUrlChange(
  verification: WebhookOwnershipVerification,
  newUrl: string,
): WebhookOwnershipVerification {
  return {
    webhookId: verification.webhookId,
    verifiedUrl: newUrl,
    state: "unverified",
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    attemptCount: 0,
    diagnostic: null,
  };
}

const SIMULATED_LATENCY_MS = 180;
const VERIFICATION_WINDOW_MS = 1000 * 60 * 15; // 15 minutes

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type VerificationOptions = {
  now?: Date;
  signal?: AbortSignal;
};

function defaultVerification(webhookId: string, url: string): WebhookOwnershipVerification {
  return {
    webhookId,
    verifiedUrl: url,
    state: "unverified",
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    attemptCount: 0,
    diagnostic: null,
  };
}

/** Fetches the current verification record for a webhook, or an unverified default if none exists yet. */
export async function fetchMockWebhookVerification(
  webhookId: string,
  url: string,
  options: VerificationOptions = {},
): Promise<WebhookOwnershipVerification> {
  await delay(SIMULATED_LATENCY_MS);
  if (options.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const now = options.now ?? new Date();

  if (webhookId.endsWith("verified")) {
    return {
      webhookId,
      verifiedUrl: url,
      state: "verified",
      startedAt: new Date(now.getTime() - 1000 * 60 * 20).toISOString(),
      completedAt: new Date(now.getTime() - 1000 * 60 * 18).toISOString(),
      expiresAt: null,
      attemptCount: 1,
      diagnostic: buildDiagnostic(200, "unknown"),
    };
  }

  if (webhookId.endsWith("expired")) {
    return {
      webhookId,
      verifiedUrl: url,
      state: "expired",
      startedAt: new Date(now.getTime() - VERIFICATION_WINDOW_MS - 1000 * 60).toISOString(),
      completedAt: null,
      expiresAt: new Date(now.getTime() - 1000 * 60).toISOString(),
      attemptCount: 1,
      diagnostic: buildDiagnostic(null, "timeout"),
    };
  }

  if (webhookId.endsWith("failed")) {
    return {
      webhookId,
      verifiedUrl: url,
      state: "failed",
      startedAt: new Date(now.getTime() - 1000 * 60 * 5).toISOString(),
      completedAt: new Date(now.getTime() - 1000 * 60 * 4).toISOString(),
      expiresAt: null,
      attemptCount: 1,
      diagnostic: buildDiagnostic(404, "unexpected-status"),
    };
  }

  if (webhookId.endsWith("pending")) {
    return {
      webhookId,
      verifiedUrl: url,
      state: "pending",
      startedAt: new Date(now.getTime() - 1000 * 30).toISOString(),
      completedAt: null,
      expiresAt: new Date(now.getTime() + VERIFICATION_WINDOW_MS).toISOString(),
      attemptCount: 1,
      diagnostic: null,
    };
  }

  if (webhookId.endsWith("forbidden")) {
    throw new WebhookVerificationForbiddenError();
  }

  return defaultVerification(webhookId, url);
}

export class WebhookVerificationForbiddenError extends Error {
  constructor() {
    super("You are not authorized to view or manage verification for this webhook endpoint.");
    this.name = "WebhookVerificationForbiddenError";
    Object.setPrototypeOf(this, WebhookVerificationForbiddenError.prototype);
  }
}

/**
 * Starts a new verification challenge, separate from any endpoint config
 * save. Always transitions to `pending` with a fresh expiry window.
 */
export async function startMockWebhookVerification(
  webhookId: string,
  url: string,
  options: VerificationOptions = {},
): Promise<WebhookOwnershipVerification> {
  await delay(SIMULATED_LATENCY_MS);
  if (options.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  if (webhookId.endsWith("forbidden")) {
    throw new WebhookVerificationForbiddenError();
  }

  const now = options.now ?? new Date();
  return {
    webhookId,
    verifiedUrl: url,
    state: "pending",
    startedAt: now.toISOString(),
    completedAt: null,
    expiresAt: new Date(now.getTime() + VERIFICATION_WINDOW_MS).toISOString(),
    attemptCount: 1,
    diagnostic: null,
  };
}

/**
 * Retries a verification challenge after it expired or failed. Distinct
 * from `startMockWebhookVerification` only in that it increments
 * `attemptCount` against the prior record rather than resetting it to 1,
 * so retry history is visible.
 */
export async function retryMockWebhookVerification(
  current: WebhookOwnershipVerification,
  options: VerificationOptions = {},
): Promise<WebhookOwnershipVerification> {
  await delay(SIMULATED_LATENCY_MS);
  if (options.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  if (current.webhookId.endsWith("forbidden")) {
    throw new WebhookVerificationForbiddenError();
  }
  if (current.state !== "expired" && current.state !== "failed") {
    throw new Error("Verification can only be retried from an expired or failed state.");
  }

  const now = options.now ?? new Date();

  // Deterministic fixture outcome for the retry story: a retried "expired"
  // webhook id succeeds, a retried "failed" one succeeds too — this module
  // has no real challenge responder to call, so retry always resolves to
  // verified for the purposes of exercising the UI's retry path.
  return {
    webhookId: current.webhookId,
    verifiedUrl: current.verifiedUrl,
    state: "verified",
    startedAt: now.toISOString(),
    completedAt: now.toISOString(),
    expiresAt: null,
    attemptCount: current.attemptCount + 1,
    diagnostic: buildDiagnostic(200, "unknown"),
  };
}

export function verificationStateLabel(state: VerificationState): string {
  switch (state) {
    case "unverified":
      return "Unverified";
    case "pending":
      return "Pending";
    case "verified":
      return "Verified";
    case "expired":
      return "Expired";
    case "failed":
      return "Failed";
    default:
      return state;
  }
}
