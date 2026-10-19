/**
 * Client-local "last reauthenticated at" tracking for role-change
 * approval/rejection decisions, scoped per user. Mirrors
 * lib/organization-archival/store.ts's readLastReauthAt/recordReauth -
 * same disclosed stand-in for a server-side step-up/reauth endpoint that
 * does not exist in the OpenAPI spec, kept as its own small store rather
 * than shared with the archival feature since the two recency windows
 * are independent, unrelated product decisions.
 */

function reauthKey(userId: string): string {
  return `earnproof.role-change-reauth.${userId}`;
}

export function readLastReauthAt(userId: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(reauthKey(userId));
}

export function recordReauth(userId: string, now: Date = new Date()): string {
  const timestamp = now.toISOString();
  if (typeof window !== "undefined") {
    window.localStorage.setItem(reauthKey(userId), timestamp);
  }
  return timestamp;
}
