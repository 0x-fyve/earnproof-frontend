import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { AccountRotationManagement } from "@/components/payments/account-rotation-management";
import { PublicShell } from "@/components/layout/public-shell";

export default function PaymentAccountRotationPage() {
  return (
    <PublicShell>
      <section className={`${pageContainer} gap-8 sm:gap-10`}>
        <PageHeading
          description="Replace the monitored Stellar payment account without merging checkpoint or proof eligibility history."
          eyebrow="Administration"
          title="Payment Account Rotation"
        />
        <AccountRotationManagement />
      </section>
    </PublicShell>
  );
}
