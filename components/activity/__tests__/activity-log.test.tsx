/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityLog } from "../activity-log";
import { fetchActivityEvents } from "@/lib/api/activity";
import type { ActivityPage } from "@/lib/api/activity";

jest.mock("@/lib/api/activity", () => ({
  ...jest.requireActual("@/lib/api/activity"),
  fetchActivityEvents: jest.fn(),
}));

const mockFetchActivityEvents = fetchActivityEvents as jest.MockedFunction<
  typeof fetchActivityEvents
>;

beforeEach(() => {
  mockFetchActivityEvents.mockReset();
});

function page(overrides: Partial<ActivityPage> = {}): ActivityPage {
  return {
    events: [
      {
        id: "evt_a",
        category: "auth",
        action: "wallet-signature-verified",
        outcome: "success",
        occurredAt: new Date().toISOString(),
        walletAddressMasked: "GABC•••MNOP",
      },
    ],
    nextCursor: null,
    ...overrides,
  };
}

describe("ActivityLog — loading and empty states", () => {
  it("shows a loading state before events resolve", async () => {
    mockFetchActivityEvents.mockImplementation(
      () => new Promise(() => {}), // never resolves
    );
    render(<ActivityLog />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading recent activity");
  });

  it("shows an empty state when there is no activity at all", async () => {
    mockFetchActivityEvents.mockResolvedValue(page({ events: [] }));
    render(<ActivityLog />);

    await waitFor(() =>
      expect(screen.getByText("No recent account activity to show.")).toBeInTheDocument(),
    );
  });

  it("shows an error state and does not crash when the fetch rejects", async () => {
    mockFetchActivityEvents.mockRejectedValue(new Error("network down"));
    render(<ActivityLog />);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Unable to load recent activity"),
    );
  });
});

describe("ActivityLog — pagination", () => {
  it("shows a Load more button only when a next cursor is present, and appends the next page", async () => {
    mockFetchActivityEvents
      .mockResolvedValueOnce(
        page({
          events: [
            {
              id: "evt_a",
              category: "key",
              action: "api-key-created",
              outcome: "success",
              occurredAt: new Date().toISOString(),
              apiKeyIdMasked: "key_•••aaaa",
            },
          ],
          nextCursor: "evt_a",
        }),
      )
      .mockResolvedValueOnce(
        page({
          events: [
            {
              id: "evt_b",
              category: "key",
              action: "api-key-rotated",
              outcome: "success",
              occurredAt: new Date().toISOString(),
              apiKeyIdMasked: "key_•••bbbb",
            },
          ],
          nextCursor: null,
        }),
      );

    const user = userEvent.setup();
    render(<ActivityLog />);

    await waitFor(() => expect(screen.getByText(/key_•••aaaa created/)).toBeInTheDocument());

    const loadMoreButton = screen.getByRole("button", { name: "Load more" });
    await user.click(loadMoreButton);

    await waitFor(() => expect(screen.getByText(/key_•••bbbb rotated/)).toBeInTheDocument());
    // First page's event is still present — pagination appends, it doesn't replace.
    expect(screen.getByText(/key_•••aaaa created/)).toBeInTheDocument();
    // No more pages after the second fetch — button disappears.
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();

    expect(mockFetchActivityEvents).toHaveBeenNthCalledWith(2, { cursor: "evt_a", filter: {} });
  });

  it("does not render a Load more button when there is only one page", async () => {
    mockFetchActivityEvents.mockResolvedValue(page({ nextCursor: null }));
    render(<ActivityLog />);

    await waitFor(() => expect(screen.getByTestId("activity-event-list")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });
});

describe("ActivityLog — filtering", () => {
  it("refetches with the selected category filter and shows a filtered empty state", async () => {
    mockFetchActivityEvents
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(page({ events: [], nextCursor: null }));

    const user = userEvent.setup();
    render(<ActivityLog />);

    await waitFor(() => expect(screen.getByTestId("activity-event-list")).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText("Category"), "admin");

    await waitFor(() =>
      expect(screen.getByText("No activity matches the selected filters.")).toBeInTheDocument(),
    );
    expect(mockFetchActivityEvents).toHaveBeenNthCalledWith(2, {
      filter: { category: "admin", outcome: undefined },
    });
  });
});
