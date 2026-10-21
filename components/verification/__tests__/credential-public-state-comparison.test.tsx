/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { CredentialPublicStateComparison } from "../credential-public-state-comparison";
import type { ImportedCredentialSummary } from "@/lib/credentials/public-state-comparison";
import type { VerifyProofResponse } from "@/components/verification/verification-panel";

function imported(overrides: Partial<ImportedCredentialSummary> = {}): ImportedCredentialSummary {
  return {
    id: "proof-1",
    issuer: "issuer-1",
    schemaVersion: "1.0",
    proofType: "minimum_income",
    expiresAt: "2026-12-31T00:00:00.000Z",
    issuedAt: "2026-01-01T00:00:00.000Z",
    claim: {
      operator: "gte",
      thresholdAmount: "1000",
      assetCode: "USDC",
      assetIssuer: null,
      periodStart: "2026-01-01T00:00:00.000Z",
      periodEnd: "2026-01-31T00:00:00.000Z",
      qualifyingPaymentCount: 3,
    },
    ...overrides,
  };
}

function response(overrides: Partial<VerifyProofResponse> = {}): VerifyProofResponse {
  return {
    result: "VALID",
    status: "valid",
    proof: {
      id: "proof-1",
      type: "minimum_income",
      schemaVersion: "1.0",
      network: "testnet",
      issuedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-12-31T00:00:00.000Z",
      revokedAt: null,
    },
    credential: {
      id: "proof-1",
      schemaVersion: "1.0",
      subject: { walletHash: "wh-1" },
      claim: {
        operator: "gte",
        thresholdAmount: "1000",
        assetCode: "USDC",
        assetIssuer: null,
        periodStart: "2026-01-01T00:00:00.000Z",
        periodEnd: "2026-01-31T00:00:00.000Z",
        qualifyingPaymentCount: 3,
      },
      privacy: { exactIncomeHidden: false, sourceTransactionsHidden: false },
      issuedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-12-31T00:00:00.000Z",
      proof: { type: "minimum_income", credentialHash: "hash", signature: "sig" },
    },
    ...overrides,
  };
}

describe("CredentialPublicStateComparison", () => {
  it("shows the unavailable message when the credential could not be parsed", () => {
    render(
      <CredentialPublicStateComparison imported={null} response={response()} signatureResult="VALID" />,
    );
    expect(screen.getByText("Public state comparison unavailable")).toBeInTheDocument();
  });

  it("shows an exact-match outcome with both signature result and comparison outcome displayed independently", () => {
    render(
      <CredentialPublicStateComparison imported={imported()} response={response()} signatureResult="VALID" />,
    );
    expect(screen.getByText("Matches public record")).toBeInTheDocument();
    expect(screen.getByText("VALID")).toBeInTheDocument();
  });

  it("shows field mismatches in a table with imported vs. current values", () => {
    render(
      <CredentialPublicStateComparison
        imported={imported({ schemaVersion: "1.1" })}
        response={response()}
        signatureResult="VALID"
      />,
    );
    expect(screen.getByText("Mismatch found")).toBeInTheDocument();
    expect(screen.getByText("Schema version")).toBeInTheDocument();
    expect(screen.getByText("1.1")).toBeInTheDocument();
  });

  it("renders a mismatch outcome even when the signature result is itself VALID (mismatches cannot be presented as successful verification)", () => {
    render(
      <CredentialPublicStateComparison
        imported={imported({ proofType: "recurring_income" })}
        response={response()}
        signatureResult="VALID"
      />,
    );
    // The signature badge says VALID, but the comparison outcome is
    // rendered as its own, separately-styled "Mismatch found" badge —
    // never merged into or hidden by the signature result.
    expect(screen.getByText("VALID")).toBeInTheDocument();
    expect(screen.getByText("Mismatch found")).toBeInTheDocument();
  });

  it("shows a revoked outcome distinctly from stale", () => {
    render(
      <CredentialPublicStateComparison
        imported={imported()}
        response={response({
          proof: {
            id: "proof-1",
            type: "minimum_income",
            schemaVersion: "1.0",
            network: "testnet",
            issuedAt: "2026-01-01T00:00:00.000Z",
            expiresAt: "2026-12-31T00:00:00.000Z",
            revokedAt: "2026-02-01T00:00:00.000Z",
          },
        })}
        signatureResult="VALID"
      />,
    );
    expect(screen.getByText("Revoked")).toBeInTheDocument();
    expect(screen.queryByText("Stale")).not.toBeInTheDocument();
  });

  it("shows a stale outcome when the public record has expired", () => {
    render(
      <CredentialPublicStateComparison
        imported={imported()}
        response={response({
          proof: {
            id: "proof-1",
            type: "minimum_income",
            schemaVersion: "1.0",
            network: "testnet",
            issuedAt: "2026-01-01T00:00:00.000Z",
            expiresAt: "2020-01-01T00:00:00.000Z",
            revokedAt: null,
          },
        })}
        signatureResult="VALID"
      />,
    );
    expect(screen.getByText("Stale")).toBeInTheDocument();
  });

  it("shows an unknown-proof outcome when there is no server proof record", () => {
    render(
      <CredentialPublicStateComparison
        imported={imported()}
        response={{ result: "UNKNOWN_PROOF", status: "unknown" }}
        signatureResult="UNKNOWN_PROOF"
      />,
    );
    expect(screen.getByText("Unknown proof")).toBeInTheDocument();
  });
});
