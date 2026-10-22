import { Metadata } from "next";
import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { PublicShell } from "@/components/layout/public-shell";
import { GovernanceProposalsPageContent } from "@/components/governance-proposals/governance-proposals-page-content";

export const metadata: Metadata = {
  title: "Governance Proposals | Settings",
  description: "Review and approve bounded governance proposals",
};

export default function GovernanceProposalsPage() {
  return (
    <PublicShell>
      <section className={`${pageContainer} gap-8 sm:gap-10`}>
        <PageHeading
          description="Review governance proposals, inspect decoded actions, and approve with a fresh wallet signature."
          eyebrow="Operator Tools"
          title="Governance Proposals"
        />
        <GovernanceProposalsPageContent />
      </section>
    </PublicShell>
  );
}
