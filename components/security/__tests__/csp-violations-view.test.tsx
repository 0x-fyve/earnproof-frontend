/**
 * @jest-environment jsdom
 */

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CspViolationsView } from "../csp-violations-view";
import {
  CspRequestError,
  fetchCspViolations,
  type FetchedCspViolationReport,
} from "@/lib/api/csp-violations";
import { clearStoredSession, readStoredSession, storeSession } from "@/lib/session";
import { CSP_ADMIN, CSP_TOKEN, CSP_WORKER, fetchedReport, wireGroup } from "@/tests/fixtures/csp-fixtures";

jest.mock("@/lib/api/csp-violations", () => ({
  ...jest.requireActual("@/lib/api/csp-violations"),
  fetchCspViolations: jest.fn(),
}));

const mockFetch = fetchCspViolations as jest.MockedFunction<typeof fetchCspViolations>;

type Deferred = {
  promise: Promise<FetchedCspViolationReport>;
  resolve: (report: FetchedCspViolationReport) => void;
  reject: (error: unknown) => void;
};
function deferred(): Deferred {
  let resolve!: Deferred["resolve"];
  let reject!: Deferred["reject"];
  const promise = new Promise<FetchedCspViolationReport>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const group = (overrides: Record<string, unknown> = {}) => wireGroup(overrides) as never;

beforeEach(() => {
  mockFetch.mockReset();
  storeSession({ token: CSP_TOKEN, user: CSP_ADMIN });
});

describe("CspViolationsView: authorization", () => {
  it("shows a sign-in state and fetches nothing without a session", () => {
    clearStoredSession();
    render(<CspViolationsView />);

    expect(screen.getByRole("status")).toHaveTextContent("Sign in to view CSP diagnostics");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each(["WORKER", "DEVELOPER"] as const)("denies a %s without calling the API", (role) => {
    storeSession({ token: CSP_TOKEN, user: { ...CSP_WORKER, role } });
    render(<CspViolationsView />);

    expect(screen.getByText("Access Denied")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("allows an issuer administrator", async () => {
    storeSession({ token: CSP_TOKEN, user: { ...CSP_ADMIN, role: "ISSUER" } });
    mockFetch.mockResolvedValue(fetchedReport());
    render(<CspViolationsView />);

    expect(await screen.findByTestId("csp-violation-table")).toBeInTheDocument();
  });

  it("sends the token, window, an empty filter and an abort signal", async () => {
    mockFetch.mockResolvedValue(fetchedReport());
    render(<CspViolationsView />);

    await screen.findByTestId("csp-violation-table");
    const options = mockFetch.mock.calls[0]![0];
    expect(options.token).toBe(CSP_TOKEN);
    expect(options.window).toBe("24h");
    expect(options.filter).toEqual({});
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("on 401 clears the session everywhere and shows the sign-in state", async () => {
    mockFetch.mockRejectedValue(new CspRequestError("unauthorized", "req-401", "Your session has ended."));
    render(<CspViolationsView />);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Sign in to view CSP diagnostics"));
    expect(readStoredSession()).toBeNull();
  });

  it("on 403 shows a terminal denied state with the reference and no retry", async () => {
    mockFetch.mockRejectedValue(new CspRequestError("forbidden", "req-403", "You do not have access to CSP diagnostics."));
    render(<CspViolationsView />);

    expect(await screen.findByText("CSP diagnostics access denied")).toBeInTheDocument();
    expect(screen.getByText("Reference: req-403")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("on 404 or 501 shows an unavailable state", async () => {
    mockFetch.mockRejectedValue(new CspRequestError("unavailable", "req-404", "CSP diagnostics are not available."));
    render(<CspViolationsView />);

    expect(await screen.findByText("CSP diagnostics unavailable")).toBeInTheDocument();
  });

  it("clears the data and aborts when the session is revoked in another tab", async () => {
    mockFetch.mockResolvedValue(fetchedReport({ nextCursor: "c1" }));
    render(<CspViolationsView />);
    await screen.findByTestId("csp-violation-table");
    const signal = mockFetch.mock.calls[0]![0].signal;

    act(() => clearStoredSession("synced_from_other_tab"));

    await waitFor(() => expect(screen.getByText("Sign in to view CSP diagnostics")).toBeInTheDocument());
    expect(signal.aborted).toBe(true);
    expect(screen.queryByTestId("csp-violation-table")).not.toBeInTheDocument();
  });
});

describe("CspViolationsView: content", () => {
  it("shows loading, then aggregated rows and a summary", async () => {
    mockFetch.mockResolvedValue(
      fetchedReport({ groups: [group({ count: 1200 }), group({ id: "g2", directive: "img-src", routeCategory: "proofs", count: 3, firstSeenRelease: "2026.02.4" })] }),
    );
    render(<CspViolationsView />);

    expect(screen.getByText("Loading CSP diagnostics...")).toBeInTheDocument();
    const rows = await screen.findAllByTestId("csp-violation-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("script-src-elem")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Embedded verification")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Third party")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("1,200")).toBeInTheDocument();
    expect(screen.getByTestId("csp-summary")).toHaveTextContent("1,203 blocked loads in 2 groups");
    expect(screen.getByTestId("csp-summary")).toHaveTextContent("1 new in the current release");
  });

  it("flags only groups first seen in the current release", async () => {
    mockFetch.mockResolvedValue(fetchedReport({ groups: [group(), group({ id: "g2", firstSeenRelease: "2026.02.4" })] }));
    render(<CspViolationsView />);

    await screen.findAllByTestId("csp-violation-row");
    expect(screen.getAllByTestId("csp-regression-badge")).toHaveLength(1);
  });

  it("renders no URL, sample or token text from a rejected group", async () => {
    // The API layer withholds such a group; the view only shows the count.
    mockFetch.mockResolvedValue(fetchedReport({ groups: [], withheldCount: 2 }));
    const { container } = render(<CspViolationsView />);

    expect(await screen.findByTestId("csp-withheld-note")).toHaveTextContent("2 groups were withheld");
    expect(container.textContent).not.toMatch(/https?:\/\//);
    expect(screen.getByText("No CSP violations were reported in this window.")).toBeInTheDocument();
  });

  it("explains recovery steps and offers remediation links for each row", async () => {
    mockFetch.mockResolvedValue(fetchedReport());
    const user = userEvent.setup();
    render(<CspViolationsView />);

    const row = await screen.findByTestId("csp-violation-row");
    await user.click(within(row).getByText("Steps"));

    expect(within(row).getByText("Fix script-src-elem blocks on embed routes")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Security overview" })).toHaveAttribute("href", "/security");
    expect(within(row).getByRole("link", { name: "System status" })).toHaveAttribute("href", "/status");
    const help = within(row).getByRole("link", { name: "Help: script-src-elem" });
    expect(help).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("shows the stale banner for a report older than 15 minutes, not for a fresh one", async () => {
    const old = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    mockFetch.mockResolvedValueOnce(fetchedReport({ generatedAt: old }));
    const { unmount } = render(<CspViolationsView />);
    expect(await screen.findByTestId("csp-stale-banner")).toBeInTheDocument();
    unmount();

    mockFetch.mockResolvedValueOnce(fetchedReport());
    render(<CspViolationsView />);
    await screen.findByTestId("csp-violation-table");
    expect(screen.queryByTestId("csp-stale-banner")).not.toBeInTheDocument();
  });

  it("shows the empty state and the filtered empty state", async () => {
    mockFetch.mockResolvedValueOnce(fetchedReport({ groups: [] })).mockResolvedValueOnce(fetchedReport({ groups: [] }));
    const user = userEvent.setup();
    render(<CspViolationsView />);

    expect(await screen.findByText("No CSP violations were reported in this window.")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Directive"), "img-src");
    expect(await screen.findByText("No CSP violations match the selected filters.")).toBeInTheDocument();
  });

  it("notes groups that could not be displayed", async () => {
    mockFetch.mockResolvedValue(fetchedReport({ invalidCount: 3 }));
    render(<CspViolationsView />);

    expect(await screen.findByTestId("csp-invalid-note")).toHaveTextContent("3 groups could not be displayed.");
  });
});

describe("CspViolationsView: errors", () => {
  it("shows an alert with the request reference and retries", async () => {
    mockFetch
      .mockRejectedValueOnce(new CspRequestError("failed", "req-500", "Unable to load CSP diagnostics."))
      .mockResolvedValueOnce(fetchedReport());
    const user = userEvent.setup();
    render(<CspViolationsView />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unable to load CSP diagnostics. Reference: req-500");

    await user.click(screen.getByRole("button", { name: "Try again" }));

    await screen.findByTestId("csp-violation-table");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uses a generic message for an unexpected error", async () => {
    mockFetch.mockRejectedValue(new Error("boom"));
    render(<CspViolationsView />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load CSP diagnostics");
  });
});

describe("CspViolationsView: filters, pagination, staleness, cancellation", () => {
  it("refetches from the first page with the chosen window and filters", async () => {
    mockFetch.mockResolvedValue(fetchedReport());
    const user = userEvent.setup();
    render(<CspViolationsView />);
    await screen.findByTestId("csp-violation-table");

    await user.selectOptions(screen.getByLabelText("Time window"), "7d");
    await user.selectOptions(screen.getByLabelText("Directive"), "img-src");
    await user.selectOptions(screen.getByLabelText("Route category"), "proofs");
    await user.selectOptions(screen.getByLabelText("Release"), "2026.02.4");

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(5));
    const last = mockFetch.mock.calls[4]![0];
    expect(last.window).toBe("7d");
    expect(last.filter).toEqual({ directive: "img-src", routeCategory: "proofs", release: "2026.02.4" });
    expect(last.cursor).toBeUndefined();
  });

  it("appends the next page by cursor and does not repeat ids", async () => {
    mockFetch
      .mockResolvedValueOnce(fetchedReport({ groups: [group()], nextCursor: "c1" }))
      .mockResolvedValueOnce(fetchedReport({ groups: [group(), group({ id: "g2", directive: "img-src" })], nextCursor: null }));
    const user = userEvent.setup();
    render(<CspViolationsView />);

    await screen.findByTestId("csp-violation-table");
    await user.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(screen.getAllByTestId("csp-violation-row")).toHaveLength(2));
    expect(mockFetch.mock.calls[1]![0]).toMatchObject({ cursor: "c1", token: CSP_TOKEN });
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("keeps loaded rows when a later page fails", async () => {
    mockFetch
      .mockResolvedValueOnce(fetchedReport({ nextCursor: "c1" }))
      .mockRejectedValueOnce(new CspRequestError("failed", "req-p2", "Unable to load CSP diagnostics."));
    const user = userEvent.setup();
    render(<CspViolationsView />);

    await screen.findByTestId("csp-violation-table");
    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("req-p2");
    expect(screen.getByTestId("csp-violation-table")).toBeInTheDocument();
  });

  it("ignores a second Load more click while a page is loading", async () => {
    const next = deferred();
    mockFetch.mockResolvedValueOnce(fetchedReport({ nextCursor: "c1" })).mockReturnValueOnce(next.promise);
    const user = userEvent.setup();
    render(<CspViolationsView />);

    await screen.findByTestId("csp-violation-table");
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await user.click(screen.getByRole("button", { name: "Loading..." }));

    expect(mockFetch).toHaveBeenCalledTimes(2);
    await act(async () => next.resolve(fetchedReport({ groups: [], nextCursor: null })));
  });

  it("aborts a superseded request and ignores its late data and late error", async () => {
    const first = deferred();
    const second = deferred();
    mockFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const user = userEvent.setup();
    render(<CspViolationsView />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const firstSignal = mockFetch.mock.calls[0]![0].signal;
    await user.selectOptions(screen.getByLabelText("Directive"), "img-src");
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(firstSignal.aborted).toBe(true);

    await act(async () => second.resolve(fetchedReport({ groups: [group({ id: "new", directive: "img-src" })] })));
    await act(async () => first.resolve(fetchedReport({ groups: [group({ id: "old", directive: "font-src" })] })));

    expect(screen.getByText("img-src", { selector: "th" })).toBeInTheDocument();
    expect(screen.queryByText("font-src", { selector: "th" })).not.toBeInTheDocument();
  });

  it("does not show an error for an abort on unmount", async () => {
    const pending = deferred();
    mockFetch.mockReturnValue(pending.promise);
    const { unmount } = render(<CspViolationsView />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const signal = mockFetch.mock.calls[0]![0].signal;
    unmount();

    expect(signal.aborted).toBe(true);
    await act(async () => pending.reject(new DOMException("aborted", "AbortError")));
  });

  it("does not show another account's rows after a different user signs in", async () => {
    mockFetch.mockResolvedValueOnce(fetchedReport({ groups: [group({ id: "mine" })] }));
    render(<CspViolationsView />);
    await screen.findByTestId("csp-violation-table");

    const second = deferred();
    mockFetch.mockReturnValueOnce(second.promise);
    act(() => storeSession({ token: "second-token", user: { ...CSP_ADMIN, id: "user-2" } }));

    await waitFor(() => expect(screen.queryByTestId("csp-violation-table")).not.toBeInTheDocument());
    expect(mockFetch.mock.calls[1]![0].token).toBe("second-token");
  });
});

describe("CspViolationsView: accessibility", () => {
  it("uses a captioned table with column and row headers and labelled controls", async () => {
    mockFetch.mockResolvedValue(fetchedReport());
    render(<CspViolationsView />);

    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("columnheader")).toHaveLength(8);
    expect(within(table).getByRole("rowheader", { name: "script-src-elem" })).toBeInTheDocument();
    expect(screen.getByLabelText("Time window")).toBeInTheDocument();
    expect(screen.getByLabelText("Release")).toBeInTheDocument();
  });
});
