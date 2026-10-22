import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { SessionManagement } from "@/components/sessions/session-management";
import { PublicShell } from "@/components/layout/public-shell";

export const metadata = {
  title: "Active Sessions & Security History | EarnProof",
  description:
    "View active sessions, privacy-safe session risk signals, recent-authentication expiry, and reauthentication history.",
};

export default function SessionsPage() {
  return (
    <PublicShell>
      <section className={`${pageContainer} gap-8 sm:gap-10`}>
        <PageHeading
          description="View and revoke active sessions on other devices, inspect privacy-safe risk signals, and review recent-authentication history."
          eyebrow="Account"
          title="Active Sessions"
        />
        <SessionManagement />
      </section>
    </PublicShell>
  );
}
