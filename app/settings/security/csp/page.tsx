import Link from "next/link";
import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { PublicShell } from "@/components/layout/public-shell";
import { CspViolationsView } from "@/components/security/csp-violations-view";

export default function CspViolationsPage() {
  return (
    <PublicShell>
      <section className={`${pageContainer} gap-8 sm:gap-10`}>
        <PageHeading
          description="Aggregated counts of resources the browser blocked under the Content Security Policy, grouped by directive, route category and release. No URLs, page content or user input are collected or shown."
          eyebrow="Security"
          title="CSP violation diagnostics"
        />
        <Link className="w-fit text-sm text-cyan-200 underline" href="/settings/security">
          Back to security posture
        </Link>
        <CspViolationsView />
      </section>
    </PublicShell>
  );
}
