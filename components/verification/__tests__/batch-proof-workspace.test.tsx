/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BatchProofWorkspace } from "../batch-proof-workspace";
import { apiClient } from "@/lib/api/client";
import { downloadTextFile } from "@/lib/credentials/export";

jest.mock("@/lib/api/client", () => ({
  apiClient: jest.fn(),
}));

jest.mock("@/lib/credentials/export", () => ({
  ...jest.requireActual("@/lib/credentials/export"),
  downloadTextFile: jest.fn(),
}));

const mockedApiClient = apiClient as jest.MockedFunction<typeof apiClient>;
const mockedDownloadTextFile = downloadTextFile as jest.MockedFunction<typeof downloadTextFile>;

describe("BatchProofWorkspace", () => {
  beforeEach(() => {
    mockedApiClient.mockReset();
    mockedDownloadTextFile.mockReset();
  });

  it("previews a mix of valid, invalid, and duplicate identifiers", () => {
    render(<BatchProofWorkspace />);

    fireEvent.change(screen.getByLabelText("Proof identifiers"), {
      target: { value: "proof-1\nbad id!\nproof-1\nproof-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Preview/i }));

    expect(screen.getByText("Invalid identifier")).toBeInTheDocument();
    expect(screen.getByText("Duplicate")).toBeInTheDocument();
    expect(screen.getAllByText("Pending")).toHaveLength(2);
  });

  it("shows an error when previewing with empty input", () => {
    render(<BatchProofWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: /Preview/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/at least one identifier/i);
  });

  it("verifies pending items and shows their individual results without affecting invalid/duplicate rows", async () => {
    mockedApiClient.mockResolvedValue({ result: "VALID", status: "valid" });

    render(<BatchProofWorkspace />);
    fireEvent.change(screen.getByLabelText("Proof identifiers"), {
      target: { value: "proof-1\nbad id!" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /Verify all/i }));

    await waitFor(() => expect(screen.getByText("Verified")).toBeInTheDocument());
    expect(screen.getByText("Invalid identifier")).toBeInTheDocument();
    expect(mockedApiClient).toHaveBeenCalledTimes(1);
  });

  it("marks a failed verification without affecting other items", async () => {
    mockedApiClient
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ result: "VALID", status: "valid" });

    render(<BatchProofWorkspace />);
    fireEvent.change(screen.getByLabelText("Proof identifiers"), {
      target: { value: "proof-fail\nproof-ok" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /Verify all/i }));

    await waitFor(() => expect(screen.getByText("Failed")).toBeInTheDocument());
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  it("caps the previewed batch at the max item limit", () => {
    render(<BatchProofWorkspace />);
    const lines = Array.from({ length: 60 }, (_, i) => `proof-${i}`).join("\n");

    fireEvent.change(screen.getByLabelText("Proof identifiers"), { target: { value: lines } });
    fireEvent.click(screen.getByRole("button", { name: /Preview/i }));

    expect(screen.getByText("Batch (50)")).toBeInTheDocument();
  });

  it("cancels an in-flight batch verification", async () => {
    let rejectLookup!: (reason: unknown) => void;
    mockedApiClient.mockReturnValue(
      new Promise((_, reject) => {
        rejectLookup = reject;
      }),
    );

    render(<BatchProofWorkspace />);
    fireEvent.change(screen.getByLabelText("Proof identifiers"), { target: { value: "proof-1" } });
    fireEvent.click(screen.getByRole("button", { name: /Preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /Verify all/i }));

    await waitFor(() => expect(screen.getAllByText("Verifying...").length).toBeGreaterThan(1));
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));

    rejectLookup(new DOMException("Aborted", "AbortError"));
    await waitFor(() => expect(screen.getByText("Cancelled")).toBeInTheDocument());
  });

  it("disables export until at least one item has been verified", () => {
    render(<BatchProofWorkspace />);
    fireEvent.change(screen.getByLabelText("Proof identifiers"), { target: { value: "proof-1" } });
    fireEvent.click(screen.getByRole("button", { name: /Preview/i }));

    expect(screen.getByRole("button", { name: /Export results/i })).toBeDisabled();
  });

  it("exports results after verification completes", async () => {
    mockedApiClient.mockResolvedValue({ result: "VALID", status: "valid" });

    render(<BatchProofWorkspace />);
    fireEvent.change(screen.getByLabelText("Proof identifiers"), { target: { value: "proof-1" } });
    fireEvent.click(screen.getByRole("button", { name: /Preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /Verify all/i }));

    await waitFor(() => expect(screen.getByText("Verified")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Export results/i }));

    expect(mockedDownloadTextFile).toHaveBeenCalledTimes(1);
    const plan = mockedDownloadTextFile.mock.calls[0][0];
    expect(JSON.parse(plan.body)).toEqual([{ proofId: "proof-1", result: "VALID", status: "valid" }]);
  });

  it("clears the whole batch", () => {
    render(<BatchProofWorkspace />);
    fireEvent.change(screen.getByLabelText("Proof identifiers"), { target: { value: "proof-1" } });
    fireEvent.click(screen.getByRole("button", { name: /Preview/i }));
    expect(screen.getByText("Batch (1)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Clear batch/i }));
    expect(screen.queryByText("Batch (1)")).not.toBeInTheDocument();
  });
});
