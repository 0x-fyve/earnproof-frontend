"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CreateOrganizationForm } from "./create-organization-form";
import { OrganizationList } from "./organization-list";
import { OrganizationEditForm } from "./organization-edit-form";
import { getOrganizationsPaginated } from "@/lib/api/organizations";
import { usePagination } from "@/lib/hooks/use-pagination";
import type { OrganizationWithRevision } from "@/lib/api/organizations";
import { readStoredSession, type Session as SessionData } from "@/lib/session";

export function OrganizationManagement() {
  const [session] = useState<SessionData | null>(() => readStoredSession());
  const [organizations, setOrganizations] = useState<OrganizationWithRevision[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingOrgId, setEditingOrgId] = useState<string | null>(null);
  const [lifecycleAction, setLifecycleAction] = useState<{ action: string; organizationId: string; organizationName: string } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestCounterRef = useRef(0);
  const sessionToken = session?.token ?? null;

  const pagination = usePagination({ pageSize: 10 });

  const loadOrganizations = useCallback(
    async (navigateToNext: boolean = false, navigateToPrev: boolean = false) => {
      if (!sessionToken) {
        return;
      }

      // Cancel any pending request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      requestCounterRef.current += 1;
      const requestId = `req-${requestCounterRef.current}`;

      pagination.setLoading(true);
      setError(null);

      try {
        let nextCursor = pagination.currentPage.nextCursor ?? undefined;
        let previousCursor = pagination.currentPage.previousCursor ?? undefined;

        // Handle navigation requests
        if (navigateToNext && pagination.currentPage.nextCursor) {
          previousCursor = pagination.currentPage.nextCursor;
          nextCursor = undefined;
        } else if (navigateToPrev && pagination.currentPage.previousCursor) {
          nextCursor = pagination.currentPage.previousCursor;
          previousCursor = undefined;
        }

        const response = await getOrganizationsPaginated(
          sessionToken,
          pagination.pageSize,
          nextCursor,
          previousCursor,
          controller.signal
        );

        if (!controller.signal.aborted) {
          setOrganizations(response.items);
          pagination.setPageState(
            {
              nextCursor: response.nextCursor,
              previousCursor: response.previousCursor,
            },
            requestId
          );
        }
      } catch {
        if (!controller.signal.aborted) {
          setError("Failed to load organizations. Please try again.");
        }
      } finally {
        if (!controller.signal.aborted) {
          pagination.setLoading(false);
          pagination.clearUserInitiated();
        }
      }
    },
    [sessionToken, pagination]
  );

  useEffect(() => {
    let active = true;

    void Promise.resolve().then(() => {
      if (active) {
        void loadOrganizations();
      }
    });

    // Cleanup on unmount
    return () => {
      active = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [loadOrganizations]);

  const handleOrganizationCreated = useCallback((organization: OrganizationWithRevision) => {
    setOrganizations(prev => [...prev, organization]);
  }, []);

  const handleOrganizationUpdated = useCallback((updatedOrg: OrganizationWithRevision) => {
    // Cache refresh: only update after confirmed write success
    setOrganizations(prev => prev.map(org =>
      org.id === updatedOrg.id ? updatedOrg : org
    ));
  }, []);

  const handlePreviousPage = useCallback(() => {
    pagination.goToPreviousPage();
    void loadOrganizations(false, true);
  }, [pagination, loadOrganizations]);

  const handleNextPage = useCallback(() => {
    pagination.goToNextPage();
    void loadOrganizations(true, false);
  }, [pagination, loadOrganizations]);

  // Check if user has admin role
  const isAdmin = session?.user.role === "ADMIN" || session?.user.role === "ISSUER";

  if (!session) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 className="text-xl font-semibold text-white">Authentication Required</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Please authenticate with a Stellar wallet to access organization management.
        </p>
        <a
          className="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200"
          href="/proofs"
        >
          Connect Wallet
        </a>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-5">
        <h2 className="text-xl font-semibold text-amber-100">Access Restricted</h2>
        <p className="mt-2 text-sm leading-6 text-amber-200">
          Organization management requires administrative access. Contact your administrator if you need access to organization management tools.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-8 sm:gap-10">
      <CreateOrganizationForm 
        token={session.token}
        onOrganizationCreated={handleOrganizationCreated}
      />

      <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-semibold text-white">Organizations</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Manage organizations, their status, and associated metadata.
            </p>
          </div>
          <button
            className="h-10 rounded-md border border-white/15 px-4 text-xs font-semibold text-white disabled:opacity-50"
            disabled={pagination.isLoading}
            onClick={() => loadOrganizations()}
            type="button"
          >
            {pagination.isLoading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {error && (
          <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
            <p className="text-sm text-rose-200" role="alert">
              {error}
            </p>
          </div>
        )}

        {editingOrgId ? (
          <div className="grid gap-6 rounded-lg border border-white/10 bg-white/[0.04] p-5">
            <div>
              <h3 className="text-lg font-semibold text-white">Edit Organization</h3>
              <p className="mt-1 text-sm text-slate-400">
                Update organization metadata
              </p>
            </div>
            {organizations.find(org => org.id === editingOrgId) && (
              <OrganizationEditForm
                organization={organizations.find(org => org.id === editingOrgId)!}
                token={session.token}
                onOrganizationUpdated={handleOrganizationUpdated}
                onCancel={() => setEditingOrgId(null)}
              />
            )}
          </div>
        ) : (
          <OrganizationList
            organizations={organizations}
            loading={pagination.isLoading}
            token={session.token}
            paginationState={{
              ...pagination.currentPage,
              isLoading: pagination.isLoading,
            }}
            onPreviousPage={handlePreviousPage}
            onNextPage={handleNextPage}
            focusResults={pagination.wasUserInitiated}
            onOrganizationUpdated={handleOrganizationUpdated}
            onEditOrganization={(orgId) => setEditingOrgId(orgId)}
            onLifecycleAction={(action, orgId, orgName) =>
              setLifecycleAction({ action, organizationId: orgId, organizationName: orgName })
            }
          />
        )}
      </section>
    </div>
  );
}
