import {
  canReviewDispute,
  canSubmitDispute,
  canWithdrawDispute,
  isSafeEvidenceCommitment,
  isValidDisputeNote,
  MAX_DISPUTE_NOTE_LENGTH,
} from "../proof-dispute";
import type { DisputeRecord } from "@/lib/proof-disputes/store";

function record(overrides: Partial<DisputeRecord> = {}): DisputeRecord {
  return {
    id: "dispute-1",
    proofId: "proof-1",
    submittedBy: "worker-1",
    category: "other",
    evidenceCommitment: "hash-a",
    state: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    history: [{ state: "pending", at: "2026-01-01T00:00:00.000Z", actorId: "worker-1" }],
    ...overrides,
  };
}

describe("canSubmitDispute", () => {
  it("allows WORKER, ISSUER, and ADMIN to submit", () => {
    expect(canSubmitDispute("WORKER")).toBe(true);
    expect(canSubmitDispute("ISSUER")).toBe(true);
    expect(canSubmitDispute("ADMIN")).toBe(true);
  });

  it("forbids DEVELOPER from submitting", () => {
    expect(canSubmitDispute("DEVELOPER")).toBe(false);
  });
});

describe("canWithdrawDispute", () => {
  it("allows the original disputant to withdraw a pending dispute", () => {
    expect(canWithdrawDispute(record(), "worker-1")).toBe(true);
  });

  it("forbids a different actor from withdrawing someone else's dispute", () => {
    expect(canWithdrawDispute(record(), "someone-else")).toBe(false);
  });

  it("forbids withdrawing a non-pending dispute", () => {
    expect(canWithdrawDispute(record({ state: "accepted" }), "worker-1")).toBe(false);
    expect(canWithdrawDispute(record({ state: "resolved" }), "worker-1")).toBe(false);
  });
});

describe("canReviewDispute", () => {
  it("allows ISSUER and ADMIN to review a pending dispute", () => {
    expect(canReviewDispute("ISSUER", record({ state: "pending" }))).toBe(true);
    expect(canReviewDispute("ADMIN", record({ state: "pending" }))).toBe(true);
  });

  it("allows reviewing an accepted dispute (to resolve it)", () => {
    expect(canReviewDispute("ADMIN", record({ state: "accepted" }))).toBe(true);
  });

  it("forbids WORKER and DEVELOPER from reviewing", () => {
    expect(canReviewDispute("WORKER", record())).toBe(false);
    expect(canReviewDispute("DEVELOPER", record())).toBe(false);
  });

  it("forbids reviewing a terminal-state dispute", () => {
    expect(canReviewDispute("ADMIN", record({ state: "rejected" }))).toBe(false);
    expect(canReviewDispute("ADMIN", record({ state: "withdrawn" }))).toBe(false);
    expect(canReviewDispute("ADMIN", record({ state: "resolved" }))).toBe(false);
  });
});

describe("isSafeEvidenceCommitment", () => {
  it("accepts a plain hash-like reference", () => {
    expect(isSafeEvidenceCommitment("a1b2c3d4e5f6")).toBe(true);
    expect(isSafeEvidenceCommitment("ref_2026-01-01:case-01")).toBe(true);
  });

  it("rejects an empty or whitespace-only value", () => {
    expect(isSafeEvidenceCommitment("")).toBe(false);
    expect(isSafeEvidenceCommitment("   ")).toBe(false);
  });

  it("rejects anything shaped like a URL", () => {
    expect(isSafeEvidenceCommitment("https://evil.example/evidence")).toBe(false);
    expect(isSafeEvidenceCommitment("javascript:alert(1)")).toBe(false);
  });

  it("rejects anything shaped like markup", () => {
    expect(isSafeEvidenceCommitment("<img src=x onerror=alert(1)>")).toBe(false);
    expect(isSafeEvidenceCommitment("abc\"onmouseover=alert(1)")).toBe(false);
  });

  it("rejects a value shorter than 8 characters", () => {
    expect(isSafeEvidenceCommitment("short")).toBe(false);
  });

  it("rejects a value longer than 128 characters", () => {
    expect(isSafeEvidenceCommitment("a".repeat(129))).toBe(false);
  });
});

describe("isValidDisputeNote", () => {
  it("allows an undefined note", () => {
    expect(isValidDisputeNote(undefined)).toBe(true);
  });

  it("allows a note at the length limit", () => {
    expect(isValidDisputeNote("a".repeat(MAX_DISPUTE_NOTE_LENGTH))).toBe(true);
  });

  it("rejects a note over the length limit", () => {
    expect(isValidDisputeNote("a".repeat(MAX_DISPUTE_NOTE_LENGTH + 1))).toBe(false);
  });
});
