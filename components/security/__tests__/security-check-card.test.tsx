/**
 * Tests for SecurityCheckCard component
 * Covers: rendering, expansion, formatting, acknowledgment, remediation display
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SecurityCheckCard } from "../security-check-card";
import {
  PASSED_CHECK_KEY_ROTATION,
  FAILED_CHECK_EXPIRED_KEYS,
  UNKNOWN_CHECK_SESSION_TIMEOUT,
  ACKNOWLEDGED_CHECK_WEBHOOK,
} from "../../../../tests/fixtures/security-posture-fixtures";

describe("SecurityCheckCard", () => {
  const mockOnToggle = jest.fn();
  const mockOnAcknowledged = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Rendering", () => {
    it("renders check name and description", () => {
      render(
        <SecurityCheckCard
          check={PASSED_CHECK_KEY_ROTATION}
          isExpanded={false}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(screen.getByText(PASSED_CHECK_KEY_ROTATION.name)).toBeInTheDocument();
      expect(screen.getByText(PASSED_CHECK_KEY_ROTATION.description)).toBeInTheDocument();
    });

    it("renders status badge", () => {
      render(
        <SecurityCheckCard
          check={PASSED_CHECK_KEY_ROTATION}
          isExpanded={false}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(screen.getByText(/Passed/i)).toBeInTheDocument();
    });

    it("renders severity badge", () => {
      render(
        <SecurityCheckCard
          check={FAILED_CHECK_EXPIRED_KEYS}
          isExpanded={false}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(screen.getByText(/Critical/i)).toBeInTheDocument();
    });

    it("renders category badge", () => {
      render(
        <SecurityCheckCard
          check={PASSED_CHECK_KEY_ROTATION}
          isExpanded={false}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(screen.getByText(/Key Rotation/i)).toBeInTheDocument();
    });

    it("renders status indicator dot", () => {
      render(
        <SecurityCheckCard
          check={PASSED_CHECK_KEY_ROTATION}
          isExpanded={false}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      // Check for SVG circle (status indicator)
      const svgs = screen.getAllByRole("img", { hidden: true });
      expect(svgs.length).toBeGreaterThan(0);
    });
  });

  describe("Expansion", () => {
    it("does not display details when collapsed", () => {
      render(
        <SecurityCheckCard
          check={FAILED_CHECK_EXPIRED_KEYS}
          isExpanded={false}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(screen.queryByText(/Evidence/i)).not.toBeInTheDocument();
    });

    it("displays details when expanded", () => {
      render(
        <SecurityCheckCard
          check={FAILED_CHECK_EXPIRED_KEYS}
          isExpanded={true}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(screen.getByText(/Evidence/i)).toBeInTheDocument();
    });

    it("calls onToggleExpand when header is clicked", async () => {
      const { container } = render(
        <SecurityCheckCard
          check={PASSED_CHECK_KEY_ROTATION}
          isExpanded={false}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      const header = container.querySelector("button");
      await userEvent.click(header!);
      expect(mockOnToggle).toHaveBeenCalled();
    });
  });

  describe("Evidence Display", () => {
    it("displays findings when expanded", () => {
      render(
        <SecurityCheckCard
          check={FAILED_CHECK_EXPIRED_KEYS}
          isExpanded={true}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      FAILED_CHECK_EXPIRED_KEYS.evidence!.findings.forEach((finding) => {
        expect(screen.getByText(finding)).toBeInTheDocument();
      });
    });

    it("displays affected count when present", () => {
      render(
        <SecurityCheckCard
          check={FAILED_CHECK_EXPIRED_KEYS}
          isExpanded={true}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(
        screen.getByText(
          new RegExp(`Affected items: ${FAILED_CHECK_EXPIRED_KEYS.evidence?.affectedCount}`)
        )
      ).toBeInTheDocument();
    });

    it("does not display evidence section for checks without evidence", () => {
      const checkWithoutEvidence = {
        ...PASSED_CHECK_KEY_ROTATION,
        evidence: undefined,
      };

      render(
        <SecurityCheckCard
          check={checkWithoutEvidence}
          isExpanded={true}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(screen.queryByText(/Evidence/i)).not.toBeInTheDocument();
    });
  });

  describe("Remediation Display", () => {
    it("displays remediation when check failed and expanded", () => {
      render(
        <SecurityCheckCard
          check={FAILED_CHECK_EXPIRED_KEYS}
          isExpanded={true}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(screen.getByText(/Remediation/i)).toBeInTheDocument();
    });

    it("displays remediation steps as ordered list", () => {
      render(
        <SecurityCheckCard
          check={FAILED_CHECK_EXPIRED_KEYS}
          isExpanded={true}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      FAILED_CHECK_EXPIRED_KEYS.remediation!.steps.forEach((step) => {
        expect(screen.getByText(new RegExp(step))).toBeInTheDocument();
      });
    });

    it("displays remediation link when provided", () => {
      render(
        <SecurityCheckCard
          check={FAILED_CHECK_EXPIRED_KEYS}
          isExpanded={true}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      const link = screen.getByText(/View detailed guide/i);
      expect(link).toHaveAttribute("href", FAILED_CHECK_EXPIRED_KEYS.remediation!.remediationLink);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("does not display remediation for passed checks", () => {
      render(
        <SecurityCheckCard
          check={PASSED_CHECK_KEY_ROTATION}
          isExpanded={true}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(screen.queryByText(/Remediation/i)).not.toBeInTheDocument();
    });

    it("does not display remediation for acknowledged checks", () => {
      render(
        <SecurityCheckCard
          check={ACKNOWLEDGED_CHECK_WEBHOOK}
          isExpanded={true}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(screen.queryByText(/Remediation/i)).not.toBeInTheDocument();
    });
  });

  describe("Acknowledgement Display", () => {
    it("displays acknowledgement when present and expanded", () => {
      render(
        <SecurityCheckCard
          check={ACKNOWLEDGED_CHECK_WEBHOOK}
          isExpanded={true}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(screen.getByText(/Acknowledged Exception/i)).toBeInTheDocument();
      expect(
        screen.getByText(ACKNOWLEDGED_CHECK_WEBHOOK.acknowledgement!.reason)
      ).toBeInTheDocument();
    });

    it("displays acknowledgement metadata", () => {
      render(
        <SecurityCheckCard
          check={ACKNOWLEDGED_CHECK_WEBHOOK}
          isExpanded={true}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(
        screen.getByText(
          new RegExp(ACKNOWLEDGED_CHECK_WEBHOOK.acknowledgement!.acknowledgedBy)
        )
      ).toBeInTheDocument();
    });

    it("displays expiration date when set", () => {
      render(
        <SecurityCheckCard
          check={ACKNOWLEDGED_CHECK_WEBHOOK}
          isExpanded={true}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(screen.getByText(/Expires/)).toBeInTheDocument();
    });

    it("does not display acknowledgement for non-acknowledged checks", () => {
      render(
        <SecurityCheckCard
          check={FAILED_CHECK_EXPIRED_KEYS}
          isExpanded={true}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(screen.queryByText(/Acknowledged Exception/i)).not.toBeInTheDocument();
    });
  });

  describe("Status Variants", () => {
    it("renders passed check correctly", () => {
      render(
        <SecurityCheckCard
          check={PASSED_CHECK_KEY_ROTATION}
          isExpanded={false}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(screen.getByText(/Passed/i)).toBeInTheDocument();
    });

    it("renders failed check correctly", () => {
      render(
        <SecurityCheckCard
          check={FAILED_CHECK_EXPIRED_KEYS}
          isExpanded={false}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(screen.getByText(/Failed/i)).toBeInTheDocument();
    });

    it("renders unknown check correctly", () => {
      render(
        <SecurityCheckCard
          check={UNKNOWN_CHECK_SESSION_TIMEOUT}
          isExpanded={false}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(screen.getByText(/Unknown/i)).toBeInTheDocument();
    });

    it("renders acknowledged check correctly", () => {
      render(
        <SecurityCheckCard
          check={ACKNOWLEDGED_CHECK_WEBHOOK}
          isExpanded={false}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(screen.getByText(/Acknowledged/i)).toBeInTheDocument();
    });
  });

  describe("Metadata", () => {
    it("displays evaluation timestamp when expanded", () => {
      render(
        <SecurityCheckCard
          check={FAILED_CHECK_EXPIRED_KEYS}
          isExpanded={true}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(screen.getByText(/Last evaluated/i)).toBeInTheDocument();
    });

    it("displays owner when present", () => {
      render(
        <SecurityCheckCard
          check={FAILED_CHECK_EXPIRED_KEYS}
          isExpanded={true}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(
        screen.getByText(new RegExp(`Owner: ${FAILED_CHECK_EXPIRED_KEYS.owner}`))
      ).toBeInTheDocument();
    });

    it("does not display owner when not present", () => {
      const checkWithoutOwner = { ...PASSED_CHECK_KEY_ROTATION, owner: undefined };

      render(
        <SecurityCheckCard
          check={checkWithoutOwner}
          isExpanded={true}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(screen.queryByText(/Owner:/)).not.toBeInTheDocument();
    });
  });

  describe("Action Buttons", () => {
    it("shows acknowledge button for failed uncknowledged checks when expanded", () => {
      render(
        <SecurityCheckCard
          check={FAILED_CHECK_EXPIRED_KEYS}
          isExpanded={true}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(screen.getByText(/Acknowledge as Exception/i)).toBeInTheDocument();
    });

    it("does not show acknowledge button for passed checks", () => {
      render(
        <SecurityCheckCard
          check={PASSED_CHECK_KEY_ROTATION}
          isExpanded={true}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(screen.queryByText(/Acknowledge as Exception/i)).not.toBeInTheDocument();
    });

    it("does not show acknowledge button for already acknowledged checks", () => {
      render(
        <SecurityCheckCard
          check={ACKNOWLEDGED_CHECK_WEBHOOK}
          isExpanded={true}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      expect(screen.queryByText(/Acknowledge as Exception/i)).not.toBeInTheDocument();
    });
  });

  describe("Accessibility", () => {
    it("has keyboard-navigable header", () => {
      const { container } = render(
        <SecurityCheckCard
          check={PASSED_CHECK_KEY_ROTATION}
          isExpanded={false}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      const header = container.querySelector("button");
      expect(header).toBeInTheDocument();
    });

    it("has semantic structure", () => {
      const { container } = render(
        <SecurityCheckCard
          check={FAILED_CHECK_EXPIRED_KEYS}
          isExpanded={true}
          onToggleExpand={mockOnToggle}
          onAcknowledged={mockOnAcknowledged}
        />
      );

      // Check for proper heading hierarchy
      const headings = container.querySelectorAll("h4, h5");
      expect(headings.length).toBeGreaterThan(0);
    });
  });
});
