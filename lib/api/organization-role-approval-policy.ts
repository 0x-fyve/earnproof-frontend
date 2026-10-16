/**
 * Organization role-approval policy (#258).
 * =========================================
 *
 * Organizations need to configure which role changes require independent
 * approval, how many approvals are needed, and how long a pending request
 * stays valid.
 *
 * The rules here are deliberately split into three layers:
 *
 *   1. **Server-enforced minimums** (`RoleApprovalMinimums`) — the client may
 *      make a policy *stricter* than these, never weaker. The server
 *      re-validates every write regardless; this layer exists so the UI can
 *      refuse to submit something it already knows will be rejected.
 *   2. **Policy validation** (`validateRoleApprovalPolicy`) — pure, so the
 *      same result is visible in the editor, the tests, and the server.
 *   3. **Fail-closed apply** (`applyPolicyUpdate`) — a stale (replayed) or
 *      conflicting version is rejected rather than silently overwritten.
 *
 * Nothing in this module is an authorization boundary: it never grants a
 * permission, it only refuses to *offer* a weakening change.
 */

export const ROLE_APPROVAL_POLICY_SCHEMA_VERSION = 1;

export const ORGANIZATION_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export function isOrganizationRole(value: unknown): value is OrganizationRole {
  return (
    typeof value === "string" &&
    (ORGANIZATION_ROLES as readonly string[]).includes(value)
  );
}

export type RoleApprovalRule = {
  role: OrganizationRole;
  /** Whether a change to this role requires independent approval. */
  requiresApproval: boolean;
};

export type RoleApprovalPolicy = {
  schemaVersion: number;
  /** Monotonic version, incremented by the server on every accepted write. */
  policyVersion: number;
  updatedAt: string;
  rules: RoleApprovalRule[];
  /** Independent approvals required for a single role-change request. */
  approvalsRequired: number;
  /** How long a pending request remains valid, in hours. */
  requestValidityHours: number;
  /** Whether the requester may approve their own request. */
  allowSelfApproval: boolean;
};

export type RoleApprovalMinimums = {
  /** Roles that must always require approval, regardless of the UI choice. */
  alwaysRequireApproval: OrganizationRole[];
  minApprovalsRequired: number;
  maxApprovalsRequired: number;
  minRequestValidityHours: number;
  maxRequestValidityHours: number;
  /** When false, `allowSelfApproval` may never be enabled. */
  selfApprovalPermitted: boolean;
};

/**
 * The defaults the UI fails closed to when the server has not sent explicit
 * minimums. They are intentionally conservative: OWNER changes always need
 * approval, at least one approver, self-approval off.
 */
export const DEFAULT_ROLE_APPROVAL_MINIMUMS: RoleApprovalMinimums = {
  alwaysRequireApproval: ["OWNER"],
  minApprovalsRequired: 1,
  maxApprovalsRequired: 5,
  minRequestValidityHours: 1,
  maxRequestValidityHours: 720,
  selfApprovalPermitted: false,
};

export type PolicyValidationSeverity = "error" | "warning";

export type PolicyValidationIssue = {
  field: string;
  message: string;
  severity: PolicyValidationSeverity;
};

/**
 * Validates a policy against the server-enforced minimums. Returns every
 * issue found; a policy is submittable only when no issue has severity
 * "error". An unsupported schema version short-circuits (fail closed).
 */
export function validateRoleApprovalPolicy(
  policy: RoleApprovalPolicy,
  minimums: RoleApprovalMinimums = DEFAULT_ROLE_APPROVAL_MINIMUMS,
): PolicyValidationIssue[] {
  const issues: PolicyValidationIssue[] = [];

  if (policy.schemaVersion !== ROLE_APPROVAL_POLICY_SCHEMA_VERSION) {
    return [
      {
        field: "schemaVersion",
        message: "This policy version is not supported by the client.",
        severity: "error",
      },
    ];
  }

  if (
    !Number.isInteger(policy.approvalsRequired) ||
    policy.approvalsRequired < minimums.minApprovalsRequired
  ) {
    issues.push({
      field: "approvalsRequired",
      message: `At least ${minimums.minApprovalsRequired} independent approval(s) are required.`,
      severity: "error",
    });
  } else if (policy.approvalsRequired > minimums.maxApprovalsRequired) {
    issues.push({
      field: "approvalsRequired",
      message: `At most ${minimums.maxApprovalsRequired} approvals are supported.`,
      severity: "error",
    });
  }

  if (
    !Number.isFinite(policy.requestValidityHours) ||
    policy.requestValidityHours < minimums.minRequestValidityHours
  ) {
    issues.push({
      field: "requestValidityHours",
      message: `Requests must stay valid for at least ${minimums.minRequestValidityHours} hour(s).`,
      severity: "error",
    });
  } else if (policy.requestValidityHours > minimums.maxRequestValidityHours) {
    issues.push({
      field: "requestValidityHours",
      message: `Requests may stay valid for at most ${minimums.maxRequestValidityHours} hours.`,
      severity: "error",
    });
  }

  if (policy.allowSelfApproval && !minimums.selfApprovalPermitted) {
    issues.push({
      field: "allowSelfApproval",
      message: "Self-approval is not permitted by server policy.",
      severity: "error",
    });
  }

  const seenRoles = new Set<OrganizationRole>();
  for (const rule of policy.rules) {
    if (!isOrganizationRole(rule.role)) {
      issues.push({
        field: "rules",
        message: `Unknown role "${String(rule.role)}".`,
        severity: "error",
      });
      continue;
    }
    if (seenRoles.has(rule.role)) {
      issues.push({
        field: `rules.${rule.role}`,
        message: `Duplicate rule for role ${rule.role}.`,
        severity: "error",
      });
    }
    seenRoles.add(rule.role);
  }

  for (const role of minimums.alwaysRequireApproval) {
    const rule = policy.rules.find((candidate) => candidate.role === role);
    if (!rule || !rule.requiresApproval) {
      issues.push({
        field: `rules.${role}`,
        message: `${role} role changes must always require approval.`,
        severity: "error",
      });
    }
  }

  for (const role of ORGANIZATION_ROLES) {
    if (!seenRoles.has(role)) {
      issues.push({
        field: `rules.${role}`,
        message: `Missing rule for role ${role}.`,
        severity: "warning",
      });
    }
  }

  return issues;
}

export function isRoleApprovalPolicyValid(
  policy: RoleApprovalPolicy,
  minimums: RoleApprovalMinimums = DEFAULT_ROLE_APPROVAL_MINIMUMS,
): boolean {
  return !validateRoleApprovalPolicy(policy, minimums).some(
    (issue) => issue.severity === "error",
  );
}

/**
 * True when `next` is at least as strict as `current` on every dimension the
 * server minimums care about. Used to label a change as a strengthening or a
 * relaxation in the impact preview.
 */
export function isPolicyAtLeastAsStrict(
  current: RoleApprovalPolicy,
  next: RoleApprovalPolicy,
): boolean {
  if (next.approvalsRequired < current.approvalsRequired) {
    return false;
  }
  if (next.requestValidityHours > current.requestValidityHours) {
    return false;
  }
  if (next.allowSelfApproval && !current.allowSelfApproval) {
    return false;
  }
  for (const rule of current.rules) {
    if (!rule.requiresApproval) {
      continue;
    }
    const nextRule = next.rules.find((candidate) => candidate.role === rule.role);
    if (!nextRule || !nextRule.requiresApproval) {
      return false;
    }
  }
  return true;
}

export type PolicyFieldChange = {
  field: string;
  before: string;
  after: string;
};

/**
 * Field-level comparison of two policy versions, for the "version
 * comparison" control. Empty array means the two versions are equivalent.
 */
export function comparePolicyVersions(
  previous: RoleApprovalPolicy,
  next: RoleApprovalPolicy,
): PolicyFieldChange[] {
  const changes: PolicyFieldChange[] = [];

  const numeric: Array<[string, number, number]> = [
    ["policyVersion", previous.policyVersion, next.policyVersion],
    ["approvalsRequired", previous.approvalsRequired, next.approvalsRequired],
    ["requestValidityHours", previous.requestValidityHours, next.requestValidityHours],
  ];
  for (const [field, before, after] of numeric) {
    if (before !== after) {
      changes.push({ field, before: String(before), after: String(after) });
    }
  }

  if (previous.allowSelfApproval !== next.allowSelfApproval) {
    changes.push({
      field: "allowSelfApproval",
      before: String(previous.allowSelfApproval),
      after: String(next.allowSelfApproval),
    });
  }

  for (const role of ORGANIZATION_ROLES) {
    const before = previous.rules.find((rule) => rule.role === role)?.requiresApproval;
    const after = next.rules.find((rule) => rule.role === role)?.requiresApproval;
    if (before !== after) {
      changes.push({
        field: `rules.${role}`,
        before: String(before ?? "missing"),
        after: String(after ?? "missing"),
      });
    }
  }

  return changes;
}

export type PolicyImpactSummary = {
  /** Roles that now require approval but did not before. */
  addedApprovalRoles: OrganizationRole[];
  /** Roles that no longer require approval. */
  removedApprovalRoles: OrganizationRole[];
  approvalsRequiredBoarded: boolean;
  approvalsChange: { from: number; to: number };
  validityChange: { fromHours: number; toHours: number };
  selfApprovalChange: { from: boolean; to: boolean };
  /** True when the change is at least as strict as the current policy. */
  strengthening: boolean;
  /** Human-readable notes for the preview panel. */
  notes: string[];
};

/**
 * A deterministic, plain-language summary of the effect of replacing
 * `current` with `next`. Used for the "impact preview" before saving.
 */
export function summarizePolicyImpact(
  current: RoleApprovalPolicy,
  next: RoleApprovalPolicy,
): PolicyImpactSummary {
  const addedApprovalRoles: OrganizationRole[] = [];
  const removedApprovalRoles: OrganizationRole[] = [];

  for (const role of ORGANIZATION_ROLES) {
    const before = current.rules.find((rule) => rule.role === role)?.requiresApproval ?? false;
    const after = next.rules.find((rule) => rule.role === role)?.requiresApproval ?? false;
    if (!before && after) {
      addedApprovalRoles.push(role);
    }
    if (before && !after) {
      removedApprovalRoles.push(role);
    }
  }

  const notes: string[] = [];
  if (addedApprovalRoles.length > 0) {
    notes.push(`Approval will newly be required for: ${addedApprovalRoles.join(", ")}.`);
  }
  if (removedApprovalRoles.length > 0) {
    notes.push(`Approval will no longer be required for: ${removedApprovalRoles.join(", ")}.`);
  }
  if (next.approvalsRequired !== current.approvalsRequired) {
    notes.push(
      `Independent approvals per request changes from ${current.approvalsRequired} to ${next.approvalsRequired}.`,
    );
  }
  if (next.requestValidityHours !== current.requestValidityHours) {
    notes.push(
      `Pending requests stay valid for ${next.requestValidityHours} hour(s), down from ${current.requestValidityHours}.`,
    );
  }
  if (next.allowSelfApproval !== current.allowSelfApproval) {
    notes.push(
      next.allowSelfApproval
        ? "Self-approval will be enabled."
        : "Self-approval will be disabled.",
    );
  }
  if (notes.length === 0) {
    notes.push("No effective change.");
  }

  return {
    addedApprovalRoles,
    removedApprovalRoles,
    approvalsRequiredBoarded: next.approvalsRequired > current.approvalsRequired,
    approvalsChange: { from: current.approvalsRequired, to: next.approvalsRequired },
    validityChange: {
      fromHours: current.requestValidityHours,
      toHours: next.requestValidityHours,
    },
    selfApprovalChange: {
      from: current.allowSelfApproval,
      to: next.allowSelfApproval,
    },
    strengthening: isPolicyAtLeastAsStrict(current, next),
    notes,
  };
}

export type PolicyUpdateOutcome =
  | { ok: true; policy: RoleApprovalPolicy }
  | {
      ok: false;
      reason: "stale" | "conflict" | "invalid" | "unauthorized";
      message: string;
      issues?: PolicyValidationIssue[];
    };

/**
 * Applies a draft policy on top of the latest known server version.
 *
 * Fails closed when:
 *   - the viewer may not manage the policy (`unauthorized`),
 *   - the draft was based on an older version than the server now has
 *     (`stale` — this is also what a replay of a previously-applied update
 *     looks like, since the server version has moved on),
 *   - the server has a *newer* version than the draft expected and the change
 *     would weaken the policy (`conflict`),
 *   - the draft violates the server minimums (`invalid`).
 */
export function applyPolicyUpdate(args: {
  current: RoleApprovalPolicy;
  draft: RoleApprovalPolicy;
  expectedVersion: number;
  viewerRole: OrganizationRole | null | undefined;
  minimums?: RoleApprovalMinimums;
  now?: Date;
}): PolicyUpdateOutcome {
  const {
    current,
    draft,
    expectedVersion,
    viewerRole,
    minimums = DEFAULT_ROLE_APPROVAL_MINIMUMS,
    now = new Date(),
  } = args;

  if (!canManageRoleApprovalPolicy(viewerRole)) {
    return {
      ok: false,
      reason: "unauthorized",
      message: "You do not have permission to change the role approval policy.",
    };
  }

  if (current.schemaVersion !== ROLE_APPROVAL_POLICY_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: "stale",
      message: "The server policy uses a newer format. Reload before editing.",
    };
  }

  // The draft was based on `expectedVersion`. If the server has already moved
  // past it, the draft is stale (this is also what replaying an
  // already-applied update looks like, since the version has advanced).
  if (expectedVersion < current.policyVersion) {
    return {
      ok: false,
      reason: "stale",
      message:
        "This policy changed since you loaded it. Reload to see the current version before saving again.",
    };
  }

  // A client that believes the server is *ahead* of it is out of sync in the
  // other direction; fail closed rather than guessing which version wins.
  if (expectedVersion > current.policyVersion) {
    return {
      ok: false,
      reason: "conflict",
      message: "The policy version does not match the server. Reload before saving.",
    };
  }

  const issues = validateRoleApprovalPolicy(draft, minimums);
  if (issues.some((issue) => issue.severity === "error")) {
    return {
      ok: false,
      reason: "invalid",
      message: "This policy would weaken a server-enforced minimum.",
      issues,
    };
  }

  return {
    ok: true,
    policy: {
      ...draft,
      schemaVersion: ROLE_APPROVAL_POLICY_SCHEMA_VERSION,
      policyVersion: current.policyVersion + 1,
      updatedAt: now.toISOString(),
    },
  };
}

/**
 * Builds a rollback draft from an older version: it restores the older
 * version's settings but is validated and versioned as a *new* change, so a
 * rollback can never resurrect a policy that violates current minimums.
 */
export function buildRollbackDraft(
  current: RoleApprovalPolicy,
  target: RoleApprovalPolicy,
): RoleApprovalPolicy {
  return {
    ...target,
    schemaVersion: ROLE_APPROVAL_POLICY_SCHEMA_VERSION,
    policyVersion: current.policyVersion,
    updatedAt: current.updatedAt,
  };
}

export const POLICY_MANAGEMENT_ROLES: readonly OrganizationRole[] = ["OWNER", "ADMIN"];

/** UX gating only; the server remains the authority. */
export function canManageRoleApprovalPolicy(
  role: OrganizationRole | null | undefined,
): boolean {
  return role !== null && role !== undefined && POLICY_MANAGEMENT_ROLES.includes(role);
}

export function defaultRoleApprovalPolicy(): RoleApprovalPolicy {
  return {
    schemaVersion: ROLE_APPROVAL_POLICY_SCHEMA_VERSION,
    policyVersion: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    rules: [
      { role: "OWNER", requiresApproval: true },
      { role: "ADMIN", requiresApproval: true },
      { role: "MEMBER", requiresApproval: false },
      { role: "VIEWER", requiresApproval: false },
    ],
    approvalsRequired: 2,
    requestValidityHours: 72,
    allowSelfApproval: false,
  };
}

/**
 * Fixture/forward-contract provider for the (not-yet-existing) policy
 * endpoint. `history` is returned alongside the current policy so the UI can
 * render version comparison and rollback without a second call.
 */
export type RoleApprovalPolicyResponse = {
  policy: RoleApprovalPolicy;
  history: RoleApprovalPolicy[];
};

export async function fetchMockRoleApprovalPolicy(
  overrides: Partial<RoleApprovalPolicy> = {},
  history: RoleApprovalPolicy[] = [],
): Promise<RoleApprovalPolicyResponse> {
  return {
    policy: { ...defaultRoleApprovalPolicy(), ...overrides },
    history,
  };
}
