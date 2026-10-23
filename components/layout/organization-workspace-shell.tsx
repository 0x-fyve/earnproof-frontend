"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PublicShell } from "@/components/layout/public-shell";
import { OrganizationContextProvider } from "@/lib/organization-context/context";
import { OrganizationSwitcher } from "@/components/organizations/organization-switcher";
import { EnvironmentContextProvider } from "@/lib/environment-context/context";
import { EnvironmentSwitcher } from "@/components/layout/environment-switcher";
import { TabSyncBridge } from "@/components/auth/tab-sync-bridge";
import { getTabSyncCoordinator } from "@/lib/auth/tab-sync-coordinator";
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
 *
 * Cross-tab sync (#274): a local organization switch is announced to other
 * tabs, and TabSyncBridge applies downgrades received from them (dropping
 * tenant data, re-checking access with the server, or locking on logout).
 */
export function OrganizationWorkspaceShell({ children }: { children: React.ReactNode }) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initialOrganizationId] = useState(readStoredOrganizationId);
  const inFlightRef = useRef<AbortController | null>(null);

  // Only the latest request may update state: starting a new one aborts the
  // previous one, so a slow earlier response can never overwrite a newer one.
  const refetchOrganizations = useCallback(async (): Promise<Organization[] | null> => {
    inFlightRef.current?.abort();
    const session = readStoredSession();
    if (!session) {
      inFlightRef.current = null;
      return null;
    }

    const controller = new AbortController();
    inFlightRef.current = controller;
    try {
      const result = await getOrganizations(session.token, controller.signal);
      if (controller.signal.aborted) return null;
      setOrganizations(result);
      setLoadError(null);
      return result;
    } catch {
      if (!controller.signal.aborted) {
        setLoadError("Could not load organizations.");
      }
      return null;
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(refetchOrganizations);
    return () => {
      inFlightRef.current?.abort();
    };
  }, [refetchOrganizations]);

  const announceOrganizationChange = useCallback((organizationId: string | null) => {
    getTabSyncCoordinator()?.publish(
      "tenant_switched",
      organizationId === null ? undefined : { tenantId: organizationId },
    );
  }, []);

  return (
    <OrganizationContextProvider
      initialOrganizationId={initialOrganizationId}
      onOrganizationChanged={announceOrganizationChange}
    >
      <EnvironmentContextProvider>
        <PublicShell>
          <TabSyncBridge refetchOrganizations={refetchOrganizations}>
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
          </TabSyncBridge>
        </PublicShell>
      </EnvironmentContextProvider>
    </OrganizationContextProvider>
  );
}
