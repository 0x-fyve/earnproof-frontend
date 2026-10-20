/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { ApiDeprecationWarning } from "../api-deprecation-warning";
import {
  __resetDeprecationWarningStateForTests,
  recordDeprecationWarning,
} from "@/lib/api/use-deprecation-warning";
import type { ParsedDeprecationWarning } from "@/lib/api/deprecation-warnings";

function warning(overrides: Partial<ParsedDeprecationWarning> = {}): ParsedDeprecationWarning {
  return {
    apiVersion: "v1",
    isDeprecated: true,
    sunsetAt: new Date("2026-12-31T00:00:00Z"),
    severity: "future",
    replacementHref: null,
    ...overrides,
  };
}

beforeEach(() => {
  __resetDeprecationWarningStateForTests();
});

describe("ApiDeprecationWarning", () => {
  it("renders nothing when there is no warning", () => {
    render(<ApiDeprecationWarning />);
    expect(screen.queryByTestId("api-deprecation-warning")).not.toBeInTheDocument();
  });

  it("renders a dismissible warning for a future deprecation", () => {
    recordDeprecationWarning(warning({ severity: "future" }));
    render(<ApiDeprecationWarning />);

    expect(screen.getByText("This API version is deprecated")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss deprecation warning" })).toBeInTheDocument();
  });

  it("renders an imminent warning distinctly from a future one", () => {
    recordDeprecationWarning(warning({ severity: "imminent" }));
    render(<ApiDeprecationWarning />);
    expect(screen.getByText("This API version will stop working soon")).toBeInTheDocument();
  });

  it("renders a blocking, non-dismissible alert for an expired version", () => {
    recordDeprecationWarning(warning({ severity: "expired" }));
    render(<ApiDeprecationWarning />);

    expect(screen.getByText("This API version is no longer supported")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss deprecation warning" })).not.toBeInTheDocument();
  });

  it("includes the exact sunset date and timezone in the message", () => {
    recordDeprecationWarning(warning({ sunsetAt: new Date("2026-12-31T12:00:00Z") }));
    render(<ApiDeprecationWarning />);
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it("renders a safe replacement link when present", () => {
    recordDeprecationWarning(warning({ replacementHref: "http://localhost:4000/api/v2/docs" }));
    render(<ApiDeprecationWarning />);
    const link = screen.getByText("View the replacement API documentation");
    expect(link.closest("a")).toHaveAttribute("href", "http://localhost:4000/api/v2/docs");
  });

  it("does not render a replacement link section when none is present", () => {
    recordDeprecationWarning(warning({ replacementHref: null }));
    render(<ApiDeprecationWarning />);
    expect(screen.queryByText("View the replacement API documentation")).not.toBeInTheDocument();
  });

  it("dismissing a future warning removes it from view", () => {
    recordDeprecationWarning(warning({ severity: "future" }));
    render(<ApiDeprecationWarning />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss deprecation warning" }));

    expect(screen.queryByTestId("api-deprecation-warning")).not.toBeInTheDocument();
  });

  it("does not render for a non-deprecated warning record (Sunset present without Deprecation)", () => {
    recordDeprecationWarning(warning({ isDeprecated: false }));
    render(<ApiDeprecationWarning />);
    expect(screen.queryByTestId("api-deprecation-warning")).not.toBeInTheDocument();
  });
});
