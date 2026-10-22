import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { SecurityDashboard } from "@/components/security/security-dashboard";
import { PublicShell } from "@/components/layout/public-shell";
import Link from "next/link";
import { Suspense } from "react";

export default function SecurityPage() {
  return (
    <PublicShell>
      <section className={`${pageContainer} gap-8 sm:gap-10`}>
        <PageHeading
          description="Monitor your organization's security posture, review security checks across key rotation, session management, webhooks, roles, contracts, and recovery options. Acknowledge findings as acceptable business risks when needed."
          eyebrow="Security"
          title="Organization Security Posture"
        />
        <Link className="w-fit text-sm text-cyan-200 underline" href="/settings/security/csp">
          CSP violation diagnostics
        </Link>
        <Suspense
          fallback={
            <div className="space-y-6">
              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-6">
                <div className="h-12 w-32 animate-pulse rounded bg-white/10" />
                <div className="mt-4 h-6 w-full animate-pulse rounded bg-white/10" />
              </div>
            </div>
          }
        >
          <SecurityDashboard />
        </Suspense>
      </section>
    </PublicShell>
  );
}
