import { FeatureGrid, MarketingHero, pageContainer } from "@/components/common/production-ui";
import { PageHeading } from "@/components/common/page-heading";
import { PublicShell } from "@/components/layout/public-shell";
import { ApiDeprecationWarning } from "@/components/common/api-deprecation-warning";
import Link from "next/link";

const features = [
  { title: "Verification API", description: "Verify proof IDs or credentials with stable schemas, privacy-safe errors, and auditable results." },
  { title: "TypeScript SDK", description: "Integrate authentication, verification requests, and typed responses with the supported SDK." },
  { title: "Signed webhooks", description: "Receive verification events with replay protection, signature checks, and delivery diagnostics." },
];

export default function DevelopersPage() {
  return (
    <PublicShell>
      <div className={pageContainer}>
        <PageHeading title="Build with EarnProof" description="APIs, SDKs, schemas, and webhooks for private income verification." />
        <ApiDeprecationWarning />
        <MarketingHero title="Build with EarnProof" description="APIs, SDKs, schemas, and webhooks for private income verification." action="Read the quick start" href="/verify" />
        
        <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <h2 className="text-xl font-semibold text-white">Developer Tools</h2>
          <p className="text-sm leading-6 text-slate-300">
            Manage your API credentials and integration settings.
          </p>
          <div className="flex gap-3">
            <Link
              href="/developers/quickstart"
              className="inline-flex h-10 items-center justify-center rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200"
            >
              Integration Quickstart
            </Link>
            <Link
              href="/developers/api-keys"
              className="inline-flex h-10 items-center justify-center rounded-md border border-white/15 px-4 text-xs font-semibold text-white transition hover:bg-white/5"
            >
              Manage API Keys
            </Link>
            <Link
              href="/developers/webhooks"
              className="inline-flex h-10 items-center justify-center rounded-md border border-white/15 px-4 text-xs font-semibold text-white transition hover:bg-white/5"
            >
              Manage Webhooks
            </Link>
          </div>
        </section>
        
        <FeatureGrid items={features} />
      </div>
    </PublicShell>
  );
}
