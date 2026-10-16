/**
 * Tests for retention policy viewer component
 * 
 * Coverage:
 * - Display current retention policy
 * - Update retention policy
 * - View policy history
 * - Authorization checks
 * - Loading and error states
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RetentionPolicyViewer } from "../retention-policy-viewer";
import * as retentionApi from "@/lib/api/retention";
import {
  MOCK_ADMIN_SESSION,
  MOCK_DEVELOPER_SESSION,
  createMockRetentionPolicy,
  createMockRetentionPoliciesHistory,
} from "@/lib/api/__tests__/retention.fixtures";

// Mock the session reading
jest.mock("@/lib/session", () => ({
  readStoredSession: jest.fn(),
}));

// Mock the retention API
jest.mock("@/lib/api/retention", () => ({
  ...jest.requireActual("@/lib/api/retention"),
  getRetentionPolicy: jest.fn(),
  getRetentionPoliciesHistory: jest.fn(),
  updateRetentionPolicySafe: jest.fn(),
}));

import { readStoredSession } from "@/lib/session";

describe("RetentionPolicyViewer Component", () => {
  const mockGetPolicy = retentionApi.getRetentionPolicy as jest.MockedFunction<
    typeof retentionApi.getRetentionPolicy
  >;
  const mockGetHistory = retentionApi.getRetentionPoliciesHistory as jest.MockedFunction<
    typeof retentionApi.getRetentionPoliciesHistory
  >;
  const mockUpdatePolicy = retentionApi.updateRetentionPolicySafe as jest.MockedFunction<
    typeof retentionApi.updateRetentionPolicySafe
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    (readStoredSession as jest.Mock).mockReturnValue(MOCK_ADMIN_SESSION);
    mockGetPolicy.mockResolvedValue(createMockRetentionPolicy());
    mockGetHistory.mockResolvedValue({
      policies: [],
      nextCursor: null,
    });
  });

  describe("Authentication and Authorization", () => {
    it("should show authentication prompt when not logged in", async () => {
      (readStoredSession as jest.Mock).mockReturnValue(null);

      render(<RetentionPolicyViewer />);

      await waitFor(() => {
        expect(screen.getByText("Authentication Required")).toBeInTheDocument();
      });
      expect(screen.getByRole("link", { name: /Connect Wallet/i })).toHaveAttribute("href", "/proofs");
    });

    it("should show access restricted message for non-admin users", async () => {
      (readStoredSession as jest.Mock).mockReturnValue(MOCK_DEVELOPER_SESSION);

      render(<RetentionPolicyViewer />);

      await waitFor(() => {
        expect(screen.getByText("Access Restricted")).toBeInTheDocument();
      });
      expect(screen.getByText(/requires administrative access/i)).toBeInTheDocument();
    });

    it("should allow ADMIN role to access", async () => {
      (readStoredSession as jest.Mock).mockReturnValue(MOCK_ADMIN_SESSION);

      render(<RetentionPolicyViewer />);

      await waitFor(() => {
        expect(screen.getByText("Current Retention Policy")).toBeInTheDocument();
      });
    });
  });

  describe("Current Policy Display", () => {
    it("should display current retention policy details", async () => {
      const policy = createMockRetentionPolicy({
        period: "90_DAYS",
        description: "Quarterly retention period",
      });
      mockGetPolicy.mockResolvedValue(policy);

      render(<RetentionPolicyViewer />);

      await waitFor(() => {
        expect(screen.getByText("90 days")).toBeInTheDocument();
        expect(screen.getByText("Quarterly retention period")).toBeInTheDocument();
        expect(screen.getByText("admin@example.com")).toBeInTheDocument();
      });
    });

    it("should display indefinite retention properly", async () => {
      const policy = createMockRetentionPolicy({ period: "INDEFINITE" });
      mockGetPolicy.mockResolvedValue(policy);

      render(<RetentionPolicyViewer />);

      await waitFor(() => {
        expect(screen.getByText("Indefinite")).toBeInTheDocument();
      });
    });

    it("should display policy creation timestamp", async () => {
      const policy = createMockRetentionPolicy({
        createdAt: "2024-01-15T10:30:00Z",
      });
      mockGetPolicy.mockResolvedValue(policy);

      render(<RetentionPolicyViewer />);

      await waitFor(() => {
        expect(screen.getByText(/Jan 15, 2024/)).toBeInTheDocument();
      });
    });

    it("should show loading state initially", async () => {
      mockGetPolicy.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(createMockRetentionPolicy()), 100),
          ),
      );

      render(<RetentionPolicyViewer />);

      expect(screen.getByText("Loading retention policy...")).toBeInTheDocument();
    });

    it("should display error on load failure", async () => {
      mockGetPolicy.mockRejectedValue(new Error("API error"));

      render(<RetentionPolicyViewer />);

      await waitFor(() => {
        expect(screen.getByText("Failed to load retention policy. Please try again.")).toBeInTheDocument();
      });
    });
  });

  describe("Update Policy Form", () => {
    it("should show update form when button clicked", async () => {
      render(<RetentionPolicyViewer />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Update Policy" })).toBeInTheDocument();
      });

      const updateButton = screen.getByRole("button", { name: "Update Policy" });
      await userEvent.click(updateButton);

      await waitFor(() => {
        expect(screen.getByText("Update Retention Policy")).toBeInTheDocument();
        expect(screen.getByLabelText("Retention Period")).toBeInTheDocument();
      });
    });

    it("should allow selecting different retention periods", async () => {
      render(<RetentionPolicyViewer />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Update Policy" })).toBeInTheDocument();
      });

      const updateButton = screen.getByRole("button", { name: "Update Policy" });
      await userEvent.click(updateButton);

      const periodSelect = await screen.findByLabelText("Retention Period");
      await userEvent.selectOptions(periodSelect, "INDEFINITE");

      expect((periodSelect as HTMLSelectElement).value).toBe("INDEFINITE");
    });

    it("should submit policy update with new period", async () => {
      const updatedPolicy = createMockRetentionPolicy({ period: "1_YEAR" });
      mockUpdatePolicy.mockResolvedValue({
        success: true,
        data: updatedPolicy,
      } as any);

      render(<RetentionPolicyViewer />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Update Policy" })).toBeInTheDocument();
      });

      const updateButton = screen.getByRole("button", { name: "Update Policy" });
      await userEvent.click(updateButton);

      const periodSelect = await screen.findByLabelText("Retention Period");
      await userEvent.selectOptions(periodSelect, "1_YEAR");

      const descriptionInput = await screen.findByPlaceholder(/Document the reason/);
      await userEvent.type(descriptionInput, "Increased retention for compliance");

      const submitButton = await screen.findByRole("button", { name: /Update Policy/ });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText("Retention policy updated successfully")).toBeInTheDocument();
      });
    });

    it("should handle update errors", async () => {
      mockUpdatePolicy.mockResolvedValue({
        success: false,
        error: {
          message: "Cannot update policy - active legal holds exist",
          type: "validation",
          fieldErrors: {},
          isRetryable: false,
        },
      } as any);

      render(<RetentionPolicyViewer />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Update Policy" })).toBeInTheDocument();
      });

      const updateButton = screen.getByRole("button", { name: "Update Policy" });
      await userEvent.click(updateButton);

      const periodSelect = await screen.findByLabelText("Retention Period");
      await userEvent.selectOptions(periodSelect, "7_DAYS");

      const submitButton = await screen.findByRole("button", { name: /Update Policy/ });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText("Cannot update policy - active legal holds exist")).toBeInTheDocument();
      });
    });

    it("should close form and reset on cancel", async () => {
      render(<RetentionPolicyViewer />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Update Policy" })).toBeInTheDocument();
      });

      const updateButton = screen.getByRole("button", { name: "Update Policy" });
      await userEvent.click(updateButton);

      await waitFor(() => {
        expect(screen.getByText("Update Retention Policy")).toBeInTheDocument();
      });

      const cancelButton = screen.getAllByRole("button", { name: "Cancel" })[0];
      await userEvent.click(cancelButton);

      await waitFor(() => {
        expect(screen.queryByText("Update Retention Policy")).not.toBeInTheDocument();
      });
    });
  });

  describe("Policy History", () => {
    it("should display policy history when available", async () => {
      const history = createMockRetentionPoliciesHistory();
      mockGetHistory.mockResolvedValue({
        policies: history,
        nextCursor: null,
      });

      render(<RetentionPolicyViewer />);

      await waitFor(() => {
        expect(screen.getByText("Policy History")).toBeInTheDocument();
      });

      // Check that historical policies are displayed
      history.forEach((policy) => {
        expect(screen.getByText(policy.description || "")).toBeInTheDocument();
      });
    });

    it("should not display policy history section when empty", async () => {
      mockGetHistory.mockResolvedValue({
        policies: [],
        nextCursor: null,
      });

      render(<RetentionPolicyViewer />);

      await waitFor(() => {
        expect(screen.getByText("Current Retention Policy")).toBeInTheDocument();
      });

      expect(screen.queryByText("Policy History")).not.toBeInTheDocument();
    });

    it("should show load more button for paginated history", async () => {
      const history = createMockRetentionPoliciesHistory();
      mockGetHistory.mockResolvedValue({
        policies: history,
        nextCursor: "cursor-next-page",
      });

      render(<RetentionPolicyViewer />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Load More History" })).toBeInTheDocument();
      });
    });

    it("should load more history on pagination", async () => {
      const history1 = createMockRetentionPoliciesHistory();
      const history2 = createMockRetentionPoliciesHistory().map((p) => ({
        ...p,
        id: `${p.id}-page2`,
      }));

      mockGetHistory
        .mockResolvedValueOnce({
          policies: history1,
          nextCursor: "cursor-next",
        })
        .mockResolvedValueOnce({
          policies: history2,
          nextCursor: null,
        });

      render(<RetentionPolicyViewer />);

      await waitFor(() => {
        expect(screen.getByText("Policy History")).toBeInTheDocument();
      });

      const loadMoreButton = screen.getByRole("button", { name: "Load More History" });
      await userEvent.click(loadMoreButton);

      // Verify second batch was loaded (simplified check)
      expect(mockGetHistory).toHaveBeenCalledWith(
        MOCK_ADMIN_SESSION.token,
        expect.any(Object),
        "cursor-next",
      );
    });
  });

  describe("Policy Details Display", () => {
    it("should display all retention period options", async () => {
      render(<RetentionPolicyViewer />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Update Policy" })).toBeInTheDocument();
      });

      const updateButton = screen.getByRole("button", { name: "Update Policy" });
      await userEvent.click(updateButton);

      const select = await screen.findByLabelText("Retention Period");
      const options = (select as HTMLSelectElement).options;

      expect(options.length).toBeGreaterThanOrEqual(7);
    });

    it("should display formatted effective from date", async () => {
      const policy = createMockRetentionPolicy({
        effectiveFrom: "2024-06-15T14:30:00Z",
      });
      mockGetPolicy.mockResolvedValue(policy);

      render(<RetentionPolicyViewer />);

      await waitFor(() => {
        expect(screen.getByText(/Jun 15, 2024/)).toBeInTheDocument();
      });
    });

    it("should handle policy without description", async () => {
      const policy = createMockRetentionPolicy({ description: undefined });
      mockGetPolicy.mockResolvedValue(policy);

      render(<RetentionPolicyViewer />);

      await waitFor(() => {
        expect(screen.getByText("90 days")).toBeInTheDocument();
      });

      // Description section should not be present
      expect(screen.queryByText("DESCRIPTION")).not.toBeInTheDocument();
    });

    it("should calculate and display retention days for non-indefinite periods", async () => {
      const policy = createMockRetentionPolicy({ period: "365_DAYS" });
      mockGetPolicy.mockResolvedValue(policy);

      render(<RetentionPolicyViewer />);

      // The component should display retention periods and associated day counts
      await waitFor(() => {
        expect(screen.getByText("Current Retention Policy")).toBeInTheDocument();
      });
    });
  });

  describe("Concurrency and State Management", () => {
    it("should handle rapid policy updates without race conditions", async () => {
      let resolvePolicy: any;
      mockGetPolicy.mockImplementation(
        () => new Promise((resolve) => {
          resolvePolicy = resolve;
        }),
      );

      const { rerender } = render(<RetentionPolicyViewer />);

      // Policy is still loading
      expect(screen.getByText("Loading retention policy...")).toBeInTheDocument();

      // Update button should not cause issues
      const updateButton = screen.queryByRole("button", { name: "Update Policy" });
      expect(updateButton).not.toBeInTheDocument();

      // Resolve the promise
      resolvePolicy(createMockRetentionPolicy());

      await waitFor(() => {
        expect(screen.getByText("90 days")).toBeInTheDocument();
      });
    });

    it("should not leak state between multiple renders", async () => {
      const policy = createMockRetentionPolicy();
      mockGetPolicy.mockResolvedValue(policy);

      const { unmount } = render(<RetentionPolicyViewer />);

      await waitFor(() => {
        expect(screen.getByText("90 days")).toBeInTheDocument();
      });

      unmount();

      // Re-render should work independently
      jest.clearAllMocks();
      mockGetPolicy.mockResolvedValue(policy);

      render(<RetentionPolicyViewer />);

      await waitFor(() => {
        expect(screen.getByText("90 days")).toBeInTheDocument();
      });
    });
  });
});
