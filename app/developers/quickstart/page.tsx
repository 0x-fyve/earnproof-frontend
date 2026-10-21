import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { IntegrationQuickstart } from "@/components/developers/integration-quickstart";
import { PublicShell } from "@/components/layout/public-shell";

export default function DeveloperQuickstartPage() {
  return (
    <PublicShell>
      <section className={`${pageContainer} gap-8 sm:gap-10`}>
        <PageHeading
          description="A guided path from API key creation to a successful authenticated verification request."
          eyebrow="Developer tools"
          title="Integration quickstart"
        />
        <IntegrationQuickstart />
      </section>
    </PublicShell>
  );
}
