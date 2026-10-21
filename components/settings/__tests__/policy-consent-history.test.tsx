import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PolicyConsentHistory } from "../policy-consent-history";
import type { PolicyConsentState } from "@/lib/api/policy-consent";

function makeState(overrides: Partial<PolicyConsentState> = {}): PolicyConsentState {
  return {
    currentVersions: [
      {
        kind: "PRIVACY_POLICY",
        version: "v2",
        publishedAt: "2026-06-01T00:00:00.000Z",
        contentUrl: "/privacy?version=v2",
        required: true,
        protectedActions: ["create-proof"],
      },
    ],
    acceptanceHistory: [],
    ...overrides,
  };
}

describe("PolicyConsentHistory: first consent", () => {
  it("shows the required-consent banner and no history", () => {
    render(<PolicyConsentHistory state={makeState()} onStateChange={jest.fn()} />);
    expect(screen.getByText("Action required")).toBeInTheDocument();
    expect(screen.getByText("No acceptance records yet.")).toBeInTheDocument();
  });

  it("only records consent when Accept is explicitly clicked", async () => {
    const onStateChange = jest.fn();
    render(<PolicyConsentHistory state={makeState()} onStateChange={onStateChange} />);

    expect(onStateChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Accept version v2/i }));

    await waitFor(() => expect(onStateChange).toHaveBeenCalledTimes(1));
    const next = onStateChange.mock.calls[0][0] as PolicyConsentState;
    expect(next.acceptanceHistory).toHaveLength(1);
  });
});

describe("PolicyConsentHistory: unchanged policy", () => {
  it("shows no action-required banner once accepted", () => {
    const state = makeState({
      acceptanceHistory: [{ id: "c1", kind: "PRIVACY_POLICY", version: "v2", acceptedAt: "2026-06-01T01:00:00.000Z" }],
    });
    render(<PolicyConsentHistory state={state} onStateChange={jest.fn()} />);
    expect(screen.queryByText("Action required")).not.toBeInTheDocument();
    expect(screen.getByText("Accepted")).toBeInTheDocument();
  });
});

describe("PolicyConsentHistory: required update", () => {
  it("names the blocked protected actions", () => {
    render(<PolicyConsentHistory state={makeState()} onStateChange={jest.fn()} />);
    expect(screen.getByText(/create-proof/)).toBeInTheDocument();
  });

  it("links to immutable, version-qualified policy content", () => {
    render(<PolicyConsentHistory state={makeState()} onStateChange={jest.fn()} />);
    const link = screen.getByRole("link", { name: /Review full policy text/i });
    expect(link).toHaveAttribute("href", "/privacy?version=v2");
  });
});

describe("PolicyConsentHistory: withdrawal", () => {
  it("offers a Withdraw action for an accepted policy and reflects it without losing history", () => {
    const onStateChange = jest.fn();
    const state = makeState({
      acceptanceHistory: [{ id: "c1", kind: "PRIVACY_POLICY", version: "v2", acceptedAt: "2026-06-01T01:00:00.000Z" }],
    });
    render(<PolicyConsentHistory state={state} onStateChange={onStateChange} />);

    fireEvent.click(screen.getByRole("button", { name: /Withdraw/i }));
    expect(onStateChange).toHaveBeenCalledTimes(1);
    const next = onStateChange.mock.calls[0][0] as PolicyConsentState;
    expect(next.acceptanceHistory).toHaveLength(2);
    expect(next.acceptanceHistory[0]).toEqual(state.acceptanceHistory[0]);
  });
});

describe("PolicyConsentHistory: history is read-only in the UI", () => {
  it("renders acceptance history records without any edit control", () => {
    const state = makeState({
      acceptanceHistory: [{ id: "c1", kind: "PRIVACY_POLICY", version: "v2", acceptedAt: "2026-06-01T01:00:00.000Z" }],
    });
    render(<PolicyConsentHistory state={state} onStateChange={jest.fn()} />);
    const historyList = screen.getByRole("list", { name: /Acceptance history/i });
    expect(historyList).toHaveTextContent("version v2");
    expect(historyList.querySelector("button")).toBeNull();
  });
});
