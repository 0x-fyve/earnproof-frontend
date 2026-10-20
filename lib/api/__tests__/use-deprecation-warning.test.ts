/**
 * @jest-environment jsdom
 */

import { renderHook, act } from "@testing-library/react";
import {
  __resetDeprecationWarningStateForTests,
  dismissDeprecationWarning,
  recordDeprecationWarning,
  useDeprecationWarning,
} from "../use-deprecation-warning";
import type { ParsedDeprecationWarning } from "../deprecation-warnings";

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

describe("useDeprecationWarning", () => {
  it("returns null before any warning is recorded", () => {
    const { result } = renderHook(() => useDeprecationWarning());
    expect(result.current).toBeNull();
  });

  it("returns the recorded warning after recordDeprecationWarning is called", () => {
    const { result } = renderHook(() => useDeprecationWarning());
    act(() => {
      recordDeprecationWarning(warning());
    });
    expect(result.current).not.toBeNull();
    expect(result.current?.apiVersion).toBe("v1");
  });

  it("returns null after dismissDeprecationWarning is called", () => {
    const { result } = renderHook(() => useDeprecationWarning());
    act(() => {
      recordDeprecationWarning(warning());
    });
    act(() => {
      dismissDeprecationWarning();
    });
    expect(result.current).toBeNull();
  });
});

describe("recordDeprecationWarning — suppression by (apiVersion, sunsetAt)", () => {
  it("suppresses a repeated notice for the exact same pair after dismissal", () => {
    const { result } = renderHook(() => useDeprecationWarning());
    const pair = warning({ apiVersion: "v1", sunsetAt: new Date("2026-12-31T00:00:00Z") });

    act(() => {
      recordDeprecationWarning(pair);
    });
    act(() => {
      dismissDeprecationWarning();
    });
    expect(result.current).toBeNull();

    act(() => {
      recordDeprecationWarning(pair);
    });
    // Same (version, deadline) pair recorded again after being
    // dismissed once — must stay suppressed, not pop back up.
    expect(result.current).toBeNull();
  });

  it("does not suppress a warning with a different sunset deadline on the same API version", () => {
    const { result } = renderHook(() => useDeprecationWarning());
    const original = warning({ apiVersion: "v1", sunsetAt: new Date("2026-12-31T00:00:00Z") });

    act(() => {
      recordDeprecationWarning(original);
    });
    act(() => {
      dismissDeprecationWarning();
    });

    const pushedBack = warning({ apiVersion: "v1", sunsetAt: new Date("2027-06-30T00:00:00Z") });
    act(() => {
      recordDeprecationWarning(pushedBack);
    });

    expect(result.current).not.toBeNull();
    expect(result.current?.sunsetAt).toEqual(new Date("2027-06-30T00:00:00Z"));
  });

  it("does not suppress a warning for a different API version with the same deadline", () => {
    const { result } = renderHook(() => useDeprecationWarning());
    const v1 = warning({ apiVersion: "v1", sunsetAt: new Date("2026-12-31T00:00:00Z") });

    act(() => {
      recordDeprecationWarning(v1);
    });
    act(() => {
      dismissDeprecationWarning();
    });

    const v2 = warning({ apiVersion: "v2", sunsetAt: new Date("2026-12-31T00:00:00Z") });
    act(() => {
      recordDeprecationWarning(v2);
    });

    expect(result.current).not.toBeNull();
    expect(result.current?.apiVersion).toBe("v2");
  });

  it("does not suppress at all before any dismissal has happened", () => {
    const { result } = renderHook(() => useDeprecationWarning());
    const pair = warning();

    act(() => {
      recordDeprecationWarning(pair);
    });
    expect(result.current).not.toBeNull();

    // Recording again (no dismissal in between) should simply update,
    // not be blocked — suppression only kicks in after an explicit
    // dismiss.
    act(() => {
      recordDeprecationWarning(pair);
    });
    expect(result.current).not.toBeNull();
  });
});
