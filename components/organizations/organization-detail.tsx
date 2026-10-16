"use client";

import { formatOrganizationStatus, getStatusTone } from "@/lib/api/organizations";
import { StatusBadge } from "@/components/common/production-ui";
import type { Organization } from "@/lib/api/generated/v1";

/**
 * Read-only organization detail view for non-privileged users.
 * 
 * Renders organization information without any edit controls.
 * This component is used when a user has read-only access or
 * lacks the necessary permissions to modify the organization.
 */
export function OrganizationDetail({
  organization,
}: {
  organization: Organization;
}) {
  return (
    <section className="grid gap-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-white">{organization.name}</h2>
        <p className="mt-1 text-sm text-slate-400">
          Organization details and information
        </p>
      </div>

      {/* Info Grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Name Card */}
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
          <div className="text-xs font-semibold uppercase text-slate-400">
            Organization Name
          </div>
          <div className="mt-2 text-base font-medium text-white">
            {organization.name}
          </div>
        </div>

        {/* Slug Card */}
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
          <div className="text-xs font-semibold uppercase text-slate-400">
            Slug
          </div>
          <div className="mt-2 font-mono text-base text-slate-300">
            {organization.slug}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Used in URLs and API endpoints
          </p>
        </div>

        {/* Status Card */}
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
          <div className="text-xs font-semibold uppercase text-slate-400">
            Status
          </div>
          <div className="mt-2">
            <StatusBadge tone={getStatusTone(organization.status)}>
              {formatOrganizationStatus(organization.status)}
            </StatusBadge>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Current operational status
          </p>
        </div>

        {/* Website Card */}
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
          <div className="text-xs font-semibold uppercase text-slate-400">
            Website
          </div>
          {organization.website ? (
            <div className="mt-2">
              <a
                href={organization.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-base text-cyan-300 hover:text-cyan-200 transition break-all"
              >
                {organization.website}
              </a>
            </div>
          ) : (
            <div className="mt-2 text-base text-slate-500">
              Not provided
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Organization&apos;s public website
          </p>
        </div>

        {/* ID Card */}
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4 md:col-span-2">
          <div className="text-xs font-semibold uppercase text-slate-400">
            Organization ID
          </div>
          <div className="mt-2 font-mono text-sm text-slate-300 break-all">
            {organization.id}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Unique identifier for this organization
          </p>
        </div>
      </div>

      {/* Access Notice */}
      <div className="rounded-lg border border-blue-300/30 bg-blue-300/10 p-4">
        <p className="text-sm text-blue-200">
          You have read-only access to this organization. Contact an administrator if you need to make changes.
        </p>
      </div>
    </section>
  );
}
