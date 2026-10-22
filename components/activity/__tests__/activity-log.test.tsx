/**
 * @jest-environment jsdom
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityLog } from "../activity-log";
import { ActivityRequestError, fetchActivityEvents, type FetchedActivityPage } from "@/lib/api/activity";
import { clearStoredSession, readStoredSession, storeSession } from "@/lib/session";
import { FIXTURE_USER, SYNTHETIC_TOKEN, fetchedPage, wireEvents } from "@/tests/fixtures/activity-fixtures";

jest.mock("@/lib/api/activity", () => ({
  ...jest.requireActual("@/lib/api/activity"),
  fetchActivityEvents: jest.fn(),
}));

const mockFetch = fetchActivityEvents as jest.MockedFunction<typeof fetchActivityEvents>;

type Deferred = { promise: Promise<FetchedActivityPage>; resolve: (page: FetchedActivityPage) => void; reject: (error: unknown) => void };
function deferred(): Deferred {
  let resolve!: Deferred["resolve"];
  let reject!: Deferred["reject"];
  const promise = new Promise<FetchedActivityPage>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function signIn() {
  storeSession({ token: SYNTHETIC_TOKEN, user: FIXTURE_USER });
}

function keyEvent(id: string, action = "api-key-created", masked = "key_•••aaaa") {
  return { ...wireEvents.key, id, action, apiKeyIdMasked: masked } as unknown as FetchedActivityPage["events"][number];
}

beforeEach(() => {
  mockFetch.mockReset();
  signIn();
});

describe("ActivityLog: authorization", () => {
  it("shows a sign-in state and fetches nothing without an in-memory session", () => {
    clearStoredSession();
    render(<ActivityLog />);

    expect(screen.getByRole("status")).toHaveTextContent("Sign in to view account activity");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends the session token and an abort signal with the first request", async () => {
    mockFetch.mockResolvedValue(fetchedPage());
    render(<ActivityLog />);

    await screen.findByTestId("activity-event-list");
    const options = mockFetch.mock.calls[0]![0];
    expect(options.token).toBe(SYNTHETIC_TOKEN);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.cursor).toBeUndefined();
  });

  it("on 401 ends the session everywhere and replaces the list with the sign-in state", async () => {
    mockFetch.mockRejectedValue(new ActivityRequestError("unauthorized", "req-401", "Your session has ended."));
    render(<ActivityLog />);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Sign in to view account activity"));
    expect(readStoredSession()).toBeNull();
    expect(screen.queryByTestId("activity-event-list")).not.toBeInTheDocument();
  });

  it("on 403 shows a terminal access-denied state with the reference and no retry", async () => {
    mockFetch.mockRejectedValue(new ActivityRequestError("forbidden", "req-403", "You do not have access to account activity."));
    render(<ActivityLog />);

    await waitFor(() => expect(screen.getByText("Activity access denied")).toBeInTheDocument());
    expect(screen.getByText("Reference: req-403")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(readStoredSession()).not.toBeNull();
  });

  it("shows an unavailable state when the endpoint is not deployed (404/501)", async () => {
    mockFetch.mockRejectedValue(new ActivityRequestError("unavailable", "req-404", "Account activity is not available."));
    render(<ActivityLog />);

    await waitFor(() => expect(screen.getByText("Activity log unavailable")).toBeInTheDocument());
  });

  it("clears the list and aborts when the session is revoked (logout or another tab)", async () => {
    mockFetch.mockResolvedValue(fetchedPage({ nextCursor: "cur_1" }));
    render(<ActivityLog />);
    await screen.findByTestId("activity-event-list");
    const signal = mockFetch.mock.calls[0]![0].signal;

    act(() => clearStoredSession("synced_from_other_tab"));

    await waitFor(() => expect(screen.getByText("Sign in to view account activity")).toBeInTheDocument());
    expect(signal.aborted).toBe(true);
    expect(screen.queryByTestId("activity-event-list")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("does not show the previous account's events after a different wallet signs in", async () => {
    mockFetch.mockResolvedValueOnce(fetchedPage({ events: [keyEvent("evt_old")] }));
    render(<ActivityLog />);
    await screen.findByText(/key_•••aaaa created/);

    const second = deferred();
    mockFetch.mockReturnValueOnce(second.promise);
    act(() => storeSession({ token: "second-token", user: { ...FIXTURE_USER, id: "user-2" } }));

    await waitFor(() => expect(screen.queryByText(/key_•••aaaa created/)).not.toBeInTheDocument());
    expect(mockFetch.mock.calls[1]![0].token).toBe("second-token");
  });
});

describe("ActivityLog: loading, empty and error states", () => {
  it("shows a loading state before events resolve", () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<ActivityLog />);
    expect(screen.getByText("Loading recent activity...")).toBeInTheDocument();
  });

  it("shows an empty state, not invented events, when the server returns none", async () => {
    mockFetch.mockResolvedValue(fetchedPage({ events: [] }));
    render(<ActivityLog />);

    expect(await screen.findByText("No recent account activity to show.")).toBeInTheDocument();
    expect(screen.queryByTestId("activity-event-row")).not.toBeInTheDocument();
  });

  it("shows an alert with the request reference and retries from the button", async () => {
    mockFetch
      .mockRejectedValueOnce(new ActivityRequestError("failed", "req-500", "Unable to load recent activity."))
      .mockResolvedValueOnce(fetchedPage());
    const user = userEvent.setup();
    render(<ActivityLog />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unable to load recent activity.");
    expect(alert).toHaveTextContent("Reference: req-500");

    await user.click(screen.getByRole("button", { name: "Try again" }));

    await screen.findByTestId("activity-event-list");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("uses a generic message for an unexpected error type", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));
    render(<ActivityLog />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load recent activity");
  });

  it("reports entries the client had to drop", async () => {
    mockFetch.mockResolvedValue(fetchedPage({ droppedCount: 2 }));
    render(<ActivityLog />);

    expect(await screen.findByTestId("activity-dropped-note")).toHaveTextContent("2 entries could not be displayed.");
  });

  it("renders an unrecognized event with the safe fallback and no raw fields", async () => {
    mockFetch.mockResolvedValue(
      fetchedPage({ events: [{ id: "evt_future", occurredAt: "2026-01-02T03:04:05.000Z" }] }),
    );
    render(<ActivityLog />);

    expect(await screen.findByTestId("unknown-activity-event")).toBeInTheDocument();
  });
});

describe("ActivityLog: pagination", () => {
  it("appends the next page using the server cursor and hides Load more at the end", async () => {
    mockFetch
      .mockResolvedValueOnce(fetchedPage({ events: [keyEvent("evt_a")], nextCursor: "cur_a" }))
      .mockResolvedValueOnce(fetchedPage({ events: [keyEvent("evt_b", "api-key-rotated", "key_•••bbbb")], nextCursor: null }));
    const user = userEvent.setup();
    render(<ActivityLog />);

    await screen.findByText(/key_•••aaaa created/);
    await user.click(screen.getByRole("button", { name: "Load more" }));

    await screen.findByText(/key_•••bbbb rotated/);
    expect(screen.getByText(/key_•••aaaa created/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    expect(mockFetch.mock.calls[1]![0]).toMatchObject({ cursor: "cur_a", filter: {}, token: SYNTHETIC_TOKEN });
  });

  it("does not render an event twice when a later page repeats an id (replay)", async () => {
    mockFetch
      .mockResolvedValueOnce(fetchedPage({ events: [keyEvent("evt_a")], nextCursor: "cur_a" }))
      .mockResolvedValueOnce(fetchedPage({ events: [keyEvent("evt_a"), keyEvent("evt_b", "api-key-revoked", "key_•••bbbb")], nextCursor: null }));
    const user = userEvent.setup();
    render(<ActivityLog />);

    await screen.findByText(/key_•••aaaa created/);
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText(/key_•••bbbb revoked/);

    expect(screen.getAllByTestId("activity-event-row")).toHaveLength(2);
  });

  it("ignores a second click while the next page is loading", async () => {
    const next = deferred();
    mockFetch
      .mockResolvedValueOnce(fetchedPage({ events: [keyEvent("evt_a")], nextCursor: "cur_a" }))
      .mockReturnValueOnce(next.promise);
    const user = userEvent.setup();
    render(<ActivityLog />);

    await screen.findByText(/key_•••aaaa created/);
    const button = screen.getByRole("button", { name: "Load more" });
    await user.click(button);
    await user.click(screen.getByRole("button", { name: "Loading..." }));

    expect(mockFetch).toHaveBeenCalledTimes(2);
    await act(async () => next.resolve(fetchedPage({ events: [], nextCursor: null })));
  });

  it("keeps the events already loaded when a later page fails", async () => {
    mockFetch
      .mockResolvedValueOnce(fetchedPage({ events: [keyEvent("evt_a")], nextCursor: "cur_a" }))
      .mockRejectedValueOnce(new ActivityRequestError("failed", "req-page2", "Unable to load recent activity."));
    const user = userEvent.setup();
    render(<ActivityLog />);

    await screen.findByText(/key_•••aaaa created/);
    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Reference: req-page2");
    expect(screen.getByText(/key_•••aaaa created/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
  });

  it("does not render Load more when there is a single page", async () => {
    mockFetch.mockResolvedValue(fetchedPage({ nextCursor: null }));
    render(<ActivityLog />);

    await screen.findByTestId("activity-event-list");
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });
});

describe("ActivityLog: filtering, staleness and cancellation", () => {
  it("refetches from the server with the selected filter and shows the filtered empty state", async () => {
    mockFetch
      .mockResolvedValueOnce(fetchedPage())
      .mockResolvedValueOnce(fetchedPage({ events: [], nextCursor: null }));
    const user = userEvent.setup();
    render(<ActivityLog />);

    await screen.findByTestId("activity-event-list");
    await user.selectOptions(screen.getByLabelText("Category"), "admin");

    expect(await screen.findByText("No activity matches the selected filters.")).toBeInTheDocument();
    expect(mockFetch.mock.calls[1]![0].filter).toEqual({ category: "admin", outcome: undefined });
    expect(mockFetch.mock.calls[1]![0].cursor).toBeUndefined();
  });

  it("aborts the superseded request and ignores its late response", async () => {
    const first = deferred();
    const second = deferred();
    mockFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const user = userEvent.setup();
    render(<ActivityLog />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const firstSignal = mockFetch.mock.calls[0]![0].signal;

    await user.selectOptions(screen.getByLabelText("Category"), "key");
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(firstSignal.aborted).toBe(true);

    await act(async () => second.resolve(fetchedPage({ events: [keyEvent("evt_new", "api-key-created", "key_•••newn")] })));
    await act(async () => first.resolve(fetchedPage({ events: [keyEvent("evt_old", "api-key-created", "key_•••oldo")] })));

    expect(screen.getByText(/key_•••newn created/)).toBeInTheDocument();
    expect(screen.queryByText(/key_•••oldo created/)).not.toBeInTheDocument();
  });

  it("ignores a late error from a superseded request", async () => {
    const first = deferred();
    mockFetch.mockReturnValueOnce(first.promise).mockResolvedValueOnce(fetchedPage());
    const user = userEvent.setup();
    render(<ActivityLog />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    await user.selectOptions(screen.getByLabelText("Outcome"), "failure");
    await screen.findByTestId("activity-event-list");

    await act(async () => first.reject(new ActivityRequestError("failed", "late", "Unable to load recent activity.")));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("aborts the in-flight request on unmount without reporting an error", async () => {
    const pending = deferred();
    mockFetch.mockReturnValue(pending.promise);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { unmount } = render(<ActivityLog />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const signal = mockFetch.mock.calls[0]![0].signal;
    unmount();

    expect(signal.aborted).toBe(true);
    await act(async () => pending.reject(new DOMException("aborted", "AbortError")));
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("treats an abort during a filter change as silent, not as an error state", async () => {
    mockFetch
      .mockRejectedValueOnce(new DOMException("aborted", "AbortError"))
      .mockResolvedValueOnce(fetchedPage());
    const user = userEvent.setup();
    render(<ActivityLog />);

    await user.selectOptions(screen.getByLabelText("Category"), "auth");

    await screen.findByTestId("activity-event-list");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ActivityLog: accessibility", () => {
  it("announces loaded counts politely and marks errors as alerts", async () => {
    mockFetch.mockResolvedValue(fetchedPage({ events: [keyEvent("evt_a"), keyEvent("evt_b")] }));
    render(<ActivityLog />);

    await screen.findByTestId("activity-event-list");
    const live = screen.getAllByRole("status").find((node) => node.getAttribute("aria-live") === "polite");
    expect(live).toHaveTextContent("Showing 2 events.");
  });
});
