/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProofExpirationList } from "../proof-expiration-list";

const FIXED_TIME_ZONE = "America/New_York";

function proof(overrides: Partial<Parameters<typeof ProofExpirationList>[0]["proofs"][number]> = {}) {
  return {
    id: "proof-1",
    status: "VALID",
    expiresAt: "2026-07-01T12:00:00.000Z",
    revokedAt: null,
    supersededBy: null,
    typeLabel: "Minimum Income",
    ...overrides,
  };
}

describe("ProofExpirationList (#241)", () => {
  it("renders an empty state when there are no proofs", () => {
    render(<ProofExpirationList proofs={[]} timeZone={FIXED_TIME_ZONE} />);
    expect(screen.getByText("No proof expirations to show yet.")).toBeInTheDocument();
  });

  it("renders one list item per proof with an explicit, labeled timezone", () => {
    render(<ProofExpirationList proofs={[proof()]} timeZone={FIXED_TIME_ZONE} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(1);
    // formatDateTimeWithZone appends a timezone abbreviation (e.g. EDT) -
    // this is the "explicit timezone, not silently local" requirement.
    expect(items[0]).toHaveTextContent(/Expires .*(EDT|EST)/);
  });

  it("labels an upcoming proof as Upcoming", () => {
    render(
      <ProofExpirationList
        proofs={[proof({ expiresAt: "2099-01-01T00:00:00.000Z" })]}
        timeZone={FIXED_TIME_ZONE}
      />,
    );
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
  });

  it("labels an expired proof as Expired", () => {
    render(
      <ProofExpirationList
        proofs={[proof({ expiresAt: "2020-01-01T00:00:00.000Z" })]}
        timeZone={FIXED_TIME_ZONE}
      />,
    );
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });

  it("labels a revoked proof as Revoked, not Expired, even past its expiry", () => {
    render(
      <ProofExpirationList
        proofs={[proof({ expiresAt: "2020-01-01T00:00:00.000Z", revokedAt: "2020-01-01T00:00:00.000Z" })]}
        timeZone={FIXED_TIME_ZONE}
      />,
    );
    expect(screen.getByText("Revoked")).toBeInTheDocument();
    expect(screen.queryByText("Expired")).not.toBeInTheDocument();
  });

  it("labels a superseded proof as Superseded", () => {
    render(
      <ProofExpirationList
        proofs={[proof({ supersededBy: "proof-2" })]}
        timeZone={FIXED_TIME_ZONE}
      />,
    );
    expect(screen.getByText("Superseded")).toBeInTheDocument();
  });

  it("labels a disputed proof as Disputed", () => {
    render(
      <ProofExpirationList
        proofs={[proof({ disputeStatus: "pending" })]}
        timeZone={FIXED_TIME_ZONE}
      />,
    );
    expect(screen.getByText("Disputed")).toBeInTheDocument();
  });

  it("labels a proof with an unrecognized status value as Unknown rather than crashing", () => {
    expect(() =>
      render(
        <ProofExpirationList
          proofs={[proof({ expiresAt: "definitely-not-a-date" })]}
          timeZone={FIXED_TIME_ZONE}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("shows a renewal link for an eligible (upcoming) proof and calls onRenew when clicked", async () => {
    const user = userEvent.setup();
    const onRenew = jest.fn();
    render(
      <ProofExpirationList
        proofs={[proof({ id: "proof-eligible", expiresAt: "2099-01-01T00:00:00.000Z" })]}
        timeZone={FIXED_TIME_ZONE}
        onRenew={onRenew}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Review renewal" }));
    expect(onRenew).toHaveBeenCalledWith("proof-eligible");
    expect(onRenew).toHaveBeenCalledTimes(1);
  });

  it("does not show a renewal link for a revoked proof (never auto-renews, never offers it for ineligible proofs)", () => {
    render(
      <ProofExpirationList
        proofs={[proof({ revokedAt: "2020-01-01T00:00:00.000Z" })]}
        timeZone={FIXED_TIME_ZONE}
        onRenew={jest.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Review renewal" })).not.toBeInTheDocument();
  });

  it("does not show a renewal link for a disputed proof", () => {
    render(
      <ProofExpirationList
        proofs={[proof({ disputeStatus: "pending" })]}
        timeZone={FIXED_TIME_ZONE}
        onRenew={jest.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Review renewal" })).not.toBeInTheDocument();
  });

  it("never renders a claim/amount-looking value for any proof (privacy: list only takes display-safe fields)", () => {
    render(<ProofExpirationList proofs={[proof()]} timeZone={FIXED_TIME_ZONE} />);
    // The component's props contract has no amount/claim field to render in
    // the first place; this asserts no stray currency-like token leaks in.
    expect(screen.queryByText(/USDC|XLM|\$\d/)).not.toBeInTheDocument();
  });

  it("renders multiple proofs, each as its own list item", () => {
    render(
      <ProofExpirationList
        proofs={[proof({ id: "a" }), proof({ id: "b", typeLabel: "Payment Receipt" })]}
        timeZone={FIXED_TIME_ZONE}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
