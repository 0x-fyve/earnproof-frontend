import { render, screen, waitFor } from "@testing-library/react";
import { SessionManagement } from "../session-management";
import { storeSession } from "@/lib/session";


function setSession(userId = "user-1", role = "MEMBER") {
  storeSession({ token: "tok", user: { id: userId, role } });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("SessionManagement (#158)", () => {
  it("shows an authentication prompt when there is no session", () => {
    render(<SessionManagement />);

    expect(screen.getByText("Authentication Required")).toBeInTheDocument();
  });

  it("renders the session list for any authenticated role (not role-gated)", async () => {
    setSession("user-1", "MEMBER");

    render(<SessionManagement />);

    await waitFor(() => {
      expect(screen.getByText("This device")).toBeInTheDocument();
    });
  });

  it("shows the current session and at least one other device", async () => {
    setSession();

    render(<SessionManagement />);

    await waitFor(() => {
      expect(screen.getByText("This device")).toBeInTheDocument();
    });
    expect(screen.getAllByRole("button", { name: "Sign out" }).length).toBeGreaterThan(0);
  });
});
