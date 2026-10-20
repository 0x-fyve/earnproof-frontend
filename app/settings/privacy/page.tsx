"use client";

import { useState } from "react";
import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { PublicShell } from "@/components/layout/public-shell";
import { ConsentReceiptLookup } from "@/components/proofs/consent-receipt-lookup";
import { readStoredSession } from "@/lib/session";

export default function PrivacySettingsPage() {
  const [session] = useState(() => readStoredSession());

  return (
    <PublicShell>
      <section className={`${pageContainer} gap-8 sm:gap-10`}>
        <PageHeading
          description="Review and look up disclosure consent receipts from proof verification requests you've approved."
          eyebrow="Privacy"
          title="Disclosure Consent Receipts"
        />
        {session ? (
          <ConsentReceiptLookup walletHash={session.user.walletHash} />
        ) : (
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
            <h2 className="text-xl font-semibold text-white">Authentication Required</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Please authenticate with a Stellar wallet to look up consent receipts.
            </p>
          </div>
        )}
      </section>
    </PublicShell>
  );
}
