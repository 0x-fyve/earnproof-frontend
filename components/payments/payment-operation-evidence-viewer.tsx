"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getPaymentOperationEvidence,
  isNetworkMismatch,
  type PaymentOperationEvidence,
} from "@/lib/stellar/payment-evidence";
import { decodeMuxedAccount, isMuxedAccountAddress } from "@/lib/stellar/muxed-account";
import { buildTransactionExplorerLink } from "@/lib/stellar/explorer";
import { isNativeAsset, assetDisplayLabel } from "@/lib/stellar/asset";
import { Timestamp } from "@/components/common/timestamp";
import { appConfig } from "@/config/app";

type LoadState = "loading" | "ready" | "not-found" | "error";

const statusCopy: Record<PaymentOperationEvidence["amountStatus"], { label: string; tone: string }> = {
  success: { label: "Succeeded", tone: "text-emerald-300" },
  failed: { label: "Failed", tone: "text-rose-300" },
  pending: { label: "Pending", tone: "text-amber-300" },
};

/**
 * Stellar payment operation evidence viewer (#224).
 *
 * Deliberately separate from PaymentEligibilityPanel: this component
 * never reads or renders `Payment.classification`/`Payment.isEligible` —
 * it only displays raw indexed on-chain evidence for the ONE operation
 * this payment record indexes, never any other operation from the same
 * (possibly multi-operation) transaction. Memo content is never fetched
 * at all (see payment-evidence.ts's `hasMemo: boolean`), so there is
 * nothing here that could leak private memo data.
 */
export function PaymentOperationEvidenceViewer({
  token,
  paymentId,
}: {
  token: string;
  paymentId: string;
}) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [evidence, setEvidence] = useState<PaymentOperationEvidence | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setLoadState("loading");
    getPaymentOperationEvidence(token, paymentId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setEvidence(result);
        setLoadState("ready");
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof Error && err.message.includes("404")) {
          setLoadState("not-found");
        } else {
          setLoadState("error");
        }
      });
  }, [token, paymentId]);

  useEffect(() => {
    void Promise.resolve().then(load);
    return () => controllerRef.current?.abort();
  }, [load]);

  if (loadState === "loading") {
    return (
      <div
        className="rounded-lg border border-white/10 bg-white/[0.04] p-5 text-sm text-slate-300"
        role="status"
        aria-live="polite"
      >
        Loading payment evidence...
      </div>
    );
  }

  if (loadState === "not-found") {
    return (
      <div className="rounded-lg border border-rose-300/30 bg-rose-300/10 p-5" role="alert">
        <h2 className="text-lg font-semibold text-rose-100">No evidence available</h2>
        <p className="mt-2 text-sm text-rose-200">
          This payment has no indexed transaction evidence yet, or it could not be found.
        </p>
      </div>
    );
  }

  if (loadState === "error" || !evidence) {
    return (
      <div className="rounded-lg border border-rose-300/30 bg-rose-300/10 p-5" role="alert">
        <h2 className="text-lg font-semibold text-rose-100">Could not load payment evidence</h2>
        <p className="mt-2 text-sm text-rose-200">Please try again in a moment.</p>
      </div>
    );
  }

  const networkMismatch = isNetworkMismatch(evidence, appConfig.stellarNetwork as "testnet" | "public");
  const explorerLink = buildTransactionExplorerLink(evidence.network, evidence.transactionHash);
  const asset = { assetCode: evidence.assetCode, assetIssuer: evidence.assetIssuer };

  return (
    <section
      className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5"
      role="region"
      aria-labelledby="evidence-heading"
    >
      <div>
        <h2 id="evidence-heading" className="text-xl font-semibold text-white">
          Payment Operation Evidence
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          The exact Stellar transaction operation used to index this payment record.
        </p>
      </div>

      {networkMismatch && (
        <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3">
          <p className="text-xs text-amber-200" role="alert">
            This evidence was recorded on <strong>{evidence.network}</strong>, but the app is
            currently configured for <strong>{appConfig.stellarNetwork}</strong>. The explorer link
            below reflects the evidence&apos;s own network.
          </p>
        </div>
      )}

      {evidence.operationCount > 1 && (
        <p className="text-xs text-slate-400" role="status">
          This transaction contains {evidence.operationCount} operations. Only operation #
          {evidence.operationIndex} — the one indexed for this payment — is shown below.
        </p>
      )}

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Network</dt>
          <dd className="mt-0.5 text-slate-200">{evidence.network}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Operation index
          </dt>
          <dd className="mt-0.5 text-slate-200">
            {evidence.operationIndex} of {evidence.operationCount}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Asset</dt>
          <dd className="mt-0.5 text-slate-200">{assetDisplayLabel(asset)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Amount</dt>
          <dd className="mt-0.5 text-slate-200">
            {evidence.amount} {isNativeAsset(asset) ? "" : evidence.assetCode}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Status</dt>
          <dd className={`mt-0.5 font-semibold ${statusCopy[evidence.amountStatus].tone}`}>
            {statusCopy[evidence.amountStatus].label}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Ledger / closed at
          </dt>
          <dd className="mt-0.5 text-slate-200">
            #{evidence.ledgerSequence} — <Timestamp value={evidence.ledgerClosedAt} />
          </dd>
        </div>
      </dl>

      <div className="grid gap-3 border-t border-white/10 pt-3">
        <AccountEvidenceRow label="Source account" account={evidence.sourceAccount} />
        <AccountEvidenceRow label="Destination account" account={evidence.destinationAccount} />
      </div>

      {evidence.hasMemo && (
        <p className="text-xs text-slate-400" role="status">
          This transaction included a memo. Memo content is not shown here.
        </p>
      )}

      <div>
        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Transaction hash
        </dt>
        <dd className="mt-0.5 break-all font-mono text-xs text-slate-300">
          {evidence.transactionHash}
        </dd>
        {explorerLink.ok ? (
          <a
            className="mt-2 inline-flex text-xs text-cyan-200 underline underline-offset-4 hover:text-cyan-100"
            href={explorerLink.href}
            rel="noopener noreferrer"
            target="_blank"
          >
            View on explorer
          </a>
        ) : (
          <p className="mt-2 text-xs text-slate-500">
            An explorer link could not be built for this evidence (
            {explorerLink.reason === "unsupported-network" ? "unsupported network" : "malformed identifier"}
            ).
          </p>
        )}
      </div>
    </section>
  );
}

function AccountEvidenceRow({
  label,
  account,
}: {
  label: string;
  account: PaymentOperationEvidence["sourceAccount"];
}) {
  const isMuxed = account.type === "muxed" || isMuxedAccountAddress(account.address);
  const decoded = isMuxed ? decodeMuxedAccount(account.address) : null;

  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 break-all font-mono text-xs text-slate-200">
        {account.address}
        {isMuxed && (
          <span className="ml-2 inline-flex rounded-full border border-cyan-300/30 px-2 py-0.5 text-[10px] font-semibold uppercase text-cyan-200">
            Muxed
          </span>
        )}
      </dd>
      {isMuxed && decoded && (
        <p className="mt-1 text-xs text-slate-400">
          Underlying account: <span className="font-mono">{decoded.underlyingAccount}</span>, mux ID{" "}
          {decoded.muxedId}
        </p>
      )}
      {isMuxed && !decoded && (
        <p className="mt-1 text-xs text-amber-300" role="alert">
          This address starts with &quot;M&quot; but could not be decoded as a valid muxed account.
        </p>
      )}
    </div>
  );
}
