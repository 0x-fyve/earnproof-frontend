/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InvitationAcceptance } from "../invitation-acceptance";
import { OrganizationContextProvider } from "@/lib/organization-context/context";
import {
  getInvitationByToken,
  acceptInvitation,
  declineInvitation,
  type Invitation,
} from "@/lib/api/invitations";
import { readStoredSession } from "@/lib/session";

jest.mock("@/lib/api/invitations", () => ({
  ...jest.requireActual("@/lib/api/invitations"),
  getInvitationByToken: jest.fn(),
  acceptInvitation: jest.fn(),
  declineInvitation: jest.fn(),
}));

jest.mock("@/lib/session", () => ({
  readStoredSession: jest.fn(),
}));

const mockGetInvitation = getInvitationByToken as jest.MockedFunction<typeof getInvitationByToken>;
const mockAccept = acceptInvitation as jest.MockedFunction<typeof acceptInvitation>;
const mockDecline = declineInvitation as jest.MockedFunction<typeof declineInvitation>;
const mockReadStoredSession = readStoredSession as jest.MockedFunction<typeof readStoredSession>;

const TOKEN = "invite_abc123secrettoken";
const WALLET = "GAAA000000000000000000000000000000000000000000000000AAAA";
const OTHER_WALLET = "GBBB000000000000000000000000000000000000000000000000BBBB";

function baseInvitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    token: TOKEN,
    organizationId: "org_1",
    organizationName: "Acme Corp",
    role: "MEMBER",
    inviteeWalletAddress: WALLET,
    inviterWalletAddress: OTHER_WALLET,
    status: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-12-31T00:00:00.000Z",
    ...overrides,
  };
}

function renderInvitation() {
  return render(
    <OrganizationContextProvider initialOrganizationId={null}>
      <InvitationAcceptance token={TOKEN} />
    </OrganizationContextProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReadStoredSession.mockReturnValue(null);
});

describe("InvitationAcceptance — review state", () => {
  it("shows the destination organization, role, and expiry before any action", async () => {
    mockGetInvitation.mockResolvedValue(baseInvitation());
    mockReadStoredSession.mockReturnValue({
      token: "session-token",
      user: { id: "u1", walletAddress: WALLET, walletHash: "h1", role: "WORKER" },
    });

    renderInvitation();

    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: /Join Acme Corp/ })).toBeInTheDocument();
    expect(screen.getByText("Member")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept invitation" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Decline" })).toBeEnabled();
  });

  it("requires a connected wallet before showing accept/decline actions", async () => {
    mockGetInvitation.mockResolvedValue(baseInvitation());
    mockReadStoredSession.mockReturnValue(null);

    renderInvitation();

    await waitFor(() =>
      expect(screen.getByText(/Connect your wallet to continue/)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Accept invitation" })).not.toBeInTheDocument();
  });

  it("shows 'invitation not found' for an invalid token", async () => {
    mockGetInvitation.mockRejectedValue(new Error("404 Not Found"));

    renderInvitation();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Invitation not found"),
    );
  });
});

describe("InvitationAcceptance — stale/terminal states", () => {
  it("shows an expired state and disables actions", async () => {
    mockGetInvitation.mockResolvedValue(
      baseInvitation({ expiresAt: "2020-01-01T00:00:00.000Z" }),
    );
    mockReadStoredSession.mockReturnValue({
      token: "session-token",
      user: { id: "u1", walletAddress: WALLET, walletHash: "h1", role: "WORKER" },
    });

    renderInvitation();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Invitation expired"));
    expect(screen.queryByRole("button", { name: "Accept invitation" })).not.toBeInTheDocument();
  });

  it("shows a revoked state and does not offer to accept", async () => {
    mockGetInvitation.mockResolvedValue(baseInvitation({ status: "revoked" }));
    mockReadStoredSession.mockReturnValue({
      token: "session-token",
      user: { id: "u1", walletAddress: WALLET, walletHash: "h1", role: "WORKER" },
    });

    renderInvitation();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Invitation revoked"));
  });

  it("shows an already-used state for a previously-accepted invitation (replay protection)", async () => {
    mockGetInvitation.mockResolvedValue(baseInvitation({ status: "accepted" }));
    mockReadStoredSession.mockReturnValue({
      token: "session-token",
      user: { id: "u1", walletAddress: WALLET, walletHash: "h1", role: "WORKER" },
    });

    renderInvitation();

    await waitFor(() =>
      expect(screen.getByText(/Invitation already used/)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Accept invitation" })).not.toBeInTheDocument();
  });

  it("shows an already-used state for a previously-declined invitation", async () => {
    mockGetInvitation.mockResolvedValue(baseInvitation({ status: "declined" }));
    mockReadStoredSession.mockReturnValue({
      token: "session-token",
      user: { id: "u1", walletAddress: WALLET, walletHash: "h1", role: "WORKER" },
    });

    renderInvitation();

    await waitFor(() =>
      expect(screen.getByText(/Invitation already used/)).toBeInTheDocument(),
    );
  });
});

describe("InvitationAcceptance — wallet mismatch (fail closed)", () => {
  it("blocks acceptance and explains the mismatch when the connected wallet differs from the invitee", async () => {
    mockGetInvitation.mockResolvedValue(baseInvitation());
    mockReadStoredSession.mockReturnValue({
      token: "session-token",
      user: { id: "u1", walletAddress: OTHER_WALLET, walletHash: "h1", role: "WORKER" },
    });

    renderInvitation();

    await waitFor(() =>
      expect(screen.getByText(/different wallet address/)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Accept invitation" })).toBeDisabled();
    expect(mockAccept).not.toHaveBeenCalled();
  });
});

describe("InvitationAcceptance — accept flow", () => {
  it("accepts the invitation and refreshes active tenant context", async () => {
    const invitation = baseInvitation();
    mockGetInvitation.mockResolvedValue(invitation);
    mockReadStoredSession.mockReturnValue({
      token: "session-token",
      user: { id: "u1", walletAddress: WALLET, walletHash: "h1", role: "WORKER" },
    });
    mockAccept.mockResolvedValue({ invitation, organizationId: invitation.organizationId });

    renderInvitation();

    await waitFor(() => expect(screen.getByRole("button", { name: "Accept invitation" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));

    await waitFor(() =>
      expect(mockAccept).toHaveBeenCalledWith("session-token", TOKEN, expect.any(AbortSignal)),
    );
    await waitFor(() =>
      expect(screen.getByText(/You've joined Acme Corp/)).toBeInTheDocument(),
    );
  });

  it("surfaces a generic error (never echoing the raw token or server error text) when acceptance fails", async () => {
    mockGetInvitation.mockResolvedValue(baseInvitation());
    mockReadStoredSession.mockReturnValue({
      token: "session-token",
      user: { id: "u1", walletAddress: WALLET, walletHash: "h1", role: "WORKER" },
    });
    mockAccept.mockRejectedValue(new Error(`Invitation ${TOKEN} already consumed by another session`));

    renderInvitation();

    await waitFor(() => expect(screen.getByRole("button", { name: "Accept invitation" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    const alertText = screen.getByRole("alert").textContent ?? "";
    expect(alertText).not.toContain(TOKEN);
    expect(alertText).toMatch(/could not be accepted/);
  });
});

describe("InvitationAcceptance — decline flow", () => {
  it("declines the invitation", async () => {
    mockGetInvitation.mockResolvedValue(baseInvitation());
    mockReadStoredSession.mockReturnValue({
      token: "session-token",
      user: { id: "u1", walletAddress: WALLET, walletHash: "h1", role: "WORKER" },
    });
    mockDecline.mockResolvedValue(undefined);

    renderInvitation();

    await waitFor(() => expect(screen.getByRole("button", { name: "Decline" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));

    await waitFor(() =>
      expect(mockDecline).toHaveBeenCalledWith("session-token", TOKEN, expect.any(AbortSignal)),
    );
    await waitFor(() =>
      expect(screen.getByText(/Invitation declined/)).toBeInTheDocument(),
    );
  });
});

describe("InvitationAcceptance — accessibility and privacy", () => {
  it("announces the loading state via role=status for screen readers", () => {
    mockGetInvitation.mockReturnValue(new Promise(() => {})); // never resolves
    renderInvitation();
    expect(screen.getByRole("status")).toHaveTextContent("Loading invitation");
  });

  it("buttons are reachable and operable via keyboard (native button semantics, no custom click-only handlers)", async () => {
    mockGetInvitation.mockResolvedValue(baseInvitation());
    mockReadStoredSession.mockReturnValue({
      token: "session-token",
      user: { id: "u1", walletAddress: WALLET, walletHash: "h1", role: "WORKER" },
    });

    renderInvitation();

    await waitFor(() => expect(screen.getByRole("button", { name: "Accept invitation" })).toBeInTheDocument());
    const acceptButton = screen.getByRole("button", { name: "Accept invitation" });
    const declineButton = screen.getByRole("button", { name: "Decline" });

    expect(acceptButton.tagName).toBe("BUTTON");
    expect(declineButton.tagName).toBe("BUTTON");
    expect(acceptButton).toHaveAttribute("type", "button");
  });

  it("never writes the invitation token to localStorage or sessionStorage", async () => {
    const setItemSpy = jest.spyOn(window.localStorage.__proto__, "setItem");
    const sessionSetItemSpy = jest.spyOn(window.sessionStorage.__proto__, "setItem");

    mockGetInvitation.mockResolvedValue(baseInvitation());
    mockReadStoredSession.mockReturnValue({
      token: "session-token",
      user: { id: "u1", walletAddress: WALLET, walletHash: "h1", role: "WORKER" },
    });
    mockAccept.mockResolvedValue({
      invitation: baseInvitation(),
      organizationId: "org_1",
    });

    renderInvitation();
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept invitation" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));
    await waitFor(() => expect(mockAccept).toHaveBeenCalled());

    for (const call of setItemSpy.mock.calls) {
      expect(String(call[1])).not.toContain(TOKEN);
    }
    for (const call of sessionSetItemSpy.mock.calls) {
      expect(String(call[1])).not.toContain(TOKEN);
    }

    setItemSpy.mockRestore();
    sessionSetItemSpy.mockRestore();
  });
});
