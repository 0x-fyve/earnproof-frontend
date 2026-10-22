import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { PublicShell } from "@/components/layout/public-shell";
import { SecurityNotificationInbox } from "@/components/notifications/security-notification-inbox";

export const metadata = {
  title: "Security Notification Inbox | EarnProof",
  description:
    "Review tenant-scoped delivered, pending, acknowledged, and failed security notices across key rotation, session risk, role changes, disputes, and protocol incidents.",
};

export default function SecurityNotificationsPage() {
  return (
    <PublicShell>
      <section className={`${pageContainer} gap-8 sm:gap-10`}>
        <PageHeading
          description="Inspect delivered, pending, acknowledged, and failed security notices for your organization with redacted diagnostics and tenant-scoped deep links."
          eyebrow="Security"
          title="Security Notification Inbox"
        />
        <SecurityNotificationInbox />
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
