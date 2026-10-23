/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { LiveVerificationRefresh, type LiveVerificationRefreshProps } from "../live-verification-refresh";
import { ApiError } from "@/lib/errors";
import { LiveRefreshHttpError, type LiveVerificationRefreshLoader } from "@/lib/api/live-verification-refresh";
import {
  BASE_TIME,
  FIVE_MINUTES_MS,
  OTHER_SYNTHETIC_PROOF_ID,
  SYNTHETIC_PROOF_ID,
  isoAt,
  makeEvidence,
  makeRefreshResponse,
} from "@/tests/fixtures/live-verification-fixtures";

const TIMEOUT_MS = 15_000;
const COOLDOWN_MS = 30_000;
let clock = BASE_TIME;
const now = () => clock;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function advance(ms: number) {
  clock += ms;
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

function renderPanel(refresh: LiveVerificationRefreshLoader, overrides: Partial<LiveVerificationRefreshProps> = {}) {
  const props: LiveVerificationRefreshProps = {
    proofId: SYNTHETIC_PROOF_ID,
    organizationId: "org-synthetic-0001",
    viewerRole: "WORKER",
    cachedEvidence: makeEvidence(),
    policy: { maxEvidenceAgeMs: FIVE_MINUTES_MS },
    supportedSources: ["cached_indexer", "live_contract"],
    refresh,
    now,
    timeoutMs: TIMEOUT_MS,
    cooldownMs: COOLDOWN_MS,
    ...overrides,
  };
  const utils = render(<LiveVerificationRefresh {...props} />);
  return { ...utils, rerenderWith: (next: Partial<LiveVerificationRefreshProps>) => utils.rerender(<LiveVerificationRefresh {...props} {...next} />) };
}

const refreshButton = () => screen.getByRole("button", { name: "Refresh evidence" });
const evidencePanel = () => screen.getByTestId("evidence-panel");
const progress = () => screen.getByTestId("refresh-progress");
const selectSource = (name: RegExp) => fireEvent.click(screen.getByRole("radio", { name }));

beforeEach(() => {
  clock = BASE_TIME;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("LiveVerificationRefresh (#268)", () => {
  it("regression: the cached path shows cached evidence with an honest freshness label and never calls the loader", () => {
    const refresh = jest.fn();
    renderPanel(refresh);
    expect(within(evidencePanel()).getByRole("heading", { name: "Cached evidence" })).toBeInTheDocument();
    expect(evidencePanel()).toHaveTextContent(/STALE: 10 min old\. Does not meet policy freshness/);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("positive: progresses requesting → fetching → validating → done and shows refreshed fresh evidence", async () => {
    clock = BASE_TIME + 1_000;
    const pending = deferred<unknown>();
    const refresh = jest.fn(() => pending.promise);
    renderPanel(refresh);
    selectSource(/live contract/i);

    fireEvent.click(refreshButton());
    expect(progress()).toHaveTextContent("Requesting refresh…");
    await flush();
    expect(progress()).toHaveTextContent(/Fetching evidence/);
    expect(refresh).toHaveBeenCalledWith(
      { proofId: SYNTHETIC_PROOF_ID, source: "live_contract", organizationId: "org-synthetic-0001" },
      expect.any(AbortSignal),
    );

    await act(async () => {
      pending.resolve(makeRefreshResponse());
    });
    await flush();
    expect(progress()).toHaveTextContent("Refresh complete.");
    expect(within(evidencePanel()).getByRole("heading", { name: /refreshed evidence from live contract/i })).toBeInTheDocument();
    expect(evidencePanel()).toHaveTextContent(/Fresh: 1 s old/);
  });

  it("boundary: evidence exactly maxAge old is STALE; 1 ms younger is fresh", () => {
    const { rerenderWith } = renderPanel(jest.fn(), {
      cachedEvidence: makeEvidence({ observedAt: isoAt(BASE_TIME - FIVE_MINUTES_MS) }),
    });
    expect(evidencePanel().querySelector("[data-freshness]")?.getAttribute("data-freshness")).toBe("stale");

    rerenderWith({ cachedEvidence: makeEvidence({ observedAt: isoAt(BASE_TIME - FIVE_MINUTES_MS + 1) }) });
    expect(evidencePanel().querySelector("[data-freshness]")?.getAttribute("data-freshness")).toBe("fresh");
  });

  it("fails closed without a freshness policy", () => {
    renderPanel(jest.fn(), { policy: null });
    expect(screen.getByText(/so freshness cannot be confirmed/i)).toBeInTheDocument();
    expect(evidencePanel()).toHaveTextContent(/Freshness not confirmed/);
  });

  describe("negative", () => {
    it("timeout: aborts, reports the timeout, falls back to cached evidence labeled STALE, and ignores the late response", async () => {
      const pending = deferred<unknown>();
      const signals: AbortSignal[] = [];
      const refresh = jest.fn((_request: unknown, signal: AbortSignal) => {
        signals.push(signal);
        return pending.promise;
      });
      renderPanel(refresh as LiveVerificationRefreshLoader);
      selectSource(/live contract/i);
      fireEvent.click(refreshButton());
      await flush();

      advance(TIMEOUT_MS - 1);
      expect(progress()).toHaveTextContent(/Fetching evidence/);
      advance(1);
      expect(signals[0].aborted).toBe(true);
      expect(progress()).toHaveTextContent(/timed out\. Showing cached evidence, which is not live/);
      expect(within(evidencePanel()).getByRole("heading", { name: "Cached evidence (live refresh failed)" })).toBeInTheDocument();
      expect(evidencePanel()).toHaveTextContent(/STALE/);

      await act(async () => {
        pending.resolve(makeRefreshResponse({ observedAt: isoAt(clock) }));
      });
      await flush();
      expect(within(evidencePanel()).queryByRole("heading", { name: /refreshed evidence/i })).not.toBeInTheDocument();
    });

    it("source failure: shows the failure and keeps cached evidence clearly not live", async () => {
      renderPanel(async () => {
        throw new TypeError("Failed to fetch");
      });
      fireEvent.click(refreshButton());
      await flush();
      expect(progress()).toHaveTextContent(/selected source could not provide evidence/);
      expect(within(evidencePanel()).getByRole("heading", { name: "Cached evidence (live refresh failed)" })).toBeInTheDocument();
    });

    it("failure without cached evidence says so", async () => {
      renderPanel(async () => {
        throw new TypeError("Failed to fetch");
      }, { cachedEvidence: null });
      fireEvent.click(refreshButton());
      await flush();
      expect(progress()).toHaveTextContent(/No cached evidence is available/);
      expect(within(evidencePanel()).getByRole("heading", { name: "No evidence yet" })).toBeInTheDocument();
    });

    it.each([
      ["unsupported version", { ...makeRefreshResponse(), schemaVersion: 2 }, /format this app does not support/],
      ["malformed evidence", { schemaVersion: 1 }, /malformed evidence/],
      ["another proof", makeRefreshResponse({ proofId: OTHER_SYNTHETIC_PROOF_ID }), /different proof or source/],
      ["another source", makeRefreshResponse({ source: "cached_indexer" }), /different proof or source/],
    ])("rejects %s and never shows it as refreshed evidence", async (_label, raw, text) => {
      renderPanel(async () => raw);
      selectSource(/live contract/i);
      fireEvent.click(refreshButton());
      await flush();
      expect(progress()).toHaveTextContent(text);
      expect(within(evidencePanel()).queryByRole("heading", { name: /refreshed evidence/i })).not.toBeInTheDocument();
    });
  });

  describe("authorization", () => {
    it.each([
      [null, /sign in to request a refresh/i],
      ["SUPERUSER", /your account cannot request a refresh/i],
    ])("role %p cannot trigger a refresh", (viewerRole, reason) => {
      const refresh = jest.fn();
      renderPanel(refresh, { viewerRole });
      expect(refreshButton()).toBeDisabled();
      expect(screen.getByText(reason)).toBeInTheDocument();
      fireEvent.click(refreshButton());
      expect(refresh).not.toHaveBeenCalled();
    });

    it.each([
      [401, /session has expired/i],
      [403, /not allowed to request a live refresh/i],
    ])("a %s blocks further refreshes for this proof, even after the cooldown", async (status, text) => {
      const refresh = jest.fn(async () => {
        throw new ApiError({ status, message: "synthetic" });
      });
      renderPanel(refresh);
      fireEvent.click(refreshButton());
      await flush();
      expect(progress()).toHaveTextContent(text);

      advance(COOLDOWN_MS);
      expect(refreshButton()).toBeDisabled();
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("a 429 respects Retry-After for the visible cooldown", async () => {
      const refresh = jest.fn(async () => {
        throw new LiveRefreshHttpError(429, "synthetic", "90");
      });
      renderPanel(refresh);
      fireEvent.click(refreshButton());
      await flush();
      expect(progress()).toHaveTextContent(/Too many refresh requests/);

      advance(COOLDOWN_MS);
      expect(refreshButton()).toBeDisabled();
      expect(screen.getByText(/Next refresh available in 1 min/)).toBeInTheDocument();
      advance(90_000 - COOLDOWN_MS);
      expect(refreshButton()).toBeEnabled();
    });

    it("a 429 without a usable Retry-After falls back to the default cooldown", async () => {
      renderPanel(async () => {
        throw new LiveRefreshHttpError(429, "synthetic", "soon");
      });
      fireEvent.click(refreshButton());
      await flush();
      advance(COOLDOWN_MS);
      expect(refreshButton()).toBeEnabled();
    });
  });

  describe("bounds and concurrency", () => {
    it("double-click starts exactly one request", async () => {
      const refresh = jest.fn(() => new Promise<unknown>(() => undefined));
      renderPanel(refresh);
      fireEvent.click(refreshButton());
      fireEvent.click(refreshButton());
      await flush();
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(refreshButton()).toBeDisabled();
    });

    it("boundary: the button re-enables at exactly the end of the cooldown, with a visible countdown", async () => {
      renderPanel(async () => makeRefreshResponse({ source: "cached_indexer" }));
      fireEvent.click(refreshButton());
      await flush();

      expect(screen.getByText(/Next refresh available in 30 s/)).toBeInTheDocument();
      advance(COOLDOWN_MS - 1000);
      expect(refreshButton()).toBeDisabled();
      expect(screen.getByText(/Next refresh available in 1 s/)).toBeInTheDocument();
      advance(1000);
      expect(refreshButton()).toBeEnabled();
    });

    it("switching source mid-flight aborts the request, ignores its late result, and keeps the cooldown", async () => {
      const pending = deferred<unknown>();
      const signals: AbortSignal[] = [];
      const refresh = jest.fn((_request: unknown, signal: AbortSignal) => {
        signals.push(signal);
        return pending.promise;
      });
      renderPanel(refresh as LiveVerificationRefreshLoader);
      selectSource(/live contract/i);
      fireEvent.click(refreshButton());
      await flush();

      selectSource(/cached \(indexer\)/i);
      expect(signals[0].aborted).toBe(true);
      await act(async () => {
        pending.resolve(makeRefreshResponse());
      });
      await flush();

      expect(within(evidencePanel()).getByRole("heading", { name: "Cached evidence" })).toBeInTheDocument();
      expect(progress()).toHaveTextContent("");
      expect(refreshButton()).toBeDisabled();
    });

    it("a result is never applied to a different proof than requested", async () => {
      const pending = deferred<unknown>();
      const refresh = jest.fn(() => pending.promise);
      const { rerenderWith } = renderPanel(refresh);
      selectSource(/live contract/i);
      fireEvent.click(refreshButton());
      await flush();

      rerenderWith({ proofId: OTHER_SYNTHETIC_PROOF_ID, cachedEvidence: null });
      await act(async () => {
        pending.resolve(makeRefreshResponse());
      });
      await flush();
      expect(within(evidencePanel()).getByRole("heading", { name: "No evidence yet" })).toBeInTheDocument();
    });

    it("never shows cached evidence that belongs to another proof", () => {
      renderPanel(jest.fn(), { cachedEvidence: makeEvidence({ proofId: OTHER_SYNTHETIC_PROOF_ID }) });
      expect(within(evidencePanel()).getByRole("heading", { name: "No evidence yet" })).toBeInTheDocument();
    });
  });

  describe("source selection", () => {
    it("offers only backend-supported sources and labels the rest", () => {
      renderPanel(jest.fn(), { supportedSources: ["cached_indexer", "mempool"] });
      expect(screen.getByRole("radio", { name: /cached \(indexer\)/i })).toBeEnabled();
      expect(screen.getByRole("radio", { name: /cached \(indexer\)/i })).toBeChecked();
      expect(screen.getByRole("radio", { name: /live contract/i })).toBeDisabled();
      expect(screen.getByText(/not supported by this server/)).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /mempool/i })).toBeDisabled();
      expect(screen.getByText(/unknown source, not selectable/)).toBeInTheDocument();
    });

    it("disables refresh when the backend supports no known source", () => {
      const refresh = jest.fn();
      renderPanel(refresh, { supportedSources: ["mempool"] });
      expect(refreshButton()).toBeDisabled();
      expect(screen.getByText(/no refresh source is available/i)).toBeInTheDocument();
    });
  });
});
