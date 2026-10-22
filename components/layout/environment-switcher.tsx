"use client";

import { useState } from "react";
import { ConfirmationDialog } from "@/components/common/confirmation-dialog";
import { useEnvironmentContext } from "@/lib/environment-context/context";
import type { Environment } from "@/lib/environment-context/types";

const LABELS: Record<Environment, string> = {
  sandbox: "Sandbox",
  production: "Production",
};

/**
 * #233: surfaces the active environment in navigation (so sandbox vs.
 * production is always visually distinct) and gates switching into
 * production behind an explicit confirmation dialog, per the issue's
 * acceptance criteria. Switching into sandbox never needs confirmation -
 * see lib/environment-context/context.tsx's requiresConfirmation.
 */
export function EnvironmentSwitcher() {
  const { environment, requestSwitch, needsConfirmation } = useEnvironmentContext();
  const [pendingTarget, setPendingTarget] = useState<Environment | null>(null);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function performSwitch(next: Environment, confirmed: boolean) {
    setError(null);
    setSwitching(true);
    try {
      await requestSwitch(next, { confirmed });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not switch environments.");
    } finally {
      setSwitching(false);
      setPendingTarget(null);
    }
  }

  function handleSelect(next: Environment) {
    if (next === environment) {
      return;
    }

    if (needsConfirmation(next)) {
      setPendingTarget(next);
      return;
    }

    void performSwitch(next, false);
  }

  return (
    <div className="flex items-center gap-2">
      <span
        data-testid="environment-badge"
        className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
          environment === "production"
            ? "bg-rose-500/20 text-rose-200 border border-rose-400/40"
            : "bg-amber-500/20 text-amber-200 border border-amber-400/40"
        }`}
      >
        {LABELS[environment]}
      </span>

      <div className="flex gap-1" role="group" aria-label="Switch environment">
        {(["sandbox", "production"] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => handleSelect(candidate)}
            disabled={switching || candidate === environment}
            aria-pressed={candidate === environment}
            className="h-8 rounded-md border border-white/15 px-3 text-xs font-medium text-white hover:bg-white/5 disabled:opacity-50 transition"
          >
            {LABELS[candidate]}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-xs text-rose-200" role="alert">
          {error}
        </p>
      )}

      {pendingTarget && (
        <ConfirmationDialog
          title="Switch to production?"
          message="You are about to switch into the production environment. Sandbox data, credentials, and test records will no longer be visible, and any in-flight sandbox actions will be cancelled."
          confirmText="Switch to production"
          confirmVariant="danger"
          isProcessing={switching}
          onConfirm={() => void performSwitch(pendingTarget, true)}
          onCancel={() => setPendingTarget(null)}
        />
      )}
    </div>
  );
}
