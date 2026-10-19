import { render, screen, waitFor } from "@testing-library/react";
import { SupportedAssetManagement } from "../supported-asset-management";
import { storeSession } from "@/lib/session";


function setSession(role: string, userId = "user-1") {
  storeSession({ token: "tok", user: { id: userId, role } });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("SupportedAssetManagement authorization gate (#156)", () => {
  it("shows an authentication prompt when there is no session", () => {
    render(<SupportedAssetManagement />);

    expect(screen.getByText("Authentication Required")).toBeInTheDocument();
    expect(screen.queryByText("Add Supported Asset")).not.toBeInTheDocument();
  });

  it("shows an access-restricted message for a non-admin, non-issuer role", () => {
    setSession("VIEWER");

    render(<SupportedAssetManagement />);

    expect(screen.getByText("Access Restricted")).toBeInTheDocument();
    expect(screen.queryByText("Add Supported Asset")).not.toBeInTheDocument();
  });

  it("renders the management UI for an ADMIN session", async () => {
    setSession("ADMIN");

    render(<SupportedAssetManagement />);

    await waitFor(() => {
      expect(screen.getByText("Add Supported Asset")).toBeInTheDocument();
    });
  });

  it("shows an empty state when there are no supported assets yet", async () => {
    setSession("ADMIN");

    render(<SupportedAssetManagement />);

    await waitFor(() => {
      expect(
        screen.getByText("No supported assets yet. Add your first one above."),
      ).toBeInTheDocument();
    });
  });
});
