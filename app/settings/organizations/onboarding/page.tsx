import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { PublicShell } from "@/components/layout/public-shell";
import { OnboardingReadinessChecklist } from "@/components/organizations/onboarding-readiness-checklist";

export const metadata = {
  title: "Onboarding readiness | EarnProof",
  description: "Review required and optional setup steps for this organization.",
};

/**
 * Organization onboarding readiness checklist (#216).
 *
 * The viewer's effective organization role is wired through once the
 * organization session is available; until then this route renders the
 * OWNER view, and the checklist still hides any check a lower role is not
 * authorized to see.
 */
export default function OrganizationOnboardingPage() {
  return (
    <PublicShell>
      <section className={`${pageContainer} gap-8 sm:gap-10`}>
        <PageHeading
          description="Required and optional setup steps for this organization, and where to resolve each one."
          eyebrow="Administration"
          title="Onboarding readiness"
        />
        <OnboardingReadinessChecklist organizationId="current" viewerRole="OWNER" />
      </section>
    </PublicShell>
  );
}
