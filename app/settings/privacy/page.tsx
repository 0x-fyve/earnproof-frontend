import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { PublicShell } from "@/components/layout/public-shell";
import { PolicyConsentHistoryPanel } from "@/components/settings/policy-consent-history";

export default function PrivacyConsentSettingsPage() {
  return (
    <PublicShell>
      <section className={pageContainer}>
        <PageHeading
          eyebrow="Privacy"
          title="Policy and terms consent"
          description="Review which privacy policy and terms of service versions you have accepted, and act on any required updates."
        />
        <PolicyConsentHistoryPanel />
      </section>
    </PublicShell>
  );
}
