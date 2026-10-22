/**
 * Tests for bfcache-guard:
 * - pageshow with event.persisted === true triggers revalidation
 * - pageshow with event.persisted === false (a normal navigation) is a no-op
 * - unsubscribe removes both listeners
 * - SSR (no window) is a no-op, not a throw
 */

import { installBfcacheGuard } from "../bfcache-guard";

function dispatchPageShow(persisted: boolean) {
  const event = new Event("pageshow") as PageTransitionEvent & {
    persisted: boolean;
  };
  Object.defineProperty(event, "persisted", { value: persisted });
  window.dispatchEvent(event);
}

describe("installBfcacheGuard", () => {
  it("calls onRestore when the page is restored from bfcache", () => {
    const onRestore = jest.fn();
    const uninstall = installBfcacheGuard({ onRestore });

    dispatchPageShow(true);

    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledWith("bfcache_restored");

    uninstall();
  });

  it("does not call onRestore for an ordinary (non-bfcache) pageshow", () => {
    const onRestore = jest.fn();
    const uninstall = installBfcacheGuard({ onRestore });

    dispatchPageShow(false);

    expect(onRestore).not.toHaveBeenCalled();

    uninstall();
  });

  it("stops listening after the returned unsubscribe function runs", () => {
    const onRestore = jest.fn();
    const uninstall = installBfcacheGuard({ onRestore });

    uninstall();
    dispatchPageShow(true);

    expect(onRestore).not.toHaveBeenCalled();
  });

  it("fires onRestore again on each subsequent bfcache restoration", () => {
    const onRestore = jest.fn();
    const uninstall = installBfcacheGuard({ onRestore });

    dispatchPageShow(true);
    dispatchPageShow(true);

    expect(onRestore).toHaveBeenCalledTimes(2);

    uninstall();
  });

  // The `typeof window === 'undefined'` (SSR) branch isn't exercised here:
  // jsdom's `window` is a non-configurable global that can't be deleted or
  // redefined within this project's jsdom-based jest environment, and this
  // repo's global jest.setup.ts assumes `window` exists, so a node-environment
  // test file for just this branch isn't viable without changing shared
  // test setup. The guard function itself is a one-line `typeof` check
  // directly mirroring the SSR guard pattern already used throughout this
  // codebase (e.g. lib/api/client.ts's `currentPathname()`).
});
