/**
 * @jest-environment jsdom
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { OrganizationContextProvider, useOrganizationContext } from "@/lib/organization-context/context";
import { EnvironmentContextProvider, useEnvironmentContext } from "../context";
import { storeEnvironment } from "../store";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <OrganizationContextProvider initialOrganizationId="org-1">
      <EnvironmentContextProvider>{children}</EnvironmentContextProvider>
    </OrganizationContextProvider>
  );
}

function useCombined() {
  return {
    organization: useOrganizationContext(),
    environment: useEnvironmentContext(),
  };
}

describe("EnvironmentContextProvider / useEnvironmentContext", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to sandbox for a fresh organization", () => {
    const { result } = renderHook(() => useEnvironmentContext(), { wrapper });
    expect(result.current.environment).toBe("sandbox");
  });

  it("restores a previously stored environment for the active organization", async () => {
    storeEnvironment("org-1", "production");
    const { result } = renderHook(() => useEnvironmentContext(), { wrapper });
    await waitFor(() => expect(result.current.environment).toBe("production"));
  });

  it("switches to production when confirmed", async () => {
    const { result } = renderHook(() => useEnvironmentContext(), { wrapper });

    await act(async () => {
      await result.current.requestSwitch("production", { confirmed: true });
    });

    expect(result.current.environment).toBe("production");
  });

  it("rejects switching to production without confirmation", async () => {
    const { result } = renderHook(() => useEnvironmentContext(), { wrapper });

    await expect(
      act(async () => {
        await result.current.requestSwitch("production");
      }),
    ).rejects.toThrow(/explicit confirmation/i);

    expect(result.current.environment).toBe("sandbox");
  });

  it("does not require confirmation when switching into sandbox", () => {
    const { result } = renderHook(() => useEnvironmentContext(), { wrapper });
    expect(result.current.needsConfirmation("sandbox")).toBe(false);
    expect(result.current.needsConfirmation("production")).toBe(true);
  });

  it("persists the switched environment scoped to the organization id", async () => {
    const { result } = renderHook(() => useEnvironmentContext(), { wrapper });

    await act(async () => {
      await result.current.requestSwitch("production", { confirmed: true });
    });

    expect(window.localStorage.getItem("earnproof.environment.org-1")).toBe("production");
  });

  it("increments generation on every environment switch for cache isolation", async () => {
    const { result } = renderHook(() => useEnvironmentContext(), { wrapper });
    const initialGeneration = result.current.generation;

    await act(async () => {
      await result.current.requestSwitch("production", { confirmed: true });
    });

    expect(result.current.generation).toBeGreaterThan(initialGeneration);
  });

  it("resets to the new organization's own stored environment on an organization switch, discarding stale state", async () => {
    storeEnvironment("org-2", "production");
    const { result } = renderHook(() => useCombined(), { wrapper });

    expect(result.current.environment.environment).toBe("sandbox");

    await act(async () => {
      await result.current.organization.switchOrganization({
        id: "org-2",
        name: "Other Co",
        slug: "other-co",
        status: "ACTIVE",
      });
    });

    await waitFor(() => expect(result.current.environment.environment).toBe("production"));
  });

  it("waits for pending mutations to release before completing a switch", async () => {
    const { result } = renderHook(() => useEnvironmentContext(), { wrapper });

    let release: (() => void) | undefined;
    act(() => {
      release = result.current.registerPendingMutation();
    });

    let switched = false;
    const switchPromise = act(async () => {
      await result.current.requestSwitch("production", { confirmed: true }).then(() => {
        switched = true;
      });
    });

    // Give the polling loop a couple of ticks to prove it is still waiting.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(switched).toBe(false);

    act(() => {
      release?.();
    });

    await switchPromise;
    expect(switched).toBe(true);
    expect(result.current.environment).toBe("production");
  });

  it("throws when used outside of a provider", () => {
    const { result } = renderHook(() => {
      try {
        return useEnvironmentContext();
      } catch (error) {
        return error;
      }
    });
    expect(result.current).toBeInstanceOf(Error);
  });
});
