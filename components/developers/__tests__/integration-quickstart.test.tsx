/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { IntegrationQuickstart } from "../integration-quickstart";
import { readStoredSession } from "@/lib/session";
import { readStoredOrganizationId } from "@/lib/organization-context/store";
import { verifyProof } from "@/lib/api/verify-proof";
import { loadQuickstartProgress, saveQuickstartProgress } from "@/lib/storage/quickstart-progress";

jest.mock("@/lib/session", () => ({
  readStoredSession: jest.fn(),
}));
jest.mock("@/lib/organization-context/store", () => ({
  readStoredOrganizationId: jest.fn(),
}));
jest.mock("@/lib/api/verify-proof", () => ({
  verifyProof: jest.fn(),
}));
jest.mock("@/lib/storage/quickstart-progress", () => ({
  loadQuickstartProgress: jest.fn(),
  saveQuickstartProgress: jest.fn(),
  clearQuickstartProgress: jest.fn(),
}));

const mockReadStoredSession = readStoredSession as jest.MockedFunction<typeof readStoredSession>;
const mockReadStoredOrganizationId = readStoredOrganizationId as jest.MockedFunction<typeof readStoredOrganizationId>;
const mockVerifyProof = verifyProof as jest.MockedFunction<typeof verifyProof>;
const mockLoadProgress = loadQuickstartProgress as jest.MockedFunction<typeof loadQuickstartProgress>;
const mockSaveProgress = saveQuickstartProgress as jest.MockedFunction<typeof saveQuickstartProgress>;

const mockSession = {
  token: "test-token",
  user: { id: "u1", walletAddress: "GABC", walletHash: "hash", role: "DEVELOPER" as const },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockReadStoredSession.mockReturnValue(mockSession);
  mockReadStoredOrganizationId.mockReturnValue("org-123");
  mockLoadProgress.mockReturnValue({ completedSteps: [], updatedAt: new Date(0).toISOString() });
});

describe("IntegrationQuickstart", () => {
  it("shows an authentication-required message when there is no session (authorization case)", () => {
    mockReadStoredSession.mockReturnValue(null);
    render(<IntegrationQuickstart />);
    expect(screen.getByText("Authentication required")).toBeInTheDocument();
  });

  it("renders the checklist and marks select-scopes complete once mounted", async () => {
    render(<IntegrationQuickstart />);
    await waitFor(() => {
      expect(mockSaveProgress).toHaveBeenCalled();
    });
    const [savedState] = mockSaveProgress.mock.calls[0];
    expect(savedState.completedSteps).toContain("select-scopes");
  });

  it("never passes a secret-shaped value into saveQuickstartProgress", async () => {
    render(<IntegrationQuickstart />);
    await waitFor(() => expect(mockSaveProgress).toHaveBeenCalled());
    for (const [state] of mockSaveProgress.mock.calls) {
      expect(JSON.stringify(state)).not.toMatch(/ep_test_|secret|Bearer/i);
    }
  });

  it("generates a code example containing the organization id as a header", () => {
    render(<IntegrationQuickstart />);
    expect(screen.getAllByText(/org-123/).length).toBeGreaterThan(0);
  });

  it("switches the generated example between runtimes", () => {
    render(<IntegrationQuickstart />);
    fireEvent.click(screen.getByRole("tab", { name: "Node.js" }));
    expect(screen.getByRole("tab", { name: "Node.js" })).toHaveAttribute("aria-selected", "true");
  });

  it("classifies a missing-scope (403) synthetic test failure and surfaces it accessibly", async () => {
    mockVerifyProof.mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    render(<IntegrationQuickstart />);

    fireEvent.click(screen.getByRole("button", { name: "Send synthetic test request" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/missing a required scope/i);
    });
  });

  it("classifies an expired-key (401) synthetic test failure", async () => {
    mockVerifyProof.mockRejectedValue(Object.assign(new Error("Unauthorized"), { status: 401 }));
    render(<IntegrationQuickstart />);

    fireEvent.click(screen.getByRole("button", { name: "Send synthetic test request" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/expired or is invalid/i);
    });
  });

  it("classifies a version-mismatch (409) synthetic test failure", async () => {
    mockVerifyProof.mockRejectedValue(Object.assign(new Error("Conflict"), { status: 409 }));
    render(<IntegrationQuickstart />);

    fireEvent.click(screen.getByRole("button", { name: "Send synthetic test request" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/contract version/i);
    });
  });

  it("reports success on a successful synthetic request", async () => {
    mockVerifyProof.mockResolvedValue({
      status: "valid",
      proofId: "SYNTHETIC-TEST-PROOF",
    } as never);
    render(<IntegrationQuickstart />);

    fireEvent.click(screen.getByRole("button", { name: "Send synthetic test request" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/succeeded/i);
    });
  });

  it("does not mark test-request complete when earlier steps (create-key, save-secret) were never reached (authorization-shaped ordering guard)", async () => {
    mockVerifyProof.mockResolvedValue({
      status: "valid",
      proofId: "SYNTHETIC-TEST-PROOF",
    } as never);
    render(<IntegrationQuickstart />);

    fireEvent.click(screen.getByRole("button", { name: "Send synthetic test request" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/succeeded/i);
    });

    const completedTestRequest = mockSaveProgress.mock.calls.some(([state]) =>
      state.completedSteps.includes("test-request"),
    );
    expect(completedTestRequest).toBe(false);
  });
});
