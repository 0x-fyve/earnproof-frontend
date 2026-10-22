"use client";

import { useState } from "react";
import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { PublicShell } from "@/components/layout/public-shell";
import { ConsentReceiptLookup } from "@/components/proofs/consent-receipt-lookup";
import { PolicyConsentHistoryPanel } from "@/components/settings/policy-consent-history";
import { readStoredSession } from "@/lib/session";

export default function PrivacySettingsPage() {
  const [session] = useState(() => readStoredSession());

  return (
    <PublicShell>
      <section className={`${pageContainer} gap-8 sm:gap-10`}>
        <PageHeading
          description="Review which privacy policy and terms of service versions you have accepted, and look up disclosure consent receipts from proof verification requests you've approved."
          eyebrow="Privacy"
          title="Privacy and Consent Settings"
        />
        <PolicyConsentHistoryPanel />
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
