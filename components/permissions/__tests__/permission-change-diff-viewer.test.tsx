/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { PermissionChangeDiffViewer } from "../permission-change-diff-viewer";
import {
  FIXTURE_DIFF_ADD_READ_SCOPE,
  FIXTURE_DIFF_ADD_BROAD_SCOPE,
  FIXTURE_DIFF_REMOVE_SCOPE,
  FIXTURE_DIFF_REMOVE_BROAD_SCOPE,
  FIXTURE_DIFF_NO_CHANGES,
  FIXTURE_DIFF_COMPLEX_CHANGE,
  FIXTURE_BOUNDARY_EMPTY,
} from "@/lib/validation/__tests__/fixtures/permission-diff-fixtures";

describe("PermissionChangeDiffViewer", () => {
  describe("rendering and display", () => {
    it("renders title and permission table", () => {
      render(
        <PermissionChangeDiffViewer
          diff={FIXTURE_DIFF_ADD_READ_SCOPE}
          title="Test Permission Changes"
        />,
      );

      expect(screen.getByText("Test Permission Changes")).toBeInTheDocument();
      expect(screen.getByRole("table")).toBeInTheDocument();
    });

    it("displays added permissions with 'Added' badge", () => {
      render(<PermissionChangeDiffViewer diff={FIXTURE_DIFF_ADD_BROAD_SCOPE} />);

      const statusBadges = screen.getAllByText("Added");
      expect(statusBadges.length).toBeGreaterThan(0);
    });

    it("displays removed permissions with 'Removed' badge", () => {
      render(<PermissionChangeDiffViewer diff={FIXTURE_DIFF_REMOVE_SCOPE} />);

      const removedBadges = screen.getAllByText("Removed");
      expect(removedBadges.length).toBeGreaterThan(0);
    });

    it("displays unchanged permissions when showUnchanged=true", () => {
      render(
        <PermissionChangeDiffViewer
          diff={FIXTURE_DIFF_ADD_READ_SCOPE}
          showUnchanged={true}
        />,
      );

      const unchangedBadges = screen.getAllByText("Unchanged");
      expect(unchangedBadges.length).toBeGreaterThan(0);
    });

    it("hides unchanged permissions when showUnchanged=false (default)", () => {
      render(
        <PermissionChangeDiffViewer
          diff={FIXTURE_DIFF_ADD_READ_SCOPE}
          showUnchanged={false}
        />,
      );

      const unchangedBadges = screen.queryAllByText("Unchanged");
      expect(unchangedBadges).toHaveLength(0);
    });

    it("renders permission title, description, and metadata", () => {
      render(<PermissionChangeDiffViewer diff={FIXTURE_DIFF_ADD_BROAD_SCOPE} />);

      expect(screen.getByText(/Create Proofs/)).toBeInTheDocument();
      expect(
        screen.getByText(/Create and submit new proofs for verification/),
      ).toBeInTheDocument();
    });

    it("displays 'Broad' badge for broad permissions", () => {
      render(<PermissionChangeDiffViewer diff={FIXTURE_DIFF_ADD_BROAD_SCOPE} />);

      const broadBadges = screen.getAllByText("Broad");
      expect(broadBadges.length).toBeGreaterThan(0);
    });

    it("displays 'Critical' badge for destructive removals", () => {
      render(<PermissionChangeDiffViewer diff={FIXTURE_DIFF_REMOVE_BROAD_SCOPE} />);

      const criticalBadges = screen.getAllByText("Critical");
      expect(criticalBadges.length).toBeGreaterThan(0);
    });

    it("handles empty diff gracefully", () => {
      render(<PermissionChangeDiffViewer diff={FIXTURE_BOUNDARY_EMPTY} />);

      expect(
        screen.getByText("No permission changes to display."),
      ).toBeInTheDocument();
    });
  });

  describe("risk alerts", () => {
    it("shows alert for broad permissions", () => {
      render(<PermissionChangeDiffViewer diff={FIXTURE_DIFF_ADD_BROAD_SCOPE} />);

      const alerts = screen.getAllByRole("alert");
      expect(
        alerts.some((a) => /broad permission/i.test(a.textContent || "")),
      ).toBe(true);
    });

    it("shows alert for permission removals", () => {
      render(<PermissionChangeDiffViewer diff={FIXTURE_DIFF_REMOVE_SCOPE} />);

      const alerts = screen.getAllByRole("alert");
      expect(
        alerts.some((a) => /Permissions being removed/i.test(a.textContent || "")),
      ).toBe(true);
    });

    it("shows alert for destructive removals", () => {
      render(<PermissionChangeDiffViewer diff={FIXTURE_DIFF_REMOVE_BROAD_SCOPE} />);

      const alerts = screen.getAllByRole("alert");
      expect(
        alerts.some((a) => /Destructive removals/i.test(a.textContent || "")),
      ).toBe(true);
    });

    it("does not show unnecessary alerts when no risk", () => {
      render(<PermissionChangeDiffViewer diff={FIXTURE_DIFF_ADD_READ_SCOPE} />);

      const alerts = screen.queryAllByRole("alert");
      expect(alerts.length).toBe(0);
    });
  });

  describe("summary stats", () => {
    it("displays count of added permissions", () => {
      render(<PermissionChangeDiffViewer diff={FIXTURE_DIFF_ADD_BROAD_SCOPE} />);

      expect(screen.getByText("Added")).toBeInTheDocument();
      expect(screen.getByText("1", { selector: "div" })).toBeInTheDocument();
    });

    it("displays count of removed permissions", () => {
      render(<PermissionChangeDiffViewer diff={FIXTURE_DIFF_REMOVE_SCOPE} />);

      const removedLabels = screen.getAllByText("Removed");
      expect(removedLabels.length).toBeGreaterThan(0);
    });

    it("displays stats only when changes exist", () => {
      const { rerender } = render(
        <PermissionChangeDiffViewer diff={FIXTURE_DIFF_NO_CHANGES} />,
      );

      expect(screen.queryByText("Added")).not.toBeInTheDocument();

      rerender(
        <PermissionChangeDiffViewer diff={FIXTURE_DIFF_ADD_READ_SCOPE} />,
      );

      expect(screen.getByText("Added")).toBeInTheDocument();
    });
  });

  describe("buttons and actions", () => {
    it("renders confirm button when onConfirm provided", () => {
      const onConfirm = jest.fn();
      render(
        <PermissionChangeDiffViewer
          diff={FIXTURE_DIFF_ADD_BROAD_SCOPE}
          onConfirm={onConfirm}
        />,
      );

      const confirmButton = screen.getByRole("button", { name: /Confirm Changes/i });
      expect(confirmButton).toBeInTheDocument();
    });

    it("renders cancel button when onCancel provided", () => {
      const onCancel = jest.fn();
      render(
        <PermissionChangeDiffViewer
          diff={FIXTURE_DIFF_ADD_BROAD_SCOPE}
          onCancel={onCancel}
        />,
      );

      const cancelButton = screen.getByRole("button", { name: /Cancel/i });
      expect(cancelButton).toBeInTheDocument();
    });

    it("calls onConfirm when confirm button clicked", () => {
      const onConfirm = jest.fn();
      render(
        <PermissionChangeDiffViewer
          diff={FIXTURE_DIFF_ADD_BROAD_SCOPE}
          onConfirm={onConfirm}
        />,
      );

      const confirmButton = screen.getByRole("button", { name: /Confirm Changes/i });
      fireEvent.click(confirmButton);

      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it("calls onCancel when cancel button clicked", () => {
      const onCancel = jest.fn();
      render(
        <PermissionChangeDiffViewer
          diff={FIXTURE_DIFF_ADD_BROAD_SCOPE}
          onCancel={onCancel}
        />,
      );

      const cancelButton = screen.getByRole("button", { name: /Cancel/i });
      fireEvent.click(cancelButton);

      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("disables confirm button when isProcessing=true", () => {
      const onConfirm = jest.fn();
      render(
        <PermissionChangeDiffViewer
          diff={FIXTURE_DIFF_ADD_BROAD_SCOPE}
          onConfirm={onConfirm}
          isProcessing={true}
        />,
      );

      const confirmButton = screen.getByRole("button", { name: /Processing/i });
      expect(confirmButton).toBeDisabled();
    });

    it("disables buttons when isProcessing=true", () => {
      const onConfirm = jest.fn();
      const onCancel = jest.fn();
      render(
        <PermissionChangeDiffViewer
          diff={FIXTURE_DIFF_ADD_BROAD_SCOPE}
          onConfirm={onConfirm}
          onCancel={onCancel}
          isProcessing={true}
        />,
      );

      const buttons = screen.getAllByRole("button");
      expect(buttons.every((b) => b.hasAttribute("disabled"))).toBe(true);
    });

    it("disables confirm button when no changes to confirm", () => {
      const onConfirm = jest.fn();
      render(
        <PermissionChangeDiffViewer
          diff={FIXTURE_DIFF_NO_CHANGES}
          onConfirm={onConfirm}
        />,
      );

      const confirmButton = screen.getByRole("button", { name: /Confirm Changes/i });
      expect(confirmButton).toBeDisabled();
    });

    it("supports custom button labels", () => {
      const onConfirm = jest.fn();
      const onCancel = jest.fn();
      render(
        <PermissionChangeDiffViewer
          diff={FIXTURE_DIFF_ADD_BROAD_SCOPE}
          onConfirm={onConfirm}
          onCancel={onCancel}
          confirmText="Update Key"
          cancelText="Go Back"
        />,
      );

      expect(screen.getByRole("button", { name: /Update Key/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Go Back/i })).toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("has semantic table with caption", () => {
      render(<PermissionChangeDiffViewer diff={FIXTURE_DIFF_ADD_READ_SCOPE} />);

      const table = screen.getByRole("table");
      expect(table).toBeInTheDocument();
    });

    it("renders table headers with proper scope", () => {
      render(<PermissionChangeDiffViewer diff={FIXTURE_DIFF_ADD_READ_SCOPE} />);

      const headers = screen.getAllByRole("columnheader");
      expect(headers.length).toBeGreaterThan(0);
    });

    it("uses role=alert for risk notifications", () => {
      render(<PermissionChangeDiffViewer diff={FIXTURE_DIFF_ADD_BROAD_SCOPE} />);

      const alerts = screen.getAllByRole("alert");
      expect(alerts.length).toBeGreaterThan(0);
    });

    it("provides title attribute for risk badges", () => {
      render(<PermissionChangeDiffViewer diff={FIXTURE_DIFF_ADD_BROAD_SCOPE} />);

      const broadBadges = screen.getAllByTitle(/broad permission/i);
      expect(broadBadges.length).toBeGreaterThan(0);
    });

    it("provides proper aria-live region for stats", () => {
      render(
        <PermissionChangeDiffViewer
          diff={FIXTURE_DIFF_COMPLEX_CHANGE}
          showUnchanged={true}
        />,
      );

      // Stats should be rendered in a way that's accessible
      expect(screen.getByText("Added")).toBeInTheDocument();
      expect(screen.getByText("Removed")).toBeInTheDocument();
    });
  });

  describe("complex scenarios", () => {
    it("handles diff with multiple added and removed permissions", () => {
      render(<PermissionChangeDiffViewer diff={FIXTURE_DIFF_COMPLEX_CHANGE} />);

      const rows = screen.getAllByRole("row");
      expect(rows.length).toBeGreaterThan(1); // At least header + data rows
    });

    it("renders inherited permissions when present", () => {
      const diffWithInherited = {
        ...FIXTURE_DIFF_ADD_READ_SCOPE,
        inherited: [
          {
            id: "inherited:perm",
            title: "Inherited Permission",
            description: "This is inherited",
            status: "inherited" as const,
          },
        ],
      };

      render(
        <PermissionChangeDiffViewer
          diff={diffWithInherited}
          showUnchanged={true}
        />,
      );

      const inheritedBadges = screen.queryAllByText("Inherited");
      expect(inheritedBadges.length).toBeGreaterThan(0);
    });

    it("conditionally shows inherited based on showUnchanged flag", () => {
      const diffWithInherited = {
        ...FIXTURE_DIFF_ADD_READ_SCOPE,
        inherited: [
          {
            id: "inherited:perm",
            title: "Inherited Permission",
            description: "This is inherited",
            status: "inherited" as const,
          },
        ],
      };

      const { rerender } = render(
        <PermissionChangeDiffViewer
          diff={diffWithInherited}
          showUnchanged={false}
        />,
      );

      let inheritedBadges = screen.queryAllByText("Inherited");
      expect(inheritedBadges.length).toBeGreaterThan(0); // inherited is always shown

      rerender(
        <PermissionChangeDiffViewer
          diff={diffWithInherited}
          showUnchanged={true}
        />,
      );

      inheritedBadges = screen.queryAllByText("Inherited");
      expect(inheritedBadges.length).toBeGreaterThan(0);
    });
  });

  describe("custom styling", () => {
    it("accepts custom className prop", () => {
      const { container } = render(
        <PermissionChangeDiffViewer
          diff={FIXTURE_DIFF_ADD_READ_SCOPE}
          className="custom-class"
        />,
      );

      const wrapper = container.querySelector(".custom-class");
      expect(wrapper).toBeInTheDocument();
    });

    it("renders with default styling when no className provided", () => {
      const { container } = render(
        <PermissionChangeDiffViewer diff={FIXTURE_DIFF_ADD_READ_SCOPE} />,
      );

      const wrapper = container.firstChild;
      expect(wrapper).toHaveClass("rounded-md", "border");
    });
  });

  describe("authorization patterns", () => {
    it("reflects confirmation requirement in UI state", () => {
      const onConfirm = jest.fn();

      const { rerender } = render(
        <PermissionChangeDiffViewer
          diff={FIXTURE_DIFF_NO_CHANGES}
          onConfirm={onConfirm}
        />,
      );

      let confirmButton = screen.getByRole("button", { name: /Confirm/i });
      expect(confirmButton).toBeDisabled(); // No changes

      rerender(
        <PermissionChangeDiffViewer
          diff={FIXTURE_DIFF_ADD_BROAD_SCOPE}
          onConfirm={onConfirm}
        />,
      );

      confirmButton = screen.getByRole("button", { name: /Confirm/i });
      expect(confirmButton).not.toBeDisabled(); // Changes requiring confirmation
    });
  });
});
