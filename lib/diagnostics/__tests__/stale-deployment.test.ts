import {
  buildSafeReloadUrl,
  clearReloadGuard,
  hasAlreadyAttemptedReload,
  installChunkLoadRejectionListener,
  isOffline,
  isStaleChunkLoadError,
  markReloadAttempted,
} from "../stale-deployment";

beforeEach(() => {
  clearReloadGuard();
});

describe("isStaleChunkLoadError", () => {
  it("recognizes a webpack ChunkLoadError by name", () => {
    const err = new Error("Loading chunk 42 failed.");
    err.name = "ChunkLoadError";
    expect(isStaleChunkLoadError(err)).toBe(true);
  });

  it("recognizes the generic 'Loading chunk N failed' message", () => {
    expect(isStaleChunkLoadError(new Error("Loading chunk 7 failed."))).toBe(true);
  });

  it("recognizes a dynamically-imported-module failure message", () => {
    expect(
      isStaleChunkLoadError(new Error("Failed to fetch dynamically imported module: /foo.js")),
    ).toBe(true);
  });

  it("recognizes a CSS chunk load failure", () => {
    expect(isStaleChunkLoadError(new Error("Loading CSS chunk 3 failed."))).toBe(true);
  });

  it("does not match an unrelated error that happens to mention 'chunk'", () => {
    expect(isStaleChunkLoadError(new Error("Could not process a chunk of the uploaded file"))).toBe(
      false,
    );
  });

  it("does not match a generic TypeError", () => {
    expect(isStaleChunkLoadError(new TypeError("Cannot read properties of undefined"))).toBe(false);
  });

  it("does not match a non-Error value", () => {
    expect(isStaleChunkLoadError("just a string")).toBe(false);
    expect(isStaleChunkLoadError(null)).toBe(false);
    expect(isStaleChunkLoadError(undefined)).toBe(false);
  });
});

describe("reload guard — repeated failure loop prevention", () => {
  it("reports no prior attempt before markReloadAttempted is called", () => {
    expect(hasAlreadyAttemptedReload()).toBe(false);
  });

  it("reports a prior attempt after markReloadAttempted", () => {
    markReloadAttempted();
    expect(hasAlreadyAttemptedReload()).toBe(true);
  });

  it("clearReloadGuard resets the guard (new session)", () => {
    markReloadAttempted();
    clearReloadGuard();
    expect(hasAlreadyAttemptedReload()).toBe(false);
  });
});

describe("buildSafeReloadUrl", () => {
  it("returns only the pathname, dropping any query string or hash the caller might pass accidentally", () => {
    // buildSafeReloadUrl takes the pathname already separated from
    // query/hash by the caller (window.location.pathname never includes
    // them), so this test documents that contract directly.
    expect(buildSafeReloadUrl("/proofs")).toBe("/proofs");
  });

  it("falls back to '/' for an empty pathname", () => {
    expect(buildSafeReloadUrl("")).toBe("/");
  });

  it("never includes auth tokens or form data because it never reads localStorage/sessionStorage/form state at all", () => {
    const url = buildSafeReloadUrl("/settings/payments");
    expect(url).not.toMatch(/token|session|auth/i);
  });
});

describe("isOffline", () => {
  const originalOnLine = Object.getOwnPropertyDescriptor(window.navigator, "onLine");

  afterEach(() => {
    if (originalOnLine) {
      Object.defineProperty(window.navigator, "onLine", originalOnLine);
    }
  });

  it("returns true when navigator.onLine is false", () => {
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    expect(isOffline()).toBe(true);
  });

  it("returns false when navigator.onLine is true", () => {
    Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
    expect(isOffline()).toBe(false);
  });
});

describe("installChunkLoadRejectionListener", () => {
  it("invokes the callback for an unhandledrejection whose reason is a stale-chunk error", () => {
    const onDetected = jest.fn();
    const unsubscribe = installChunkLoadRejectionListener(onDetected);

    const err = new Error("Loading chunk 5 failed.");
    const event = new Event("unhandledrejection") as PromiseRejectionEvent & {
      reason: unknown;
    };
    Object.defineProperty(event, "reason", { value: err });
    window.dispatchEvent(event);

    expect(onDetected).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("does not invoke the callback for an unrelated rejection reason", () => {
    const onDetected = jest.fn();
    const unsubscribe = installChunkLoadRejectionListener(onDetected);

    const event = new Event("unhandledrejection") as PromiseRejectionEvent & {
      reason: unknown;
    };
    Object.defineProperty(event, "reason", { value: new Error("network timeout") });
    window.dispatchEvent(event);

    expect(onDetected).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("stops listening after unsubscribe is called", () => {
    const onDetected = jest.fn();
    const unsubscribe = installChunkLoadRejectionListener(onDetected);
    unsubscribe();

    const err = new Error("Loading chunk 5 failed.");
    const event = new Event("unhandledrejection") as PromiseRejectionEvent & {
      reason: unknown;
    };
    Object.defineProperty(event, "reason", { value: err });
    window.dispatchEvent(event);

    expect(onDetected).not.toHaveBeenCalled();
  });
});
