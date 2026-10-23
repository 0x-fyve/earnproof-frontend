/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrganizationUsageDashboard } from "../organization-usage-dashboard";
import { apiClient } from "@/lib/api/client";
import {
  organizationCapacityTrends,
  organizationCapacityForecasts,
  staleTrendData,
  quickExhaustionForecast,
} from "@/lib/api/__tests__/organization-usage.fixtures";
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

describe("OrganizationUsageDashboard - Trends and Forecasts", () => {
  beforeEach(() => {
    mockedApiClient.mockReset();
    setSession();
  });

  afterEach(() => {
    clearStoredSession();
  });

  it("renders tabs for Current Usage, Trends, and Forecasts", async () => {
    mockedApiClient
      .mockResolvedValueOnce([ORG]) // organizations
      .mockResolvedValueOnce({ organizationId: "org-1", generatedAt: new Date().toISOString(), resources: [], rateLimit: { limitPerMinute: 60, remainingInWindow: 42, windowResetAt: "2099-01-01T00:00:05.000Z" } }) // usage
      .mockResolvedValueOnce(organizationCapacityTrends()) // trends
      .mockResolvedValueOnce(organizationCapacityForecasts()); // forecasts

    render(<OrganizationUsageDashboard />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Current Usage/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Trends/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Forecasts/ })).toBeInTheDocument();
    });
  });

  it("displays Current Usage tab content by default", async () => {
    mockedApiClient
      .mockResolvedValueOnce([ORG])
      .mockResolvedValueOnce({
        organizationId: "org-1",
        generatedAt: new Date().toISOString(),
        resources: [{ resource: "PROOFS" as const, used: 50, limit: 100, windowResetAt: "2099-01-01T00:00:00.000Z", windowType: "FIXED" as const, resourceHref: "/settings/proofs" }],
        rateLimit: { limitPerMinute: 60, remainingInWindow: 42, windowResetAt: "2099-01-01T00:00:05.000Z" },
      })
      .mockResolvedValueOnce(organizationCapacityTrends())
      .mockResolvedValueOnce(organizationCapacityForecasts());

    render(<OrganizationUsageDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Proofs")).toBeInTheDocument();
      expect(screen.getByText("Request Rate Limit")).toBeInTheDocument();
    });
  });

  it("switches to Trends tab and displays trend charts", async () => {
    const trends = organizationCapacityTrends();
    mockedApiClient
      .mockResolvedValueOnce([ORG])
      .mockResolvedValueOnce({
        organizationId: "org-1",
        generatedAt: new Date().toISOString(),
        resources: [],
        rateLimit: { limitPerMinute: 60, remainingInWindow: 42, windowResetAt: "2099-01-01T00:00:05.000Z" },
      })
      .mockResolvedValueOnce(trends)
      .mockResolvedValueOnce(organizationCapacityForecasts());

    render(<OrganizationUsageDashboard />);

    const trendsButton = await screen.findByRole("button", { name: /Trends/ });
    await userEvent.click(trendsButton);

    await waitFor(() => {
      // Check for trend data presence
      const trend = Object.values(trends.trends)[0];
      expect(screen.getByText(new RegExp(trend.displayName))).toBeInTheDocument();
    });
  });

  it("switches to Forecasts tab and displays forecast charts", async () => {
    const forecasts = organizationCapacityForecasts();
    mockedApiClient
      .mockResolvedValueOnce([ORG])
      .mockResolvedValueOnce({
        organizationId: "org-1",
        generatedAt: new Date().toISOString(),
        resources: [],
        rateLimit: { limitPerMinute: 60, remainingInWindow: 42, windowResetAt: "2099-01-01T00:00:05.000Z" },
      })
      .mockResolvedValueOnce(organizationCapacityTrends())
      .mockResolvedValueOnce(forecasts);

    render(<OrganizationUsageDashboard />);

    const forecastsButton = await screen.findByRole("button", { name: /Forecasts/ });
    await userEvent.click(forecastsButton);

    await waitFor(() => {
      const forecast = Object.values(forecasts.forecasts)[0];
      expect(screen.getByText(new RegExp(forecast.displayName))).toBeInTheDocument();
      expect(screen.getByText(/Forecast/)).toBeInTheDocument();
    });
  });

  it("shows stale indicator for old trend data", async () => {
    const trends = organizationCapacityTrends({
      trends: {
        proofs: staleTrendData(),
      },
    });

    mockedApiClient
      .mockResolvedValueOnce([ORG])
      .mockResolvedValueOnce({
        organizationId: "org-1",
        generatedAt: new Date().toISOString(),
        resources: [],
        rateLimit: { limitPerMinute: 60, remainingInWindow: 42, windowResetAt: "2099-01-01T00:00:05.000Z" },
      })
      .mockResolvedValueOnce(trends)
      .mockResolvedValueOnce(organizationCapacityForecasts());

    render(<OrganizationUsageDashboard />);

    const trendsButton = await screen.findByRole("button", { name: /Trends/ });
    await userEvent.click(trendsButton);

    await waitFor(() => {
      expect(screen.getByText("Stale")).toBeInTheDocument();
    });
  });

  it("shows exhaustion projection in forecasts", async () => {
    const forecasts = organizationCapacityForecasts({
      forecasts: {
        proofs: quickExhaustionForecast(),
      },
    });

    mockedApiClient
      .mockResolvedValueOnce([ORG])
      .mockResolvedValueOnce({
        organizationId: "org-1",
        generatedAt: new Date().toISOString(),
        resources: [],
        rateLimit: { limitPerMinute: 60, remainingInWindow: 42, windowResetAt: "2099-01-01T00:00:05.000Z" },
      })
      .mockResolvedValueOnce(organizationCapacityTrends())
      .mockResolvedValueOnce(forecasts);

    render(<OrganizationUsageDashboard />);

    const forecastsButton = await screen.findByRole("button", { name: /Forecasts/ });
    await userEvent.click(forecastsButton);

    await waitFor(() => {
      expect(screen.getByText("Exhaustion Projected")).toBeInTheDocument();
    });
  });

  it("handles trend data fetch errors", async () => {
    mockedApiClient
      .mockResolvedValueOnce([ORG])
      .mockResolvedValueOnce({
        organizationId: "org-1",
        generatedAt: new Date().toISOString(),
        resources: [],
        rateLimit: { limitPerMinute: 60, remainingInWindow: 42, windowResetAt: "2099-01-01T00:00:05.000Z" },
      })
      .mockRejectedValueOnce(new Error("network error")) // trends error
      .mockResolvedValueOnce(organizationCapacityForecasts());

    render(<OrganizationUsageDashboard />);

    const trendsButton = await screen.findByRole("button", { name: /Trends/ });
    await userEvent.click(trendsButton);

    await waitFor(() => {
      expect(screen.getByText(/Capacity trend data could not be loaded/)).toBeInTheDocument();
    });
  });

  it("handles forecast data fetch errors", async () => {
    mockedApiClient
      .mockResolvedValueOnce([ORG])
      .mockResolvedValueOnce({
        organizationId: "org-1",
        generatedAt: new Date().toISOString(),
        resources: [],
        rateLimit: { limitPerMinute: 60, remainingInWindow: 42, windowResetAt: "2099-01-01T00:00:05.000Z" },
      })
      .mockResolvedValueOnce(organizationCapacityTrends())
      .mockRejectedValueOnce(new Error("network error")); // forecasts error

    render(<OrganizationUsageDashboard />);

    const forecastsButton = await screen.findByRole("button", { name: /Forecasts/ });
    await userEvent.click(forecastsButton);

    await waitFor(() => {
      expect(screen.getByText(/Capacity forecast data could not be loaded/)).toBeInTheDocument();
    });
  });

  it("shows empty state for trends when no data available", async () => {
    mockedApiClient
      .mockResolvedValueOnce([ORG])
      .mockResolvedValueOnce({
        organizationId: "org-1",
        generatedAt: new Date().toISOString(),
        resources: [],
        rateLimit: { limitPerMinute: 60, remainingInWindow: 42, windowResetAt: "2099-01-01T00:00:05.000Z" },
      })
      .mockResolvedValueOnce({ organizationId: "org-1", generatedAt: new Date().toISOString(), trends: {} })
      .mockResolvedValueOnce(organizationCapacityForecasts());

    render(<OrganizationUsageDashboard />);

    const trendsButton = await screen.findByRole("button", { name: /Trends/ });
    await userEvent.click(trendsButton);

    await waitFor(() => {
      expect(screen.getByText(/No trend data available/)).toBeInTheDocument();
    });
  });

  it("shows empty state for forecasts when no data available", async () => {
    mockedApiClient
      .mockResolvedValueOnce([ORG])
      .mockResolvedValueOnce({
        organizationId: "org-1",
        generatedAt: new Date().toISOString(),
        resources: [],
        rateLimit: { limitPerMinute: 60, remainingInWindow: 42, windowResetAt: "2099-01-01T00:00:05.000Z" },
      })
      .mockResolvedValueOnce(organizationCapacityTrends())
      .mockResolvedValueOnce({ organizationId: "org-1", generatedAt: new Date().toISOString(), forecasts: {} });

    render(<OrganizationUsageDashboard />);

    const forecastsButton = await screen.findByRole("button", { name: /Forecasts/ });
    await userEvent.click(forecastsButton);

    await waitFor(() => {
      expect(screen.getByText(/No forecast data available/)).toBeInTheDocument();
    });
  });

  it("refreshes all data when Refresh All button is clicked", async () => {
    mockedApiClient
      .mockResolvedValueOnce([ORG])
      .mockResolvedValueOnce({
        organizationId: "org-1",
        generatedAt: new Date().toISOString(),
        resources: [],
        rateLimit: { limitPerMinute: 60, remainingInWindow: 42, windowResetAt: "2099-01-01T00:00:05.000Z" },
      })
      .mockResolvedValueOnce(organizationCapacityTrends())
      .mockResolvedValueOnce(organizationCapacityForecasts())
      // Second call after refresh
      .mockResolvedValueOnce({
        organizationId: "org-1",
        generatedAt: new Date().toISOString(),
        resources: [],
        rateLimit: { limitPerMinute: 60, remainingInWindow: 42, windowResetAt: "2099-01-01T00:00:05.000Z" },
      })
      .mockResolvedValueOnce(organizationCapacityTrends())
      .mockResolvedValueOnce(organizationCapacityForecasts());

    render(<OrganizationUsageDashboard />);

    const refreshButton = await screen.findByRole("button", { name: /Refresh All/ });
    await userEvent.click(refreshButton);

    // Verify apiClient was called multiple times (initial + refresh)
    await waitFor(() => {
      expect(mockedApiClient).toHaveBeenCalledTimes(6);
    });
  });

  it("resets view to current usage when switching organization", async () => {
    const org2 = { id: "org-2", name: "Beta", slug: "beta", status: "ACTIVE" as const };

    mockedApiClient
      .mockResolvedValueOnce([ORG, org2])
      .mockResolvedValueOnce({
        organizationId: "org-1",
        generatedAt: new Date().toISOString(),
        resources: [],
        rateLimit: { limitPerMinute: 60, remainingInWindow: 42, windowResetAt: "2099-01-01T00:00:05.000Z" },
      })
      .mockResolvedValueOnce(organizationCapacityTrends())
      .mockResolvedValueOnce(organizationCapacityForecasts());

    const { rerender } = render(<OrganizationUsageDashboard />);

    const orgSelect = await screen.findByRole("combobox");
    await userEvent.selectOptions(orgSelect, "org-2");

    // When organization changes, view should reset to current usage
    const currentUsageButton = await screen.findByRole("button", { name: /Current Usage/ });
    const isCurrentActive = currentUsageButton.className.includes("border-cyan-300");
    expect(isCurrentActive).toBe(true);
  });

  it("requires authentication", () => {
    clearStoredSession();
    render(<OrganizationUsageDashboard />);
    expect(screen.getByText("Authentication Required")).toBeInTheDocument();
  });

  it("restricts access to admins and issuers", () => {
    setSession("WORKER");
    render(<OrganizationUsageDashboard />);
    expect(screen.getByText("Access Restricted")).toBeInTheDocument();
  });

  it("allows ISSUER role access", async () => {
    setSession("ISSUER");
    mockedApiClient
      .mockResolvedValueOnce([ORG])
      .mockResolvedValueOnce({
        organizationId: "org-1",
        generatedAt: new Date().toISOString(),
        resources: [],
        rateLimit: { limitPerMinute: 60, remainingInWindow: 42, windowResetAt: "2099-01-01T00:00:05.000Z" },
      })
      .mockResolvedValueOnce(organizationCapacityTrends())
      .mockResolvedValueOnce(organizationCapacityForecasts());

    render(<OrganizationUsageDashboard />);

    await waitFor(() => {
      expect(screen.queryByText("Access Restricted")).not.toBeInTheDocument();
    });
  });
});
