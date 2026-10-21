import {
  approveRoleChangeRequest,
  cancelRoleChangeRequest,
  DuplicateApprovalError,
  DuplicateRoleChangeRequestError,
  findRoleChangeRequest,
  InvalidRoleChangeTransitionError,
  listRoleChangeRequests,
  rejectRoleChangeRequest,
  RoleChangeRequestNotFoundError,
  submitRoleChangeRequest,
} from "../store";

const ORG_ID = "org-1";
const REQUESTER = "requester-1";
const APPROVER_A = "approver-a";
const APPROVER_B = "approver-b";
const TARGET_MEMBER = "member-1";
const NOW = new Date("2026-01-01T00:00:00.000Z");

function submit(now = NOW) {
  return submitRoleChangeRequest(
    ORG_ID,
    {
      requesterId: REQUESTER,
      targetMemberId: TARGET_MEMBER,
      oldRole: "MEMBER",
      proposedRole: "ADMIN",
      justification: "Needs admin access for the Q1 launch.",
      validityHours: 72,
    },
    now,
  );
}

describe("role-change-requests store", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("submits a new pending request with the correct expiry", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const request = submit(now);

    expect(request.state).toBe("pending");
    expect(request.oldRole).toBe("MEMBER");
    expect(request.proposedRole).toBe("ADMIN");
    expect(request.approvals).toEqual([]);
    expect(new Date(request.expiresAt).getTime() - now.getTime()).toBe(72 * 60 * 60 * 1000);
  });

  it("lists requests scoped to the organization id, visible to any actor (not just the requester)", () => {
    submit();
    expect(listRoleChangeRequests(ORG_ID)).toHaveLength(1);
  });

  it("rejects a duplicate pending request for the same target member", () => {
    submit();
    expect(() => submit()).toThrow(DuplicateRoleChangeRequestError);
  });

  it("allows a new request once the prior one is rejected", () => {
    const first = submit();
    rejectRoleChangeRequest(ORG_ID, first.id, APPROVER_A, undefined, NOW);
    expect(() => submit()).not.toThrow();
  });

  it("allows a new request once the prior one has expired", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    submit(createdAt);

    const afterExpiry = new Date(createdAt.getTime() + 73 * 60 * 60 * 1000);
    // Listing after expiry flips the stale request to "expired" first.
    expect(listRoleChangeRequests(ORG_ID, afterExpiry)[0].state).toBe("expired");

    expect(() =>
      submitRoleChangeRequest(
        ORG_ID,
        {
          requesterId: REQUESTER,
          targetMemberId: TARGET_MEMBER,
          oldRole: "MEMBER",
          proposedRole: "ADMIN",
          justification: "Retrying after expiry.",
          validityHours: 72,
        },
        afterExpiry,
      ),
    ).not.toThrow();
  });

  it("records a single approval without completing the request below the required threshold", () => {
    const request = submit();
    const updated = approveRoleChangeRequest(ORG_ID, request.id, APPROVER_A, 2, NOW);

    expect(updated.state).toBe("pending");
    expect(updated.approvals).toHaveLength(1);
  });

  it("transitions to approved once the required number of independent approvals is reached", () => {
    const request = submit();
    approveRoleChangeRequest(ORG_ID, request.id, APPROVER_A, 2, NOW);
    const updated = approveRoleChangeRequest(ORG_ID, request.id, APPROVER_B, 2, NOW);

    expect(updated.state).toBe("approved");
    expect(updated.approvals).toHaveLength(2);
  });

  it("throws DuplicateApprovalError for the same approver approving twice (concurrency/double-click guard)", () => {
    const request = submit();
    approveRoleChangeRequest(ORG_ID, request.id, APPROVER_A, 2, NOW);

    expect(() => approveRoleChangeRequest(ORG_ID, request.id, APPROVER_A, 2, NOW)).toThrow(DuplicateApprovalError);
  });

  it("rejects a pending request", () => {
    const request = submit();
    const updated = rejectRoleChangeRequest(ORG_ID, request.id, APPROVER_A, "Insufficient justification", NOW);

    expect(updated.state).toBe("rejected");
    expect(updated.rejection).toMatchObject({ approverId: APPROVER_A, reason: "Insufficient justification" });
  });

  it("cancels a pending request", () => {
    const request = submit();
    const updated = cancelRoleChangeRequest(ORG_ID, request.id, REQUESTER, NOW);

    expect(updated.state).toBe("cancelled");
    expect(updated.cancellation?.actorId).toBe(REQUESTER);
  });

  it("throws on approving an already-rejected request (stale/already-decided)", () => {
    const request = submit();
    rejectRoleChangeRequest(ORG_ID, request.id, APPROVER_A, undefined, NOW);

    expect(() => approveRoleChangeRequest(ORG_ID, request.id, APPROVER_B, 1, NOW)).toThrow(
      InvalidRoleChangeTransitionError,
    );
  });

  it("throws on approving an expired request", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const request = submit(createdAt);
    const afterExpiry = new Date(createdAt.getTime() + 73 * 60 * 60 * 1000);

    expect(() => approveRoleChangeRequest(ORG_ID, request.id, APPROVER_A, 1, afterExpiry)).toThrow(
      InvalidRoleChangeTransitionError,
    );
  });

  it("throws on cancelling an already-approved request", () => {
    const request = submit();
    approveRoleChangeRequest(ORG_ID, request.id, APPROVER_A, 1, NOW);

    expect(() => cancelRoleChangeRequest(ORG_ID, request.id, REQUESTER, NOW)).toThrow(InvalidRoleChangeTransitionError);
  });

  it("throws RoleChangeRequestNotFoundError for an unknown request id", () => {
    expect(() => approveRoleChangeRequest(ORG_ID, "does-not-exist", APPROVER_A, 1, NOW)).toThrow(
      RoleChangeRequestNotFoundError,
    );
  });

  it("finds a single request by id", () => {
    const request = submit();
    expect(findRoleChangeRequest(ORG_ID, request.id)?.id).toBe(request.id);
    expect(findRoleChangeRequest(ORG_ID, "missing")).toBeNull();
  });

  it("ignores corrupted storage content instead of throwing", () => {
    window.localStorage.setItem(`earnproof.role-change-requests.${ORG_ID}`, "not json");
    expect(listRoleChangeRequests(ORG_ID)).toEqual([]);
  });

  it("filters out malformed records from storage", () => {
    window.localStorage.setItem(
      `earnproof.role-change-requests.${ORG_ID}`,
      JSON.stringify([{ id: "bad-record" }]),
    );
    expect(listRoleChangeRequests(ORG_ID)).toEqual([]);
  });
});
