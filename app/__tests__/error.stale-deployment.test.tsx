import { render, screen, fireEvent } from "@testing-library/react";
import ErrorPage from "../error";
import {
  clearReloadGuard,
  hasAlreadyAttemptedReload,
  markReloadAttempted,
} from "@/lib/diagnostics/stale-deployment";

jest.mock("next/navigation", () => ({
  usePathname: () => "/proofs",
}));

jest.mock("next/link", () => {
  return function MockLink({ children, href }: { children: React.ReactNode; href: string }) {
    return <a href={href}>{children}</a>;
  };
});

const originalConsoleError = console.error;
beforeAll(() => {
  console.error = jest.fn();
});
afterAll(() => {
  console.error = originalConsoleError;
});

beforeEach(() => {
  clearReloadGuard();
});

function chunkLoadError(message = "Loading chunk 5 failed."): Error {
  const err = new Error(message);
  err.name = "ChunkLoadError";
  return err;
}

describe("ErrorPage — stale deployment / chunk-load recovery (#227)", () => {
  it("shows the stale-deployment recovery UI for a recognized chunk-load error", () => {
    render(<ErrorPage error={chunkLoadError()} reset={jest.fn()} />);

    expect(screen.getByText("A new version is available")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("falls back to the standard error boundary for an unrelated error (disabled for unrelated runtime errors)", () => {
    render(<ErrorPage error={new Error("Cannot read properties of undefined")} reset={jest.fn()} />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByText("A new version is available")).not.toBeInTheDocument();
  });

  it("reloading marks the reload as attempted (loop-prevention guard engages) and does not throw", () => {
    // jsdom's window.location cannot be mocked/redefined in this project's
    // test environment, so the actual URL built for navigation is covered
    // directly in lib/diagnostics/__tests__/stale-deployment.test.ts
    // (buildSafeReloadUrl's "pathname only, no query/hash/tokens" tests).
    // This test instead confirms the click handler actually runs through
    // to completion and engages the loop guard, without asserting on
    // window.location itself.
    expect(hasAlreadyAttemptedReload()).toBe(false);

    render(<ErrorPage error={chunkLoadError()} reset={jest.fn()} />);
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Reload page" }))).not.toThrow();

    expect(hasAlreadyAttemptedReload()).toBe(true);
  });

  it("falls back to the standard error boundary on a repeated failure (loop prevention)", () => {
    markReloadAttempted();

    render(<ErrorPage error={chunkLoadError()} reset={jest.fn()} />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByText("A new version is available")).not.toBeInTheDocument();
  });

  it("falls back to the standard error boundary when offline (reload would not help)", () => {
    const originalOnLine = Object.getOwnPropertyDescriptor(window.navigator, "onLine");
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });

    render(<ErrorPage error={chunkLoadError()} reset={jest.fn()} />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    Object.defineProperty(
      window.navigator,
      "onLine",
      originalOnLine ?? { value: true, configurable: true },
    );
  });

  it("dismissing the recovery UI calls reset() like the standard boundary's Try again", () => {
    const mockReset = jest.fn();
    render(<ErrorPage error={chunkLoadError()} reset={mockReset} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it("recognizes a dynamic-import failure message as well as ChunkLoadError", () => {
    render(
      <ErrorPage
        error={new Error("Failed to fetch dynamically imported module: /chunks/foo.js")}
        reset={jest.fn()}
      />,
    );
    expect(screen.getByText("A new version is available")).toBeInTheDocument();
  });
});
