/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { BatchCredentialWorkspace } from "../batch-credential-workspace";
import { apiClient } from "@/lib/api/client";

jest.mock("@/lib/api/client", () => ({
  apiClient: jest.fn(),
}));

const mockedApiClient = apiClient as jest.MockedFunction<typeof apiClient>;

function jsonFile(name: string, body: unknown, size?: number): File {
  const text = JSON.stringify(body);
  const file = new File([text], name, { type: "application/json" });
  if (size !== undefined) {
    Object.defineProperty(file, "size", { value: size });
  }
  return file;
}

describe("BatchCredentialWorkspace", () => {
  beforeEach(() => {
    mockedApiClient.mockReset();
  });

  it("adds a manual entry and lists it as pending", async () => {
    render(<BatchCredentialWorkspace />);

    fireEvent.change(screen.getByLabelText(/paste credential JSON/i), {
      target: { value: JSON.stringify({ id: "cred-1" }) },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add entry/i }));

    expect(
      await screen.findByText(/Manual entry \(cred-1\)/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("rejects a manual entry with malformed JSON without blocking future entries", async () => {
    render(<BatchCredentialWorkspace />);

    fireEvent.change(screen.getByLabelText(/paste credential JSON/i), {
      target: { value: "not json" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add entry/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /valid credential JSON/i,
    );

    fireEvent.change(screen.getByLabelText(/paste credential JSON/i), {
      target: { value: JSON.stringify({ id: "cred-1" }) },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add entry/i }));

    expect(
      await screen.findByText(/Manual entry \(cred-1\)/i),
    ).toBeInTheDocument();
  });

  it("rejects a duplicate credential id", async () => {
    render(<BatchCredentialWorkspace />);

    fireEvent.change(screen.getByLabelText(/paste credential JSON/i), {
      target: { value: JSON.stringify({ id: "cred-1" }) },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add entry/i }));
    await screen.findByText(/Manual entry \(cred-1\)/i);

    fireEvent.change(screen.getByLabelText(/paste credential JSON/i), {
      target: { value: JSON.stringify({ id: "cred-1" }) },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add entry/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /already in the batch/i,
    );
  });

  it("accepts a mixed batch of files, keeping malformed items visible alongside valid ones", async () => {
    render(<BatchCredentialWorkspace />);

    const validFile = jsonFile("valid.json", { id: "cred-valid" });
    const malformedFile = jsonFile("bad.json", { notAnId: true });

    const input = screen.getByLabelText(
      /Upload credential JSON files/i,
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [validFile, malformedFile] } });

    expect(
      await screen.findByText(/valid.json \(cred-valid\)/i),
    ).toBeInTheDocument();
    expect(await screen.findByText("bad.json")).toBeInTheDocument();
    expect(screen.getByText(/must include a valid id/i)).toBeInTheDocument();
  });

  it("rejects an oversized file", async () => {
    render(<BatchCredentialWorkspace />);

    const oversized = jsonFile("huge.json", { id: "cred-huge" }, 40 * 1024);
    const input = screen.getByLabelText(
      /Upload credential JSON files/i,
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [oversized] } });

    expect(await screen.findByText("huge.json")).toBeInTheDocument();
    expect(
      screen.getByText(/exceeds the per-file size limit/i),
    ).toBeInTheDocument();
  });

  it("verifies pending items and shows their individual results", async () => {
    mockedApiClient.mockResolvedValue({ result: "VALID", status: "valid" });

    render(<BatchCredentialWorkspace />);

    fireEvent.change(screen.getByLabelText(/paste credential JSON/i), {
      target: { value: JSON.stringify({ id: "cred-1" }) },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add entry/i }));
    await screen.findByText(/Manual entry \(cred-1\)/i);

    fireEvent.click(screen.getByRole("button", { name: /Verify all/i }));

    await waitFor(() =>
      expect(screen.getByText("Verified")).toBeInTheDocument(),
    );
    expect(screen.getByText("VALID")).toBeInTheDocument();
  });

  it("marks an item as failed when verification throws, without affecting other items", async () => {
    mockedApiClient
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ result: "VALID", status: "valid" });

    render(<BatchCredentialWorkspace />);

    fireEvent.change(screen.getByLabelText(/paste credential JSON/i), {
      target: { value: JSON.stringify({ id: "cred-fail" }) },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add entry/i }));
    await screen.findByText(/Manual entry \(cred-fail\)/i);

    fireEvent.change(screen.getByLabelText(/paste credential JSON/i), {
      target: { value: JSON.stringify({ id: "cred-ok" }) },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add entry/i }));
    await screen.findByText(/Manual entry \(cred-ok\)/i);

    fireEvent.click(screen.getByRole("button", { name: /Verify all/i }));

    await waitFor(() => expect(screen.getByText("Failed")).toBeInTheDocument());
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  it("allows removing an item before verification", async () => {
    render(<BatchCredentialWorkspace />);

    fireEvent.change(screen.getByLabelText(/paste credential JSON/i), {
      target: { value: JSON.stringify({ id: "cred-1" }) },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add entry/i }));
    await screen.findByText(/Manual entry \(cred-1\)/i);

    fireEvent.click(
      screen.getByRole("button", { name: /Remove Manual entry \(cred-1\)/i }),
    );

    expect(
      screen.queryByText(/Manual entry \(cred-1\)/i),
    ).not.toBeInTheDocument();
  });

  it("clears the whole batch", async () => {
    render(<BatchCredentialWorkspace />);

    fireEvent.change(screen.getByLabelText(/paste credential JSON/i), {
      target: { value: JSON.stringify({ id: "cred-1" }) },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add entry/i }));
    await screen.findByText(/Manual entry \(cred-1\)/i);

    fireEvent.click(screen.getByRole("button", { name: /Clear batch/i }));

    expect(
      screen.queryByText(/Manual entry \(cred-1\)/i),
    ).not.toBeInTheDocument();
  });

  it("cancels an in-flight batch verification", async () => {
    let rejectLookup!: (reason: unknown) => void;
    mockedApiClient.mockReturnValue(
      new Promise((_, reject) => {
        rejectLookup = reject;
      }),
    );

    render(<BatchCredentialWorkspace />);

    fireEvent.change(screen.getByLabelText(/paste credential JSON/i), {
      target: { value: JSON.stringify({ id: "cred-1" }) },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add entry/i }));
    await screen.findByText(/Manual entry \(cred-1\)/i);

    fireEvent.click(screen.getByRole("button", { name: /Verify all/i }));
    await waitFor(() =>
      expect(screen.getAllByText("Verifying...").length).toBeGreaterThan(1),
    );

    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));

    const abortError = new DOMException("Aborted", "AbortError");
    rejectLookup(abortError);

    await waitFor(() =>
      expect(screen.getByText("Cancelled")).toBeInTheDocument(),
    );
  });

  it("retries only the failed items, leaving verified items untouched", async () => {
    mockedApiClient
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ result: "VALID", status: "valid" });

    render(<BatchCredentialWorkspace />);

    fireEvent.change(screen.getByLabelText(/paste credential JSON/i), {
      target: { value: JSON.stringify({ id: "cred-fail" }) },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add entry/i }));
    await screen.findByText(/Manual entry \(cred-fail\)/i);

    fireEvent.change(screen.getByLabelText(/paste credential JSON/i), {
      target: { value: JSON.stringify({ id: "cred-ok" }) },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add entry/i }));
    await screen.findByText(/Manual entry \(cred-ok\)/i);

    fireEvent.click(screen.getByRole("button", { name: /Verify all/i }));
    await waitFor(() => expect(screen.getByText("Failed")).toBeInTheDocument());
    expect(screen.getByText("Verified")).toBeInTheDocument();

    mockedApiClient.mockReset();
    mockedApiClient.mockResolvedValue({ result: "EXPIRED", status: "expired" });

    fireEvent.click(
      screen.getByRole("button", { name: /Retry failed \(1\)/i }),
    );

    await waitFor(() =>
      expect(screen.getByText("EXPIRED")).toBeInTheDocument(),
    );
    // The already-verified item's own result must not have been
    // re-verified or overwritten by the retry.
    expect(screen.getByText("VALID")).toBeInTheDocument();
    expect(mockedApiClient).toHaveBeenCalledTimes(1);
  });

  it("does not show the retry/export-failed controls when nothing has failed", async () => {
    mockedApiClient.mockResolvedValue({ result: "VALID", status: "valid" });

    render(<BatchCredentialWorkspace />);

    fireEvent.change(screen.getByLabelText(/paste credential JSON/i), {
      target: { value: JSON.stringify({ id: "cred-1" }) },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add entry/i }));
    await screen.findByText(/Manual entry \(cred-1\)/i);

    fireEvent.click(screen.getByRole("button", { name: /Verify all/i }));
    await waitFor(() =>
      expect(screen.getByText("Verified")).toBeInTheDocument(),
    );

    expect(
      screen.queryByRole("button", { name: /Retry failed/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Export failed/i }),
    ).not.toBeInTheDocument();
  });

  it("exports failed items as a downloadable JSON file without their raw credential content", async () => {
    mockedApiClient.mockRejectedValue(new Error("network error"));

    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => "blob:mock-url");
    URL.revokeObjectURL = jest.fn();

    let capturedBlob: Blob | null = null;
    (URL.createObjectURL as jest.Mock).mockImplementation((blob: Blob) => {
      capturedBlob = blob;
      return "blob:mock-url";
    });

    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    render(<BatchCredentialWorkspace />);

    fireEvent.change(screen.getByLabelText(/paste credential JSON/i), {
      target: { value: JSON.stringify({ id: "cred-fail" }) },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add entry/i }));
    await screen.findByText(/Manual entry \(cred-fail\)/i);

    fireEvent.click(screen.getByRole("button", { name: /Verify all/i }));
    await waitFor(() => expect(screen.getByText("Failed")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Export failed/i }));

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(capturedBlob).not.toBeNull();
    expect((capturedBlob as unknown as Blob).type).toBe("application/json");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    const text: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(capturedBlob as unknown as Blob);
    });
    const parsed = JSON.parse(text);
    expect(parsed.failedItems).toEqual([
      { credentialId: "cred-fail", label: "Manual entry (cred-fail)" },
    ]);

    clickSpy.mockRestore();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });
});
