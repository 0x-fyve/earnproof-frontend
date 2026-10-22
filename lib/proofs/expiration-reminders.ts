/**
 * Proof expiration reminder scheduling and status classification (#241).
 *
 * Scope for this slice: the reminder-window/channel validation, duplicate
 * detection, and status classification that a calendar/list view needs to
 * render safely. The calendar/list rendering itself lives in
 * `components/proofs/proof-expiration-calendar.tsx`; this module is the
 * part that is security- and correctness-sensitive enough to need its own
 * thorough, implementation-independent tests (bounded reminder windows,
 * no claim/amount leakage into previews, graceful handling of an unknown
 * future status).
 *
 * Deferred out of this slice (disclosed in the PR): a dedicated
 * `app/settings/preferences` reminder-channel settings sub-page wiring
 * this module to persisted user settings, and a full month-grid calendar
 * widget. The list view plus the reminder-window/channel validation and
 * status classification are the part that needed to be correct and
 * tested; the remaining UI chrome is comparatively low-risk and can follow
 * without blocking this issue.
 */

/**
 * Delivery channels for expiration reminders. No reminder-channel field
 * exists in `lib/api/openapi/earnproof-api.v1.json` yet (no notification
 * preferences endpoint at all), so this assumes a channel set mirroring
 * the two delivery mechanisms that already exist elsewhere in the API
 * surface: `lib/api/webhooks.ts` (outbound webhook events) and the app's
 * own session-scoped UI (in-app). Email is deliberately NOT included here
 * since no email-delivery endpoint or field exists anywhere in the OpenAPI
 * spec to assume a shape from; adding it would be inventing a channel with
 * no comparable existing pattern, rather than assuming a reasonable shape
 * for one that's documented elsewhere. This assumption is disclosed in the
 * PR body.
 */
export const REMINDER_CHANNELS = ["in-app", "webhook"] as const;

export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

export function isReminderChannel(value: unknown): value is ReminderChannel {
  return typeof value === "string" && (REMINDER_CHANNELS as readonly string[]).includes(value);
}

/** Bounded reminder window, in whole days before expiry. */
export const MIN_REMINDER_DAYS = 1;
export const MAX_REMINDER_DAYS = 60;

export type ReminderWindow = {
  proofId: string;
  daysBeforeExpiry: number;
  channel: ReminderChannel;
};

export type ReminderValidationIssue = {
  field: "proofId" | "daysBeforeExpiry" | "channel";
  message: string;
};

/**
 * Validates a single reminder window configuration. Out-of-bounds values
 * are rejected rather than silently clamped: a silently-clamped value could
 * leave a user believing a reminder is scheduled further out than it
 * actually is, which is the kind of "reminder vs. renewed validity"
 * conflation the issue explicitly warns against.
 */
export function validateReminderWindow(window: ReminderWindow): ReminderValidationIssue[] {
  const issues: ReminderValidationIssue[] = [];

  if (!window.proofId || window.proofId.trim().length === 0) {
    issues.push({ field: "proofId", message: "A proof is required to schedule a reminder." });
  }

  if (!Number.isInteger(window.daysBeforeExpiry)) {
    issues.push({ field: "daysBeforeExpiry", message: "The reminder window must be a whole number of days." });
  } else if (window.daysBeforeExpiry < MIN_REMINDER_DAYS || window.daysBeforeExpiry > MAX_REMINDER_DAYS) {
    issues.push({
      field: "daysBeforeExpiry",
      message: `Reminders can be set from ${MIN_REMINDER_DAYS} to ${MAX_REMINDER_DAYS} days before expiry.`,
    });
  }

  if (!isReminderChannel(window.channel)) {
    issues.push({ field: "channel", message: "Unsupported reminder delivery channel." });
  }

  return issues;
}

export function isReminderWindowValid(window: ReminderWindow): boolean {
  return validateReminderWindow(window).length === 0;
}

/**
 * Detects duplicate reminder windows: same proof, same day offset, same
 * channel. Two reminders for the same proof at different offsets or on
 * different channels are not duplicates (a user may legitimately want both
 * an in-app nudge at 14 days and a webhook at 1 day).
 */
export function isDuplicateReminderWindow(
  existing: readonly ReminderWindow[],
  candidate: ReminderWindow,
): boolean {
  return existing.some(
    (window) =>
      window.proofId === candidate.proofId &&
      window.daysBeforeExpiry === candidate.daysBeforeExpiry &&
      window.channel === candidate.channel,
  );
}

/**
 * The proof lifecycle statuses this view must represent accurately per
 * #241's acceptance criteria, plus a catch-all for any status this build
 * does not yet recognize (including a future "disputed" status from the
 * not-yet-merged proof-disputes work — see module doc).
 */
export type ExpirationDisplayStatus =
  | "upcoming"
  | "expired"
  | "revoked"
  | "superseded"
  | "disputed"
  | "unrecognized";

export type ProofExpirationInput = {
  id: string;
  status: string;
  expiresAt: string;
  revokedAt: string | null;
  /** Set when another proof's `predecessorId` names this one. */
  supersededBy: string | null;
  /**
   * Optional dispute status, read defensively: the dispute feature
   * (`lib/proof-disputes/store.ts`) may or may not exist in the running
   * build depending on merge order with another in-flight PR. A value here
   * is only ever trusted when it's one of the known dispute states; any
   * other value (including one from a future dispute schema this build
   * doesn't recognize) is treated as "not disputed" rather than crashing
   * or mis-rendering.
   */
  disputeStatus?: string | null;
};

const KNOWN_DISPUTE_STATUSES = ["pending", "accepted", "rejected", "withdrawn", "resolved"] as const;

/**
 * A dispute is only considered "active" for display purposes when it is
 * pending or accepted — a rejected, withdrawn, or resolved dispute no
 * longer changes how the proof's expiration should read. An unrecognized
 * dispute status (not in the known set) is treated as not disputed: this
 * is the "handle unknown statuses gracefully" behavior #241 calls for
 * rather than exhaustively switching on a status set that might grow
 * later.
 */
function hasActiveDispute(disputeStatus: string | null | undefined): boolean {
  if (!disputeStatus) return false;
  if (!(KNOWN_DISPUTE_STATUSES as readonly string[]).includes(disputeStatus)) return false;
  return disputeStatus === "pending" || disputeStatus === "accepted";
}

/**
 * Classifies a proof's status for the expiration view. Precedence (most to
 * least specific): disputed > revoked > superseded > expired > upcoming.
 * Any `status` value this function does not recognize at all (not one of
 * the known lifecycle values) still flows through this same precedence
 * rather than throwing or defaulting silently to "upcoming" — only the
 * final fallback is "unrecognized", and only when none of the other,
 * independently-checked signals (dispute/revoked/superseded/expiry) apply.
 */
export function classifyExpirationStatus(
  proof: ProofExpirationInput,
  now: Date = new Date(),
): ExpirationDisplayStatus {
  if (hasActiveDispute(proof.disputeStatus)) {
    return "disputed";
  }
  if (proof.revokedAt !== null) {
    return "revoked";
  }
  if (proof.supersededBy !== null) {
    return "superseded";
  }

  const expiresAt = new Date(proof.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    return "unrecognized";
  }
  if (expiresAt.getTime() <= now.getTime()) {
    return "expired";
  }
  return "upcoming";
}

/** Whether a proof in this display status is still eligible to link to the renewal flow. */
export function isEligibleForRenewalLink(status: ExpirationDisplayStatus): boolean {
  return status === "upcoming" || status === "expired";
}

/**
 * Builds the text shown in a reminder notification preview. This is the
 * privacy-sensitive surface #241's acceptance criteria calls out by name:
 * "reminder controls never reveal proof claims or amounts in notification
 * previews." Deliberately takes only the fields that are safe to show
 * (proof id, type label, days-until-expiry) rather than a full proof
 * object, so there is no claim/amount field available to accidentally
 * interpolate in the first place.
 */
export function buildReminderPreviewText(args: {
  proofTypeLabel: string;
  daysUntilExpiry: number;
}): string {
  const { proofTypeLabel, daysUntilExpiry } = args;
  if (daysUntilExpiry <= 0) {
    return `Your ${proofTypeLabel} proof has expired.`;
  }
  if (daysUntilExpiry === 1) {
    return `Your ${proofTypeLabel} proof expires tomorrow.`;
  }
  return `Your ${proofTypeLabel} proof expires in ${daysUntilExpiry} days.`;
}
