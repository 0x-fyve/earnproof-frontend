"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Organization } from "@/lib/api/generated/v1";
import { isOrganizationSelectable } from "@/lib/validation/organization-context";
import { storeOrganizationId, clearStoredOrganizationId } from "./store";

/**
 * There is no shared query cache in this app (no react-query wiring
 * anywhere, despite the dependency being installed - every component
 * fetches locally via useState/useEffect). Rather than adopt react-query
 * app-wide just for this feature, `generation` is a monotonically
 * increasing counter: any organization-scoped data-fetching component
 * includes it as a useEffect dependency (alongside the organization id),
 * so a switch always triggers a fresh fetch and any component keying its
 * local state by generation naturally discards the previous org's stale
 * data on the next render, without a global cache to invalidate.
 */
type OrganizationContextValue = {
  organizationId: string | null;
  organization: Organization | null;
  generation: number;
  switchOrganization: (organization: Organization) => Promise<void>;
  clearOrganization: () => void;
  /**
   * Drops the in-memory organization and bumps `generation` (so every
   * org-scoped consumer discards its data) WITHOUT writing storage or
   * notifying other tabs. Used when another tab changed the tenant (#274):
   * `nextOrganization` must come from a fresh server response, never from the
   * cross-tab message, and is ignored unless it is selectable.
   */
  resetOrganizationScope: (nextOrganization: Organization | null) => void;
  registerPendingMutation: () => () => void;
};

const OrganizationContext = createContext<OrganizationContextValue | null>(null);

export function OrganizationContextProvider({
  initialOrganizationId,
  onOrganizationChanged,
  children,
}: {
  initialOrganizationId: string | null;
  /** Called after a LOCAL switch or clear commits (e.g. to notify other tabs). Not called by resetOrganizationScope. */
  onOrganizationChanged?: (organizationId: string | null) => void;
  children: ReactNode;
}) {
  const [organizationId, setOrganizationId] = useState<string | null>(initialOrganizationId);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [generation, setGeneration] = useState(0);
  const pendingMutationsRef = useRef(0);
  const onOrganizationChangedRef = useRef(onOrganizationChanged);
  useEffect(() => {
    onOrganizationChangedRef.current = onOrganizationChanged;
  }, [onOrganizationChanged]);

  const registerPendingMutation = useCallback(() => {
    pendingMutationsRef.current += 1;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        pendingMutationsRef.current = Math.max(0, pendingMutationsRef.current - 1);
      }
    };
  }, []);

  const switchOrganization = useCallback(async (nextOrganization: Organization) => {
    if (!isOrganizationSelectable(nextOrganization)) {
      throw new Error("This organization cannot be selected.");
    }

    // Open mutations are cancelled or completed before context changes:
    // this app has no cancellation token registry for in-flight mutations
    // (see lib/organization-context/context.tsx's own comment above on
    // the absence of a shared query cache), so "cancelled or completed"
    // is honored by waiting for every mutation registered via
    // registerPendingMutation to finish releasing before the switch is
    // allowed to proceed, rather than switching underneath them.
    while (pendingMutationsRef.current > 0) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    storeOrganizationId(nextOrganization.id);
    setOrganizationId(nextOrganization.id);
    setOrganization(nextOrganization);
    setGeneration((value) => value + 1);
    onOrganizationChangedRef.current?.(nextOrganization.id);
  }, []);

  const clearOrganization = useCallback(() => {
    clearStoredOrganizationId();
    setOrganizationId(null);
    setOrganization(null);
    setGeneration((value) => value + 1);
    onOrganizationChangedRef.current?.(null);
  }, []);

  const resetOrganizationScope = useCallback((nextOrganization: Organization | null) => {
    const selectable = nextOrganization && isOrganizationSelectable(nextOrganization) ? nextOrganization : null;
    setOrganizationId(selectable?.id ?? null);
    setOrganization(selectable);
    setGeneration((value) => value + 1);
  }, []);

  const value = useMemo<OrganizationContextValue>(
    () => ({
      organizationId,
      organization,
      generation,
      switchOrganization,
      clearOrganization,
      resetOrganizationScope,
      registerPendingMutation,
    }),
    [
      organizationId,
      organization,
      generation,
      switchOrganization,
      clearOrganization,
      resetOrganizationScope,
      registerPendingMutation,
    ],
  );

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

export function useOrganizationContext(): OrganizationContextValue {
  const context = useContext(OrganizationContext);
  if (!context) {
    throw new Error("useOrganizationContext must be used within an OrganizationContextProvider");
  }
  return context;
}
