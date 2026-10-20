import { createShareLink, revokeShareLink, type ShareLinkRecord } from "../store";
import {
  recordAccessAttempt,
  summarizeAccessHistory,
  historicalCountsUnaffectedByRevocation,
} from "../access-history";

const USER = "user-1";

async function createLink(overrides: Partial<Parameters<typeof createShareLink>[1]> = {}): Promise<ShareLinkRecord> {
  const { record } = await createShareLink(USER, {
    proofId: "proof-1",
    expiresInHours: 24,
    discloseAmount: false,
    discloseSender: false,
    ...overrides,
  });
  return record;
}

describe("proof sharing access history: unused link", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("summarizes a link with zero attempts", async () => {
    const link = await createLink();
    const summary = summarizeAccessHistory(USER, link);

    expect(summary.totalAttempts).toBe(0);
    expect(summary.acceptedCount).toBe(0);
    expect(summary.status).toBe("ACTIVE");
    expect(summary.recent).toEqual([]);
    expect(summary.flaggedAsSuspicious).toBe(false);
  });
});

describe("proof sharing access history: active link", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("counts accepted accesses and orders recent attempts deterministically", async () => {
    const link = await createLink();
    const base = new Date("2026-06-15T12:00:00.000Z");

    recordAccessAttempt(USER, link.id, "ACCEPTED", new Date(base.getTime() + 1000));
    recordAccessAttempt(USER, link.id, "ACCEPTED", new Date(base.getTime() + 3000));
    recordAccessAttempt(USER, link.id, "ACCEPTED", new Date(base.getTime() + 2000));

    const summary = summarizeAccessHistory(USER, link);
    expect(summary.totalAttempts).toBe(3);
    expect(summary.acceptedCount).toBe(3);
    // Newest first, deterministically, regardless of insertion order.
    expect(summary.recent.map((e) => e.occurredAt)).toEqual([
      new Date(base.getTime() + 3000).toISOString(),
      new Date(base.getTime() + 2000).toISOString(),
      new Date(base.getTime() + 1000).toISOString(),
    ]);
  });

  it("produces the same ordering across repeated calls (stable, not just sorted once)", async () => {
    const link = await createLink();
    recordAccessAttempt(USER, link.id, "ACCEPTED");
    recordAccessAttempt(USER, link.id, "REJECTED");

    const first = summarizeAccessHistory(USER, link).recent.map((e) => e.id);
    const second = summarizeAccessHistory(USER, link).recent.map((e) => e.id);
    expect(first).toEqual(second);
  });
});

describe("proof sharing access history: expired link", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("reflects EXPIRED status while retaining prior access counts", async () => {
    const link = await createLink({ expiresInHours: 1 });
    recordAccessAttempt(USER, link.id, "ACCEPTED");

    const future = Date.now() + 2 * 60 * 60 * 1000; // 2h later, past the 1h expiry
    const summary = summarizeAccessHistory(USER, link, future);

    expect(summary.status).toBe("EXPIRED");
    expect(summary.acceptedCount).toBe(1);
  });

  it("records an EXPIRED outcome distinctly from ACCEPTED/REJECTED", async () => {
    const link = await createLink();
    recordAccessAttempt(USER, link.id, "EXPIRED");

    const summary = summarizeAccessHistory(USER, link);
    expect(summary.expiredCount).toBe(1);
    expect(summary.acceptedCount).toBe(0);
    expect(summary.rejectedCount).toBe(0);
  });
});

describe("proof sharing access history: revoked link", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("keeps historical counts after revocation, only status changes", async () => {
    const link = await createLink();
    recordAccessAttempt(USER, link.id, "ACCEPTED");
    recordAccessAttempt(USER, link.id, "ACCEPTED");

    const before = summarizeAccessHistory(USER, link);
    expect(before.status).toBe("ACTIVE");

    const revoked = revokeShareLink(USER, link.id);
    const after = summarizeAccessHistory(USER, revoked);

    expect(after.status).toBe("REVOKED");
    expect(historicalCountsUnaffectedByRevocation(before, after)).toBe(true);
    expect(after.totalAttempts).toBe(2);
    expect(after.acceptedCount).toBe(2);
  });
});

describe("proof sharing access history: abused link", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("flags a link as suspicious once rejected attempts cross the threshold", async () => {
    const link = await createLink();
    recordAccessAttempt(USER, link.id, "REJECTED");
    recordAccessAttempt(USER, link.id, "REJECTED");
    let summary = summarizeAccessHistory(USER, link);
    expect(summary.flaggedAsSuspicious).toBe(false);

    recordAccessAttempt(USER, link.id, "REJECTED");
    summary = summarizeAccessHistory(USER, link);
    expect(summary.flaggedAsSuspicious).toBe(true);
  });

  it("allows connecting suspicious activity to immediate revocation without losing the flag basis", async () => {
    const link = await createLink();
    recordAccessAttempt(USER, link.id, "REJECTED");
    recordAccessAttempt(USER, link.id, "REJECTED");
    recordAccessAttempt(USER, link.id, "REJECTED");

    const flagged = summarizeAccessHistory(USER, link);
    expect(flagged.flaggedAsSuspicious).toBe(true);

    const revoked = revokeShareLink(USER, link.id);
    const after = summarizeAccessHistory(USER, revoked);
    expect(after.status).toBe("REVOKED");
    expect(after.flaggedAsSuspicious).toBe(true);
    expect(after.rejectedCount).toBe(3);
  });
});

describe("proof sharing access history: privacy requirement", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("recordAccessAttempt has no parameter for raw token, IP, or verifier payload", () => {
    // Signature is (userId, shareLinkId, outcome, now?) — four params max,
    // none of which is a free-form payload/IP/token field.
    expect(recordAccessAttempt.length).toBeLessThanOrEqual(4);
  });

  it("never persists anything beyond id/shareLinkId/outcome/occurredAt in storage", async () => {
    const link = await createLink();
    recordAccessAttempt(USER, link.id, "ACCEPTED");

    const raw = window.localStorage.getItem(`earnproof.proof-share-access-history.${USER}`);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as Array<Record<string, unknown>>;
    for (const event of parsed) {
      expect(Object.keys(event).sort()).toEqual(["id", "occurredAt", "outcome", "shareLinkId"]);
    }
  });
});
