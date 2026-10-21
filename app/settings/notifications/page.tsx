import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { PublicShell } from "@/components/layout/public-shell";
import { NotificationPreferencesSettingsPanel } from "@/components/settings/notification-preferences-panel";

export default function NotificationPreferencesSettingsPage() {
  return (
    <PublicShell>
      <section className={pageContainer}>
        <PageHeading
          eyebrow="Security"
          title="Notification preferences"
          description="Control how you're notified about session, key, webhook, proof, and governance events. Some categories are mandatory and protect your account."
        />
        <NotificationPreferencesSettingsPanel />
      </section>
    </PublicShell>
  );
}
