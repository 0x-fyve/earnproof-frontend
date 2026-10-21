"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CreateApiKeyForm } from "./create-api-key-form";
import { OneTimeSecret } from "./one-time-secret";
import type { CreateApiKeyResponse } from "@/lib/api/keys";
import { appConfig } from "@/config/app";
import { readStoredSession } from "@/lib/session";
import { readStoredOrganizationId } from "@/lib/organization-context/store";
import {
  loadQuickstartProgress,
  saveQuickstartProgress,
} from "@/lib/storage/quickstart-progress";
import {
  QUICKSTART_STEPS,
  SUPPORTED_RUNTIMES,
  classifyVerificationOutcome,
  generateVerificationExample,
  getActiveApiVersion,
  isChecklistComplete,
  markStepComplete,
  type QuickstartChecklistState,
  type QuickstartRuntime,
  type QuickstartStep,
  type QuickstartVerificationOutcome,
} from "@/lib/developers/quickstart";
import { verifyProof } from "@/lib/api/verify-proof";

const STEP_LABELS: Record<QuickstartStep, string> = {
  "select-scopes": "Select scopes",
  "create-key": "Create an API key",
  "save-secret": "Save the one-time secret",
  "test-request": "Send a synthetic test request",
};

const RUNTIME_LABELS: Record<QuickstartRuntime, string> = {
  curl: "cURL",
  node: "Node.js",
  python: "Python",
};

const OUTCOME_MESSAGES: Record<QuickstartVerificationOutcome, { tone: "success" | "error"; message: string }> = {
  success: { tone: "success", message: "Synthetic verification request succeeded." },
  "missing-scope": {
    tone: "error",
    message: "The key is missing a required scope. Add verification:read and try again.",
  },
  "expired-key": {
    tone: "error",
    message: "The key has expired or is invalid. Create a new key and try again.",
  },
  "version-mismatch": {
    tone: "error",
    message: "The request targeted an API contract version the server no longer supports.",
  },
  "unknown-error": {
    tone: "error",
    message: "The synthetic test request failed. Check the key's scopes and try again.",
  },
};

/**
 * Guided quickstart workspace (#232): walks an integrator from scope
 * selection through API key creation, one-time secret handling, and a
 * redacted synthetic verification request, with generated code examples
 * for each supported runtime. Reuses CreateApiKeyForm and OneTimeSecret
 * rather than re-implementing key creation, so this stays a thin
 * orchestration layer over already-reviewed, already-tested components.
 *
 * Checklist progress is persisted via lib/storage/quickstart-progress.ts,
 * which only ever stores step identifiers - never the secret, never the
 * key id, never any request/response body.
 */
export function IntegrationQuickstart() {
  const [session] = useState(() => readStoredSession());
  const [organizationId] = useState(() => readStoredOrganizationId());
  // "select-scopes" is implicitly satisfied by reaching the create-key
  // form at all (CreateApiKeyForm requires at least one scope before its
  // own submit is enabled), so it's marked complete as soon as the
  // workspace mounts. Computed during lazy initialization (not a
  // post-mount effect) so there's no extra render and no synchronous
  // setState-in-effect.
  const [progress, setProgress] = useState<QuickstartChecklistState>(() =>
    markStepComplete(loadQuickstartProgress(), "select-scopes"),
  );
  const [createdKey, setCreatedKey] = useState<CreateApiKeyResponse | null>(null);
  const [runtime, setRuntime] = useState<QuickstartRuntime>("curl");
  const [testOutcome, setTestOutcome] = useState<QuickstartVerificationOutcome | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    saveQuickstartProgress(progress);
    // Only ever persists on the initial mount (select-scopes was just
    // completed above) or when completeStep changes it later; saving the
    // already-loaded state back out on mount is a harmless no-op write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const completeStep = useCallback((step: QuickstartStep) => {
    setProgress((prev) => {
      const next = markStepComplete(prev, step);
      saveQuickstartProgress(next);
      return next;
    });
  }, []);

  const handleKeyCreated = useCallback(
    (response: CreateApiKeyResponse) => {
      setCreatedKey(response);
      completeStep("create-key");
    },
    [completeStep],
  );

  const handleSecretDismissed = useCallback(() => {
    completeStep("save-secret");
    setCreatedKey(null);
  }, [completeStep]);

  const example = useMemo(
    () =>
      generateVerificationExample({
        runtime,
        organizationId,
        apiBaseUrl: appConfig.apiUrl,
      }),
    [runtime, organizationId],
  );

  const runSyntheticTest = useCallback(async () => {
    if (!session) return;
    setIsTesting(true);
    setTestOutcome(null);
    const controller = new AbortController();
    try {
      // Always targets a synthetic, clearly-fake proof id - this never
      // touches a real worker's verification data.
      await verifyProof("SYNTHETIC-TEST-PROOF", controller.signal, session.token);
      setTestOutcome("success");
      completeStep("test-request");
    } catch (error) {
      const status = (error as { status?: number }).status ?? 0;
      setTestOutcome(classifyVerificationOutcome({ status }));
    } finally {
      setIsTesting(false);
    }
  }, [session, completeStep]);

  const allComplete = isChecklistComplete(progress);

  if (!session) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 className="text-xl font-semibold text-white">Authentication required</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Connect a Stellar wallet to start the integration quickstart.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-8 sm:gap-10">
      <section
        aria-label="Quickstart checklist"
        className="rounded-lg border border-white/10 bg-white/[0.04] p-5"
      >
        <h2 className="text-xl font-semibold text-white">Quickstart checklist</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          API contract version <span className="font-mono">{getActiveApiVersion()}</span>
          {organizationId && (
            <>
              {" "}
              for organization <span className="font-mono">{organizationId}</span>
            </>
          )}
          . Progress below is saved locally as checklist step names only; your API secret is
          never stored.
        </p>
        <ol className="mt-4 grid gap-2">
          {QUICKSTART_STEPS.map((step, index) => {
            const isDone = progress.completedSteps.includes(step);
            return (
              <li key={step} className="flex items-center gap-3 text-sm">
                <span
                  aria-hidden
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    isDone ? "bg-emerald-300 text-slate-950" : "border border-white/20 text-slate-400"
                  }`}
                >
                  {isDone ? "✓" : index + 1}
                </span>
                <span className={isDone ? "text-emerald-200" : "text-slate-300"}>
                  {STEP_LABELS[step]}
                </span>
              </li>
            );
          })}
        </ol>
        {allComplete && (
          <p className="mt-4 rounded-md border border-emerald-300/30 bg-emerald-300/10 p-3 text-sm text-emerald-200">
            Quickstart complete. Your integration is ready to use real traffic.
          </p>
        )}
      </section>

      {createdKey ? (
        <OneTimeSecret
          apiKey={createdKey.apiKey}
          secret={createdKey.secret}
          onDismiss={handleSecretDismissed}
        />
      ) : (
        <CreateApiKeyForm token={session.token} onKeyCreated={handleKeyCreated} />
      )}

      <section
        aria-label="Code examples"
        className="rounded-lg border border-white/10 bg-white/[0.04] p-5"
      >
        <h2 className="text-xl font-semibold text-white">Test request</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          This request is synthetic: it targets a fake proof id and is safe to run with any key.
          Replace <span className="font-mono">{"YOUR_API_SECRET"}</span> with your real secret
          before using these examples outside this page.
        </p>

        <div className="mt-4 flex gap-2" role="tablist" aria-label="Runtime">
          {SUPPORTED_RUNTIMES.map((rt) => (
            <button
              key={rt}
              type="button"
              role="tab"
              aria-selected={runtime === rt}
              onClick={() => setRuntime(rt)}
              className={`h-8 rounded-md px-3 text-xs font-semibold transition ${
                runtime === rt
                  ? "bg-cyan-300 text-slate-950"
                  : "border border-white/15 text-white hover:bg-white/5"
              }`}
            >
              {RUNTIME_LABELS[rt]}
            </button>
          ))}
        </div>

        <pre className="mt-3 overflow-x-auto rounded-md border border-white/10 bg-slate-950 p-4 text-xs text-slate-200">
          <code>{example}</code>
        </pre>

        <button
          type="button"
          onClick={() => void runSyntheticTest()}
          disabled={isTesting}
          className="mt-4 h-10 rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-50"
        >
          {isTesting ? "Sending..." : "Send synthetic test request"}
        </button>

        {testOutcome && (
          <p
            role={OUTCOME_MESSAGES[testOutcome].tone === "error" ? "alert" : "status"}
            className={`mt-3 rounded-md border p-3 text-sm ${
              OUTCOME_MESSAGES[testOutcome].tone === "error"
                ? "border-rose-300/30 bg-rose-300/10 text-rose-200"
                : "border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
            }`}
          >
            {OUTCOME_MESSAGES[testOutcome].message}
          </p>
        )}
      </section>
    </div>
  );
}
