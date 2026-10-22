import { PageHeading } from "@/components/common/page-heading";
import { pageContainer } from "@/components/common/production-ui";
import { PublicShell } from "@/components/layout/public-shell";
import { SchemaImportContainer } from "@/components/schemas/schema-import-container";

/**
 * Schema Import page (/settings/schemas)
 *
 * Lets org administrators validate schema metadata and policy mappings before
 * importing them.  The page supports:
 *
 *  1. File upload or paste input
 *  2. Strict local validation (size, count, unknown fields, semver version)
 *  3. Conflict detection against the org's existing registry
 *  4. Dry-run preview — what WOULD be created/updated/skipped/rejected
 *
 * No actual import (write) is triggered from this page.  The dry-run path
 * is read-only: the server must not mutate state when processing a dry-run.
 *
 * Token and org ID are supplied as synthetic placeholder strings here because
 * the real authentication layer (session-based, wallet-backed) is provided
 * by the authenticated layout wrapper in production.  Replace these with the
 * session token and org ID resolution mechanism used elsewhere in the app.
 */
export default function SchemaImportPage() {
  // In production, token and organizationId are derived from the authenticated
  // session / org context (same pattern as developer API-key and webhook pages).
  // These placeholder values are intentionally non-functional and contain no
  // secrets, private keys, or production credentials.
  const token = ""; // Resolved at runtime from session context
  const organizationId = ""; // Resolved at runtime from org context

  return (
    <PublicShell>
      <section className={`${pageContainer} gap-8 sm:gap-10`}>
        <PageHeading
          eyebrow="Settings"
          title="Schema Import Validation"
          description="Validate schema metadata and policy mappings before importing them into your organization. Run a dry run to preview what would be created, updated, skipped, or rejected — without making any changes."
        />

        <div className="grid gap-6 rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <div>
            <h2 className="text-lg font-semibold text-white">How it works</h2>
            <ul className="mt-3 grid gap-2 text-sm text-slate-300">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-cyan-300/10 text-xs font-bold text-cyan-300">
                  1
                </span>
                Upload a JSON file or paste the import payload directly.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-cyan-300/10 text-xs font-bold text-cyan-300">
                  2
                </span>
                Review the normalized preview and any detected conflicts with existing schemas.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-cyan-300/10 text-xs font-bold text-cyan-300">
                  3
                </span>
                Run a dry run — the server evaluates the import and reports what would happen.
                No changes are made.
              </li>
            </ul>
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <SchemaImportContainer
            token={token}
            organizationId={organizationId}
          />
        </div>
      </section>
    </PublicShell>
  );
}
