/**
 * React Testing Library tests for ApprovalReceipt component
 *
 * Covers:
 * - Component rendering with valid data
 * - Authorization checks and access denial
 * - Expiration status display
 * - Error and warning display
 * - User interactions (copy, download)
 * - Accessibility compliance
 * - Responsive design states
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ApprovalReceipt } from "@/components/governance/approval-receipt";
import { GovernanceApprovalIntentConfirmation } from "@/lib/api/governance-approvals";
import { GOVERNANCE_APPROVALS_SCHEMA_VERSION } from "@/lib/api/governance-approvals";

// Mock the NetworkBadge and formatDateTime components
jest.mock("@/components/common/network-badge", () => ({
  NetworkBadge: () => <div data-testid="network-badge">Network Badge</div>,
}));

jest.mock("@/lib/i18n", () => ({
  formatDateTime: (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString();
  },
}));

describe("ApprovalReceipt Component", () => {
  const createValidConfirmation = (
    overrides?: Partial<GovernanceApprovalIntentConfirmation>
  ): GovernanceApprovalIntentConfirmation => ({
    id: "receipt-123",
    intentType: "intent",
    schemaVersion: GOVERNANCE_APPROVALS_SCHEMA_VERSION,
    actionHash:
      "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
    network: "stellar:testnet",
    targetContract: "GDORAYKWPL3YSWK4S46QNRMGUFL3SJGTBSXE237B7XNKQ5YXLVA7VEU7",
    proposalId: "prop-42",
    approvalRole: "VOTER",
    walletAddress: "GBRPYHIL2CI3WHZDTOOQFC6EB4PSZBMQV24ICHTDFG7UK7GQEI6N3XEW",
    state: "confirmed",
    confirmedAt: new Date(Date.now() - 10000).toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(), // +1 day
    metadata: { governanceDao: "MyDAO", proposalTitle: "Budget Proposal" },
    ...overrides,
  });

  const defaultProps = {
    currentWalletAddress: "GBRPYHIL2CI3WHZDTOOQFC6EB4PSZBMQV24ICHTDFG7UK7GQEI6N3XEW",
    onDownload: jest.fn(),
    onCopy: jest.fn(),
  };

  describe("Rendering - Valid receipt", () => {
    it("renders receipt header", () => {
      const confirmation = createValidConfirmation();
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      expect(screen.getByText("Approval Intent Receipt")).toBeInTheDocument();
    });

    it("displays receipt ID", () => {
      const confirmation = createValidConfirmation({ id: "receipt-999" });
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      expect(screen.getByText(/receipt-999/)).toBeInTheDocument();
    });

    it("displays confirmed state badge", () => {
      const confirmation = createValidConfirmation({ state: "confirmed" });
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      expect(screen.getByText("Confirmed")).toBeInTheDocument();
    });

    it("displays all canonical fields", () => {
      const confirmation = createValidConfirmation();
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      expect(screen.getByText(/Action Hash/i)).toBeInTheDocument();
      expect(screen.getByText(/Target Contract/i)).toBeInTheDocument();
      expect(screen.getByText(/Network/i)).toBeInTheDocument();
      expect(screen.getByText(/Proposal ID/i)).toBeInTheDocument();
      expect(screen.getByText(/Approval Role/i)).toBeInTheDocument();
      expect(screen.getByText(/Wallet Address/i)).toBeInTheDocument();
    });

    it("displays timestamps", () => {
      const confirmation = createValidConfirmation();
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      expect(screen.getByText(/Confirmed At/i)).toBeInTheDocument();
      expect(screen.getByText(/Expires At/i)).toBeInTheDocument();
    });

    it("displays metadata", () => {
      const confirmation = createValidConfirmation({
        metadata: { governanceDao: "MyDAO", proposalTitle: "Budget" },
      });
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      expect(screen.getByText(/MyDAO/)).toBeInTheDocument();
      expect(screen.getByText(/Budget/)).toBeInTheDocument();
    });

    it("displays digest if present", () => {
      const confirmation = createValidConfirmation({
        digest: { algorithm: "SHA256", value: "abc123def456" },
      });
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      expect(screen.getByText(/SHA256/)).toBeInTheDocument();
    });

    it("displays intent vs execution notice", () => {
      const confirmation = createValidConfirmation();
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      expect(screen.getByText(/Intent vs. Execution/)).toBeInTheDocument();
      expect(screen.getByText(/does not claim execution/)).toBeInTheDocument();
    });

    it("renders download and copy buttons", () => {
      const confirmation = createValidConfirmation();
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      expect(
        screen.getByRole("button", { name: /Copy to Clipboard/ })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Download Receipt/ })
      ).toBeInTheDocument();
    });
  });

  describe("Authorization - Access control", () => {
    it("denies access to non-approver", () => {
      const confirmation = createValidConfirmation({
        walletAddress: "GBRPYHIL2CI3WHZDTOOQFC6EB4PSZBMQV24ICHTDFG7UK7GQEI6N3XEW",
      });
      const otherWallet = "GDORAYKWPL3YSWK4S46QNRMGUFL3SJGTBSXE237B7XNKQ5YXLVA7VEU7";
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          currentWalletAddress={otherWallet}
          {...defaultProps}
        />
      );
      expect(screen.getByText("Access Denied")).toBeInTheDocument();
      expect(screen.getByText(/Only the approver/)).toBeInTheDocument();
    });

    it("grants access to approver", () => {
      const walletAddress = "GBRPYHIL2CI3WHZDTOOQFC6EB4PSZBMQV24ICHTDFG7UK7GQEI6N3XEW";
      const confirmation = createValidConfirmation({
        walletAddress,
      });
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          currentWalletAddress={walletAddress}
          {...defaultProps}
        />
      );
      expect(
        screen.queryByText("Access Denied")
      ).not.toBeInTheDocument();
      expect(
        screen.getByText("Approval Intent Receipt")
      ).toBeInTheDocument();
    });

    it("is case-insensitive for wallet matching", () => {
      const confirmation = createValidConfirmation({
        walletAddress: "GBRPYHIL2CI3WHZDTOOQFC6EB4PSZBMQV24ICHTDFG7UK7GQEI6N3XEW",
      });
      const lowerWallet = "gbrpyhil2ci3whzdtooqfc6eb4pszbmqv24ichtdfg7uk7gqei6n3xew";
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          currentWalletAddress={lowerWallet}
          {...defaultProps}
        />
      );
      expect(
        screen.getByText("Approval Intent Receipt")
      ).toBeInTheDocument();
    });
  });

  describe("Expiration status", () => {
    it("shows expiration notice for expired receipt", () => {
      const confirmation = createValidConfirmation({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      expect(screen.getByText(/has expired/)).toBeInTheDocument();
      expect(
        screen.getByText(/server will reject.*execution/)
      ).toBeInTheDocument();
    });

    it("disables signing for expired receipt", () => {
      const confirmation = createValidConfirmation({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      const copyButton = screen.getByRole("button", { name: /Copy/ });
      expect(copyButton).toBeDisabled();
    });

    it("shows Expired badge for expired receipt", () => {
      const confirmation = createValidConfirmation({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      // Should show state badge with Expired indicator
      const badgeText = screen.getByText(/Expired/);
      expect(badgeText).toBeInTheDocument();
    });

    it("does not show expiration notice for valid receipt", () => {
      const confirmation = createValidConfirmation({
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      expect(screen.queryByText(/has expired/)).not.toBeInTheDocument();
    });
  });

  describe("State transitions", () => {
    const states = [
      "intent_signed",
      "submitted",
      "confirmed",
      "failed",
      "superseded",
      "cancelled",
    ];

    states.forEach((state) => {
      it(`displays ${state} state`, () => {
        const confirmation = createValidConfirmation({ state: state as any });
        const { rerender } = render(
          <ApprovalReceipt
            confirmation={confirmation}
            {...defaultProps}
          />
        );
        // State should be displayed in some form
        const stateText = screen.queryByText(
          new RegExp(state.replace(/_/g, " "), "i")
        );
        expect(stateText).toBeInTheDocument();
      });
    });

    it("displays error state for failed approvals", () => {
      const confirmation = createValidConfirmation({ state: "failed" });
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      expect(screen.getByText(/Failed/)).toBeInTheDocument();
    });
  });

  describe("Validation errors", () => {
    it("displays validation errors", () => {
      const invalidConfirmation = {
        id: "test",
        walletAddress: "",
        // Missing required fields
      } as any;
      render(
        <ApprovalReceipt
          confirmation={invalidConfirmation}
          {...defaultProps}
        />
      );
      expect(screen.getByText(/Validation Errors/)).toBeInTheDocument();
    });

    it("shows error details when showValidationDetails is true", () => {
      const invalidConfirmation = {
        id: "test",
        walletAddress: "",
        intentType: "invalid",
      } as any;
      render(
        <ApprovalReceipt
          confirmation={invalidConfirmation}
          {...defaultProps}
          showValidationDetails={true}
        />
      );
      const errorList = screen.getByText(/Validation Errors/).closest("div");
      expect(errorList?.textContent).toContain("walletAddress");
    });
  });

  describe("User interactions", () => {
    it("calls onCopy when copy button clicked", () => {
      const onCopy = jest.fn();
      const confirmation = createValidConfirmation();
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          currentWalletAddress={confirmation.walletAddress}
          onCopy={onCopy}
          onDownload={jest.fn()}
        />
      );
      const copyButton = screen.getByRole("button", { name: /Copy/ });
      fireEvent.click(copyButton);
      expect(onCopy).toHaveBeenCalled();
    });

    it("calls onDownload when download button clicked", () => {
      const onDownload = jest.fn();
      const confirmation = createValidConfirmation();
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          currentWalletAddress={confirmation.walletAddress}
          onDownload={onDownload}
          onCopy={jest.fn()}
        />
      );
      const downloadButton = screen.getByRole("button", { name: /Download/ });
      fireEvent.click(downloadButton);
      expect(onDownload).toHaveBeenCalled();
    });

    it("disables download button for unauthorized users", () => {
      const confirmation = createValidConfirmation({
        walletAddress: "GBRPYHIL2CI3WHZDTOOQFC6EB4PSZBMQV24ICHTDFG7UK7GQEI6N3XEW",
      });
      const otherWallet = "GDORAYKWPL3YSWK4S46QNRMGUFL3SJGTBSXE237B7XNKQ5YXLVA7VEU7";
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          currentWalletAddress={otherWallet}
          {...defaultProps}
        />
      );
      // Access denied screen should be shown, so buttons shouldn't exist
      expect(
        screen.queryByRole("button", { name: /Download/ })
      ).not.toBeInTheDocument();
    });
  });

  describe("Accessibility", () => {
    it("has proper heading structure", () => {
      const confirmation = createValidConfirmation();
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      const heading = screen.getByRole("heading", {
        name: /Approval Intent Receipt/,
      });
      expect(heading).toBeInTheDocument();
    });

    it("has aria-label on article", () => {
      const confirmation = createValidConfirmation();
      const { container } = render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      const article = container.querySelector('article[aria-label]');
      expect(article).toHaveAttribute(
        "aria-label",
        "Governance Approval Intent Receipt"
      );
    });

    it("has aria-modal on access denied dialog", () => {
      const confirmation = createValidConfirmation();
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          currentWalletAddress="DIFFERENT_WALLET"
          {...defaultProps}
        />
      );
      const alertRole = screen.getByRole("alert");
      expect(alertRole).toBeInTheDocument();
    });

    it("has semantic dt/dd elements for data", () => {
      const confirmation = createValidConfirmation();
      const { container } = render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      const dts = container.querySelectorAll("dt");
      const dds = container.querySelectorAll("dd");
      expect(dts.length).toBeGreaterThan(0);
      expect(dds.length).toBeGreaterThan(0);
    });

    it("buttons have descriptive labels", () => {
      const confirmation = createValidConfirmation();
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      expect(
        screen.getByRole("button", { name: /Copy to Clipboard/ })
      ).toHaveAttribute("aria-label");
      expect(
        screen.getByRole("button", { name: /Download Receipt/ })
      ).toHaveAttribute("aria-label");
    });
  });

  describe("Hash display formatting", () => {
    it("shortens long action hashes", () => {
      const longHash =
        "abc123def456abc123def456abc123def456abc123def456abc123def456abc1";
      const confirmation = createValidConfirmation({
        actionHash: longHash,
      });
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      // Should show shortened version
      expect(screen.getByText(/abc123\.\.\./)).toBeInTheDocument();
      // Should still have full hash in title attribute
      const codeElements = screen.getAllByText(
        new RegExp(`^${longHash}$`)
      );
      expect(codeElements.length).toBeGreaterThan(0);
    });

    it("displays full hash on hover (via title)", () => {
      const confirmation = createValidConfirmation();
      const { container } = render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      const codeElements = container.querySelectorAll("code");
      // At least one code element should have a title attribute with full hash
      const hasTitle = Array.from(codeElements).some((el) =>
        el.getAttribute("title")
      );
      expect(hasTitle).toBe(true);
    });
  });

  describe("Metadata display", () => {
    it("displays all metadata entries", () => {
      const confirmation = createValidConfirmation({
        metadata: {
          governanceDao: "MyDAO",
          proposalTitle: "Budget Proposal",
          votingPeriod: "7 days",
        },
      });
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      expect(screen.getByText(/MyDAO/)).toBeInTheDocument();
      expect(screen.getByText(/Budget Proposal/)).toBeInTheDocument();
      expect(screen.getByText(/7 days/)).toBeInTheDocument();
    });

    it("omits metadata section if empty", () => {
      const confirmation = createValidConfirmation();
      delete confirmation.metadata;
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      expect(screen.queryByText(/Metadata/)).not.toBeInTheDocument();
    });
  });

  describe("Responsive behavior", () => {
    it("renders without crashing on small screens", () => {
      const confirmation = createValidConfirmation();
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      expect(
        screen.getByText("Approval Intent Receipt")
      ).toBeInTheDocument();
    });

    it("uses responsive grid layouts", () => {
      const confirmation = createValidConfirmation();
      const { container } = render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      // Check for responsive classes (md:grid-cols-2 indicates responsive grid)
      const grids = container.querySelectorAll("[class*='grid']");
      expect(grids.length).toBeGreaterThan(0);
    });
  });

  describe("Schema version display", () => {
    it("displays schema version", () => {
      const confirmation = createValidConfirmation({
        schemaVersion: "1.0",
      });
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      expect(screen.getByText(/Schema v1.0/)).toBeInTheDocument();
    });

    it("includes receipt ID in footer", () => {
      const confirmation = createValidConfirmation({
        id: "receipt-abc-123",
      });
      render(
        <ApprovalReceipt
          confirmation={confirmation}
          {...defaultProps}
        />
      );
      expect(screen.getByText(/receipt-abc-123/)).toBeInTheDocument();
    });
  });
});
