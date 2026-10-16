"use client";

/**
 * Organization role-approval policy configuration (#258).
 *
 * Loads the current policy (and its version history), lets an OWNER/ADMIN
 * edit it, previews the impact, compares/rolls back to earlier versions, and
 * saves through `applyPolicyUpdate` — which fails closed on stale, conflicting
 * or weakening changes.
 *
 * Viewers without a management role see a read-only summary. All gating here
 * is UX only; the server re-validates every write.
 */

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_ROLE_APPROVAL_MINIMUMS,
  ORGANIZATION_ROLES,
  applyPolicyUpdate,
  buildRollbackDraft,
  canManageRoleApprovalPolicy,
  comparePolicyVersions,
  fetchMockRoleApprovalPolicy,
  summarizePolicyImpact,
  validateRoleApprovalPolicy,
  type OrganizationRole,
  type RoleApprovalMinimums,
  type RoleApprovalPolicy,
} from "@/lib/api/organization-role-approval-policy";

export interface RoleApprovalPolicyPanelProps {
  organizationId: string;
  viewerRole: OrganizationRole | null | undefined;
  /** Pre-loaded policy; when omitted the panel loads its own fixture. */
  initialPolicy?: RoleApprovalPolicy;
  initialHistory?: RoleApprovalPolicy[];
  minimums?: RoleApprovalMinimums;
  onSaved?: (policy: RoleApprovalPolicy) => void;
}

export function RoleApprovalPolicyPanel({
  organizationId,
  viewerRole,
  initialPolicy,
  initialHistory = [],
  minimums = DEFAULT_ROLE_APPROVAL_MINIMUMS,
  onSaved,
}: RoleApprovalPolicyPanelProps) {
  const canManage = canManageRoleApprovalPolicy(viewerRole);

  const [policy, setPolicy] = useState<RoleApprovalPolicy | null>(initialPolicy ?? null);
  const [history, setHistory] = useState<RoleApprovalPolicy[]>(initialHistory);
  const [draft, setDraft] = useState<RoleApprovalPolicy | null>(initialPolicy ?? null);
  const [compareTarget, setCompareTarget] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    if (initialPolicy) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const response = await fetchMockRoleApprovalPolicy();
      if (!cancelled) {
        setPolicy(response.policy);
        setDraft(response.policy);
        setHistory(response.history);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialPolicy]);

  const issues = useMemo(
    () => (draft ? validateRoleApprovalPolicy(draft, minimums) : []),
    [draft, minimums],
  );
  const errors = issues.filter((issue) => issue.severity === "error");
  const impact = useMemo(
    () => (policy && draft ? summarizePolicyImpact(policy, draft) : null),
    [policy, draft],
  );

  if (!policy || !draft) {
    return (
      <section aria-busy="true" className="rounded-lg border border-white/10 bg-white/[0.04] p-5 text-sm text-slate-300">
        Loading role approval policy…
      </section>
    );
  }

  const updateRule = (role: OrganizationRole, requiresApproval: boolean) => {
    setSavedNotice(null);
    setDraft((current) =>
      current
        ? {
            ...current,
            rules: current.rules.map((rule) =>
              rule.role === role ? { ...rule, requiresApproval } : rule,
            ),
          }
        : current,
    );
  };

  const setNumber = (field: "approvalsRequired" | "requestValidityHours", value: string) => {
    setSavedNotice(null);
    const parsed = Number.parseInt(value, 10);
    setDraft((current) =>
      current ? { ...current, [field]: Number.isNaN(parsed) ? 0 : parsed } : current,
    );
  };

  const handleSave = () => {
    const outcome = applyPolicyUpdate({
      current: policy,
      draft,
      expectedVersion: policy.policyVersion,
      viewerRole,
      minimums,
    });

    if (!outcome.ok) {
      setSaveError(outcome.message);
      setSavedNotice(null);
      return;
    }

    setHistory((previous) => [policy, ...previous]);
    setPolicy(outcome.policy);
    setDraft(outcome.policy);
    setSaveError(null);
    setSavedNotice(`Saved policy version ${outcome.policy.policyVersion}.`);
    onSaved?.(outcome.policy);
  };

  const handleRollback = (target: RoleApprovalPolicy) => {
    setSaveError(null);
    setSavedNotice(null);
    setDraft(buildRollbackDraft(policy, target));
  };

  const compareVersion =
    compareTarget === null
      ? null
      : history.find((entry) => entry.policyVersion === compareTarget) ?? null;
  const comparison = compareVersion ? comparePolicyVersions(compareVersion, policy) : [];

  return (
    <section aria-labelledby="role-approval-heading" className="grid gap-6 rounded-lg border border-white/10 bg-white/[0.04] p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-white" id="role-approval-heading">
            Role approval policy
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Choose which role changes need independent approval and how long requests stay valid.
          </p>
        </div>
        <p className="text-xs text-slate-400" data-testid="policy-version">
          Version {policy.policyVersion} · updated {policy.updatedAt}
        </p>
      </header>

      <p className="text-xs text-slate-500">
        Organization {organizationId}
      </p>

      {!canManage ? (
        <div className="rounded-lg border border-blue-300/30 bg-blue-300/10 p-4 text-sm text-blue-200">
          You have read-only access to this policy. Owners and admins can change it.
        </div>
      ) : null}

      {saveError ? (
        <div className="rounded-lg border border-rose-300/40 bg-rose-300/10 p-3 text-sm text-rose-100" role="alert">
          {saveError}
        </div>
      ) : null}

      {savedNotice ? (
        <div className="rounded-lg border border-emerald-300/40 bg-emerald-300/10 p-3 text-sm text-emerald-100" role="status">
          {savedNotice}
        </div>
      ) : null}

      <fieldset className="grid gap-2" disabled={!canManage}>
        <legend className="text-sm font-semibold text-slate-200">
          Roles requiring independent approval
        </legend>
        {ORGANIZATION_ROLES.map((role) => {
          const rule = draft.rules.find((candidate) => candidate.role === role);
          const checked = rule?.requiresApproval ?? false;
          return (
            <label className="flex items-center gap-2 text-sm text-slate-300" key={role}>
              <input
                checked={checked}
                onChange={(event) => updateRule(role, event.target.checked)}
                type="checkbox"
              />
              <span>{role}</span>
            </label>
          );
        })}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm text-slate-300">
          <span>Independent approvals required</span>
          <input
            className="h-9 rounded-md border border-white/15 bg-slate-900/40 px-3 text-sm text-white"
            disabled={!canManage}
            min={minimums.minApprovalsRequired}
            max={minimums.maxApprovalsRequired}
            onChange={(event) => setNumber("approvalsRequired", event.target.value)}
            type="number"
            value={draft.approvalsRequired}
          />
        </label>

        <label className="grid gap-1 text-sm text-slate-300">
          <span>Request validity (hours)</span>
          <input
            className="h-9 rounded-md border border-white/15 bg-slate-900/40 px-3 text-sm text-white"
            disabled={!canManage}
            min={minimums.minRequestValidityHours}
            max={minimums.maxRequestValidityHours}
            onChange={(event) => setNumber("requestValidityHours", event.target.value)}
            type="number"
            value={draft.requestValidityHours}
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input
          checked={draft.allowSelfApproval}
          disabled={!canManage}
          onChange={(event) => {
            setSavedNotice(null);
            setDraft((current) =>
              current ? { ...current, allowSelfApproval: event.target.checked } : current,
            );
          }}
          type="checkbox"
        />
        <span>Allow requesters to approve their own requests</span>
      </label>

      {errors.length > 0 ? (
        <ul className="grid gap-1 rounded-lg border border-rose-300/40 bg-rose-300/10 p-3 text-sm text-rose-100" role="alert">
          {errors.map((issue) => (
            <li key={`${issue.field}:${issue.message}`}>{issue.message}</li>
          ))}
        </ul>
      ) : null}

      {impact ? (
        <div className="rounded-lg border border-white/10 bg-slate-900/30 p-4">
          <h3 className="text-sm font-semibold text-slate-200">Impact preview</h3>
          <p className="mt-1 text-xs text-slate-400">
            {impact.strengthening ? "This change is at least as strict as the current policy." : "This change relaxes the current policy."}
          </p>
          <ul className="mt-2 grid gap-1 text-sm text-slate-300">
            {impact.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-3 rounded-lg border border-white/10 bg-slate-900/30 p-4">
        <h3 className="text-sm font-semibold text-slate-200">Version history</h3>
        {history.length === 0 ? (
          <p className="text-sm text-slate-400">No earlier versions recorded yet.</p>
        ) : (
          <label className="grid gap-1 text-sm text-slate-300">
            <span>Compare with current version</span>
            <select
              className="h-9 rounded-md border border-white/15 bg-slate-900/40 px-3 text-sm text-white"
              onChange={(event) =>
                setCompareTarget(event.target.value === "" ? null : Number(event.target.value))
              }
              value={compareTarget ?? ""}
            >
              <option value="">Select a version…</option>
              {history.map((entry) => (
                <option key={entry.policyVersion} value={entry.policyVersion}>
                  Version {entry.policyVersion} ({entry.updatedAt})
                </option>
              ))}
            </select>
          </label>
        )}

        {compareVersion ? (
          <div className="grid gap-2">
            {comparison.length === 0 ? (
              <p className="text-sm text-slate-400">No differences from the current version.</p>
            ) : (
              <ul className="grid gap-1 text-sm text-slate-300">
                {comparison.map((change) => (
                  <li key={change.field}>
                    <span className="font-mono">{change.field}</span>: {change.before} → {change.after}
                  </li>
                ))}
              </ul>
            )}
            {canManage ? (
              <button
                className="h-9 w-fit rounded-md border border-white/15 px-3 text-xs font-semibold text-slate-100 hover:bg-white/5"
                onClick={() => handleRollback(compareVersion)}
                type="button"
              >
                Roll back to version {compareVersion.policyVersion}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {canManage ? (
        <div className="flex flex-wrap gap-3">
          <button
            className="h-9 rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-50"
            disabled={errors.length > 0}
            onClick={handleSave}
            type="button"
          >
            Save policy
          </button>
          <button
            className="h-9 rounded-md border border-white/15 px-4 text-xs font-semibold text-slate-100 hover:bg-white/5"
            onClick={() => {
              setDraft(policy);
              setSaveError(null);
              setSavedNotice(null);
            }}
            type="button"
          >
            Discard changes
          </button>
        </div>
      ) : null}
    </section>
  );
}
