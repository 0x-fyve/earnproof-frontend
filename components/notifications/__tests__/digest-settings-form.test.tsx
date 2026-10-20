/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DigestSettingsForm, type DigestSettingsFormProps } from "../digest-settings-form";
import { ApiConflictError } from "@/lib/api/client";
import { ApiError } from "@/lib/errors";
import { CRITICAL_SECURITY_EVENT_TYPES, SECURITY_EVENT_TYPE_LABELS } from "@/lib/api/notification-digest-settings";
import {
  OTHER_SYNTHETIC_USER_ID,
  SYNTHETIC_USER_ID,
  makeDigestSettings,
} from "@/tests/fixtures/notification-digest-fixtures";

const NOW = Date.UTC(2026, 0, 5, 6, 0);
const now = () => NOW;

function renderForm(overrides: Partial<DigestSettingsFormProps> = {}) {
  const props: DigestSettingsFormProps = {
    viewerUserId: SYNTHETIC_USER_ID,
    loadSettings: jest.fn(async () => makeDigestSettings()),
    saveSettings: jest.fn(async (update) => makeDigestSettings({ ...update, version: update.version + 1 })),
    now,
    ...overrides,
  };
  render(<DigestSettingsForm {...props} />);
  return props;
}

const saveButton = () => screen.getByRole("button", { name: /save digest settings|saving/i });
const status = () => screen.getByTestId("digest-status");
const zoneInput = () => screen.getByLabelText("Time zone (IANA)");

async function ready() {
  await screen.findByRole("button", { name: "Save digest settings" });
}

describe("DigestSettingsForm (#269)", () => {
  it("positive: loads settings and saves the exact payload with the version it was based on", async () => {
    const props = renderForm();
    await ready();

    fireEvent.click(screen.getByRole("radio", { name: "Weekly" }));
    fireEvent.change(screen.getByLabelText("Day of week"), { target: { value: "3" } });
    fireEvent.change(zoneInput(), { target: { value: "Europe/Berlin" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(status()).toHaveTextContent("Notification digest settings saved."));
    expect(props.saveSettings).toHaveBeenCalledWith(
      {
        schemaVersion: 1,
        version: 3,
        frequency: "weekly",
        deliveryTime: "09:00",
        dayOfWeek: 3,
        timeZone: "Europe/Berlin",
        channel: "in-app",
        digestEventTypes: ["api-key-created", "session-refreshed"],
      },
      expect.any(AbortSignal),
    );
  });

  describe("regression: critical events are always immediate", () => {
    it("lists every critical type as locked and offers no control to digest it", async () => {
      renderForm();
      await ready();
      const locked = screen.getByRole("list", { name: /critical event types, always immediate/i });
      for (const type of CRITICAL_SECURITY_EVENT_TYPES) {
        expect(within(locked).getByText(SECURITY_EVENT_TYPE_LABELS[type] + " (locked, immediate)")).toBeInTheDocument();
        expect(screen.queryByRole("checkbox", { name: SECURITY_EVENT_TYPE_LABELS[type] })).not.toBeInTheDocument();
      }
    });

    it("a type the server declares critical is removed from the digest controls and locked", async () => {
      renderForm({ loadSettings: async () => makeDigestSettings({ criticalEventTypes: ["session-refreshed"] }) });
      await ready();
      expect(screen.queryByRole("checkbox", { name: "Session refreshed" })).not.toBeInTheDocument();
      expect(screen.getByText("Session refreshed (locked, immediate)")).toBeInTheDocument();
    });

    it("a saved digest containing a critical or unknown type is never sent back: it is dropped and the user is told", async () => {
      const props = renderForm({
        loadSettings: async () => makeDigestSettings({ digestEventTypes: ["api-key-created", "api-key-revoked", "brand-new-event"] }),
      });
      await ready();
      expect(screen.getByText(/will be sent immediately instead: API key revoked, brand-new-event/)).toBeInTheDocument();

      fireEvent.click(saveButton());
      await waitFor(() => expect(props.saveSettings).toHaveBeenCalled());
      const sent = (props.saveSettings as jest.Mock).mock.calls[0][0];
      expect(sent.digestEventTypes).toEqual(["api-key-created"]);
    });
  });

  describe("negative", () => {
    it("invalid time zone: shows the error and never calls the saver", async () => {
      const props = renderForm();
      await ready();
      fireEvent.change(zoneInput(), { target: { value: "Mars/Olympus_Mons" } });
      fireEvent.click(saveButton());
      expect(await screen.findByText(/Enter a valid IANA time zone/)).toBeInTheDocument();
      expect(props.saveSettings).not.toHaveBeenCalled();
    });

    it("unsupported channels are not selectable and are labeled; unknown channels are listed as unknown", async () => {
      renderForm({ loadSettings: async () => makeDigestSettings({ supportedChannels: ["in-app", "sms"] }) });
      await ready();
      expect(screen.getByRole("radio", { name: /in-app inbox/i })).toBeEnabled();
      expect(screen.getByRole("radio", { name: /webhook \(not supported by this server\)/i })).toBeDisabled();
      expect(screen.getByRole("radio", { name: /sms \(unknown channel, not selectable\)/i })).toBeDisabled();
    });

    it("a saved channel the server no longer supports blocks saving with an explicit error", async () => {
      const props = renderForm({ loadSettings: async () => makeDigestSettings({ channel: "webhook" }) });
      await ready();
      fireEvent.click(saveButton());
      expect(await screen.findByText(/Choose a delivery channel this server supports/)).toBeInTheDocument();
      expect(props.saveSettings).not.toHaveBeenCalled();
    });

    it.each([
      ["an unsupported version", { ...makeDigestSettings(), schemaVersion: 2 }, /format this app does not support/],
      ["malformed settings", { schemaVersion: 1 }, /malformed notification settings/],
    ])("fails closed on %s", async (_label, raw, text) => {
      renderForm({ loadSettings: async () => raw });
      expect(await screen.findByRole("alert")).toHaveTextContent(text);
      expect(screen.queryByRole("button", { name: "Save digest settings" })).not.toBeInTheDocument();
    });

    it("a failed save keeps the user's changes and says nothing was saved", async () => {
      renderForm({ saveSettings: async () => { throw new TypeError("Failed to fetch"); } });
      await ready();
      fireEvent.change(zoneInput(), { target: { value: "Asia/Tokyo" } });
      fireEvent.click(saveButton());
      await waitFor(() => expect(status()).toHaveTextContent(/could not be saved\. Your changes are still here/));
      expect(zoneInput()).toHaveValue("Asia/Tokyo");
    });
  });

  describe("authorization", () => {
    it("requires sign-in without loading anything", () => {
      const props = renderForm({ viewerUserId: null });
      expect(screen.getByRole("alert")).toHaveTextContent(/sign in/i);
      expect(props.loadSettings).not.toHaveBeenCalled();
    });

    it.each([
      [401, /sign in/i],
      [403, /do not have permission/i],
    ])("renders an explicit state for a %s on load", async (status, text) => {
      renderForm({ loadSettings: async () => { throw new ApiError({ status, message: "synthetic" }); } });
      expect(await screen.findByRole("alert")).toHaveTextContent(text);
    });

    it("users only edit their own settings: another user's settings are discarded", async () => {
      renderForm({ loadSettings: async () => makeDigestSettings({ userId: OTHER_SYNTHETIC_USER_ID }) });
      expect(await screen.findByRole("alert")).toHaveTextContent(/different account/);
    });

    it("a 403 on save reports that nothing was saved", async () => {
      renderForm({ saveSettings: async () => { throw new ApiError({ status: 403, message: "synthetic" }); } });
      await ready();
      fireEvent.click(saveButton());
      await waitFor(() => expect(status()).toHaveTextContent(/do not have permission.*Nothing was saved/));
    });
  });

  describe("concurrency: optimistic version and 409", () => {
    it("on 409 it reloads the latest settings, shows the conflicting fields and never auto-resubmits", async () => {
      const latest = makeDigestSettings({ version: 4, timeZone: "America/New_York" });
      const save = jest.fn(async () => {
        throw new ApiConflictError(latest);
      });
      renderForm({ saveSettings: save });
      await ready();

      fireEvent.change(zoneInput(), { target: { value: "Asia/Tokyo" } });
      fireEvent.click(saveButton());

      const conflict = await screen.findByTestId("digest-conflict");
      expect(conflict).toHaveTextContent(/differ from the latest saved settings in: Time zone/);
      expect(status()).toHaveTextContent(/changed elsewhere\. Nothing was saved/);
      expect(zoneInput()).toHaveValue("Asia/Tokyo");
      expect(save).toHaveBeenCalledTimes(1);
    });

    it("'Use the saved settings' replaces the draft with the latest server values", async () => {
      renderForm({ saveSettings: async () => { throw new ApiConflictError(makeDigestSettings({ version: 4, timeZone: "America/New_York" })); } });
      await ready();
      fireEvent.change(zoneInput(), { target: { value: "Asia/Tokyo" } });
      fireEvent.click(saveButton());
      fireEvent.click(await screen.findByRole("button", { name: "Use the saved settings" }));
      expect(zoneInput()).toHaveValue("America/New_York");
    });

    it("'Keep my changes' then Save sends the user's values with the NEW version", async () => {
      const save = jest
        .fn()
        .mockRejectedValueOnce(new ApiConflictError(makeDigestSettings({ version: 4 })))
        .mockImplementationOnce(async (update) => makeDigestSettings({ ...update, version: 5 }));
      renderForm({ saveSettings: save });
      await ready();
      fireEvent.change(zoneInput(), { target: { value: "Asia/Tokyo" } });
      fireEvent.click(saveButton());
      fireEvent.click(await screen.findByRole("button", { name: "Keep my changes" }));
      fireEvent.click(saveButton());

      await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
      expect(save.mock.calls[1][0]).toMatchObject({ version: 4, timeZone: "Asia/Tokyo" });
    });

    it("a plain 409 without a body reloads from the server", async () => {
      const load = jest
        .fn()
        .mockResolvedValueOnce(makeDigestSettings())
        .mockResolvedValueOnce(makeDigestSettings({ version: 9, frequency: "off" }));
      renderForm({ loadSettings: load, saveSettings: async () => { throw new ApiError({ status: 409, message: "synthetic" }); } });
      await ready();
      fireEvent.click(saveButton());
      expect(await screen.findByTestId("digest-conflict")).toHaveTextContent(/Frequency/);
      expect(load).toHaveBeenCalledTimes(2);
    });

    it("boundary: edits (including the time zone) are locked while a save is pending", async () => {
      let resolveSave: (value: unknown) => void = () => undefined;
      renderForm({ saveSettings: () => new Promise((resolve) => { resolveSave = resolve; }) });
      await ready();
      fireEvent.click(saveButton());

      expect(zoneInput()).toBeDisabled();
      expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
      await act(async () => {
        resolveSave(makeDigestSettings({ version: 4 }));
      });
      expect(zoneInput()).toBeEnabled();
    });
  });

  describe("preview and boundaries", () => {
    it("shows synthetic, redacted sample content and the next delivery in the chosen zone", async () => {
      renderForm();
      await ready();
      const preview = screen.getByTestId("digest-preview");
      expect(preview).toHaveTextContent(/synthetic sample, redacted/);
      expect(preview).toHaveTextContent(/An API key ending in ••••0000 was created\./);
      expect(preview).toHaveTextContent(/Next digest: .*UTC/);
      expect(preview.textContent).not.toMatch(/user-synthetic|[0-9a-f]{16,}|@/);
    });

    it("a pending time zone change previews the new zone and shows what is currently scheduled", async () => {
      renderForm();
      await ready();
      fireEvent.change(zoneInput(), { target: { value: "Asia/Tokyo" } });
      const preview = screen.getByTestId("digest-preview");
      expect(preview).toHaveTextContent(/Next digest: .*GMT\+9/);
      expect(preview).toHaveTextContent(/Unsaved change\. Currently scheduled: Next digest: .*UTC/);
    });

    it("explains a skipped DST hour in the preview", async () => {
      renderForm({
        now: () => Date.UTC(2026, 2, 8, 5, 0),
        loadSettings: async () => makeDigestSettings({ timeZone: "America/New_York", deliveryTime: "02:30" }),
      });
      await ready();
      expect(screen.getByTestId("digest-preview")).toHaveTextContent(/does not exist that day \(clocks go forward\)/);
    });

    it("explains a repeated DST hour in the preview", async () => {
      renderForm({
        now: () => Date.UTC(2026, 10, 1, 4, 0),
        loadSettings: async () => makeDigestSettings({ timeZone: "America/New_York", deliveryTime: "01:30" }),
      });
      await ready();
      expect(screen.getByTestId("digest-preview")).toHaveTextContent(/occurs twice that day \(clocks go back\)/);
    });

    it("digest off means everything is sent immediately", async () => {
      renderForm();
      await ready();
      fireEvent.click(screen.getByRole("radio", { name: /off/i }));
      expect(screen.getByTestId("digest-preview")).toHaveTextContent(/every security notice is sent immediately/);
    });
  });
});
