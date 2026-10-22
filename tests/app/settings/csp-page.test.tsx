import { render, screen } from "@testing-library/react";
import CspViolationsPage from "@/app/settings/security/csp/page";
import { clearStoredSession } from "@/lib/session";

describe("/settings/security/csp", () => {
  it("renders the heading, a way back, and the gated view (sign-in state when signed out)", () => {
    clearStoredSession();
    render(<CspViolationsPage />);

    expect(screen.getByRole("heading", { name: "CSP violation diagnostics" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to security posture" })).toHaveAttribute("href", "/settings/security");
    expect(screen.getByText("Sign in to view CSP diagnostics")).toBeInTheDocument();
  });
});
