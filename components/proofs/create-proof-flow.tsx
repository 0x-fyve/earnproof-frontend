"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { getAddress, requestAccess, signMessage } from "@stellar/freighter-api";
import { ArtifactExport } from "@/components/proofs/artifact-export";
import { PaymentListSkeleton } from "@/components/common/skeleton/payment-list-skeleton";
import { Redacted } from "@/components/common/redacted";
import { usePrivacy } from "@/contexts/privacy-context";
import { Timestamp } from "@/components/common/timestamp";
import { WalletConsentScreen } from "@/components/auth/wallet-consent-screen";
import { NetworkMismatchAlert } from "@/components/wallet/network-mismatch-alert";
import { appConfig } from "@/config/app";
import { apiClient, bearer } from "@/lib/api/client";
import { buildCredentialExport, buildVerificationLinkExport } from "@/lib/credentials/export";
import { resolveIdempotencyKey, type IdempotencyState } from "@/lib/proofs/idempotency";
import { createSubmissionGuard } from "@/lib/proofs/submission-guard";
import { useIdempotentOperation } from "@/lib/proofs/use-idempotent-operation";
import { OperationRecoveryPanel } from "@/components/common/operation-recovery-panel";
import {
  buildMinimumIncomeProofPayload,
  DEFAULT_PROOF_EXPIRES_IN_DAYS,
  type MinimumIncomeProofPayload,
} from "@/lib/proofs/minimum-income-payload";
import { useProofReviewGate } from "@/lib/proofs/useProofReviewGate";
import { ProofReviewSummary } from "@/components/proofs/proof-review-summary";
import {
  saveProofDraft,
  loadProofDraft,
  deleteProofDraft,
  type MinimumIncomeDraftData,
} from "@/lib/storage/proof-drafts";
import {
  isSigningAllowed,
  validateNetworkCompatibility,
} from "@/lib/wallet/network-compatibility";
import type {
  NetworkCompatibilityCheckResult,
  WalletNetworkContext,
} from "@/lib/wallet/types";
import {
  readStoredSession,
  storeSession,
  clearStoredSession,
  type SessionUser,
} from "@/lib/session";
import { useAnnounce } from "@/lib/a11y/announcer-context";

type PendingChallenge = {
  id: string;
  message: string;
  expiresAt: string;
  walletAddress: string;
};

type PaymentClassification =
  | "INCOME"
  | "REIMBURSEMENT"
  | "PERSONAL_TRANSFER"
  | "UNKNOWN"
  | "EXCLUDED";

type Payment = {
  id: string;
  stellarTransactionHash: string;
  sourceAddress: string;
  assetCode: string;
  assetIssuer: string | null;
  occurredAt: string;
  classification: PaymentClassification;
  isEligible: boolean;
};

type ProofResponse = {
  proofId: string;
  status: string;
  verificationUrl: string;
  credential: {
    proof: {
      credentialHash: string;
      signature: string;
    };
  };
};

export function CreateProofFlow() {
  const { isRedacted } = usePrivacy();
  const { announce } = useAnnounce();
  const initialSession = useMemo(() => readStoredSession(), []);
  
  // Load saved draft on mount (only non-secret fields)
  const savedDraft = useMemo(() => loadProofDraft<MinimumIncomeDraftData>('minimum-income'), []);
  
  const [token, setToken] = useState<string | null>(
    () => initialSession?.token ?? null,
  );
  const [user, setUser] = useState<SessionUser | null>(
    () => initialSession?.user ?? null,
  );
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>(() => savedDraft?.selectedPaymentIds ?? []);
  const [thresholdAmount, setThresholdAmount] = useState(() => savedDraft?.thresholdAmount ?? "100");
  const [periodStart, setPeriodStart] = useState(() => savedDraft?.periodStart ?? "2026-08-01");
  const [periodEnd, setPeriodEnd] = useState(() => savedDraft?.periodEnd ?? "2026-08-31");
  const [proof, setProof] = useState<ProofResponse | null>(null);
  const [pendingChallenge, setPendingChallenge] = useState<PendingChallenge | null>(null);
  const [isSigning, setIsSigning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmittingProof, setIsSubmittingProof] = useState(false);
  const [networkCompatibility, setNetworkCompatibility] =
    useState<NetworkCompatibilityCheckResult | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const networkAlertRef = useRef<HTMLDivElement>(null);
  const connectButtonRef = useRef<HTMLButtonElement>(null);
  const wasConnectedRef = useRef(Boolean(initialSession?.user));
  // Guards against duplicate proof-creation mutations: at most one active
  // submission, and only the response belonging to that submission may
  // update state. See lib/proofs/submission-guard.ts.
  const submissionGuardRef = useRef(createSubmissionGuard());
  const idempotencyRef = useRef<IdempotencyState | null>(null);
  const reviewGate = useProofReviewGate<MinimumIncomeProofPayload>();
  // #254: tracks a persisted idempotency key + recovery status for this
  // proof-creation attempt, scoped to the authenticated user (there is no
  // org-level tenant on SessionUser; the wallet-authenticated user is the
  // isolation boundary this flow has). Survives a page reload after a
  // client-side timeout, unlike submissionGuardRef/idempotencyRef above
  // (which only guard duplicate-fire within one component lifetime).
  const operation = useIdempotentOperation(user?.id ?? "anonymous", "proof-issuance");

  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
    }
  }, [error]);

  // Focus network alert when mismatch is detected so keyboard/screen-reader
  // users are alerted to the issue immediately.
  useEffect(() => {
    if (networkCompatibility && !networkCompatibility.isValid) {
      networkAlertRef.current?.focus();
    }
  }, [networkCompatibility]);

  // Restore focus to the "Connect Freighter" button after disconnecting so
  // keyboard focus doesn't fall back to <body> when the "Disconnect"
  // button it was on unmounts. Only fires on the connected -> disconnected
  // transition, not on initial mount.
  useEffect(() => {
    if (user) {
      wasConnectedRef.current = true;
    } else if (wasConnectedRef.current) {
      wasConnectedRef.current = false;
      connectButtonRef.current?.focus();
    }
  }, [user]);

  const selectedIncomePayments = useMemo(
    () =>
      payments.filter(
        (payment) =>
          selected.includes(payment.id) &&
          payment.classification === "INCOME" &&
          payment.isEligible,
      ),
    [payments, selected],
  );

  // The single source of truth for what would be submitted right now,
  // given the live form state. Both opening the review step and the
  // change-detection effect below call this same function, so "what the
  // user reviews" and "what gets submitted" can never independently drift.
  const currentPayload: MinimumIncomeProofPayload | null = useMemo(() => {
    if (selectedIncomePayments.length === 0) return null;
    const intent: ProofIntent = {
      selectedPaymentIds: selectedIncomePayments.map((payment) => payment.id),
      thresholdAmount,
      assetCode: selectedIncomePayments[0].assetCode,
      assetIssuer: selectedIncomePayments[0].assetIssuer ?? undefined,
      periodStart: `${periodStart}T00:00:00.000Z`,
      periodEnd: `${periodEnd}T23:59:59.000Z`,
    };
    return buildMinimumIncomeProofPayload(intent, DEFAULT_PROOF_EXPIRES_IN_DAYS);
  }, [selectedIncomePayments, thresholdAmount, periodStart, periodEnd]);

  // Any change to a live input this payload is built from invalidates a
  // prior confirmation — the user must review again before submitting.
  useEffect(() => {
    if (currentPayload) {
      reviewGate.refreshLiveSnapshot(currentPayload);
    }
    // reviewGate's functions are stable (useCallback with no deps), so it's
    // safe to omit it here and depend only on the payload's own identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPayload]);

  // Save draft whenever form values change (debounced via state update batching)
  // Only persist non-secret fields - never wallet signatures, tokens, or proof artifacts
  useEffect(() => {
    if (selected.length > 0 || thresholdAmount !== "100" || periodStart !== "2026-08-01" || periodEnd !== "2026-08-31") {
      const draftData: MinimumIncomeDraftData = {
        selectedPaymentIds: selected,
        thresholdAmount,
        periodStart,
        periodEnd,
      };
      saveProofDraft('minimum-income', draftData);
    }
  }, [selected, thresholdAmount, periodStart, periodEnd]);

  async function connectWallet() {
    setError(null);
    setNetworkCompatibility(null);
    setStatus("Requesting Freighter wallet access...");

    try {
      const walletAddress = await getFreighterAddress();
      if (!walletAddress) {
        setStatus(null);
        setError("Freighter was not found or did not return a Stellar address.");
        return;
      }

      // Detect wallet network context (may not be available in older wallet versions).
      const walletNetworkContext = await detectWalletNetworkContext();

      // Validate wallet network compatibility before proceeding with auth.
      const compatibility = validateNetworkCompatibility(walletNetworkContext);
      setNetworkCompatibility(compatibility);

      // If network compatibility is unknown, proceed anyway during auth - the backend
      // will validate the signature is correct for this network. If the wallet is on
      // the wrong network, the backend's network check will catch it.
      // Only block if explicitly incompatible (confirmed wrong network).
      if (compatibility.state === "incompatible") {
        setStatus(null);
        return;
      }

      const challenge = await apiClient<{
        id: string;
        message: string;
        expiresAt: string;
      }>({
        path: "/auth/challenge",
        method: "POST",
        body: JSON.stringify({ walletAddress }),
      });

      // Show the consent screen and wait for an explicit Continue before
      // signing, rather than immediately prompting Freighter.
      setStatus(null);
      setPendingChallenge({ ...challenge, walletAddress });
    } catch {
      setStatus(null);
      setError("Wallet connection failed. Check Freighter and try again.");
    }
  }

  function cancelWalletConsent() {
    setPendingChallenge(null);
    setStatus(null);
  }

  async function confirmWalletConsent() {
    if (!pendingChallenge) return;

    // Re-check the challenge hasn't expired between review and signing —
    // there's no push mechanism to detect a changed challenge otherwise.
    if (new Date(pendingChallenge.expiresAt).getTime() <= Date.now()) {
      setPendingChallenge(null);
      setError("This signature request expired. Please reconnect your wallet.");
      return;
    }

    setIsSigning(true);
    setError(null);
    setStatus("Waiting for wallet signature...");

    try {
      const { id: challengeId, message, walletAddress } = pendingChallenge;
      const signature = await signFreighterMessage(message, walletAddress);
      if (!signature) {
        setStatus(null);
        setError("Wallet did not return a signature for the challenge.");
        return;
      }

      const verified = await apiClient<{
        user: SessionUser;
        session: { token: string; tokenType: "Bearer" };
      }>({
        path: "/auth/verify",
        method: "POST",
        body: JSON.stringify({
          challengeId,
          walletAddress,
          signature,
        }),
      });

      storeSession({ token: verified.session.token, user: verified.user });
      setToken(verified.session.token);
      setUser(verified.user);
      setStatus("Wallet authenticated.");
      setPendingChallenge(null);
      // Clear network compatibility error after successful auth - the backend validated it
      setNetworkCompatibility(null);
    } catch {
      setStatus(null);
      setError("Wallet connection failed. Check Freighter and try again.");
    } finally {
      setIsSigning(false);
    }
  }

  async function syncPayments() {
    if (!token) {
      return;
    }

    setError(null);
    setStatus("Syncing incoming Stellar testnet payments...");
    setPaymentsLoading(true);

    try {
      await apiClient({
        path: "/payments/sync",
        method: "POST",
        headers: bearer(token),
      });
      await refreshPayments(token);
      setStatus("Payments synced.");
    } catch {
      setStatus(null);
      setError("Payment sync failed. Try again.");
    } finally {
      setPaymentsLoading(false);
    }
  }

  async function refreshPayments(activeToken = token) {
    if (!activeToken) {
      return;
    }

    setPaymentsLoading(true);
    try {
      const response = await apiClient<Payment[]>({
        path: "/payments",
        headers: bearer(activeToken),
      });
      setPayments(response);
    } catch {
      setError("Could not load payments. Try again.");
    } finally {
      setPaymentsLoading(false);
    }
  }

  async function updateClassification(
    paymentId: string,
    classification: PaymentClassification,
  ) {
    if (!token) {
      return;
    }

    setError(null);
    try {
      await apiClient<Payment>({
        path: `/payments/${paymentId}/classification`,
        method: "PATCH",
        headers: bearer(token),
        body: JSON.stringify({ classification }),
      });
      await refreshPayments(token);
    } catch {
      setError("Could not update the payment classification. Try again.");
    }
  }

  // Step 1: form submit opens (or re-opens) the review step instead of
  // calling the API directly. The actual mutation only happens from
  // submitProof(), gated on reviewGate.isConfirmed.
  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (reviewGate.isConfirmed && reviewGate.reviewedPayload) {
      void submitProof(reviewGate.reviewedPayload);
      return;
    }

    if (!token) {
      setError("Connect a wallet before creating a proof.");
      return;
    }
    if (!currentPayload) {
      setError("Select at least one eligible income payment.");
      return;
    }
    setError(null);
    reviewGate.openReview(currentPayload);
  }

  // Step 2: the actual mutation. `payload` is always the frozen snapshot
  // from reviewGate, never re-derived from live state, so this is
  // guaranteed byte-equivalent to what the user reviewed and confirmed.
  async function submitProof(payload: MinimumIncomeProofPayload) {
    if (!token) {
      setError("Connect a wallet before creating a proof.");
      return;
    }

    // Verify network compatibility before attempting to sign.
    if (networkCompatibility && !isSigningAllowed(networkCompatibility.state)) {
      setError(null);
      return;
    }

    // Reject a re-entrant call (a second click/Enter before the button's
    // disabled state has re-rendered, or any other double-fire of this
    // handler) instead of starting a second mutation. Only one submission
    // may be active for this form at a time.
    const submissionId = submissionGuardRef.current.begin();
    if (submissionId === null) {
      return;
    }

    setIsSubmittingProof(true);
    setError(null);
    setProof(null);
    setStatus("Creating signed minimum-income proof...");
    announce("Creating signed minimum-income proof.", { source: "proof-submission" });

    // A retry of the same intent (same selection, threshold, and period)
    // reuses the previous idempotency key; anything else mints a new one.
    // See lib/proofs/idempotency.ts.
    const intent: ProofIntent = {
      selectedPaymentIds: payload.selectedPaymentIds,
      thresholdAmount: payload.thresholdAmount,
      assetCode: payload.assetCode,
      assetIssuer: payload.assetIssuer,
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
    };
    const idempotency = resolveIdempotencyKey(idempotencyRef.current, intent);
    idempotencyRef.current = idempotency;
    // #254: a persisted, cross-reload record of this same intent. If the
    // request below times out client-side, this record (and its key)
    // survive so a later "resume" can check what actually happened instead
    // of silently retrying with a fresh key.
    operation.begin(intent);

    try {
      const created = await apiClient<ProofResponse>({
        path: "/proofs/minimum-income",
        method: "POST",
        headers: { ...bearer(token), "Idempotency-Key": idempotency.key },
        body: JSON.stringify(payload),
      });

      // Drop this response if something (a wallet disconnect, most likely)
      // invalidated this submission while the request was in flight — only
      // the response belonging to the still-current submission may update
      // success state.
      if (!submissionGuardRef.current.isCurrent(submissionId)) {
        return;
      }

      setProof(created);
      setStatus("Proof created.");
      // Deliberately does not include the proof id or credential hash: the
      // coordinator scrubs recognizable sensitive shapes defensively (see
      // lib/telemetry/redact.ts), but a status message should never depend
      // on that safety net to begin with (#252's "no secrets in
      // announcements" acceptance criterion).
      announce("Proof created.", { source: "proof-submission" });
      // The intent this key covered has now succeeded; a future click,
      // even with identical field values, is a new intent and should get
      // its own key rather than silently reusing a completed one.
      idempotencyRef.current = null;
      operation.markSucceeded();
      operation.reset();
      reviewGate.reset();
      // Clear draft after successful proof creation
      deleteProofDraft('minimum-income');
    } catch (submitError) {
      if (!submissionGuardRef.current.isCurrent(submissionId)) {
        return;
      }
      setStatus(null);
      // A client-side abort (request timeout, most likely) means the
      // server may have already accepted this proof before the response
      // was lost — that's the "unresolved" case #254 targets, so the
      // recovery panel (which polls rather than guessing) is offered
      // instead of a flat failure message. Any other error (validation,
      // auth, 5xx) is a real, observed failure and is safe to label as such.
      const isAbort = submitError instanceof DOMException && submitError.name === "AbortError";
      if (isAbort) {
        const message = "Proof creation timed out. We can't confirm whether it went through.";
        setError(message);
        announce(message, { politeness: "assertive", source: "proof-submission" });
      } else {
        operation.markFailed();
        const message = "Proof creation failed. Check the selected payments and try again.";
        setError(message);
        announce(message, { politeness: "assertive", source: "proof-submission" });
      }
    } finally {
      submissionGuardRef.current.end(submissionId);
      setIsSubmittingProof(false);
    }
  }

  // #254 recovery actions. "Resume" polls the bounded status endpoint for
  // the existing record rather than resubmitting; "retry" resubmits using
  // the SAME payload/idempotency key currently held by operation/idempotencyRef
  // (resolveIdempotencyKey already guarantees that reuse for an unchanged
  // intent), so a retry after a timeout can never mint a second key for
  // what might still be the original in-flight request.
  async function resumeProofOperation() {
    if (!token) return;
    await operation.resume(token);
  }

  function retryProofSubmission() {
    if (reviewGate.reviewedPayload) {
      void submitProof(reviewGate.reviewedPayload);
    }
  }

  function disconnect() {
    // Any proof-creation request still in flight belongs to a session that
    // no longer exists once the wallet is disconnected; invalidate it so
    // its eventual response can't resurrect proof/error state for a user
    // who has moved on, and so a fresh submit isn't stuck waiting on a
    // request that may never resolve.
    if (isSubmittingProof) {
      announce("Proof submission cancelled.", { source: "proof-submission" });
    }
    submissionGuardRef.current.invalidate();
    idempotencyRef.current = null;
    operation.reset();
    setIsSubmittingProof(false);
    clearStoredSession();
    setToken(null);
    setUser(null);
    setPayments([]);
    setSelected([]);
    setProof(null);
    setStatus(null);
    setError(null);
    setNetworkCompatibility(null);
  }

  function discardDraft() {
    deleteProofDraft('minimum-income');
    setSelected([]);
    setThresholdAmount("100");
    setPeriodStart("2026-08-01");
    setPeriodEnd("2026-08-31");
    setStatus("Draft discarded.");
  }

  return (
    <div className="grid gap-8 sm:gap-10">
      {pendingChallenge && (
        <WalletConsentScreen
          challenge={{
            origin: typeof window !== "undefined" ? window.location.origin : appConfig.apiUrl,
            network: appConfig.stellarNetwork,
            expiresAt: pendingChallenge.expiresAt,
            purpose: "Sign in to EarnProof",
          }}
          onContinue={confirmWalletConsent}
          onCancel={cancelWalletConsent}
          isProcessing={isSigning}
        />
      )}
      <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <div>
          <h2 className="text-xl font-semibold text-white">Wallet</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Authenticate with a Stellar testnet wallet before syncing payments.
          </p>
        </div>
        {user ? (
          <div className="grid min-w-0 gap-3 text-sm text-slate-300">
            {/*
              `break-words` (overflow-wrap) lets a long word wrap but does not
              reduce the element's min-content width, so a 56-character wallet
              address still forces the whole page ~400px wide - horizontal
              scrolling at 320 CSS px / 400% zoom. `break-all` (word-break)
              does reduce it, which is what an opaque identifier needs.
            */}
            <p className="break-all">
              Connected as <span className="text-cyan-200"><Redacted>{user.walletAddress}</Redacted></span>
            </p>
            {networkCompatibility && !networkCompatibility.isValid && (
              <NetworkMismatchAlert
                result={networkCompatibility}
                forwardRef={networkAlertRef}
              />
            )}
            <button
              className="h-10 w-fit rounded-md border border-white/15 px-4 text-xs font-semibold text-white"
              onClick={disconnect}
              type="button"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            className="h-10 w-fit rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950"
            onClick={connectWallet}
            ref={connectButtonRef}
            type="button"
          >
            Connect Freighter
          </button>
        )}
      </section>

      <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-semibold text-white">Payments</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Sync incoming payments, mark qualifying income, then select the
              payments to include in the proof calculation.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="h-10 rounded-md border border-white/15 px-4 text-xs font-semibold text-white disabled:opacity-50"
              disabled={!token}
              onClick={() => refreshPayments()}
              type="button"
            >
              Refresh
            </button>
            <button
              className="h-10 rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 disabled:opacity-50"
              disabled={!token}
              onClick={syncPayments}
              type="button"
            >
              Sync
            </button>
          </div>
        </div>

        <div className="grid gap-3">
          {paymentsLoading ? (
            <PaymentListSkeleton />
          ) : payments.length === 0 ? (
            <p className="rounded-md border border-white/10 bg-slate-950 p-4 text-sm text-slate-400">
              No payments loaded yet.
            </p>
          ) : (
            payments.map((payment) => (
              <PaymentRow
                isSelected={selected.includes(payment.id)}
                key={payment.id}
                onClassify={(classification) =>
                  updateClassification(payment.id, classification)
                }
                onToggle={() =>
                  setSelected((current) =>
                    current.includes(payment.id)
                      ? current.filter((id) => id !== payment.id)
                      : [...current, payment.id],
                  )
                }
                payment={payment}
              />
            ))
          )}
        </div>
      </section>

      <form
        className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5"
        onSubmit={handleFormSubmit}
      >
        <div>
          <h2 className="text-xl font-semibold text-white">Minimum Income Proof</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            The public credential discloses the threshold, period, asset,
            qualifying payment count, wallet hash, and proof status.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Field
            label="Threshold"
            onChange={setThresholdAmount}
            type="text"
            value={thresholdAmount}
          />
          <Field
            label="Period start"
            onChange={setPeriodStart}
            type="date"
            value={periodStart}
          />
          <Field
            label="Period end"
            onChange={setPeriodEnd}
            type="date"
            value={periodEnd}
          />
        </div>

        {reviewGate.reviewedPayload ? (
          <ProofReviewSummary
            payload={reviewGate.reviewedPayload}
            qualifyingPaymentCount={selectedIncomePayments.length}
            isConfirmed={reviewGate.isConfirmed}
            onConfirm={reviewGate.confirm}
            onCancel={reviewGate.cancel}
            isSubmitting={isSubmittingProof}
          />
        ) : (
          <div className="flex gap-2">
            <button
              aria-describedby={error ? "create-proof-feedback" : undefined}
              className="h-10 w-fit rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!token || selectedIncomePayments.length === 0 || isSubmittingProof}
              type="submit"
            >
              Review before creating
            </button>
            {savedDraft && (
              <button
                className="h-10 w-fit rounded-md border border-white/15 px-4 text-xs font-semibold text-white"
                onClick={discardDraft}
                type="button"
              >
                Discard Draft
              </button>
            )}
          </div>
        )}
      </form>

      {status || error || proof ? (
        <section
          className="rounded-lg border border-white/10 bg-slate-950 p-5 text-sm leading-6"
          id="create-proof-feedback"
        >
          {status ? (
            <p aria-live="polite" className="text-slate-300">
              {status}
            </p>
          ) : null}
          {error ? (
            <p
              aria-live="assertive"
              className="text-rose-200 focus-visible:outline-none"
              id="create-proof-error"
              ref={errorRef}
              role="alert"
              tabIndex={-1}
            >
              {error}
            </p>
          ) : null}
          {operation.record && operation.outcome && operation.outcome !== "succeeded" ? (
            <div className="mt-4">
              <OperationRecoveryPanel
                disableRetry={isSubmittingProof}
                idempotencyKey={operation.record.idempotencyKey}
                isPolling={operation.isPolling}
                onResume={resumeProofOperation}
                onRetry={retryProofSubmission}
                outcome={operation.outcome}
              />
            </div>
          ) : null}
          {proof ? (
            <div className="mt-4 grid gap-2 text-slate-300">
              <p>
                Proof ID: <span className="text-cyan-200"><Redacted>{proof.proofId}</Redacted></span>
              </p>
              <p className="break-words">
                Credential hash:{" "}
                <span className="text-cyan-200">
                  <Redacted>{proof.credential.proof.credentialHash}</Redacted>
                </span>
              </p>
              {!isRedacted && (
                <>
                  <a
                    className="w-fit text-cyan-200 underline underline-offset-4"
                    href={`/verify?proof=${encodeURIComponent(proof.proofId)}`}
                  >
                    Open public verification
                  </a>
                  <ArtifactExport
                    plan={buildVerificationLinkExport(
                      `${appConfig.appUrl}/verify?proof=${encodeURIComponent(proof.proofId)}`,
                    )}
                    title="Export verification link"
                  />
                  <ArtifactExport
                    plan={buildCredentialExport({
                      credential: proof.credential,
                    })}
                    title="Export credential JSON"
                  />
                </>
              )}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function PaymentRow({
  payment,
  isSelected,
  onToggle,
  onClassify,
}: {
  payment: Payment;
  isSelected: boolean;
  onToggle: () => void;
  onClassify: (classification: PaymentClassification) => void;
}) {
  const canSelect = payment.classification === "INCOME" && payment.isEligible;

  return (
    <div className="grid gap-3 rounded-md border border-white/10 bg-slate-950 p-4 text-sm text-slate-300 sm:min-h-24 sm:grid-cols-[auto_1fr_auto] sm:items-center">
      <input
        aria-label="Select payment"
        checked={isSelected}
        disabled={!canSelect}
        onChange={onToggle}
        type="checkbox"
      />
      <div className="min-w-0">
        <p className="font-medium text-white">
          {payment.assetCode} incoming payment
        </p>
        {/* Same reason as the wallet address above: an opaque hash needs
            word-break, not overflow-wrap, to stop forcing a minimum width. */}
        <p className="mt-1 break-all text-xs text-slate-400">
          <Redacted>{payment.stellarTransactionHash}</Redacted>
        </p>
        <Timestamp className="mt-1 block text-xs text-slate-400" value={payment.occurredAt} />
      </div>
      <select
        aria-label="Payment classification"
        className="h-10 rounded-md border border-white/10 bg-slate-900 px-3 text-white"
        onChange={(event) =>
          onClassify(event.target.value as PaymentClassification)
        }
        value={payment.classification}
      >
        <option value="UNKNOWN">Unknown</option>
        <option value="INCOME">Income</option>
        <option value="REIMBURSEMENT">Reimbursement</option>
        <option value="PERSONAL_TRANSFER">Personal transfer</option>
        <option value="EXCLUDED">Excluded</option>
      </select>
    </div>
  );
}

function Field({
  label,
  value,
  type,
  onChange,
}: {
  label: string;
  value: string;
  type: string;
  onChange: (value: string) => void;
}) {
  return (
    // `min-w-0` on the grid item and `w-full` on the control: without them
    // the input keeps its intrinsic width (a `date` input is wide by
    // default) and pushes past a narrow viewport, which forces horizontal
    // scrolling at 320 CSS px / 400% zoom.
    <label className="grid min-w-0 gap-2 text-sm font-medium text-slate-200">
      {label}
      <input
        className="h-11 w-full rounded-md border border-white/10 bg-slate-900 px-4 text-white"
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}

// The Freighter wallet SDK is loaded on demand, only once a worker actually
// starts the connect flow on this route. This keeps `@stellar/freighter-api`
// out of the initial First Load JS for /proofs (and, by construction,
// out of every public route that never renders this component).
async function loadFreighter(): Promise<{
  getAddress: typeof getAddress;
  requestAccess: typeof requestAccess;
  signMessage: typeof signMessage;
}> {
  return import("@stellar/freighter-api");
}

async function getFreighterAddress() {
  const freighter = await loadFreighter();
  const access = await freighter.requestAccess().catch(() => null);
  if (access?.address) {
    return access.address;
  }

  const address = await freighter.getAddress().catch(() => null);
  return address?.address ?? null;
}

/**
 * Detect wallet network context from Freighter.
 *
 * Freighter v5+ may report network information in the signMessage response.
 * Earlier versions do not expose this metadata. Returns an empty context object
 * if network detection fails or is not supported.
 *
 * Note: This is a preliminary detection call that does NOT send a signature
 * request to the user's wallet. It attempts to detect what network the wallet
 * is configured for through metadata inspection or trial call patterns.
 *
 * For now, we use an empty context as a safe default. In a production wallet
 * that supports network detection in the API, this function would query the
 * wallet's current network state without prompting the user.
 */
async function detectWalletNetworkContext(): Promise<WalletNetworkContext> {
  // In a future enhancement with wallet support for network detection API,
  // this would call freighter.getNetwork() or similar to detect the wallet's
  // current network without prompting the user for a signature.
  //
  // For now, return empty context. Network will be validated during the
  // signMessage call when we can extract it from the response or error.
  return {};
}

async function signFreighterMessage(message: string, walletAddress: string) {
  const freighter = await loadFreighter();
  const response = await freighter
    .signMessage(message, {
      networkPassphrase: appConfig.stellarNetworkPassphrase,
      address: walletAddress,
    })
    .catch(() => null);

  if (!response?.signedMessage) {
    return null;
  }

  if (typeof response.signedMessage === "string") {
    return response.signedMessage;
  }

  return bytesToBase64(response.signedMessage);
}

function bytesToBase64(value: Uint8Array) {
  let binary = "";
  value.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}
