/**
 * Proof sharing access history and revocation insights (#221).
 * ===============================================================
 *
 * `lib/proof-sharing/store.ts` already covers creating and revoking share
 * links (see its module doc: no backend endpoint exists for #180 either, so
 * it is a client-local stand-in persisted in localStorage). This module adds
 * the slice that store.ts does NOT cover: a record of each time a token was
 * *used* — accepted, expired-at-use, or rejected — and aggregate counts
 * derived from that record, which is what #221 actually asks for
 * ("access history and revocation insights").
 *
 * Hard privacy requirement (acceptance criteria): a raw token, an IP
 * address, or any verifier-supplied payload must NEVER be rendered or even
 * stored here. `recordAccessAttempt` deliberately has no parameter for any
 * of those — only a coarse, pre-classified outcome and a verifier-opaque
 * placeholder, same spirit as store.ts's "raw token never enters storage".
 *
 * Revocation (owned by store.ts's `revokeShareLink`) only ever flips
 * `revokedAt`; it never deletes or truncates this module's access log, so
 * historical counts survive a revocation.
 */

import type { ShareLinkRecord } from "./store";
import { computeShareLinkStatus, type ShareLinkStatus } from "@/lib/validation/proof-sharing";

export type AccessOutcome = "ACCEPTED" | "EXPIRED" | "REJECTED";

export type AccessEvent = {
  id: string;
  shareLinkId: string;
  outcome: AccessOutcome;
  /** Server clock time of the attempt; never a raw token or request body. */
  occurredAt: string;
};

function storageKey(userId: string): string {
  return `earnproof.proof-share-access-history.${userId}`;
}

function readAll(userId: string): AccessEvent[] {
  if (typeof window === "undefined") {
    return [];
  }
  const stored = window.localStorage.getItem(storageKey(userId));
  if (!stored) {
    return [];
  }
  try {
    return JSON.parse(stored) as AccessEvent[];
  } catch {
    window.localStorage.removeItem(storageKey(userId));
    return [];
  }
}

function writeAll(userId: string, events: AccessEvent[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(storageKey(userId), JSON.stringify(events));
}

/**
 * Records a single access attempt against a share link. Intentionally takes
 * no raw token, IP, or verifier payload — only the pre-classified outcome —
 * so there is nothing sensitive for this function to ever persist.
 */
export function recordAccessAttempt(
  userId: string,
  shareLinkId: string,
  outcome: AccessOutcome,
  now: Date = new Date(),
): AccessEvent {
  const event: AccessEvent = {
    id: `access-${crypto.randomUUID()}`,
    shareLinkId,
    outcome,
    occurredAt: now.toISOString(),
  };
  const events = readAll(userId);
  events.push(event);
  writeAll(userId, events);
  return event;
}

export type ShareLinkAccessSummary = {
  shareLinkId: string;
  status: ShareLinkStatus;
  totalAttempts: number;
  acceptedCount: number;
  expiredCount: number;
  rejectedCount: number;
  /** Most recent attempts first (deterministic: occurredAt desc, then id asc as a tiebreaker). */
  recent: AccessEvent[];
  /** True when rejected attempts clearly outnumber accepted ones. */
  flaggedAsSuspicious: boolean;
};

const SUSPICIOUS_REJECTED_THRESHOLD = 3;

/**
 * Deterministic ordering: newest first by timestamp, and for same-timestamp
 * events (e.g. a test writing several in the same tick), break ties by id
 * so repeated access is always rendered in the same order across renders.
 */
function sortEventsDeterministically(events: AccessEvent[]): AccessEvent[] {
  return [...events].sort((a, b) => {
    const diff = new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
    if (diff !== 0) {
      return diff;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function summarizeAccessHistory(
  userId: string,
  record: ShareLinkRecord,
  now: number = Date.now(),
  recentLimit: number = 10,
): ShareLinkAccessSummary {
  const events = sortEventsDeterministically(
    readAll(userId).filter((event) => event.shareLinkId === record.id),
  );

  const acceptedCount = events.filter((e) => e.outcome === "ACCEPTED").length;
  const expiredCount = events.filter((e) => e.outcome === "EXPIRED").length;
  const rejectedCount = events.filter((e) => e.outcome === "REJECTED").length;

  return {
    shareLinkId: record.id,
    status: computeShareLinkStatus(record.expiresAt, record.revokedAt, now),
    totalAttempts: events.length,
    acceptedCount,
    expiredCount,
    rejectedCount,
    recent: events.slice(0, recentLimit),
    flaggedAsSuspicious: rejectedCount >= SUSPICIOUS_REJECTED_THRESHOLD,
  };
}

/**
 * Deletes nothing: revocation (performed elsewhere, by
 * `store.revokeShareLink`) only changes the link's `revokedAt`. This helper
 * exists purely to make the "historical counts survive revocation"
 * guarantee explicit and testable at this module's boundary — summarizing
 * the same events before and after a revocation must be equal except for
 * `status`.
 */
export function historicalCountsUnaffectedByRevocation(
  before: ShareLinkAccessSummary,
  after: ShareLinkAccessSummary,
): boolean {
  return (
    before.totalAttempts === after.totalAttempts &&
    before.acceptedCount === after.acceptedCount &&
    before.expiredCount === after.expiredCount &&
    before.rejectedCount === after.rejectedCount
  );
}
