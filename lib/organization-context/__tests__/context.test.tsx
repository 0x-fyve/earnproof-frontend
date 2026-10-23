/**
 * @jest-environment jsdom
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { OrganizationContextProvider, useOrganizationContext } from "../context";
import type { Organization } from "@/lib/api/generated/v1";

function org(status: Organization["status"], id = "org-1"): Organization {
  return { id, name: "Acme", slug: "acme", status };
}

function wrapper({ children }: { children: ReactNode }) {
  return <OrganizationContextProvider initialOrganizationId={null}>{children}</OrganizationContextProvider>;
}

describe("OrganizationContextProvider / useOrganizationContext", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts with no organization selected by default", () => {
    const { result } = renderHook(() => useOrganizationContext(), { wrapper });
    expect(result.current.organizationId).toBeNull();
    expect(result.current.organization).toBeNull();
  });

  it("restores the initial organization id passed in", () => {
    const { result } = renderHook(() => useOrganizationContext(), {
      wrapper: ({ children }) => (
        <OrganizationContextProvider initialOrganizationId="org-1">{children}</OrganizationContextProvider>
      ),
    });
    expect(result.current.organizationId).toBe("org-1");
  });

  it("switches to a new organization and increments generation", async () => {
    const { result } = renderHook(() => useOrganizationContext(), { wrapper });
    const initialGeneration = result.current.generation;

    await act(async () => {
      await result.current.switchOrganization(org("ACTIVE", "org-2"));
    });

    expect(result.current.organizationId).toBe("org-2");
    expect(result.current.organization).toEqual(org("ACTIVE", "org-2"));
    expect(result.current.generation).toBe(initialGeneration + 1);
  });

  it("persists the switched organization id to storage", async () => {
    const { result } = renderHook(() => useOrganizationContext(), { wrapper });

    await act(async () => {
      await result.current.switchOrganization(org("ACTIVE", "org-3"));
    });

    expect(window.localStorage.getItem("earnproof.current-organization-id")).toBe("org-3");
  });

  it("rejects switching to an archived organization", async () => {
    const { result } = renderHook(() => useOrganizationContext(), { wrapper });

    await expect(
      act(async () => {
        await result.current.switchOrganization(org("REVOKED", "org-bad"));
      }),
    ).rejects.toThrow(/cannot be selected/i);

    expect(result.current.organizationId).toBeNull();
  });

  it("clears the organization and increments generation", async () => {
    const { result } = renderHook(() => useOrganizationContext(), { wrapper });

    await act(async () => {
      await result.current.switchOrganization(org("ACTIVE", "org-4"));
    });
    const generationAfterSwitch = result.current.generation;

    act(() => {
      result.current.clearOrganization();
    });

    expect(result.current.organizationId).toBeNull();
    expect(result.current.generation).toBe(generationAfterSwitch + 1);
    expect(window.localStorage.getItem("earnproof.current-organization-id")).toBeNull();
  });

  it("waits for a registered pending mutation to release before completing a switch", async () => {
    const { result } = renderHook(() => useOrganizationContext(), { wrapper });

    let release!: () => void;
    act(() => {
      release = result.current.registerPendingMutation();
    });

    let switched = false;
    const switchPromise = act(async () => {
      const promise = result.current.switchOrganization(org("ACTIVE", "org-5")).then(() => {
        switched = true;
      });
      // Give the pending-mutation poll loop a couple of ticks to run while
      // the mutation is still registered as in flight.
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(switched).toBe(false);
      release();
      await promise;
    });

    await switchPromise;
    expect(switched).toBe(true);
    expect(result.current.organizationId).toBe("org-5");
  });

  it("throws when used outside the provider", () => {
    const { result } = renderHook(() => {
      try {
        return useOrganizationContext();
      } catch (error) {
        return error;
      }
    });

    expect(result.current).toBeInstanceOf(Error);
  });
});

describe("OrganizationContextProvider cross-tab hooks (#274)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  function renderWithCallback(onOrganizationChanged: (id: string | null) => void, initialOrganizationId: string | null = "org-1") {
    return renderHook(() => useOrganizationContext(), {
      wrapper: ({ children }) => (
        <OrganizationContextProvider initialOrganizationId={initialOrganizationId} onOrganizationChanged={onOrganizationChanged}>
          {children}
        </OrganizationContextProvider>
      ),
    });
  }

  it("notifies onOrganizationChanged after a local switch and a local clear", async () => {
    const onChanged = jest.fn();
    const { result } = renderWithCallback(onChanged);

    await act(async () => {
      await result.current.switchOrganization(org("ACTIVE", "org-2"));
    });
    act(() => {
      result.current.clearOrganization();
    });

    expect(onChanged.mock.calls).toEqual([["org-2"], [null]]);
  });

  it("does not notify when a switch is rejected", async () => {
    const onChanged = jest.fn();
    const { result } = renderWithCallback(onChanged);
    await act(async () => {
      await expect(result.current.switchOrganization(org("SUSPENDED", "org-2"))).rejects.toThrow();
    });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("resetOrganizationScope drops the organization and bumps generation without touching storage or notifying", () => {
    const onChanged = jest.fn();
    window.localStorage.setItem("earnproof.current-organization-id", "org-other-tab");
    const { result } = renderWithCallback(onChanged);
    const before = result.current.generation;

    act(() => {
      result.current.resetOrganizationScope(null);
    });

    expect(result.current.organizationId).toBeNull();
    expect(result.current.organization).toBeNull();
    expect(result.current.generation).toBe(before + 1);
    expect(window.localStorage.getItem("earnproof.current-organization-id")).toBe("org-other-tab");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("resetOrganizationScope adopts a selectable organization but refuses an unselectable one", () => {
    const { result } = renderWithCallback(jest.fn(), null);

    act(() => {
      result.current.resetOrganizationScope(org("ACTIVE", "org-2"));
    });
    expect(result.current.organizationId).toBe("org-2");

    act(() => {
      result.current.resetOrganizationScope(org("REVOKED", "org-3"));
    });
    expect(result.current.organizationId).toBeNull();
  });
});
