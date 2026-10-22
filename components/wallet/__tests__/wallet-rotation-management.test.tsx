import { render, screen } from "@testing-library/react";
import { WalletRotationManagement } from "../wallet-rotation-management";
import { storeSession } from "@/lib/session";


beforeEach(() => {
  window.localStorage.clear();
});

describe("WalletRotationManagement", () => {
  it("shows an authentication prompt when there is no session", () => {
    render(<WalletRotationManagement />);

    expect(screen.getByText("Authentication Required")).toBeInTheDocument();
  });

  it("renders the rotation flow for an authenticated session", () => {
    storeSession({
        token: "tok",
        user: { id: "u1", walletAddress: "GWALLET1234567890", role: "MEMBER" },
      });

    render(<WalletRotationManagement />);

    expect(screen.getByText("Rotate Wallet Address")).toBeInTheDocument();
    expect(screen.getByText(/GWALLE/)).toBeInTheDocument();
  });
});
