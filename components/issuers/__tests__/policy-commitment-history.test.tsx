/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PolicyCommitmentHistory } from "../policy-commitment-history";
import { ApiError } from "@/lib/errors";
import type { IssuerPolicyCommitmentLoader } from "@/lib/api/issuer-policy-commitments";
import {
  HASH_V1,
  HASH_V2,
  HASH_V3,
  HASH_V3_UPPER,
  OTHER_SYNTHETIC_ISSUER_ID,
  SYNTHETIC_ISSUER_ID,
  makeCommitment,
  makeHistory,
} from "@/tests/fixtures/issuer-policy-commitment-fixtures";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderHistory(loadHistory: IssuerPolicyCommitmentLoader, overrides: Partial<Parameters<typeof PolicyCommitmentHistory>[0]> = {}) {
  const props = {
    issuerId: SYNTHETIC_ISSUER_ID,
    organizationId: "org-synthetic-0001",
    viewerRole: "ISSUER",
    loadHistory,
    ...overrides,
  };
  const utils = render(<PolicyCommitmentHistory {...props} />);
  return {
    ...utils,
    rerenderWith: (next: Partial<typeof props>) => utils.rerender(<PolicyCommitmentHistory {...props} {...next} />),
  };
}

const reconciliation = (container: HTMLElement) =>
  container.querySelector("[data-reconciliation]")?.getAttribute("data-reconciliation");

describe("PolicyCommitmentHistory (#267)", () => {
  it("positive: shows the loading state, then versions, current commitment and an in-sync reconciliation", async () => {
    const load = jest.fn(async () => makeHistory());
    const { container } = renderHistory(load);

    expect(screen.getByTestId("commitment-history-loading")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Current commitment" })).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith(
      { issuerId: SYNTHETIC_ISSUER_ID, organizationId: "org-synthetic-0001" },
      expect.any(AbortSignal),
    );
    expect(screen.getAllByRole("row")).toHaveLength(4);
    expect(reconciliation(container)).toBe("in_sync");
    expect(screen.getByText(/Reconciliation: In sync/)).toBeInTheDocument();
    expect(screen.getAllByText(HASH_V3).length).toBeGreaterThan(0);
  });

  it("positive: displays hashes lower-cased as full hex and never as decoded content", async () => {
    renderHistory(async () => makeHistory({ commitments: [makeCommitment({ version: 1, commitmentHash: HASH_V3_UPPER, effectiveLedger: 1_000 })], onChainCurrentHash: HASH_V3_UPPER }));
    expect(await screen.findAllByText(HASH_V3)).not.toHaveLength(0);
    expect(screen.queryByText(HASH_V3_UPPER)).not.toBeInTheDocument();
    expect(screen.getByText(/never decoded into policy content/i)).toBeInTheDocument();
  });

  it("positive: comparing a selected older version with current reports Different; the current version reports Identical", async () => {
    renderHistory(async () => makeHistory());
    fireEvent.click(await screen.findByRole("button", { name: "Select version 1" }));

    const group = screen.getByRole("group", { name: /selected version comparison/i });
    expect(within(group).getByText("Different")).toBeInTheDocument();
    expect(within(group).getByText(HASH_V1)).toBeInTheDocument();
    expect(within(group).getByText(/2 related proofs/)).toBeInTheDocument();
    expect(within(group).getByText("proof-synthetic-0001")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Select version 3" }));
    expect(within(screen.getByRole("group", { name: /selected version comparison/i })).getByText("Identical")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Selected" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a reference count larger than the references listed", async () => {
    renderHistory(async () => makeHistory());
    fireEvent.click(await screen.findByRole("button", { name: "Select version 2" }));
    expect(screen.getByText(/45 related proofs/)).toBeInTheDocument();
    expect(screen.getByText(/showing 1 references/)).toBeInTheDocument();
  });

  it("copies the full lower-case hash and announces the result", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderHistory(async () => makeHistory({ onChainCurrentHash: HASH_V3_UPPER }));

    fireEvent.click(await screen.findByRole("button", { name: "Copy Version 3 hash" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(HASH_V3));
    expect(await screen.findByText("Version 3 hash copied.")).toBeInTheDocument();
  });

  it("negative: a copy failure is reported instead of silently ignored", async () => {
    Object.assign(navigator, { clipboard: { writeText: jest.fn().mockRejectedValue(new Error("denied")) } });
    renderHistory(async () => makeHistory());
    fireEvent.click(await screen.findByRole("button", { name: "Copy Version 3 hash" }));
    expect(await screen.findByText(/copy failed/i)).toBeInTheDocument();
  });

  it("compares a pasted hash by exact case-insensitive equality and rejects partial values", async () => {
    renderHistory(async () => makeHistory());
    const input = await screen.findByLabelText(/compare a hash with the current commitment/i);

    fireEvent.change(input, { target: { value: HASH_V3_UPPER } });
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(within(screen.getByTestId("hash-compare-result")).getByText("Identical")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: HASH_V3.slice(0, 32) } });
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(within(screen.getByTestId("hash-compare-result")).getByText(/not a valid 64-character hex hash/i)).toBeInTheDocument();
  });

  it("boundary: the effective-ledger lookup treats effective_ledger == L as effective", async () => {
    renderHistory(async () => makeHistory());
    const input = await screen.findByLabelText(/find the commitment effective at a ledger/i);
    const lookUp = (value: string) => {
      fireEvent.change(input, { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: "Look up" }));
      return screen.getByTestId("effective-at-result").textContent;
    };

    expect(lookUp("2000")).toMatch(/Version 2 is effective at ledger 2,000/);
    expect(lookUp("1999")).toMatch(/Version 1 is effective at ledger 1,999/);
    expect(lookUp("999")).toMatch(/first takes effect at ledger 1,000/);
    expect(lookUp("3501")).toMatch(/beyond the indexed ledger 3,500/);
    expect(lookUp("-1")).toMatch(/whole ledger number/);
    expect(lookUp("1.5")).toMatch(/whole ledger number/);
  });

  describe("reconciliation states are visually and textually distinct", () => {
    it.each([
      ["stale_projection", makeHistory({ indexedLedger: 3_200, latestLedger: 4_000 }), /Reconciliation: Stale projection/],
      ["mismatch", makeHistory({ onChainCurrentHash: HASH_V2 }), /Reconciliation: Mismatch/],
      ["pending", makeHistory({ indexedLedger: null, indexedAt: null, commitments: [] }), /Reconciliation: Pending: not yet indexed/],
      ["unknown", makeHistory({ onChainCurrentHash: null }), /Reconciliation: Unknown/],
    ] as const)("%s", async (kind, history, label) => {
      const { container } = renderHistory(async () => history);
      expect(await screen.findByText(label)).toBeInTheDocument();
      expect(reconciliation(container)).toBe(kind);
    });

    it("never presents a stale projection as current", async () => {
      renderHistory(async () => makeHistory({ indexedLedger: 3_200, latestLedger: 4_000 }));
      expect(await screen.findByRole("heading", { name: /last indexed commitment \(may not be current\)/i })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Current commitment" })).not.toBeInTheDocument();
      expect(screen.queryByText("(current)")).not.toBeInTheDocument();
      expect(screen.getByText("(last indexed)")).toBeInTheDocument();
      expect(screen.getByText(/indexed through ledger 3,200/)).toBeInTheDocument();
      expect(screen.getByText(/latest ledger 4,000/)).toBeInTheDocument();
    });
  });

  it("boundary: empty history shows an explicit empty state", async () => {
    renderHistory(async () => makeHistory({ commitments: [], onChainCurrentHash: null }));
    expect(await screen.findByText(/no policy commitments have been indexed/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("boundary: a single-version history compares identical to itself", async () => {
    renderHistory(async () =>
      makeHistory({ commitments: [makeCommitment({ version: 1, commitmentHash: HASH_V3, effectiveLedger: 1_000 })] }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Select version 1" }));
    expect(within(screen.getByRole("group", { name: /selected version comparison/i })).getByText("Identical")).toBeInTheDocument();
  });

  describe("authorization", () => {
    it.each(["WORKER", "DEVELOPER"])("blocks role %s without calling the loader", (viewerRole) => {
      const load = jest.fn();
      renderHistory(load, { viewerRole });
      expect(screen.getByRole("alert")).toHaveTextContent(/access restricted/i);
      expect(load).not.toHaveBeenCalled();
    });

    it("requires sign-in when there is no session, without calling the loader", () => {
      const load = jest.fn();
      renderHistory(load, { viewerRole: null });
      expect(screen.getByRole("alert")).toHaveTextContent(/authentication required/i);
      expect(load).not.toHaveBeenCalled();
    });

    it.each([
      [401, /authentication required/i],
      [403, /access restricted/i],
    ])("renders an explicit state for a server %s", async (status, text) => {
      renderHistory(async () => {
        throw new ApiError({ status, message: "synthetic" });
      });
      expect(await screen.findByRole("alert")).toHaveTextContent(text);
      expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    });
  });

  describe("negative", () => {
    it.each([
      ["an unknown schema version", { ...makeHistory(), schemaVersion: 2 }, /unsupported history format/i],
      ["a malformed response", { schemaVersion: 1 }, /could not be verified/i],
      ["a response for another issuer", makeHistory({ issuerId: OTHER_SYNTHETIC_ISSUER_ID }), /different issuer/i],
    ])("fails closed on %s", async (_label, raw, text) => {
      renderHistory(async () => raw);
      expect(await screen.findByRole("alert")).toHaveTextContent(text);
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    it("offers retry for a network failure and reloads", async () => {
      const load = jest.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(makeHistory());
      renderHistory(load);
      fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
      expect(await screen.findByRole("heading", { name: "Current commitment" })).toBeInTheDocument();
      expect(load).toHaveBeenCalledTimes(2);
    });
  });

  describe("concurrency and replay", () => {
    it("aborts the in-flight request and discards its late response when the issuer changes", async () => {
      const first = deferred<unknown>();
      const second = deferred<unknown>();
      const signals: AbortSignal[] = [];
      const load = jest.fn((_request: unknown, signal: AbortSignal) => {
        signals.push(signal);
        return signals.length === 1 ? first.promise : second.promise;
      });
      const { rerenderWith } = renderHistory(load as IssuerPolicyCommitmentLoader);

      rerenderWith({ issuerId: OTHER_SYNTHETIC_ISSUER_ID });
      expect(signals[0].aborted).toBe(true);

      await act(async () => {
        second.resolve(makeHistory({ issuerId: OTHER_SYNTHETIC_ISSUER_ID, onChainCurrentHash: HASH_V2, commitments: [makeCommitment({ version: 1, commitmentHash: HASH_V2, effectiveLedger: 1_000 })] }));
      });
      await act(async () => {
        first.resolve(makeHistory());
      });

      expect(screen.getAllByText(HASH_V2).length).toBeGreaterThan(0);
      expect(screen.queryByText(HASH_V3)).not.toBeInTheDocument();
    });

    it("drops the previous tenant's history immediately on tenant change", async () => {
      const pending = deferred<unknown>();
      const load = jest.fn().mockResolvedValueOnce(makeHistory()).mockReturnValueOnce(pending.promise);
      const { rerenderWith } = renderHistory(load);
      expect(await screen.findByRole("heading", { name: "Current commitment" })).toBeInTheDocument();

      rerenderWith({ organizationId: "org-synthetic-0002" });
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.getByTestId("commitment-history-loading")).toBeInTheDocument();
      expect(load).toHaveBeenLastCalledWith(
        { issuerId: SYNTHETIC_ISSUER_ID, organizationId: "org-synthetic-0002" },
        expect.any(AbortSignal),
      );
    });

    it("discards a late error from a superseded request", async () => {
      const first = deferred<unknown>();
      const load = jest.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(makeHistory({ issuerId: OTHER_SYNTHETIC_ISSUER_ID }));
      const { rerenderWith } = renderHistory(load);
      rerenderWith({ issuerId: OTHER_SYNTHETIC_ISSUER_ID });
      expect(await screen.findByRole("heading", { name: "Current commitment" })).toBeInTheDocument();

      await act(async () => {
        first.reject(new ApiError({ status: 403, message: "synthetic" }));
      });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("clears the selection when the issuer changes", async () => {
      const load = jest
        .fn()
        .mockResolvedValueOnce(makeHistory())
        .mockResolvedValueOnce(makeHistory({ issuerId: OTHER_SYNTHETIC_ISSUER_ID }));
      const { rerenderWith } = renderHistory(load);
      fireEvent.click(await screen.findByRole("button", { name: "Select version 1" }));
      expect(screen.getByRole("group", { name: /selected version comparison/i })).toBeInTheDocument();

      rerenderWith({ issuerId: OTHER_SYNTHETIC_ISSUER_ID });
      expect(await screen.findByRole("heading", { name: "Current commitment" })).toBeInTheDocument();
      expect(screen.queryByRole("group", { name: /selected version comparison/i })).not.toBeInTheDocument();
    });
  });
});
