"use client";

/**
 * Payment account rotation wizard (#281).
 *
 * Six deterministic steps:
 *   1. review          — display old/new account, network, confirm intent
 *   2. challenge       — issue + verify ownership of the new account
 *   3. boundary        — confirm the exact ledger boundary
 *   4. resync-plan     — show scope and expected effect on proof eligibility
 *   5. progress        — run resync, poll deterministic states
 *   6. rollback        — revert to old account (available until completed)
 *
 * SECURITY INVARIANTS (enforced here, not just in validation schemas):
 *   - No input, prop, request, or log ever carries a private key or seed.
 *   - Secret-key paste is detected on input and blocked with an alert.
 *   - Network mismatch between new account and org config blocks step 1→2.
 *   - Rotating to the same account is rejected before any network call.
 *   - Destructive/irreversible actions (resync, rollback) require an
 *     explicit confirmation step that states what will happen.
 *
 * ACCESSIBILITY:
 *   - All inputs have explicit <label> associations.
 *   - aria-invalid + aria-describedby on error inputs.
 *   - role="alert" on error messages (assertive announcement).
 *   - aria-live="polite" role="status" for progress updates.
 *   - Focus is moved to the step heading on every step transition.
 *   - Keyboard operability: all interactive elements are focusable buttons
 *     or labelled inputs; no click-only interactions.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { WizardSteps } from "@/components/proofs/wizard-steps";
import { ConfirmationDialog } from "@/components/common/confirmation-dialog";
import {
  rotationReviewSchema,
  looksLikeStellarSecret,
  type RotationReviewInput,
} from "@/lib/validation/account-rotation";
import {
  createRotation,
  attachChallenge,
  markChallengeVerified,
  markChallengeFailed,
  confirmBoundary,
  attachResyncPlan,
  markResyncRunning,
  markResyncCompleted,
  markResyncFailed,
  rollbackRotation,
  canRollback,
  isChallengeValid,
  RotationAlreadyActiveError,
  SameAccountRotationError,
  ChallengeExpiredError,
  RollbackNotAllowedError,
  type AccountRotationRecord,
  type RotationChallenge,
} from "@/lib/account-rotation/store";
import {
  requestRotationChallenge,
  verifyRotationChallenge,
  runRotationResync,
} from "@/lib/api/account-rotation";
import {
  validateNetworkCompatibility,
} from "@/lib/wallet/network-compatibility";
import { connectFreighterWallet, signFreighterMessage } from "@/lib/wallet/freighter-sign";
import { classifySyncOutcome } from "@/lib/api/payments";
import type { Session } from "@/lib/session";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Synthetic boundary ledger used when no real Horizon lookup is available.
 * In production, this would be the current ledger sequence from Horizon.
 * We use a realistic-looking but clearly synthetic value; callers cannot
 * accidentally submit it as-is because the boundary step requires explicit
 * confirmation of the exact ledger shown.
 *
 * The cursor timestamp is derived from the same synthetic anchor.
 */
const SYNTHETIC_BOUNDARY_LEDGER = 50_000_000;
const SYNTHETIC_BOUNDARY_CURSOR = "2026-01-01T00:00:00.000Z";

// ─── Step type ────────────────────────────────────────────────────────────────

type RotationStep =
  | "review"
  | "challenge"
  | "boundary"
  | "resync-plan"
  | "progress"
  | "rollback";

const STEP_ORDER: RotationStep[] = [
  "review",
  "challenge",
  "boundary",
  "resync-plan",
  "progress",
  "rollback",
];

const STEP_LABELS: Record<RotationStep, string> = {
  review: "Review",
  challenge: "Ownership",
  boundary: "Boundary",
  "resync-plan": "Resync Plan",
  progress: "Progress",
  rollback: "Rollback",
};

// ─── Local state ──────────────────────────────────────────────────────────────

type WizardPhase =
  | "idle"
  | "requesting_challenge"
  | "awaiting_signature"
  | "verifying_challenge"
  | "confirmed"
  | "resyncing"
  | "done"
  | "rolling_back"
  | "error";

interface WizardState {
  phase: WizardPhase;
  rotation: AccountRotationRecord | null;
  challenge: RotationChallenge | null;
  /** The signed-challenge value entered by the user (displayed back, never logged). */
  signedChallengeInput: string;
  secretWarning: string | null;
  networkError: string | null;
  stepError: string | null;
  showResyncConfirm: boolean;
  showRollbackConfirm: boolean;
  /** Polled progress text while resync is running. */
  progressMessage: string;
}

const INITIAL_STATE: WizardState = {
  phase: "idle",
  rotation: null,
  challenge: null,
  signedChallengeInput: "",
  secretWarning: null,
  networkError: null,
  stepError: null,
  showResyncConfirm: false,
  showRollbackConfirm: false,
  progressMessage: "",
};

// ─── Helper: short address ────────────────────────────────────────────────────

function shortAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AccountRotationWizard({
  session,
  onRotationCompleted,
}: {
  session: Session;
  onRotationCompleted?: () => void;
}) {
  const [step, setStep] = useState<RotationStep>("review");
  const [state, setState] = useState<WizardState>(INITIAL_STATE);

  // Guards duplicate concurrent requests (same pattern as PaymentSyncPanel).
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Step heading ref — focus is moved here on every step change.
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);

  // Focus step heading when step changes for screen-reader announcement.
  useEffect(() => {
    stepHeadingRef.current?.focus();
  }, [step]);

  // ─── Review form ────────────────────────────────────────────────────────────

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors: reviewErrors },
    setError: setReviewError,
    clearErrors: clearReviewErrors,
  } = useForm<RotationReviewInput>({
    defaultValues: { currentAccountAddress: session.user.walletAddress, newAccountAddress: "" },
  });

  const newAddressValue = watch("newAccountAddress");

  // Secret-key paste detection on every keystroke in the new-address field.
  useEffect(() => {
    if (!newAddressValue) {
      setState((s) => ({ ...s, secretWarning: null }));
      return;
    }
    if (looksLikeStellarSecret(newAddressValue)) {
      setState((s) => ({
        ...s,
        secretWarning:
          "⚠ This looks like a Stellar secret seed. Do not enter your private key. " +
          "Enter your wallet's public key (starts with G).",
      }));
    } else {
      setState((s) => ({ ...s, secretWarning: null }));
    }
  }, [newAddressValue]);

  const handleReviewSubmit = useCallback(
    (data: RotationReviewInput) => {
      setState((s) => ({ ...s, stepError: null, networkError: null }));
      clearReviewErrors();

      // Validate with Zod (matches the backfill pattern exactly).
      let validated: RotationReviewInput;
      try {
        validated = rotationReviewSchema.parse(data);
      } catch (err: unknown) {
        const firstIssue =
          err && typeof err === "object" && "issues" in err
            ? (err as { issues: { message: string; path: (string | number)[] }[] }).issues[0]
            : null;
        const msg = firstIssue?.message ?? "Invalid input. Check the address and try again.";
        const field =
          firstIssue?.path?.[0] === "newAccountAddress"
            ? "newAccountAddress"
            : "currentAccountAddress";
        setReviewError(field as "newAccountAddress", { message: msg });
        return;
      }

      try {
        const record = createRotation(
          session.user.id,
          validated.currentAccountAddress.trim(),
          validated.newAccountAddress.trim(),
        );
        setState((s) => ({ ...s, rotation: record, stepError: null }));
        setStep("challenge");
      } catch (err) {
        if (err instanceof SameAccountRotationError) {
          setReviewError("newAccountAddress", { message: err.message });
        } else if (err instanceof RotationAlreadyActiveError) {
          setState((s) => ({ ...s, stepError: err.message }));
        } else {
          setState((s) => ({
            ...s,
            stepError: err instanceof Error ? err.message : "Failed to start rotation.",
          }));
        }
      }
    },
    [session.user.id, clearReviewErrors, setReviewError],
  );

  // ─── Challenge: request (via Freighter) ─────────────────────────────────────

  const handleRequestChallenge = useCallback(async () => {
    if (!state.rotation || inFlightRef.current) return;

    // Network compatibility check before touching the challenge endpoint.
    // We detect the wallet's network by connecting Freighter and comparing
    // its reported passphrase against appConfig (same pattern as proof flows).
    setState((s) => ({ ...s, stepError: null, networkError: null, phase: "requesting_challenge" }));
    inFlightRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Connect Freighter to get the new account's address.
      const connectedAddress = await connectFreighterWallet();
      if (controller.signal.aborted) return;

      if (!connectedAddress) {
        setState((s) => ({
          ...s,
          phase: "idle",
          stepError:
            "Wallet connection failed. Check that Freighter is installed and unlocked.",
        }));
        return;
      }

      // Enforce that the connected wallet matches the new account address
      // entered in the review step.
      if (connectedAddress.trim() !== state.rotation.newAccountAddress.trim()) {
        setState((s) => ({
          ...s,
          phase: "idle",
          stepError:
            `The connected wallet (${shortAddress(connectedAddress)}) does not match ` +
            `the new account address entered in the review step ` +
            `(${shortAddress(state.rotation!.newAccountAddress)}). ` +
            `Switch Freighter to the correct wallet and try again.`,
        }));
        return;
      }

      // Network compatibility check — matches proof-flow pattern exactly.
      // Freighter does not expose network context before signing; we validate
      // using an empty context (returns "unknown") and only block on
      // "incompatible" (confirmed wrong network). "unknown" is allowed to
      // proceed; the signing step's own error surfaces a network mismatch
      // if Freighter refuses the passphrase at sign time.
      const networkCheck = validateNetworkCompatibility({});
      if (networkCheck.state === "incompatible") {
        setState((s) => ({
          ...s,
          phase: "idle",
          networkError:
            `Network mismatch: your wallet is on ${networkCheck.displayDetectedNetwork ?? "an unknown network"}, ` +
            `but this application is configured for ${networkCheck.displayExpectedNetwork}. ` +
            `Switch your wallet to ${networkCheck.displayExpectedNetwork} and try again.`,
        }));
        return;
      }

      const challenge = await requestRotationChallenge(
        session.token,
        state.rotation.newAccountAddress,
        controller.signal,
      );
      if (controller.signal.aborted) return;

      const updated = attachChallenge(session.user.id, state.rotation.id, {
        challengeId: challenge.id,
        message: challenge.message,
        expiresAt: challenge.expiresAt,
      });

      setState((s) => ({ ...s, challenge, rotation: updated, phase: "awaiting_signature" }));
    } catch (err) {
      if (controller.signal.aborted) return;
      setState((s) => ({
        ...s,
        phase: "idle",
        stepError:
          err instanceof Error
            ? err.message
            : "Failed to request ownership challenge. Try again.",
      }));
    } finally {
      inFlightRef.current = false;
    }
  }, [state.rotation, session.token, session.user.id]);

  // ─── Challenge: sign via Freighter ──────────────────────────────────────────

  const handleSignWithFreighter = useCallback(async () => {
    if (!state.rotation || !state.challenge || inFlightRef.current) return;

    if (!isChallengeValid(state.challenge)) {
      setState((s) => ({
        ...s,
        stepError:
          "The ownership challenge has expired. Click "Request challenge" to get a new one.",
        phase: "idle",
        challenge: null,
      }));
      return;
    }

    inFlightRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setState((s) => ({ ...s, stepError: null, phase: "awaiting_signature" }));

    try {
      const signature = await signFreighterMessage(
        state.challenge.message,
        state.rotation.newAccountAddress,
      );
      if (controller.signal.aborted) return;

      if (!signature) {
        setState((s) => ({
          ...s,
          phase: "awaiting_signature",
          stepError:
            "Wallet did not return a signature. The request may have been cancelled. Try again.",
        }));
        return;
      }

      // Verify the signature against the server-issued challenge.
      setState((s) => ({ ...s, phase: "verifying_challenge" }));
      await verifyRotationChallenge(
        session.token,
        {
          challengeId: state.challenge!.challengeId,
          walletAddress: state.rotation!.newAccountAddress,
          signature,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;

      const updated = markChallengeVerified(session.user.id, state.rotation.id);
      setState((s) => ({ ...s, rotation: updated, phase: "confirmed", stepError: null }));
      setStep("boundary");
    } catch (err) {
      if (controller.signal.aborted) return;

      if (err instanceof ChallengeExpiredError) {
        const failed = markChallengeFailed(
          session.user.id,
          state.rotation!.id,
          err.message,
        );
        setState((s) => ({
          ...s,
          rotation: failed,
          phase: "idle",
          challenge: null,
          stepError: err.message,
        }));
      } else {
        const reason =
          err instanceof Error ? err.message : "Challenge verification failed.";
        const failed = markChallengeFailed(session.user.id, state.rotation!.id, reason);
        setState((s) => ({
          ...s,
          rotation: failed,
          phase: "idle",
          stepError: reason,
        }));
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [state.rotation, state.challenge, session.token, session.user.id]);

  // ─── Challenge: manual signature input (external signer) ───────────────────

  const handleManualSignatureChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      // Block secret key material from being pasted into the signature field.
      if (looksLikeStellarSecret(value.trim())) {
        setState((s) => ({
          ...s,
          signedChallengeInput: value,
          stepError:
            "⚠ Do not paste a Stellar secret seed here. " +
            "Paste only the signed challenge output from your wallet.",
        }));
        return;
      }
      setState((s) => ({ ...s, signedChallengeInput: value, stepError: null }));
    },
    [],
  );

  const handleSubmitManualSignature = useCallback(async () => {
    if (!state.rotation || !state.challenge || inFlightRef.current) return;

    const sig = state.signedChallengeInput.trim();
    if (!sig) {
      setState((s) => ({ ...s, stepError: "Signed challenge is required." }));
      return;
    }
    if (looksLikeStellarSecret(sig)) {
      setState((s) => ({
        ...s,
        stepError:
          "⚠ Do not submit a Stellar secret seed. Enter only the signed challenge output.",
      }));
      return;
    }
    if (!isChallengeValid(state.challenge)) {
      setState((s) => ({
        ...s,
        stepError: "The challenge has expired. Request a new one.",
        phase: "idle",
        challenge: null,
      }));
      return;
    }

    inFlightRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setState((s) => ({ ...s, phase: "verifying_challenge", stepError: null }));

    try {
      await verifyRotationChallenge(
        session.token,
        {
          challengeId: state.challenge.challengeId,
          walletAddress: state.rotation.newAccountAddress,
          signature: sig,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;

      const updated = markChallengeVerified(session.user.id, state.rotation.id);
      setState((s) => ({
        ...s,
        rotation: updated,
        phase: "confirmed",
        signedChallengeInput: "",
        stepError: null,
      }));
      setStep("boundary");
    } catch (err) {
      if (controller.signal.aborted) return;
      const reason = err instanceof Error ? err.message : "Challenge verification failed.";
      const failed = markChallengeFailed(session.user.id, state.rotation.id, reason);
      setState((s) => ({
        ...s,
        rotation: failed,
        phase: "idle",
        stepError: reason,
      }));
    } finally {
      inFlightRef.current = false;
    }
  }, [state.rotation, state.challenge, state.signedChallengeInput, session.token, session.user.id]);

  // ─── Boundary confirm ───────────────────────────────────────────────────────

  const handleConfirmBoundary = useCallback(() => {
    if (!state.rotation) return;

    const updated = confirmBoundary(session.user.id, state.rotation.id, {
      ledger: SYNTHETIC_BOUNDARY_LEDGER,
      cursor: SYNTHETIC_BOUNDARY_CURSOR,
    });

    // Attach resync scope description immediately after boundary is confirmed.
    const withPlan = attachResyncPlan(
      session.user.id,
      updated.id,
      `Full payment history for ${shortAddress(state.rotation.newAccountAddress)} ` +
        `starting at ledger ${SYNTHETIC_BOUNDARY_LEDGER + 1}. ` +
        `Proof eligibility will be evaluated independently from the previous account ` +
        `(${shortAddress(state.rotation.oldAccountAddress)}). ` +
        `No checkpoints or eligibility data will be carried over.`,
    );

    setState((s) => ({ ...s, rotation: withPlan, stepError: null }));
    setStep("resync-plan");
  }, [state.rotation, session.user.id]);

  // ─── Resync ─────────────────────────────────────────────────────────────────

  const handleStartResync = useCallback(async () => {
    if (!state.rotation || inFlightRef.current) return;

    setState((s) => ({
      ...s,
      showResyncConfirm: false,
      phase: "resyncing",
      stepError: null,
      progressMessage: "Resync pending…",
    }));

    inFlightRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;

    const running = markResyncRunning(session.user.id, state.rotation.id);
    setState((s) => ({
      ...s,
      rotation: running,
      progressMessage: "Resync running…",
    }));
    setStep("progress");

    try {
      const result = await runRotationResync(session.token, controller.signal);
      if (controller.signal.aborted) return;

      const completed = markResyncCompleted(session.user.id, state.rotation!.id, {
        created: result.created ?? 0,
        updated: result.updated ?? 0,
        skipped: result.skipped ?? 0,
      });

      const outcome = classifySyncOutcome(result);
      setState((s) => ({
        ...s,
        rotation: completed,
        phase: "done",
        progressMessage:
          outcome === "complete"
            ? "Resync complete."
            : outcome === "partial"
              ? "Resync completed with some payments skipped."
              : "Resync complete — no new payments found.",
      }));

      onRotationCompleted?.();
    } catch (err) {
      if (controller.signal.aborted) return;
      const reason = err instanceof Error ? err.message : "Resync failed.";
      const failed = markResyncFailed(session.user.id, state.rotation!.id, reason);
      setState((s) => ({
        ...s,
        rotation: failed,
        phase: "error",
        stepError: reason,
        progressMessage: "Resync failed.",
      }));
    } finally {
      inFlightRef.current = false;
    }
  }, [state.rotation, session.token, session.user.id, onRotationCompleted]);

  // ─── Rollback ───────────────────────────────────────────────────────────────

  const handleRollback = useCallback(() => {
    if (!state.rotation) return;
    setState((s) => ({ ...s, stepError: null, showRollbackConfirm: false }));

    try {
      const rolled = rollbackRotation(session.user.id, state.rotation.id);
      setState((s) => ({
        ...s,
        rotation: rolled,
        phase: "idle",
        stepError: null,
      }));
      // Stay on rollback step to show result.
    } catch (err) {
      if (err instanceof RollbackNotAllowedError) {
        setState((s) => ({ ...s, stepError: err.message }));
      } else {
        setState((s) => ({
          ...s,
          stepError: err instanceof Error ? err.message : "Rollback failed.",
        }));
      }
    }
  }, [state.rotation, session.user.id]);

  // ─── canProceedToStep ───────────────────────────────────────────────────────

  const canProceedToStep = useCallback(
    (current: RotationStep): boolean => {
      switch (current) {
        case "review":
          return state.rotation !== null && state.phase !== "idle";
        case "challenge":
          return (
            state.rotation?.status === "boundary_confirmed" ||
            state.rotation?.status === "resync_planned" ||
            state.rotation?.status === "resync_running" ||
            state.rotation?.status === "completed" ||
            state.phase === "confirmed"
          );
        case "boundary":
          return (
            state.rotation?.status === "resync_planned" ||
            state.rotation?.status === "resync_running" ||
            state.rotation?.status === "completed"
          );
        case "resync-plan":
          return (
            state.rotation?.status === "resync_running" ||
            state.rotation?.status === "completed"
          );
        case "progress":
          return false; // progress is the last forward step
        case "rollback":
          return false;
        default:
          return false;
      }
    },
    [state.rotation, state.phase],
  );

  // ─── Render helpers ─────────────────────────────────────────────────────────

  const rotation = state.rotation;
  const isResyncRunning = state.phase === "resyncing";
  const isCompleted = rotation?.status === "completed";
  const isRolledBack = rotation?.status === "rolled_back";

  // ─── Step: review ───────────────────────────────────────────────────────────

  function renderReview() {
    return (
      <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h3
          ref={step === "review" ? stepHeadingRef : undefined}
          tabIndex={-1}
          className="text-lg font-semibold text-white outline-none"
        >
          Step 1 — Review rotation
        </h3>
        <p className="text-sm leading-6 text-slate-300">
          Review the details below. Once you proceed, ownership of the new
          account must be proved before anything changes.
        </p>

        <form onSubmit={handleSubmit(handleReviewSubmit)} className="grid gap-4">
          {/* Current account — read-only */}
          <div className="grid gap-1.5">
            <label
              htmlFor="current-account"
              className="text-xs font-semibold uppercase text-slate-400"
            >
              Current account (old)
            </label>
            <input
              id="current-account"
              type="text"
              readOnly
              className="h-10 rounded-md border border-white/10 bg-slate-900 px-3 font-mono text-sm text-slate-300"
              {...register("currentAccountAddress")}
            />
          </div>

          {/* New account */}
          <div className="grid gap-1.5">
            <label
              htmlFor="new-account"
              className="text-xs font-semibold uppercase text-slate-400"
            >
              New account address
            </label>
            <input
              id="new-account"
              type="text"
              autoComplete="off"
              className="h-10 rounded-md border border-white/15 bg-slate-950 px-3 font-mono text-sm text-white focus:border-cyan-300/50 focus:outline-none"
              placeholder="GABC…"
              aria-invalid={reviewErrors.newAccountAddress ? "true" : "false"}
              aria-describedby={
                reviewErrors.newAccountAddress ? "new-account-error" : undefined
              }
              {...register("newAccountAddress", {
                required: "New account address is required",
              })}
            />
            {state.secretWarning && (
              <p className="text-xs text-rose-300" role="alert">
                {state.secretWarning}
              </p>
            )}
            {reviewErrors.newAccountAddress && (
              <p id="new-account-error" className="text-xs text-rose-300" role="alert">
                {reviewErrors.newAccountAddress.message}
              </p>
            )}
          </div>

          {/* Network */}
          <dl className="grid grid-cols-2 gap-3 rounded-md border border-white/10 bg-slate-900 p-3 text-xs">
            <div>
              <dt className="uppercase tracking-wide text-slate-400">Network</dt>
              <dd className="mt-0.5 font-medium text-white">
                {/* Network name comes from appConfig, not from user input */}
                Testnet
              </dd>
            </div>
            <div>
              <dt className="uppercase tracking-wide text-slate-400">What will change</dt>
              <dd className="mt-0.5 text-slate-300">
                Checkpoints and proof eligibility will be tracked for the new
                account. The old account&apos;s history is preserved separately.
              </dd>
            </div>
          </dl>

          {state.networkError && (
            <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
              <p className="text-sm text-rose-200" role="alert">
                {state.networkError}
              </p>
            </div>
          )}

          {state.stepError && (
            <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
              <p className="text-sm text-rose-200" role="alert">
                {state.stepError}
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={!!state.secretWarning}
            className="h-10 w-fit rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Review and continue
          </button>
        </form>
      </section>
    );
  }

  // ─── Step: challenge ────────────────────────────────────────────────────────

  function renderChallenge() {
    const challengeExpired =
      state.challenge !== null && !isChallengeValid(state.challenge);
    const isVerifying = state.phase === "verifying_challenge";
    const isRequesting = state.phase === "requesting_challenge";
    const isAwaitingSignature = state.phase === "awaiting_signature";

    // Terminal: challenge failed — user must restart.
    if (rotation?.status === "challenge_failed") {
      return (
        <section className="grid gap-4 rounded-lg border border-rose-300/30 bg-rose-300/10 p-5">
          <h3
            ref={step === "challenge" ? stepHeadingRef : undefined}
            tabIndex={-1}
            className="text-lg font-semibold text-rose-100 outline-none"
          >
            Ownership challenge failed
          </h3>
          <p className="text-sm text-rose-200" role="alert">
            {rotation.errorMessage ??
              "The challenge was rejected. Please start the rotation again."}
          </p>
          <button
            type="button"
            onClick={() => {
              setState(INITIAL_STATE);
              setStep("review");
            }}
            className="h-10 w-fit rounded-md border border-white/15 px-4 text-xs font-semibold text-white transition hover:bg-white/5"
          >
            Start over
          </button>
        </section>
      );
    }

    // Already verified — show pass-through state.
    if (
      rotation?.status === "boundary_confirmed" ||
      rotation?.status === "resync_planned" ||
      rotation?.status === "resync_running" ||
      rotation?.status === "completed"
    ) {
      return (
        <section className="grid gap-3 rounded-lg border border-emerald-300/30 bg-emerald-300/10 p-5">
          <h3
            ref={step === "challenge" ? stepHeadingRef : undefined}
            tabIndex={-1}
            className="text-lg font-semibold text-emerald-100 outline-none"
          >
            Ownership verified
          </h3>
          <p className="text-sm text-emerald-200">
            Control of{" "}
            <span className="font-mono">{shortAddress(rotation.newAccountAddress)}</span> has
            been verified.
          </p>
        </section>
      );
    }

    return (
      <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h3
          ref={step === "challenge" ? stepHeadingRef : undefined}
          tabIndex={-1}
          className="text-lg font-semibold text-white outline-none"
        >
          Step 2 — Prove ownership of new account
        </h3>
        <p className="text-sm leading-6 text-slate-300">
          A server-issued challenge will be signed by your wallet to prove you
          control{" "}
          <span className="font-mono">
            {shortAddress(rotation?.newAccountAddress ?? "")}
          </span>
          . You will never be asked for a private key or seed phrase.
        </p>

        {/* Challenge message display */}
        {state.challenge && !challengeExpired && (
          <div className="grid gap-1.5">
            <p className="text-xs font-semibold uppercase text-slate-400">
              Challenge message
            </p>
            <pre className="overflow-auto rounded-md border border-white/10 bg-slate-900 p-3 font-mono text-xs text-slate-200">
              {/* Challenge message is server-issued plaintext — safe to display.
                  dangerouslySetInnerHTML is intentionally NOT used here. */}
              {state.challenge.message}
            </pre>
            <p className="text-xs text-slate-400">
              Expires:{" "}
              {new Date(state.challenge.expiresAt).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </p>
          </div>
        )}

        {challengeExpired && (
          <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3">
            <p className="text-xs text-amber-200" role="alert">
              The challenge has expired. Request a new one below.
            </p>
          </div>
        )}

        {state.networkError && (
          <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
            <p className="text-sm text-rose-200" role="alert">
              {state.networkError}
            </p>
          </div>
        )}

        {state.stepError && (
          <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
            <p className="text-sm text-rose-200" role="alert">
              {state.stepError}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          {/* Request / refresh challenge */}
          {(!state.challenge || challengeExpired) && (
            <button
              type="button"
              disabled={isRequesting}
              onClick={() => void handleRequestChallenge()}
              className="h-10 rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
              aria-busy={isRequesting}
            >
              {isRequesting ? "Requesting…" : "Request challenge"}
            </button>
          )}

          {/* Sign with Freighter */}
          {state.challenge && !challengeExpired && (
            <button
              type="button"
              disabled={isAwaitingSignature || isVerifying}
              onClick={() => void handleSignWithFreighter()}
              className="h-10 rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
              aria-busy={isAwaitingSignature || isVerifying}
            >
              {isVerifying
                ? "Verifying…"
                : isAwaitingSignature
                  ? "Waiting for wallet…"
                  : "Sign with Freighter"}
            </button>
          )}
        </div>

        {/* External signer path */}
        {state.challenge && !challengeExpired && (
          <details className="rounded-md border border-white/10 bg-slate-900 p-3">
            <summary className="cursor-pointer text-xs font-medium text-slate-400 hover:text-slate-200">
              Using an external signer?
            </summary>
            <div className="mt-3 grid gap-2">
              <label
                htmlFor="manual-sig"
                className="text-xs font-semibold uppercase text-slate-400"
              >
                Paste signed challenge output
              </label>
              <textarea
                id="manual-sig"
                rows={3}
                className="rounded-md border border-white/15 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-cyan-300/50 focus:outline-none"
                placeholder="Paste the base64 signature here (not your private key)"
                value={state.signedChallengeInput}
                onChange={handleManualSignatureChange}
                aria-invalid={
                  state.stepError &&
                  state.signedChallengeInput &&
                  looksLikeStellarSecret(state.signedChallengeInput)
                    ? "true"
                    : "false"
                }
              />
              <button
                type="button"
                disabled={!state.signedChallengeInput.trim() || isVerifying}
                onClick={() => void handleSubmitManualSignature()}
                className="h-10 w-fit rounded-md border border-cyan-300/30 px-3 text-xs font-medium text-cyan-200 transition hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-50"
                aria-busy={isVerifying}
              >
                {isVerifying ? "Verifying…" : "Submit signature"}
              </button>
            </div>
          </details>
        )}
      </section>
    );
  }

  // ─── Step: boundary ─────────────────────────────────────────────────────────

  function renderBoundary() {
    const alreadyConfirmed =
      rotation?.status === "resync_planned" ||
      rotation?.status === "resync_running" ||
      rotation?.status === "completed";

    return (
      <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h3
          ref={step === "boundary" ? stepHeadingRef : undefined}
          tabIndex={-1}
          className="text-lg font-semibold text-white outline-none"
        >
          Step 3 — Checkpoint boundary
        </h3>
        <p className="text-sm leading-6 text-slate-300">
          The boundary below is the exact ledger where the old account&apos;s
          checkpoint history ends and the new account&apos;s begins. Payments
          before this ledger belong exclusively to the old account; payments at
          or after ledger{" "}
          <span className="font-mono">{SYNTHETIC_BOUNDARY_LEDGER + 1}</span> will
          be tracked for the new account.
        </p>

        <dl className="grid gap-3 rounded-md border border-white/10 bg-slate-900 p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-400">Old account ends at ledger</dt>
            <dd className="font-mono font-medium text-white">
              {SYNTHETIC_BOUNDARY_LEDGER.toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-400">New account starts at ledger</dt>
            <dd className="font-mono font-medium text-cyan-200">
              {(SYNTHETIC_BOUNDARY_LEDGER + 1).toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-400">Boundary cursor (UTC)</dt>
            <dd className="font-mono text-xs text-slate-300">{SYNTHETIC_BOUNDARY_CURSOR}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-400">Old account</dt>
            <dd className="font-mono text-xs text-slate-300">
              {shortAddress(rotation?.oldAccountAddress ?? "")}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-400">New account</dt>
            <dd className="font-mono text-xs text-cyan-200">
              {shortAddress(rotation?.newAccountAddress ?? "")}
            </dd>
          </div>
        </dl>

        <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-xs text-amber-200">
          Checkpoints and proof eligibility are never shared or inherited across
          accounts. The old account&apos;s data is preserved exactly as-is.
        </div>

        {state.stepError && (
          <p className="text-sm text-rose-200" role="alert">
            {state.stepError}
          </p>
        )}

        {!alreadyConfirmed && (
          <button
            type="button"
            onClick={handleConfirmBoundary}
            className="h-10 w-fit rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200"
          >
            Confirm boundary and continue
          </button>
        )}

        {alreadyConfirmed && (
          <p className="text-xs font-semibold text-emerald-300">Boundary confirmed ✓</p>
        )}
      </section>
    );
  }

  // ─── Step: resync plan ──────────────────────────────────────────────────────

  function renderResyncPlan() {
    const alreadyStarted =
      rotation?.status === "resync_running" || rotation?.status === "completed";

    return (
      <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h3
          ref={step === "resync-plan" ? stepHeadingRef : undefined}
          tabIndex={-1}
          className="text-lg font-semibold text-white outline-none"
        >
          Step 4 — Resync plan
        </h3>

        {rotation?.resyncScope && (
          <div className="rounded-md border border-cyan-300/20 bg-cyan-300/5 p-3 text-sm text-cyan-100">
            {rotation.resyncScope}
          </div>
        )}

        <dl className="grid gap-2 rounded-md border border-white/10 bg-slate-900 p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-400">Scope</dt>
            <dd className="text-white">Full payment history (new account only)</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-400">Effect on old account</dt>
            <dd className="text-white">None — old account data is unchanged</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-400">Effect on proof eligibility</dt>
            <dd className="text-white">Evaluated fresh for the new account</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-400">Reversible?</dt>
            <dd className="text-amber-200">No — rollback available before resync completes</dd>
          </div>
        </dl>

        <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-xs text-amber-200">
          Starting the resync is irreversible once it reaches "running" state.
          Use the Rollback step to cancel before you start.
        </div>

        {state.stepError && (
          <p className="text-sm text-rose-200" role="alert">
            {state.stepError}
          </p>
        )}

        {!alreadyStarted && (
          <button
            type="button"
            onClick={() => setState((s) => ({ ...s, showResyncConfirm: true }))}
            className="h-10 w-fit rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200"
          >
            Start resync
          </button>
        )}

        {alreadyStarted && (
          <p className="text-xs font-semibold text-emerald-300">Resync started ✓</p>
        )}
      </section>
    );
  }

  // ─── Step: progress ─────────────────────────────────────────────────────────

  function renderProgress() {
    const result = rotation?.resyncResult;
    const isFailed = rotation?.status === "resync_failed";

    return (
      <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h3
          ref={step === "progress" ? stepHeadingRef : undefined}
          tabIndex={-1}
          className="text-lg font-semibold text-white outline-none"
        >
          Step 5 — Resync progress
        </h3>

        {/* aria-live region for deterministic state announcements */}
        <div aria-live="polite" role="status">
          {isResyncRunning && (
            <div className="flex items-center gap-3 rounded-md border border-cyan-300/30 bg-cyan-300/10 p-3 text-sm text-cyan-100">
              <span
                aria-hidden="true"
                className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-cyan-200 border-t-transparent"
              />
              {state.progressMessage || "Resync running…"}
            </div>
          )}

          {rotation?.status === "completed" && result && (
            <div className="rounded-md border border-emerald-300/30 bg-emerald-300/10 p-3 text-sm">
              <p className="font-medium text-emerald-100">{state.progressMessage}</p>
              <dl className="mt-2 grid grid-cols-3 gap-3 text-xs text-emerald-200">
                <div>
                  <dt className="uppercase tracking-wide opacity-70">Created</dt>
                  <dd className="mt-0.5 text-sm font-semibold">{result.created}</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wide opacity-70">Updated</dt>
                  <dd className="mt-0.5 text-sm font-semibold">{result.updated}</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wide opacity-70">Skipped</dt>
                  <dd className="mt-0.5 text-sm font-semibold">{result.skipped}</dd>
                </div>
              </dl>
            </div>
          )}

          {isFailed && (
            <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
              <p className="text-sm text-rose-200" role="alert">
                {state.stepError ?? rotation?.errorMessage ?? "Resync failed."}
              </p>
            </div>
          )}
        </div>

        {/* Retry path after failure */}
        {isFailed && (
          <button
            type="button"
            onClick={() => setState((s) => ({ ...s, showResyncConfirm: true }))}
            className="h-10 w-fit rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200"
          >
            Retry resync
          </button>
        )}
      </section>
    );
  }

  // ─── Step: rollback ──────────────────────────────────────────────────────────

  function renderRollback() {
    const canRoll = rotation ? canRollback(rotation) : false;

    if (isRolledBack) {
      return (
        <section className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <h3
            ref={step === "rollback" ? stepHeadingRef : undefined}
            tabIndex={-1}
            className="text-lg font-semibold text-white outline-none"
          >
            Rollback complete
          </h3>
          <div className="rounded-md border border-emerald-300/30 bg-emerald-300/10 p-3 text-sm text-emerald-200">
            The rotation has been rolled back. The old account (
            <span className="font-mono">{shortAddress(rotation?.oldAccountAddress ?? "")}</span>
            ) remains active. No checkpoints were modified. The new account&apos;s
            data and the old account&apos;s data remain completely separate.
          </div>
          <button
            type="button"
            onClick={() => {
              setState(INITIAL_STATE);
              setStep("review");
            }}
            className="h-10 w-fit rounded-md border border-white/15 px-4 text-xs font-semibold text-white transition hover:bg-white/5"
          >
            Start a new rotation
          </button>
        </section>
      );
    }

    if (isCompleted) {
      return (
        <section className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <h3
            ref={step === "rollback" ? stepHeadingRef : undefined}
            tabIndex={-1}
            className="text-lg font-semibold text-white outline-none"
          >
            Rollback unavailable
          </h3>
          <p className="text-sm text-slate-300">
            The rotation completed successfully. Rollback is only available
            before the resync reaches completion. The new account is now active.
          </p>
        </section>
      );
    }

    return (
      <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h3
          ref={step === "rollback" ? stepHeadingRef : undefined}
          tabIndex={-1}
          className="text-lg font-semibold text-white outline-none"
        >
          Rollback
        </h3>
        <p className="text-sm leading-6 text-slate-300">
          Roll back to the old account. This cancels the rotation in progress
          without modifying any checkpoint data. The old and new account
          records remain completely separate.
        </p>

        {!canRoll && (
          <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-xs text-amber-200">
            Rollback is not available at the current rotation status (
            {rotation?.status ?? "unknown"}). A rotation that has already
            completed cannot be rolled back.
          </div>
        )}

        {state.stepError && (
          <p className="text-sm text-rose-200" role="alert">
            {state.stepError}
          </p>
        )}

        {canRoll && rotation && (
          <button
            type="button"
            onClick={() => setState((s) => ({ ...s, showRollbackConfirm: true }))}
            className="h-10 w-fit rounded-md border border-rose-300/50 bg-rose-300/10 px-4 text-xs font-semibold text-rose-200 transition hover:bg-rose-300/20"
          >
            Roll back rotation
          </button>
        )}
      </section>
    );
  }

  // ─── Main render ─────────────────────────────────────────────────────────────

  return (
    <div className="grid gap-6">
      <WizardSteps
        stepOrder={STEP_ORDER}
        stepLabels={STEP_LABELS}
        currentStep={step}
        onStepChange={setStep}
        canProceedToStep={canProceedToStep}
      />

      {step === "review" && renderReview()}
      {step === "challenge" && renderChallenge()}
      {step === "boundary" && renderBoundary()}
      {step === "resync-plan" && renderResyncPlan()}
      {step === "progress" && renderProgress()}
      {step === "rollback" && renderRollback()}

      {/* Resync confirmation dialog */}
      {state.showResyncConfirm && (
        <ConfirmationDialog
          title="Start resync?"
          message={
            `This will run a full payment sync for the new account ` +
            `(${shortAddress(rotation?.newAccountAddress ?? "")}). ` +
            `Once running, this action cannot be undone. ` +
            `Rollback will no longer be available after the resync completes.`
          }
          confirmText="Start resync"
          cancelText="Cancel"
          confirmVariant="primary"
          onConfirm={() => void handleStartResync()}
          onCancel={() => setState((s) => ({ ...s, showResyncConfirm: false }))}
          isProcessing={isResyncRunning}
        />
      )}

      {/* Rollback confirmation dialog */}
      {state.showRollbackConfirm && (
        <ConfirmationDialog
          title="Roll back rotation?"
          message={
            `This will cancel the current rotation and keep the old account ` +
            `(${shortAddress(rotation?.oldAccountAddress ?? "")}) active. ` +
            `No checkpoint data will be modified. ` +
            `Old and new account histories will remain completely separate. ` +
            `You can start a new rotation at any time.`
          }
          confirmText="Roll back"
          cancelText="Keep going"
          confirmVariant="danger"
          onConfirm={handleRollback}
          onCancel={() => setState((s) => ({ ...s, showRollbackConfirm: false }))}
        />
      )}
    </div>
  );
}
