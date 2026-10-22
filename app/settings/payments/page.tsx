import Link from "next/link";
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
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <h2 className="text-xl font-semibold text-white">Account Rotation</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Replace the monitored Stellar payment account without merging
            checkpoint or proof eligibility history.
          </p>
          <Link
            href="/settings/payments/rotate"
            className="mt-4 inline-flex h-10 items-center justify-center rounded-md border border-white/15 px-4 text-xs font-semibold text-white transition hover:bg-white/10"
          >
            Rotate payment account
          </Link>
        </div>
        <CheckpointHealthDashboard />
      </section>
    </PublicShell>
  );
}
