import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { VerifyErrorBoundary } from "@/components/common/verify-error-boundary";
import { PublicShell } from "@/components/layout/public-shell";
import { OfflineBundleWorkflow } from "@/components/verification/offline-bundle-workflow";
import { fetchMockOfflineBundleSource } from "@/lib/credentials/offline-bundle";

export const metadata = {
  title: "Offline verification bundle | EarnProof",
  description:
    "Prepare bounded signed evidence, then verify it locally when network access is unavailable.",
};

/**
 * Offline verification bundle workflow (#294).
 *
 * The signed evidence for the requested proof is loaded server-side today;
 * the workflow itself (scoping, download, local integrity check, offline
 * result, freshness refresh) runs entirely on the client.
 */
export default async function OfflineVerificationPage() {
  const source = await fetchMockOfflineBundleSource();

  return (
    <PublicShell>
      <section className={pageContainer}>
        <PageHeading
          description="Prepare bounded signed evidence, download it, and verify it locally when network access is unavailable."
          eyebrow="Verification"
          title="Offline verification bundle"
        />
        <VerifyErrorBoundary>
          <OfflineBundleWorkflow source={source} />
        </VerifyErrorBoundary>
      </section>
    </PublicShell>
  );
}
