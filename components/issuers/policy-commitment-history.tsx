"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Timestamp } from "@/components/common/timestamp";
import { ApiError } from "@/lib/errors";
import { formatNumber, formatPlural } from "@/lib/i18n";
import {
  parseIssuerPolicyCommitments,
  type IssuerPolicyCommitmentHistory,
  type IssuerPolicyCommitmentLoader,
  type PolicyCommitment,
} from "@/lib/api/issuer-policy-commitments";
import {
  canViewPolicyCommitmentHistory,
  commitmentEffectiveAt,
  compareCommitmentHashes,
  latestIndexedCommitment,
  reconcileCommitmentHistory,
  sortCommitmentsByVersion,
  type EffectiveAtResult,
  type HashComparison,
  type ReconciliationState,
} from "@/lib/issuers/policy-commitment-history";

export interface PolicyCommitmentHistoryProps {
  issuerId: string;
  /** Active tenant; a change discards the previous tenant's history immediately. */
  organizationId: string | null;
  /** Viewer's role from the session; null means not signed in. */
  viewerRole: string | null;
  /** Injected data source (see lib/api/issuer-policy-commitments.ts: no endpoint exists yet). */
  loadHistory: IssuerPolicyCommitmentLoader;
}

type LoadError =
  | "unauthenticated"
  | "forbidden"
  | "unsupported_version"
  | "invalid_response"
  | "issuer_mismatch"
  | "unavailable";

type LoadResult =
  | { key: string; status: "ready"; history: IssuerPolicyCommitmentHistory }
  | { key: string; status: "error"; error: LoadError };

const ERROR_COPY: Record<LoadError, { title: string; body: string }> = {
  unauthenticated: {
    title: "Authentication required",
    body: "Sign in with an issuer or admin wallet to view policy commitment history.",
  },
  forbidden: {
    title: "Access restricted",
    body: "Your role cannot view policy commitment history for this issuer.",
  },
  unsupported_version: {
    title: "Unsupported history format",
    body: "The server returned a commitment history version this app does not understand, so nothing is shown.",
  },
  invalid_response: {
    title: "History could not be verified",
    body: "The commitment history response was malformed or internally inconsistent, so nothing is shown.",
  },
  issuer_mismatch: {
    title: "History could not be verified",
    body: "The response belonged to a different issuer, so it was discarded.",
  },
  unavailable: {
    title: "History unavailable",
    body: "Policy commitment history could not be loaded. Try again.",
  },
};

const RECONCILIATION_COPY: Record<ReconciliationState["kind"], { symbol: string; label: string; tone: string }> = {
  in_sync: { symbol: "✓", label: "In sync", tone: "border-emerald-300/30 bg-emerald-300/10" },
  stale_projection: { symbol: "⏳", label: "Stale projection", tone: "border-amber-300/30 bg-amber-300/10" },
  mismatch: { symbol: "✕", label: "Mismatch", tone: "border-rose-300/30 bg-rose-300/10" },
  pending: { symbol: "…", label: "Pending: not yet indexed", tone: "border-white/15 bg-white/[0.04]" },
  unknown: { symbol: "?", label: "Unknown", tone: "border-white/15 bg-white/[0.04]" },
};

function loadErrorFrom(error: unknown): LoadError {
  if (error instanceof ApiError) {
    if (error.status === 401) return "unauthenticated";
    if (error.status === 403) return "forbidden";
  }
  return "unavailable";
}

function ledgerLabel(ledger: number) {
  return "ledger " + formatNumber(ledger);
}

function useCopy() {
  const [message, setMessage] = useState("");
  const copy = async (label: string, value: string) => {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) throw new Error("unsupported");
      await navigator.clipboard.writeText(value);
      setMessage(label + " copied.");
    } catch {
      setMessage("Copy failed. Select the hash text to copy it manually.");
    }
  };
  return { message, copy };
}

function HashValue({ label, hash, onCopy }: { label: string; hash: string; onCopy: (label: string, value: string) => void }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-semibold text-slate-300">{label}</span>
      <div className="flex flex-wrap items-start gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-black/30 px-2 py-1 font-mono text-xs text-slate-100">
          {hash.toLowerCase()}
        </code>
        <button
          type="button"
          onClick={() => onCopy(label, hash.toLowerCase())}
          className="rounded-md border border-white/15 px-2 py-1 text-xs text-white hover:bg-white/10"
          aria-label={"Copy " + label}
        >
          Copy
        </button>
      </div>
    </div>
  );
}

function ComparisonBadge({ result }: { result: HashComparison }) {
  const copy: Record<HashComparison, { symbol: string; text: string; tone: string }> = {
    identical: { symbol: "=", text: "Identical", tone: "text-emerald-200" },
    different: { symbol: "≠", text: "Different", tone: "text-amber-200" },
    invalid: { symbol: "!", text: "Not a valid 64-character hex hash", tone: "text-rose-200" },
  };
  return (
    <p className={"text-sm font-semibold " + copy[result].tone}>
      <span aria-hidden="true">{copy[result].symbol} </span>
      {copy[result].text}
    </p>
  );
}

function ReconciliationBanner({ state }: { state: ReconciliationState }) {
  const copy = RECONCILIATION_COPY[state.kind];
  let detail: React.ReactNode;
  switch (state.kind) {
    case "in_sync":
      detail = <>Backend metadata matches the on-chain commitment at {ledgerLabel(state.ledger)}.</>;
      break;
    case "stale_projection":
      detail = (
        <>
          The backend index is behind the chain: indexed through {ledgerLabel(state.indexedLedger)}
          {state.indexedAt ? (
            <>
              {" "}
              (<Timestamp value={state.indexedAt} />)
            </>
          ) : null}
          , latest {ledgerLabel(state.latestLedger)}. Newer commitments may be missing, so the history below is not
          current.
          {state.hashDiffers ? " The last indexed hash already differs from the on-chain hash." : null}
        </>
      );
      break;
    case "mismatch":
      detail = (
        <>
          Backend metadata does not match the on-chain commitment at {ledgerLabel(state.ledger)}
          {state.backendHash === null ? " (the backend has no commitment for this issuer)" : null}. Do not rely on
          this history until it is reconciled.
        </>
      );
      break;
    case "pending":
      detail = <>The backend has not indexed this issuer&apos;s policy commitments yet.</>;
      break;
    case "unknown":
      detail = <>The on-chain commitment could not be read, so agreement with backend metadata is not confirmed.</>;
      break;
  }

  return (
    <div className={"grid gap-1 rounded-lg border p-3 " + copy.tone} data-reconciliation={state.kind}>
      <p className="text-sm font-semibold text-white">
        <span aria-hidden="true">{copy.symbol} </span>
        Reconciliation: {copy.label}
      </p>
      <p className="text-sm text-slate-200">{detail}</p>
    </div>
  );
}

function effectiveAtMessage(result: EffectiveAtResult, ledger: number): string {
  switch (result.status) {
    case "effective":
      return "Version " + formatNumber(result.commitment.version) + " is effective at " + ledgerLabel(ledger) + ".";
    case "before_first":
      return "No commitment was effective yet; the first takes effect at " + ledgerLabel(result.firstEffectiveLedger) + ".";
    case "empty":
      return "This issuer has no indexed policy commitments.";
    case "beyond_index":
      return result.indexedLedger === null
        ? "Nothing is indexed yet, so the effective commitment cannot be determined."
        : "That ledger is beyond the indexed " + ledgerLabel(result.indexedLedger) + "; the effective commitment cannot be determined from this projection.";
    case "invalid_ledger":
      return "Enter a whole ledger number of 1 or more.";
  }
}

function RelatedProofs({ commitment }: { commitment: PolicyCommitment }) {
  const shown = commitment.relatedProofIds.length;
  return (
    <div className="grid gap-1">
      <p className="text-sm text-slate-200">
        {formatPlural(commitment.relatedProofCount, { one: "{count} related proof", other: "{count} related proofs" })}
        {shown < commitment.relatedProofCount && shown > 0
          ? " (showing " + formatNumber(shown) + " references)"
          : null}
      </p>
      {shown > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Related proof references">
          {commitment.relatedProofIds.map((proofId) => (
            <li key={proofId}>
              <code className="rounded bg-black/30 px-2 py-0.5 font-mono text-xs text-slate-200">{proofId}</code>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Versioned issuer policy commitment history (#267): current vs selected
 * comparison by exact hash equality, effective-ledger lookup, related proof
 * references and backend/chain reconciliation state. Hashes are opaque and
 * never decoded.
 */
export function PolicyCommitmentHistory({ issuerId, organizationId, viewerRole, loadHistory }: PolicyCommitmentHistoryProps) {
  const allowed = canViewPolicyCommitmentHistory(viewerRole);
  const [reloadNonce, setReloadNonce] = useState(0);
  const requestKey = issuerId + "|" + (organizationId ?? "") + "|" + reloadNonce;
  const [result, setResult] = useState<LoadResult | null>(null);
  const [selection, setSelection] = useState<{ key: string; version: number } | null>(null);
  const [lookup, setLookup] = useState<{ key: string; message: string } | null>(null);
  const [comparison, setComparison] = useState<{ key: string; result: HashComparison } | null>(null);
  const latestRequestRef = useRef(0);
  const { message: copyMessage, copy } = useCopy();
  const headingId = useId();
  const ledgerInputId = useId();
  const hashInputId = useId();

  useEffect(() => {
    if (!viewerRole || !allowed) return undefined;
    const controller = new AbortController();
    latestRequestRef.current += 1;
    const requestId = latestRequestRef.current;
    const key = requestKey;

    // Only the newest request for the current issuer/tenant may write state;
    // anything older is aborted and, if it still resolves, ignored.
    const isCurrent = () => requestId === latestRequestRef.current && !controller.signal.aborted;

    loadHistory({ issuerId, organizationId }, controller.signal)
      .then((raw) => {
        if (!isCurrent()) return;
        const parsed = parseIssuerPolicyCommitments(raw, issuerId);
        setResult(
          parsed.ok
            ? { key, status: "ready", history: parsed.history }
            : { key, status: "error", error: parsed.reason },
        );
      })
      .catch((error: unknown) => {
        if (!isCurrent()) return;
        setResult({ key, status: "error", error: loadErrorFrom(error) });
      });

    return () => controller.abort();
  }, [allowed, issuerId, loadHistory, organizationId, requestKey, viewerRole]);

  const current = result && result.key === requestKey ? result : null;
  const history = current?.status === "ready" ? current.history : null;
  const commitments = useMemo(() => (history ? sortCommitmentsByVersion(history.commitments) : []), [history]);
  const latest = history ? latestIndexedCommitment(history) : null;
  const reconciliation = history ? reconcileCommitmentHistory(history) : null;
  const isStale = reconciliation?.kind === "stale_projection";
  const selectedVersion = selection && selection.key === requestKey ? selection.version : null;
  const selected = commitments.find((commitment) => commitment.version === selectedVersion) ?? null;

  if (!viewerRole || !allowed) {
    const copyFor = ERROR_COPY[viewerRole ? "forbidden" : "unauthenticated"];
    return (
      <section aria-labelledby={headingId} className="grid gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h3 id={headingId} className="text-base font-semibold text-white">
          Policy commitment history
        </h3>
        <div role="alert" className="grid gap-1">
          <p className="text-sm font-semibold text-white">{copyFor.title}</p>
          <p className="text-sm text-slate-300">{copyFor.body}</p>
        </div>
      </section>
    );
  }

  function handleLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!history) return;
    const raw = String(new FormData(event.currentTarget).get("ledger") ?? "").trim();
    const ledger = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
    setLookup({ key: requestKey, message: effectiveAtMessage(commitmentEffectiveAt(history, ledger), ledger) });
  }

  function handleCompare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!latest) return;
    const value = String(new FormData(event.currentTarget).get("hash") ?? "");
    setComparison({ key: requestKey, result: compareCommitmentHashes(latest.commitmentHash, value) });
  }

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={current === null}
      className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5"
    >
      <h3 id={headingId} className="text-base font-semibold text-white">
        Policy commitment history
      </h3>
      <p className="text-xs text-slate-400">
        Commitment hashes are opaque on-chain values. They are compared for exact equality only and never decoded
        into policy content.
      </p>

      <p role="status" aria-live="polite" className="sr-only">
        {current === null ? "Loading policy commitment history." : copyMessage}
      </p>

      {current === null ? (
        <div className="grid gap-2" data-testid="commitment-history-loading">
          <div className="h-4 w-1/3 animate-pulse rounded bg-white/10" />
          <div className="h-16 animate-pulse rounded bg-white/10" />
        </div>
      ) : current.status === "error" ? (
        <div role="alert" className="grid gap-2 rounded-lg border border-rose-300/30 bg-rose-300/10 p-3">
          <p className="text-sm font-semibold text-white">{ERROR_COPY[current.error].title}</p>
          <p className="text-sm text-rose-100">{ERROR_COPY[current.error].body}</p>
          {current.error === "unavailable" ? (
            <div>
              <button
                type="button"
                onClick={() => setReloadNonce((value) => value + 1)}
                className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-white hover:bg-white/10"
              >
                Retry
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div role="status" aria-live="polite">
            {reconciliation ? <ReconciliationBanner state={reconciliation} /> : null}
          </div>

          {commitments.length === 0 ? (
            <p className="text-sm text-slate-300">No policy commitments have been indexed for this issuer.</p>
          ) : (
            <>
              {latest ? (
                <div className="grid gap-2">
                  <h4 className="text-sm font-semibold text-white">
                    {isStale
                      ? "Last indexed commitment (may not be current)"
                      : "Current commitment"}
                  </h4>
                  <p className="text-xs text-slate-400">
                    Version {formatNumber(latest.version)}, effective from {ledgerLabel(latest.effectiveLedger)}
                  </p>
                  <HashValue label={"Version " + formatNumber(latest.version) + " hash"} hash={latest.commitmentHash} onCopy={copy} />
                </div>
              ) : null}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <caption className="sr-only">Policy commitment versions, oldest first</caption>
                  <thead className="text-xs text-slate-400">
                    <tr>
                      <th scope="col" className="py-2 pr-3">Version</th>
                      <th scope="col" className="py-2 pr-3">Effective from</th>
                      <th scope="col" className="py-2 pr-3">Recorded</th>
                      <th scope="col" className="py-2 pr-3">Related proofs</th>
                      <th scope="col" className="py-2 pr-3">Compare</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commitments.map((commitment) => {
                      const isLatest = latest?.version === commitment.version;
                      const isSelected = selectedVersion === commitment.version;
                      return (
                        <tr key={commitment.version} className="border-t border-white/10">
                          <th scope="row" className="py-2 pr-3 font-semibold text-white">
                            {formatNumber(commitment.version)}
                            {isLatest ? (
                              <span className="ml-2 text-xs font-normal text-slate-300">
                                {isStale ? "(last indexed)" : "(current)"}
                              </span>
                            ) : null}
                          </th>
                          <td className="py-2 pr-3 text-slate-200">{ledgerLabel(commitment.effectiveLedger)}</td>
                          <td className="py-2 pr-3 text-slate-200">
                            <Timestamp value={commitment.recordedAt} />
                          </td>
                          <td className="py-2 pr-3 text-slate-200">{formatNumber(commitment.relatedProofCount)}</td>
                          <td className="py-2 pr-3">
                            <button
                              type="button"
                              aria-pressed={isSelected}
                              onClick={() => setSelection({ key: requestKey, version: commitment.version })}
                              className="rounded-md border border-white/15 px-2 py-1 text-xs text-white hover:bg-white/10 aria-pressed:bg-white/15"
                            >
                              {isSelected ? "Selected" : "Select version " + formatNumber(commitment.version)}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {selected && latest ? (
                <div className="grid gap-3 rounded-lg border border-white/10 p-3" aria-label="Selected version comparison" role="group">
                  <h4 className="text-sm font-semibold text-white">
                    {"Version " + formatNumber(selected.version) + " compared with " + (isStale ? "last indexed" : "current")}
                  </h4>
                  <HashValue label={"Version " + formatNumber(selected.version) + " hash"} hash={selected.commitmentHash} onCopy={copy} />
                  <HashValue label={(isStale ? "Last indexed" : "Current") + " hash"} hash={latest.commitmentHash} onCopy={copy} />
                  <div aria-live="polite">
                    <ComparisonBadge result={compareCommitmentHashes(selected.commitmentHash, latest.commitmentHash)} />
                  </div>
                  <p className="text-xs text-slate-400">
                    Only whether the hashes are identical is shown. Hashes do not reveal what changed in the policy.
                  </p>
                  <RelatedProofs commitment={selected} />
                </div>
              ) : null}
            </>
          )}

          {history ? (
            <form onSubmit={handleLookup} className="grid gap-2" noValidate>
              <label htmlFor={ledgerInputId} className="text-sm font-semibold text-white">
                Find the commitment effective at a ledger
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  id={ledgerInputId}
                  name="ledger"
                  inputMode="numeric"
                  autoComplete="off"
                  className="h-10 w-48 rounded-md border border-white/15 bg-slate-950 px-3 text-sm text-white"
                />
                <button type="submit" className="h-10 rounded-md border border-white/15 px-3 text-sm text-white hover:bg-white/10">
                  Look up
                </button>
              </div>
              <p aria-live="polite" className="text-sm text-slate-200" data-testid="effective-at-result">
                {lookup && lookup.key === requestKey ? lookup.message : ""}
              </p>
            </form>
          ) : null}

          {latest ? (
            <form onSubmit={handleCompare} className="grid gap-2" noValidate>
              <label htmlFor={hashInputId} className="text-sm font-semibold text-white">
                {isStale ? "Compare a hash with the last indexed commitment" : "Compare a hash with the current commitment"}
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  id={hashInputId}
                  name="hash"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-10 min-w-0 flex-1 rounded-md border border-white/15 bg-slate-950 px-3 font-mono text-xs text-white"
                />
                <button type="submit" className="h-10 rounded-md border border-white/15 px-3 text-sm text-white hover:bg-white/10">
                  Compare
                </button>
              </div>
              <div aria-live="polite" data-testid="hash-compare-result">
                {comparison && comparison.key === requestKey ? <ComparisonBadge result={comparison.result} /> : null}
              </div>
            </form>
          ) : null}
        </>
      )}
    </section>
  );
}
