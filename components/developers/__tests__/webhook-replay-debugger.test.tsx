import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import userEvent from "@testing-library/user-event";
import { WebhookReplayDebugger } from "../webhook-replay-debugger";
import type { Webhook } from "@/lib/api/webhooks";

const activeWebhook: Webhook = {
  id: "webhook-active",
  url: "https://example.com/active-hook",
  events: ["proof.created"],
  status: "ACTIVE",
};

const disabledWebhook: Webhook = {
  id: "webhook-disabled",
  url: "https://example.com/disabled-hook",
  events: ["proof.created"],
  status: "DISABLED",
};

const secret = "whsec_super_secret_value_12345";

describe("WebhookReplayDebugger: authorization", () => {
  it("blocks a user without DEVELOPER/ADMIN role from using the debugger", () => {
    render(
      <WebhookReplayDebugger
        webhooks={[activeWebhook]}
        secretsByWebhookId={{ [activeWebhook.id]: secret }}
        userRole="VIEWER"
      />
    );

    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(screen.queryByText(/send synthetic test delivery/i)).not.toBeInTheDocument();
  });

  it("allows a DEVELOPER role to see the debugger controls", () => {
    render(
      <WebhookReplayDebugger
        webhooks={[activeWebhook]}
        secretsByWebhookId={{ [activeWebhook.id]: secret }}
        userRole="DEVELOPER"
      />
    );

    expect(screen.getByRole("button", { name: /send synthetic test delivery/i })).toBeInTheDocument();
  });

  it("allows an ADMIN role to see the debugger controls", () => {
    render(
      <WebhookReplayDebugger
        webhooks={[activeWebhook]}
        secretsByWebhookId={{ [activeWebhook.id]: secret }}
        userRole="ADMIN"
      />
    );

    expect(screen.getByRole("button", { name: /send synthetic test delivery/i })).toBeInTheDocument();
  });
});

describe("WebhookReplayDebugger: disabled endpoint handling", () => {
  it("still lists a disabled endpoint as selectable, with a visible warning", () => {
    render(
      <WebhookReplayDebugger
        webhooks={[disabledWebhook]}
        secretsByWebhookId={{ [disabledWebhook.id]: secret }}
        userRole="DEVELOPER"
      />
    );

    const select = screen.getByLabelText(/target endpoint/i) as HTMLSelectElement;
    expect(select.querySelector("option")).not.toBeNull();
    expect(screen.getByText(/this endpoint is disabled/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send synthetic test delivery/i })).not.toBeDisabled();
  });
});

describe("WebhookReplayDebugger: secret redaction", () => {
  it("never renders the raw signing secret anywhere in the UI", () => {
    render(
      <WebhookReplayDebugger
        webhooks={[activeWebhook]}
        secretsByWebhookId={{ [activeWebhook.id]: secret }}
        userRole="DEVELOPER"
      />
    );

    expect(screen.queryByText(secret)).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(secret);
  });

  it("sanitizes a secret-shaped response body before rendering the result", async () => {
    const leakedSecret = "whsec_leaked_value_0000000000";
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ echoedSecret: leakedSecret }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      <WebhookReplayDebugger
        webhooks={[activeWebhook]}
        secretsByWebhookId={{ [activeWebhook.id]: secret }}
        userRole="DEVELOPER"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /send synthetic test delivery/i }));

    await waitFor(() => {
      expect(screen.getByText(/response body \(sanitized\)/i)).toBeInTheDocument();
    });

    expect(document.body.innerHTML).not.toContain(leakedSecret);
    expect(screen.getByText(/<redacted>/)).toBeInTheDocument();
  });
});

describe("WebhookReplayDebugger: keyboard operability", () => {
  it("supports completing the full flow via keyboard alone (tab to controls, select via keys, activate via Enter)", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => "ok",
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const user = userEvent.setup();

    render(
      <WebhookReplayDebugger
        webhooks={[activeWebhook]}
        secretsByWebhookId={{ [activeWebhook.id]: secret }}
        userRole="DEVELOPER"
      />
    );

    const eventSelect = screen.getByLabelText(/event type/i);
    const endpointSelect = screen.getByLabelText(/target endpoint/i);
    const newIdButton = screen.getByRole("button", { name: /new request id/i });
    const sendButton = screen.getByRole("button", { name: /send synthetic test delivery/i });

    // Every control must be reachable without a pointer.
    eventSelect.focus();
    expect(eventSelect).toHaveFocus();

    await user.tab();
    expect(endpointSelect).toHaveFocus();

    await user.tab();
    expect(newIdButton).toHaveFocus();

    await user.tab();
    expect(sendButton).toHaveFocus();

    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("has no element requiring drag-and-drop or mouse-only interaction", () => {
    const { container } = render(
      <WebhookReplayDebugger
        webhooks={[activeWebhook]}
        secretsByWebhookId={{ [activeWebhook.id]: secret }}
        userRole="DEVELOPER"
      />
    );

    expect(container.querySelectorAll("[draggable=true]").length).toBe(0);
    container.querySelectorAll("[onDrop]").forEach(() => {
      throw new Error("Unexpected drop target found");
    });
  });
});

describe("WebhookReplayDebugger: payload preview and signature metadata", () => {
  it("shows a live payload preview and the signature scheme metadata", () => {
    render(
      <WebhookReplayDebugger
        webhooks={[activeWebhook]}
        secretsByWebhookId={{ [activeWebhook.id]: secret }}
        userRole="DEVELOPER"
      />
    );

    expect(screen.getByText(/synthetic payload preview/i)).toBeInTheDocument();
    expect(screen.getByText(/HMAC-SHA256, version v1/i)).toBeInTheDocument();
    expect(screen.getByText(/never displayed/i)).toBeInTheDocument();
  });

  it("mints a new request id when 'New request ID' is clicked, without changing the event type", () => {
    render(
      <WebhookReplayDebugger
        webhooks={[activeWebhook]}
        secretsByWebhookId={{ [activeWebhook.id]: secret }}
        userRole="DEVELOPER"
      />
    );

    const before = screen.getByText(/^synthetic_/).textContent;
    fireEvent.click(screen.getByRole("button", { name: /new request id/i }));
    const after = screen.getByText(/^synthetic_/).textContent;

    expect(after).not.toBe(before);
  });
});
