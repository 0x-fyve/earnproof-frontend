import { Metadata } from "next";
import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { PublicShell } from "@/components/layout/public-shell";
import { ContractUpgradeReviewPageContent } from "@/components/governance/contract-upgrade-review-page-content";

export const metadata: Metadata = {
  title: "Contract Upgrade Governance | Settings",
  description: "Review and approve contract upgrade compatibility checks",
};

export default function ContractUpgradeGovernancePage() {
  return (
    <PublicShell>
      <section className={`${pageContainer} gap-8 sm:gap-10`}>
        <PageHeading
          description="Review contract upgrade compatibility, migration requirements, and approve or reject upgrades."
          eyebrow="Operator Tools"
          title="Contract Upgrade Governance"
        />
        <ContractUpgradeReviewPageContent />
      </section>
    </PublicShell>
  );
}
