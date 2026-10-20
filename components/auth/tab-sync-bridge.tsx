"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Organization } from "@/lib/api/generated/v1";
import { getTabSyncCoordinator, type TabSyncCoordinator, type TabSyncEvent } from "@/lib/auth/tab-sync-coordinator";
import { TAB_SYNC_RESTRICTIVENESS } from "@/lib/auth/tab-sync-protocol";
import { TokenManager } from "@/lib/auth/token-manager";
import { useOrganizationContext } from "@/lib/organization-context/context";
import { readStoredOrganizationId } from "@/lib/organization-context/store";
import { clearStoredSession } from "@/lib/session";
import { findSelectedOrganization } from "@/lib/validation/organization-context";

type LockReason = "session_revoked" | "wallet_logout";

export interface TabSyncBridgeProps {
  /**
   * Re-fetches the viewer's organizations from the server with the current
   * session. Resolves null when there is no session or the request fails.
   */
  refetchOrganizations: () => Promise<Organization[] | null>;
  /** Injected for tests; defaults to the shared tab coordinator. */
  coordinator?: TabSyncCoordinator | null;
  children: ReactNode;
}

const LOCK_COPY: Record<LockReason, { title: string; body: string }> = {
  session_revoked: {
    title: "Session revoked in another tab",
    body: "Your session was revoked while this tab was open. This tab has been locked and its organization data cleared.",
  },
  wallet_logout: {
    title: "Signed out in another tab",
    body: "Your wallet was signed out in another tab. This tab has been locked and its organization data cleared.",
  },
};

/**
 * Applies cross-tab downgrades (#274) inside an organization workspace.
 *
 * Effects are cumulative by restrictiveness:
 * - tenant_switched (1) and above: drop this tab's organization-scoped data
 *   immediately, then re-fetch organizations from the server and restore
 *   the stored selection only if the fresh server list says it is
 *   selectable. The message's tenantId is never used.
 * - recent_auth_expired (2): handled by useRecentAuth; announced here.
 * - wallet_logout (3) / session_revoked (4): clear this tab's session and
 *   in-memory token, and lock the workspace. The lock only ends when the
 *   page is reloaded or navigated (and the stored session is re-read);
 *   no received message can unlock it.
 */
export function TabSyncBridge({ refetchOrganizations, coordinator, children }: TabSyncBridgeProps) {
  const { resetOrganizationScope } = useOrganizationContext();
  const [lock, setLock] = useState<LockReason | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const revalidationRef = useRef(0);
  const lockedRef = useRef(false);
  const lockHeadingRef = useRef<HTMLHeadingElement>(null);

  const handleEvent = useCallback(
    (event: TabSyncEvent) => {
      // Any newer event supersedes an in-flight revalidation.
      revalidationRef.current += 1;
      const revalidation = revalidationRef.current;

      resetOrganizationScope(null);

      if (event.level >= TAB_SYNC_RESTRICTIVENESS.wallet_logout) {
        clearStoredSession({ broadcast: false });
        TokenManager.getInstance().clearToken();
        lockedRef.current = true;
        const reason: LockReason = event.type === "session_revoked" ? "session_revoked" : "wallet_logout";
        setLock((current) => (current === "session_revoked" ? current : reason));
        setAnnouncement(LOCK_COPY[reason].title);
        return;
      }

      if (lockedRef.current) return;

      setAnnouncement(
        event.level >= TAB_SYNC_RESTRICTIVENESS.recent_auth_expired
          ? "Your recent wallet confirmation expired in another tab. Re-checking your organization access."
          : "Your organization changed in another tab. Re-checking your access.",
      );

      void refetchOrganizations().then((organizations) => {
        if (revalidation !== revalidationRef.current || lockedRef.current) return;
        if (!organizations) {
          setAnnouncement("Could not re-check organization access. Select an organization to continue.");
          return;
        }
        const match = findSelectedOrganization(organizations, readStoredOrganizationId());
        resetOrganizationScope(match);
        setAnnouncement(
          match ? "Organization access re-checked." : "Select an organization to continue.",
        );
      });
    },
    [refetchOrganizations, resetOrganizationScope],
  );

  useEffect(() => {
    const active = coordinator === undefined ? getTabSyncCoordinator() : coordinator;
    if (!active) return undefined;
    const unsubscribe = active.subscribe(handleEvent);
    return () => {
      unsubscribe();
      // Results of a revalidation started before unmount must not apply.
      revalidationRef.current += 1;
    };
  }, [coordinator, handleEvent]);

  useEffect(() => {
    if (lock) lockHeadingRef.current?.focus();
  }, [lock]);

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only" data-testid="tab-sync-status">
        {announcement}
      </p>
      {lock ? (
        <section
          role="alert"
          aria-labelledby="tab-sync-lock-title"
          className="mx-4 my-8 grid gap-3 rounded-lg border border-rose-300/30 bg-rose-500/10 p-5 sm:mx-8"
        >
          <h2
            id="tab-sync-lock-title"
            ref={lockHeadingRef}
            tabIndex={-1}
            className="text-lg font-semibold text-white focus:outline-none"
          >
            {LOCK_COPY[lock].title}
          </h2>
          <p className="text-sm text-slate-200">{LOCK_COPY[lock].body}</p>
          <p className="text-sm text-slate-200">Sign in again to continue.</p>
          <div>
            <Link
              href="/"
              className="inline-flex h-10 items-center rounded-md border border-white/15 px-4 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Go to home page
            </Link>
          </div>
        </section>
      ) : (
        children
      )}
    </>
  );
}
