/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import { OrganizationUsageDashboard } from "../organization-usage-dashboard";
import { apiClient } from "@/lib/api/client";
import { storeSession, clearStoredSession } from "@/lib/session";

jest.mock("@/lib/api/client", () => ({
  apiClient: jest.fn(),
  bearer: (token: string) => ({ Authorization: `Bearer ${token}` }),
  retryRead: (fn: (signal: AbortSignal) => Promise<unknown>, signal: AbortSignal) => fn(signal),
  retryMutation: (fn: (signal: AbortSignal) => Promise<unknown>, signal: AbortSignal) => fn(signal),
}));

const mockedApiClient = apiClient as jest.MockedFunction<typeof apiClient>;


const ORG = { id: "org-1", name: "Acme", slug: "acme", status: "ACTIVE" as const };

function setSession(role = "ADMIN") {
  storeSession({ token: "test-token", user: { id: "user-1", role } });
}

function usage(overrides: Partial<Parameters<typeof baseUsage>[0]> = {}) {
  return baseUsage(overrides);
}

function baseUsage(overrides: {
  generatedAt?: string;
  resources?: Array<{
    resource: "API_KEYS" | "WEBHOOKS" | "PROOFS" | "SYNCHRONIZATION";
    used: number;
    limit: number | null;
  }>;
} = {}) {
  const resources = overrides.resources ?? [
    { resource: "API_KEYS" as const, used: 2, limit: 10 },
    { resource: "WEBHOOKS" as const, used: 1, limit: 5 },
    { resource: "PROOFS" as const, used: 40, limit: 50 },
    { resource: "SYNCHRONIZATION" as const, used: 0, limit: null },
  ];
  return {
    organizationId: "org-1",
    generatedAt: overrides.generatedAt ?? new Date().toISOString(),
    resources: resources.map((r) => ({
      ...r,
      windowResetAt: "2099-01-01T00:00:00.000Z",
      windowType: "FIXED" as const,
      resourceHref: `/settings/${r.resource.toLowerCase()}`,
    })),
    rateLimit: {
      limitPerMinute: 60,
      remainingInWindow: 42,
      windowResetAt: "2099-01-01T00:00:05.000Z",
    },
  };
}

describe("OrganizationUsageDashboard", () => {
  beforeEach(() => {
    mockedApiClient.mockReset();
    setSession();
  });

  afterEach(() => {
    clearStoredSession();
  });

  it("requires authentication", () => {
    clearStoredSession();
    render(<OrganizationUsageDashboard />);
    expect(screen.getByText("Authentication Required")).toBeInTheDocument();
  });

  it("restricts access to admins", () => {
    setSession("WORKER");
    render(<OrganizationUsageDashboard />);
    expect(screen.getByText("Access Restricted")).toBeInTheDocument();
  });

  it("shows an explicit unavailable state on fetch failure, not zero usage", async () => {
    mockedApiClient
      .mockResolvedValueOnce([ORG]) // organizations
      .mockRejectedValueOnce(new Error("network error")); // usage

    render(<OrganizationUsageDashboard />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/unavailable/i);
    });
    expect(screen.queryByText("0 / ")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("renders a legitimate zero-usage resource distinctly from the unavailable state", async () => {
    mockedApiClient.mockResolvedValueOnce([ORG]).mockResolvedValueOnce(
      usage({
        resources: [{ resource: "WEBHOOKS", used: 0, limit: 10 }],
      })
    );

    render(<OrganizationUsageDashboard />);

    await waitFor(() => expect(screen.getByText("0 / 10")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the near-limit (warning) state at or above 80% usage, with text alongside color", async () => {
    mockedApiClient.mockResolvedValueOnce([ORG]).mockResolvedValueOnce(
      usage({ resources: [{ resource: "PROOFS", used: 90, limit: 100 }] })
    );

    render(<OrganizationUsageDashboard />);

    await waitFor(() => expect(screen.getByText("90 / 100")).toBeInTheDocument());
    expect(screen.getByText("Near limit")).toBeInTheDocument();
    const progressbar = screen.getByRole("progressbar");
    expect(progressbar).toHaveAttribute("aria-valuenow", "90");
  });

  it("shows the exceeded state when usage meets or passes the limit", async () => {
    mockedApiClient.mockResolvedValueOnce([ORG]).mockResolvedValueOnce(
      usage({ resources: [{ resource: "API_KEYS", used: 12, limit: 10 }] })
    );

    render(<OrganizationUsageDashboard />);

    await waitFor(() => expect(screen.getByText("12 / 10")).toBeInTheDocument());
    expect(screen.getByText("Limit exceeded")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("shows the unlimited state without a bounded progress bar", async () => {
    mockedApiClient.mockResolvedValueOnce([ORG]).mockResolvedValueOnce(
      usage({ resources: [{ resource: "SYNCHRONIZATION", used: 500, limit: null }] })
    );

    render(<OrganizationUsageDashboard />);

    await waitFor(() => expect(screen.getByText("500 used")).toBeInTheDocument());
    expect(screen.getByText("Unlimited")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("flags stale usage data and prompts a refresh", async () => {
    const staleGeneratedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    mockedApiClient
      .mockResolvedValueOnce([ORG])
      .mockResolvedValueOnce(usage({ generatedAt: staleGeneratedAt }));

    render(<OrganizationUsageDashboard />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/out of date/i);
    });
  });

  it("does not flag freshly loaded usage data as stale", async () => {
    mockedApiClient.mockResolvedValueOnce([ORG]).mockResolvedValueOnce(usage());

    render(<OrganizationUsageDashboard />);

    await waitFor(() => expect(screen.getByText("API Keys")).toBeInTheDocument());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders rate limit information separately from resource quota cards", async () => {
    mockedApiClient.mockResolvedValueOnce([ORG]).mockResolvedValueOnce(usage());

    render(<OrganizationUsageDashboard />);

    await waitFor(() => expect(screen.getByText("Request Rate Limit")).toBeInTheDocument());
    const rateLimitSection = screen.getByText("Request Rate Limit").closest("div")!;
    expect(within(rateLimitSection).getByText("42")).toBeInTheDocument();
    expect(within(rateLimitSection).getByText(/60 requests/)).toBeInTheDocument();
  });

  it("links each resource card to the resources contributing to its total", async () => {
    mockedApiClient.mockResolvedValueOnce([ORG]).mockResolvedValueOnce(usage());

    render(<OrganizationUsageDashboard />);

    await waitFor(() => expect(screen.getByText("API Keys")).toBeInTheDocument());
    const link = screen.getByRole("link", { name: /view api keys/i });
    expect(link).toHaveAttribute("href", "/settings/api_keys");
  });
});
