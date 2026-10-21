import {
  acceptDispute,
  DisputeNotFoundError,
  DuplicateDisputeError,
  findDispute,
  InvalidDisputeTransitionError,
  listDisputes,
  rejectDispute,
  resolveDispute,
  submitDispute,
  withdrawDispute,
} from "../store";

const DISPUTANT = "worker-1";
const REVIEWER = "reviewer-1";
const PROOF_ID = "proof-abc";

describe("proof-disputes store", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("submits a new dispute in the pending state with an initial history entry", () => {
    const dispute = submitDispute(DISPUTANT, {
      proofId: PROOF_ID,
      category: "incorrect_amount",
      evidenceCommitment: "evidence-hash-1",
    });

    expect(dispute.state).toBe("pending");
    expect(dispute.proofId).toBe(PROOF_ID);
    expect(dispute.submittedBy).toBe(DISPUTANT);
    expect(dispute.history).toHaveLength(1);
    expect(dispute.history[0]).toMatchObject({ state: "pending", actorId: DISPUTANT });
  });

  it("lists disputes scoped to a proof id", () => {
    submitDispute(DISPUTANT, { proofId: PROOF_ID, category: "other", evidenceCommitment: "hash-a" });
    submitDispute(DISPUTANT, { proofId: "proof-other", category: "other", evidenceCommitment: "hash-b" });

    expect(listDisputes(PROOF_ID)).toHaveLength(1);
    expect(listDisputes("proof-other")).toHaveLength(1);
  });

  it("makes a submitted dispute visible to a different actor viewing the same proof (reviewers are not the disputant)", () => {
    submitDispute(DISPUTANT, { proofId: PROOF_ID, category: "other", evidenceCommitment: "hash-a" });

    // A reviewer never calls submitDispute, but must still be able to
    // read the same proof-scoped list the disputant created.
    const visibleToReviewer = listDisputes(PROOF_ID);
    expect(visibleToReviewer).toHaveLength(1);
    expect(visibleToReviewer[0].submittedBy).toBe(DISPUTANT);
  });

  it("rejects a duplicate pending dispute for the same proof", () => {
    submitDispute(DISPUTANT, { proofId: PROOF_ID, category: "other", evidenceCommitment: "hash-a" });

    expect(() =>
      submitDispute(DISPUTANT, { proofId: PROOF_ID, category: "stale_data", evidenceCommitment: "hash-b" }),
    ).toThrow(DuplicateDisputeError);
  });

  it("rejects a duplicate pending dispute even from a different disputant", () => {
    submitDispute(DISPUTANT, { proofId: PROOF_ID, category: "other", evidenceCommitment: "hash-a" });

    expect(() =>
      submitDispute("another-worker", { proofId: PROOF_ID, category: "stale_data", evidenceCommitment: "hash-b" }),
    ).toThrow(DuplicateDisputeError);
  });

  it("allows a new dispute once the prior one is withdrawn", () => {
    const first = submitDispute(DISPUTANT, { proofId: PROOF_ID, category: "other", evidenceCommitment: "hash-a" });
    withdrawDispute(PROOF_ID, first.id, DISPUTANT);

    expect(() =>
      submitDispute(DISPUTANT, { proofId: PROOF_ID, category: "stale_data", evidenceCommitment: "hash-b" }),
    ).not.toThrow();
  });

  it("allows a new dispute once the prior one is resolved", () => {
    const first = submitDispute(DISPUTANT, { proofId: PROOF_ID, category: "other", evidenceCommitment: "hash-a" });
    acceptDispute(PROOF_ID, first.id, REVIEWER);
    resolveDispute(PROOF_ID, first.id, REVIEWER);

    expect(() =>
      submitDispute(DISPUTANT, { proofId: PROOF_ID, category: "stale_data", evidenceCommitment: "hash-b" }),
    ).not.toThrow();
  });

  it("withdraws a pending dispute and appends a timestamped history entry", () => {
    const dispute = submitDispute(DISPUTANT, { proofId: PROOF_ID, category: "other", evidenceCommitment: "hash-a" });
    const withdrawn = withdrawDispute(PROOF_ID, dispute.id, DISPUTANT);

    expect(withdrawn.state).toBe("withdrawn");
    expect(withdrawn.history).toHaveLength(2);
    expect(withdrawn.history[1].state).toBe("withdrawn");
  });

  it("accepts then resolves a pending dispute in sequence", () => {
    const dispute = submitDispute(DISPUTANT, { proofId: PROOF_ID, category: "other", evidenceCommitment: "hash-a" });
    const accepted = acceptDispute(PROOF_ID, dispute.id, REVIEWER, "looks credible");
    expect(accepted.state).toBe("accepted");

    const resolved = resolveDispute(PROOF_ID, accepted.id, REVIEWER, "refund issued");
    expect(resolved.state).toBe("resolved");
    expect(resolved.history.map((event) => event.state)).toEqual(["pending", "accepted", "resolved"]);
  });

  it("rejects a pending dispute", () => {
    const dispute = submitDispute(DISPUTANT, { proofId: PROOF_ID, category: "other", evidenceCommitment: "hash-a" });
    const rejected = rejectDispute(PROOF_ID, dispute.id, REVIEWER);
    expect(rejected.state).toBe("rejected");
  });

  it("throws on an invalid transition out of a terminal state", () => {
    const dispute = submitDispute(DISPUTANT, { proofId: PROOF_ID, category: "other", evidenceCommitment: "hash-a" });
    rejectDispute(PROOF_ID, dispute.id, REVIEWER);

    expect(() => acceptDispute(PROOF_ID, dispute.id, REVIEWER)).toThrow(InvalidDisputeTransitionError);
    expect(() => withdrawDispute(PROOF_ID, dispute.id, DISPUTANT)).toThrow(InvalidDisputeTransitionError);
  });

  it("throws on an invalid transition from accepted back to pending-only actions", () => {
    const dispute = submitDispute(DISPUTANT, { proofId: PROOF_ID, category: "other", evidenceCommitment: "hash-a" });
    acceptDispute(PROOF_ID, dispute.id, REVIEWER);

    expect(() => rejectDispute(PROOF_ID, dispute.id, REVIEWER)).toThrow(InvalidDisputeTransitionError);
  });

  it("throws DisputeNotFoundError for an unknown dispute id", () => {
    expect(() => withdrawDispute(PROOF_ID, "does-not-exist", DISPUTANT)).toThrow(DisputeNotFoundError);
  });

  it("finds a single dispute by id", () => {
    const dispute = submitDispute(DISPUTANT, { proofId: PROOF_ID, category: "other", evidenceCommitment: "hash-a" });
    expect(findDispute(PROOF_ID, dispute.id)?.id).toBe(dispute.id);
    expect(findDispute(PROOF_ID, "missing")).toBeNull();
  });

  it("ignores corrupted storage content instead of throwing", () => {
    window.localStorage.setItem(`earnproof.proof-disputes.${PROOF_ID}`, "not json");
    expect(listDisputes(PROOF_ID)).toEqual([]);
  });

  it("filters out malformed records from storage", () => {
    window.localStorage.setItem(
      `earnproof.proof-disputes.${PROOF_ID}`,
      JSON.stringify([{ id: "bad-record" }]),
    );
    expect(listDisputes(PROOF_ID)).toEqual([]);
  });

  it("never mutates proof validity/revocation fields - the record has none", () => {
    const dispute = submitDispute(DISPUTANT, { proofId: PROOF_ID, category: "other", evidenceCommitment: "hash-a" });
    expect(dispute).not.toHaveProperty("status");
    expect(dispute).not.toHaveProperty("revokedAt");
  });
});
