import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { ApiKeyManagement } from "@/components/developers/api-key-management";
import { PublicShell } from "@/components/layout/public-shell";

export default function ApiKeysPage() {
  return (
    <PublicShell>
      <section className={`${pageContainer} gap-8 sm:gap-10`}>
        <PageHeading
          description="Create and manage API keys with scoped permissions for secure integration with EarnProof services."
          eyebrow="Developer tools"
          title="API Key Management"
        />
        <ApiKeyManagement />
      </section>
    </PublicShell>
  );
}