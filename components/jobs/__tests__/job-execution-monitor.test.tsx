/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobExecutionMonitor } from "../job-execution-monitor";

const mockReplace = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/settings/jobs",
  useSearchParams: () => mockSearchParams,
}));

beforeEach(() => {
  mockReplace.mockClear();
  mockSearchParams = new URLSearchParams();
});

describe("JobExecutionMonitor: ordering and rendering", () => {
  it("renders the job executions list", async () => {
    render(<JobExecutionMonitor />);
    await waitFor(() => expect(screen.getByTestId("job-execution-list")).toBeInTheDocument());
  });
});

describe("JobExecutionMonitor: filters update the URL", () => {
  it("writes the selected category into the URL via router.replace", async () => {
    const user = userEvent.setup();
    render(<JobExecutionMonitor />);
    await waitFor(() => expect(screen.getByTestId("job-execution-list")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByLabelText("Category")).not.toBeDisabled(),
    );

    await user.selectOptions(screen.getByLabelText("Category"), "anchoring");

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining("category=anchoring"));
    });
  });

  it("restores filters from the URL on mount", async () => {
    mockSearchParams = new URLSearchParams("category=anchoring&status=failed");
    render(<JobExecutionMonitor />);

    await waitFor(() => {
      expect(screen.getByLabelText("Category")).toHaveValue("anchoring");
      expect(screen.getByLabelText("Status")).toHaveValue("failed");
    });
  });
});

describe("JobExecutionMonitor: forbidden state", () => {
  it("shows an access-restricted message instead of partial job data", async () => {
    mockSearchParams = new URLSearchParams("category=forbidden");
    render(<JobExecutionMonitor />);
    await waitFor(() => expect(screen.getByTestId("job-monitor-forbidden")).toBeInTheDocument());
    expect(screen.queryByTestId("job-execution-list")).not.toBeInTheDocument();
  });
});

describe("JobExecutionMonitor: retries", () => {
  it("shows a retry link for an execution that retried an earlier one", async () => {
    mockSearchParams = new URLSearchParams("category=anchoring");
    render(<JobExecutionMonitor />);
    await waitFor(() => {
      expect(screen.getByTestId("job-execution-list")).toBeInTheDocument();
      expect(screen.queryAllByTestId(/^job-execution-job-/).length).toBeGreaterThan(0);
    });

    const retryLinks = screen.queryAllByTestId(/^job-retry-link-/);
    expect(retryLinks.length).toBeGreaterThan(0);
  });
});
