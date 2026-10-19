/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CorrelationTimeline } from "../correlation-timeline";
import { buildCorrelationTimeline, type CorrelatedAuditEvent } from "@/lib/audit/correlation-explorer";

function event(overrides: Partial<CorrelatedAuditEvent> = {}): CorrelatedAuditEvent {
  return {
    id: "evt-1",
    actor: "alice@example.com",
    action: "proof.created",
    resource: "proof-1",
    occurredAt: "2026-06-01T10:00:00.000Z",
    organizationId: "org-1",
    entryHash: "hash-1",
    previousEntryHash: null,
    correlationId: "corr-1",
    eventCategory: "request",
    ...overrides,
  };
}

describe("CorrelationTimeline (#243)", () => {
  it("shows a missing-link message, not a fabricated timeline, when no events match", () => {
    const result = buildCorrelationTimeline([], "corr-missing");
    render(<CorrelationTimeline result={result} />);
    expect(screen.getByText("No correlated events")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows a retention-expired message distinctly from missing", () => {
    const result = buildCorrelationTimeline([event()], "corr-1", { retentionExpired: true });
    render(<CorrelationTimeline result={result} />);
    expect(screen.getByText("Link no longer available")).toBeInTheDocument();
  });

  it("renders one timeline row per correlated event, in causal (chronological) order", () => {
    const result = buildCorrelationTimeline(
      [
        event({ id: "e2", occurredAt: "2026-06-01T11:00:00.000Z", eventCategory: "job", action: "job.started" }),
        event({ id: "e1", occurredAt: "2026-06-01T10:00:00.000Z", eventCategory: "request", action: "request.received" }),
      ],
      "corr-1",
    );
    render(<CorrelationTimeline result={result} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("request.received");
    expect(items[1]).toHaveTextContent("job.started");
  });

  it("redacts the actor by default (matching the existing export's redact-by-default behavior)", () => {
    const result = buildCorrelationTimeline([event({ actor: "alice@example.com" })], "corr-1");
    render(<CorrelationTimeline result={result} />);
    // Actor isn't directly rendered as its own field today, but
    // redactEventActor's output flows through safeEventSummary - this
    // asserts the raw actor value never appears anywhere in the DOM.
    expect(screen.queryByText("alice@example.com")).not.toBeInTheDocument();
  });

  it("shows the unredacted actor is still never rendered even when redaction is off, since actor has no dedicated field in this view", () => {
    const result = buildCorrelationTimeline([event({ actor: "alice@example.com" })], "corr-1");
    render(<CorrelationTimeline result={result} redactActors={false} />);
    // This view never renders actor at all (only category/action/resource/time),
    // so disabling redaction does not newly expose it either way.
    expect(screen.queryByText("alice@example.com")).not.toBeInTheDocument();
  });

  it("flags an event from an unrecognized future schema version with a visible note, and still lists it", () => {
    const result = buildCorrelationTimeline([event({ schemaVersion: 99, action: "future.event" })], "corr-1");
    render(<CorrelationTimeline result={result} />);
    expect(screen.getByText("future.event")).toBeInTheDocument();
    expect(screen.getByText(/newer schema version/i)).toBeInTheDocument();
  });

  it("renders a deep link from each entry back to the audit log, carrying the correlation id and entry id", () => {
    const result = buildCorrelationTimeline([event({ id: "evt-42" })], "corr-1");
    render(<CorrelationTimeline result={result} />);
    const link = screen.getByRole("link", { name: "View in audit log" });
    expect(link).toHaveAttribute("href", "/settings/audit?correlationId=corr-1&entryId=evt-42");
  });

  it("supports keyboard navigation: ArrowDown moves focus to the next entry", async () => {
    const user = userEvent.setup();
    const result = buildCorrelationTimeline(
      [
        event({ id: "e1", occurredAt: "2026-06-01T10:00:00.000Z" }),
        event({ id: "e2", occurredAt: "2026-06-01T11:00:00.000Z" }),
      ],
      "corr-1",
    );
    render(<CorrelationTimeline result={result} />);
    const items = screen.getAllByRole("listitem");
    items[0].focus();
    expect(items[0]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(items[0]).toHaveFocus();
  });

  it("does not move focus past the first or last entry on ArrowUp/ArrowDown at the boundaries", async () => {
    const user = userEvent.setup();
    const result = buildCorrelationTimeline([event({ id: "only" })], "corr-1");
    render(<CorrelationTimeline result={result} />);
    const items = screen.getAllByRole("listitem");
    items[0].focus();
    await user.keyboard("{ArrowDown}");
    expect(items[0]).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(items[0]).toHaveFocus();
  });
});
