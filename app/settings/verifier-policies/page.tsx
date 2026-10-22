import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { VerifierPolicyEditor } from "@/components/verification/verifier-policy-editor";
import { PublicShell } from "@/components/layout/public-shell";

export default function VerifierPoliciesPage() {
  return (
    <PublicShell>
      <section className={`${pageContainer} gap-8 sm:gap-10`}>
        <PageHeading
          description="Create and manage reusable local policies describing which issuers, schemas, and proof types you accept for verification."
          eyebrow="Verification"
          title="Verifier Policy Profiles"
        />
        <VerifierPolicyEditor />
      </section>
    </PublicShell>
  );
}
