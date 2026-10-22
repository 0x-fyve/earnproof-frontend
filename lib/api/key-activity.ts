/**
 * Per-key last-used and activity detail views (#217).
 * ====================================================
 *
 * Summarizes how an API key has actually been used: when it was last used,
 * a breakdown of recent calls by endpoint category, and outcome counts
 * (success/client error/server error). Scoped to the active organization —
 * the mock fixtures here key off `keyId` only, which is the same scoping
 * `getApiKeys`/`getApiKeysPaginated` already apply to the key list itself.
 *
 * This module never renders a full IP address, request/response payload, or
 * secret — only a last-used timestamp, counts, and a bounded list of
 * endpoint categories. There is no real backend usage-telemetry endpoint for
 * API keys yet, so this is a fixture keyed by a recognizable `keyId` suffix,
 * mirroring the other mock `lib/api/*.ts` modules in this repo.
 */

export type KeyActivityState = "active" | "stale" | "never-used" | "revoked" | "unavailable";

export type EndpointCategorySummary = {
  category: string;
  callCount: number;
  lastCalledAt: string | null;
};

export type KeyActivityOutcomeCounts = {
  success: number;
  clientError: number;
  serverError: number;
};

export type KeyActivityDetail = {
  keyId: string;
  state: KeyActivityState;
  lastUsedAt: string | null;
  categories: EndpointCategorySummary[];
  outcomes: KeyActivityOutcomeCounts;
};

const STALE_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/** Whether a last-used timestamp is old enough to be surfaced as "stale" rather than "active". */
export function isStaleLastUsed(lastUsedAt: string | null, now: Date = new Date()): boolean {
  if (!lastUsedAt) return false;
  const parsed = new Date(lastUsedAt);
  if (Number.isNaN(parsed.getTime())) return false;
  return now.getTime() - parsed.getTime() > STALE_THRESHOLD_MS;
}

export function totalOutcomeCount(outcomes: KeyActivityOutcomeCounts): number {
  return outcomes.success + outcomes.clientError + outcomes.serverError;
}

const SIMULATED_LATENCY_MS = 150;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type FetchKeyActivityOptions = {
  now?: Date;
  signal?: AbortSignal;
};

/**
 * Simulates fetching the activity detail for a single API key. The caller
 * must already be authorized to view the key itself (enforced upstream by
 * `getApiKeys`/the organization's own access control); this does not
 * perform its own authorization check beyond the `forbidden` fixture case
 * used to exercise the UI's forbidden-state rendering.
 */
export async function fetchMockKeyActivity(
  keyId: string,
  options: FetchKeyActivityOptions = {},
): Promise<KeyActivityDetail> {
  await delay(SIMULATED_LATENCY_MS);

  if (options.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const now = options.now ?? new Date();

  if (keyId.endsWith("forbidden")) {
    return {
      keyId,
      state: "unavailable",
      lastUsedAt: null,
      categories: [],
      outcomes: { success: 0, clientError: 0, serverError: 0 },
    };
  }

  if (keyId.endsWith("revoked")) {
    return {
      keyId,
      state: "revoked",
      lastUsedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 10).toISOString(),
      categories: [
        { category: "proofs", callCount: 42, lastCalledAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 10).toISOString() },
      ],
      outcomes: { success: 40, clientError: 2, serverError: 0 },
    };
  }

  if (keyId.endsWith("never-used")) {
    return {
      keyId,
      state: "never-used",
      lastUsedAt: null,
      categories: [],
      outcomes: { success: 0, clientError: 0, serverError: 0 },
    };
  }

  if (keyId.endsWith("stale")) {
    const lastUsedAt = new Date(now.getTime() - STALE_THRESHOLD_MS - 1000 * 60 * 60).toISOString();
    return {
      keyId,
      state: "stale",
      lastUsedAt,
      categories: [
        { category: "webhooks", callCount: 3, lastCalledAt: lastUsedAt },
      ],
      outcomes: { success: 3, clientError: 0, serverError: 0 },
    };
  }

  // Default: an actively-used key.
  const lastUsedAt = new Date(now.getTime() - 1000 * 60 * 60 * 2).toISOString();
  return {
    keyId,
    state: "active",
    lastUsedAt,
    categories: [
      { category: "proofs", callCount: 128, lastCalledAt: lastUsedAt },
      { category: "webhooks", callCount: 14, lastCalledAt: new Date(now.getTime() - 1000 * 60 * 60 * 6).toISOString() },
      { category: "verification", callCount: 7, lastCalledAt: new Date(now.getTime() - 1000 * 60 * 60 * 20).toISOString() },
    ],
    outcomes: { success: 145, clientError: 3, serverError: 1 },
  };
}

/** Human label for a `KeyActivityState`, used consistently by the detail view. */
export function keyActivityStateLabel(state: KeyActivityState): string {
  switch (state) {
    case "active":
      return "Active";
    case "stale":
      return "Stale";
    case "never-used":
      return "Never used";
    case "revoked":
      return "Revoked";
    case "unavailable":
      return "Unavailable";
    default:
      return state;
  }
}
