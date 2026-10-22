/**
 * Privileged role change request and approval workspace (#238).
 *
 * There is no role-change-*request* concept anywhere in the OpenAPI spec
 * or lib/api/organization-members.ts - that module's
 * updateOrganizationMemberRole is a direct, immediate role change with no
 * request/approval step. #238 exists precisely because a direct change
 * "makes independent approval difficult to review" - so this is a new,
 * client-local request/approval layer sitting in front of that existing
 * direct-change endpoint, following the same disclosed "the backend
 * doesn't model this yet" pattern as lib/organization-archival/store.ts
 * (client-local reauth tracking) and lib/proof-disputes/store.ts.
 *
 * Requests are namespaced per organization id (not per user), for the
 * same reason lib/proof-disputes/store.ts moved from a per-submitter to
 * a per-proof namespace: an approver who did not create the request
 * must still be able to see and act on it.
 */

export const ROLE_CHANGE_REQUEST_STATES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "expired",
] as const;
export type RoleChangeRequestState = (typeof ROLE_CHANGE_REQUEST_STATES)[number];

export type RoleChangeApprovalRecord = {
  approverId: string;
  decidedAt: string; // ISO 8601
};

export type RoleChangeRequest = {
  id: string;
  organizationId: string;
  requesterId: string;
  targetMemberId: string;
  oldRole: string;
  proposedRole: string;
  justification: string;
  state: RoleChangeRequestState;
  createdAt: string; // ISO 8601
  expiresAt: string; // ISO 8601
  /** Independent approvals already recorded for this request. */
  approvals: RoleChangeApprovalRecord[];
  /** Set only when state is "rejected". */
  rejection?: { approverId: string; decidedAt: string; reason?: string };
  /** Set only when state is "cancelled". */
  cancellation?: { actorId: string; decidedAt: string };
};

function storageKey(organizationId: string): string {
  return `earnproof.role-change-requests.${organizationId}`;
}

function isApprovalRecord(value: unknown): value is RoleChangeApprovalRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return typeof r.approverId === "string" && typeof r.decidedAt === "string";
}

function isRoleChangeRequest(value: unknown): value is RoleChangeRequest {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.organizationId === "string" &&
    typeof r.requesterId === "string" &&
    typeof r.targetMemberId === "string" &&
    typeof r.oldRole === "string" &&
    typeof r.proposedRole === "string" &&
    typeof r.justification === "string" &&
    typeof r.state === "string" &&
    (ROLE_CHANGE_REQUEST_STATES as readonly string[]).includes(r.state) &&
    typeof r.createdAt === "string" &&
    typeof r.expiresAt === "string" &&
    Array.isArray(r.approvals) &&
    r.approvals.every(isApprovalRecord)
  );
}

function readAll(organizationId: string): RoleChangeRequest[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(organizationId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRoleChangeRequest);
  } catch {
    return [];
  }
}

function writeAll(organizationId: string, records: RoleChangeRequest[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(organizationId), JSON.stringify(records));
}

/**
 * Lazily expires any request whose `expiresAt` has passed and is still
 * "pending" - called on every read so expiry is always reflected without
 * needing a background job. Mirrors lib/proof-renewal's "derive instead
 * of trusting a possibly-stale persisted state" approach, except here the
 * derived state (expired) is also persisted back so an expired request's
 * terminal status survives the next read even if `now` later moves past
 * a reload boundary in a test.
 */
function withExpiryApplied(organizationId: string, records: RoleChangeRequest[], now: Date): RoleChangeRequest[] {
  let changed = false;
  const next = records.map((record) => {
    if (record.state === "pending" && new Date(record.expiresAt).getTime() <= now.getTime()) {
      changed = true;
      return { ...record, state: "expired" as const };
    }
    return record;
  });

  if (changed) {
    writeAll(organizationId, next);
  }
  return next;
}

export function listRoleChangeRequests(organizationId: string, now: Date = new Date()): RoleChangeRequest[] {
  return withExpiryApplied(organizationId, readAll(organizationId), now);
}

export function findRoleChangeRequest(
  organizationId: string,
  requestId: string,
  now: Date = new Date(),
): RoleChangeRequest | null {
  return listRoleChangeRequests(organizationId, now).find((request) => request.id === requestId) ?? null;
}

export class DuplicateRoleChangeRequestError extends Error {
  constructor() {
    super("A pending role change request already exists for this member.");
    this.name = "DuplicateRoleChangeRequestError";
  }
}

/**
 * Submitting a new request while a pending one already exists for the
 * same target member is rejected - a member should only have one open
 * role-change request in flight. A stale (expired) or already-decided
 * (approved/rejected/cancelled) prior request never blocks a new one,
 * satisfying #238's "stale or already-decided requests cannot be
 * submitted again" criterion by making *the prior request itself*
 * final, not by reusing it.
 */
export function submitRoleChangeRequest(
  organizationId: string,
  input: {
    requesterId: string;
    targetMemberId: string;
    oldRole: string;
    proposedRole: string;
    justification: string;
    validityHours: number;
  },
  now: Date = new Date(),
): RoleChangeRequest {
  const existing = listRoleChangeRequests(organizationId, now);
  const hasPending = existing.some(
    (request) => request.targetMemberId === input.targetMemberId && request.state === "pending",
  );
  if (hasPending) {
    throw new DuplicateRoleChangeRequestError();
  }

  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + input.validityHours * 60 * 60 * 1000).toISOString();

  const record: RoleChangeRequest = {
    id: `role-change-${input.targetMemberId}-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    organizationId,
    requesterId: input.requesterId,
    targetMemberId: input.targetMemberId,
    oldRole: input.oldRole,
    proposedRole: input.proposedRole,
    justification: input.justification,
    state: "pending",
    createdAt,
    expiresAt,
    approvals: [],
  };

  writeAll(organizationId, [...existing, record]);
  return record;
}

export class RoleChangeRequestNotFoundError extends Error {
  constructor() {
    super("Role change request not found.");
    this.name = "RoleChangeRequestNotFoundError";
  }
}

export class InvalidRoleChangeTransitionError extends Error {
  constructor(state: RoleChangeRequestState) {
    super(`Cannot act on a request in the "${state}" state.`);
    this.name = "InvalidRoleChangeTransitionError";
  }
}

export class DuplicateApprovalError extends Error {
  constructor() {
    super("This approver has already approved this request.");
    this.name = "DuplicateApprovalError";
  }
}

function mustBePending(request: RoleChangeRequest): void {
  if (request.state !== "pending") {
    throw new InvalidRoleChangeTransitionError(request.state);
  }
}

function loadMutable(
  organizationId: string,
  requestId: string,
  now: Date,
): { records: RoleChangeRequest[]; index: number; current: RoleChangeRequest } {
  const records = listRoleChangeRequests(organizationId, now);
  const index = records.findIndex((request) => request.id === requestId);
  if (index === -1) {
    throw new RoleChangeRequestNotFoundError();
  }
  return { records, index, current: records[index] };
}

/**
 * Records one independent approval. Does not itself check self-approval
 * or recent-authentication rules - those are UI/eligibility concerns
 * enforced by lib/validation/role-change-request.ts before this is ever
 * called, exactly like lib/proof-disputes keeps review eligibility out
 * of its own store. Once `approvalsRequired` approvals are recorded the
 * request transitions to "approved" automatically.
 */
export function approveRoleChangeRequest(
  organizationId: string,
  requestId: string,
  approverId: string,
  approvalsRequired: number,
  now: Date = new Date(),
): RoleChangeRequest {
  const { records, index, current } = loadMutable(organizationId, requestId, now);
  mustBePending(current);

  if (current.approvals.some((approval) => approval.approverId === approverId)) {
    throw new DuplicateApprovalError();
  }

  const approvals = [...current.approvals, { approverId, decidedAt: now.toISOString() }];
  const updated: RoleChangeRequest = {
    ...current,
    approvals,
    state: approvals.length >= approvalsRequired ? "approved" : "pending",
  };

  const next = [...records];
  next[index] = updated;
  writeAll(organizationId, next);
  return updated;
}

export function rejectRoleChangeRequest(
  organizationId: string,
  requestId: string,
  approverId: string,
  reason?: string,
  now: Date = new Date(),
): RoleChangeRequest {
  const { records, index, current } = loadMutable(organizationId, requestId, now);
  mustBePending(current);

  const updated: RoleChangeRequest = {
    ...current,
    state: "rejected",
    rejection: { approverId, decidedAt: now.toISOString(), reason },
  };

  const next = [...records];
  next[index] = updated;
  writeAll(organizationId, next);
  return updated;
}

export function cancelRoleChangeRequest(
  organizationId: string,
  requestId: string,
  actorId: string,
  now: Date = new Date(),
): RoleChangeRequest {
  const { records, index, current } = loadMutable(organizationId, requestId, now);
  mustBePending(current);

  const updated: RoleChangeRequest = {
    ...current,
    state: "cancelled",
    cancellation: { actorId, decidedAt: now.toISOString() },
  };

  const next = [...records];
  next[index] = updated;
  writeAll(organizationId, next);
  return updated;
}
