"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmployerPaymentWizardSteps } from "./employer-payment-wizard-steps";
import { EmployerPaymentPeriodStep } from "./employer-payment-period-step";
import { EmployerSourceSelection } from "./employer-source-selection";
import { EmployerPaymentConfirmation } from "./employer-payment-confirmation";
import { ArtifactExport } from "./artifact-export";
import {
  createEmployerPaymentProof,
  deriveEmployerSources,
  type EmployerPaymentProof,
  type EmployerSource,
  type Payment,
} from "@/lib/api/employer-payment-proofs";
import { apiClient, bearer } from "@/lib/api/client";
import { appConfig } from "@/config/app";
import { buildCredentialExport, buildVerificationLinkExport } from "@/lib/credentials/export";
import { WIZARD_STEPS, DEFAULT_VALUES, type WizardStep } from "@/lib/validation/employer-payment-proofs";
import { readStoredSession, storeSession, clearStoredSession, type Session } from "@/lib/session";

type SessionUser = {
  id: string;
  walletAddress: string;
  walletHash: string;
  role: string;
};

export function EmployerPaymentProofWizard() {
  const initialSession = useMemo(() => readStoredSession(), []);
  const [token, setToken] = useState<string | null>(() => initialSession?.token ?? null);
  const [user, setUser] = useState<SessionUser | null>(() => initialSession?.user ?? null);
  const [currentStep, setCurrentStep] = useState<WizardStep>(WIZARD_STEPS.PERIOD_CONFIG);
  const [payments, setPayments] = useState<Payment[]>([]);

  const [periodStart, setPeriodStart] = useState("2026-08-01");
  const [periodEnd, setPeriodEnd] = useState("2026-11-30");
  const [selectedSourceAddress, setSelectedSourceAddress] = useState<string | null>(null);
  const [assetCode, setAssetCode] = useState<string | null>(null);
  const [expiresInDays, setExpiresInDays] = useState<number>(DEFAULT_VALUES.expiresInDays);

  const [proof, setProof] = useState<EmployerPaymentProof | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const connectButtonRef = useRef<HTMLButtonElement>(null);
  const wasConnectedRef = useRef(Boolean(initialSession?.user));

  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
    }
  }, [error]);

  useEffect(() => {
    if (user) {
      wasConnectedRef.current = true;
    } else if (wasConnectedRef.current) {
      wasConnectedRef.current = false;
      connectButtonRef.current?.focus();
    }
  }, [user]);

  const employerSources = useMemo(
    () => deriveEmployerSources(payments, `${periodStart}T00:00:00.000Z`, `${periodEnd}T23:59:59.000Z`),
    [payments, periodStart, periodEnd]
  );

  const selectedSource: EmployerSource | null = useMemo(
    () => employerSources.find((s) => s.sourceAddress === selectedSourceAddress && s.trust === "TRUSTED") ?? null,
    [employerSources, selectedSourceAddress]
  );

  const assetCodeOptions = useMemo(() => selectedSource?.assetCodes ?? [], [selectedSource]);

  // Selecting a source is the single place asset selection changes: the
  // default asset is set atomically with the source, and clearing the
  // source clears the asset too. This intentionally replaces an
  // effect-based sync (source -> derived default asset) with a plain
  // event handler, so there is no extra render/commit cycle and no need
  // to reconcile stale asset selections after the fact.
  const handleSourceSelect = useCallback(
    (sourceAddress: string | null) => {
      setSelectedSourceAddress(sourceAddress);
      const nextSource = employerSources.find((s) => s.sourceAddress === sourceAddress && s.trust === "TRUSTED");
      setAssetCode(nextSource?.assetCodes[0] ?? null);
    },
    [employerSources]
  );

  // A period change invalidates any previously selected source, since a
  // source is only ever trusted with respect to a specific period's
  // payments. Re-deriving employerSources for the new period may no
  // longer include the previously selected address (or may reclassify it
  // as untrusted), so the selection (and its dependent asset choice) is
  // cleared rather than silently carried over.
  const handlePeriodStartChange = useCallback((value: string) => {
    setPeriodStart(value);
    setSelectedSourceAddress(null);
    setAssetCode(null);
  }, []);

  const handlePeriodEndChange = useCallback((value: string) => {
    setPeriodEnd(value);
    setSelectedSourceAddress(null);
    setAssetCode(null);
  }, []);

  async function connectWallet() {
    setError(null);
    setStatus("Requesting Freighter wallet access...");

    try {
      const walletAddress = await getFreighterAddress();
      if (!walletAddress) {
        setStatus(null);
        setError("Freighter was not found or did not return a Stellar address.");
        return;
      }

      const challenge = await apiClient<{ id: string; message: string; expiresAt: string }>({
        path: "/auth/challenge",
        method: "POST",
        body: JSON.stringify({ walletAddress }),
      });

      setStatus("Waiting for wallet signature...");
      const signature = await signFreighterMessage(challenge.message, walletAddress);
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
        body: JSON.stringify({ challengeId: challenge.id, walletAddress, signature }),
      });

      storeSession({ token: verified.session.token, user: verified.user } as Session);
      setToken(verified.session.token);
      setUser(verified.user);
      setStatus("Wallet authenticated.");
    } catch {
      setStatus(null);
      setError("Wallet connection failed. Check Freighter and try again.");
    }
  }

  async function syncPayments() {
    if (!token) return;
    setError(null);
    setStatus("Syncing incoming Stellar testnet payments...");
    try {
      await apiClient({ path: "/payments/sync", method: "POST", headers: bearer(token) });
      await refreshPayments(token);
      setStatus("Payments synced.");
    } catch {
      setStatus(null);
      setError("Payment sync failed. Try again.");
    }
  }

  async function refreshPayments(activeToken = token) {
    if (!activeToken) return;
    try {
      const response = await apiClient<Payment[]>({ path: "/payments", headers: bearer(activeToken) });
      setPayments(response);
    } catch {
      setError("Could not load payments. Try again.");
    }
  }

  async function createProof() {
    if (!token || !selectedSource || !assetCode) {
      setError("Please select an eligible employer source and asset before creating the proof.");
      return;
    }

    setError(null);
    setProof(null);
    setStatus("Creating employer payment proof...");

    try {
      const controller = new AbortController();
      const created = await createEmployerPaymentProof(
        token,
        {
          sourceAddress: selectedSource.sourceAddress,
          periodStart: `${periodStart}T00:00:00.000Z`,
          periodEnd: `${periodEnd}T23:59:59.000Z`,
          assetCode,
          expiresInDays,
        },
        controller.signal
      );

      setProof(created);
      setStatus("Employer payment proof created.");
    } catch {
      setStatus(null);
      setError("Proof creation failed. Please verify your source selection and try again.");
    }
  }

  function disconnect() {
    clearStoredSession();
    setToken(null);
    setUser(null);
    setPayments([]);
    setSelectedSourceAddress(null);
    setAssetCode(null);
    setProof(null);
    setStatus(null);
    setError(null);
    setCurrentStep(WIZARD_STEPS.PERIOD_CONFIG);
  }

  const canProceedToNextStep = (step: WizardStep): boolean => {
    switch (step) {
      case WIZARD_STEPS.PERIOD_CONFIG:
        return Boolean(periodStart) && Boolean(periodEnd) && new Date(periodStart) < new Date(periodEnd);
      case WIZARD_STEPS.SOURCE_SELECTION:
        return Boolean(selectedSource);
      case WIZARD_STEPS.CONFIRMATION:
        return true;
      default:
        return false;
    }
  };

  const renderCurrentStep = () => {
    if (!user) {
      return (
        <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <div>
            <h2 className="text-xl font-semibold text-white">Wallet Connection Required</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Connect your Stellar testnet wallet to access the employer payment proof wizard.
            </p>
          </div>
          <button
            className="h-10 w-fit rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950"
            onClick={connectWallet}
            ref={connectButtonRef}
            type="button"
          >
            Connect Freighter
          </button>
        </section>
      );
    }

    switch (currentStep) {
      case WIZARD_STEPS.PERIOD_CONFIG:
        return (
          <EmployerPaymentPeriodStep
            onPeriodEndChange={handlePeriodEndChange}
            onPeriodStartChange={handlePeriodStartChange}
            periodEnd={periodEnd}
            periodStart={periodStart}
          />
        );
      case WIZARD_STEPS.SOURCE_SELECTION:
        return (
          <EmployerSourceSelection
            loading={!token}
            onRefreshPayments={() => refreshPayments()}
            onSourceSelect={handleSourceSelect}
            onSyncPayments={syncPayments}
            selectedSourceAddress={selectedSourceAddress}
            sources={employerSources}
          />
        );
      case WIZARD_STEPS.CONFIRMATION:
        return (
          <EmployerPaymentConfirmation
            assetCode={assetCode}
            assetCodeOptions={assetCodeOptions}
            expiresInDays={expiresInDays}
            loading={!!status}
            onAssetCodeChange={setAssetCode}
            onCreateProof={createProof}
            onExpiresInDaysChange={setExpiresInDays}
            periodEnd={periodEnd}
            periodStart={periodStart}
            source={selectedSource}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="grid gap-8 sm:gap-10">
      {user && (
        <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-sm text-slate-300">
                Connected as{" "}
                <span className="font-mono text-cyan-200">
                  {user.walletAddress.slice(0, 8)}...{user.walletAddress.slice(-8)}
                </span>
              </span>
            </div>
            <button className="text-xs text-slate-400 transition hover:text-slate-300" onClick={disconnect} type="button">
              Disconnect
            </button>
          </div>
        </section>
      )}

      <EmployerPaymentWizardSteps
        canProceedToStep={canProceedToNextStep}
        currentStep={currentStep}
        onStepChange={setCurrentStep}
      />

      {renderCurrentStep()}

      {(status || error || proof) && (
        <section className="rounded-lg border border-white/10 bg-slate-950 p-5 text-sm leading-6" id="wizard-feedback">
          {status && (
            <p aria-live="polite" className="text-slate-300">
              {status}
            </p>
          )}
          {error && (
            <p
              aria-live="assertive"
              className="text-rose-200 focus-visible:outline-none"
              ref={errorRef}
              role="alert"
              tabIndex={-1}
            >
              {error}
            </p>
          )}
          {proof && (
            <div className="mt-4 grid gap-2 text-slate-300">
              <p>
                Proof ID: <span className="text-cyan-200">{proof.proofId}</span>
              </p>
              <p className="break-words">
                Credential hash: <span className="text-cyan-200">{proof.credential.proof.credentialHash}</span>
              </p>
              <a className="w-fit text-cyan-200 underline underline-offset-4" href={`/verify?proof=${encodeURIComponent(proof.proofId)}`}>
                Open public verification
              </a>
              <ArtifactExport plan={buildVerificationLinkExport(proof.verificationUrl)} title="Export verification link" />
              <ArtifactExport plan={buildCredentialExport({ credential: proof.credential })} title="Export credential JSON" />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

async function loadFreighter(): Promise<typeof import("@stellar/freighter-api")> {
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

async function signFreighterMessage(message: string, walletAddress: string) {
  const freighter = await loadFreighter();
  const response = await freighter
    .signMessage(message, { networkPassphrase: appConfig.stellarNetworkPassphrase, address: walletAddress })
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
