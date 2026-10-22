import { render, screen, waitFor } from "@testing-library/react";
import { TrustedSourceManagement } from "../trusted-source-management";
import { getIssuers } from "@/lib/api/issuers";
import { storeSession } from "@/lib/session";

jest.mock("@/lib/api/issuers", () => ({
  getIssuers: jest.fn(),
}));
const mockGetIssuers = getIssuers as jest.MockedFunction<typeof getIssuers>;


function setSession(role: string, userId = "user-1") {
  storeSession({ token: "tok", user: { id: userId, role } });
}

beforeEach(() => {
  window.localStorage.clear();
  mockGetIssuers.mockReset();
  mockGetIssuers.mockResolvedValue([
    { id: "iss-1", name: "Acme Issuer", status: "ACTIVE" },
  ]);
});

describe("TrustedSourceManagement authorization gate (#135)", () => {
  it("shows an authentication prompt when there is no session", () => {
    render(<TrustedSourceManagement />);

    expect(screen.getByText("Authentication Required")).toBeInTheDocument();
    expect(screen.queryByText("Add Trusted Source")).not.toBeInTheDocument();
  });

  it("shows an access-restricted message for a non-admin, non-issuer role", () => {
    setSession("VIEWER");

    render(<TrustedSourceManagement />);

    expect(screen.getByText("Access Restricted")).toBeInTheDocument();
    expect(screen.queryByText("Add Trusted Source")).not.toBeInTheDocument();
  });

  it("does not invoke the issuer-loading API call for an unauthorized session", async () => {
    setSession("VIEWER");

    render(<TrustedSourceManagement />);

    // Give any stray effect a tick to fire, then assert it never did.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockGetIssuers).not.toHaveBeenCalled();
  });

  it("renders the management UI for an ADMIN session", async () => {
    setSession("ADMIN");

    render(<TrustedSourceManagement />);

    await waitFor(() => {
      expect(screen.getByText("Add Trusted Source")).toBeInTheDocument();
    });
  });

  it("renders the management UI for an ISSUER session", async () => {
    setSession("ISSUER");

    render(<TrustedSourceManagement />);

    await waitFor(() => {
      expect(screen.getByText("Add Trusted Source")).toBeInTheDocument();
    });
  });

  it("shows an empty state when the authorized user has no trusted sources yet", async () => {
    setSession("ADMIN");

    render(<TrustedSourceManagement />);

    await waitFor(() => {
      expect(
        screen.getByText("No trusted sources yet. Add your first one above."),
      ).toBeInTheDocument();
    });
  });

  it("shows an error state when loading issuers fails", async () => {
    setSession("ADMIN");
    mockGetIssuers.mockRejectedValue(new Error("network down"));

    render(<TrustedSourceManagement />);

    await waitFor(() => {
      expect(screen.getByText("Failed to load issuers. Please try again.")).toBeInTheDocument();
    });
  });
});
