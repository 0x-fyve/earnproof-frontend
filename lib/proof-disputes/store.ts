/**
 * Proof dispute submission and review (#234).
 *
 * There is no dispute concept anywhere in this repo's proof schemas
 * (ProofListItem, the OpenAPI spec, lib/api/generated/v1.ts) or a
 * dispute endpoint in lib/api - the backend has nowhere to store one.
 * Disputes are therefore a client-local record store, following the
 * same "the backend doesn't model this yet" pattern as
 * lib/proof-renewal/store.ts and lib/proof-sharing/store.ts.
 *
 * Unlike those two stores, this one is namespaced per `proofId`, not
 * per submitting user: a dispute needs to be visible to parties other
 * than its submitter (an ISSUER or ADMIN reviewing it), so scoping
 * storage by the disputant's own userId - the pattern renewal/sharing
 * use, where only the acting user themselves ever needs to read their
 * own records back - would make review impossible by construction.
 * Scoping by proof id instead means anyone who can reach a given
 * proof's page can read its dispute list, which matches how the rest of
 * this app already treats proof-scoped data (lifecycle, lineage,
 * sharing links) as visible to whoever is looking at that proof.
 *
 * This is itself a disclosed scope-down: a real implementation would
 * need the backend to enforce who may read a given proof's disputes
 * (e.g. its subject and its issuer's org), not just who may act on one.
 * Authorization for *actions* (submit/withdraw/review) is enforced by
 * lib/validation/proof-dispute.ts regardless of what's readable.
 *
 * #234's own acceptance criterion - "keep dispute state separate from
 * cryptographic validity and revocation" - is honored the same way
 * #168's renewal store keeps "the predecessor remains independently
 * verifiable": this module never reads, writes, or otherwise touches a
 * proof's status/revokedAt. A dispute record is purely an annotation
 * layered on top of a proof id; resolving, rejecting, or withdrawing a
 * dispute never changes whether the proof itself verifies.
 */

export const DISPUTE_CATEGORIES = [
  "incorrect_amount",
  "unauthorized_claim",
  "stale_data",
  "wrong_recipient",
  "other",
] as const;
export type DisputeCategory = (typeof DISPUTE_CATEGORIES)[number];

export const DISPUTE_STATES = ["pending", "accepted", "rejected", "withdrawn", "resolved"] as const;
export type DisputeState = (typeof DISPUTE_STATES)[number];

/**
 * A single timestamped state transition, kept for an accessible,
 * auditable history (#234's "state transitions are timestamped and
 * accessible" acceptance criterion).
 */
export type DisputeTransition = {
  state: DisputeState;
  at: string; // ISO 8601
  actorId: string;
  note?: string;
};

/**
 * `evidenceCommitment` is a hash/reference the disputant provides, never
 * rendered HTML/markdown and never raw file content - see
 * lib/validation/proof-dispute.ts's isSafeEvidenceCommitment for the
 * "sensitive evidence is never rendered from untrusted content"
 * acceptance criterion. This module stores only that commitment string,
 * a category, and an optional plain-text note.
 */
export type DisputeRecord = {
  id: string;
  proofId: string;
  submittedBy: string; // userId of the disputant
  category: DisputeCategory;
  evidenceCommitment: string;
  note?: string;
  state: DisputeState;
  createdAt: string;
  history: DisputeTransition[];
};

function storageKey(proofId: string): string {
  return `earnproof.proof-disputes.${proofId}`;
}

function isDisputeTransition(value: unknown): value is DisputeTransition {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.state === "string" &&
    (DISPUTE_STATES as readonly string[]).includes(t.state) &&
    typeof t.at === "string" &&
    typeof t.actorId === "string" &&
    (t.note === undefined || typeof t.note === "string")
  );
}

function isDisputeRecord(value: unknown): value is DisputeRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.proofId === "string" &&
    typeof r.submittedBy === "string" &&
    typeof r.category === "string" &&
    (DISPUTE_CATEGORIES as readonly string[]).includes(r.category) &&
    typeof r.evidenceCommitment === "string" &&
    (r.note === undefined || typeof r.note === "string") &&
    typeof r.state === "string" &&
    (DISPUTE_STATES as readonly string[]).includes(r.state) &&
    typeof r.createdAt === "string" &&
    Array.isArray(r.history) &&
    r.history.every(isDisputeTransition)
  );
}

function readAll(proofId: string): DisputeRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(proofId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDisputeRecord);
  } catch {
    return [];
  }
}

function writeAll(proofId: string, records: DisputeRecord[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(proofId), JSON.stringify(records));
}

export function listDisputes(proofId: string): DisputeRecord[] {
  return readAll(proofId);
}

export function findDispute(proofId: string, disputeId: string): DisputeRecord | null {
  return readAll(proofId).find((record) => record.id === disputeId) ?? null;
}

export class DuplicateDisputeError extends Error {
  constructor() {
    super("A pending dispute already exists for this proof.");
    this.name = "DuplicateDisputeError";
  }
}

/**
 * Submitting a new dispute while a pending one already exists for the
 * same proof is rejected (#234's "duplicate disputes" test requirement)
 * - a proof should only ever have one open dispute at a time; a
 * withdrawn/rejected/resolved prior dispute does not block a new one.
 */
export function submitDispute(
  submittedBy: string,
  input: { proofId: string; category: DisputeCategory; evidenceCommitment: string; note?: string },
): DisputeRecord {
  const existing = readAll(input.proofId);
  const hasPending = existing.some((record) => record.state === "pending");
  if (hasPending) {
    throw new DuplicateDisputeError();
  }

  const now = new Date().toISOString();
  const record: DisputeRecord = {
    id: `dispute-${input.proofId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    proofId: input.proofId,
    submittedBy,
    category: input.category,
    evidenceCommitment: input.evidenceCommitment,
    note: input.note,
    state: "pending",
    createdAt: now,
    history: [{ state: "pending", at: now, actorId: submittedBy }],
  };

  writeAll(input.proofId, [...existing, record]);
  return record;
}

export class DisputeNotFoundError extends Error {
  constructor() {
    super("Dispute not found.");
    this.name = "DisputeNotFoundError";
  }
}

export class InvalidDisputeTransitionError extends Error {
  constructor(from: DisputeState, to: DisputeState) {
    super(`Cannot transition a dispute from "${from}" to "${to}".`);
    this.name = "InvalidDisputeTransitionError";
  }
}

/**
 * Valid transitions out of each state. Every terminal state
 * (rejected/withdrawn/resolved) has none - once a dispute leaves
 * "pending" or "accepted" it cannot be reopened, since #234 asks for a
 * clean, auditable progression rather than a reversible one.
 */
const ALLOWED_TRANSITIONS: Record<DisputeState, readonly DisputeState[]> = {
  pending: ["accepted", "rejected", "withdrawn"],
  accepted: ["resolved", "withdrawn"],
  rejected: [],
  withdrawn: [],
  resolved: [],
};

function transition(
  proofId: string,
  disputeId: string,
  nextState: DisputeState,
  actorId: string,
  note?: string,
): DisputeRecord {
  const records = readAll(proofId);
  const index = records.findIndex((record) => record.id === disputeId);
  if (index === -1) {
    throw new DisputeNotFoundError();
  }

  const current = records[index];
  if (!ALLOWED_TRANSITIONS[current.state].includes(nextState)) {
    throw new InvalidDisputeTransitionError(current.state, nextState);
  }

  const at = new Date().toISOString();
  const updated: DisputeRecord = {
    ...current,
    state: nextState,
    history: [...current.history, { state: nextState, at, actorId, note }],
  };

  const next = [...records];
  next[index] = updated;
  writeAll(proofId, next);
  return updated;
}

/** Withdrawal is the disputant's own action - see lib/validation/proof-dispute.ts's canWithdrawDispute for the eligibility gate. */
export function withdrawDispute(proofId: string, disputeId: string, actorId: string): DisputeRecord {
  return transition(proofId, disputeId, "withdrawn", actorId);
}

/** Accept/reject/resolve are reviewer actions - see lib/validation/proof-dispute.ts's canReviewDispute for the eligibility gate. */
export function acceptDispute(proofId: string, disputeId: string, actorId: string, note?: string): DisputeRecord {
  return transition(proofId, disputeId, "accepted", actorId, note);
}

export function rejectDispute(proofId: string, disputeId: string, actorId: string, note?: string): DisputeRecord {
  return transition(proofId, disputeId, "rejected", actorId, note);
}

export function resolveDispute(proofId: string, disputeId: string, actorId: string, note?: string): DisputeRecord {
  return transition(proofId, disputeId, "resolved", actorId, note);
}
