/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuditLogManagement } from "../audit-log-management";
import { getAuditLog, verifyAuditChain } from "@/lib/api/audit";
import { storeSession, clearStoredSession } from "@/lib/session";

const mockReplace = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/settings/audit",
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@/lib/api/audit", () => {
  const actual = jest.requireActual("@/lib/api/audit");
  return {
    ...actual,
    getAuditLog: jest.fn(),
    verifyAuditChain: jest.fn(),
  };
});

const mockedGetAuditLog = getAuditLog as jest.MockedFunction<typeof getAuditLog>;
const mockedVerifyChain = verifyAuditChain as jest.MockedFunction<typeof verifyAuditChain>;


const ADMIN_SESSION = {
  token: "test-token",
  user: { id: "user-1", walletAddress: "GADMIN...TEST", walletHash: "wh_admin", role: "ADMIN" },
};

const WORKER_SESSION = {
  token: "test-token",
  user: { id: "user-2", walletAddress: "GWORKER...TEST", walletHash: "wh_worker", role: "WORKER" },
};

const ENTRY_1 = {
  id: "entry-1",
  actor: "operator@example.com",
  action: "PROOF_CREATED",
  resource: "proof-1",
  occurredAt: "2026-08-01T00:00:00.000Z",
  organizationId: "org-1",
  entryHash: "hash-1",
  previousEntryHash: null,
};

const ENTRY_2 = { ...ENTRY_1, id: "entry-2", resource: "proof-2", entryHash: "hash-2", previousEntryHash: "hash-1" };

describe("AuditLogManagement authorization", () => {
  afterEach(() => {
    clearStoredSession();
  });

  it("prompts to connect a wallet when there is no session", () => {
    render(<AuditLogManagement />);
    expect(screen.getByText("Authentication Required")).toBeInTheDocument();
  });

  it("shows an access-restricted message for a non-admin session", () => {
    storeSession(WORKER_SESSION);
    render(<AuditLogManagement />);
    expect(screen.getByText("Access Restricted")).toBeInTheDocument();
  });
});

describe("AuditLogManagement for an admin session", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockSearchParams = new URLSearchParams();
    mockedGetAuditLog.mockReset();
    mockedVerifyChain.mockReset();
    storeSession(ADMIN_SESSION);
  });

  afterEach(() => {
    clearStoredSession();
  });

  it("loads the first page of entries and the chain status on mount", async () => {
    mockedGetAuditLog.mockResolvedValue({ entries: [ENTRY_1], nextCursor: null });
    mockedVerifyChain.mockResolvedValue({ status: "INTACT", verifiedThrough: "2026-08-01T00:00:00.000Z", firstBreak: null });

    render(<AuditLogManagement />);

    await waitFor(() => {
      expect(screen.getByText("proof-1")).toBeInTheDocument();
    });
    expect(screen.getByText("Chain intact")).toBeInTheDocument();
  });

  it("shows a load-more control only when a next cursor is returned, and appends the next page", async () => {
    mockedGetAuditLog.mockResolvedValueOnce({ entries: [ENTRY_1], nextCursor: "cursor-1" });
    mockedVerifyChain.mockResolvedValue({ status: "INTACT", verifiedThrough: null, firstBreak: null });

    const user = userEvent.setup();
    render(<AuditLogManagement />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
    });

    mockedGetAuditLog.mockResolvedValueOnce({ entries: [ENTRY_2], nextCursor: null });
    await user.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => {
      expect(screen.getByText("proof-2")).toBeInTheDocument();
    });
    // Both pages' entries are shown - loading more appends rather than replaces.
    expect(screen.getByText("proof-1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    expect(mockedGetAuditLog).toHaveBeenLastCalledWith(
      "test-token",
      expect.anything(),
      expect.anything(),
      "cursor-1",
    );
  });

  it("never renders a broken chain as success", async () => {
    mockedGetAuditLog.mockResolvedValue({ entries: [], nextCursor: null });
    mockedVerifyChain.mockResolvedValue({
      status: "BROKEN",
      verifiedThrough: null,
      firstBreak: { entryId: "entry-9", sequenceNumber: 9, detectedAt: "2026-08-05T00:00:00.000Z" },
    });

    render(<AuditLogManagement />);

    await waitFor(() => {
      expect(screen.getByText("Chain integrity broken")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Chain integrity broken");
    expect(screen.getByText(/First reported break at sequence #9/)).toBeInTheDocument();
  });

  it("updates the URL when filters change, keeping them shareable", async () => {
    mockedGetAuditLog.mockResolvedValue({ entries: [], nextCursor: null });
    mockedVerifyChain.mockResolvedValue({ status: "INTACT", verifiedThrough: null, firstBreak: null });

    const user = userEvent.setup();
    render(<AuditLogManagement />);

    await waitFor(() => {
      expect(mockedGetAuditLog).toHaveBeenCalled();
    });

    await user.type(screen.getByLabelText("Actor"), "operator@example.com");

    await waitFor(() => {
      expect(mockReplace).toHaveBeenLastCalledWith(
        expect.stringContaining("actor=operator%40example.com"),
      );
    });
  });

  it("restores filters from the URL on mount", async () => {
    mockSearchParams = new URLSearchParams("actor=operator%40example.com");
    mockedGetAuditLog.mockResolvedValue({ entries: [], nextCursor: null });
    mockedVerifyChain.mockResolvedValue({ status: "INTACT", verifiedThrough: null, firstBreak: null });

    render(<AuditLogManagement />);

    await waitFor(() => {
      expect(mockedGetAuditLog).toHaveBeenCalledWith(
        "test-token",
        expect.objectContaining({ actor: "operator@example.com" }),
        expect.anything(),
        undefined,
      );
    });
    expect(screen.getByLabelText("Actor")).toHaveValue("operator@example.com");
  });
});
