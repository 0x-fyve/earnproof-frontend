/**
 * Backend-to-contract drift and acknowledgement status (#220).
 * ==============================================================
 *
 * Administrative workflows need visibility into when the backend's view of
 * contract configuration (fee schedules, supported assets, signer sets,
 * etc.) has drifted from what is actually live on-chain, and whether an
 * operator has temporarily acknowledged a known drift.
 *
 * No drift-check endpoint exists in the OpenAPI spec yet, so
 * `fetchMockContractDrift` is a documented fixture/forward-contract: the
 * shape the real endpoint is expected to return, with the same semantics
 * this module enforces.
 *
 * Design invariants (see acceptance criteria on #220):
 *   - The client never overrides a blocking severity. `canPerformAction`
 *     always returns false for "blocking", with no override parameter.
 *   - An acknowledgement that has expired stops suppressing warnings; it is
 *     evaluated against `now` on every call, never cached as a boolean.
 *   - "unavailable" (the check itself could not run) is a distinct status
 *     from "matched" (the check ran and found no drift). They must never be
 *     conflated in display copy or in the severity computed from them.
 */

export type DriftCategory =
  | "FEE_SCHEDULE"
  | "SUPPORTED_ASSETS"
  | "SIGNER_SET"
  | "CONTRACT_ADDRESS"
  | "RATE_LIMITS";

export const DRIFT_CATEGORIES: readonly DriftCategory[] = [
  "FEE_SCHEDULE",
  "SUPPORTED_ASSETS",
  "SIGNER_SET",
  "CONTRACT_ADDRESS",
  "RATE_LIMITS",
];

/**
 * Server-provided severity for a drift check result. The server is the sole
 * authority on this value; the client only ever reads it.
 *
 *   - "matched"    the check ran and the backend's view matches the contract.
 *   - "degraded"   a check ran but could not fully verify (e.g. a partial
 *                  RPC response); treat as "unknown, proceed with caution".
 *   - "warning"    a non-blocking drift was found; actions may proceed.
 *   - "blocking"   a drift was found that must stop the affected action.
 *   - "unavailable" the check itself did not run (RPC unreachable, timeout,
 *                  etc.) — never conflated with "matched". No decision can
 *                  be made; the UI must say so rather than imply safety.
 */
export type DriftSeverity = "matched" | "degraded" | "warning" | "blocking" | "unavailable";

export const DRIFT_SEVERITIES: readonly DriftSeverity[] = [
  "matched",
  "degraded",
  "warning",
  "blocking",
  "unavailable",
];

export type DriftAcknowledgement = {
  acknowledgedBy: string;
  acknowledgedAt: string;
  /** When the acknowledgement stops suppressing warnings. */
  expiresAt: string;
  reason: string;
};

export type DriftCheckResult = {
  category: DriftCategory;
  /** The capability this drift affects, e.g. "payment-review", "proof-verification". */
  affectedCapability: string;
  severity: DriftSeverity;
  lastCheckedAt: string;
  detail: string;
  acknowledgement: DriftAcknowledgement | null;
};

export type DriftStatus = {
  checks: DriftCheckResult[];
  generatedAt: string;
};

/**
 * True when an acknowledgement is present and has not expired as of `now`.
 * Always evaluated live — never cached — so an expiry is picked up on the
 * very next render/check rather than requiring a page reload.
 */
export function isAcknowledgementActive(
  acknowledgement: DriftAcknowledgement | null,
  now: number = Date.now(),
): boolean {
  if (!acknowledgement) {
    return false;
  }
  return new Date(acknowledgement.expiresAt).getTime() > now;
}

/**
 * The severity that should actually drive UI decisions, after accounting
 * for acknowledgement expiry. A "warning" with an *active* acknowledgement
 * is suppressed to "acknowledged" for display purposes, but an expired
 * acknowledgement leaves the original severity in force unchanged.
 *
 * "blocking" is never suppressed by an acknowledgement, matching the
 * server's own authority over blocking decisions — an acknowledgement can
 * silence a warning, never a block.
 */
export type EffectiveDriftState =
  | "matched"
  | "degraded"
  | "warning"
  | "blocking"
  | "unavailable"
  | "acknowledged";

export function effectiveDriftState(
  check: DriftCheckResult,
  now: number = Date.now(),
): EffectiveDriftState {
  if (check.severity === "warning" && isAcknowledgementActive(check.acknowledgement, now)) {
    return "acknowledged";
  }
  return check.severity;
}

/**
 * Whether an action gated by this drift check may proceed. The client never
 * overrides a "blocking" decision — there is deliberately no parameter here
 * that could flip that, by design, to make a future "just let it through"
 * change require touching this function's signature, not just a call site.
 */
export function canPerformAction(check: DriftCheckResult, now: number = Date.now()): boolean {
  // `now` is accepted (not just for symmetry with effectiveDriftState) so a
  // future severity that depends on elapsed time can be added here without
  // changing this function's call sites — see the acknowledgement-expiry
  // reasoning in effectiveDriftState above for why that distinction matters.
  void now;

  if (check.severity === "blocking") {
    return false;
  }
  if (check.severity === "unavailable") {
    // Unknown is not the same as safe: default to blocking the action too,
    // but this is distinguishable in the UI (see driftStateCopy) from an
    // actual contract-level block.
    return false;
  }
  if (check.severity === "warning") {
    // Non-blocking by definition; proceeds whether or not acknowledged.
    return true;
  }
  return true;
}

export type DriftStateCopy = {
  label: string;
  tone: "success" | "warning" | "danger" | "neutral";
  description: string;
};

/**
 * Presentation copy per effective state. Kept as a pure lookup so tests can
 * assert "unavailable" and "matched" never collapse to the same label/tone.
 */
export function driftStateCopy(state: EffectiveDriftState): DriftStateCopy {
  switch (state) {
    case "matched":
      return {
        label: "Matched",
        tone: "success",
        description: "Backend configuration matches the live contract.",
      };
    case "acknowledged":
      return {
        label: "Acknowledged",
        tone: "neutral",
        description: "A known drift was acknowledged by an operator and is temporarily suppressed.",
      };
    case "degraded":
      return {
        label: "Degraded",
        tone: "warning",
        description: "The check ran but could not fully verify the configuration.",
      };
    case "warning":
      return {
        label: "Drift detected",
        tone: "warning",
        description: "Backend configuration differs from the live contract. Review before proceeding.",
      };
    case "blocking":
      return {
        label: "Blocked",
        tone: "danger",
        description: "A critical drift was found. The affected action is blocked until this is resolved.",
      };
    case "unavailable":
      return {
        label: "Check unavailable",
        tone: "neutral",
        description: "This check could not run. This is not the same as a confirmed match — status is unknown.",
      };
  }
}

export function formatAcknowledgementExpiry(
  acknowledgement: DriftAcknowledgement | null,
  now: number = Date.now(),
): string | null {
  if (!acknowledgement) {
    return null;
  }
  return isAcknowledgementActive(acknowledgement, now)
    ? `Acknowledged until ${new Date(acknowledgement.expiresAt).toLocaleString()}`
    : `Acknowledgement expired ${new Date(acknowledgement.expiresAt).toLocaleString()}`;
}

/**
 * A safe refresh request: it identifies the check by category only, never
 * exposing RPC endpoints, node URLs, or other backend internals to the
 * client. The server resolves what actually needs to be re-checked.
 */
export type RefreshDriftCheckRequest = {
  category: DriftCategory;
};

/**
 * Fixture provider standing in for the not-yet-existing drift endpoint.
 */
export async function fetchMockContractDrift(
  overrides: Partial<Record<DriftCategory, Partial<DriftCheckResult>>> = {},
): Promise<DriftStatus> {
  const now = new Date().toISOString();

  const defaults: Record<DriftCategory, DriftCheckResult> = {
    FEE_SCHEDULE: {
      category: "FEE_SCHEDULE",
      affectedCapability: "payment-review",
      severity: "matched",
      lastCheckedAt: now,
      detail: "Fee schedule matches the deployed contract.",
      acknowledgement: null,
    },
    SUPPORTED_ASSETS: {
      category: "SUPPORTED_ASSETS",
      affectedCapability: "proof-creation",
      severity: "matched",
      lastCheckedAt: now,
      detail: "Supported asset list matches the deployed contract.",
      acknowledgement: null,
    },
    SIGNER_SET: {
      category: "SIGNER_SET",
      affectedCapability: "proof-verification",
      severity: "matched",
      lastCheckedAt: now,
      detail: "Signer set matches the deployed contract.",
      acknowledgement: null,
    },
    CONTRACT_ADDRESS: {
      category: "CONTRACT_ADDRESS",
      affectedCapability: "proof-verification",
      severity: "matched",
      lastCheckedAt: now,
      detail: "Contract address matches configuration.",
      acknowledgement: null,
    },
    RATE_LIMITS: {
      category: "RATE_LIMITS",
      affectedCapability: "payment-review",
      severity: "matched",
      lastCheckedAt: now,
      detail: "Rate limits match the deployed contract.",
      acknowledgement: null,
    },
  };

  const checks = DRIFT_CATEGORIES.map((category) => ({
    ...defaults[category],
    ...overrides[category],
  }));

  return { checks, generatedAt: now };
}

/**
 * Re-requests a single check's result. The request never includes RPC URLs
 * or node internals — only the category — matching the "safe refresh"
 * acceptance criterion.
 */
export async function refreshMockDriftCheck(
  request: RefreshDriftCheckRequest,
  currentStatus: DriftStatus,
): Promise<DriftStatus> {
  const refreshedAt = new Date().toISOString();
  return {
    ...currentStatus,
    generatedAt: refreshedAt,
    checks: currentStatus.checks.map((check) =>
      check.category === request.category ? { ...check, lastCheckedAt: refreshedAt } : check,
    ),
  };
}
