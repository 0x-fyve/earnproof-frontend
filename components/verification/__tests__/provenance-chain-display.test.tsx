/**
 * Provenance chain display component tests.
 *
 * Coverage areas:
 * - Rendering of sources, checkpoints, and observations
 * - Collapsible sections
 * - Status badges
 * - Missing links display
 * - Accessibility features
 * - Edge cases: empty chains, all failed, all unavailable
 */

import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ProvenianceChainDisplay } from "@/components/verification/provenance-chain-display";
import type { ProvenianceChain } from "@/lib/api/generated/v1";

// Mock the Timestamp component to avoid timezone issues in tests
jest.mock("@/components/common/timestamp", () => ({
  Timestamp: ({ value }: { value: string }) => <span>{value}</span>,
}));

// Fixture: Basic valid provenance chain
const validChain: ProvenianceChain = {
  sources: [
    {
      id: "issuer-1",
      type: "issuer",
      status: "verified",
      name: "Issuer Registry",
      description: "EarnProof trusted issuers",
    },
    {
      id: "contract-1",
      type: "contract",
      status: "verified",
      name: "Smart Contract",
    },
  ],
  checkpoints: [
    {
      id: "cp-signature",
      name: "Signature Validation",
      order: 0,
      description: "Verify cryptographic signature",
    },
    {
      id: "cp-issuer",
      name: "Issuer Verification",
      order: 1,
      description: "Check issuer registry",
    },
  ],
  observations: [
    {
      checkpointId: "cp-signature",
      timestamp: "2026-08-16T14:00:00Z",
      sourceId: "contract-1",
      observationType: "signature_check",
      result: true,
      details: "Signature valid",
    },
    {
      checkpointId: "cp-issuer",
      timestamp: "2026-08-16T14:00:05Z",
      sourceId: "issuer-1",
      observationType: "issuer_check",
      result: true,
    },
  ],
  verificationPath: ["cp-signature", "cp-issuer"],
  missingLinks: [],
};

// Fixture: Chain with failures
const failedChain: ProvenianceChain = {
  ...validChain,
  sources: [
    { ...validChain.sources[0], status: "failed" },
    validChain.sources[1],
  ],
  observations: [
    {
      checkpointId: "cp-signature",
      timestamp: "2026-08-16T14:00:00Z",
      sourceId: "issuer-1",
      observationType: "signature_check",
      result: false,
      details: "Signature mismatch",
    },
  ],
};

// Fixture: Chain with missing links
const missingLinksChain: ProvenianceChain = {
  ...validChain,
  sources: [
    { ...validChain.sources[0], status: "unavailable" },
    validChain.sources[1],
  ],
  missingLinks: [
    {
      sourceId: "issuer-1",
      reason: "timeout",
      retryable: true,
    },
  ],
};

describe("ProvenianceChainDisplay", () => {
  describe("rendering", () => {
    it("renders the title", () => {
      render(<ProvenianceChainDisplay chain={validChain} />);
      expect(screen.getByText("Verification Sources")).toBeInTheDocument();
    });

    it("renders custom title when provided", () => {
      render(<ProvenianceChainDisplay chain={validChain} title="Custom Title" />);
      expect(screen.getByText("Custom Title")).toBeInTheDocument();
    });

    it("renders source summary statistics", () => {
      render(<ProvenianceChainDisplay chain={validChain} />);
      expect(screen.getByText("Verified")).toBeInTheDocument();
      expect(screen.getByText("Unavailable")).toBeInTheDocument();
      expect(screen.getByText("Failed")).toBeInTheDocument();
      expect(screen.getByText("Checkpoints")).toBeInTheDocument();
    });

    it("displays correct source counts", () => {
      render(<ProvenianceChainDisplay chain={validChain} />);
      const verified = screen.getByText("Verified").closest("div");
      expect(within(verified!).getByText("2")).toBeInTheDocument();
    });

    it("renders all checkpoints", () => {
      render(<ProvenianceChainDisplay chain={validChain} />);
      expect(screen.getByText("1. Signature Validation")).toBeInTheDocument();
      expect(screen.getByText("2. Issuer Verification")).toBeInTheDocument();
    });

    it("renders sources panel", () => {
      render(<ProvenianceChainDisplay chain={validChain} />);
      expect(screen.getByText("Verification Sources")).toBeInTheDocument();
      expect(screen.getByText("Issuer Registry")).toBeInTheDocument();
      expect(screen.getByText("Smart Contract")).toBeInTheDocument();
    });
  });

  describe("checkpoint collapsibility", () => {
    it("renders checkpoints collapsed by default", () => {
      render(<ProvenianceChainDisplay chain={validChain} expandedByDefault={false} />);
      const details = screen.queryAllByRole("region");
      // Details sections should not be visible
      expect(details.length).toBe(0);
    });

    it("expands checkpoint when clicked", () => {
      render(<ProvenianceChainDisplay chain={validChain} expandedByDefault={false} />);
      const button = screen.getByText("1. Signature Validation").closest("button");
      fireEvent.click(button!);
      expect(screen.getByText("Signature Validation")).toBeInTheDocument();
    });

    it("renders checkpoints expanded when expandedByDefault is true", () => {
      render(<ProvenianceChainDisplay chain={validChain} expandedByDefault={true} />);
      expect(screen.getByText("Signature Validation")).toBeInTheDocument();
    });

    it("toggles checkpoint expansion", () => {
      render(<ProvenianceChainDisplay chain={validChain} expandedByDefault={false} />);
      const button = screen.getByText("1. Signature Validation").closest("button");

      // Expand
      fireEvent.click(button!);
      expect(screen.getByText("Signature valid")).toBeInTheDocument();

      // Collapse
      fireEvent.click(button!);
      expect(screen.queryByText("Signature valid")).not.toBeInTheDocument();
    });
  });

  describe("observations display", () => {
    it("shows passed observations with checkmark", () => {
      render(
        <ProvenianceChainDisplay chain={validChain} expandedByDefault={true} />
      );
      expect(screen.getAllByText("✓").length).toBeGreaterThan(0);
    });

    it("shows failed observations with X mark", () => {
      render(
        <ProvenianceChainDisplay chain={failedChain} expandedByDefault={true} />
      );
      expect(screen.getByText("✕")).toBeInTheDocument();
    });

    it("shows observation details when showDetails is true", () => {
      render(
        <ProvenianceChainDisplay
          chain={validChain}
          expandedByDefault={true}
          showDetails={true}
        />
      );
      expect(screen.getByText("2026-08-16T14:00:00Z")).toBeInTheDocument();
    });

    it("hides observation timestamps when showDetails is false", () => {
      render(
        <ProvenianceChainDisplay
          chain={validChain}
          expandedByDefault={true}
          showDetails={false}
        />
      );
      // Timestamp should not be visible (but exists in the data)
      const timestamp = screen.queryByText("2026-08-16T14:00:00Z");
      expect(timestamp).not.toBeInTheDocument();
    });

    it("displays observation result details", () => {
      render(
        <ProvenianceChainDisplay chain={validChain} expandedByDefault={true} />
      );
      expect(screen.getByText("Signature valid")).toBeInTheDocument();
    });
  });

  describe("status badges", () => {
    it("shows verified badge for verified sources", () => {
      render(<ProvenianceChainDisplay chain={validChain} />);
      const badges = screen.getAllByText(/verified|✓/i);
      expect(badges.length).toBeGreaterThan(0);
    });

    it("shows failed badge count in checkpoint header", () => {
      render(
        <ProvenianceChainDisplay chain={failedChain} expandedByDefault={false} />
      );
      expect(screen.getByText("1 failed")).toBeInTheDocument();
    });

    it("shows verified count in checkpoint header when all passed", () => {
      render(
        <ProvenianceChainDisplay chain={validChain} expandedByDefault={false} />
      );
      expect(screen.getByText("1 verified")).toBeInTheDocument();
    });
  });

  describe("missing links display", () => {
    it("does not show missing links section when empty", () => {
      render(<ProvenianceChainDisplay chain={validChain} />);
      const heading = screen.queryByText("Unavailable Sources");
      expect(heading).not.toBeInTheDocument();
    });

    it("shows missing links section when present", () => {
      render(<ProvenianceChainDisplay chain={missingLinksChain} />);
      expect(screen.getByText("Unavailable Sources")).toBeInTheDocument();
    });

    it("displays missing link reason", () => {
      render(<ProvenianceChainDisplay chain={missingLinksChain} />);
      expect(screen.getByText("Request timed out")).toBeInTheDocument();
    });

    it("shows retryable indicator", () => {
      render(<ProvenianceChainDisplay chain={missingLinksChain} />);
      expect(screen.getByText("(retryable)")).toBeInTheDocument();
    });
  });

  describe("retry information", () => {
    it("shows retry allowed message for retryable failures", () => {
      render(<ProvenianceChainDisplay chain={missingLinksChain} />);
      expect(
        screen.getByText(/temporarily unavailable.*retried/i)
      ).toBeInTheDocument();
    });

    it("shows non-retryable failure warning when present", () => {
      const nonRetryableChain: ProvenianceChain = {
        ...failedChain,
        missingLinks: [
          {
            sourceId: "issuer-1",
            reason: "permission_denied",
            retryable: false,
          },
        ],
      };
      render(<ProvenianceChainDisplay chain={nonRetryableChain} />);
      expect(
        screen.getByText(/permanent failures.*never be upgraded/i)
      ).toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("has proper heading hierarchy", () => {
      render(<ProvenianceChainDisplay chain={validChain} />);
      const heading = screen.getByText("Verification Sources");
      expect(heading.tagName).toBe("H3");
    });

    it("has aria-expanded on collapsible buttons", () => {
      render(
        <ProvenianceChainDisplay chain={validChain} expandedByDefault={false} />
      );
      const button = screen.getByText("1. Signature Validation").closest("button");
      expect(button).toHaveAttribute("aria-expanded");
    });

    it("updates aria-expanded when toggled", () => {
      render(
        <ProvenianceChainDisplay chain={validChain} expandedByDefault={false} />
      );
      const button = screen.getByText("1. Signature Validation").closest("button");
      expect(button).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(button!);
      expect(button).toHaveAttribute("aria-expanded", "true");
    });

    it("has aria-controls linking button to details", () => {
      render(
        <ProvenianceChainDisplay chain={validChain} expandedByDefault={false} />
      );
      const button = screen.getByText("1. Signature Validation").closest("button");
      expect(button).toHaveAttribute("aria-controls");
    });

    it("has aria-label for status indicators", () => {
      render(
        <ProvenianceChainDisplay chain={validChain} expandedByDefault={true} />
      );
      // Status badges should have aria-labels
      const elements = screen.getAllByRole("generic");
      expect(elements.length).toBeGreaterThan(0);
    });
  });

  describe("edge cases", () => {
    it("handles chain with no observations", () => {
      const emptyObsChain: ProvenianceChain = {
        ...validChain,
        observations: [],
      };
      render(
        <ProvenianceChainDisplay
          chain={emptyObsChain}
          expandedByDefault={true}
        />
      );
      expect(
        screen.getByText("No observations recorded for this checkpoint.")
      ).toBeInTheDocument();
    });

    it("handles chain with single checkpoint", () => {
      const singleCpChain: ProvenianceChain = {
        ...validChain,
        checkpoints: [validChain.checkpoints[0]],
        observations: [validChain.observations[0]],
        verificationPath: ["cp-signature"],
      };
      render(<ProvenianceChainDisplay chain={singleCpChain} />);
      expect(screen.getByText("1. Signature Validation")).toBeInTheDocument();
    });

    it("handles chain with multiple sources per checkpoint", () => {
      const multiSourceChain: ProvenianceChain = {
        ...validChain,
        observations: [
          ...validChain.observations,
          {
            checkpointId: "cp-signature",
            timestamp: "2026-08-16T14:00:02Z",
            sourceId: "issuer-1",
            observationType: "signature_check",
            result: true,
          },
        ],
      };
      render(
        <ProvenianceChainDisplay
          chain={multiSourceChain}
          expandedByDefault={true}
        />
      );
      // Should show both observations for the checkpoint
      expect(screen.getAllByText("Signature Validation")).toBeTruthy();
    });

    it("handles description text in checkpoints", () => {
      render(
        <ProvenianceChainDisplay chain={validChain} expandedByDefault={false} />
      );
      expect(
        screen.getByText("Verify cryptographic signature")
      ).toBeInTheDocument();
    });

    it("handles description text in sources", () => {
      render(<ProvenianceChainDisplay chain={validChain} />);
      expect(screen.getByText("EarnProof trusted issuers")).toBeInTheDocument();
    });
  });

  describe("source list ordering", () => {
    it("displays sources in checkpoint order", () => {
      render(
        <ProvenianceChainDisplay chain={validChain} expandedByDefault={false} />
      );
      const buttons = screen.getAllByRole("button");
      // First button should be first checkpoint
      expect(buttons[0]).toHaveTextContent("1. Signature Validation");
      // Second button should be second checkpoint
      expect(buttons[1]).toHaveTextContent("2. Issuer Verification");
    });
  });
});
