"use client";

import { useParams } from "next/navigation";
import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { PublicShell } from "@/components/layout/public-shell";
import { ProofDisputePanel } from "@/components/proofs/proof-dispute-panel";
import { readStoredSession } from "@/lib/session";

/**
 * #234: proof dispute submission and review, following the same
 * per-proof route pattern as app/proofs/[id]/share/page.tsx.
 */
export default function ProofDisputePage() {
  const params = useParams<{ id: string }>();
  const session = readStoredSession();

  return (
    <PublicShell>
      <section className={`${pageContainer} gap-8 sm:gap-10`}>
        <PageHeading
          description="Raise a dispute against this proof's claim or review disputes already raised. Disputing a proof never changes its cryptographic validity or revocation status."
          eyebrow="Proof disputes"
          title="Disputes for this proof"
        />

        {!session ? (
          <p className="text-sm text-slate-300">Sign in to raise or review disputes for this proof.</p>
        ) : (
          <ProofDisputePanel
            proofId={params.id}
            currentActorId={session.user.id}
            currentActorRole={session.user.role}
          />
        )}
      </section>
    </PublicShell>
  );
}
