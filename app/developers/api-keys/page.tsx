import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { ApiKeyManagement } from "@/components/developers/api-key-management";
import { PublicShell } from "@/components/layout/public-shell";

// #332: overrides the (public) /developers default — API key management
// is account-scoped and must require authentication.
export const routeAuth = {
  access: "protected",
  role: null,
  capability: null,
  cache: "no-store",
};

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