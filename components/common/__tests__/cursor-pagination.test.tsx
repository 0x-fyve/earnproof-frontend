/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { CursorPagination, PaginationState } from "../cursor-pagination";

describe("CursorPagination", () => {
  describe("Happy Path", () => {
    it("renders pagination controls correctly", () => {
      const state: PaginationState = {
        nextCursor: "cursor_next_123",
        previousCursor: "cursor_prev_456",
        isLoading: false,
      };

      const { container } = render(
        <CursorPagination
          state={state}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          resultCount={25}
        />
      );

      expect(screen.getByText("Previous")).toBeInTheDocument();
      expect(screen.getByText("Next")).toBeInTheDocument();
      expect(screen.getByText("25")).toBeInTheDocument();
      expect(container.textContent).toMatch(/Showing.*25.*results/);
    });

    it("calls onNext when Next button is clicked and hasNext is true", () => {
      const onNext = jest.fn();
      const state: PaginationState = {
        nextCursor: "cursor_next_123",
        previousCursor: null,
        isLoading: false,
      };

      render(
        <CursorPagination
          state={state}
          onPrevious={jest.fn()}
          onNext={onNext}
        />
      );

      fireEvent.click(screen.getByText("Next"));
      expect(onNext).toHaveBeenCalledTimes(1);
    });

    it("calls onPrevious when Previous button is clicked and hasPrevious is true", () => {
      const onPrevious = jest.fn();
      const state: PaginationState = {
        nextCursor: null,
        previousCursor: "cursor_prev_456",
        isLoading: false,
      };

      render(
        <CursorPagination
          state={state}
          onPrevious={onPrevious}
          onNext={jest.fn()}
        />
      );

      fireEvent.click(screen.getByText("Previous"));
      expect(onPrevious).toHaveBeenCalledTimes(1);
    });

    it("displays correct result count", () => {
      const state: PaginationState = {
        nextCursor: null,
        previousCursor: null,
        isLoading: false,
      };

      const { container } = render(
        <CursorPagination
          state={state}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          resultCount={42}
        />
      );

      expect(screen.getByText("42")).toBeInTheDocument();
      expect(container.textContent).toMatch(/Showing.*42.*results/);
    });

    it("displays singular 'result' when count is 1", () => {
      const state: PaginationState = {
        nextCursor: null,
        previousCursor: null,
        isLoading: false,
      };

      const { container } = render(
        <CursorPagination
          state={state}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          resultCount={1}
        />
      );

      expect(screen.getByText("1")).toBeInTheDocument();
      expect(container.textContent).toMatch(/Showing.*1.*result[^s]/);
    });

    it("has correct ARIA labels", () => {
      const state: PaginationState = {
        nextCursor: "cursor_next",
        previousCursor: "cursor_prev",
        isLoading: false,
      };

      render(
        <CursorPagination
          state={state}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
        />
      );

      expect(screen.getByLabelText("Previous page")).toBeInTheDocument();
      expect(screen.getByLabelText("Next page")).toBeInTheDocument();
    });
  });

  describe("Edge Cases", () => {
    it("disables Previous button when no previousCursor", () => {
      const state: PaginationState = {
        nextCursor: "cursor_next",
        previousCursor: null,
        isLoading: false,
      };

      render(
        <CursorPagination
          state={state}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
        />
      );

      expect(screen.getByLabelText("Previous page")).toBeDisabled();
    });

    it("disables Next button when no nextCursor", () => {
      const state: PaginationState = {
        nextCursor: null,
        previousCursor: "cursor_prev",
        isLoading: false,
      };

      render(
        <CursorPagination
          state={state}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
        />
      );

      expect(screen.getByLabelText("Next page")).toBeDisabled();
    });

    it("displays 'No results' when resultCount is 0", () => {
      const state: PaginationState = {
        nextCursor: null,
        previousCursor: null,
        isLoading: false,
      };

      render(
        <CursorPagination
          state={state}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          resultCount={0}
        />
      );

      expect(screen.getByText("No results")).toBeInTheDocument();
    });

    it("disables all buttons when loading", () => {
      const state: PaginationState = {
        nextCursor: "cursor_next",
        previousCursor: "cursor_prev",
        isLoading: true,
      };

      render(
        <CursorPagination
          state={state}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
        />
      );

      expect(screen.getByLabelText("Previous page")).toBeDisabled();
      expect(screen.getByLabelText("Next page")).toBeDisabled();
    });

    it("handles single-page result set", () => {
      const state: PaginationState = {
        nextCursor: null,
        previousCursor: null,
        isLoading: false,
      };

      const { container } = render(
        <CursorPagination
          state={state}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          resultCount={5}
        />
      );

      expect(screen.getByLabelText("Previous page")).toBeDisabled();
      expect(screen.getByLabelText("Next page")).toBeDisabled();
      expect(screen.getByText("5")).toBeInTheDocument();
      expect(container.textContent).toMatch(/Showing.*5.*results/);
    });
  });

  describe("Negative Tests", () => {
    it("does not call onNext when loading", () => {
      const onNext = jest.fn();
      const state: PaginationState = {
        nextCursor: "cursor_next",
        previousCursor: null,
        isLoading: true,
      };

      render(
        <CursorPagination
          state={state}
          onPrevious={jest.fn()}
          onNext={onNext}
        />
      );

      fireEvent.click(screen.getByLabelText("Next page"));
      expect(onNext).not.toHaveBeenCalled();
    });

    it("does not call onPrevious when loading", () => {
      const onPrevious = jest.fn();
      const state: PaginationState = {
        nextCursor: null,
        previousCursor: "cursor_prev",
        isLoading: true,
      };

      render(
        <CursorPagination
          state={state}
          onPrevious={onPrevious}
          onNext={jest.fn()}
        />
      );

      fireEvent.click(screen.getByLabelText("Previous page"));
      expect(onPrevious).not.toHaveBeenCalled();
    });

    it("does not call onNext when no nextCursor", () => {
      const onNext = jest.fn();
      const state: PaginationState = {
        nextCursor: null,
        previousCursor: "cursor_prev",
        isLoading: false,
      };

      render(
        <CursorPagination
          state={state}
          onPrevious={jest.fn()}
          onNext={onNext}
        />
      );

      fireEvent.click(screen.getByLabelText("Next page"));
      expect(onNext).not.toHaveBeenCalled();
    });

    it("does not call onPrevious when no previousCursor", () => {
      const onPrevious = jest.fn();
      const state: PaginationState = {
        nextCursor: "cursor_next",
        previousCursor: null,
        isLoading: false,
      };

      render(
        <CursorPagination
          state={state}
          onPrevious={onPrevious}
          onNext={jest.fn()}
        />
      );

      fireEvent.click(screen.getByLabelText("Previous page"));
      expect(onPrevious).not.toHaveBeenCalled();
    });

    it("handles missing cursor values safely", () => {
      const state: PaginationState = {
        nextCursor: null,
        previousCursor: null,
        isLoading: false,
      };

      const { container } = render(
        <CursorPagination
          state={state}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
        />
      );

      // Should render without crashing
      expect(container).toBeInTheDocument();
    });

    it("does not crash with invalid state", () => {
      const state: PaginationState = {
        nextCursor: null,
        previousCursor: null,
        isLoading: false,
      };

      const { container } = render(
        <CursorPagination
          state={state}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          resultCount={-1} // Invalid but should not crash
        />
      );

      expect(container).toBeInTheDocument();
    });
  });

  describe("Cursor Recovery Notice", () => {
    const state: PaginationState = {
      nextCursor: null,
      previousCursor: null,
      isLoading: false,
    };

    it("renders nothing when notice is null", () => {
      const { container } = render(
        <CursorPagination
          state={state}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
        />
      );
      expect(container.querySelector('[role="status"]')).toBeNull();
    });

    it("renders the recovery message and support reference", () => {
      render(
        <CursorPagination
          state={state}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          notice={{
            message: "Your page position expired. Restarted from the first page.",
            supportReference: "Cursor recovery: cursor_expired",
          }}
        />
      );
      expect(screen.getByText(/Your page position expired/)).toBeInTheDocument();
      expect(screen.getByText(/Cursor recovery: cursor_expired/)).toBeInTheDocument();
    });

    it("exposes the notice as a polite status region", () => {
      render(
        <CursorPagination
          state={state}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          notice={{ message: "Restarted." }}
        />
      );
      const region = screen.getByRole("status");
      expect(region).toHaveAttribute("aria-live", "polite");
    });
  });
});
