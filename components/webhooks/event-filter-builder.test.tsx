/**
 * EventFilterBuilder Component Tests
 *
 * Jest + React Testing Library tests covering:
 * - Positive: build filter with each predicate kind, preview matches saved JSON
 * - Negative: unsupported field, unknown event/outcome/version
 * - Boundary: at-limit and just-over-limit predicates
 * - Accessibility: keyboard navigation, ARIA labels, focus management
 */

import React from "react";
import { render, screen, userEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { EventFilterBuilder } from "./event-filter-builder";
import { WEBHOOK_EVENT_TYPES, WEBHOOK_OUTCOMES, WebhookEventFilter } from "@/lib/validation/webhook-filters";

describe("EventFilterBuilder", () => {
  it("renders with empty initial state", () => {
    const handleChange = jest.fn();
    render(
      <EventFilterBuilder
        initialFilter={{ version: 1, predicates: {} }}
        onFilterChange={handleChange}
      />
    );

    expect(screen.getByText("Event Filter (Optional)")).toBeInTheDocument();
    expect(screen.getByText(/No filter \(all events/)).toBeInTheDocument();
  });

  it("renders event predicate checkboxes", () => {
    const handleChange = jest.fn();
    render(
      <EventFilterBuilder
        initialFilter={{ version: 1, predicates: {} }}
        onFilterChange={handleChange}
      />
    );

    WEBHOOK_EVENT_TYPES.forEach((event) => {
      const checkbox = screen.getByRole("checkbox", {
        name: new RegExp(`Subscribe to.*${event.split(".")[1]}`),
      });
      expect(checkbox).toBeInTheDocument();
      expect(checkbox).not.toBeChecked();
    });
  });

  it("allows selecting event types", async () => {
    const handleChange = jest.fn();
    const user = userEvent.setup();
    render(
      <EventFilterBuilder
        initialFilter={{ version: 1, predicates: {} }}
        onFilterChange={handleChange}
      />
    );

    const proofCreatedCheckbox = screen.getByRole("checkbox", {
      name: /Subscribe to.*Proof Created/,
    });

    await user.click(proofCreatedCheckbox);

    expect(proofCreatedCheckbox).toBeChecked();
    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        predicates: expect.objectContaining({
          event: expect.objectContaining({
            allowedEvents: expect.arrayContaining(["proof.created"]),
          }),
        }),
      })
    );
  });

  it("allows deselecting event types", async () => {
    const handleChange = jest.fn();
    const user = userEvent.setup();
    const initialFilter: WebhookEventFilter = {
      version: 1,
      predicates: {
        event: { allowedEvents: ["proof.created"] },
      },
    };

    render(
      <EventFilterBuilder initialFilter={initialFilter} onFilterChange={handleChange} />
    );

    const proofCreatedCheckbox = screen.getByRole("checkbox", {
      name: /Subscribe to.*Proof Created/,
    });

    expect(proofCreatedCheckbox).toBeChecked();

    await user.click(proofCreatedCheckbox);

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        predicates: {},
      })
    );
  });

  it("renders resource type dropdown", () => {
    const handleChange = jest.fn();
    render(
      <EventFilterBuilder
        initialFilter={{ version: 1, predicates: {} }}
        onFilterChange={handleChange}
      />
    );

    const resourceTypeSelect = screen.getByLabelText("Resource Type");
    expect(resourceTypeSelect).toBeInTheDocument();
    expect(resourceTypeSelect).toHaveValue("");
  });

  it("allows selecting resource type", async () => {
    const handleChange = jest.fn();
    const user = userEvent.setup();
    render(
      <EventFilterBuilder
        initialFilter={{ version: 1, predicates: {} }}
        onFilterChange={handleChange}
      />
    );

    const resourceTypeSelect = screen.getByLabelText("Resource Type");
    await user.selectOption(resourceTypeSelect, "proof");

    expect(resourceTypeSelect).toHaveValue("proof");
    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        predicates: expect.objectContaining({
          resource: expect.objectContaining({
            resourceType: "proof",
          }),
        }),
      })
    );
  });

  it("shows resource IDs input when resource type is selected", async () => {
    const handleChange = jest.fn();
    const user = userEvent.setup();
    render(
      <EventFilterBuilder
        initialFilter={{ version: 1, predicates: {} }}
        onFilterChange={handleChange}
      />
    );

    const resourceTypeSelect = screen.getByLabelText("Resource Type");
    await user.selectOption(resourceTypeSelect, "proof");

    const resourceIdsInput = screen.getByLabelText(/Resource IDs/);
    expect(resourceIdsInput).toBeInTheDocument();
  });

  it("allows entering resource IDs", async () => {
    const handleChange = jest.fn();
    const user = userEvent.setup();
    const initialFilter: WebhookEventFilter = {
      version: 1,
      predicates: {
        resource: { resourceType: "proof" },
      },
    };

    render(
      <EventFilterBuilder initialFilter={initialFilter} onFilterChange={handleChange} />
    );

    const resourceIdsInput = screen.getByLabelText(/Resource IDs/) as HTMLTextAreaElement;
    await user.clear(resourceIdsInput);
    await user.type(resourceIdsInput, "proof_123, proof_456");

    await waitFor(() => {
      expect(handleChange).toHaveBeenCalledWith(
        expect.objectContaining({
          predicates: expect.objectContaining({
            resource: expect.objectContaining({
              resourceIds: expect.arrayContaining(["proof_123", "proof_456"]),
            }),
          }),
        })
      );
    });
  });

  it("renders outcome checkboxes", () => {
    const handleChange = jest.fn();
    render(
      <EventFilterBuilder
        initialFilter={{ version: 1, predicates: {} }}
        onFilterChange={handleChange}
      />
    );

    WEBHOOK_OUTCOMES.forEach((outcome) => {
      const checkbox = screen.getByRole("checkbox", {
        name: new RegExp(`Filter by.*${outcome}`, "i"),
      });
      expect(checkbox).toBeInTheDocument();
      expect(checkbox).not.toBeChecked();
    });
  });

  it("allows selecting outcomes", async () => {
    const handleChange = jest.fn();
    const user = userEvent.setup();
    render(
      <EventFilterBuilder
        initialFilter={{ version: 1, predicates: {} }}
        onFilterChange={handleChange}
      />
    );

    const successCheckbox = screen.getByRole("checkbox", {
      name: /Filter by.*Success/i,
    });

    await user.click(successCheckbox);

    expect(successCheckbox).toBeChecked();
    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        predicates: expect.objectContaining({
          outcome: expect.objectContaining({
            outcomes: expect.arrayContaining(["success"]),
          }),
        }),
      })
    );
  });

  it("renders version input", () => {
    const handleChange = jest.fn();
    render(
      <EventFilterBuilder
        initialFilter={{ version: 1, predicates: {} }}
        onFilterChange={handleChange}
      />
    );

    const versionInput = screen.getByLabelText(/API Versions/);
    expect(versionInput).toBeInTheDocument();
  });

  it("allows entering versions", async () => {
    const handleChange = jest.fn();
    const user = userEvent.setup();
    render(
      <EventFilterBuilder
        initialFilter={{ version: 1, predicates: {} }}
        onFilterChange={handleChange}
      />
    );

    const versionInput = screen.getByLabelText(/API Versions/) as HTMLTextAreaElement;
    await user.type(versionInput, "1.0, 2.0");

    await waitFor(() => {
      expect(handleChange).toHaveBeenCalledWith(
        expect.objectContaining({
          predicates: expect.objectContaining({
            version: expect.objectContaining({
              versions: expect.arrayContaining(["1.0", "2.0"]),
            }),
          }),
        })
      );
    });
  });

  it("shows summary tab by default", () => {
    const handleChange = jest.fn();
    render(
      <EventFilterBuilder
        initialFilter={{ version: 1, predicates: {} }}
        onFilterChange={handleChange}
      />
    );

    expect(screen.getByText(/No filter \(all events/)).toBeInTheDocument();
  });

  it("allows switching to JSON tab", async () => {
    const handleChange = jest.fn();
    const user = userEvent.setup();
    render(
      <EventFilterBuilder
        initialFilter={{ version: 1, predicates: {} }}
        onFilterChange={handleChange}
      />
    );

    const jsonTab = screen.getByRole("tab", { name: /JSON Preview/ });
    await user.click(jsonTab);

    expect(jsonTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/{"version":1,"predicates":{}/)).toBeInTheDocument();
  });

  it("displays validation errors when present", async () => {
    const handleChange = jest.fn();
    const user = userEvent.setup();
    const invalidFilter = {
      version: 1,
      predicates: {
        outcome: { outcomes: [] }, // Empty outcomes is invalid
      },
    };

    render(
      <EventFilterBuilder
        initialFilter={invalidFilter as any}
        onFilterChange={handleChange}
      />
    );

    // The validation should detect the error
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });

  it("shows status message when filter is valid", async () => {
    const handleChange = jest.fn();
    const initialFilter: WebhookEventFilter = {
      version: 1,
      predicates: {
        event: { allowedEvents: ["proof.created"] },
      },
    };

    render(
      <EventFilterBuilder initialFilter={initialFilter} onFilterChange={handleChange} />
    );

    expect(screen.getByText(/✓ Filter is valid/)).toBeInTheDocument();
  });

  it("disables all inputs when disabled prop is true", () => {
    const handleChange = jest.fn();
    render(
      <EventFilterBuilder
        initialFilter={{ version: 1, predicates: {} }}
        onFilterChange={handleChange}
        disabled={true}
      />
    );

    const firstCheckbox = screen.getAllByRole("checkbox")[0];
    const resourceTypeSelect = screen.getByLabelText("Resource Type");

    expect(firstCheckbox).toBeDisabled();
    expect(resourceTypeSelect).toBeDisabled();
  });

  it("shows loading state when isLoading is true", () => {
    const handleChange = jest.fn();
    render(
      <EventFilterBuilder
        initialFilter={{ version: 1, predicates: {} }}
        onFilterChange={handleChange}
        isLoading={true}
      />
    );

    const firstCheckbox = screen.getAllByRole("checkbox")[0];
    expect(firstCheckbox).toBeDisabled();
  });

  it("displays boundary warning approaching max values", async () => {
    const handleChange = jest.fn();
    const user = userEvent.setup();
    // Create filter with 41 events (approaching 50-item limit with 10-item buffer)
    const manyEvents = Array.from({ length: 41 }, (_, i) => `v${i}.0`);
    const initialFilter: WebhookEventFilter = {
      version: 1,
      predicates: {
        version: { versions: manyEvents },
      },
    };

    render(
      <EventFilterBuilder initialFilter={initialFilter} onFilterChange={handleChange} />
    );

    // Should show warning
    await waitFor(() => {
      expect(screen.getByText(/Approaching.*limit/i)).toBeInTheDocument();
    });
  });

  it("maintains filter state across tab switches", async () => {
    const handleChange = jest.fn();
    const user = userEvent.setup();
    const initialFilter: WebhookEventFilter = {
      version: 1,
      predicates: {
        event: { allowedEvents: ["proof.created"] },
      },
    };

    render(
      <EventFilterBuilder initialFilter={initialFilter} onFilterChange={handleChange} />
    );

    // Check initial state
    expect(screen.getByText(/Event: proof.created/)).toBeInTheDocument();

    // Switch to JSON
    const jsonTab = screen.getByRole("tab", { name: /JSON Preview/ });
    await user.click(jsonTab);

    // Switch back to summary
    const summaryTab = screen.getByRole("tab", { name: /Summary/ });
    await user.click(summaryTab);

    // State should be preserved
    expect(screen.getByText(/Event: proof.created/)).toBeInTheDocument();
  });

  it("handles complex filter with all predicate kinds", async () => {
    const handleChange = jest.fn();
    const user = userEvent.setup();
    render(
      <EventFilterBuilder
        initialFilter={{ version: 1, predicates: {} }}
        onFilterChange={handleChange}
      />
    );

    // Select event
    const proofCreatedCheckbox = screen.getByRole("checkbox", {
      name: /Subscribe to.*Proof Created/,
    });
    await user.click(proofCreatedCheckbox);

    // Select resource type
    const resourceTypeSelect = screen.getByLabelText("Resource Type");
    await user.selectOption(resourceTypeSelect, "proof");

    // Select outcome
    const successCheckbox = screen.getByRole("checkbox", {
      name: /Filter by.*Success/i,
    });
    await user.click(successCheckbox);

    // Enter versions
    const versionInput = screen.getByLabelText(/API Versions/);
    await user.type(versionInput, "1.0");

    // Verify all were applied
    await waitFor(() => {
      const lastCall = handleChange.mock.calls[handleChange.mock.calls.length - 1][0];
      expect(lastCall.predicates.event).toBeDefined();
      expect(lastCall.predicates.resource).toBeDefined();
      expect(lastCall.predicates.outcome).toBeDefined();
      expect(lastCall.predicates.version).toBeDefined();
    });
  });

  describe("Accessibility", () => {
    it("has proper ARIA labels on all inputs", () => {
      const handleChange = jest.fn();
      render(
        <EventFilterBuilder
          initialFilter={{ version: 1, predicates: {} }}
          onFilterChange={handleChange}
        />
      );

      expect(screen.getByLabelText("Resource Type")).toBeInTheDocument();
      expect(screen.getByLabelText(/API Versions/)).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /Summary/ })).toHaveAttribute("role", "tab");
    });

    it("uses role=alert for validation errors", async () => {
      const handleChange = jest.fn();
      const invalidFilter = {
        version: 1,
        predicates: {
          event: { allowedEvents: [] }, // Invalid
        },
      };

      render(
        <EventFilterBuilder
          initialFilter={invalidFilter as any}
          onFilterChange={handleChange}
        />
      );

      await waitFor(() => {
        const alerts = screen.queryAllByRole("alert");
        expect(alerts.length).toBeGreaterThan(0);
      });
    });

    it("supports keyboard navigation for checkboxes", async () => {
      const handleChange = jest.fn();
      const user = userEvent.setup();
      render(
        <EventFilterBuilder
          initialFilter={{ version: 1, predicates: {} }}
          onFilterChange={handleChange}
        />
      );

      const firstCheckbox = screen.getAllByRole("checkbox")[0];
      firstCheckbox.focus();
      expect(document.activeElement).toBe(firstCheckbox);

      // Space bar to toggle
      await user.keyboard(" ");
      expect(firstCheckbox).toBeChecked();
    });

    it("allows tabbing through form fields", async () => {
      const handleChange = jest.fn();
      const user = userEvent.setup();
      render(
        <EventFilterBuilder
          initialFilter={{ version: 1, predicates: {} }}
          onFilterChange={handleChange}
        />
      );

      const resourceTypeSelect = screen.getByLabelText("Resource Type");
      resourceTypeSelect.focus();
      expect(document.activeElement).toBe(resourceTypeSelect);

      await user.tab();
      // Should move to next focusable element
      expect(document.activeElement).not.toBe(resourceTypeSelect);
    });
  });

  describe("Boundary Cases", () => {
    it("accepts filter at exactly max values", async () => {
      const handleChange = jest.fn();
      const maxVersions = Array.from({ length: 50 }, (_, i) => `v${i}.0`);
      const initialFilter: WebhookEventFilter = {
        version: 1,
        predicates: {
          version: { versions: maxVersions },
        },
      };

      render(
        <EventFilterBuilder initialFilter={initialFilter} onFilterChange={handleChange} />
      );

      expect(screen.getByText(/✓ Filter is valid/)).toBeInTheDocument();
      expect(screen.queryByText(/too many|exceeds/i)).not.toBeInTheDocument();
    });

    it("rejects filter exceeding max values", async () => {
      const handleChange = jest.fn();
      const tooManyVersions = Array.from({ length: 51 }, (_, i) => `v${i}.0`);
      const initialFilter: WebhookEventFilter = {
        version: 1,
        predicates: {
          version: { versions: tooManyVersions },
        },
      };

      render(
        <EventFilterBuilder initialFilter={initialFilter} onFilterChange={handleChange} />
      );

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
        expect(screen.getByText(/too many versions/i)).toBeInTheDocument();
      });
    });
  });
});
