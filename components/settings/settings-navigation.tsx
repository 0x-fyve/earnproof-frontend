"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigationItems = [
  {
    name: "Organizations",
    href: "/settings/organizations",
    description: "Manage organizations and their status",
  },
  {
    name: "Onboarding",
    href: "/settings/organizations/onboarding",
    description: "Review required and optional onboarding steps for this organization",
  },
  {
    name: "Issuers",
    href: "/settings/issuers",
    description: "Manage issuers and their organizational relationships",
  },
  {
    name: "Security",
    href: "/settings/security",
    description: "Monitor security posture and manage security checks across your organization",
  },
  {
    name: "Trusted Sources",
    href: "/settings/trusted-sources",
    description: "Manage trusted sources and their linked issuer identities",
  },
  {
    name: "Supported Assets",
    href: "/settings/assets",
    description: "Manage which Stellar assets can be indexed and used for proofs",
  },
  {
    name: "Sessions",
    href: "/settings/sessions",
    description: "View and revoke active sessions on other devices",
  },
  {
    name: "Schema Import",
    href: "/settings/schemas",
    description: "Validate schema metadata and policy mappings before importing them into your organization",
  },
  {
    name: "Audit Log",
    href: "/settings/audit",
    description: "Filter, verify, and export organization audit records",
  },
  {
    name: "Usage & Quotas",
    href: "/settings/usage",
    description: "Track quota usage and request rate limits",
  },
  {
    name: "Job Executions",
    href: "/settings/jobs",
    description: "Monitor recent background job executions and their outcomes",
  },
];

const personalItems = [
  {
    name: "Preferences",
    href: "/settings/preferences",
    description: "Language and time zone for dates, times, and numbers",
  },
];

export function SettingsNavigation() {
  const pathname = usePathname();

  return (
    <div className="grid gap-6">
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 className="text-xl font-semibold text-white">Preferences</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Personal display settings, available to every user regardless of role.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {personalItems.map((item) => {
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.name}
                href={item.href}
                className={`block rounded-lg border p-4 transition ${
                  isActive
                    ? "border-cyan-300/50 bg-cyan-300/5"
                    : "border-white/10 bg-transparent hover:bg-white/[0.02] hover:border-white/15"
                }`}
              >
                <div className="text-lg font-medium text-white">
                  {item.name}
                </div>
                <div className="mt-1 text-sm text-slate-300">
                  {item.description}
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 className="text-xl font-semibold text-white">Administrative Tools</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Access administrative functions based on your role and permissions.
        </p>
        
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {navigationItems.map((item) => {
            const isActive = pathname === item.href;
            
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`block rounded-lg border p-4 transition ${
                  isActive
                    ? "border-cyan-300/50 bg-cyan-300/5"
                    : "border-white/10 bg-transparent hover:bg-white/[0.02] hover:border-white/15"
                }`}
              >
                <div className="text-lg font-medium text-white">
                  {item.name}
                </div>
                <div className="mt-1 text-sm text-slate-300">
                  {item.description}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
      
      <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-amber-100" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-amber-100">Role-Based Access</h3>
            <p className="mt-1 text-xs text-amber-200">
              Administrative functions require appropriate role permissions. 
              Features may be restricted based on your account access level.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}