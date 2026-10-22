/**
 * Synthetic wire-format activity events for tests. Nothing here is real:
 * the wallet, key and session identifiers are made up and the IPs are from
 * the documentation ranges (RFC 5737).
 */

import type { FetchedActivityPage } from "@/lib/api/activity";

export const SYNTHETIC_TOKEN = "synthetic-activity-token";

export const FIXTURE_USER = {
  id: "user-activity-1",
  walletAddress: "GSYNTHETICACTIVITYWALLET0000000000000000000000000000000",
  walletHash: "hash-activity-1",
  role: "WORKER" as const,
};

export const RAW_WALLET = "GABCD1234567890EFGH1234567890IJKL1234567890MNOP";

export const wireEvents = {
  auth: {
    id: "evt_auth",
    category: "auth",
    action: "wallet-signature-verified",
    outcome: "success",
    occurredAt: "2026-01-02T03:04:05.000Z",
    walletAddressMasked: "GABC•••MNOP",
    ipAddressMasked: "203.0.113.0",
    locationLabel: "Lagos, NG",
  },
  key: {
    id: "evt_key",
    category: "key",
    action: "api-key-created",
    outcome: "success",
    occurredAt: "2026-01-02T02:00:00.000Z",
    apiKeyIdMasked: "key_•••3210",
  },
  session: {
    id: "evt_session",
    category: "session",
    action: "session-started",
    outcome: "pending",
    occurredAt: "2026-01-02T01:00:00.000Z",
    sessionIdMasked: "sess•••7089",
  },
  admin: {
    id: "evt_admin",
    category: "admin",
    action: "issuer-approved",
    outcome: "failure",
    occurredAt: "2026-01-02T00:00:00.000Z",
    targetLabel: "Synthetic Issuer Co",
  },
} as const;

export function wirePage(
  events: unknown[] = [wireEvents.auth],
  nextCursor: string | null = null,
): { events: unknown[]; nextCursor: string | null } {
  return { events, nextCursor };
}

export function fetchedPage(overrides: Partial<FetchedActivityPage> = {}): FetchedActivityPage {
  return {
    events: [wireEvents.auth] as unknown as FetchedActivityPage["events"],
    nextCursor: null,
    requestId: "0123456789abcdef0123456789abcdef",
    droppedCount: 0,
    ...overrides,
  };
}
