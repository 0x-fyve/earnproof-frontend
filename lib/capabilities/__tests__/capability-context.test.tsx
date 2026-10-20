/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  CapabilityProvider,
  useCapabilities,
  useCapability,
} from "../capability-context";
import {
  CAPABILITY_DOCUMENT_SHAPE_VERSION,
  type CapabilityDocument,
} from "@/lib/api/capabilities";
import { readCapabilityCache, writeCapabilityCache } from "@/lib/api/capability-cache";
import { API_SPEC_VERSION } from "@/lib/api/generated/v1";

function document(overrides: Partial<CapabilityDocument> = {}): CapabilityDocument {
  return {
    documentVersion: CAPABILITY_DOCUMENT_SHAPE_VERSION,
    apiVersion: API_SPEC_VERSION,
    network: "testnet",
    generatedAt: new Date().toISOString(),
    capabilities: {},
    ...overrides,
  };
}

function Probe({ capabilityKey }: { capabilityKey: Parameters<typeof useCapability>[0] }) {
  const { enabled, status } = useCapability(capabilityKey);
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="enabled">{String(enabled)}</span>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("useCapabilities outside a provider", () => {
  it("throws rather than silently fail-opening", () => {
    // Swallow the expected React error boundary console noise for this
    // one assertion.
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    function Bare() {
      useCapabilities();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(
      "useCapabilities must be used within a CapabilityProvider",
    );
    spy.mockRestore();
  });
});

describe("partial rollout", () => {
  it("enables only the capabilities explicitly present in the document", async () => {
    const fetcher = jest.fn().mockResolvedValue(
      document({ capabilities: { "activity-log": { enabled: true } } }),
    );

    render(
      <CapabilityProvider fetcher={fetcher}>
        <Probe capabilityKey="activity-log" />
      </CapabilityProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(screen.getByTestId("enabled")).toHaveTextContent("true");
  });

  it("fails closed for a capability withheld from this rollout", async () => {
    const fetcher = jest.fn().mockResolvedValue(
      document({ capabilities: { "activity-log": { enabled: true } } }),
    );

    render(
      <CapabilityProvider fetcher={fetcher}>
        <Probe capabilityKey="embeddable-verification-widget" />
      </CapabilityProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(screen.getByTestId("enabled")).toHaveTextContent("false");
  });
});

describe("downgrade", () => {
  it("a capability available before refresh is disabled after a refetch removes it", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(
        document({ capabilities: { "recurring-income-proofs": { enabled: true } } }),
      )
      .mockResolvedValueOnce(document({ capabilities: {} }));

    function Harness() {
      const { has, refresh, status } = useCapabilities();
      return (
        <div>
          <span data-testid="status">{status}</span>
          <span data-testid="enabled">{String(has("recurring-income-proofs"))}</span>
          <button onClick={() => refresh()} type="button">
            Refresh
          </button>
        </div>
      );
    }

    const user = userEvent.setup();

    render(
      <CapabilityProvider fetcher={fetcher}>
        <Harness />
      </CapabilityProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(screen.getByTestId("enabled")).toHaveTextContent("true");

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("enabled")).toHaveTextContent("false");
  });
});

describe("stale cache", () => {
  it("ignores a cache entry from a different deployment identity and refetches", async () => {
    writeCapabilityCache({
      document: document({ capabilities: { "activity-log": { enabled: true } } }),
      identity: {
        apiUrl: "https://stale-api.example.com",
        stellarNetwork: "public",
        apiSpecVersion: "0.1.0",
      },
      cachedAt: Date.now(),
    });

    const fetcher = jest.fn().mockResolvedValue(
      document({ capabilities: { "activity-log": { enabled: false } } }),
    );

    render(
      <CapabilityProvider fetcher={fetcher}>
        <Probe capabilityKey="activity-log" />
      </CapabilityProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    // The fresh fetch (capability disabled) won, not the stale cached
    // document (capability enabled) for a different deployment identity.
    expect(screen.getByTestId("enabled")).toHaveTextContent("false");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("uses a cached document instead of refetching when it is still fresh for this identity", async () => {
    const identity = {
      apiUrl: "http://localhost:4000/api/v1",
      stellarNetwork: "testnet",
      apiSpecVersion: API_SPEC_VERSION,
    };
    writeCapabilityCache({
      document: document({ capabilities: { "activity-log": { enabled: true } } }),
      identity,
      cachedAt: Date.now(),
    });

    const fetcher = jest.fn().mockResolvedValue(document({ capabilities: {} }));

    render(
      <CapabilityProvider fetcher={fetcher}>
        <Probe capabilityKey="activity-log" />
      </CapabilityProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(screen.getByTestId("enabled")).toHaveTextContent("true");
    expect(fetcher).not.toHaveBeenCalled();
    // Cache should still hold the entry we seeded (untouched).
    expect(readCapabilityCache()?.document.capabilities["activity-log"]?.enabled).toBe(true);
  });
});

describe("incompatible API versions", () => {
  it("fails closed when the fetched document's API version is incompatible", async () => {
    const fetcher = jest.fn().mockResolvedValue(
      document({
        apiVersion: "2.0.0",
        capabilities: { "activity-log": { enabled: true } },
      }),
    );

    render(
      <CapabilityProvider fetcher={fetcher}>
        <Probe capabilityKey="activity-log" />
      </CapabilityProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(screen.getByTestId("enabled")).toHaveTextContent("false");
  });

  it("fails closed (status: error) when the fetch itself rejects", async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error("network down"));

    render(
      <CapabilityProvider fetcher={fetcher}>
        <Probe capabilityKey="activity-log" />
      </CapabilityProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("error"));
    expect(screen.getByTestId("enabled")).toHaveTextContent("false");
  });
});
