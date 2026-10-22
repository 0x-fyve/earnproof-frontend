import { render, screen, fireEvent } from "@testing-library/react";
import { TransactionConfirmationTracker } from "../transaction-confirmation-tracker";
import type { TrackedOperationRecord } from "@/lib/stellar/transaction-tracker";

const HASH_1 =
  "1111111111111111111111111111111111111111111111111111111111111111";
const HASH_2 =
  "2222222222222222222222222222222222222222222222222222222222222222";
const HASH_REPLACED =
  "3333333333333333333333333333333333333333333333333333333333333333";

describe("TransactionConfirmationTracker Component (#253)", () => {
  const sampleOperations: TrackedOperationRecord[] = [
    {
      operationId: "op-finalized-testnet",
      transactionHash: HASH_1,
      network: "testnet",
      status: "finalized",
      resourceType: "proof-anchor",
      resourceId: "EP-8A42-91DC",
      resourceHref: "/proofs/anchoring",
      ledger: 489210,
      confirmations: 3,
      requiredConfirmations: 3,
      replacedByHash: null,
      diagnosticMessage: "Finalized on Stellar testnet.",
      reorgCount: 1,
      submittedAt: "2026-10-19T10:00:00.000Z",
      updatedAt: "2026-10-19T10:02:00.000Z",
      timeoutAt: "2026-10-19T10:05:00.000Z",
      expiresAt: "2026-10-20T10:00:00.000Z",
    },
    {
      operationId: "op-replaced-testnet",
      transactionHash: HASH_2,
      network: "testnet",
      status: "replaced",
      resourceType: "proof-anchor",
      resourceId: "EP-9999-0000",
      resourceHref: "/proofs/anchoring",
      ledger: null,
      confirmations: 0,
      requiredConfirmations: 3,
      replacedByHash: HASH_REPLACED,
      diagnosticMessage: "Superseded by replacement transaction.",
      reorgCount: 0,
      submittedAt: "2026-10-19T10:10:00.000Z",
      updatedAt: "2026-10-19T10:11:00.000Z",
      timeoutAt: "2026-10-19T10:15:00.000Z",
      expiresAt: "2026-10-20T10:10:00.000Z",
    },
    {
      operationId: "op-timedout-testnet",
      transactionHash: HASH_1,
      network: "testnet",
      status: "timed-out",
      resourceType: "contract-mutation",
      resourceId: "policy-99",
      resourceHref: null,
      ledger: null,
      confirmations: 0,
      requiredConfirmations: 3,
      replacedByHash: null,
      diagnosticMessage: "Confirmation timed out before inclusion.",
      reorgCount: 0,
      submittedAt: "2026-10-19T09:00:00.000Z",
      updatedAt: "2026-10-19T09:03:00.000Z",
      timeoutAt: "2026-10-19T09:02:00.000Z",
      expiresAt: "2026-10-20T09:00:00.000Z",
    },
  ];

  it("renders lifecycle progress and explorer links for finalized operations on matching network", () => {
    render(
      <TransactionConfirmationTracker
        activeNetwork="testnet"
        operations={sampleOperations}
      />,
    );

    expect(
      screen.getByText("Finalized on network"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View on Stellar Explorer" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open related resource" }),
    ).toHaveAttribute("href", "/proofs/anchoring");
    expect(screen.getByText("Reorg recovered (1)")).toBeInTheDocument();
  });

  it("warns when the active network differs from an operation's network and blocks explorer links", () => {
    render(
      <TransactionConfirmationTracker
        activeNetwork="public" // viewer is on public, but operations are on testnet
        operations={sampleOperations}
      />,
    );

    expect(
      screen.getByTestId("network-mismatch-op-finalized-testnet"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "View on Stellar Explorer" }),
    ).not.toBeInTheDocument();
  });

  it("replaced transactions never appear finalized and display replacement transaction hash notice", () => {
    render(
      <TransactionConfirmationTracker
        activeNetwork="testnet"
        operations={sampleOperations}
      />,
    );

    expect(
      screen.getByText("Replaced by fee-bump / new transaction"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Original transaction was superseded and is/i),
    ).toBeInTheDocument();
  });

  it("triggers retry callback when retry button is clicked on timed-out operations", () => {
    const onRetry = jest.fn();

    render(
      <TransactionConfirmationTracker
        activeNetwork="testnet"
        operations={sampleOperations}
        onRetryOperation={onRetry}
      />,
    );

    const retryBtn = screen.getByRole("button", { name: "Retry submission" });
    fireEvent.click(retryBtn);

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0].operationId).toBe("op-timedout-testnet");
  });
});
