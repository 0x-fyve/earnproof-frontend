/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
import { PaymentOperationEvidenceViewer } from "../payment-operation-evidence-viewer";
import {
  getPaymentOperationEvidence,
  type PaymentOperationEvidence,
} from "@/lib/stellar/payment-evidence";

jest.mock("@/lib/stellar/payment-evidence", () => ({
  ...jest.requireActual("@/lib/stellar/payment-evidence"),
  getPaymentOperationEvidence: jest.fn(),
}));

jest.mock("@/config/app", () => ({
  appConfig: { stellarNetwork: "testnet", helpUrl: "https://example.com/help" },
}));

const mockGetEvidence = getPaymentOperationEvidence as jest.MockedFunction<
  typeof getPaymentOperationEvidence
>;

const VALID_MUXED_ADDRESS = "MADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOAAAAAAAAAAAFKY6G";
const VALID_TX_HASH = "a".repeat(64);

function baseEvidence(overrides: Partial<PaymentOperationEvidence> = {}): PaymentOperationEvidence {
  return {
    paymentId: "pay-1",
    network: "testnet",
    transactionHash: VALID_TX_HASH,
    operationIndex: 0,
    operationCount: 1,
    sourceAccount: {
      address: "GA7QYNF7SOWQ3GLR2BGMZEHXAVAVGVHWGD5CDGDRA7VYAGF5D5MFBXBW",
      type: "ed25519",
      underlyingAccount: null,
      muxedId: null,
    },
    destinationAccount: {
      address: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      type: "ed25519",
      underlyingAccount: null,
      muxedId: null,
    },
    assetCode: "XLM",
    assetIssuer: null,
    amount: "100.0000000",
    amountStatus: "success",
    ledgerSequence: 123456,
    ledgerClosedAt: "2026-01-01T00:00:00.000Z",
    hasMemo: false,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("PaymentOperationEvidenceViewer — loading and error states", () => {
  it("shows a loading state", () => {
    mockGetEvidence.mockReturnValue(new Promise(() => {}));
    render(<PaymentOperationEvidenceViewer token="t" paymentId="pay-1" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading payment evidence");
  });

  it("shows a not-found state for missing evidence", async () => {
    mockGetEvidence.mockRejectedValue(new Error("404 Not Found"));
    render(<PaymentOperationEvidenceViewer token="t" paymentId="pay-1" />);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("No evidence available"),
    );
  });

  it("shows a generic error state on unexpected failure", async () => {
    mockGetEvidence.mockRejectedValue(new Error("network down"));
    render(<PaymentOperationEvidenceViewer token="t" paymentId="pay-1" />);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Could not load payment evidence"),
    );
  });
});

describe("PaymentOperationEvidenceViewer — native and issued assets", () => {
  it("renders a native (XLM) asset without an asset code suffix on the amount", async () => {
    mockGetEvidence.mockResolvedValue(baseEvidence({ assetCode: "XLM", assetIssuer: null }));
    render(<PaymentOperationEvidenceViewer token="t" paymentId="pay-1" />);
    await waitFor(() => expect(screen.getByText("XLM")).toBeInTheDocument());
    expect(screen.getByText(/100\.0000000/)).toBeInTheDocument();
  });

  it("renders an issued asset with the (issued) label and asset code on the amount", async () => {
    mockGetEvidence.mockResolvedValue(
      baseEvidence({
        assetCode: "USDC",
        assetIssuer: "GISSUER00000000000000000000000000000000000000000000000",
        amount: "50.0000000",
      }),
    );
    render(<PaymentOperationEvidenceViewer token="t" paymentId="pay-1" />);
    await waitFor(() => expect(screen.getByText("USDC (issued)")).toBeInTheDocument());
    expect(screen.getByText(/50\.0000000 USDC/)).toBeInTheDocument();
  });
});

describe("PaymentOperationEvidenceViewer — multiple operations", () => {
  it("shows only the indexed operation and discloses the total operation count", async () => {
    mockGetEvidence.mockResolvedValue(baseEvidence({ operationIndex: 2, operationCount: 5 }));
    render(<PaymentOperationEvidenceViewer token="t" paymentId="pay-1" />);
    await waitFor(() =>
      expect(screen.getByText(/contains 5 operations/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/operation #2/)).toBeInTheDocument();
    expect(screen.getByText("2 of 5")).toBeInTheDocument();
  });

  it("does not show the multi-operation notice for a single-operation transaction", async () => {
    mockGetEvidence.mockResolvedValue(baseEvidence({ operationIndex: 0, operationCount: 1 }));
    render(<PaymentOperationEvidenceViewer token="t" paymentId="pay-1" />);
    await waitFor(() => expect(screen.getByText("0 of 1")).toBeInTheDocument());
    expect(screen.queryByText(/contains .* operations/)).not.toBeInTheDocument();
  });
});

describe("PaymentOperationEvidenceViewer — network mismatch", () => {
  it("flags evidence recorded on a different network than the app is configured for", async () => {
    mockGetEvidence.mockResolvedValue(baseEvidence({ network: "public" }));
    render(<PaymentOperationEvidenceViewer token="t" paymentId="pay-1" />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/recorded on/));
  });

  it("does not show a mismatch warning when networks match", async () => {
    mockGetEvidence.mockResolvedValue(baseEvidence({ network: "testnet" }));
    render(<PaymentOperationEvidenceViewer token="t" paymentId="pay-1" />);
    await waitFor(() => expect(screen.getByText("Network")).toBeInTheDocument());
    expect(screen.queryByText(/recorded on/)).not.toBeInTheDocument();
  });
});

describe("PaymentOperationEvidenceViewer — muxed accounts", () => {
  it("represents a muxed source account distinctly, decoding its underlying account and mux ID", async () => {
    mockGetEvidence.mockResolvedValue(
      baseEvidence({
        sourceAccount: {
          address: VALID_MUXED_ADDRESS,
          type: "muxed",
          underlyingAccount: null,
          muxedId: null,
        },
      }),
    );
    render(<PaymentOperationEvidenceViewer token="t" paymentId="pay-1" />);
    await waitFor(() => expect(screen.getByText("Muxed")).toBeInTheDocument());
    expect(screen.getByText(/mux ID 42/)).toBeInTheDocument();
  });

  it("flags an unparseable M-prefixed address rather than guessing its underlying account", async () => {
    mockGetEvidence.mockResolvedValue(
      baseEvidence({
        sourceAccount: {
          address: "M" + "A".repeat(68),
          type: "muxed",
          underlyingAccount: null,
          muxedId: null,
        },
      }),
    );
    render(<PaymentOperationEvidenceViewer token="t" paymentId="pay-1" />);
    await waitFor(() =>
      expect(screen.getByText(/could not be decoded as a valid muxed account/)).toBeInTheDocument(),
    );
  });

  it("does not show the muxed badge for a plain ed25519 account", async () => {
    mockGetEvidence.mockResolvedValue(baseEvidence());
    render(<PaymentOperationEvidenceViewer token="t" paymentId="pay-1" />);
    await waitFor(() => expect(screen.getByText("Source account")).toBeInTheDocument());
    expect(screen.queryByText("Muxed")).not.toBeInTheDocument();
  });
});

describe("PaymentOperationEvidenceViewer — memo privacy", () => {
  it("discloses only that a memo was present, never its content", async () => {
    mockGetEvidence.mockResolvedValue(baseEvidence({ hasMemo: true }));
    render(<PaymentOperationEvidenceViewer token="t" paymentId="pay-1" />);
    await waitFor(() =>
      expect(screen.getByText(/included a memo/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Memo content is not shown here/)).toBeInTheDocument();
  });

  it("shows nothing memo-related when there was no memo", async () => {
    mockGetEvidence.mockResolvedValue(baseEvidence({ hasMemo: false }));
    render(<PaymentOperationEvidenceViewer token="t" paymentId="pay-1" />);
    await waitFor(() => expect(screen.getByText("Source account")).toBeInTheDocument());
    expect(screen.queryByText(/memo/i)).not.toBeInTheDocument();
  });
});

describe("PaymentOperationEvidenceViewer — explorer link", () => {
  it("builds a valid explorer link for a well-formed testnet transaction hash", async () => {
    mockGetEvidence.mockResolvedValue(baseEvidence({ network: "testnet" }));
    render(<PaymentOperationEvidenceViewer token="t" paymentId="pay-1" />);
    await waitFor(() => expect(screen.getByText("View on explorer")).toBeInTheDocument());
    expect(screen.getByText("View on explorer").closest("a")).toHaveAttribute(
      "href",
      expect.stringContaining(VALID_TX_HASH),
    );
  });

  it("shows a reason instead of a link when the identifier is malformed", async () => {
    mockGetEvidence.mockResolvedValue(baseEvidence({ transactionHash: "not-a-valid-hash" }));
    render(<PaymentOperationEvidenceViewer token="t" paymentId="pay-1" />);
    await waitFor(() =>
      expect(screen.getByText(/malformed identifier/)).toBeInTheDocument(),
    );
    expect(screen.queryByText("View on explorer")).not.toBeInTheDocument();
  });
});
