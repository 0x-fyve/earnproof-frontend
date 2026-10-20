/**
 * Session management utilities for the EarnProof application.
 * Sessions are stored in localStorage under the key "earnproof.session".
 */

import { getTabSyncCoordinator } from "@/lib/auth/tab-sync-coordinator";

export type SessionUser = {
  id: string;
  walletAddress: string;
  walletHash: string;
  role: "WORKER" | "ISSUER" | "ADMIN" | "DEVELOPER";
};

export type Session = {
  token: string;
  user: SessionUser;
};

const SESSION_KEY = "earnproof.session";

/**
 * Read the stored session from localStorage.
 * Returns null if no session exists or if the stored data is invalid.
 * 
 * @returns Session object or null if not found/invalid
 */
export function readStoredSession(): Session | null {
  if (typeof window === "undefined") {
    return null;
  }

  const stored = window.localStorage.getItem(SESSION_KEY);
  if (!stored) {
    return null;
  }

  try {
    return JSON.parse(stored) as Session;
  } catch {
    // Clear invalid session
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

/**
 * Store a session in localStorage.
 * 
 * @param session Session to store
 */
export function storeSession(session: Session): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

/**
 * Clear the stored session from localStorage and tell other open tabs the
 * wallet logged out (#274), so they drop their in-memory auth and
 * tenant-scoped state too.
 *
 * Pass `{ broadcast: false }` when clearing in response to a message that
 * came from another tab, so tabs never echo a logout back and forth.
 */
export function clearStoredSession({ broadcast = true }: { broadcast?: boolean } = {}): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(SESSION_KEY);
  if (broadcast) {
    getTabSyncCoordinator()?.publish("wallet_logout");
  }
}
