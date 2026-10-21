/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProofDisputePanel } from "../proof-dispute-panel";
import { submitDispute, acceptDispute } from "@/lib/proof-disputes/store";

const PROOF_ID = "proof-1";
const DISPUTANT = "worker-1";
const REVIEWER = "reviewer-1";

async function fillAndSubmit(evidence = "hash-evidence-1") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/evidence commitment/i), evidence);
  await user.click(screen.getByRole("button", { name: /submit dispute/i }));
  return user;
}

describe("ProofDisputePanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows the submission form for an eligible WORKER actor", () => {
    render(<ProofDisputePanel proofId={PROOF_ID} currentActorId={DISPUTANT} currentActorRole="WORKER" />);
    expect(screen.getByRole("heading", { name: /raise a dispute/i })).toBeInTheDocument();
  });

  it("hides the submission form for a DEVELOPER actor (forbidden access)", () => {
    render(<ProofDisputePanel proofId={PROOF_ID} currentActorId={DISPUTANT} currentActorRole="DEVELOPER" />);
    expect(screen.queryByRole("heading", { name: /raise a dispute/i })).not.toBeInTheDocument();
  });

  it("submits a dispute and shows it as pending", async () => {
    render(<ProofDisputePanel proofId={PROOF_ID} currentActorId={DISPUTANT} currentActorRole="WORKER" />);

    await fillAndSubmit();

    await waitFor(() => expect(screen.getByTestId("dispute-state-badge")).toHaveTextContent("Pending"));
  });

  it("blocks a duplicate pending dispute submission for the same proof with a visible error", async () => {
    submitDispute(DISPUTANT, { proofId: PROOF_ID, category: "other", evidenceCommitment: "existing-hash-1" });

    render(<ProofDisputePanel proofId={PROOF_ID} currentActorId={DISPUTANT} currentActorRole="WORKER" />);
    await fillAndSubmit("new-hash-attempt-1");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/already exists/i));
  });

  it("lets the disputant withdraw their own pending dispute", async () => {
    render(<ProofDisputePanel proofId={PROOF_ID} currentActorId={DISPUTANT} currentActorRole="WORKER" />);
    await fillAndSubmit();
    await waitFor(() => expect(screen.getByTestId("dispute-state-badge")).toHaveTextContent("Pending"));

    fireEvent.click(screen.getByRole("button", { name: /withdraw/i }));

    await waitFor(() => expect(screen.getByTestId("dispute-state-badge")).toHaveTextContent("Withdrawn"));
  });

  it("does not show a withdraw control to a reviewer who is not the original disputant", () => {
    submitDispute(DISPUTANT, { proofId: PROOF_ID, category: "other", evidenceCommitment: "hash-a" });
    render(<ProofDisputePanel proofId={PROOF_ID} currentActorId={REVIEWER} currentActorRole="ISSUER" />);

    expect(screen.queryByRole("button", { name: /withdraw/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^accept$/i })).toBeInTheDocument();
  });

  it("does not show a withdraw control to the disputant if they are also acting as ISSUER on their own dispute, once it is no longer pending", async () => {
    const dispute = submitDispute(DISPUTANT, { proofId: PROOF_ID, category: "other", evidenceCommitment: "hash-a" });
    acceptDispute(PROOF_ID, dispute.id, REVIEWER);

    render(<ProofDisputePanel proofId={PROOF_ID} currentActorId={DISPUTANT} currentActorRole="WORKER" />);
    expect(screen.queryByRole("button", { name: /withdraw/i })).not.toBeInTheDocument();
  });

  it("shows accept/reject controls to an ISSUER reviewer but not to a WORKER", () => {
    submitDispute(DISPUTANT, { proofId: PROOF_ID, category: "other", evidenceCommitment: "hash-a" });

    const { rerender } = render(
      <ProofDisputePanel proofId={PROOF_ID} currentActorId={REVIEWER} currentActorRole="WORKER" />,
    );
    expect(screen.queryByRole("button", { name: /^accept$/i })).not.toBeInTheDocument();

    rerender(<ProofDisputePanel proofId={PROOF_ID} currentActorId={REVIEWER} currentActorRole="ISSUER" />);
    expect(screen.getByRole("button", { name: /^accept$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument();
  });

  it("accepts then resolves a dispute as an ISSUER reviewer", async () => {
    submitDispute(DISPUTANT, { proofId: PROOF_ID, category: "other", evidenceCommitment: "hash-a" });
    render(<ProofDisputePanel proofId={PROOF_ID} currentActorId={REVIEWER} currentActorRole="ISSUER" />);

    fireEvent.click(screen.getByRole("button", { name: /^accept$/i }));
    await waitFor(() => expect(screen.getByTestId("dispute-state-badge")).toHaveTextContent("Accepted"));

    fireEvent.click(screen.getByRole("button", { name: /mark resolved/i }));
    await waitFor(() => expect(screen.getByTestId("dispute-state-badge")).toHaveTextContent("Resolved"));
  });

  it("rejects a dispute as an ADMIN reviewer", async () => {
    submitDispute(DISPUTANT, { proofId: PROOF_ID, category: "other", evidenceCommitment: "hash-a" });
    render(<ProofDisputePanel proofId={PROOF_ID} currentActorId={REVIEWER} currentActorRole="ADMIN" />);

    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    await waitFor(() => expect(screen.getByTestId("dispute-state-badge")).toHaveTextContent("Rejected"));
  });

  it("renders an evidence commitment as inert text, never as a link", () => {
    submitDispute(DISPUTANT, { proofId: PROOF_ID, category: "other", evidenceCommitment: "not-a-link-hash" });
    render(<ProofDisputePanel proofId={PROOF_ID} currentActorId={REVIEWER} currentActorRole="ISSUER" />);

    expect(screen.getByText("not-a-link-hash")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no disputes for the proof", () => {
    render(<ProofDisputePanel proofId={PROOF_ID} currentActorId={DISPUTANT} currentActorRole="WORKER" />);
    expect(screen.getByText(/no disputes have been raised/i)).toBeInTheDocument();
  });

  it("does not allow re-reviewing a dispute once resolved (terminal state)", async () => {
    const dispute = submitDispute(DISPUTANT, { proofId: PROOF_ID, category: "other", evidenceCommitment: "hash-a" });
    acceptDispute(PROOF_ID, dispute.id, REVIEWER);

    render(<ProofDisputePanel proofId={PROOF_ID} currentActorId={REVIEWER} currentActorRole="ISSUER" />);
    fireEvent.click(screen.getByRole("button", { name: /mark resolved/i }));

    await waitFor(() => expect(screen.getByTestId("dispute-state-badge")).toHaveTextContent("Resolved"));
    expect(screen.queryByRole("button", { name: /^accept$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark resolved/i })).not.toBeInTheDocument();
  });
});
