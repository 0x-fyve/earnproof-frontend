"use client";

import { useEffect, useState } from "react";
import { PublicShell } from "@/components/layout/public-shell";
import { OrganizationContextProvider } from "@/lib/organization-context/context";
import { OrganizationSwitcher } from "@/components/organizations/organization-switcher";
import { EnvironmentContextProvider } from "@/lib/environment-context/context";
import { EnvironmentSwitcher } from "@/components/layout/environment-switcher";
import { readStoredOrganizationId } from "@/lib/organization-context/store";
import { getOrganizations } from "@/lib/api/organizations";
import type { Organization } from "@/lib/api/generated/v1";
import { readStoredSession } from "@/lib/session";

/**
 * Wraps any authenticated, organization-scoped route with tenant-context
 * isolation (#179). Pages that render org-scoped data should be nested
 * inside this shell and read the active organization via
 * useOrganizationContext rather than accepting an organizationId prop, so
 * a switch always resets their local state through the shared
 * `generation` counter.
 */
export function OrganizationWorkspaceShell({ children }: { children: React.ReactNode }) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const initialOrganizationId = readStoredOrganizationId();

  useEffect(() => {
    const session = readStoredSession();
    if (!session) {
      return;
    }

    let active = true;
    void Promise.resolve().then(async () => {
      const controller = new AbortController();
      try {
        const result = await getOrganizations(session.token, controller.signal);
        if (active) {
          setOrganizations(result);
        }
      } catch {
        if (active) {
          setLoadError("Could not load organizations.");
        }
      }
    });

    return () => {
      active = false;
    };
  }, []);

  return (
    <OrganizationContextProvider initialOrganizationId={initialOrganizationId}>
      <EnvironmentContextProvider>
        <PublicShell>
          <div className="border-b border-white/10 bg-white/[0.02] px-4 py-3 sm:px-8">
            {loadError ? (
              <p className="text-xs text-rose-200" role="alert">
                {loadError}
              </p>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="max-w-xs">
                  <OrganizationSwitcher organizations={organizations} />
                </div>
                <EnvironmentSwitcher />
              </div>
            )}
          </div>
          {children}
        </PublicShell>
      </EnvironmentContextProvider>
    </OrganizationContextProvider>
  );
}
