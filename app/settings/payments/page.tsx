import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { PaymentSyncPanel } from "@/components/payments/payment-sync-panel";
import { CheckpointHealthDashboard } from "@/components/payments/checkpoint-health-dashboard";
import { PublicShell } from "@/components/layout/public-shell";

export default function PaymentsSettingsPage() {
  return (
    <PublicShell>
      <section className={`${pageContainer} gap-8 sm:gap-10`}>
        <PageHeading
          description="Trigger and monitor payment synchronization from the network."
          eyebrow="Administration"
          title="Payment Synchronization"
        />
        <PaymentSyncPanel />
        <CheckpointHealthDashboard />
      </section>
    </PublicShell>
  );
}
