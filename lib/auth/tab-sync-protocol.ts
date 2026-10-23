/**
 * Cross-tab auth/tenant sync wire protocol (#274).
 *
 * Pure, side-effect-free: message schema, validation and conflict
 * resolution only. The transport lives in lib/storage/tab-sync-transport.ts
 * and the stateful coordinator in lib/auth/tab-sync-coordinator.ts.
 *
 * Guarantees encoded here (see lib/auth/ARCHITECTURE.md "Cross-tab sync"):
 * - A message is exactly `{ v, type, epoch, tabId, tenantId?, ts }`. Any
 *   other field is rejected, so a payload that tries to smuggle a token,
 *   session id, wallet address or claim value is dropped rather than
 *   stripped and accepted.
 * - Every event type is a DOWNGRADE (revoke, log out, expire recent auth,
 *   drop tenant-scoped data). There is deliberately no "login",
 *   "session_recovered" or "role_granted" type: nothing received over the
 *   channel can authenticate a tab or grant a role.
 * - Unknown versions, unknown types, malformed or oversized payloads fail
 *   closed with an explicit rejection reason.
 */

export const TAB_SYNC_PROTOCOL_VERSION = 1 as const;

/** Upper bound on a serialized message, in UTF-8 bytes. A valid message is well under 200 bytes. */
export const TAB_SYNC_MAX_MESSAGE_BYTES = 256;

/**
 * A message's `ts` must be within this many milliseconds of the receiver's
 * clock (in either direction). Age exactly equal to the window is accepted;
 * one millisecond more is rejected as stale.
 */
export const TAB_SYNC_MAX_CLOCK_SKEW_MS = 30_000;

export const TAB_SYNC_EVENT_TYPES = [
  "session_revoked",
  "wallet_logout",
  "recent_auth_expired",
  "tenant_switched",
] as const;

export type TabSyncEventType = (typeof TAB_SYNC_EVENT_TYPES)[number];

/**
 * Most restrictive wins: revocation > logout > recent-auth expiry > tenant
 * switch. Effects are cumulative - applying a more restrictive event also
 * performs every less restrictive downgrade (see ARCHITECTURE.md) - so
 * dropping a concurrent, less restrictive message never loses a downgrade.
 */
export const TAB_SYNC_RESTRICTIVENESS: Readonly<Record<TabSyncEventType, number>> = {
  session_revoked: 4,
  wallet_logout: 3,
  recent_auth_expired: 2,
  tenant_switched: 1,
};

export interface TabSyncMessage {
  v: typeof TAB_SYNC_PROTOCOL_VERSION;
  type: TabSyncEventType;
  /**
   * Hybrid logical clock assigned by the sender: max(previous epoch + 1,
   * sender wall clock ms), and never below any epoch it has received.
   */
  epoch: number;
  tabId: string;
  /** Informational only; never used for authorization. Allowed on tenant_switched only. */
  tenantId?: string;
  /** Sender wall-clock time in epoch milliseconds. */
  ts: number;
}

export type TabSyncRejectReason =
  | "malformed"
  | "oversized"
  | "unsupported_version"
  | "unknown_type"
  | "unexpected_field"
  | "invalid_epoch"
  | "invalid_tab_id"
  | "invalid_tenant_id"
  | "invalid_timestamp"
  | "stale_timestamp";

export type TabSyncValidationResult =
  | { ok: true; message: TabSyncMessage }
  | { ok: false; reason: TabSyncRejectReason };

const ALLOWED_FIELDS = new Set(["v", "type", "epoch", "tabId", "tenantId", "ts"]);
const TAB_ID_PATTERN = /^[a-f0-9]{16,64}$/;
// Organization ids are opaque identifiers; no dots, so a JWT can never pass.
const TENANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTabSyncEventType(value: unknown): value is TabSyncEventType {
  return typeof value === "string" && (TAB_SYNC_EVENT_TYPES as readonly string[]).includes(value);
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function isValidTabId(value: unknown): value is string {
  return typeof value === "string" && TAB_ID_PATTERN.test(value);
}

/**
 * Validates an already-parsed value. `now` is the receiver's clock, used for
 * the allowed clock skew.
 */
export function validateTabSyncMessage(value: unknown, now: number): TabSyncValidationResult {
  if (!isRecord(value)) return { ok: false, reason: "malformed" };

  // Version is checked before the field whitelist so a future version with a
  // different shape is reported as unsupported rather than malformed.
  if (value.v !== TAB_SYNC_PROTOCOL_VERSION) return { ok: false, reason: "unsupported_version" };
  if (!isTabSyncEventType(value.type)) return { ok: false, reason: "unknown_type" };

  for (const key of Object.keys(value)) {
    if (!ALLOWED_FIELDS.has(key)) return { ok: false, reason: "unexpected_field" };
  }

  const { epoch, tabId, tenantId, ts, type } = value;

  // Epochs are hybrid logical clock values (>= the sender's wall clock), so
  // one far in the receiver's future is forged or broken; accepting it would
  // make every later legitimate message look like a replay.
  if (
    typeof epoch !== "number" ||
    !Number.isSafeInteger(epoch) ||
    epoch < 1 ||
    epoch > now + TAB_SYNC_MAX_CLOCK_SKEW_MS
  ) {
    return { ok: false, reason: "invalid_epoch" };
  }
  if (!isValidTabId(tabId)) return { ok: false, reason: "invalid_tab_id" };

  if ("tenantId" in value) {
    if (type !== "tenant_switched") return { ok: false, reason: "unexpected_field" };
    if (typeof tenantId !== "string" || !TENANT_ID_PATTERN.test(tenantId)) {
      return { ok: false, reason: "invalid_tenant_id" };
    }
  }

  if (typeof ts !== "number" || !Number.isSafeInteger(ts) || ts <= 0) {
    return { ok: false, reason: "invalid_timestamp" };
  }
  if (Math.abs(now - ts) > TAB_SYNC_MAX_CLOCK_SKEW_MS) return { ok: false, reason: "stale_timestamp" };

  const message: TabSyncMessage = { v: TAB_SYNC_PROTOCOL_VERSION, type, epoch, tabId, ts };
  if (typeof tenantId === "string") message.tenantId = tenantId;
  return { ok: true, message };
}

/**
 * Decodes a raw transport payload. The size cap is enforced on the raw
 * string BEFORE parsing, so an oversized payload is never parsed at all.
 */
export function decodeTabSyncPayload(raw: unknown, now: number): TabSyncValidationResult {
  if (typeof raw !== "string") return { ok: false, reason: "malformed" };
  if (utf8ByteLength(raw) > TAB_SYNC_MAX_MESSAGE_BYTES) return { ok: false, reason: "oversized" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  return validateTabSyncMessage(parsed, now);
}

/** Serializes a message, returning null if it would exceed the size cap. */
export function encodeTabSyncMessage(message: TabSyncMessage): string | null {
  const serialized = JSON.stringify(message);
  return utf8ByteLength(serialized) > TAB_SYNC_MAX_MESSAGE_BYTES ? null : serialized;
}

export interface TabSyncAppliedMarker {
  epoch: number;
  tabId: string;
  type: TabSyncEventType;
}

export type TabSyncDecision =
  | { apply: true }
  | { apply: false; reason: "own_message" | "replay" | "superseded" };

/**
 * Deterministic conflict resolution against the last applied (or locally
 * published) message:
 *
 * 1. Own messages are never applied.
 * 2. Higher epoch wins: epoch > last.epoch applies; epoch < last.epoch is a replay.
 * 3. Equal epoch from the same tab is a replay.
 * 4. Equal epoch from a different tab is a concurrent event: the more
 *    restrictive type wins; equal restrictiveness falls back to the
 *    lexicographically greater tabId.
 *
 * Because effects are cumulative (see TAB_SYNC_RESTRICTIVENESS), the final
 * local state for any set of concurrent messages is the same regardless of
 * arrival order.
 */
export function decideTabSyncMessage(
  last: TabSyncAppliedMarker | null,
  incoming: TabSyncMessage,
  ownTabId: string,
): TabSyncDecision {
  if (incoming.tabId === ownTabId) return { apply: false, reason: "own_message" };
  if (!last) return { apply: true };
  if (incoming.epoch > last.epoch) return { apply: true };
  if (incoming.epoch < last.epoch) return { apply: false, reason: "replay" };
  if (incoming.tabId === last.tabId) return { apply: false, reason: "replay" };

  const incomingRank = TAB_SYNC_RESTRICTIVENESS[incoming.type];
  const lastRank = TAB_SYNC_RESTRICTIVENESS[last.type];
  if (incomingRank !== lastRank) {
    return incomingRank > lastRank ? { apply: true } : { apply: false, reason: "superseded" };
  }
  return incoming.tabId > last.tabId ? { apply: true } : { apply: false, reason: "superseded" };
}
