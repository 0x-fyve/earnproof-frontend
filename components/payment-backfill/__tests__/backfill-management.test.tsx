import { render, screen, waitFor } from "@testing-library/react";
import { BackfillManagement } from "../backfill-management";
import { storeSession } from "@/lib/session";


function setSession(role: string, userId = "user-1") {
  storeSession({ token: "tok", user: { id: userId, role } });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("BackfillManagement authorization gate (#171)", () => {
  it("shows an authentication prompt when there is no session", () => {
    render(<BackfillManagement />);

    expect(screen.getByText("Authentication Required")).toBeInTheDocument();
  });

  it("shows an access-restricted message for a non-ADMIN role", () => {
    setSession("ISSUER");

    render(<BackfillManagement />);

    expect(screen.getByText("Access Restricted")).toBeInTheDocument();
    expect(screen.queryByText("Request Payment Backfill")).not.toBeInTheDocument();
  });

  it("renders the management UI for an ADMIN session", async () => {
    setSession("ADMIN");

    render(<BackfillManagement />);

    await waitFor(() => {
      expect(screen.getByText("Request Payment Backfill")).toBeInTheDocument();
    });
  });

  it("shows an empty state when there are no jobs yet", async () => {
    setSession("ADMIN");

    render(<BackfillManagement />);

    await waitFor(() => {
      expect(screen.getByText("No backfill jobs yet. Request one above.")).toBeInTheDocument();
    });
  });
});
