/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrganizationMembers } from "../organization-members";
import { apiClient } from "@/lib/api/client";
import { storeSession, clearStoredSession } from "@/lib/session";

jest.mock("@/lib/api/client", () => ({
  apiClient: jest.fn(),
  bearer: (token: string) => ({ Authorization: `Bearer ${token}` }),
  retryRead: (fn: (signal: AbortSignal) => Promise<unknown>, signal: AbortSignal) => fn(signal),
  retryMutation: (fn: (signal: AbortSignal) => Promise<unknown>, signal: AbortSignal) => fn(signal),
}));

const mockedApiClient = apiClient as jest.MockedFunction<typeof apiClient>;

const VIEWER_WALLET = "GVIEWER000000000000000000000000000000000000000000000AA";
const OTHER_WALLET = "GOTHER0000000000000000000000000000000000000000000000BB";

const OWNER_MEMBER = {
  id: "member-owner",
  userId: "user-owner",
  organizationId: "org-1",
  walletAddress: VIEWER_WALLET,
  role: "OWNER" as const,
  status: "ACTIVE" as const,
};

const REGULAR_MEMBER = {
  id: "member-regular",
  userId: "user-regular",
  organizationId: "org-1",
  walletAddress: OTHER_WALLET,
  role: "MEMBER" as const,
  status: "ACTIVE" as const,
};

function setSession(walletAddress = VIEWER_WALLET) {
  storeSession({
      token: "test-token",
      user: { id: "user-owner", walletAddress, role: "ADMIN" },
    });
}

describe("OrganizationMembers", () => {
  beforeEach(() => {
    mockedApiClient.mockReset();
    setSession();
  });

  afterEach(() => {
    clearStoredSession();
  });

  it("renders the member list on successful load", async () => {
    mockedApiClient.mockResolvedValueOnce([OWNER_MEMBER, REGULAR_MEMBER]);

    render(
      <OrganizationMembers organizationId="org-1" organizationName="Acme" token="test-token" />
    );

    await waitFor(() => {
      expect(screen.getByText(VIEWER_WALLET)).toBeInTheDocument();
    });
    expect(screen.getByText(OTHER_WALLET)).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
  });

  it("shows an explicit unavailable state on fetch failure, not an empty list", async () => {
    mockedApiClient.mockRejectedValueOnce(new Error("network error"));

    render(
      <OrganizationMembers organizationId="org-1" organizationName="Acme" token="test-token" />
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/unavailable/i);
    });
    expect(screen.queryByText(/no members yet/i)).not.toBeInTheDocument();
  });

  it("shows an empty state (distinct from the error state) when the load succeeds with zero members", async () => {
    mockedApiClient.mockResolvedValueOnce([]);

    render(
      <OrganizationMembers organizationId="org-1" organizationName="Acme" token="test-token" />
    );

    await waitFor(() => {
      expect(screen.getByText(/no members yet/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("blocks removing the last owner and explains why", async () => {
    mockedApiClient.mockResolvedValueOnce([OWNER_MEMBER]);

    render(
      <OrganizationMembers organizationId="org-1" organizationName="Acme" token="test-token" />
    );

    await waitFor(() => expect(screen.getByText(VIEWER_WALLET)).toBeInTheDocument());

    const removeButton = screen.getByRole("button", {
      name: new RegExp(`Remove ${VIEWER_WALLET}`),
    });
    expect(removeButton).toBeDisabled();
    expect(removeButton).toHaveAttribute("title", expect.stringMatching(/last owner/i));
  });

  it("allows an owner to remove a regular member after confirmation", async () => {
    const user = userEvent.setup();
    mockedApiClient
      .mockResolvedValueOnce([OWNER_MEMBER, REGULAR_MEMBER]) // initial load
      .mockResolvedValueOnce(undefined); // DELETE

    render(
      <OrganizationMembers organizationId="org-1" organizationName="Acme" token="test-token" />
    );

    await waitFor(() => expect(screen.getByText(OTHER_WALLET)).toBeInTheDocument());

    const removeButton = screen.getByRole("button", {
      name: new RegExp(`Remove ${OTHER_WALLET}`),
    });
    expect(removeButton).not.toBeDisabled();
    await user.click(removeButton);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(new RegExp(OTHER_WALLET))).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Remove Member" }));

    await waitFor(() => {
      expect(screen.queryByText(OTHER_WALLET)).not.toBeInTheDocument();
    });

    const deleteCall = mockedApiClient.mock.calls.find(([opts]) => opts.method === "DELETE");
    expect(deleteCall?.[0].path).toBe("/organizations/org-1/members/member-regular");
  });

  it("disables role and remove controls for a non-admin viewer", async () => {
    setSession(OTHER_WALLET);
    mockedApiClient.mockResolvedValueOnce([OWNER_MEMBER, REGULAR_MEMBER]);

    render(
      <OrganizationMembers organizationId="org-1" organizationName="Acme" token="test-token" />
    );

    await waitFor(() => expect(screen.getByText(OTHER_WALLET)).toBeInTheDocument());

    const roleSelects = screen.getAllByRole("combobox", { name: /role for/i });
    roleSelects.forEach((select) => expect(select).toBeDisabled());
  });

  it("surfaces a validation error for an invalid wallet address on invite without calling the API", async () => {
    const user = userEvent.setup();
    mockedApiClient.mockResolvedValueOnce([OWNER_MEMBER]);

    render(
      <OrganizationMembers organizationId="org-1" organizationName="Acme" token="test-token" />
    );

    await waitFor(() => expect(screen.getByText(VIEWER_WALLET)).toBeInTheDocument());

    await user.type(screen.getByLabelText("Wallet address"), "not-a-wallet");
    await user.click(screen.getByRole("button", { name: "Invite" }));

    expect(
      await screen.findByText(/valid stellar public key/i)
    ).toBeInTheDocument();

    const postCalls = mockedApiClient.mock.calls.filter(([opts]) => opts.method === "POST");
    expect(postCalls).toHaveLength(0);
  });
});
