import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { SessionManagement } from "@/components/sessions/session-management";
import { PublicShell } from "@/components/layout/public-shell";

export default function SessionsPage() {
  return (
    <PublicShell>
      <section className={`${pageContainer} gap-8 sm:gap-10`}>
        <PageHeading
          description="View and revoke active sessions on other devices."
          eyebrow="Account"
          title="Active Sessions"
        />
        <SessionManagement />
      </section>
    </PublicShell>
  );
}
