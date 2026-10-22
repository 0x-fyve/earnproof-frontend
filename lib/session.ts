/**
 * Session management for the EarnProof application.
 *
 * The bearer token lives in memory only (via the TokenManager). It is never
 * written to localStorage, sessionStorage, cookies or the URL. The signed-in
 * user profile is held in memory next to it and dies with the document.
 *
 * Refresh behaviour: a page reload drops the in-memory session, so the next
 * protected view shows its normal "connect wallet" state and the user signs a
 * fresh challenge. Nothing is replayed from disk.
 *
 * Legacy behaviour: older builds persisted `{ token, user }` under
 * `earnproof.session`. That entry is treated as invalid. It is never read as a
 * session and is deleted from localStorage and sessionStorage the first time
 * this module is used, and again on every store and clear.
 *
 * Cross-tab: logout, expiry and wallet changes are broadcast (without any token
 * material) so every other open tab clears its own in-memory session too.
 */

import { MultiTabSync, type SyncMessage } from "@/lib/auth/multi-tab-sync";
import { TokenManager } from "@/lib/auth/token-manager";

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

/** Legacy persistence key. Only ever used to delete old entries. */
export const LEGACY_SESSION_KEY = "earnproof.session";

export type ClearReason =
  | "logout"
  | "expired"
  | "wallet_changed"
  | "unauthorized"
  | "synced_from_other_tab";

let currentUser: Session["user"] | null = null;
let initialized = false;
let unsubscribeSync: (() => void) | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // A broken subscriber must not block the others.
    }
  });
}

/**
 * Delete every legacy persisted session entry.
 * Returns true when something was removed. Storage errors (private mode,
 * blocked storage) are swallowed because there is nothing left to leak then.
 */
export function purgeLegacySession(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  let removed = false;
  for (const getStore of [
    () => window.localStorage,
    () => window.sessionStorage,
  ]) {
    try {
      const store = getStore();
      if (store.getItem(LEGACY_SESSION_KEY) !== null) {
        removed = true;
      }
      store.removeItem(LEGACY_SESSION_KEY);
    } catch {
      // Storage unavailable: nothing persisted, nothing to purge.
    }
  }
  return removed;
}

function handleSync(message: SyncMessage): void {
  if (
    message.type === "logout" ||
    message.type === "session_expired" ||
    message.type === "wallet_changed"
  ) {
    clearLocal();
  }
}

function clearLocal(): void {
  const hadSession = currentUser !== null || TokenManager.getInstance().hasToken();
  currentUser = null;
  TokenManager.getInstance().clearToken();
  purgeLegacySession();
  if (hadSession) {
    notify();
  }
}

function ensureInitialized(): void {
  if (initialized || typeof window === "undefined") {
    return;
  }
  initialized = true;
  purgeLegacySession();
  unsubscribeSync = MultiTabSync.getInstance().onSync(handleSync);
}

/**
 * Read the in-memory session.
 * Returns null when nobody is signed in, the token expired, or the page was
 * reloaded since sign-in.
 */
export function readStoredSession(): Session | null {
  ensureInitialized();

  const token = TokenManager.getInstance().getToken();
  if (!token || !currentUser) {
    if (currentUser && !token) {
      // Token expired inside the manager: drop the profile with it.
      currentUser = null;
      notify();
    }
    return null;
  }

  return { token, user: currentUser };
}

/**
 * Keep a session in memory.
 *
 * @param session Session to keep
 * @param expiresAt Optional expiry (ms since epoch) enforced by the token manager
 */
export function storeSession(session: Session, expiresAt?: number): void {
  ensureInitialized();
  purgeLegacySession();

  currentUser = session.user;
  TokenManager.getInstance().setToken(session.token, expiresAt);
  notify();
}

/**
 * Clear the session in this tab and tell every other tab to do the same.
 */
export function clearStoredSession(reason: ClearReason = "logout"): void {
  ensureInitialized();
  clearLocal();
  if (reason === "synced_from_other_tab") {
    return;
  }

  const sync = MultiTabSync.getInstance();
  sync.broadcast(
    reason === "expired" || reason === "unauthorized"
      ? "session_expired"
      : reason === "wallet_changed"
        ? "wallet_changed"
        : "logout",
  );
}

/** Subscribe to session changes (compatible with useSyncExternalStore). */
export function subscribeSession(listener: () => void): () => void {
  ensureInitialized();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test helper: forget everything and detach cross-tab listeners. */
export function resetSessionForTests(): void {
  currentUser = null;
  initialized = false;
  unsubscribeSync?.();
  unsubscribeSync = null;
  listeners.clear();
  TokenManager.reset();
}
