"use client";

import { useState } from "react";
import type { OrganizationMember, OrganizationRole } from "@/lib/api/organization-members";
import { formatOrganizationRole, ORGANIZATION_ROLES } from "@/lib/api/organization-members";
import { isValidJustification, MAX_JUSTIFICATION_LENGTH, MIN_JUSTIFICATION_LENGTH } from "@/lib/validation/role-change-request";

/**
 * #238: request form for a privileged role change. Unlike a direct role
 * edit (lib/api/organization-members.ts's updateOrganizationMemberRole),
 * this never calls that endpoint itself - it only records a request for
 * review, requiring a justification so reviewers have the context the
 * issue says a direct change lacks.
 */
export function RoleChangeRequestForm({
  member,
  onSubmit,
  submitting,
  blockedReason,
}: {
  member: OrganizationMember;
  onSubmit: (input: { proposedRole: OrganizationRole; justification: string }) => void;
  submitting: boolean;
  /** When set, a pending request already exists for this member; the form is shown but disabled with this reason. */
  blockedReason?: string;
}) {
  const [proposedRole, setProposedRole] = useState<OrganizationRole>(member.role);
  const [justification, setJustification] = useState("");
  const [touched, setTouched] = useState(false);

  const roleUnchanged = proposedRole === member.role;
  const justificationValid = isValidJustification(justification);
  const blocked = Boolean(blockedReason);

  function handleSubmit() {
    setTouched(true);
    if (roleUnchanged || !justificationValid || blocked) {
      return;
    }
    onSubmit({ proposedRole, justification: justification.trim() });
  }

  return (
    <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
      <div>
        <h2 className="text-xl font-semibold text-white">Request a role change</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Current role: <span className="font-semibold text-white">{formatOrganizationRole(member.role)}</span>.
          This creates a request for review - it does not change the role immediately.
        </p>
      </div>

      {blocked && (
        <p className="text-xs text-amber-200" role="alert">
          {blockedReason}
        </p>
      )}

      <label className="grid gap-2 text-sm text-slate-200" htmlFor="role-change-proposed-role">
        Proposed role
        <select
          id="role-change-proposed-role"
          value={proposedRole}
          disabled={blocked}
          onChange={(event) => setProposedRole(event.target.value as OrganizationRole)}
          className="h-10 rounded-md border border-white/15 bg-slate-950 px-3 text-sm text-white disabled:opacity-50"
        >
          {ORGANIZATION_ROLES.map((role) => (
            <option key={role} value={role}>
              {formatOrganizationRole(role)}
            </option>
          ))}
        </select>
        {touched && roleUnchanged && (
          <span className="text-xs text-rose-200" role="alert">
            Choose a role different from the member&apos;s current role.
          </span>
        )}
      </label>

      <label className="grid gap-2 text-sm text-slate-200" htmlFor="role-change-justification">
        Justification
        <textarea
          id="role-change-justification"
          value={justification}
          disabled={blocked}
          onChange={(event) => setJustification(event.target.value)}
          maxLength={MAX_JUSTIFICATION_LENGTH}
          rows={4}
          className="rounded-md border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-50"
        />
        <span className="text-xs text-slate-400">
          {justification.length}/{MAX_JUSTIFICATION_LENGTH} (minimum {MIN_JUSTIFICATION_LENGTH})
        </span>
        {touched && !justificationValid && (
          <span className="text-xs text-rose-200" role="alert">
            Provide a justification of at least {MIN_JUSTIFICATION_LENGTH} characters.
          </span>
        )}
      </label>

      <button
        type="button"
        disabled={submitting || blocked}
        onClick={handleSubmit}
        className="h-10 w-fit rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 disabled:opacity-50"
      >
        {submitting ? "Submitting..." : "Submit request"}
      </button>
    </section>
  );
}
