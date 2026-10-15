/**
 * Tests for SecurityDashboard component
 * Covers: rendering, data loading, authorization, error handling, user interactions
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SecurityDashboard } from "../security-dashboard";
import { useAuthSession } from "@/lib/auth";
import { useOrganizationContext } from "@/lib/organization-context";
import * as securityApi from "@/lib/api/security-posture";
import {
  SECURITY_POSTURE_HEALTHY,
  SECURITY_POSTURE_WITH_FAILURES,
} from "../../../../tests/fixtures/security-posture-fixtures";

// Mock dependencies
jest.mock("@/lib/auth");
jest.mock("@/lib/organization-context");
jest.mock("@/lib/api/security-posture");

const mockUseAuthSession = useAuthSession as jest.MockedFunction<typeof useAuthSession>;
const mockUseOrganizationContext = useOrganizationContext as jest.MockedFunction<
  typeof useOrganizationContext
>;

describe("SecurityDashboard", () => {
  const mockOrganization = {
    id: "org-test-001",
    name: "Test Organization",
    slug: "test-org",
    status: "ACTIVE" as const,
  };

  const mockUser = {
    id: "user-001",
    walletAddress: "GBTEST",
    role: "ADMIN",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuthSession.mockReturnValue({
      user: mockUser,
      token: "test-token",
    });
    mockUseOrganizationContext.mockReturnValue({
      organization: mockOrganization,
      organizationId: mockOrganization.id,
      generation: 1,
      switchOrganization: jest.fn(),
      clearOrganization: jest.fn(),
      registerPendingMutation: jest.fn(),
    });
  });

  describe("Authorization", () => {
    it("denies access to non-admin users", () => {
      mockUseAuthSession.mockReturnValue({
        user: { ...mockUser, role: "WORKER" },
        token: "test-token",
      });

      render(<SecurityDashboard />);
      expect(screen.getByText(/Access Denied/i)).toBeInTheDocument();
      expect(screen.getByText(/administrators can access/i)).toBeInTheDocument();
    });

    it("allows access to ADMIN users", () => {
      jest.spyOn(securityApi, "getOrganizationSecurityPosture").mockResolvedValue(
        SECURITY_POSTURE_HEALTHY
      );

      render(<SecurityDashboard />);
      expect(screen.queryByText(/Access Denied/i)).not.toBeInTheDocument();
    });

    it("allows access to ISSUER users", () => {
      mockUseAuthSession.mockReturnValue({
        user: { ...mockUser, role: "ISSUER" },
        token: "test-token",
      });

      jest.spyOn(securityApi, "getOrganizationSecurityPosture").mockResolvedValue(
        SECURITY_POSTURE_HEALTHY
      );

      render(<SecurityDashboard />);
      expect(screen.queryByText(/Access Denied/i)).not.toBeInTheDocument();
    });
  });

  describe("Data Loading", () => {
    it("renders loading state initially", () => {
      jest.spyOn(securityApi, "getOrganizationSecurityPosture").mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<SecurityDashboard />);
      expect(screen.getByRole("generic")).toBeInTheDocument();
    });

    it("loads and displays security posture", async () => {
      jest.spyOn(securityApi, "getOrganizationSecurityPosture").mockResolvedValue(
        SECURITY_POSTURE_HEALTHY
      );

      render(<SecurityDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/Security Posture/i)).toBeInTheDocument();
      });
    });

    it("calls API with correct parameters", async () => {
      const mock = jest.spyOn(securityApi, "getOrganizationSecurityPosture").mockResolvedValue(
        SECURITY_POSTURE_HEALTHY
      );

      render(<SecurityDashboard />);

      await waitFor(() => {
        expect(mock).toHaveBeenCalledWith(
          "test-token",
          "org-test-001",
          expect.any(AbortSignal)
        );
      });
    });
  });

  describe("Error Handling", () => {
    it("displays error message on API failure", async () => {
      const errorMessage = "Failed to load security posture";
      jest
        .spyOn(securityApi, "getOrganizationSecurityPosture")
        .mockRejectedValue(new Error(errorMessage));

      render(<SecurityDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/Unable to Load/i)).toBeInTheDocument();
        expect(screen.getByText(new RegExp(errorMessage))).toBeInTheDocument();
      });
    });

    it("provides retry button on error", async () => {
      jest
        .spyOn(securityApi, "getOrganizationSecurityPosture")
        .mockRejectedValueOnce(new Error("Error"));

      const { rerender } = render(<SecurityDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/Try Again/i)).toBeInTheDocument();
      });

      // Mock recovery
      jest.spyOn(securityApi, "getOrganizationSecurityPosture").mockResolvedValue(
        SECURITY_POSTURE_HEALTHY
      );

      const retryButton = screen.getByText(/Try Again/i);
      await userEvent.click(retryButton);

      rerender(<SecurityDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/Security Posture/i)).toBeInTheDocument();
      });
    });
  });

  describe("Critical Issues Display", () => {
    it("shows critical alert when issues exist", async () => {
      jest.spyOn(securityApi, "getOrganizationSecurityPosture").mockResolvedValue(
        SECURITY_POSTURE_WITH_FAILURES
      );

      render(<SecurityDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/Critical Issues Detected/i)).toBeInTheDocument();
      });
    });

    it("hides critical alert when no critical issues", async () => {
      jest.spyOn(securityApi, "getOrganizationSecurityPosture").mockResolvedValue(
        SECURITY_POSTURE_HEALTHY
      );

      render(<SecurityDashboard />);

      await waitFor(() => {
        expect(screen.queryByText(/Critical Issues Detected/i)).not.toBeInTheDocument();
      });
    });

    it("displays correct critical count", async () => {
      jest.spyOn(securityApi, "getOrganizationSecurityPosture").mockResolvedValue(
        SECURITY_POSTURE_WITH_FAILURES
      );

      render(<SecurityDashboard />);

      await waitFor(() => {
        expect(
          screen.getByText(
            new RegExp(
              `${SECURITY_POSTURE_WITH_FAILURES.severityCounts.CRITICAL} critical`
            )
          )
        ).toBeInTheDocument();
      });
    });
  });

  describe("Data Display", () => {
    it("displays score card with severity", async () => {
      jest.spyOn(securityApi, "getOrganizationSecurityPosture").mockResolvedValue(
        SECURITY_POSTURE_HEALTHY
      );

      render(<SecurityDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/95/)).toBeInTheDocument(); // Score
      });
    });

    it("displays severity breakdown", async () => {
      jest.spyOn(securityApi, "getOrganizationSecurityPosture").mockResolvedValue(
        SECURITY_POSTURE_WITH_FAILURES
      );

      render(<SecurityDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/Critical/)).toBeInTheDocument();
        expect(screen.getByText(/High/)).toBeInTheDocument();
        expect(screen.getByText(/Medium/)).toBeInTheDocument();
      });
    });

    it("displays category summary", async () => {
      jest.spyOn(securityApi, "getOrganizationSecurityPosture").mockResolvedValue(
        SECURITY_POSTURE_WITH_FAILURES
      );

      render(<SecurityDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/By Category/i)).toBeInTheDocument();
      });
    });

    it("displays security checks list", async () => {
      jest.spyOn(securityApi, "getOrganizationSecurityPosture").mockResolvedValue(
        SECURITY_POSTURE_HEALTHY
      );

      render(<SecurityDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/Security Checks/i)).toBeInTheDocument();
      });
    });
  });

  describe("Freshness Indicator", () => {
    it("displays staleness warning when data is old", async () => {
      jest.spyOn(securityApi, "getOrganizationSecurityPosture").mockResolvedValue({
        ...SECURITY_POSTURE_HEALTHY,
        isFresh: false,
        stalenessDays: 7,
      });

      render(<SecurityDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/Data stale/i)).toBeInTheDocument();
        expect(screen.getByText(/7d old/)).toBeInTheDocument();
      });
    });

    it("does not display staleness warning for fresh data", async () => {
      jest.spyOn(securityApi, "getOrganizationSecurityPosture").mockResolvedValue(
        SECURITY_POSTURE_HEALTHY
      );

      render(<SecurityDashboard />);

      await waitFor(() => {
        expect(screen.queryByText(/Data stale/i)).not.toBeInTheDocument();
      });
    });
  });

  describe("User Interactions", () => {
    it("provides evaluate button", async () => {
      jest.spyOn(securityApi, "getOrganizationSecurityPosture").mockResolvedValue(
        SECURITY_POSTURE_HEALTHY
      );

      render(<SecurityDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/Evaluate/i)).toBeInTheDocument();
      });
    });

    it("provides export button", async () => {
      jest.spyOn(securityApi, "getOrganizationSecurityPosture").mockResolvedValue(
        SECURITY_POSTURE_HEALTHY
      );

      render(<SecurityDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/Export/i)).toBeInTheDocument();
      });
    });
  });

  describe("Missing Data", () => {
    it("handles null organization gracefully", () => {
      mockUseOrganizationContext.mockReturnValue({
        organization: null,
        organizationId: null,
        generation: 1,
        switchOrganization: jest.fn(),
        clearOrganization: jest.fn(),
        registerPendingMutation: jest.fn(),
      });

      render(<SecurityDashboard />);
      // Should render without error
      expect(screen.getByRole("generic")).toBeInTheDocument();
    });

    it("handles null user gracefully", () => {
      mockUseAuthSession.mockReturnValue({
        user: null,
        token: null,
      });

      render(<SecurityDashboard />);
      // Should render without error
      expect(screen.getByRole("generic")).toBeInTheDocument();
    });
  });

  describe("Cleanup and Cancellation", () => {
    it("cancels in-flight requests on unmount", async () => {
      const abortSpy = jest.spyOn(AbortController.prototype, "abort");
      jest
        .spyOn(securityApi, "getOrganizationSecurityPosture")
        .mockImplementation(async (token, orgId, signal) => {
          await new Promise(() => {}); // Never resolves
          return SECURITY_POSTURE_HEALTHY;
        });

      const { unmount } = render(<SecurityDashboard />);
      unmount();

      await waitFor(() => {
        expect(abortSpy).toHaveBeenCalled();
      });
    });
  });
});
