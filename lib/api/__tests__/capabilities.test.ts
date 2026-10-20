/**
 * @jest-environment jsdom
 */

import {
  CAPABILITY_DOCUMENT_SHAPE_VERSION,
  currentDeploymentIdentity,
  deploymentIdentityChanged,
  fetchMockCapabilityDocument,
  isApiVersionCompatible,
  isCapabilityEnabled,
  type CapabilityDocument,
} from "../capabilities";
import { API_SPEC_VERSION } from "../generated/v1";

function baseDocument(overrides: Partial<CapabilityDocument> = {}): CapabilityDocument {
  return {
    documentVersion: CAPABILITY_DOCUMENT_SHAPE_VERSION,
    apiVersion: API_SPEC_VERSION,
    network: "testnet",
    generatedAt: new Date().toISOString(),
    capabilities: {
      "activity-log": { enabled: true },
      "embeddable-verification-widget": { enabled: true },
    },
    ...overrides,
  };
}

describe("isCapabilityEnabled — fail closed", () => {
  it("returns false when the document is null/undefined", () => {
    expect(isCapabilityEnabled(null, "activity-log")).toBe(false);
    expect(isCapabilityEnabled(undefined, "activity-log")).toBe(false);
  });

  it("returns false for a capability key absent from the document (partial rollout)", () => {
    const document = baseDocument({
      capabilities: {
        "activity-log": { enabled: true },
        // "embeddable-verification-widget" intentionally absent — this
        // organization hasn't been rolled into that capability yet.
      },
    });

    expect(isCapabilityEnabled(document, "activity-log")).toBe(true);
    expect(isCapabilityEnabled(document, "embeddable-verification-widget")).toBe(false);
  });

  it("returns false for a capability explicitly present but disabled", () => {
    const document = baseDocument({
      capabilities: {
        "activity-log": { enabled: false, note: "Disabled for this org" },
      },
    });

    expect(isCapabilityEnabled(document, "activity-log")).toBe(false);
  });

  it("returns false for a capability that disappears from a refetched document (downgrade)", () => {
    const before = baseDocument({
      capabilities: {
        "recurring-income-proofs": { enabled: true },
      },
    });
    const after = baseDocument({
      capabilities: {},
    });

    expect(isCapabilityEnabled(before, "recurring-income-proofs")).toBe(true);
    expect(isCapabilityEnabled(after, "recurring-income-proofs")).toBe(false);
  });

  it("returns false when the document shape version is unrecognized", () => {
    const document = baseDocument({ documentVersion: 999 });
    expect(isCapabilityEnabled(document, "activity-log")).toBe(false);
  });

  it("returns false when the document's API version is incompatible", () => {
    const document = baseDocument({ apiVersion: "2.0.0" });
    expect(isCapabilityEnabled(document, "activity-log")).toBe(false);
  });

  it("does not throw for an unknown/garbage capability key at the type boundary", () => {
    const document = baseDocument();
    // Cast to simulate a document containing keys this frontend build
    // doesn't know about (e.g. served by a newer backend).
    expect(
      isCapabilityEnabled(document, "some-future-capability" as never),
    ).toBe(false);
  });
});

describe("isApiVersionCompatible", () => {
  it("accepts matching major versions", () => {
    expect(isApiVersionCompatible("1.0.0", "1.0.0")).toBe(true);
    expect(isApiVersionCompatible("1.4.2", "1.0.0")).toBe(true);
  });

  it("rejects differing major versions (incompatible API version)", () => {
    expect(isApiVersionCompatible("2.0.0", "1.0.0")).toBe(false);
    expect(isApiVersionCompatible("0.9.0", "1.0.0")).toBe(false);
  });

  it("rejects malformed version strings", () => {
    expect(isApiVersionCompatible("", "1.0.0")).toBe(false);
    expect(isApiVersionCompatible("1.0.0", "")).toBe(false);
  });
});

describe("deploymentIdentityChanged", () => {
  it("is false when apiUrl, network, and apiSpecVersion are unchanged", () => {
    const identity = currentDeploymentIdentity();
    expect(deploymentIdentityChanged(identity, { ...identity })).toBe(false);
  });

  it("is true when the API URL changes", () => {
    const identity = currentDeploymentIdentity();
    expect(
      deploymentIdentityChanged(identity, {
        ...identity,
        apiUrl: "https://different-api.example.com",
      }),
    ).toBe(true);
  });

  it("is true when the Stellar network changes", () => {
    const identity = currentDeploymentIdentity();
    expect(
      deploymentIdentityChanged(identity, { ...identity, stellarNetwork: "public" }),
    ).toBe(true);
  });

  it("is true when the API spec version changes", () => {
    const identity = currentDeploymentIdentity();
    expect(
      deploymentIdentityChanged(identity, { ...identity, apiSpecVersion: "2.0.0" }),
    ).toBe(true);
  });
});

describe("fetchMockCapabilityDocument", () => {
  it("is explicitly a local stub, not a real network call", async () => {
    // No fetch mock is installed in this test — if this function reached
    // out over the network it would throw. It resolving successfully
    // demonstrates it's a pure in-memory fixture.
    const document = await fetchMockCapabilityDocument();
    expect(document.documentVersion).toBe(CAPABILITY_DOCUMENT_SHAPE_VERSION);
    expect(document.apiVersion).toBe(API_SPEC_VERSION);
  });

  it("supports overrides for simulating partial rollout in callers/tests", async () => {
    const document = await fetchMockCapabilityDocument({
      capabilities: { "activity-log": { enabled: true } },
    });
    expect(isCapabilityEnabled(document, "activity-log")).toBe(true);
    expect(isCapabilityEnabled(document, "embeddable-verification-widget")).toBe(false);
  });
});
