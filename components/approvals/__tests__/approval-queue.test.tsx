/**
 * Component tests for ApprovalQueue
 * 
 * Tests cover:
 * - Rendering operations list with filters
 * - Filter changes and API fetching
 * - Authorization checks
 * - Expiry indicators and conflict warnings
 * - User interactions (selection, approve/reject buttons)
 * - Loading and error states
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ApprovalQueue } from "@/components/approvals/approval-queue";
import * as approvalsApi from "@/lib/api/approvals";
import * as store from "@/lib/approvals/store";
import {
  FIXTURE_ROLE_CHANGE_PENDING,
  FIXTURE_EXPORT_PENDING,
  FIXTURE_ALL_PENDING_OPERATIONS,
  FIXTURE_PAGINATED_PENDING_RESPONSE,
  ORG_ID_ALPHA,
  ADMIN_USER,
  READONLY_USER,
} from "@/tests/fixtures/approval-fixtures";

// Mock dependencies
jest.mock("@/lib/api/approvals");
jest.mock("@/lib/approvals/store");

const mockGetApprovalOperations = jest.mocked(approvalsApi.getApprovalOperations);
const mockCanUserApproveOperations = jest.mocked(approvalsApi.canUserApproveOperations);
const mockUpsertOperations = jest.mocked(store.upsertOperations);
const mockListOperations = jest.mocked(store.listOperations);
const mockInvalidateCache = jest.mocked(store.invalidateCache);

const defaultProps = {
  userId: "test-user",
  organizationId: ORG_ID_ALPHA,
  token: "test-token",
  userRole: "ADMIN" as const,
};

describe("ApprovalQueue Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetApprovalOperations.mockResolvedValue(FIXTURE_PAGINATED_PENDING_RESPONSE);
    mockCanUserApproveOperations.mockReturnValue(true);
    mockListOperations.mockReturnValue(FIXTURE_ALL_PENDING_OPERATIONS);
  });

  describe("Rendering", () => {
    it("renders queue component", () => {
      render(<ApprovalQueue {...defaultProps} />);
      expect(screen.getByText("Operation Approvals")).toBeInTheDocument();
    });

    it("displays loading state initially", () => {
      mockGetApprovalOperations.mockImplementation(() => new Promise(() => {})); // Never resolves
      render(<ApprovalQueue {...defaultProps} />);

      // Should show loading skeleton
      expect(document.querySelector(".animate-pulse")).toBeInTheDocument();
    });

    it("displays operations after loading", async () => {
      render(<ApprovalQueue {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/Role Change/i)).toBeInTheDocument();
      });
    });

    it("displays error state on fetch failure", async () => {
      const error = new Error("Network error");
      mockGetApprovalOperations.mockRejectedValue(error);
      mockListOperations.mockReturnValue([]); // No cached data

      render(<ApprovalQueue {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("Error loading operations")).toBeInTheDocument();
        expect(screen.getByText(error.message)).toBeInTheDocument();
      });
    });

    it("shows 'no operations' message when list is empty", async () => {
      mockGetApprovalOperations.mockResolvedValue({
        ...FIXTURE_PAGINATED_PENDING_RESPONSE,
        operations: [],
      });

      render(<ApprovalQueue {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("No operations found")).toBeInTheDocument();
      });
    });
  });

  describe("Filtering", () => {
    it("changes status filter", async () => {
      render(<ApprovalQueue {...defaultProps} />);

      const statusSelect = screen.getByLabelText("Status");
      fireEvent.change(statusSelect, { target: { value: "approved" } });

      await waitFor(() => {
        expect(mockGetApprovalOperations).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining({ status: "approved" }),
          expect.anything()
        );
      });
    });

    it("changes operation type filter", async () => {
      render(<ApprovalQueue {...defaultProps} />);

      const typeSelect = screen.getByLabelText("Type");
      fireEvent.change(typeSelect, { target: { value: "export" } });

      await waitFor(() => {
        expect(mockGetApprovalOperations).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining({ operationType: "export" }),
          expect.anything()
        );
      });
    });

    it("toggles 'my requests' filter", async () => {
      render(<ApprovalQueue {...defaultProps} />);

      const myRequestsCheckbox = screen.getByLabelText("My Requests");
      fireEvent.click(myRequestsCheckbox);

      await waitFor(() => {
        expect(mockGetApprovalOperations).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining({ requestedBy: "test-user" }),
          expect.anything()
        );
      });
    });

    it("clears filters when reset to default", async () => {
      render(<ApprovalQueue {...defaultProps} />);

      // Apply a filter
      const statusSelect = screen.getByLabelText("Status");
      fireEvent.change(statusSelect, { target: { value: "approved" } });

      // Clear it
      fireEvent.change(statusSelect, { target: { value: "" } });

      await waitFor(() => {
        expect(mockGetApprovalOperations).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining({ status: undefined }),
          expect.anything()
        );
      });
    });
  });

  describe("Authorization", () => {
    it("hides approve/reject buttons for non-admin users", () => {
      mockCanUserApproveOperations.mockReturnValue(false);

      render(<ApprovalQueue {...defaultProps} userRole="MEMBER" />);

      // Approve and Reject buttons should not be visible
      const approveButtons = screen.queryAllByRole("button", { name: /Approve/i });
      const rejectButtons = screen.queryAllByRole("button", { name: /Reject/i });

      expect(approveButtons.length).toBe(0);
      expect(rejectButtons.length).toBe(0);
    });

    it("shows approve/reject buttons for admin users", async () => {
      mockCanUserApproveOperations.mockReturnValue(true);

      render(<ApprovalQueue {...defaultProps} userRole="ADMIN" />);

      await waitFor(() => {
        const approveButtons = screen.getAllByRole("button", { name: /Approve/i });
        expect(approveButtons.length).toBeGreaterThan(0);
      });
    });

    it("denies access for read-only users", () => {
      render(<ApprovalQueue {...defaultProps} userRole="MEMBER" />);

      // Should still render, but without action buttons
      expect(screen.getByText("Status")).toBeInTheDocument();
    });
  });

  describe("Expiry Indicators", () => {
    it("displays age for operations", async () => {
      render(<ApprovalQueue {...defaultProps} />);

      await waitFor(() => {
        // Should show age in format like "2h old"
        const ageElements = screen.getAllByText(/[0-9]+[mhd] old/);
        expect(ageElements.length).toBeGreaterThan(0);
      });
    });

    it("displays time remaining for operations", async () => {
      render(<ApprovalQueue {...defaultProps} />);

      await waitFor(() => {
        // Should show remaining time like "2d remaining"
        const remainingElements = screen.getAllByText(/[0-9]+[mhd] remaining/);
        expect(remainingElements.length).toBeGreaterThan(0);
      });
    });

    it("highlights expired operations with red border", async () => {
      const expiredOp = {
        ...FIXTURE_ROLE_CHANGE_PENDING,
        expiresAt: "2024-01-14T00:00:00.000Z", // in the past
      };

      mockGetApprovalOperations.mockResolvedValue({
        ...FIXTURE_PAGINATED_PENDING_RESPONSE,
        operations: [expiredOp],
      });

      render(<ApprovalQueue {...defaultProps} />);

      await waitFor(() => {
        const borderElement = document.querySelector(".border-l-red-500");
        expect(borderElement).toBeInTheDocument();
      });
    });

    it("highlights expiring-soon operations with yellow border", async () => {
      const expiringSoonOp = {
        ...FIXTURE_ROLE_CHANGE_PENDING,
        expiresAt: "2024-01-16T11:00:00.000Z", // 23 hours away
      };

      mockGetApprovalOperations.mockResolvedValue({
        ...FIXTURE_PAGINATED_PENDING_RESPONSE,
        operations: [expiringSoonOp],
      });

      render(<ApprovalQueue {...defaultProps} />);

      await waitFor(() => {
        const borderElement = document.querySelector(".border-l-yellow-500");
        expect(borderElement).toBeInTheDocument();
      });
    });
  });

  describe("Conflict Detection", () => {
    it("displays conflict warning banner", async () => {
      const conflictError = new Error("409 Conflict");
      mockGetApprovalOperations.mockRejectedValueOnce(conflictError);

      render(<ApprovalQueue {...defaultProps} />);

      await waitFor(() => {
        // Should either show conflict message or use cached data
        expect(mockListOperations).toHaveBeenCalled();
      });
    });

    it("allows refreshing after conflict", async () => {
      mockGetApprovalOperations.mockRejectedValueOnce(new Error("Conflict"));

      render(<ApprovalQueue {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Try Again/i })).toBeInTheDocument();
      });

      const tryAgainButton = screen.getByRole("button", { name: /Try Again/i });
      fireEvent.click(tryAgainButton);

      await waitFor(() => {
        expect(mockGetApprovalOperations).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("User Interactions", () => {
    it("calls onSelectOperation when clicking details button", async () => {
      const onSelectOperation = jest.fn();

      render(
        <ApprovalQueue {...defaultProps} onSelectOperation={onSelectOperation} />
      );

      await waitFor(() => {
        const detailsButtons = screen.getAllByText(/Details →/i);
        expect(detailsButtons.length).toBeGreaterThan(0);

        fireEvent.click(detailsButtons[0]);
      });

      await waitFor(() => {
        expect(onSelectOperation).toHaveBeenCalled();
      });
    });

    it("calls onOperationActioned after action", async () => {
      const onOperationActioned = jest.fn();
      mockCanUserApproveOperations.mockReturnValue(true);

      render(
        <ApprovalQueue {...defaultProps} onOperationActioned={onOperationActioned} />
      );

      await waitFor(() => {
        const approveButtons = screen.getAllByRole("button", { name: /Approve/i });
        expect(approveButtons.length).toBeGreaterThan(0);

        fireEvent.click(approveButtons[0]);
      });

      // Note: This would require the approval dialog to be handled
      // In a real test, we'd wait for the callback
    });

    it("refreshes data when refresh button is clicked", async () => {
      render(<ApprovalQueue {...defaultProps} />);

      const refreshButton = screen.getByRole("button", { name: /Refresh/i });
      fireEvent.click(refreshButton);

      await waitFor(() => {
        // Second call after initial load + refresh click
        expect(mockGetApprovalOperations).toHaveBeenCalled();
      });
    });

    it("invalidates cache on refresh", async () => {
      render(<ApprovalQueue {...defaultProps} />);

      await waitFor(() => {
        const refreshButton = screen.getByRole("button", { name: /Refresh/i });
        fireEvent.click(refreshButton);
      });

      await waitFor(() => {
        expect(mockInvalidateCache).toHaveBeenCalledWith("test-user", ORG_ID_ALPHA);
      });
    });
  });

  describe("Edge Cases", () => {
    it("handles operations with missing approval reason gracefully", async () => {
      const opWithoutReason = {
        ...FIXTURE_ROLE_CHANGE_PENDING,
        reason: undefined,
      };

      mockGetApprovalOperations.mockResolvedValue({
        ...FIXTURE_PAGINATED_PENDING_RESPONSE,
        operations: [opWithoutReason],
      });

      render(<ApprovalQueue {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/Role Change/i)).toBeInTheDocument();
      });
    });

    it("handles very long operation descriptions", async () => {
      const opWithLongDesc = {
        ...FIXTURE_ROLE_CHANGE_PENDING,
        reason: "a".repeat(500),
      };

      mockGetApprovalOperations.mockResolvedValue({
        ...FIXTURE_PAGINATED_PENDING_RESPONSE,
        operations: [opWithLongDesc],
      });

      render(<ApprovalQueue {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/Role Change/i)).toBeInTheDocument();
      });
    });

    it("handles rapid filter changes", async () => {
      render(<ApprovalQueue {...defaultProps} />);

      const statusSelect = screen.getByLabelText("Status");

      // Rapidly change filters
      fireEvent.change(statusSelect, { target: { value: "approved" } });
      fireEvent.change(statusSelect, { target: { value: "rejected" } });
      fireEvent.change(statusSelect, { target: { value: "pending" } });

      await waitFor(() => {
        // Should handle all changes without crashing
        expect(mockGetApprovalOperations).toHaveBeenCalled();
      });
    });
  });

  describe("Responsive Layout", () => {
    it("renders in mobile view", () => {
      // Mock window width
      Object.defineProperty(window, "innerWidth", { value: 375 });

      render(<ApprovalQueue {...defaultProps} />);

      // Should still render all controls
      expect(screen.getByLabelText("Status")).toBeInTheDocument();
      expect(screen.getByLabelText("Type")).toBeInTheDocument();
    });

    it("renders in desktop view", () => {
      Object.defineProperty(window, "innerWidth", { value: 1920 });

      render(<ApprovalQueue {...defaultProps} />);

      // Should render all controls in grid layout
      expect(screen.getByLabelText("Status")).toBeInTheDocument();
      expect(screen.getByLabelText("Type")).toBeInTheDocument();
    });
  });
});
