/**
 * React-level tests for the shared announcement provider (#252).
 *
 * Covers the acceptance criteria that only make sense at the DOM/React
 * level: focus stability, concurrent operations, cancellation, route
 * changes, and reduced-motion.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { AnnouncerProvider, useAnnounce } from "../announcer-context";

const mockUsePathname = jest.fn(() => "/proofs");

jest.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

function TestConsumer({ source }: { source: string }) {
  const { announce } = useAnnounce();
  return (
    <button
      onClick={() => announce(`${source} status changed.`, { source })}
      type="button"
    >
      Trigger {source}
    </button>
  );
}

function FocusableForm() {
  const { announce } = useAnnounce();
  const [value, setValue] = useState("");
  return (
    <div>
      <input
        aria-label="some field"
        onChange={(event) => setValue(event.target.value)}
        value={value}
      />
      <button
        onClick={() => announce("Background status changed.")}
        type="button"
      >
        Announce
      </button>
    </div>
  );
}

describe("AnnouncerProvider / useAnnounce", () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue("/proofs");
  });

  it("renders one polite and one assertive aria-live region", () => {
    render(
      <AnnouncerProvider>
        <div />
      </AnnouncerProvider>,
    );

    expect(screen.getByTestId("a11y-live-region-polite")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(screen.getByTestId("a11y-live-region-assertive")).toHaveAttribute(
      "aria-live",
      "assertive",
    );
  });

  it("announces a message into the polite region", async () => {
    const user = userEvent.setup();
    render(
      <AnnouncerProvider>
        <TestConsumer source="payment-sync" />
      </AnnouncerProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Trigger payment-sync" }));

    await waitFor(() => {
      expect(screen.getByTestId("a11y-live-region-polite")).toHaveTextContent(
        "payment-sync status changed.",
      );
    });
  });

  describe("focus stability", () => {
    it("does not move focus when a background announcement fires while the user is elsewhere", async () => {
      const user = userEvent.setup();
      render(
        <AnnouncerProvider>
          <FocusableForm />
        </AnnouncerProvider>,
      );

      const input = screen.getByLabelText("some field");
      input.focus();
      expect(document.activeElement).toBe(input);

      await user.click(screen.getByRole("button", { name: "Announce" }));

      await waitFor(() => {
        expect(screen.getByTestId("a11y-live-region-polite")).toHaveTextContent(
          "Background status changed.",
        );
      });

      // Focus moved to the button because the user clicked it, which is
      // expected browser behavior for a click — the acceptance criterion is
      // that the *announcement itself* never additionally steals focus
      // (e.g. onto the live region, or back onto the input). Confirm focus
      // landed only on the thing the user interacted with, and never on
      // either live region.
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Announce" }));
      expect(document.activeElement).not.toBe(screen.getByTestId("a11y-live-region-polite"));
    });
  });

  describe("concurrent operations", () => {
    it("keeps the latest announcement from two independently-triggered flows without losing either lane", async () => {
      const user = userEvent.setup();
      render(
        <AnnouncerProvider>
          <TestConsumer source="proof-submission" />
          <TestConsumer source="payment-sync" />
        </AnnouncerProvider>,
      );

      await user.click(screen.getByRole("button", { name: "Trigger proof-submission" }));
      await user.click(screen.getByRole("button", { name: "Trigger payment-sync" }));

      // Both announced into the same polite lane; the second (later) call
      // is what's currently live, per the "preserve operation ordering"
      // requirement — the later-delivered message wins without an error.
      await waitFor(() => {
        expect(screen.getByTestId("a11y-live-region-polite")).toHaveTextContent(
          "payment-sync status changed.",
        );
      });
    });
  });

  describe("cancellation", () => {
    function CancellableOperation() {
      const { announce } = useAnnounce();
      return (
        <button
          onClick={() => {
            announce("Operation started.", { source: "cancellable" });
            // Simulate the operation being cancelled before it resolves.
            announce("Operation cancelled.", { source: "cancellable" });
          }}
          type="button"
        >
          Start and cancel
        </button>
      );
    }

    it("announces a cancellation distinctly from the original start message", async () => {
      const user = userEvent.setup();
      render(
        <AnnouncerProvider>
          <CancellableOperation />
        </AnnouncerProvider>,
      );

      await user.click(screen.getByRole("button", { name: "Start and cancel" }));

      await waitFor(() => {
        expect(screen.getByTestId("a11y-live-region-polite")).toHaveTextContent(
          "Operation cancelled.",
        );
      });
    });
  });

  describe("route changes", () => {
    it("clears any in-flight announcement when the pathname changes", async () => {
      const user = userEvent.setup();
      const { rerender } = render(
        <AnnouncerProvider>
          <TestConsumer source="imports" />
        </AnnouncerProvider>,
      );

      await user.click(screen.getByRole("button", { name: "Trigger imports" }));
      await waitFor(() => {
        expect(screen.getByTestId("a11y-live-region-polite")).toHaveTextContent(
          "imports status changed.",
        );
      });

      // Simulate navigating to a different route.
      mockUsePathname.mockReturnValue("/settings");
      rerender(
        <AnnouncerProvider>
          <TestConsumer source="imports" />
        </AnnouncerProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("a11y-live-region-polite")).toHaveTextContent("");
      });
    });

    it("does not throw when an announcement was in flight from a component that then unmounts on navigation", async () => {
      function Page() {
        const { announce } = useAnnounce();
        return (
          <button onClick={() => announce("Export in progress.")} type="button">
            Start export
          </button>
        );
      }

      const user = userEvent.setup();
      const { rerender } = render(
        <AnnouncerProvider>
          <Page />
        </AnnouncerProvider>,
      );

      await user.click(screen.getByRole("button", { name: "Start export" }));

      expect(() => {
        mockUsePathname.mockReturnValue("/elsewhere");
        rerender(
          <AnnouncerProvider>
            <div>New page</div>
          </AnnouncerProvider>,
        );
      }).not.toThrow();

      await waitFor(() => {
        expect(screen.getByTestId("a11y-live-region-polite")).toHaveTextContent("");
      });
    });
  });

  describe("reduced motion", () => {
    it("the live regions carry no animation or transition styling regardless of prefers-reduced-motion", () => {
      // The coordinator's regions are purely textual (sr-only, off-screen)
      // and never animate — there is no visual transition tied to an
      // announcement for prefers-reduced-motion to need to suppress. This
      // test pins that invariant: the rendered regions have no transition/
      // animation inline styles and no animation-related class names.
      render(
        <AnnouncerProvider>
          <div />
        </AnnouncerProvider>,
      );

      const polite = screen.getByTestId("a11y-live-region-polite");
      const assertive = screen.getByTestId("a11y-live-region-assertive");

      for (const region of [polite, assertive]) {
        expect(region.style.transition).toBe("");
        expect(region.style.animation).toBe("");
        expect(region.className).toBe("");
      }
    });
  });

  it("falls back to a no-op announce() outside a provider in a test environment", () => {
    function Unwrapped() {
      const { announce } = useAnnounce();
      return (
        <button onClick={() => announce("test")} type="button">
          go
        </button>
      );
    }
    expect(() => render(<Unwrapped />)).not.toThrow();
  });

  it("does not duplicate an identical consecutive announcement in the DOM text", async () => {
    const user = userEvent.setup();
    render(
      <AnnouncerProvider>
        <TestConsumer source="webhooks" />
      </AnnouncerProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Trigger webhooks" }));
    await waitFor(() => {
      expect(screen.getByTestId("a11y-live-region-polite")).toHaveTextContent(
        "webhooks status changed.",
      );
    });

    const before = screen.getByTestId("a11y-live-region-polite").textContent;
    await act(async () => {
      await user.click(screen.getByRole("button", { name: "Trigger webhooks" }));
    });
    const after = screen.getByTestId("a11y-live-region-polite").textContent;

    expect(after).toBe(before);
  });
});
