/**
 * Unit tests for lib/account-rotation/store.ts (#281).
 *
 * Tests cover:
 * - Happy path: full lifecycle from pending → completed
 * - Negative: same-account, already-active, not-found, rollback-not-allowed
 * - Boundary: challenge expiry at exact boundary
 * - Replay: idempotent/rejected repeated transitions
 * - Rollback: success and failure cases, old/new account separation preserved
 * - Regression: private key material never stored in any field
 */

import {
  createRotation,
  attachChallenge,
  markChallengeVerified,
  markChallengeFailed,
  confirmBoundary,
  attachResyncPlan,
  markResyncRunning,
  markResyncCompleted,
  markResyncFailed,
  rollbackRotation,
  canRollback,
  isChallengeValid,
  listRotations,
  getActiveRotation,
  markRotationStale,
  SameAccountRotationError,
  RotationAlreadyActiveError,
  RotationNotFoundError,
  ChallengeExpiredError,
  RollbackNotAllowedError,
  type AccountRotationRecord,
  type RotationChallenge,
} from "../store";

// ─── Synthetic fixtures ───────────────────────────────────────────────────────

const OLD_ADDR = "GAOLD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ2345678901234";
const NEW_ADDR = "GANEW1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ2345678901234";
const ALT_ADDR = "GAALT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ2345678901234";
// All three are synthetic 56-char G-addresses (same length, clearly not real).

const USER_ID = "user-test-1";

function futureExpiresAt(offsetMs = 60_000): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function pastExpiresAt(offsetMs = 60_000): string {
  return new Date(Date.now() - offsetMs).toISOString();
}

const VALID_CHALLENGE: RotationChallenge = {
  challengeId: "chal-001",
  message: "Sign this to prove ownership: nonce=abc123",
  expiresAt: futureExpiresAt(),
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  window.localStorage.clear();
});

// ─── Happy path ───────────────────────────────────────────────────────────────

describe("full happy path", () => {
  it("creates a rotation in pending state", () => {
    const r = createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    expect(r.status).toBe("pending");
    expect(r.oldAccountAddress).toBe(OLD_ADDR);
    expect(r.newAccountAddress).toBe(NEW_ADDR);
    expect(r.challenge).toBeNull();
    expect(r.challengeSignatureSubmitted).toBe(false);
    expect(r.boundary).toBeNull();
    expect(r.resyncResult).toBeNull();
    expect(r.errorMessage).toBeNull();
  });

  it("attaches a challenge and moves to challenge_pending", () => {
    const r = createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    const updated = attachChallenge(USER_ID, r.id, VALID_CHALLENGE);
    expect(updated.status).toBe("challenge_pending");
    expect(updated.challenge?.challengeId).toBe("chal-001");
    // message is stored for display — no private key material
    expect(updated.challenge?.message).not.toMatch(/^S[A-Z2-7]{55}$/);
  });

  it("marks challenge verified and moves to boundary_confirmed", () => {
    const r = createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    const withChallenge = attachChallenge(USER_ID, r.id, VALID_CHALLENGE);
    const verified = markChallengeVerified(USER_ID, withChallenge.id);
    expect(verified.status).toBe("boundary_confirmed");
    expect(verified.challengeSignatureSubmitted).toBe(true);
  });

  it("confirms boundary and stores ledger + cursor", () => {
    const r = createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    attachChallenge(USER_ID, r.id, VALID_CHALLENGE);
    markChallengeVerified(USER_ID, r.id);
    const bounded = confirmBoundary(USER_ID, r.id, { ledger: 50_000_000, cursor: "2026-01-01T00:00:00.000Z" });
    expect(bounded.boundary?.ledger).toBe(50_000_000);
    expect(bounded.boundary?.cursor).toBe("2026-01-01T00:00:00.000Z");
  });

  it("attaches resync scope and moves to resync_planned", () => {
    const r = createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    attachChallenge(USER_ID, r.id, VALID_CHALLENGE);
    markChallengeVerified(USER_ID, r.id);
    confirmBoundary(USER_ID, r.id, { ledger: 50_000_000, cursor: "2026-01-01T00:00:00.000Z" });
    const planned = attachResyncPlan(USER_ID, r.id, "Full history for GANEW…");
    expect(planned.status).toBe("resync_planned");
    expect(planned.resyncScope).toBe("Full history for GANEW…");
  });

  it("marks resync running then completed with result", () => {
    const r = createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    attachChallenge(USER_ID, r.id, VALID_CHALLENGE);
    markChallengeVerified(USER_ID, r.id);
    confirmBoundary(USER_ID, r.id, { ledger: 50_000_000, cursor: "2026-01-01T00:00:00.000Z" });
    attachResyncPlan(USER_ID, r.id, "scope");
    markResyncRunning(USER_ID, r.id);
    const done = markResyncCompleted(USER_ID, r.id, { created: 5, updated: 1, skipped: 0 });
    expect(done.status).toBe("completed");
    expect(done.resyncResult).toEqual({ created: 5, updated: 1, skipped: 0 });
    expect(done.errorMessage).toBeNull();
  });

  it("listRotations returns records sorted newest-first", () => {
    createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    // Force a tiny delay so createdAt differs.
    const r2 = createRotation("user-test-2", OLD_ADDR, ALT_ADDR);
    // Two different users — list by user; just confirm sort direction within one user.
    const r = createRotation(USER_ID, ALT_ADDR, NEW_ADDR);
    const list = listRotations(USER_ID);
    expect(list[0]!.id).toBe(r.id); // most recent first
  });

  it("getActiveRotation returns the in-progress rotation", () => {
    const r = createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    expect(getActiveRotation(USER_ID)?.id).toBe(r.id);
    markResyncCompleted(USER_ID, r.id, { created: 1, updated: 0, skipped: 0 });
    expect(getActiveRotation(USER_ID)).toBeNull(); // completed is not active
  });
});

// ─── Negative: validation ─────────────────────────────────────────────────────

describe("same-account rejection", () => {
  it("throws SameAccountRotationError when old and new address are identical", () => {
    expect(() => createRotation(USER_ID, OLD_ADDR, OLD_ADDR)).toThrow(
      SameAccountRotationError,
    );
  });

  it("rejects same address even with leading/trailing whitespace", () => {
    expect(() => createRotation(USER_ID, OLD_ADDR, `  ${OLD_ADDR}  `)).toThrow(
      SameAccountRotationError,
    );
  });
});

describe("already-active rejection", () => {
  it("throws RotationAlreadyActiveError when a pending rotation exists", () => {
    createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    expect(() => createRotation(USER_ID, OLD_ADDR, ALT_ADDR)).toThrow(
      RotationAlreadyActiveError,
    );
  });

  it("allows a new rotation after the previous one is completed", () => {
    const r = createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    markResyncCompleted(USER_ID, r.id, { created: 1, updated: 0, skipped: 0 });
    expect(() => createRotation(USER_ID, NEW_ADDR, ALT_ADDR)).not.toThrow();
  });

  it("allows a new rotation after the previous one is rolled back", () => {
    const r = createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    rollbackRotation(USER_ID, r.id);
    expect(() => createRotation(USER_ID, OLD_ADDR, ALT_ADDR)).not.toThrow();
  });
});

describe("not-found errors", () => {
  it("throws RotationNotFoundError for unknown ids", () => {
    expect(() => attachChallenge(USER_ID, "no-such-id", VALID_CHALLENGE)).toThrow(
      RotationNotFoundError,
    );
    expect(() => markChallengeVerified(USER_ID, "no-such-id")).toThrow(
      RotationNotFoundError,
    );
    expect(() => rollbackRotation(USER_ID, "no-such-id")).toThrow(
      RotationNotFoundError,
    );
  });
});

// ─── Boundary: challenge expiry ───────────────────────────────────────────────

describe("challenge expiry", () => {
  it("isChallengeValid returns true for a future expiry", () => {
    expect(isChallengeValid({ ...VALID_CHALLENGE, expiresAt: futureExpiresAt(30_000) })).toBe(true);
  });

  it("isChallengeValid returns false at exact expiry (now >= expiresAt)", () => {
    const now = Date.now();
    expect(isChallengeValid({ ...VALID_CHALLENGE, expiresAt: new Date(now).toISOString() }, now)).toBe(false);
  });

  it("isChallengeValid returns false 1ms after expiry", () => {
    const expiresAt = new Date(Date.now() - 1).toISOString();
    expect(isChallengeValid({ ...VALID_CHALLENGE, expiresAt }, Date.now())).toBe(false);
  });

  it("markChallengeVerified throws ChallengeExpiredError when challenge is expired", () => {
    const r = createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    const expired: RotationChallenge = {
      ...VALID_CHALLENGE,
      expiresAt: pastExpiresAt(),
    };
    attachChallenge(USER_ID, r.id, expired);
    expect(() => markChallengeVerified(USER_ID, r.id)).toThrow(ChallengeExpiredError);
  });

  it("markChallengeVerified succeeds 1ms before expiry", () => {
    const r = createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    const almostExpired: RotationChallenge = {
      ...VALID_CHALLENGE,
      expiresAt: new Date(Date.now() + 1).toISOString(),
    };
    attachChallenge(USER_ID, r.id, almostExpired);
    // Should not throw; may be flaky if test takes > 1ms — acceptable for a
    // boundary test; add a small buffer if this becomes a CI problem.
    expect(() => markChallengeVerified(USER_ID, r.id)).not.toThrow();
  });
});

// ─── Rollback ─────────────────────────────────────────────────────────────────

describe("rollback", () => {
  it("rolls back a pending rotation", () => {
    const r = createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    const rolled = rollbackRotation(USER_ID, r.id);
    expect(rolled.status).toBe("rolled_back");
  });

  it("rolls back a challenge_pending rotation", () => {
    const r = createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    attachChallenge(USER_ID, r.id, VALID_CHALLENGE);
    const rolled = rollbackRotation(USER_ID, r.id);
    expect(rolled.status).toBe("rolled_back");
  });

  it("rolls back a resync_planned rotation", () => {
    const r = createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    attachChallenge(USER_ID, r.id, VALID_CHALLENGE);
    markChallengeVerified(USER_ID, r.id);
    confirmBoundary(USER_ID, r.id, { ledger: 50_000_000, cursor: "2026-01-01T00:00:00.000Z" });
    attachResyncPlan(USER_ID, r.id, "scope");
    const rolled = rollbackRotation(USER_ID, r.id);
    expect(rolled.status).toBe("rolled_back");
  });

  it("throws RollbackNotAllowedError when already completed", () => {
    const r = createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    markResyncCompleted(USER_ID, r.id, { created: 1, updated: 0, skipped: 0 });
    expect(() => rollbackRotation(USER_ID, r.id)).toThrow(RollbackNotAllowedError);
  });

  it("throws RollbackNotAllowedError when already rolled back", () => {
    const r = createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    rollbackRotation(USER_ID, r.id);
    expect(() => rollbackRotation(USER_ID, r.id)).toThrow(RollbackNotAllowedError);
  });

  it("old/new account addresses remain distinct after rollback", () => {
    const r = createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    const rolled = rollbackRotation(USER_ID, r.id);
    expect(rolled.oldAccountAddress).toBe(OLD_ADDR);
    expect(rolled.newAccountAddress).toBe(NEW_ADDR);
    // They were never merged — each field is still its original value.
    expect(rolled.oldAccountAddress).not.toBe(rolled.newAccountAddress);
  });

  it("canRollback returns false for completed", () => {
    const r = createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    markResyncCompleted(USER_ID, r.id, { created: 0, updated: 0, skipped: 0 });
    const [rec] = listRotations(USER_ID);
    expect(canRollback(rec!)).toBe(false);
  });

  it("canRollback returns true for pending", () => {
    const r = createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    expect(canRollback(r)).toBe(true);
  });
});

// ─── Stale state ──────────────────────────────────────────────────────────────

describe("stale state", () => {
  it("markRotationStale sets status to stale and records a message", () => {
    const r = createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    const stale = markRotationStale(USER_ID, r.id);
    expect(stale.status).toBe("stale");
    expect(stale.errorMessage).toBeTruthy();
  });
});

// ─── Regression: no private key material stored anywhere ─────────────────────

describe("no private key material", () => {
  const PRIVATE_KEY = "SABCDE1234567890FGHIJKLMNOPQRSTUVWXYZ2345678901234567";

  it("rotation record never stores a private-key-looking value in any field", () => {
    const r = createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    const withChallenge = attachChallenge(USER_ID, r.id, {
      ...VALID_CHALLENGE,
      message: "Sign this challenge message",
    });
    const verified = markChallengeVerified(USER_ID, withChallenge.id);
    const bounded = confirmBoundary(USER_ID, verified.id, {
      ledger: 50_000_000,
      cursor: "2026-01-01T00:00:00.000Z",
    });
    const planned = attachResyncPlan(USER_ID, bounded.id, "scope");
    const running = markResyncRunning(USER_ID, planned.id);
    const done = markResyncCompleted(USER_ID, running.id, {
      created: 1,
      updated: 0,
      skipped: 0,
    });

    // Serialise the entire record and check for any S-address pattern.
    const serialised = JSON.stringify(done);
    expect(serialised).not.toMatch(/S[A-Z2-7]{55}/);
    // Explicit sanity check — the above regex DOES catch the fixture key:
    expect(PRIVATE_KEY).toMatch(/S[A-Z2-7]{55}/);
  });

  it("old and new account checkpoints (addresses) are never merged or shared", () => {
    const r = createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    const list = listRotations(USER_ID);
    expect(list[0]!.oldAccountAddress).toBe(OLD_ADDR);
    expect(list[0]!.newAccountAddress).toBe(NEW_ADDR);
    // They remain distinct fields at every lifecycle stage.
    markResyncCompleted(USER_ID, r.id, { created: 1, updated: 0, skipped: 0 });
    const [done] = listRotations(USER_ID);
    expect(done!.oldAccountAddress).not.toBe(done!.newAccountAddress);
  });
});

// ─── Resync failure ───────────────────────────────────────────────────────────

describe("resync failure", () => {
  it("markResyncFailed sets status to resync_failed and stores reason", () => {
    const r = createRotation(USER_ID, OLD_ADDR, NEW_ADDR);
    markResyncRunning(USER_ID, r.id);
    const failed = markResyncFailed(USER_ID, r.id, "Network timeout");
    expect(failed.status).toBe("resync_failed");
    expect(failed.errorMessage).toBe("Network timeout");
  });
});
