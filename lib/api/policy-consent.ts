/**
 * Privacy policy and terms consent history (#222).
 * ====================================================
 *
 * Users need to see which published policy versions they have accepted and
 * be guided through a focused re-consent flow when a *required* version
 * changes. This is deliberately separate from
 * `components/auth/wallet-consent-screen.tsx`, which is a wallet
 * signature-challenge confirmation dialog (origin/network/expiry of a
 * *signing* request) — an unrelated, narrower concern with no notion of
 * policy versions or acceptance history at all.
 *
 * No consent-history endpoint exists yet, so `fetchMockPolicyConsentState`
 * is a documented fixture/forward-contract, same convention as
 * lib/api/retention.ts and lib/api/organization-role-approval-policy.ts.
 *
 * Invariants (see #222 acceptance criteria):
 *   - Consent can never be recorded without an explicit user action —
 *     `recordConsent` always requires an `action: "accept"` discriminant
 *     supplied by a UI click handler; there is no "auto-accept" path.
 *   - A required policy change blocks only the protected actions it names,
 *     not the whole app — `isActionBlocked` takes the specific action id.
 *   - Historical acceptance records are read-only: nothing in this module
 *     mutates a `PolicyAcceptanceRecord` once created; `recordConsent`
 *     only ever appends.
 */

export type PolicyKind = "PRIVACY_POLICY" | "TERMS_OF_SERVICE";

export type PolicyVersion = {
  kind: PolicyKind;
  version: string;
  publishedAt: string;
  /** Link to the immutable, versioned policy content. Never a "latest" URL. */
  contentUrl: string;
  /** When true, continuing to use the listed protected actions requires accepting this version. */
  required: boolean;
  /** Action ids this version's consent gates, when required. Empty means none are blocked yet. */
  protectedActions: string[];
};

export type PolicyAcceptanceRecord = {
  id: string;
  kind: PolicyKind;
  version: string;
  acceptedAt: string;
};

export type PolicyConsentState = {
  currentVersions: PolicyVersion[];
  acceptanceHistory: PolicyAcceptanceRecord[];
};

/**
 * The most recent acceptance record for a given policy kind, or null if the
 * user has never accepted any version of it.
 *
 * `acceptanceHistory` is append-only (see `recordConsent`/`withdrawConsent`),
 * so array order is itself a reliable "happened after" signal — more
 * reliable than `acceptedAt` alone, which is only millisecond-resolution
 * and can tie when two records are written in the same synchronous tick
 * (e.g. an immediate accept-then-withdraw). Sorting by timestamp with a
 * stable sort would then silently keep the earlier record first on a tie.
 * To avoid that, this walks the history backward and returns the last
 * record whose timestamp is not earlier than any record after it would
 * imply — in practice, simply the last matching entry in append order.
 */
export function latestAcceptance(
  state: PolicyConsentState,
  kind: PolicyKind,
): PolicyAcceptanceRecord | null {
  const matching = state.acceptanceHistory.filter((record) => record.kind === kind);
  return matching.length > 0 ? matching[matching.length - 1] : null;
}

/**
 * Whether the user has accepted the current published version of a policy
 * kind. False both for "never accepted" and "accepted an older version".
 */
export function hasAcceptedCurrentVersion(state: PolicyConsentState, kind: PolicyKind): boolean {
  const current = state.currentVersions.find((version) => version.kind === kind);
  if (!current) {
    return true; // No current version published for this kind: nothing to accept.
  }
  const latest = latestAcceptance(state, kind);
  return latest?.version === current.version;
}

/**
 * Policy versions that are both required and not yet accepted at their
 * current published version. Driving list for "present a focused consent
 * flow when a required version changes".
 */
export function pendingRequiredConsents(state: PolicyConsentState): PolicyVersion[] {
  return state.currentVersions.filter(
    (version) => version.required && !hasAcceptedCurrentVersion(state, version.kind),
  );
}

/**
 * Whether a specific protected action id is blocked because some pending
 * required policy names it. Required changes block ONLY the actions they
 * document — never a blanket "everything is blocked" — so an action not
 * named by any pending required version is always allowed through here.
 */
export function isActionBlocked(state: PolicyConsentState, actionId: string): boolean {
  return pendingRequiredConsents(state).some((version) => version.protectedActions.includes(actionId));
}

export type RecordConsentInput = {
  kind: PolicyKind;
  version: string;
  /** Explicit discriminant: consent can only ever be recorded via a user action. */
  action: "accept";
};

export class ConsentRequiresExplicitActionError extends Error {
  constructor() {
    super("Consent cannot be recorded without an explicit accept action.");
    this.name = "ConsentRequiresExplicitActionError";
  }
}

/**
 * Appends a new acceptance record. Never mutates or removes any existing
 * record — history stays read-only and additive, satisfying "historical
 * acceptance records remain read-only".
 */
export function recordConsent(
  state: PolicyConsentState,
  input: RecordConsentInput,
  now: Date = new Date(),
): PolicyConsentState {
  if (input.action !== "accept") {
    // Unreachable through the type system from a correct caller, but kept
    // as a runtime guard so a malformed/forged call (e.g. from an
    // auto-dispatch bug) fails loudly instead of silently recording
    // consent that was never explicitly given.
    throw new ConsentRequiresExplicitActionError();
  }

  const record: PolicyAcceptanceRecord = {
    id: `consent-${crypto.randomUUID()}`,
    kind: input.kind,
    version: input.version,
    acceptedAt: now.toISOString(),
  };

  return {
    ...state,
    acceptanceHistory: [...state.acceptanceHistory, record],
  };
}

/**
 * A withdrawal is modeled as the absence of a current acceptance for that
 * kind going forward: it does not erase the historical record (read-only
 * invariant) but means `hasAcceptedCurrentVersion` must report false again
 * until the user re-accepts. Represented as an explicit withdrawal record
 * with its own kind so the history shows what happened, without deleting
 * anything.
 */
export type PolicyWithdrawalRecord = PolicyAcceptanceRecord & { withdrawn: true };

export function withdrawConsent(
  state: PolicyConsentState,
  kind: PolicyKind,
  now: Date = new Date(),
): PolicyConsentState {
  const withdrawal: PolicyAcceptanceRecord = {
    id: `consent-${crypto.randomUUID()}`,
    kind,
    version: "__WITHDRAWN__",
    acceptedAt: now.toISOString(),
  };
  return {
    ...state,
    acceptanceHistory: [...state.acceptanceHistory, withdrawal],
  };
}

export async function fetchMockPolicyConsentState(
  overrides: Partial<PolicyConsentState> = {},
): Promise<PolicyConsentState> {
  const now = new Date().toISOString();
  return {
    currentVersions: [
      {
        kind: "PRIVACY_POLICY",
        version: "2026-01-01",
        publishedAt: now,
        contentUrl: "/privacy?version=2026-01-01",
        required: false,
        protectedActions: [],
      },
      {
        kind: "TERMS_OF_SERVICE",
        version: "2026-01-01",
        publishedAt: now,
        contentUrl: "/terms?version=2026-01-01",
        required: false,
        protectedActions: [],
      },
    ],
    acceptanceHistory: [],
    ...overrides,
  };
}

export class PolicyConsentApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyConsentApiError";
  }
}

/**
 * Simulates the real submit endpoint for tests that need to model an API
 * failure explicitly (acceptance criteria: "API failure" is a required
 * test case). `shouldFail` lets a test force the failure path without
 * mocking fetch/timers.
 */
export async function submitConsentMock(
  state: PolicyConsentState,
  input: RecordConsentInput,
  options: { shouldFail?: boolean } = {},
): Promise<PolicyConsentState> {
  if (options.shouldFail) {
    throw new PolicyConsentApiError("Could not record consent. Please try again.");
  }
  return recordConsent(state, input);
}
