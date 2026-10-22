/**
 * Organization onboarding readiness checklist (#216).
 * ====================================================
 *
 * Surfaces the required/optional setup steps an organization still needs
 * (issuer setup, asset setup, member invites, key creation, etc.) and whether
 * each one is already done. Readiness is entirely server-derived: this
 * module only renders what `fetchMockOnboardingChecklist()` returns, it never
 * recomputes "done"/"ready" from other client-side state. That keeps the UI
 * honest if the server's notion of "done" differs from a naive client guess
 * (e.g. a step that requires server-side verification, not just a client
 * record existing).
 *
 * There is no real backend push channel for "an issuer/asset/member/key
 * changed elsewhere, refresh this checklist" — the mock API has no event bus.
 * `fetchMockOnboardingChecklist()` is the refetch entrypoint a caller can
 * invoke on mount and from a manual "Refresh" action; that is the closest
 * honest approximation available without a real server to push from.
 */

export type OnboardingCheckStatus = "complete" | "incomplete" | "unavailable";

export type OnboardingCheckId =
  | "organization-profile"
  | "issuer-setup"
  | "asset-setup"
  | "member-invite"
  | "key-creation"
  | "webhook-setup";

export type OnboardingCheck = {
  id: OnboardingCheckId;
  label: string;
  description: string;
  required: boolean;
  status: OnboardingCheckStatus;
  /** Route to the page that resolves this check, when the viewer may act on it. */
  actionHref: string | null;
  /** True when the viewer's role is not permitted to see this check's real state. */
  authorized: boolean;
};

export type OrganizationOnboardingState = "new" | "partial" | "ready" | "degraded" | "archived";

export type OnboardingChecklist = {
  organizationId: string;
  state: OrganizationOnboardingState;
  checks: OnboardingCheck[];
  updatedAt: string;
};

/** Required checks that are not `complete` block readiness; optional ones never do. */
export function isChecklistReady(checklist: OnboardingChecklist): boolean {
  return !checklist.checks.some((check) => check.required && check.status !== "complete");
}

export function countIncompleteRequired(checklist: OnboardingChecklist): number {
  return checklist.checks.filter((check) => check.required && check.status === "incomplete")
    .length;
}

/** Checks the viewer is authorized to see; unauthorized checks are hidden, not shown as incomplete. */
export function visibleChecks(checklist: OnboardingChecklist): OnboardingCheck[] {
  return checklist.checks.filter((check) => check.authorized);
}

const BASE_CHECKS: Omit<OnboardingCheck, "status" | "authorized">[] = [
  {
    id: "organization-profile",
    label: "Complete organization profile",
    description: "Add a name, website, and primary contact for the organization.",
    required: true,
    actionHref: "/settings/organizations",
  },
  {
    id: "issuer-setup",
    label: "Configure an issuer",
    description: "Register at least one issuer identity for this organization.",
    required: true,
    actionHref: "/settings/issuers",
  },
  {
    id: "asset-setup",
    label: "Enable a supported asset",
    description: "Select which Stellar assets this organization can index and prove.",
    required: true,
    actionHref: "/settings/assets",
  },
  {
    id: "member-invite",
    label: "Invite a team member",
    description: "Add at least one additional member so access isn't tied to one account.",
    required: false,
    actionHref: "/settings/organizations",
  },
  {
    id: "key-creation",
    label: "Create an API key",
    description: "Generate an API key scoped for the integration this organization will use.",
    required: true,
    actionHref: "/developers/api-keys",
  },
  {
    id: "webhook-setup",
    label: "Register a webhook endpoint",
    description: "Subscribe an endpoint so this organization can receive proof events.",
    required: false,
    actionHref: "/developers/webhooks",
  },
];

function buildChecks(
  statuses: Partial<Record<OnboardingCheckId, OnboardingCheckStatus>>,
  hidden: OnboardingCheckId[] = [],
): OnboardingCheck[] {
  return BASE_CHECKS.map((base) => {
    const authorized = !hidden.includes(base.id);
    return {
      ...base,
      status: statuses[base.id] ?? "incomplete",
      authorized,
      // An unauthorized check never reveals a real actionHref or claims completeness.
      actionHref: authorized ? base.actionHref : null,
    };
  });
}

const SIMULATED_LATENCY_MS = 180;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type FetchOnboardingChecklistOptions = {
  /** Lets tests and the "state" story simulate a fixed clock. */
  now?: Date;
  signal?: AbortSignal;
};

/**
 * Simulates fetching the onboarding checklist for `organizationId`. There is
 * no real backend endpoint for this yet, so the response is derived from a
 * small set of fixtures keyed by a recognizable id suffix, mirroring how
 * other mock `lib/api/*.ts` modules (e.g. organization-data-residency.ts)
 * stand in for an unimplemented server feature.
 */
export async function fetchMockOnboardingChecklist(
  organizationId: string,
  options: FetchOnboardingChecklistOptions = {},
): Promise<OnboardingChecklist> {
  await delay(SIMULATED_LATENCY_MS);

  if (options.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const now = (options.now ?? new Date()).toISOString();

  if (organizationId.endsWith("archived")) {
    return {
      organizationId,
      state: "archived",
      updatedAt: now,
      checks: buildChecks({
        "organization-profile": "complete",
        "issuer-setup": "complete",
        "asset-setup": "complete",
        "member-invite": "complete",
        "key-creation": "unavailable",
        "webhook-setup": "unavailable",
      }),
    };
  }

  if (organizationId.endsWith("degraded")) {
    return {
      organizationId,
      state: "degraded",
      updatedAt: now,
      checks: buildChecks({
        "organization-profile": "complete",
        "issuer-setup": "complete",
        "asset-setup": "incomplete",
        "member-invite": "complete",
        "key-creation": "complete",
        "webhook-setup": "incomplete",
      }),
    };
  }

  if (organizationId.endsWith("ready")) {
    return {
      organizationId,
      state: "ready",
      updatedAt: now,
      checks: buildChecks({
        "organization-profile": "complete",
        "issuer-setup": "complete",
        "asset-setup": "complete",
        "member-invite": "complete",
        "key-creation": "complete",
        "webhook-setup": "complete",
      }),
    };
  }

  if (organizationId.endsWith("partial")) {
    return {
      organizationId,
      state: "partial",
      updatedAt: now,
      checks: buildChecks({
        "organization-profile": "complete",
        "issuer-setup": "complete",
        "asset-setup": "incomplete",
        "member-invite": "incomplete",
        "key-creation": "incomplete",
        "webhook-setup": "incomplete",
      }),
    };
  }

  // Default: a brand-new organization, nothing done yet.
  return {
    organizationId,
    state: "new",
    updatedAt: now,
    checks: buildChecks({}),
  };
}

/**
 * Fetches the checklist for a viewer role, hiding checks the role is not
 * authorized to see. Hidden checks render as hidden/disabled by the UI, not
 * as a false "incomplete" claim about state the viewer cannot actually see.
 */
export async function fetchMockOnboardingChecklistForViewer(
  organizationId: string,
  viewerRole: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" | null | undefined,
  options: FetchOnboardingChecklistOptions = {},
): Promise<OnboardingChecklist> {
  const checklist = await fetchMockOnboardingChecklist(organizationId, options);

  if (viewerRole === "OWNER" || viewerRole === "ADMIN") {
    return checklist;
  }

  // Members/viewers/unknown roles cannot see key-creation or webhook-setup
  // readiness (those imply credential/security state); hide, don't lie.
  const hidden: OnboardingCheckId[] = ["key-creation", "webhook-setup"];
  return {
    ...checklist,
    checks: checklist.checks.map((check) =>
      hidden.includes(check.id)
        ? { ...check, authorized: false, actionHref: null }
        : check,
    ),
  };
}
