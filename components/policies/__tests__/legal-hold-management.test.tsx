/**
 * Tests for legal hold management component
 * 
 * Coverage:
 * - Authorization gating (ADMIN vs non-admin users)
 * - Legal hold creation with validation
 * - Legal hold release with approval
 * - Loading and error states
 * - Pagination
 * - Status filtering
 */

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LegalHoldManagement } from "../legal-hold-management";
import * as retentionApi from "@/lib/api/retention";
import {
  MOCK_ADMIN_SESSION,
  MOCK_ISSUER_SESSION,
  MOCK_DEVELOPER_SESSION,
  createMockLegalHold,
  createMockReleasedLegalHold,
} from "@/lib/api/__tests__/retention.fixtures";

// Mock the session reading
jest.mock("@/lib/session", () => ({
  readStoredSession: jest.fn(),
}));

// Mock the retention API
jest.mock("@/lib/api/retention", () => ({
  ...jest.requireActual("@/lib/api/retention"),
  getLegalHolds: jest.fn(),
  createLegalHoldSafe: jest.fn(),
  releaseLegalHoldSafe: jest.fn(),
}));

import { readStoredSession } from "@/lib/session";

describe("LegalHoldManagement Component", () => {
  const mockGetLegalHolds = retentionApi.getLegalHolds as jest.MockedFunction<
    typeof retentionApi.getLegalHolds
  >;
  const mockCreateLegalHold = retentionApi.createLegalHoldSafe as jest.MockedFunction<
    typeof retentionApi.createLegalHoldSafe
  >;
  const mockReleaseLegalHold = retentionApi.releaseLegalHoldSafe as jest.MockedFunction<
    typeof retentionApi.releaseLegalHoldSafe
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    (readStoredSession as jest.Mock).mockReturnValue(MOCK_ADMIN_SESSION);
    mockGetLegalHolds.mockResolvedValue({
      holds: [],
      nextCursor: null,
    });
  });

  describe("Authentication and Authorization", () => {
    it("should show authentication prompt when not logged in", async () => {
      (readStoredSession as jest.Mock).mockReturnValue(null);

      render(<LegalHoldManagement />);

      await waitFor(() => {
        expect(screen.getByText("Authentication Required")).toBeInTheDocument();
      });
      expect(screen.getByRole("link", { name: /Connect Wallet/i })).toHaveAttribute("href", "/proofs");
    });

    it("should show access restricted message for non-admin users", async () => {
      (readStoredSession as jest.Mock).mockReturnValue(MOCK_DEVELOPER_SESSION);

      render(<LegalHoldManagement />);

      await waitFor(() => {
        expect(screen.getByText("Access Restricted")).toBeInTheDocument();
      });
      expect(screen.getByText(/requires administrative access/i)).toBeInTheDocument();
    });

    it("should allow ADMIN role to access", async () => {
      (readStoredSession as jest.Mock).mockReturnValue(MOCK_ADMIN_SESSION);

      render(<LegalHoldManagement />);

      await waitFor(() => {
        expect(screen.getByText("Legal Holds")).toBeInTheDocument();
      });
    });

    it("should allow ISSUER role to access", async () => {
      (readStoredSession as jest.Mock).mockReturnValue(MOCK_ISSUER_SESSION);

      render(<LegalHoldManagement />);

      await waitFor(() => {
        expect(screen.getByText("Legal Holds")).toBeInTheDocument();
      });
    });
  });

  describe("Legal Hold Display and Loading", () => {
    it("should display empty state when no holds exist", async () => {
      mockGetLegalHolds.mockResolvedValue({
        holds: [],
        nextCursor: null,
      });

      render(<LegalHoldManagement />);

      await waitFor(() => {
        expect(screen.getByText("No legal holds found.")).toBeInTheDocument();
      });
    });

    it("should display loading state initially", async () => {
      mockGetLegalHolds.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ holds: [], nextCursor: null }), 100)),
      );

      render(<LegalHoldManagement />);

      expect(screen.getByText("Loading legal holds...")).toBeInTheDocument();
    });

    it("should display loaded holds with correct status badges", async () => {
      const hold = createMockLegalHold();
      mockGetLegalHolds.mockResolvedValue({
        holds: [hold],
        nextCursor: null,
      });

      render(<LegalHoldManagement />);

      await waitFor(() => {
        expect(screen.getByText(hold.reason)).toBeInTheDocument();
        expect(screen.getByText("Active")).toBeInTheDocument();
      });
    });

    it("should display error message on load failure", async () => {
      mockGetLegalHolds.mockRejectedValue(new Error("API error"));

      render(<LegalHoldManagement />);

      await waitFor(() => {
        expect(screen.getByText("Failed to load legal holds. Please try again.")).toBeInTheDocument();
      });
    });
  });

  describe("Status Filtering", () => {
    it("should filter holds by status", async () => {
      const activeLegalHold = createMockLegalHold({ status: "ACTIVE" });
      const releasedHold = createMockReleasedLegalHold();

      mockGetLegalHolds.mockResolvedValue({
        holds: [activeLegalHold, releasedHold],
        nextCursor: null,
      });

      render(<LegalHoldManagement />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "ACTIVE" })).toBeInTheDocument();
      });

      const releasedButton = screen.getByRole("button", { name: "RELEASED" });
      await userEvent.click(releasedButton);

      await waitFor(() => {
        expect(mockGetLegalHolds).toHaveBeenCalledWith(
          MOCK_ADMIN_SESSION.token,
          expect.any(Object),
          "RELEASED",
          undefined,
        );
      });
    });

    it("should show ALL holds when filtered to ALL", async () => {
      const holds = [createMockLegalHold({ status: "ACTIVE" }), createMockReleasedLegalHold()];
      mockGetLegalHolds.mockResolvedValue({
        holds,
        nextCursor: null,
      });

      render(<LegalHoldManagement />);

      await waitFor(() => {
        const allButton = screen.getByRole("button", { name: "All" });
        expect(allButton).toBeInTheDocument();
      });
    });
  });

  describe("Create Legal Hold Form", () => {
    it("should show create form when button clicked", async () => {
      render(<LegalHoldManagement />);

      const createButton = await screen.findByRole("button", { name: "Create Hold" });
      await userEvent.click(createButton);

      await waitFor(() => {
        expect(screen.getByText("Create New Legal Hold")).toBeInTheDocument();
        expect(screen.getByLabelText("Start Date")).toBeInTheDocument();
        expect(screen.getByLabelText("End Date")).toBeInTheDocument();
        expect(screen.getByLabelText("Reason")).toBeInTheDocument();
      });
    });

    it("should validate required fields", async () => {
      render(<LegalHoldManagement />);

      const createButton = await screen.findByRole("button", { name: "Create Hold" });
      await userEvent.click(createButton);

      const submitButton = await screen.findByRole("button", { name: /Create Hold/ });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText("Start date, end date, and reason are required")).toBeInTheDocument();
      });
    });

    it("should validate date range", async () => {
      render(<LegalHoldManagement />);

      const createButton = await screen.findByRole("button", { name: "Create Hold" });
      await userEvent.click(createButton);

      const startDateInput = screen.getByLabelText("Start Date") as HTMLInputElement;
      const endDateInput = screen.getByLabelText("End Date") as HTMLInputElement;
      const reasonInput = screen.getByLabelText("Reason") as HTMLTextAreaElement;

      await userEvent.type(startDateInput, "2024-12-31");
      await userEvent.type(endDateInput, "2024-01-01");
      await userEvent.type(reasonInput, "Test legal hold reason");

      const submitButton = await screen.findByRole("button", { name: /Create Hold/ });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText("Start date must be before or equal to end date")).toBeInTheDocument();
      });
    });

    it("should validate reason length", async () => {
      render(<LegalHoldManagement />);

      const createButton = await screen.findByRole("button", { name: "Create Hold" });
      await userEvent.click(createButton);

      const startDateInput = screen.getByLabelText("Start Date") as HTMLInputElement;
      const endDateInput = screen.getByLabelText("End Date") as HTMLInputElement;
      const reasonInput = screen.getByLabelText("Reason") as HTMLTextAreaElement;

      await userEvent.type(startDateInput, "2024-01-01");
      await userEvent.type(endDateInput, "2024-01-31");
      await userEvent.type(reasonInput, "Short");

      const submitButton = await screen.findByRole("button", { name: /Create Hold/ });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText("Reason must be at least 10 characters")).toBeInTheDocument();
      });
    });

    it("should submit valid form and show success message", async () => {
      const newHold = createMockLegalHold();
      mockCreateLegalHold.mockResolvedValue({
        success: true,
        data: newHold,
      } as any);

      render(<LegalHoldManagement />);

      const createButton = await screen.findByRole("button", { name: "Create Hold" });
      await userEvent.click(createButton);

      const startDateInput = screen.getByLabelText("Start Date") as HTMLInputElement;
      const endDateInput = screen.getByLabelText("End Date") as HTMLInputElement;
      const reasonInput = screen.getByLabelText("Reason") as HTMLTextAreaElement;

      await userEvent.type(startDateInput, "2024-01-01");
      await userEvent.type(endDateInput, "2024-01-31");
      await userEvent.type(reasonInput, "Legal proceedings case #2024-0815");

      const submitButton = await screen.findByRole("button", { name: /Create Hold/ });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText("Legal hold created successfully")).toBeInTheDocument();
      });
    });

    it("should handle API errors on creation", async () => {
      mockCreateLegalHold.mockResolvedValue({
        success: false,
        error: {
          message: "Overlapping hold exists",
          type: "conflict",
          fieldErrors: {},
          isRetryable: false,
        },
      } as any);

      render(<LegalHoldManagement />);

      const createButton = await screen.findByRole("button", { name: "Create Hold" });
      await userEvent.click(createButton);

      const startDateInput = screen.getByLabelText("Start Date");
      const endDateInput = screen.getByLabelText("End Date");
      const reasonInput = screen.getByLabelText("Reason");

      await userEvent.type(startDateInput as HTMLInputElement, "2024-01-01");
      await userEvent.type(endDateInput as HTMLInputElement, "2024-01-31");
      await userEvent.type(reasonInput as HTMLTextAreaElement, "Legal proceedings");

      const submitButton = await screen.findByRole("button", { name: /Create Hold/ });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText("Overlapping hold exists")).toBeInTheDocument();
      });
    });
  });

  describe("Release Legal Hold", () => {
    it("should show release button for active holds", async () => {
      const activeLegalHold = createMockLegalHold();
      mockGetLegalHolds.mockResolvedValue({
        holds: [activeLegalHold],
        nextCursor: null,
      });

      render(<LegalHoldManagement />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Release" })).toBeInTheDocument();
      });
    });

    it("should not show release button for already released holds", async () => {
      const releasedHold = createMockReleasedLegalHold();
      mockGetLegalHolds.mockResolvedValue({
        holds: [releasedHold],
        nextCursor: null,
      });

      mockGetLegalHolds.mockResolvedValue({
        holds: [releasedHold],
        nextCursor: null,
      });

      render(<LegalHoldManagement />);

      await waitFor(() => {
        expect(screen.queryByRole("button", { name: "Release" })).not.toBeInTheDocument();
      });
    });

    it("should open release form and submit", async () => {
      const activeLegalHold = createMockLegalHold();
      mockGetLegalHolds.mockResolvedValue({
        holds: [activeLegalHold],
        nextCursor: null,
      });

      mockReleaseLegalHold.mockResolvedValue({
        success: true,
        data: { ...activeLegalHold, status: "RELEASED" },
      } as any);

      render(<LegalHoldManagement />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Release" })).toBeInTheDocument();
      });

      const releaseButton = screen.getByRole("button", { name: "Release" });
      await userEvent.click(releaseButton);

      const confirmButton = await screen.findByRole("button", { name: "Confirm Release" });
      expect(confirmButton).toBeInTheDocument();

      await userEvent.click(confirmButton);

      await waitFor(() => {
        expect(screen.getByText("Legal hold released successfully")).toBeInTheDocument();
      });
    });

    it("should handle release errors", async () => {
      const activeLegalHold = createMockLegalHold();
      mockGetLegalHolds.mockResolvedValue({
        holds: [activeLegalHold],
        nextCursor: null,
      });

      mockReleaseLegalHold.mockResolvedValue({
        success: false,
        error: {
          message: "Cannot release hold - litigation still pending",
          type: "validation",
          fieldErrors: {},
          isRetryable: false,
        },
      } as any);

      render(<LegalHoldManagement />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Release" })).toBeInTheDocument();
      });

      const releaseButton = screen.getByRole("button", { name: "Release" });
      await userEvent.click(releaseButton);

      const confirmButton = await screen.findByRole("button", { name: "Confirm Release" });
      await userEvent.click(confirmButton);

      await waitFor(() => {
        expect(screen.getByText("Cannot release hold - litigation still pending")).toBeInTheDocument();
      });
    });
  });

  describe("Pagination", () => {
    it("should show load more button when more results available", async () => {
      const hold = createMockLegalHold();
      mockGetLegalHolds.mockResolvedValue({
        holds: [hold],
        nextCursor: "cursor-next-page",
      });

      render(<LegalHoldManagement />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Load More" })).toBeInTheDocument();
      });
    });

    it("should load more holds on pagination", async () => {
      const hold1 = createMockLegalHold({ id: "hold-1" });
      const hold2 = createMockLegalHold({ id: "hold-2" });

      mockGetLegalHolds
        .mockResolvedValueOnce({
          holds: [hold1],
          nextCursor: "cursor-next",
        })
        .mockResolvedValueOnce({
          holds: [hold2],
          nextCursor: null,
        });

      render(<LegalHoldManagement />);

      await waitFor(() => {
        expect(screen.getByText(hold1.reason)).toBeInTheDocument();
      });

      const loadMoreButton = screen.getByRole("button", { name: "Load More" });
      await userEvent.click(loadMoreButton);

      await waitFor(() => {
        expect(screen.getByText(hold2.reason)).toBeInTheDocument();
      });
    });
  });
});
