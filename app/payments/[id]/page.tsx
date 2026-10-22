"use client";

import { useState } from "react";
import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { PublicShell } from "@/components/layout/public-shell";
import { PaymentEligibilityPanel } from "@/components/payments/payment-eligibility-panel";
import { PaymentOperationEvidenceViewer } from "@/components/payments/payment-operation-evidence-viewer";
import { readStoredSession } from "@/lib/session";

export default function PaymentDetailPage({ params }: { params: { id: string } }) {
  const [token] = useState<string | null>(() => readStoredSession()?.token ?? null);
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <PublicShell>
      <section className={`${pageContainer} gap-8 sm:gap-10`}>
        <PageHeading
          description="Why this payment can or cannot support a proof."
          eyebrow="Payments"
          title="Payment Eligibility"
        />
        {token ? (
          <div className="grid gap-4">
            <button
              onClick={() => setRefreshToken((n) => n + 1)}
              className="justify-self-start h-9 rounded-md border border-white/15 px-4 text-xs font-semibold text-white transition hover:bg-white/5"
              type="button"
            >
              Refresh
            </button>
            <PaymentOperationEvidenceViewer token={token} paymentId={params.id} />
            <PaymentEligibilityPanel
              token={token}
              paymentId={params.id}
              refreshToken={refreshToken}
            />
          </div>
        ) : (
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
            <h2 className="text-xl font-semibold text-white">Authentication Required</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Please authenticate with a Stellar wallet to view payment eligibility.
            </p>
          </div>
        )}
      </section>
    </PublicShell>
  );
}
