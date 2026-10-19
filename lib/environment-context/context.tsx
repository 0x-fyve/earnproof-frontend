"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useOrganizationContext } from "@/lib/organization-context/context";
import { readStoredEnvironment, storeEnvironment } from "./store";
import { DEFAULT_ENVIRONMENT, type Environment } from "./types";

/**
 * Same no-shared-query-cache situation as lib/organization-context/context.tsx:
 * there is no react-query wiring in this app, so "separate query caches ...
 * per environment" (#233) is honored the same way organization switching
 * honors it - a monotonically increasing `generation` that environment-scoped
 * data-fetching components include as a useEffect dependency alongside
 * organizationId and environment, so switching environments always
 * triggers a fresh fetch and discards the previous environment's data on
 * the next render.
 */
type EnvironmentContextValue = {
  environment: Environment;
  generation: number;
  requestSwitch: (next: Environment, options?: { confirmed?: boolean }) => Promise<void>;
  needsConfirmation: (next: Environment) => boolean;
  registerPendingMutation: () => () => void;
};

const EnvironmentContext = createContext<EnvironmentContextValue | null>(null);

/**
 * Switching *into* production requires explicit confirmation (#233
 * acceptance criterion); switching into sandbox never needs it, since
 * sandbox is the safe-by-default side of the boundary this issue exists
 * to protect.
 */
function requiresConfirmation(next: Environment): boolean {
  return next === "production";
}

export function EnvironmentContextProvider({ children }: { children: ReactNode }) {
  const { organizationId, generation: organizationGeneration } = useOrganizationContext();
  const [environment, setEnvironment] = useState<Environment>(DEFAULT_ENVIRONMENT);
  const [generation, setGeneration] = useState(0);
  const pendingMutationsRef = useRef(0);

  // A new organization (including the very first load) always resets to
  // that organization's own stored environment, falling back to sandbox.
  // This also means a stale production selection from a *different*
  // organization can never leak into a freshly selected one.
  //
  // Reset happens during render (React's documented "adjust state while
  // rendering" pattern - see https://react.dev/reference/react/useState#storing-information-from-previous-renders)
  // rather than in a useEffect that calls setState, which would cause an
  // extra render pass. The last-seen key is itself tracked in state
  // (never a ref, which cannot be read or written during render), so the
  // reset still only fires once per actual organization/generation
  // change, not on every render.
  const organizationKey = `${organizationId ?? ""}:${organizationGeneration}`;
  const [lastOrganizationKey, setLastOrganizationKey] = useState<string | null>(null);
  if (lastOrganizationKey !== organizationKey) {
    setLastOrganizationKey(organizationKey);
    const restored = readStoredEnvironment(organizationId ?? "");
    if (restored !== environment) {
      setEnvironment(restored);
    }
    setGeneration((value) => value + 1);
  }

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

  const needsConfirmation = useCallback((next: Environment) => requiresConfirmation(next), []);

  const requestSwitch = useCallback(
    async (next: Environment, options?: { confirmed?: boolean }) => {
      if (requiresConfirmation(next) && !options?.confirmed) {
        throw new Error("Switching into production requires explicit confirmation.");
      }

      if (!organizationId) {
        throw new Error("Select an organization before switching environments.");
      }

      // Environment switches cancel in-flight mutations (#233 acceptance
      // criterion): rather than switch underneath a mutation that assumes
      // the old environment's context, wait for every mutation registered
      // via registerPendingMutation to finish releasing first - same
      // mechanism lib/organization-context/context.tsx uses for org
      // switches, since this app has no cancellation-token registry.
      while (pendingMutationsRef.current > 0) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      storeEnvironment(organizationId, next);
      setEnvironment(next);
      setGeneration((value) => value + 1);
    },
    [organizationId],
  );

  const value = useMemo<EnvironmentContextValue>(
    () => ({ environment, generation, requestSwitch, needsConfirmation, registerPendingMutation }),
    [environment, generation, requestSwitch, needsConfirmation, registerPendingMutation],
  );

  return <EnvironmentContext.Provider value={value}>{children}</EnvironmentContext.Provider>;
}

export function useEnvironmentContext(): EnvironmentContextValue {
  const context = useContext(EnvironmentContext);
  if (!context) {
    throw new Error("useEnvironmentContext must be used within an EnvironmentContextProvider");
  }
  return context;
}
