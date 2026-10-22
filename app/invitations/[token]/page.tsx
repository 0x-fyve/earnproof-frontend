"use client";

import { useParams } from "next/navigation";
import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { PublicShell } from "@/components/layout/public-shell";
import { InvitationAcceptance } from "@/components/organizations/invitation-acceptance";
import { OrganizationContextProvider } from "@/lib/organization-context/context";
import { readStoredOrganizationId } from "@/lib/organization-context/store";

// #332: overrides the app-root default's cache setting — this page is
// public (reachable by someone with the invite link who isn't a member of
// any org yet, and may not have a prior session at all; the [token]
// segment itself is the authorization mechanism, verified server-side by
// InvitationAcceptance), but must never be cached since the response
// content is scoped to one specific token.
export const routeAuth = {
  access: "public",
  role: null,
  capability: null,
  cache: "no-store",
};

export default function InvitationPage() {
  const params = useParams<{ token: string }>();
  const initialOrganizationId = readStoredOrganizationId();

  return (
    // A lighter wrap than OrganizationWorkspaceShell: this page is reached
    // by someone who may not be a member of any organization yet (that's
    // the whole point of accepting an invite), so it deliberately skips
    // that shell's organization-switcher bar - only the context provider
    // itself is needed, so switchOrganization() can refresh the active
    // tenant on accept.
    <OrganizationContextProvider initialOrganizationId={initialOrganizationId}>
      <PublicShell>
        <section className={`${pageContainer} gap-8 sm:gap-10`}>
          <PageHeading
            description="Review an organization invitation before accepting or declining."
            eyebrow="Organizations"
            title="Organization Invitation"
          />
          <InvitationAcceptance token={params.token} />
        </section>
      </PublicShell>
    </OrganizationContextProvider>
  );
}
