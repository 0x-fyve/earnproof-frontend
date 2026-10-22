/**
 * Recent account activity: types, redaction, response validation and the
 * client for the versioned activity endpoint.
 * =================================================================
 *
 * Endpoint: `GET /activity` under the versioned API base (`appConfig.apiUrl`,
 * v1). Query: `limit`, `cursor`, `category`, `outcome`. Auth: bearer token
 * from the in-memory session. Contract: `lib/api/openapi/earnproof-api.v1.json`
 * (`ActivityPage`, `ActivityEvent`).
 *
 * Contract this client enforces:
 * - The server scopes events to the authenticated account and redacts them.
 *   The client never builds, merges or fills in events: what renders is only
 *   what the server returned and `parseActivityPage` accepted.
 * - Only allow-listed fields of a known event are kept. Any extra field the
 *   server sends (for example a raw IP or a token) is dropped before it can
 *   reach the UI. The remaining identifiers are masked again by
 *   `redactActivityEvent`, which is idempotent on already-masked values.
 * - An event this build cannot render safely (unknown category, unknown
 *   action, missing or malformed field) becomes `{ id, occurredAt? }` and
 *   renders as the "unrecognized event" row. Its other fields are discarded.
 *   Entries with no usable string `id` are dropped and counted.
 * - Pagination is cursor-based. Cursors are opaque, length-bounded and
 *   character-restricted; a cursor the server echoes back unchanged ends
 *   pagination instead of looping.
 * - Every request carries a fresh `X-Request-Id` (opaque random id, see
 *   `lib/telemetry/correlation.ts`) that support can match against server logs.
 *   It is returned with the page and attached to errors, never persisted.
 * - Requests are cancellable through the caller's `AbortSignal`; an abort is
 *   not retried and is not reported as a failure.
 */

import { apiClient, bearer, retryRead } from "@/lib/api/client";
import { ApiError } from "@/lib/errors";
import { MAX_CURSOR_LENGTH, isValidOpaqueCursor } from "@/lib/api/opaque-cursor";
import { generateCorrelationId } from "@/lib/telemetry/correlation";

export type ActivityOutcome = "success" | "failure" | "pending";

export type ActivityCategory = "auth" | "key" | "session" | "admin";

type BaseActivityEvent = {
  id: string;
  occurredAt: string;
  outcome: ActivityOutcome;
  /** Truncated/hashed — never a full routable address. Optional: not every event has a network origin (e.g. a scheduled admin job). */
  ipAddressMasked?: string;
  /** Best-effort, coarse location string (e.g. "Lagos, NG"); never precise geolocation. */
  locationLabel?: string;
};

export type AuthActivityEvent = BaseActivityEvent & {
  category: "auth";
  action: "wallet-challenge-issued" | "wallet-signature-verified" | "sign-out";
  walletAddressMasked: string;
};

export type KeyActivityEvent = BaseActivityEvent & {
  category: "key";
  action: "api-key-created" | "api-key-rotated" | "api-key-revoked";
  apiKeyIdMasked: string;
};

export type SessionActivityEvent = BaseActivityEvent & {
  category: "session";
  action: "session-started" | "session-refreshed" | "session-expired";
  sessionIdMasked: string;
};

export type AdminActivityEvent = BaseActivityEvent & {
  category: "admin";
  action: "organization-status-changed" | "issuer-approved" | "issuer-suspended";
  targetLabel: string;
};

/**
 * Discriminated union on `category` — exhaustively switched over in
 * rendering code so adding a new category is a compile error everywhere
 * it needs handling, and any category this frontend build doesn't know
 * about yet (e.g. served by a newer backend) falls through to
 * `UnknownActivityEvent` instead.
 */
export type KnownActivityEvent =
  | AuthActivityEvent
  | KeyActivityEvent
  | SessionActivityEvent
  | AdminActivityEvent;

/**
 * What actually arrives over the wire: a known shape, or anything else.
 * `category`/`action` may be strings this build has never seen — modeled
 * as `Record<string, unknown>` so nothing here assumes a known shape
 * before the type guard below has checked it.
 */
export type ActivityEvent = KnownActivityEvent | (Record<string, unknown> & { id: string });

export function isKnownActivityEvent(event: ActivityEvent): event is KnownActivityEvent {
  const category = (event as { category?: unknown }).category;
  return (
    category === "auth" || category === "key" || category === "session" || category === "admin"
  );
}

export const ACTIVITY_CATEGORIES: ActivityCategory[] = ["auth", "key", "session", "admin"];
export const ACTIVITY_OUTCOMES: ActivityOutcome[] = ["success", "failure", "pending"];

export type ActivityFilter = {
  category?: ActivityCategory;
  outcome?: ActivityOutcome;
};

/**
 * Server-provided-style pagination: cursor-based. Chosen over page-number
 * pagination because activity logs are an append-heavy, frequently-
 * inserted-into feed — a cursor (last-seen event id) doesn't skip/repeat
 * rows when new events land between page fetches, unlike offset-based
 * paging. `nextCursor: null` means there are no more events to load.
 */
export type ActivityPage = {
  events: ActivityEvent[];
  nextCursor: string | null;
};

const REDACTED = "•••";

/**
 * Truncates a value to a short, non-reversible-looking prefix + suffix,
 * for identifiers that are safe to partially show (helps a user recognize
 * "yes, that's my key/session" without exposing the full secret-adjacent
 * value). Values shorter than the visible window are fully redacted
 * instead of trivially revealed.
 */
function maskIdentifier(value: string, visible = 4): string {
  if (value.length <= visible * 2) {
    return REDACTED;
  }
  return `${value.slice(0, visible)}${REDACTED}${value.slice(-visible)}`;
}

export function maskIpAddress(ip: string): string {
  // IPv4: zero the last octet. IPv6: keep only the first two hextets.
  if (ip.includes(".")) {
    const parts = ip.split(".");
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }
  }
  if (ip.includes(":")) {
    const parts = ip.split(":").filter(Boolean);
    return `${parts.slice(0, 2).join(":")}::`;
  }
  return REDACTED;
}

export function maskWalletAddress(address: string): string {
  return maskIdentifier(address, 4);
}

export function maskApiKeyId(keyId: string): string {
  return maskIdentifier(keyId, 4);
}

export function maskSessionId(sessionId: string): string {
  return maskIdentifier(sessionId, 4);
}

/**
 * Applies the redaction contract to a raw (pre-redaction) event shape.
 * Exists so any code path that constructs an `ActivityEvent` — including
 * the mock provider — cannot forget a field. Unknown-shaped events are
 * passed through as-is (there is nothing here to redact if the field
 * names aren't recognized), but the safe-fallback renderer never prints
 * their raw contents either.
 */
export function redactActivityEvent<T extends ActivityEvent>(event: T): T {
  if (!isKnownActivityEvent(event)) {
    return event;
  }

  const masked: KnownActivityEvent = { ...event };

  if (masked.ipAddressMasked) {
    masked.ipAddressMasked = maskIpAddress(masked.ipAddressMasked);
  }

  switch (masked.category) {
    case "auth":
      masked.walletAddressMasked = maskWalletAddress(masked.walletAddressMasked);
      break;
    case "key":
      masked.apiKeyIdMasked = maskApiKeyId(masked.apiKeyIdMasked);
      break;
    case "session":
      masked.sessionIdMasked = maskSessionId(masked.sessionIdMasked);
      break;
    case "admin":
      // targetLabel is an org/issuer display name, not a secret — no
      // redaction needed, but still passes through this single choke
      // point so a future sensitive field added to this category isn't
      // missed.
      break;
  }

  return masked as T;
}

/** Smallest and largest page size the client will request. */
export const ACTIVITY_MIN_PAGE_SIZE = 1;
export const ACTIVITY_MAX_PAGE_SIZE = 100;
export const ACTIVITY_DEFAULT_PAGE_SIZE = 20;
/** Longest cursor the client will send or accept. */
export const ACTIVITY_MAX_CURSOR_LENGTH = MAX_CURSOR_LENGTH;

export type ActivityErrorKind =
  | "invalid-request"
  | "unauthorized"
  | "forbidden"
  | "unavailable"
  | "invalid-response"
  | "failed";

/**
 * Failure from the activity client. `kind` drives deterministic UI states,
 * `requestId` is the correlation id sent with the request (safe to show).
 */
export class ActivityRequestError extends Error {
  readonly kind: ActivityErrorKind;
  readonly requestId: string;

  constructor(kind: ActivityErrorKind, requestId: string, message: string) {
    super(message);
    this.name = "ActivityRequestError";
    this.kind = kind;
    this.requestId = requestId;
  }
}

export type FetchActivityOptions = {
  /** Bearer token from the in-memory session. */
  token: string;
  signal: AbortSignal;
  cursor?: string | null;
  filter?: ActivityFilter;
  limit?: number;
};

export type FetchedActivityPage = ActivityPage & {
  /** Correlation id sent as `X-Request-Id` for this request. */
  requestId: string;
  /** Entries the server returned that had no usable `id` and were dropped. */
  droppedCount: number;
};

export const isValidActivityCursor = isValidOpaqueCursor;

/**
 * Builds the query string. Throws `invalid-request` for anything outside the
 * documented ranges instead of sending it and hoping the server rejects it.
 */
export function buildActivityQuery(
  options: Pick<FetchActivityOptions, "cursor" | "filter" | "limit">,
  requestId = "",
): string {
  const params = new URLSearchParams();
  const limit = options.limit ?? ACTIVITY_DEFAULT_PAGE_SIZE;

  if (
    !Number.isInteger(limit) ||
    limit < ACTIVITY_MIN_PAGE_SIZE ||
    limit > ACTIVITY_MAX_PAGE_SIZE
  ) {
    throw new ActivityRequestError(
      "invalid-request",
      requestId,
      `Page size must be a whole number from ${ACTIVITY_MIN_PAGE_SIZE} to ${ACTIVITY_MAX_PAGE_SIZE}.`,
    );
  }
  params.set("limit", String(limit));

  const { category, outcome } = options.filter ?? {};
  if (category !== undefined) {
    if (!ACTIVITY_CATEGORIES.includes(category)) {
      throw new ActivityRequestError("invalid-request", requestId, "Unknown activity category filter.");
    }
    params.set("category", category);
  }
  if (outcome !== undefined) {
    if (!ACTIVITY_OUTCOMES.includes(outcome)) {
      throw new ActivityRequestError("invalid-request", requestId, "Unknown activity outcome filter.");
    }
    params.set("outcome", outcome);
  }

  if (options.cursor !== undefined && options.cursor !== null) {
    if (!isValidActivityCursor(options.cursor)) {
      throw new ActivityRequestError("invalid-request", requestId, "Invalid pagination cursor.");
    }
    params.set("cursor", options.cursor);
  }

  return `?${params.toString()}`;
}

const AUTH_ACTIONS = ["wallet-challenge-issued", "wallet-signature-verified", "sign-out"];
const KEY_ACTIONS = ["api-key-created", "api-key-rotated", "api-key-revoked"];
const SESSION_ACTIONS = ["session-started", "session-refreshed", "session-expired"];
const ADMIN_ACTIONS = ["organization-status-changed", "issuer-approved", "issuer-suspended"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function validTimestamp(value: unknown): string | null {
  const text = nonEmptyString(value);
  return text !== null && !Number.isNaN(Date.parse(text)) ? text : null;
}

/** The only shape an unrenderable event is allowed to keep. */
function toUnknownEvent(id: string, raw: Record<string, unknown>): ActivityEvent {
  const occurredAt = validTimestamp(raw.occurredAt);
  return occurredAt ? { id, occurredAt } : { id };
}

/**
 * Validates one wire event. Returns a known event built only from
 * allow-listed fields, an unknown-event stub, or null when there is no usable id.
 */
export function parseActivityEvent(raw: unknown): ActivityEvent | null {
  if (!isRecord(raw)) return null;
  const id = nonEmptyString(raw.id);
  if (id === null) return null;

  const occurredAt = validTimestamp(raw.occurredAt);
  const outcome = ACTIVITY_OUTCOMES.find((value) => value === raw.outcome);
  const category = ACTIVITY_CATEGORIES.find((value) => value === raw.category);
  if (!occurredAt || !outcome || !category) return toUnknownEvent(id, raw);

  const base = {
    id,
    occurredAt,
    outcome,
    ...(nonEmptyString(raw.ipAddressMasked) ? { ipAddressMasked: raw.ipAddressMasked as string } : {}),
    ...(nonEmptyString(raw.locationLabel) ? { locationLabel: raw.locationLabel as string } : {}),
  };

  const action = nonEmptyString(raw.action);
  if (!action) return toUnknownEvent(id, raw);

  switch (category) {
    case "auth": {
      const wallet = nonEmptyString(raw.walletAddressMasked);
      if (!wallet || !AUTH_ACTIONS.includes(action)) return toUnknownEvent(id, raw);
      return redactActivityEvent({ ...base, category, action: action as AuthActivityEvent["action"], walletAddressMasked: wallet });
    }
    case "key": {
      const keyId = nonEmptyString(raw.apiKeyIdMasked);
      if (!keyId || !KEY_ACTIONS.includes(action)) return toUnknownEvent(id, raw);
      return redactActivityEvent({ ...base, category, action: action as KeyActivityEvent["action"], apiKeyIdMasked: keyId });
    }
    case "session": {
      const sessionId = nonEmptyString(raw.sessionIdMasked);
      if (!sessionId || !SESSION_ACTIONS.includes(action)) return toUnknownEvent(id, raw);
      return redactActivityEvent({ ...base, category, action: action as SessionActivityEvent["action"], sessionIdMasked: sessionId });
    }
    case "admin": {
      const target = nonEmptyString(raw.targetLabel);
      if (!target || !ADMIN_ACTIONS.includes(action)) return toUnknownEvent(id, raw);
      return redactActivityEvent({ ...base, category, action: action as AdminActivityEvent["action"], targetLabel: target });
    }
  }
}

/**
 * Validates a whole page. Throws `invalid-response` when the envelope itself
 * is malformed. Duplicate ids inside one page keep the first occurrence.
 */
export function parseActivityPage(
  raw: unknown,
  requestId: string,
  requestCursor: string | null = null,
): FetchedActivityPage {
  if (!isRecord(raw) || !Array.isArray(raw.events)) {
    throw new ActivityRequestError("invalid-response", requestId, "Activity response was malformed.");
  }

  let nextCursor: string | null;
  if (raw.nextCursor === null || raw.nextCursor === undefined) {
    nextCursor = null;
  } else if (isValidActivityCursor(raw.nextCursor)) {
    // A server that hands back the cursor it was given would loop forever.
    nextCursor = raw.nextCursor === requestCursor ? null : raw.nextCursor;
  } else {
    throw new ActivityRequestError("invalid-response", requestId, "Activity response had an invalid cursor.");
  }

  const seen = new Set<string>();
  const events: ActivityEvent[] = [];
  let droppedCount = 0;
  for (const entry of raw.events) {
    const event = parseActivityEvent(entry);
    if (!event) {
      droppedCount += 1;
    } else if (!seen.has(event.id)) {
      seen.add(event.id);
      events.push(event);
    }
  }

  return { events, nextCursor, requestId, droppedCount };
}

function toRequestError(error: unknown, requestId: string): ActivityRequestError {
  if (error instanceof ActivityRequestError) return error;
  if (error instanceof ApiError) {
    switch (error.status) {
      case 401:
        return new ActivityRequestError("unauthorized", requestId, "Your session has ended.");
      case 403:
        return new ActivityRequestError("forbidden", requestId, "You do not have access to account activity.");
      case 404:
      case 501:
        return new ActivityRequestError("unavailable", requestId, "Account activity is not available.");
      case 400:
      case 422:
        return new ActivityRequestError("invalid-request", requestId, "The activity request was rejected.");
      default:
        return new ActivityRequestError("failed", requestId, "Unable to load recent activity.");
    }
  }
  return new ActivityRequestError("failed", requestId, "Unable to load recent activity.");
}

/**
 * Fetches one page of the signed-in account's activity from the live API.
 * Never returns generated or fallback events: on any failure it throws.
 * An aborted request rethrows the original `AbortError` so callers can ignore it.
 */
export async function fetchActivityEvents(options: FetchActivityOptions): Promise<FetchedActivityPage> {
  const requestId = generateCorrelationId();

  try {
    if (!options.token) {
      throw new ActivityRequestError("unauthorized", requestId, "Your session has ended.");
    }
    const query = buildActivityQuery(options, requestId);

    const raw = await retryRead(
      (signal) =>
        apiClient<unknown>({
          path: `/activity${query}`,
          method: "GET",
          headers: { ...bearer(options.token), "X-Request-Id": requestId },
          signal,
        }),
      options.signal,
    );

    return parseActivityPage(raw, requestId, options.cursor ?? null);
  } catch (error) {
    if (options.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw error;
    }
    throw toRequestError(error, requestId);
  }
}
