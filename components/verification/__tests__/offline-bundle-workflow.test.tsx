import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { computeSha256Digest } from "@/lib/credentials/verify-digest";
import {
  buildOfflineBundle,
  bundleDigestInput,
  type OfflineBundleSource,
  type OfflineVerificationBundle,
} from "@/lib/credentials/offline-bundle";
import { OfflineBundleWorkflow } from "../offline-bundle-workflow";

const NOW = new Date("2026-06-01T00:00:00.000Z");

function source(overrides: Partial<OfflineBundleSource> = {}): OfflineBundleSource {
  return {
    proofId: "proof-1",
    network: "testnet",
    contractId: `C${"A".repeat(55)}`,
    public: { type: "income-threshold", issuer: "issuer-1" },
    private: {
      subject: { walletHash: "hash_1" },
      amount: { thresholdAmount: "100", assetCode: "USDC" },
      sender: { sourceAddress: "GAAA" },
    },
    ...overrides,
  };
}

function toArrayBuffer(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function makeBundle(args: {
  validityHours?: number;
  digestValue?: string;
  nonce?: string;
} = {}): Promise<OfflineVerificationBundle> {
  const src = source();
  const prepared = buildOfflineBundle({
    request: { proofId: src.proofId, scopes: ["public"], requestedValidityHours: args.validityHours ?? 24 },
    source: src,
    digestValue: "",
    nonce: args.nonce ?? "nonce-fixed",
    now: NOW,
  });
  const digest =
    args.digestValue ??
    (await computeSha256Digest(toArrayBuffer(bundleDigestInput(prepared))));
  return { ...prepared, digest: { algorithm: "SHA-256", value: digest } };
}

beforeEach(() => {
  // jsdom does not implement the object-URL API used by the download flow.
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: jest.fn(() => "blob:offline-bundle"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: jest.fn(),
  });
});

describe("OfflineBundleWorkflow", () => {
  it("always includes the public scope and reflects connectivity", () => {
    render(<OfflineBundleWorkflow isOnline={false} now={NOW} source={source()} />);
    expect(screen.getByLabelText("public")).toBeChecked();
    expect(screen.getByLabelText("public")).toBeDisabled();
    expect(screen.getByTestId("connectivity")).toHaveTextContent("Offline");
  });

  it("blocks an out-of-bounds validity window", () => {
    render(<OfflineBundleWorkflow isOnline now={NOW} source={source()} />);
    fireEvent.change(screen.getByLabelText(/valid for/i), { target: { value: "100" } });
    expect(screen.getByText(/at most 72 hours/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /prepare bundle/i })).toBeDisabled();
  });

  it("scopes the included fields to the requested disclosures", async () => {
    render(<OfflineBundleWorkflow isOnline now={NOW} source={source()} />);
    fireEvent.click(screen.getByLabelText("amount"));
    fireEvent.click(screen.getByRole("button", { name: /prepare bundle/i }));

    await screen.findByText("Prepared bundle");
    const included = screen.getByTestId("included-fields");
    expect(included).toHaveTextContent("public.type");
    expect(included).toHaveTextContent("amount.thresholdAmount");
    expect(included).not.toHaveTextContent("subject.walletHash");
  });

  it("verifies a fresh bundle offline and never claims revocation state", async () => {
    render(<OfflineBundleWorkflow isOnline={false} now={NOW} source={source()} />);
    fireEvent.click(screen.getByRole("button", { name: /prepare bundle/i }));
    await screen.findByText("Prepared bundle");

    fireEvent.click(screen.getByRole("button", { name: /verify offline/i }));
    await waitFor(() =>
      expect(screen.getByTestId("offline-result-status")).toHaveTextContent("verified-offline"),
    );
    expect(screen.getByTestId("offline-result")).toHaveTextContent(/not checked offline/i);
  });

  it("detects a replay of the same bundle within a session", async () => {
    render(<OfflineBundleWorkflow isOnline={false} now={NOW} source={source()} />);
    fireEvent.click(screen.getByRole("button", { name: /prepare bundle/i }));
    await screen.findByText("Prepared bundle");

    fireEvent.click(screen.getByRole("button", { name: /verify offline/i }));
    await waitFor(() =>
      expect(screen.getByTestId("offline-result-status")).toHaveTextContent("verified-offline"),
    );

    fireEvent.click(screen.getByRole("button", { name: /verify offline/i }));
    await waitFor(() =>
      expect(screen.getByTestId("offline-result-status")).toHaveTextContent("replayed"),
    );
  });

  it("reports an expired bundle as expired", async () => {
    const expired = await makeBundle({ validityHours: 1 });
    render(
      <OfflineBundleWorkflow
        initialBundle={expired}
        isOnline={false}
        now={new Date("2026-06-05T00:00:00.000Z")}
        source={source()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /verify offline/i }));
    await waitFor(() =>
      expect(screen.getByTestId("offline-result-status")).toHaveTextContent("expired"),
    );
  });

  it("fails the local integrity check when the digest does not match", async () => {
    const tampered = await makeBundle({ digestValue: "deadbeef" });
    render(
      <OfflineBundleWorkflow
        initialBundle={tampered}
        isOnline={false}
        now={NOW}
        source={source()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /check integrity/i }));
    await waitFor(() =>
      expect(screen.getByTestId("integrity-status")).toHaveTextContent(/integrity check failed/i),
    );
  });

  it("offers freshness refresh only when online", async () => {
    render(<OfflineBundleWorkflow isOnline={false} now={NOW} source={source()} />);
    fireEvent.click(screen.getByRole("button", { name: /prepare bundle/i }));
    await screen.findByText("Prepared bundle");
    expect(screen.getByRole("button", { name: /refresh freshness/i })).toBeDisabled();
  });

  it("refreshes to a current revocation state when online", async () => {
    render(<OfflineBundleWorkflow isOnline now={NOW} source={source()} />);
    fireEvent.click(screen.getByRole("button", { name: /prepare bundle/i }));
    await screen.findByText("Prepared bundle");

    fireEvent.click(screen.getByRole("button", { name: /refresh freshness/i }));
    expect(screen.getByTestId("refresh-result")).toHaveTextContent("refreshed");
    expect(screen.getByTestId("refresh-result")).toHaveTextContent(/revocation state: current/i);
  });

  it("downloads the bundle as safe JSON", async () => {
    render(<OfflineBundleWorkflow isOnline now={NOW} source={source()} />);
    fireEvent.click(screen.getByRole("button", { name: /prepare bundle/i }));
    await screen.findByText("Prepared bundle");

    fireEvent.click(screen.getByRole("button", { name: /download bundle/i }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
});
