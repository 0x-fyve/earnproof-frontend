/**
 * @jest-environment jsdom
 */

import { act, render, screen } from "@testing-library/react";
import type { Organization } from "@/lib/api/generated/v1";
import { TabSyncBridge } from "../tab-sync-bridge";
import { OrganizationContextProvider, useOrganizationContext } from "@/lib/organization-context/context";
import { TAB_SYNC_RESTRICTIVENESS, type TabSyncEventType } from "@/lib/auth/tab-sync-protocol";
import type { TabSyncCoordinator, TabSyncEvent, TabSyncListener } from "@/lib/auth/tab-sync-coordinator";
import { TokenManager } from "@/lib/auth/token-manager";
import { FIXED_NOW, TAB_B } from "@/tests/fixtures/tab-sync-fixtures";

const SESSION_KEY = "earnproof.session";
const ORG_KEY = "earnproof.current-organization-id";

function org(id: string, status: Organization["status"] = "ACTIVE"): Organization {
  return { id, name: "Synthetic " + id, slug: id, status };
}

function fakeCoordinator() {
  const listeners = new Set<TabSyncListener>();
  let epoch = FIXED_NOW;
  const coordinator = {
    tabId: "f".repeat(32),
    publish: jest.fn(() => "sent" as const),
    subscribe: (listener: TabSyncListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as TabSyncCoordinator;
  const emit = (type: TabSyncEventType, tenantId?: string) => {
    epoch += 1;
    const event: TabSyncEvent = {
      type,
      level: TAB_SYNC_RESTRICTIVENESS[type],
      epoch,
      sourceTabId: TAB_B,
      receivedAt: epoch,
      ...(tenantId ? { tenantId } : {}),
    };
    act(() => listeners.forEach((listener) => listener(event)));
  };
  return { coordinator, emit, listenerCount: () => listeners.size };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function OrgProbe() {
  const { organizationId, generation } = useOrganizationContext();
  return (
    <p data-testid="org-probe">
      {organizationId ?? "none"}|{generation}
    </p>
  );
}

function renderBridge(
  refetchOrganizations: () => Promise<Organization[] | null>,
  coordinator: TabSyncCoordinator,
  initialOrganizationId: string | null = "org-1",
) {
  return render(
    <OrganizationContextProvider initialOrganizationId={initialOrganizationId}>
      <TabSyncBridge refetchOrganizations={refetchOrganizations} coordinator={coordinator}>
        <p>Tenant-scoped content</p>
        <OrgProbe />
      </TabSyncBridge>
    </OrganizationContextProvider>,
  );
}

const probe = () => screen.getByTestId("org-probe").textContent;
const status = () => screen.getByTestId("tab-sync-status").textContent;

describe("TabSyncBridge (#274)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(ORG_KEY, "org-1");
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ token: "synthetic-token-do-not-use", user: { id: "u-synthetic" } }));
    TokenManager.reset();
  });

  it("positive: a tenant switch drops tenant data immediately, then restores the stored selection only after the server confirms it", async () => {
    const { coordinator, emit } = fakeCoordinator();
    const pending = deferred<Organization[] | null>();
    const refetch = jest.fn(() => pending.promise);
    renderBridge(refetch, coordinator);
    expect(probe()).toBe("org-1|0");

    window.localStorage.setItem(ORG_KEY, "org-2");
    emit("tenant_switched", "org-2");

    expect(probe()).toBe("none|1");
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(status()).toMatch(/organization changed in another tab/i);

    await act(async () => {
      pending.resolve([org("org-1"), org("org-2")]);
    });
    expect(probe()).toBe("org-2|2");
    expect(status()).toMatch(/access re-checked/i);
  });

  it("authorization: the message's tenantId is never trusted; selection comes from the fresh server list only", async () => {
    const { coordinator, emit } = fakeCoordinator();
    const refetch = jest.fn(async () => [org("org-1")]);
    renderBridge(refetch, coordinator);

    window.localStorage.setItem(ORG_KEY, "org-not-a-member");
    await act(async () => {
      emit("tenant_switched", "org-not-a-member");
    });

    expect(probe()).toBe("none|2");
    expect(status()).toMatch(/select an organization/i);
  });

  it("authorization: an organization the server reports as not selectable is not restored", async () => {
    const { coordinator, emit } = fakeCoordinator();
    renderBridge(async () => [org("org-1", "SUSPENDED")], coordinator);

    await act(async () => {
      emit("tenant_switched");
    });
    expect(probe()).toBe("none|2");
  });

  it("negative: a failed re-check fails closed with no organization selected", async () => {
    const { coordinator, emit } = fakeCoordinator();
    renderBridge(async () => null, coordinator);

    await act(async () => {
      emit("tenant_switched");
    });
    expect(probe()).toBe("none|1");
    expect(status()).toMatch(/could not re-check/i);
  });

  it("concurrency: a superseded revalidation result is discarded", async () => {
    const { coordinator, emit } = fakeCoordinator();
    const first = deferred<Organization[] | null>();
    const second = deferred<Organization[] | null>();
    const refetch = jest.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderBridge(refetch, coordinator);

    emit("tenant_switched");
    window.localStorage.setItem(ORG_KEY, "org-2");
    emit("tenant_switched");

    await act(async () => {
      second.resolve([org("org-2")]);
    });
    await act(async () => {
      first.resolve([org("org-1")]);
    });
    expect(probe()).toBe("org-2|3");
  });

  it.each([
    ["wallet_logout", /signed out in another tab/i],
    ["session_revoked", /session revoked in another tab/i],
  ] as const)("positive: %s locks the workspace, clears the session and removes tenant content", (type, title) => {
    const { coordinator, emit } = fakeCoordinator();
    const refetch = jest.fn(async () => [org("org-1")]);
    TokenManager.getInstance().setToken("synthetic-token-do-not-use", Date.now() + 60_000);
    renderBridge(refetch, coordinator);

    emit(type);

    const heading = screen.getByRole("heading", { name: title });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(heading).toHaveFocus();
    expect(screen.queryByText("Tenant-scoped content")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(TokenManager.getInstance().hasToken()).toBe(false);
    expect(refetch).not.toHaveBeenCalled();
    expect(status()).toMatch(title);
    expect(screen.getByRole("link", { name: /go to home page/i })).toHaveAttribute("href", "/");
  });

  it("authorization: nothing received after a lock unlocks the tab or refetches", async () => {
    const { coordinator, emit } = fakeCoordinator();
    const refetch = jest.fn(async () => [org("org-1")]);
    renderBridge(refetch, coordinator);

    emit("wallet_logout");
    await act(async () => {
      emit("tenant_switched");
      emit("recent_auth_expired");
    });

    expect(screen.getByRole("heading", { name: /signed out in another tab/i })).toBeInTheDocument();
    expect(screen.queryByText("Tenant-scoped content")).not.toBeInTheDocument();
    expect(refetch).not.toHaveBeenCalled();
  });

  it("concurrency: revocation outranks a later logout in the lock message", () => {
    const { coordinator, emit } = fakeCoordinator();
    renderBridge(async () => null, coordinator);
    emit("session_revoked");
    emit("wallet_logout");
    expect(screen.getByRole("heading", { name: /session revoked in another tab/i })).toBeInTheDocument();
  });

  it("concurrency: a logout arriving while a tenant re-check is in flight wins", async () => {
    const { coordinator, emit } = fakeCoordinator();
    const pending = deferred<Organization[] | null>();
    renderBridge(() => pending.promise, coordinator);

    emit("tenant_switched");
    emit("wallet_logout");
    await act(async () => {
      pending.resolve([org("org-1")]);
    });

    expect(screen.getByRole("heading", { name: /signed out in another tab/i })).toBeInTheDocument();
    expect(screen.queryByTestId("org-probe")).not.toBeInTheDocument();
  });

  it("positive: recent-auth expiry is announced and re-checks access without locking", async () => {
    const { coordinator, emit } = fakeCoordinator();
    renderBridge(async () => [org("org-1")], coordinator);
    await act(async () => {
      emit("recent_auth_expired");
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(probe()).toBe("org-1|2");
  });

  it("unsubscribes on unmount and ignores a revalidation that resolves afterwards", async () => {
    const { coordinator, emit, listenerCount } = fakeCoordinator();
    const pending = deferred<Organization[] | null>();
    const { unmount } = renderBridge(() => pending.promise, coordinator);
    expect(listenerCount()).toBe(1);

    emit("tenant_switched");
    unmount();
    expect(listenerCount()).toBe(0);
    await act(async () => {
      pending.resolve([org("org-1")]);
    });
  });

  it("regression: renders children unchanged when no coordinator is available", () => {
    renderBridge(async () => null, null as unknown as TabSyncCoordinator);
    expect(screen.getByText("Tenant-scoped content")).toBeInTheDocument();
  });
});
