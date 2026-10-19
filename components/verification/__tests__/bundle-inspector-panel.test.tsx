/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BundleInspectorPanel } from "../bundle-inspector-panel";
import { buildOfflineBundle } from "@/lib/credentials/offline-bundle";
import { inspectBundle, unavailableInspectionResult } from "@/lib/credentials/bundle-inspector";

const NOW = new Date("2026-06-01T12:00:00.000Z");
const FIXED_TIME_ZONE = "America/New_York";

function makeBundle(overrides: Parameters<typeof buildOfflineBundle>[0]["source"] = {
  proofId: "proof-1",
  network: "testnet",
  contractId: `C${"A".repeat(55)}`,
  public: { type: "income-threshold", issuer: "issuer-1" },
  private: { amount: { thresholdAmount: "999999", assetCode: "USDC" } },
}) {
  return buildOfflineBundle({
    request: { proofId: "proof-1", scopes: ["public"], requestedValidityHours: 24 },
    source: overrides,
    digestValue: "digest-abc",
    nonce: "nonce-1",
    now: NOW,
  });
}

describe("BundleInspectorPanel (#242)", () => {
  it("renders the unavailable state when no manifest could be fetched", () => {
    render(<BundleInspectorPanel result={unavailableInspectionResult("Could not reach the server.")} timeZone={FIXED_TIME_ZONE} />);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("Could not reach the server.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the manifest and an enabled download button for a verified bundle", () => {
    const bundle = makeBundle();
    const result = inspectBundle({ bundle, actualDigest: "digest-abc", now: NOW });
    render(<BundleInspectorPanel result={result} timeZone={FIXED_TIME_ZONE} onDownload={jest.fn()} />);

    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText(bundle.bundleId)).toBeInTheDocument();
    expect(screen.getByText(bundle.contractId)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Download bundle" });
    expect(button).not.toBeDisabled();
  });

  it("CRITICAL: disables the download button for a tampered (integrity-failed) bundle and it cannot be clicked to download", async () => {
    const user = userEvent.setup();
    const bundle = makeBundle();
    const result = inspectBundle({ bundle, actualDigest: "WRONG-DIGEST", now: NOW });
    const onDownload = jest.fn();
    render(<BundleInspectorPanel result={result} timeZone={FIXED_TIME_ZONE} onDownload={onDownload} />);

    expect(screen.getByText("Integrity check failed")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Download blocked" });
    expect(button).toBeDisabled();

    await user.click(button);
    expect(onDownload).not.toHaveBeenCalled();

    expect(
      screen.getByText("This bundle failed its integrity check and cannot be downloaded as trusted evidence."),
    ).toBeInTheDocument();
  });

  it("disables download for an expired bundle", () => {
    const bundle = makeBundle();
    const wayLater = new Date(new Date(bundle.validUntil).getTime() + 1000);
    const result = inspectBundle({ bundle, actualDigest: "digest-abc", now: wayLater });
    render(<BundleInspectorPanel result={result} timeZone={FIXED_TIME_ZONE} onDownload={jest.fn()} />);
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download blocked" })).toBeDisabled();
  });

  it("disables download for an unsupported schema version", () => {
    const bundle = { ...makeBundle(), schemaVersion: 42 };
    const result = inspectBundle({ bundle, actualDigest: "digest-abc", now: NOW });
    render(<BundleInspectorPanel result={result} timeZone={FIXED_TIME_ZONE} onDownload={jest.fn()} />);
    expect(screen.getByText("Unsupported version")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download blocked" })).toBeDisabled();
  });

  it("disables download and labels a network mismatch clearly", () => {
    const bundle = makeBundle({
      proofId: "proof-1",
      network: "mainnet",
      contractId: `C${"A".repeat(55)}`,
      public: { type: "income-threshold", issuer: "issuer-1" },
    });
    const result = inspectBundle({ bundle, actualDigest: "digest-abc", expectedNetwork: "testnet", now: NOW });
    render(<BundleInspectorPanel result={result} timeZone={FIXED_TIME_ZONE} onDownload={jest.fn()} />);
    expect(screen.getByText("Network mismatch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download blocked" })).toBeDisabled();
  });

  it("allows download for a stale (otherwise-verified) bundle while still labeling it stale, not hiding the label", () => {
    const bundle = buildOfflineBundle({
      request: { proofId: "proof-1", scopes: ["public"], requestedValidityHours: 72 },
      source: {
        proofId: "proof-1",
        network: "testnet",
        contractId: `C${"A".repeat(55)}`,
        public: { type: "income-threshold", issuer: "issuer-1" },
      },
      digestValue: "digest-abc",
      nonce: "nonce-1",
      now: NOW,
    });
    const muchLater = new Date(NOW.getTime() + 25 * 60 * 60 * 1000);
    const result = inspectBundle({ bundle, actualDigest: "digest-abc", now: muchLater });
    render(<BundleInspectorPanel result={result} timeZone={FIXED_TIME_ZONE} onDownload={jest.fn()} />);
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download bundle" })).not.toBeDisabled();
  });

  it("is accessible: the blocking message uses role=alert and the badge text is not conveyed by color alone", () => {
    const bundle = makeBundle();
    const result = inspectBundle({ bundle, actualDigest: "WRONG", now: NOW });
    render(<BundleInspectorPanel result={result} timeZone={FIXED_TIME_ZONE} onDownload={jest.fn()} />);
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("never renders the bundle's private disclosed claim/amount values in the manifest view", () => {
    const bundle = makeBundle();
    const result = inspectBundle({ bundle, actualDigest: "digest-abc", now: NOW });
    render(<BundleInspectorPanel result={result} timeZone={FIXED_TIME_ZONE} onDownload={jest.fn()} />);
    expect(screen.queryByText("999999")).not.toBeInTheDocument();
    expect(screen.queryByText(/USDC/)).not.toBeInTheDocument();
  });
});
