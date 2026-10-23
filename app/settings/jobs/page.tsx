import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { PublicShell } from "@/components/layout/public-shell";
import { JobExecutionMonitor } from "@/components/jobs/job-execution-monitor";

export const metadata = {
  title: "Job executions | EarnProof",
  description: "Monitor recent background job executions, filtered by category and status.",
};

export default function JobExecutionsPage() {
  return (
    <PublicShell>
      <section className={`${pageContainer} gap-8 sm:gap-10`}>
        <PageHeading
          description="Filter and inspect recent sync, anchoring, export, cleanup, and reconciliation job executions."
          eyebrow="Administration"
          title="Job executions"
        />
        <JobExecutionMonitor />
      </section>
    </PublicShell>
  );
}
