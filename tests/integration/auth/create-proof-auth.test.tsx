/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateProofFlow } from "@/components/proofs/create-proof-flow";
import { apiClient } from "@/lib/api/client";
import { getAddress, requestAccess, signMessage } from "@stellar/freighter-api";

jest.mock("@/lib/api/client", () => ({
  apiClient: jest.fn(),
  bearer: (token: string) => ({ Authorization: `Bearer ${token}` }),
}));

jest.mock("@stellar/freighter-api", () => ({
  getAddress: jest.fn(),
  requestAccess: jest.fn(),
  signMessage: jest.fn(),
}));

const mockedApiClient = apiClient as jest.Mock;
const mockedGetAddress = getAddress as jest.MockedFunction<typeof getAddress>;
const mockedRequestAccess = requestAccess as jest.MockedFunction<typeof requestAccess>;
const mockedSignMessage = signMessage as jest.MockedFunction<typeof signMessage>;

const SESSION_KEY = "earnproof.session";
const WALLET_ADDRESS = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV";
const SESSION_TOKEN = "integration-session-token.do-not-log";
const SESSION = {
  token: SESSION_TOKEN,
  user: {
    id: "user_auth_1",
    walletAddress: WALLET_ADDRESS,
    walletHash: "wallet_hash_1",
    role: "worker",
  },
};

function installSuccessfulAuthApi() {
  mockedApiClient.mockImplementation(
    ({ path, method, body }: { path: string; method?: string; body?: string }) => {
      if (path === "/auth/challenge" && method === "POST") {
        expect(JSON.parse(body ?? "{}")).toEqual({ walletAddress: WALLET_ADDRESS });
        return Promise.resolve({
          id: "challenge_1",
          message: "Sign in to EarnProof",
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        });
      }

      if (path === "/auth/verify" && method === "POST") {
        expect(JSON.parse(body ?? "{}")).toEqual({
          challengeId: "challenge_1",
          walletAddress: WALLET_ADDRESS,
          signature: "signed-challenge",
        });
        return Promise.resolve({
          user: SESSION.user,
          session: { token: SESSION_TOKEN, tokenType: "Bearer" },
        });
      }

      return Promise.reject(new Error(`Unexpected request: ${method ?? "GET"} ${path}`));
    },
  );
}

beforeEach(() => {
  window.localStorage.clear();
  jest.clearAllMocks();
  mockedRequestAccess.mockResolvedValue({ address: WALLET_ADDRESS });
  mockedGetAddress.mockResolvedValue({ address: WALLET_ADDRESS });
  mockedSignMessage.mockResolvedValue({
    signedMessage: "signed-challenge",
    signerAddress: WALLET_ADDRESS,
  });
});

describe("CreateProofFlow wallet authentication", () => {
  it("requests Freighter access, shows a consent screen, then signs and verifies after Continue", async () => {
    installSuccessfulAuthApi();
    const user = userEvent.setup();
    render(<CreateProofFlow />);

    await user.click(screen.getByRole("button", { name: "Connect Freighter" }));

    const dialog = await screen.findByRole("dialog");
    expect(mockedSignMessage).not.toHaveBeenCalled();
    expect(dialog).toHaveTextContent("Sign in to EarnProof");

    await user.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByText(/Connected as/);
    expect(mockedRequestAccess).toHaveBeenCalledTimes(1);
    expect(mockedGetAddress).not.toHaveBeenCalled();
    expect(mockedSignMessage).toHaveBeenCalledWith(
      "Sign in to EarnProof",
      expect.objectContaining({ address: WALLET_ADDRESS }),
    );
    expect(mockedApiClient).toHaveBeenCalledTimes(2);
    expect(JSON.parse(window.localStorage.getItem(SESSION_KEY) ?? "null")).toEqual(SESSION);
  });

  it("does not sign or verify when the consent screen is cancelled", async () => {
    installSuccessfulAuthApi();
    const user = userEvent.setup();
    render(<CreateProofFlow />);

    await user.click(screen.getByRole("button", { name: "Connect Freighter" }));
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockedSignMessage).not.toHaveBeenCalled();
    expect(mockedApiClient).toHaveBeenCalledTimes(1); // only /auth/challenge
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("falls back to getAddress when requestAccess returns no address", async () => {
    mockedRequestAccess.mockResolvedValue({ address: "" });
    installSuccessfulAuthApi();
    const user = userEvent.setup();
    render(<CreateProofFlow />);

    await user.click(screen.getByRole("button", { name: "Connect Freighter" }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByText(/Connected as/);
    expect(mockedGetAddress).toHaveBeenCalledTimes(1);
  });

  it("surfaces a stable error and stores no session when Freighter rejects access", async () => {
    mockedRequestAccess.mockRejectedValue(new Error("denied"));
    mockedGetAddress.mockRejectedValue(new Error("not installed"));
    const user = userEvent.setup();
    render(<CreateProofFlow />);

    await user.click(screen.getByRole("button", { name: "Connect Freighter" }));

    expect(
      await screen.findByText("Freighter was not found or did not return a Stellar address."),
    ).toHaveAttribute("role", "alert");
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(mockedApiClient).not.toHaveBeenCalled();
  });
});

describe("CreateProofFlow wallet consent", () => {
  it("rejects signing a challenge that expired while the consent screen was open", async () => {
    mockedApiClient.mockImplementation(
      ({ path, method }: { path: string; method?: string }) => {
        if (path === "/auth/challenge" && method === "POST") {
          return Promise.resolve({
            id: "challenge_expired",
            message: "Sign in to EarnProof",
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          });
        }
        return Promise.reject(new Error(`Unexpected request: ${method ?? "GET"} ${path}`));
      },
    );
    const user = userEvent.setup();
    render(<CreateProofFlow />);

    await user.click(screen.getByRole("button", { name: "Connect Freighter" }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText(/expired/i),
    ).toBeInTheDocument();
    expect(mockedSignMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("CreateProofFlow session lifecycle", () => {
  it("restores the persisted session after a page refresh without reconnecting", () => {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(SESSION));

    const firstRender = render(<CreateProofFlow />);
    expect(screen.getByText(WALLET_ADDRESS)).toBeInTheDocument();
    firstRender.unmount();

    render(<CreateProofFlow />);
    expect(screen.getByText(WALLET_ADDRESS)).toBeInTheDocument();
    expect(mockedRequestAccess).not.toHaveBeenCalled();
    expect(mockedApiClient).not.toHaveBeenCalled();
  });

  it("invalidates local storage on logout and restores focus to Connect Freighter", async () => {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(SESSION));
    const user = userEvent.setup();
    render(<CreateProofFlow />);

    const disconnect = screen.getByRole("button", { name: "Disconnect" });
    disconnect.focus();
    await user.click(disconnect);

    const connect = screen.getByRole("button", { name: "Connect Freighter" });
    await waitFor(() => expect(connect).toHaveFocus());
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(screen.queryByText(WALLET_ADDRESS)).not.toBeInTheDocument();
  });

  it("removes an invalid serialized session instead of exposing partial auth state", () => {
    window.localStorage.setItem(SESSION_KEY, "{invalid-json");

    render(<CreateProofFlow />);

    expect(screen.getByRole("button", { name: "Connect Freighter" })).toBeInTheDocument();
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("does not expose the session token through console output or global state", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    installSuccessfulAuthApi();
    const user = userEvent.setup();
    render(<CreateProofFlow />);

    await user.click(screen.getByRole("button", { name: "Connect Freighter" }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText(/Connected as/);

    for (const spy of [log, info, warn, error]) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(SESSION_TOKEN);
    }
    expect((globalThis as Record<string, unknown>)[SESSION_KEY]).toBeUndefined();
    expect((globalThis as Record<string, unknown>).earnproofSession).toBeUndefined();
  });
});
