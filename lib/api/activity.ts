/**
 * Recent account activity — types, redaction, and a local mock/stub data
 * provider.
 * =================================================================
 *
 * This is a FRONTEND-ONLY feature today. There is no activity/audit-log
 * endpoint in `lib/api/openapi/earnproof-api.v1.json` — `fetchActivityEvents`
 * below is a fixture, not a call to a real backend path. When a real
 * endpoint exists, only the fetcher needs to change: the event shape,
 * redaction contract, and pagination shape are designed to match what a
 * server-provided-pagination endpoint would plausibly return.
 *
 * Security/privacy contract (per issue #198's acceptance criteria):
 * - Events must already be scoped to the authenticated user/organization
 *   by the server; this module never merges events across sessions.
 * - Sensitive identifiers (IP addresses, session tokens, API key IDs,
 *   wallet addresses) are truncated/omitted by `redactActivityEvent`
 *   before an event is considered renderable — never displayed raw.
 * - An event whose `type` this frontend doesn't recognize must still
 *   render safely (see `components/activity/unknown-event.tsx`) rather
 *   than crash or leak unredacted fields.
 */

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

const MOCK_PAGE_SIZE = 10;

function buildMockEvents(): KnownActivityEvent[] {
  const now = Date.now();
  const hour = 60 * 60 * 1000;

  const raw: KnownActivityEvent[] = [
    {
      id: "evt_001",
      category: "auth",
      action: "wallet-signature-verified",
      outcome: "success",
      occurredAt: new Date(now - 1 * hour).toISOString(),
      walletAddressMasked: "GABCD1234567890EFGH1234567890IJKL1234567890MNOP",
      ipAddressMasked: "203.0.113.42",
      locationLabel: "Lagos, NG",
    },
    {
      id: "evt_002",
      category: "key",
      action: "api-key-created",
      outcome: "success",
      occurredAt: new Date(now - 3 * hour).toISOString(),
      apiKeyIdMasked: "key_9f8e7d6c5b4a3210",
      ipAddressMasked: "203.0.113.42",
    },
    {
      id: "evt_003",
      category: "session",
      action: "session-started",
      outcome: "success",
      occurredAt: new Date(now - 5 * hour).toISOString(),
      sessionIdMasked: "sess_1a2b3c4d5e6f7089",
      ipAddressMasked: "198.51.100.7",
      locationLabel: "Accra, GH",
    },
    {
      id: "evt_004",
      category: "auth",
      action: "wallet-challenge-issued",
      outcome: "failure",
      occurredAt: new Date(now - 8 * hour).toISOString(),
      walletAddressMasked: "GZYXW0987654321UVTS0987654321RQPO0987654321NMLK",
      ipAddressMasked: "203.0.113.99",
    },
    {
      id: "evt_005",
      category: "admin",
      action: "organization-status-changed",
      outcome: "success",
      occurredAt: new Date(now - 12 * hour).toISOString(),
      targetLabel: "Acme Verification Org",
    },
    {
      id: "evt_006",
      category: "key",
      action: "api-key-revoked",
      outcome: "success",
      occurredAt: new Date(now - 20 * hour).toISOString(),
      apiKeyIdMasked: "key_11223344556677",
    },
    {
      id: "evt_007",
      category: "session",
      action: "session-expired",
      outcome: "pending",
      occurredAt: new Date(now - 26 * hour).toISOString(),
      sessionIdMasked: "sess_aabbccddeeff0011",
    },
    {
      id: "evt_008",
      category: "auth",
      action: "sign-out",
      outcome: "success",
      occurredAt: new Date(now - 30 * hour).toISOString(),
      walletAddressMasked: "GABCD1234567890EFGH1234567890IJKL1234567890MNOP",
      ipAddressMasked: "203.0.113.42",
    },
    {
      id: "evt_009",
      category: "admin",
      action: "issuer-suspended",
      outcome: "failure",
      occurredAt: new Date(now - 40 * hour).toISOString(),
      targetLabel: "Suspicious Issuer LLC",
    },
    {
      id: "evt_010",
      category: "key",
      action: "api-key-rotated",
      outcome: "success",
      occurredAt: new Date(now - 50 * hour).toISOString(),
      apiKeyIdMasked: "key_deadbeefcafebabe",
    },
    {
      id: "evt_011",
      category: "session",
      action: "session-refreshed",
      outcome: "success",
      occurredAt: new Date(now - 60 * hour).toISOString(),
      sessionIdMasked: "sess_0011223344556677",
    },
    {
      id: "evt_012",
      category: "admin",
      action: "issuer-approved",
      outcome: "success",
      occurredAt: new Date(now - 70 * hour).toISOString(),
      targetLabel: "Trusted Issuer Co",
    },
  ];

  return raw;
}

/**
 * Local mock/stub activity feed, paginated server-provided-style with an
 * opaque cursor (here: the last event id emitted). Filters are applied as
 * if the server had already scoped and filtered the result — this mirrors
 * how a real endpoint would take `category`/`outcome` query params rather
 * than the client filtering an unbounded local list.
 */
export async function fetchActivityEvents(
  options: { cursor?: string | null; filter?: ActivityFilter } = {},
): Promise<ActivityPage> {
  const all = buildMockEvents().filter((event) => {
    if (options.filter?.category && event.category !== options.filter.category) {
      return false;
    }
    if (options.filter?.outcome && event.outcome !== options.filter.outcome) {
      return false;
    }
    return true;
  });

  const startIndex = options.cursor
    ? all.findIndex((event) => event.id === options.cursor) + 1
    : 0;

  // An unrecognized/expired cursor resolves to "no more events" rather
  // than silently restarting from the top — restarting could look like
  // duplicate/looping pagination to the caller.
  if (options.cursor && startIndex === 0) {
    return { events: [], nextCursor: null };
  }

  const pageEvents = all.slice(startIndex, startIndex + MOCK_PAGE_SIZE);
  const nextCursor =
    startIndex + MOCK_PAGE_SIZE < all.length ? pageEvents[pageEvents.length - 1]?.id ?? null : null;

  return {
    events: pageEvents.map((event) => redactActivityEvent(event)),
    nextCursor,
  };
}
