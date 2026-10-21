/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { ShareLinkList } from "../share-link-list";
import type { ShareLinkWithStatus } from "@/lib/proof-sharing/store";
import { recordAccessAttempt } from "@/lib/proof-sharing/access-history";

function link(overrides: Partial<ShareLinkWithStatus>): ShareLinkWithStatus {
  return {
    id: "share-1",
    proofId: "proof-1",
    tokenHash: "hash",
    expiresInHours: 24,
    expiresAt: "2026-06-02T00:00:00.000Z",
    discloseAmount: false,
    discloseSender: false,
    createdAt: "2026-06-01T00:00:00.000Z",
    revokedAt: null,
    status: "ACTIVE",
    ...overrides,
  };
}

describe("ShareLinkList", () => {
  it("shows an empty-state message when there are no links", () => {
    render(<ShareLinkList links={[]} onRevoke={jest.fn()} revokingId={null} />);
    expect(screen.getByText(/No share links have been created/i)).toBeInTheDocument();
  });

  it("visually distinguishes ACTIVE, EXPIRED, and REVOKED links", () => {
    render(
      <ShareLinkList
        links={[
          link({ id: "a", status: "ACTIVE" }),
          link({ id: "b", status: "EXPIRED" }),
          link({ id: "c", status: "REVOKED" }),
        ]}
        onRevoke={jest.fn()}
        revokingId={null}
      />,
    );

    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("EXPIRED")).toBeInTheDocument();
    expect(screen.getByText("REVOKED")).toBeInTheDocument();
  });

  it("shows a Revoke button only for ACTIVE links", () => {
    render(
      <ShareLinkList
        links={[link({ id: "a", status: "ACTIVE" }), link({ id: "b", status: "EXPIRED" })]}
        onRevoke={jest.fn()}
        revokingId={null}
      />,
    );

    expect(screen.getAllByRole("button", { name: /Revoke/i })).toHaveLength(1);
  });

  it("calls onRevoke with the link id", () => {
    const onRevoke = jest.fn();
    render(<ShareLinkList links={[link({ id: "share-9" })]} onRevoke={onRevoke} revokingId={null} />);

    fireEvent.click(screen.getByRole("button", { name: /Revoke/i }));
    expect(onRevoke).toHaveBeenCalledWith("share-9");
  });

  it("disables the button for the link currently being revoked", () => {
    render(<ShareLinkList links={[link({ id: "share-9" })]} onRevoke={jest.fn()} revokingId="share-9" />);
    expect(screen.getByRole("button", { name: /Revoking/i })).toBeDisabled();
  });

  it("never renders a raw token or its hash", () => {
    render(<ShareLinkList links={[link({ tokenHash: "super-secret-hash-value" })]} onRevoke={jest.fn()} revokingId={null} />);
    expect(screen.queryByText("super-secret-hash-value")).not.toBeInTheDocument();
  });

  it("summarizes an empty disclosure policy as 'nothing extra'", () => {
    render(<ShareLinkList links={[link({})]} onRevoke={jest.fn()} revokingId={null} />);
    expect(screen.getByText("nothing extra")).toBeInTheDocument();
  });

  it("summarizes a non-empty disclosure policy", () => {
    render(
      <ShareLinkList links={[link({ discloseAmount: true, discloseSender: true })]} onRevoke={jest.fn()} revokingId={null} />,
    );
    expect(screen.getByText("amount, sender")).toBeInTheDocument();
  });

  describe("access history insights (#221)", () => {
    beforeEach(() => {
      window.localStorage.clear();
    });

    it("does not render access insights when userId is omitted", () => {
      render(<ShareLinkList links={[link({ id: "share-1" })]} onRevoke={jest.fn()} revokingId={null} />);
      expect(screen.queryByText(/No access attempts yet/i)).not.toBeInTheDocument();
    });

    it("renders access insights when userId is provided", () => {
      render(
        <ShareLinkList links={[link({ id: "share-1" })]} onRevoke={jest.fn()} revokingId={null} userId="user-1" />,
      );
      expect(screen.getByText(/No access attempts yet/i)).toBeInTheDocument();
    });

    it("reflects recorded access attempts for the matching link", () => {
      recordAccessAttempt("user-1", "share-1", "ACCEPTED");
      recordAccessAttempt("user-1", "share-1", "REJECTED");

      render(
        <ShareLinkList links={[link({ id: "share-1" })]} onRevoke={jest.fn()} revokingId={null} userId="user-1" />,
      );

      expect(screen.getByText(/Accepted: 1/)).toBeInTheDocument();
      expect(screen.getByText(/Rejected: 1/)).toBeInTheDocument();
    });
  });
});
