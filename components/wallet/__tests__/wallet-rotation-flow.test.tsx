import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WalletRotationFlow } from "../wallet-rotation-flow";
import { connectFreighterWallet, signFreighterMessage } from "@/lib/wallet/freighter-sign";
import { createAuthChallenge, verifyAuthChallenge } from "@/lib/api/auth";
import { completeWalletRotation } from "@/lib/wallet-rotation/store";
import { readStoredSession, storeSession } from "@/lib/session";

jest.mock("@/lib/wallet/freighter-sign", () => ({
  connectFreighterWallet: jest.fn(),
  signFreighterMessage: jest.fn(),
}));
jest.mock("@/lib/api/auth", () => ({
  createAuthChallenge: jest.fn(),
  verifyAuthChallenge: jest.fn(),
}));

const mockConnect = connectFreighterWallet as jest.MockedFunction<typeof connectFreighterWallet>;
const mockSign = signFreighterMessage as jest.MockedFunction<typeof signFreighterMessage>;
const mockCreateChallenge = createAuthChallenge as jest.MockedFunction<typeof createAuthChallenge>;
const mockVerifyChallenge = verifyAuthChallenge as jest.MockedFunction<typeof verifyAuthChallenge>;

const CURRENT_WALLET = "GCURRENTWALLET0000000000000000000000000000000000000001";
const REPLACEMENT_WALLET = "GREPLACEMENTWALLET000000000000000000000000000000000002";

function futureChallenge(id: string, minutesFromNow = 5) {
  return {
    id,
    message: `challenge-${id}`,
    expiresAt: new Date(Date.now() + minutesFromNow * 60_000).toISOString(),
  };
}

beforeEach(() => {
  window.localStorage.clear();
  mockConnect.mockReset();
  mockSign.mockReset();
  mockCreateChallenge.mockReset();
  mockVerifyChallenge.mockReset();
  mockVerifyChallenge.mockResolvedValue({
    user: { id: "u1", walletAddress: "x", role: "MEMBER" },
    session: { token: "t", tokenType: "Bearer" },
  });
});

describe("WalletRotationFlow", () => {
  it("verifies the current wallet via a real challenge/sign/verify round trip", async () => {
    mockConnect.mockResolvedValue(CURRENT_WALLET);
    mockCreateChallenge.mockResolvedValue(futureChallenge("c1"));
    mockSign.mockResolvedValue("sig1");

    render(
      <WalletRotationFlow currentWalletAddress={CURRENT_WALLET} onRotationCompleted={jest.fn()} />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Verify" })[0]!);

    await waitFor(() => {
      expect(mockVerifyChallenge).toHaveBeenCalledWith(
        { challengeId: "c1", walletAddress: CURRENT_WALLET, signature: "sig1" },
        expect.anything(),
      );
    });
    expect(screen.getAllByText("Verified")).toHaveLength(1);
  });

  it("rejects verification when the connected wallet does not match the current account wallet (wrong-wallet case)", async () => {
    mockConnect.mockResolvedValue("GDIFFERENTWALLET00000000000000000000000000000000000003");

    render(
      <WalletRotationFlow currentWalletAddress={CURRENT_WALLET} onRotationCompleted={jest.fn()} />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Verify" })[0]!);

    await waitFor(() => {
      expect(screen.getByText(/does not match the current account wallet/)).toBeInTheDocument();
    });
    expect(mockCreateChallenge).not.toHaveBeenCalled();
  });

  it("shows a cancellation-friendly error when the wallet declines to sign", async () => {
    mockConnect.mockResolvedValue(CURRENT_WALLET);
    mockCreateChallenge.mockResolvedValue(futureChallenge("c1"));
    mockSign.mockResolvedValue(null);

    render(
      <WalletRotationFlow currentWalletAddress={CURRENT_WALLET} onRotationCompleted={jest.fn()} />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Verify" })[0]!);

    await waitFor(() => {
      expect(screen.getByText(/did not return a signature/i)).toBeInTheDocument();
    });
  });

  it("only enables replacement verification after the current wallet is verified", () => {
    render(
      <WalletRotationFlow currentWalletAddress={CURRENT_WALLET} onRotationCompleted={jest.fn()} />,
    );

    const buttons = screen.getAllByRole("button", { name: "Verify" });
    expect(buttons[1]).toBeDisabled();
  });

  it("rejects a replacement wallet identical to the current wallet (negative case)", async () => {
    mockConnect.mockResolvedValueOnce(CURRENT_WALLET); // step 1
    mockCreateChallenge.mockResolvedValue(futureChallenge("c1"));
    mockSign.mockResolvedValue("sig1");

    render(
      <WalletRotationFlow currentWalletAddress={CURRENT_WALLET} onRotationCompleted={jest.fn()} />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Verify" })[0]!);
    await waitFor(() => expect(screen.getAllByText("Verified")).toHaveLength(1));

    mockConnect.mockResolvedValueOnce(CURRENT_WALLET); // step 2: same wallet again
    mockCreateChallenge.mockResolvedValue(futureChallenge("c2"));
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => {
      expect(screen.getByText(/must be different from the current wallet/i)).toBeInTheDocument();
    });
  });

  it("rejects a replacement wallet that is already assigned to another account (conflict case)", async () => {
    completeWalletRotation("GOLDACCOUNTWALLET0000000000000000000000000000000000004", REPLACEMENT_WALLET);

    mockConnect.mockResolvedValueOnce(CURRENT_WALLET);
    mockCreateChallenge.mockResolvedValue(futureChallenge("c1"));
    mockSign.mockResolvedValue("sig1");

    render(
      <WalletRotationFlow currentWalletAddress={CURRENT_WALLET} onRotationCompleted={jest.fn()} />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Verify" })[0]!);
    await waitFor(() => expect(screen.getAllByText("Verified")).toHaveLength(1));

    mockConnect.mockResolvedValueOnce(REPLACEMENT_WALLET);
    mockCreateChallenge.mockResolvedValue(futureChallenge("c2"));
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => {
      expect(screen.getByText(/already assigned to another account/i)).toBeInTheDocument();
    });
  });

  it("completes a full rotation end to end and clears the session", async () => {
    storeSession({
      token: "old",
      user: { id: "u1", walletAddress: CURRENT_WALLET, walletHash: "h1", role: "WORKER" },
    });
    expect(readStoredSession()).not.toBeNull();

    mockConnect.mockResolvedValueOnce(CURRENT_WALLET);
    mockCreateChallenge.mockResolvedValueOnce(futureChallenge("c1"));
    mockSign.mockResolvedValueOnce("sig1");

    const onCompleted = jest.fn();
    render(
      <WalletRotationFlow currentWalletAddress={CURRENT_WALLET} onRotationCompleted={onCompleted} />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Verify" })[0]!);
    await waitFor(() => expect(screen.getAllByText("Verified")).toHaveLength(1));

    mockConnect.mockResolvedValueOnce(REPLACEMENT_WALLET);
    mockCreateChallenge.mockResolvedValueOnce(futureChallenge("c2"));
    mockSign.mockResolvedValueOnce("sig2");
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(screen.getAllByText("Verified")).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "Confirm rotation" }));

    await waitFor(() => {
      expect(onCompleted).toHaveBeenCalledWith(REPLACEMENT_WALLET);
    });
    expect(readStoredSession()).toBeNull();
    expect(screen.getByText("Wallet Rotated")).toBeInTheDocument();
  });

  it("blocks completion when a challenge has expired between verification and confirmation (replay/expiry case)", async () => {
    mockConnect.mockResolvedValueOnce(CURRENT_WALLET);
    // Already-expired challenge.
    mockCreateChallenge.mockResolvedValueOnce({
      id: "c1",
      message: "m1",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    mockSign.mockResolvedValueOnce("sig1");

    render(
      <WalletRotationFlow currentWalletAddress={CURRENT_WALLET} onRotationCompleted={jest.fn()} />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Verify" })[0]!);
    await waitFor(() => expect(screen.getAllByText("Verified")).toHaveLength(1));

    mockConnect.mockResolvedValueOnce(REPLACEMENT_WALLET);
    mockCreateChallenge.mockResolvedValueOnce(futureChallenge("c2"));
    mockSign.mockResolvedValueOnce("sig2");
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(screen.getAllByText("Verified")).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "Confirm rotation" }));

    await waitFor(() => {
      expect(screen.getByText(/challenges has expired/i)).toBeInTheDocument();
    });
  });

  it("cancel resets the flow back to the start", async () => {
    mockConnect.mockResolvedValue(CURRENT_WALLET);
    mockCreateChallenge.mockResolvedValue(futureChallenge("c1"));
    mockSign.mockResolvedValue("sig1");

    render(
      <WalletRotationFlow currentWalletAddress={CURRENT_WALLET} onRotationCompleted={jest.fn()} />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Verify" })[0]!);
    await waitFor(() => expect(screen.getAllByText("Verified")).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  });
});
