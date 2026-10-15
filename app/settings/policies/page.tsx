import { Suspense } from "react";
import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { PublicShell } from "@/components/layout/public-shell";
import { RetentionPolicyViewer } from "@/components/policies/retention-policy-viewer";
import { LegalHoldManagement } from "@/components/policies/legal-hold-management";

export default function PoliciesPage() {
  return (
    <PublicShell>
      <section className={`${pageContainer} gap-8 sm:gap-10`}>
        <PageHeading
          description="Manage audit retention policies and legal holds to ensure compliance with data governance requirements."
          eyebrow="Compliance"
          title="Retention & Legal Hold Policies"
        />
        <Suspense
          fallback={
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 text-sm text-slate-300">
              Loading policies...
            </div>
          }
        >
          <div className="grid gap-12">
            <RetentionPolicyViewer />
            <LegalHoldManagement />
          </div>
        </Suspense>
      </section>
    </PublicShell>
  );
}
