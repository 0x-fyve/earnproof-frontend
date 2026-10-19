/**
 * @jest-environment jsdom
 *
 * Issue #305: the session bearer token lives in memory only. These tests pin
 * the lifecycle (store, read, expiry, logout, wallet change, cross-tab
 * revocation) and the legacy `earnproof.session` cleanup.
 */

type SyncListener = (message: { type: string; timestamp: number; sourceTabId: string }) => void;

const broadcast = jest.fn();
let syncListener: SyncListener | null = null;

jest.mock("@/lib/auth/multi-tab-sync", () => ({
  MultiTabSync: {
    getInstance: () => ({
      broadcast,
      onSync: (listener: SyncListener) => {
        syncListener = listener;
        return () => {
          syncListener = null;
        };
      },
    }),
  },
}));

import {
  LEGACY_SESSION_KEY,
  clearStoredSession,
  purgeLegacySession,
  readStoredSession,
  resetSessionForTests,
  storeSession,
  subscribeSession,
  type Session,
} from "@/lib/session";

const TOKEN = "synthetic-bearer-token-not-real";
const SESSION: Session = {
  token: TOKEN,
  user: {
    id: "user-1",
    walletAddress: "GSYNTHETICWALLETADDRESS",
    walletHash: "hash-1",
    role: "WORKER",
  },
};

function emit(type: string) {
  syncListener?.({ type, timestamp: 0, sourceTabId: "other-tab" });
}

function storageDump() {
  return JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  broadcast.mockClear();
  syncListener = null;
  resetSessionForTests();
});

describe("in-memory session", () => {
  it("returns the stored session and never writes the token to browser storage", () => {
    const setItem = jest.spyOn(Storage.prototype, "setItem");

    storeSession(SESSION);

    expect(readStoredSession()).toEqual(SESSION);
    expect(setItem).not.toHaveBeenCalled();
    expect(storageDump()).not.toContain(TOKEN);
    setItem.mockRestore();
  });

  it("returns null before sign-in and after a reload (module state reset)", () => {
    expect(readStoredSession()).toBeNull();

    storeSession(SESSION);
    resetSessionForTests();

    expect(readStoredSession()).toBeNull();
  });

  it("drops the session at the exact expiry boundary (30s grace window)", () => {
    const now = 1_700_000_000_000;
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(now);

    storeSession(SESSION, now + 30_001);
    expect(readStoredSession()).toEqual(SESSION);

    // Last valid instant: expiresAt - 30s. One millisecond later it is gone.
    nowSpy.mockReturnValue(now + 1);
    expect(readStoredSession()).toEqual(SESSION);

    nowSpy.mockReturnValue(now + 2);
    expect(readStoredSession()).toBeNull();
    nowSpy.mockRestore();
  });

  it("notifies subscribers on store and clear, and stops after unsubscribe", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeSession(listener);

    storeSession(SESSION);
    clearStoredSession();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    storeSession(SESSION);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("tolerates a subscriber that throws", () => {
    const good = jest.fn();
    subscribeSession(() => {
      throw new Error("boom");
    });
    subscribeSession(good);

    expect(() => storeSession(SESSION)).not.toThrow();
    expect(good).toHaveBeenCalled();
  });

  it("replaces the previous session when a second wallet signs in", () => {
    storeSession(SESSION);
    storeSession({ token: "second-token", user: { ...SESSION.user, id: "user-2" } });

    expect(readStoredSession()?.user.id).toBe("user-2");
    expect(readStoredSession()?.token).toBe("second-token");
  });
});

describe("legacy earnproof.session entries", () => {
  it("never treats a legacy entry as a session and deletes it on first read", () => {
    window.localStorage.setItem(LEGACY_SESSION_KEY, JSON.stringify(SESSION));
    window.sessionStorage.setItem(LEGACY_SESSION_KEY, JSON.stringify(SESSION));

    expect(readStoredSession()).toBeNull();
    expect(window.localStorage.getItem(LEGACY_SESSION_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(LEGACY_SESSION_KEY)).toBeNull();
  });

  it("deletes malformed legacy entries without throwing", () => {
    window.localStorage.setItem(LEGACY_SESSION_KEY, "{not-json");

    expect(() => readStoredSession()).not.toThrow();
    expect(window.localStorage.getItem(LEGACY_SESSION_KEY)).toBeNull();
  });

  it("removes a legacy entry that appears after init when a new session is stored", () => {
    readStoredSession();
    window.localStorage.setItem(LEGACY_SESSION_KEY, JSON.stringify(SESSION));

    storeSession(SESSION);

    expect(window.localStorage.getItem(LEGACY_SESSION_KEY)).toBeNull();
  });

  it("reports whether anything was purged", () => {
    expect(purgeLegacySession()).toBe(false);
    window.localStorage.setItem(LEGACY_SESSION_KEY, "x");
    expect(purgeLegacySession()).toBe(true);
  });

  it("does not throw when storage access is blocked", () => {
    const getItem = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(() => readStoredSession()).not.toThrow();
    getItem.mockRestore();
  });
});

describe("revocation paths", () => {
  it("clears memory and every legacy path on logout and tells other tabs", () => {
    storeSession(SESSION);
    window.localStorage.setItem(LEGACY_SESSION_KEY, "stale");

    clearStoredSession();

    expect(readStoredSession()).toBeNull();
    expect(window.localStorage.getItem(LEGACY_SESSION_KEY)).toBeNull();
    expect(broadcast).toHaveBeenCalledWith("logout");
  });

  it.each([
    ["expired", "session_expired"],
    ["unauthorized", "session_expired"],
    ["wallet_changed", "wallet_changed"],
  ] as const)("broadcasts %s as %s", (reason, message) => {
    storeSession(SESSION);
    clearStoredSession(reason);
    expect(broadcast).toHaveBeenCalledWith(message);
    expect(readStoredSession()).toBeNull();
  });

  it("does not echo a broadcast when clearing because another tab asked", () => {
    storeSession(SESSION);
    clearStoredSession("synced_from_other_tab");
    expect(broadcast).not.toHaveBeenCalled();
  });

  it.each(["logout", "session_expired", "wallet_changed"])(
    "clears this tab when another tab broadcasts %s",
    (type) => {
      storeSession(SESSION);
      const listener = jest.fn();
      subscribeSession(listener);

      emit(type);

      expect(readStoredSession()).toBeNull();
      expect(listener).toHaveBeenCalled();
    },
  );

  it.each(["token_rotated", "session_recovered"])(
    "keeps the session when another tab broadcasts %s",
    (type) => {
      storeSession(SESSION);
      emit(type);
      expect(readStoredSession()).toEqual(SESSION);
    },
  );

  it("is idempotent: a repeated revocation does not notify twice", () => {
    storeSession(SESSION);
    const listener = jest.fn();
    subscribeSession(listener);

    emit("logout");
    emit("logout");

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("a stale revocation cannot affect a session created afterwards in a new store lifetime", () => {
    storeSession(SESSION);
    emit("logout");
    storeSession(SESSION);
    expect(readStoredSession()).toEqual(SESSION);
  });
});
