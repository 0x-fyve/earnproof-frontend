/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
import { ActivityLogGate } from "@/components/activity/activity-log-gate";
import { fetchActivityEvents } from "@/lib/api/activity";
import { fetchMockCapabilityDocument, CAPABILITY_DOCUMENT_SHAPE_VERSION } from "@/lib/api/capabilities";
import { API_SPEC_VERSION } from "@/lib/api/generated/v1";
import { storeSession } from "@/lib/session";
import { FIXTURE_USER, SYNTHETIC_TOKEN, fetchedPage } from "@/tests/fixtures/activity-fixtures";

jest.mock("@/lib/api/capabilities", () => ({
  ...jest.requireActual("@/lib/api/capabilities"),
  fetchMockCapabilityDocument: jest.fn(),
}));

jest.mock("@/lib/api/activity", () => ({
  ...jest.requireActual("@/lib/api/activity"),
  fetchActivityEvents: jest.fn(),
}));

const mockedFetchCapabilities = fetchMockCapabilityDocument as jest.MockedFunction<
  typeof fetchMockCapabilityDocument
>;
const mockedFetchActivityEvents = fetchActivityEvents as jest.MockedFunction<
  typeof fetchActivityEvents
>;

beforeEach(() => {
  window.localStorage.clear();
  mockedFetchCapabilities.mockReset();
  mockedFetchActivityEvents.mockReset();
  mockedFetchActivityEvents.mockResolvedValue(fetchedPage({ events: [] }));
  storeSession({ token: SYNTHETIC_TOKEN, user: FIXTURE_USER });
});

describe("ActivityLogGate", () => {
  it("renders the activity log once the activity-log capability is enabled", async () => {
    mockedFetchCapabilities.mockResolvedValue({
      documentVersion: CAPABILITY_DOCUMENT_SHAPE_VERSION,
      apiVersion: API_SPEC_VERSION,
      network: "testnet",
      generatedAt: new Date().toISOString(),
      capabilities: { "activity-log": { enabled: true } },
    });

    render(<ActivityLogGate />);

    await waitFor(() =>
      expect(screen.getByText("No recent account activity to show.")).toBeInTheDocument(),
    );
  });

  it("renders an explicit unavailable state (not a blank/hidden section) when the capability is disabled", async () => {
    mockedFetchCapabilities.mockResolvedValue({
      documentVersion: CAPABILITY_DOCUMENT_SHAPE_VERSION,
      apiVersion: API_SPEC_VERSION,
      network: "testnet",
      generatedAt: new Date().toISOString(),
      capabilities: {},
    });

    render(<ActivityLogGate />);

    await waitFor(() =>
      expect(screen.getByText("Activity log unavailable")).toBeInTheDocument(),
    );
    expect(mockedFetchActivityEvents).not.toHaveBeenCalled();
  });

  it("fails closed (renders unavailable, not the activity log) when the capability document fails to load", async () => {
    mockedFetchCapabilities.mockRejectedValue(new Error("network error"));

    render(<ActivityLogGate />);

    await waitFor(() =>
      expect(screen.getByText("Activity log unavailable")).toBeInTheDocument(),
    );
    expect(mockedFetchActivityEvents).not.toHaveBeenCalled();
  });

  it("shows a loading state before the capability check resolves", () => {
    mockedFetchCapabilities.mockReturnValue(new Promise(() => {})); // never resolves

    render(<ActivityLogGate />);

    expect(screen.getByText("Checking availability...")).toBeInTheDocument();
  });
});
