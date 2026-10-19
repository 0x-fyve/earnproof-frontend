"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { PublicShell } from "@/components/layout/public-shell";
import { RoleChangeRequestWorkspace } from "@/components/organizations/role-change-request-workspace";
import { getOrganizationMembers, type OrganizationMember } from "@/lib/api/organization-members";
import { fetchMockRoleApprovalPolicy, type RoleApprovalPolicy } from "@/lib/api/organization-role-approval-policy";
import { readStoredSession } from "@/lib/session";

/**
 * #238: privileged role change request and approval workspace, scoped
 * to one member within one organization.
 *
 * The role-approval policy is fetched via fetchMockRoleApprovalPolicy -
 * the same documented stand-in app/settings/organizations/role-approval/page.tsx's
 * RoleApprovalPolicyPanel uses, since /organizations/{id}/role-approval-policy
 * is not yet a real endpoint (see lib/api/organization-role-approval-policy.ts).
 * Member data comes from the real (if not-yet-spec'd) organization-members
 * client, consistent with components/organizations/organization-members.tsx.
 */
export default function RoleChangeRequestPage() {
  const params = useParams<{ id: string; memberId: string }>();
  const session = readStoredSession();

  const [member, setMember] = useState<OrganizationMember | null>(null);
  const [policy, setPolicy] = useState<RoleApprovalPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(true);
  const loading = Boolean(session) && isFetching;

  useEffect(() => {
    if (!session) {
      return;
    }

    let active = true;
    void Promise.resolve().then(async () => {
      const controller = new AbortController();
      try {
        const [members, policyResponse] = await Promise.all([
          getOrganizationMembers(session.token, params.id, controller.signal),
          fetchMockRoleApprovalPolicy(),
        ]);
        if (!active) {
          return;
        }
        const found = members.find((candidate) => candidate.id === params.memberId) ?? null;
        setMember(found);
        setPolicy(policyResponse.policy);
        if (!found) {
          setError("This member could not be found.");
        }
      } catch {
        if (active) {
          setError("Could not load this member or the organization's role approval policy.");
        }
      } finally {
        if (active) {
          setIsFetching(false);
        }
      }
    });

    return () => {
      active = false;
    };
  }, [session, params.id, params.memberId]);

  return (
    <PublicShell>
      <section className={`${pageContainer} gap-8 sm:gap-10`}>
        <PageHeading
          description="Request a privileged role change for this member, or review, approve, reject, or cancel requests already in flight."
          eyebrow="Organization administration"
          title="Role change request"
        />

        {!session ? (
          <p className="text-sm text-slate-300">Sign in to manage role change requests.</p>
        ) : loading ? (
          <p className="text-sm text-slate-300">Loading…</p>
        ) : error ? (
          <p className="text-sm text-rose-200" role="alert">
            {error}
          </p>
        ) : member && policy ? (
          <RoleChangeRequestWorkspace
            organizationId={params.id}
            member={member}
            policy={policy}
            currentActorId={session.user.id}
          />
        ) : null}
      </section>
    </PublicShell>
  );
}
