"use client";

/**
 * Organization onboarding readiness checklist (#216).
 *
 * Renders the required/optional onboarding checks exactly as the server
 * returns them. This component never computes "ready" itself — it defers to
 * `isChecklistReady()` / the checklist's own `status` fields, which are
 * entirely server-derived. Each incomplete check links to the page that
 * resolves it; a check the viewer is not authorized to see renders hidden
 * (not a false "incomplete").
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  countIncompleteRequired,
  fetchMockOnboardingChecklistForViewer,
  isChecklistReady,
  visibleChecks,
  type OnboardingChecklist,
} from "@/lib/api/organization-onboarding";

export interface OnboardingReadinessChecklistProps {
  organizationId: string;
  viewerRole: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" | null | undefined;
  initialChecklist?: OnboardingChecklist;
}

function statusLabel(status: "complete" | "incomplete" | "unavailable"): string {
  switch (status) {
    case "complete":
      return "Complete";
    case "unavailable":
      return "Unavailable";
    default:
      return "Incomplete";
  }
}

function statusClass(status: "complete" | "incomplete" | "unavailable"): string {
  switch (status) {
    case "complete":
      return "border-emerald-300/50 bg-emerald-300/10 text-emerald-200";
    case "unavailable":
      return "border-white/10 bg-white/[0.02] text-slate-500";
    default:
      return "border-amber-300/50 bg-amber-300/10 text-amber-200";
  }
}

export function OnboardingReadinessChecklist({
  organizationId,
  viewerRole,
  initialChecklist,
}: OnboardingReadinessChecklistProps) {
  const [checklist, setChecklist] = useState<OnboardingChecklist | null>(
    initialChecklist ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMockOnboardingChecklistForViewer(organizationId, viewerRole);
      setChecklist(result);
    } catch {
      setError("Failed to load the onboarding checklist. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, viewerRole]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active && !initialChecklist) {
        void load();
      }
    });
    return () => {
      active = false;
    };
    // Refetch whenever the organization or viewer role changes, matching the
    // "refetch on organization/member/key change" requirement as closely as
    // a mock API without a push channel allows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, viewerRole]);

  if (!checklist) {
    return (
      <section
        aria-busy="true"
        className="rounded-lg border border-white/10 bg-white/[0.04] p-5 text-sm text-slate-300"
      >
        {error ?? "Loading onboarding checklist…"}
      </section>
    );
  }

  const ready = isChecklistReady(checklist);
  const incompleteRequired = countIncompleteRequired(checklist);
  const checks = visibleChecks(checklist);

  return (
    <section
      aria-labelledby="onboarding-checklist-heading"
      className="grid gap-5 rounded-lg border border-white/10 bg-white/[0.04] p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white" id="onboarding-checklist-heading">
            Onboarding readiness
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Required and optional setup steps for this organization.
          </p>
        </div>
        <button
          className="h-9 rounded-md border border-white/15 px-3 text-xs font-semibold text-slate-100 hover:bg-white/5 disabled:opacity-50"
          disabled={loading}
          onClick={() => void load()}
          type="button"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error ? (
        <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3 text-sm text-rose-200" role="alert">
          {error}
        </div>
      ) : null}

      <div
        className={`rounded-lg border p-3 text-sm ${
          ready
            ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-100"
            : "border-amber-300/40 bg-amber-300/10 text-amber-100"
        }`}
        data-testid="onboarding-readiness-status"
      >
        <p className="font-semibold">
          {ready ? "Ready" : `${incompleteRequired} required step${incompleteRequired === 1 ? "" : "s"} remaining`}
        </p>
        <p className="mt-1 text-xs">Organization state: {checklist.state}</p>
      </div>

      <ul className="grid gap-2" data-testid="onboarding-checklist-items">
        {checks.map((check) => (
          <li
            className={`flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm ${statusClass(check.status)}`}
            data-testid={`onboarding-check-${check.id}`}
            key={check.id}
          >
            <div>
              <p className="font-medium text-white">
                {check.label}
                {check.required ? null : (
                  <span className="ml-2 text-xs font-normal text-slate-400">(optional)</span>
                )}
              </p>
              <p className="mt-1 text-xs text-slate-400">{check.description}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold uppercase">{statusLabel(check.status)}</span>
              {check.status !== "complete" && check.actionHref ? (
                <Link
                  className="h-8 rounded border border-cyan-300/30 px-3 text-xs font-medium text-cyan-200 hover:bg-cyan-300/10"
                  href={check.actionHref}
                >
                  Resolve
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {checklist.checks.length > checks.length ? (
        <p className="text-xs text-slate-500" data-testid="onboarding-hidden-notice">
          Some checks are hidden because your role does not have access to view them.
        </p>
      ) : null}
    </section>
  );
}
