"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiConflictError } from "@/lib/api/client";
import { ApiError } from "@/lib/errors";
import { DEFAULT_LOCALE, detectBrowserTimeZone, formatDateTimeWithZone } from "@/lib/i18n";
import {
  DIGEST_CHANNEL_LABELS,
  DIGESTIBLE_SECURITY_EVENT_TYPES,
  KNOWN_DIGEST_CHANNELS,
  NOTIFICATION_DIGEST_SCHEMA_VERSION,
  SECURITY_EVENT_TYPE_LABELS,
  criticalEventTypesFor,
  isDigestibleEventType,
  parseNotificationDigestSettings,
  validateDigestSettingsUpdate,
  type DigestFrequency,
  type DigestValidationError,
  type NotificationDigestSettings,
  type NotificationDigestSettingsLoader,
  type NotificationDigestSettingsSaver,
  type NotificationDigestSettingsUpdate,
} from "@/lib/api/notification-digest-settings";
import { buildDigestPreview } from "@/lib/notifications/digest-preview";
import { nextDigestDelivery } from "@/lib/notifications/digest-schedule";

export interface DigestSettingsFormProps {
  /** Signed-in user's id; null = not signed in. Only this user's settings are ever shown or saved. */
  viewerUserId: string | null;
  loadSettings: NotificationDigestSettingsLoader;
  saveSettings: NotificationDigestSettingsSaver;
  /** Injected for tests. */
  now?: () => number;
}

type Draft = Omit<NotificationDigestSettingsUpdate, "schemaVersion" | "version">;
type LoadError = "unauthenticated" | "forbidden" | "unsupported_version" | "invalid_response" | "other_user" | "unavailable";

const LOAD_ERROR_COPY: Record<LoadError, string> = {
  unauthenticated: "Sign in to manage your security notification digest.",
  forbidden: "You do not have permission to manage these notification settings.",
  unsupported_version: "The server returned settings in a format this app does not support, so they cannot be edited here.",
  invalid_response: "The server returned malformed notification settings, so they cannot be edited here.",
  other_user: "The server returned settings for a different account, so they were discarded.",
  unavailable: "Notification settings could not be loaded.",
};

const VALIDATION_COPY: Record<DigestValidationError, string> = {
  unsupported_frequency: "Choose a supported digest frequency.",
  invalid_delivery_time: "Enter a delivery time between 00:00 and 23:59.",
  day_of_week_required: "Choose the day of the week for a weekly digest.",
  day_of_week_not_allowed: "A day of the week only applies to weekly digests.",
  invalid_time_zone: "Enter a valid IANA time zone, such as Europe/Berlin.",
  unsupported_channel: "Choose a delivery channel this server supports.",
  critical_event_in_digest: "Critical security events are always sent immediately and cannot be added to a digest.",
  unknown_event_in_digest: "Only known low-urgency event types can be added to a digest.",
  invalid_version: "These settings are out of date. Reload and try again.",
};

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const FIELD_LABELS: Record<keyof Draft, string> = {
  frequency: "Frequency",
  deliveryTime: "Delivery time",
  dayOfWeek: "Day of week",
  timeZone: "Time zone",
  channel: "Channel",
  digestEventTypes: "Digested events",
};

function draftFrom(settings: NotificationDigestSettings): Draft {
  const critical = criticalEventTypesFor(settings);
  return {
    frequency: settings.frequency,
    deliveryTime: settings.deliveryTime,
    dayOfWeek: settings.dayOfWeek,
    timeZone: settings.timeZone,
    channel: settings.channel,
    // Anything the client cannot digest safely is dropped from the editable
    // selection, so saving can only ever move it to immediate delivery.
    digestEventTypes: settings.digestEventTypes.filter((type) => isDigestibleEventType(type, critical)),
  };
}

function changedFields(draft: Draft, settings: NotificationDigestSettings): Array<keyof Draft> {
  const saved = draftFrom(settings);
  return (Object.keys(FIELD_LABELS) as Array<keyof Draft>).filter((field) =>
    field === "digestEventTypes"
      ? [...draft.digestEventTypes].sort().join(",") !== [...saved.digestEventTypes].sort().join(",")
      : draft[field] !== saved[field],
  );
}

function loadErrorFrom(error: unknown): LoadError {
  if (error instanceof ApiError && error.status === 401) return "unauthenticated";
  if (error instanceof ApiError && error.status === 403) return "forbidden";
  return "unavailable";
}

function isConflict(error: unknown): boolean {
  return error instanceof ApiConflictError || (error instanceof ApiError && error.status === 409);
}

function describeDelivery(draft: Draft, nowMs: number): string {
  if (draft.frequency === "off") return "Digest is off: every security notice is sent immediately.";
  const next = nextDigestDelivery(draft, nowMs);
  if (!next) return "Next delivery cannot be calculated until the schedule is valid.";
  const when = formatDateTimeWithZone(next.instant, DEFAULT_LOCALE, draft.timeZone);
  if (next.adjustment === "skipped_hour_shifted") {
    return "Next digest: " + when + ". The chosen time does not exist that day (clocks go forward), so it is sent after the change.";
  }
  if (next.adjustment === "repeated_hour_first") {
    return "Next digest: " + when + ". The chosen time occurs twice that day (clocks go back); it is sent once, at the first occurrence.";
  }
  return "Next digest: " + when + ".";
}

/**
 * Security notification digest scheduling (#269): frequency, IANA time zone,
 * supported channel, a redacted preview, and a locked list of critical event
 * types that are always delivered immediately.
 */
export function DigestSettingsForm({ viewerUserId, loadSettings, saveSettings, now = Date.now }: DigestSettingsFormProps) {
  const [reloadNonce, setReloadNonce] = useState(0);
  const [loaded, setLoaded] = useState<
    { key: string; settings: NotificationDigestSettings } | { key: string; error: LoadError } | null
  >(null);
  const [draft, setDraft] = useState<{ key: string; value: Draft } | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<DigestValidationError[]>([]);
  const [status, setStatus] = useState("");
  const [conflict, setConflict] = useState<Array<keyof Draft> | null>(null);
  const [nowMs, setNowMs] = useState(() => now());
  const saveControllerRef = useRef<AbortController | null>(null);
  const ids = { heading: useId(), time: useId(), zone: useId(), day: useId(), errors: useId() };
  const loadKey = (viewerUserId ?? "") + "|" + reloadNonce;

  useEffect(() => {
    if (!viewerUserId) return undefined;
    const controller = new AbortController();
    const key = loadKey;
    loadSettings(controller.signal)
      .then((raw) => {
        if (controller.signal.aborted) return;
        const parsed = parseNotificationDigestSettings(raw, viewerUserId);
        if (parsed.ok) {
          setLoaded({ key, settings: parsed.settings });
          setDraft({ key, value: draftFrom(parsed.settings) });
        } else {
          setLoaded({ key, error: parsed.reason });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoaded({ key, error: loadErrorFrom(error) });
      });
    return () => controller.abort();
  }, [loadKey, loadSettings, viewerUserId]);

  useEffect(() => {
    const interval = setInterval(() => setNowMs(now()), 60_000);
    return () => {
      clearInterval(interval);
      saveControllerRef.current?.abort();
    };
  }, [now]);

  if (!viewerUserId) {
    return (
      <section aria-labelledby={ids.heading} className="grid gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 id={ids.heading} className="text-lg font-semibold text-white">Security notification digest</h2>
        <p role="alert" className="text-sm text-slate-200">{LOAD_ERROR_COPY.unauthenticated}</p>
      </section>
    );
  }

  const current = loaded && loaded.key === loadKey ? loaded : null;
  if (!current) {
    return (
      <section aria-labelledby={ids.heading} aria-busy="true" className="grid gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 id={ids.heading} className="text-lg font-semibold text-white">Security notification digest</h2>
        <p role="status" className="text-sm text-slate-300">Loading notification settings…</p>
      </section>
    );
  }
  if ("error" in current) {
    return (
      <section aria-labelledby={ids.heading} className="grid gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 id={ids.heading} className="text-lg font-semibold text-white">Security notification digest</h2>
        <div role="alert" className="grid gap-2 rounded-lg border border-rose-300/30 bg-rose-300/10 p-3">
          <p className="text-sm text-rose-100">{LOAD_ERROR_COPY[current.error]}</p>
          {current.error === "unavailable" ? (
            <div>
              <button type="button" onClick={() => setReloadNonce((value) => value + 1)} className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-white hover:bg-white/10">
                Retry
              </button>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  const settings = current.settings;
  const value = draft && draft.key === loadKey ? draft.value : draftFrom(settings);
  const critical = criticalEventTypesFor(settings);
  const digestible = DIGESTIBLE_SECURITY_EVENT_TYPES.filter((type) => isDigestibleEventType(type, critical));
  const droppedFromServer = settings.digestEventTypes.filter((type) => !isDigestibleEventType(type, critical));
  const unknownChannels = settings.supportedChannels.filter(
    (channel) => !(KNOWN_DIGEST_CHANNELS as readonly string[]).includes(channel),
  );
  const savedDescription = describeDelivery(draftFrom(settings), nowMs);
  const draftDescription = describeDelivery(value, nowMs);
  const dirty = changedFields(value, settings).length > 0;

  const update = (patch: Partial<Draft>) => {
    setErrors([]);
    setStatus("");
    setDraft({ key: loadKey, value: { ...value, ...patch } });
  };

  function adoptServer(next: NotificationDigestSettings) {
    setLoaded({ key: loadKey, settings: next });
  }

  async function handleConflict(error: unknown, mine: Draft) {
    let latest: NotificationDigestSettings | null = null;
    if (error instanceof ApiConflictError) {
      const parsed = parseNotificationDigestSettings(error.serverEntity, viewerUserId as string);
      if (parsed.ok) latest = parsed.settings;
    }
    if (!latest) {
      try {
        const parsed = parseNotificationDigestSettings(await loadSettings(new AbortController().signal), viewerUserId as string);
        if (parsed.ok) latest = parsed.settings;
      } catch {
        latest = null;
      }
    }
    if (!latest) {
      setStatus("These settings were changed elsewhere and could not be reloaded. Nothing was saved. Retry to reload them.");
      return;
    }
    adoptServer(latest);
    setDraft({ key: loadKey, value: mine });
    setConflict(changedFields(mine, latest));
    setStatus("These settings were changed elsewhere. Nothing was saved. Review the differences below.");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const payload: NotificationDigestSettingsUpdate = {
      schemaVersion: NOTIFICATION_DIGEST_SCHEMA_VERSION,
      version: settings.version,
      ...value,
      dayOfWeek: value.frequency === "weekly" ? value.dayOfWeek : null,
    };
    const problems = validateDigestSettingsUpdate(payload, {
      supportedChannels: settings.supportedChannels,
      criticalEventTypes: critical,
    });
    if (problems.length > 0) {
      setErrors(problems);
      setStatus("Settings were not saved. Fix the problems listed.");
      return;
    }

    const controller = new AbortController();
    saveControllerRef.current = controller;
    setSaving(true);
    setStatus("Saving…");
    setConflict(null);
    try {
      const raw = await saveSettings(payload, controller.signal);
      if (controller.signal.aborted) return;
      const parsed = parseNotificationDigestSettings(raw, viewerUserId as string);
      if (!parsed.ok) {
        setStatus("The server's response could not be verified. Reload to see the saved settings.");
        return;
      }
      adoptServer(parsed.settings);
      setDraft({ key: loadKey, value: draftFrom(parsed.settings) });
      setStatus("Notification digest settings saved.");
    } catch (error) {
      if (controller.signal.aborted) return;
      if (isConflict(error)) {
        await handleConflict(error, value);
      } else if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setStatus(LOAD_ERROR_COPY[error.status === 401 ? "unauthenticated" : "forbidden"] + " Nothing was saved.");
      } else {
        setStatus("Settings could not be saved. Your changes are still here; try again.");
      }
    } finally {
      if (saveControllerRef.current === controller) saveControllerRef.current = null;
      setSaving(false);
    }
  }

  const preview = buildDigestPreview(value.digestEventTypes);

  return (
    <section aria-labelledby={ids.heading} className="grid gap-5 rounded-lg border border-white/10 bg-white/[0.04] p-5">
      <h2 id={ids.heading} className="text-lg font-semibold text-white">Security notification digest</h2>
      <p className="text-sm text-slate-300">
        Group low-urgency security notices into a scheduled digest. Critical security events are always sent immediately.
      </p>

      <p role="status" aria-live="polite" className="text-sm text-slate-200" data-testid="digest-status">{status}</p>

      {conflict ? (
        <div role="alert" className="grid gap-2 rounded-lg border border-amber-300/30 bg-amber-300/10 p-3" data-testid="digest-conflict">
          <p className="text-sm font-semibold text-white">Settings changed elsewhere</p>
          <p className="text-sm text-slate-200">
            {conflict.length === 0
              ? "The saved settings already match your changes."
              : "Your unsaved changes differ from the latest saved settings in: " + conflict.map((field) => FIELD_LABELS[field]).join(", ") + "."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setDraft({ key: loadKey, value: draftFrom(settings) }); setConflict(null); setStatus("Showing the latest saved settings."); }} className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-white hover:bg-white/10">
              Use the saved settings
            </button>
            <button type="button" onClick={() => { setConflict(null); setStatus("Your changes are kept. Save again to apply them over the latest settings."); }} className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-white hover:bg-white/10">
              Keep my changes
            </button>
          </div>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate aria-describedby={errors.length > 0 ? ids.errors : undefined}>
        <fieldset disabled={saving} className="grid gap-5">
          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold text-white">Frequency</legend>
            {(["off", "daily", "weekly"] as DigestFrequency[]).map((frequency) => (
              <label key={frequency} className="flex items-center gap-2 text-sm text-slate-200">
                <input type="radio" name="frequency" value={frequency} checked={value.frequency === frequency} onChange={() => update({ frequency, dayOfWeek: frequency === "weekly" ? (value.dayOfWeek ?? 1) : null })} />
                {frequency === "off" ? "Off (send everything immediately)" : frequency === "daily" ? "Daily" : "Weekly"}
              </label>
            ))}
          </fieldset>

          {value.frequency !== "off" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1">
                <label htmlFor={ids.time} className="text-sm font-semibold text-white">Delivery time</label>
                <input id={ids.time} type="time" step={60} value={value.deliveryTime} onChange={(event) => update({ deliveryTime: event.target.value })} className="h-10 rounded-md border border-white/15 bg-slate-950 px-3 text-sm text-white" />
              </div>
              {value.frequency === "weekly" ? (
                <div className="grid gap-1">
                  <label htmlFor={ids.day} className="text-sm font-semibold text-white">Day of week</label>
                  <select id={ids.day} value={value.dayOfWeek ?? ""} onChange={(event) => update({ dayOfWeek: Number(event.target.value) })} className="h-10 rounded-md border border-white/15 bg-slate-950 px-3 text-sm text-white">
                    {WEEKDAYS.map((day, index) => (
                      <option key={day} value={index + 1}>{day}</option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-1">
            <label htmlFor={ids.zone} className="text-sm font-semibold text-white">Time zone (IANA)</label>
            <div className="flex flex-wrap gap-2">
              <input id={ids.zone} value={value.timeZone} onChange={(event) => update({ timeZone: event.target.value })} autoComplete="off" spellCheck={false} className="h-10 min-w-0 flex-1 rounded-md border border-white/15 bg-slate-950 px-3 text-sm text-white" />
              <button type="button" onClick={() => { const detected = detectBrowserTimeZone(); if (detected) update({ timeZone: detected }); }} className="h-10 rounded-md border border-white/15 px-3 text-sm text-white hover:bg-white/10">
                Use this device&apos;s time zone
              </button>
            </div>
          </div>

          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold text-white">Channel</legend>
            {KNOWN_DIGEST_CHANNELS.map((channel) => {
              const supported = settings.supportedChannels.includes(channel);
              return (
                <label key={channel} className="flex items-center gap-2 text-sm text-slate-200">
                  <input type="radio" name="channel" value={channel} checked={value.channel === channel} disabled={!supported} onChange={() => update({ channel })} />
                  {DIGEST_CHANNEL_LABELS[channel]}
                  {!supported ? " (not supported by this server)" : null}
                </label>
              );
            })}
            {unknownChannels.map((channel) => (
              <label key={channel} className="flex items-center gap-2 text-sm text-slate-400">
                <input type="radio" name="channel" value={channel} checked={false} disabled readOnly />
                {channel + " (unknown channel, not selectable)"}
              </label>
            ))}
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold text-white">Low-urgency events to include in the digest</legend>
            {digestible.map((type) => (
              <label key={type} className="flex items-center gap-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={value.digestEventTypes.includes(type)}
                  onChange={(event) =>
                    update({
                      digestEventTypes: event.target.checked
                        ? [...value.digestEventTypes, type]
                        : value.digestEventTypes.filter((selected) => selected !== type),
                    })
                  }
                />
                {SECURITY_EVENT_TYPE_LABELS[type]}
              </label>
            ))}
          </fieldset>

          <div className="grid gap-2 rounded-lg border border-white/10 p-3" aria-labelledby={ids.heading + "-critical"} role="group">
            <h3 id={ids.heading + "-critical"} className="text-sm font-semibold text-white">
              <span aria-hidden="true">🔒 </span>Always sent immediately
            </h3>
            <p className="text-xs text-slate-400">
              Critical security events are never delayed by these settings and cannot be added to a digest.
            </p>
            <ul className="grid gap-1" aria-label="Critical event types, always immediate">
              {critical.map((type) => (
                <li key={type} className="text-sm text-slate-200">
                  {(SECURITY_EVENT_TYPE_LABELS[type] ?? type) + " (locked, immediate)"}
                </li>
              ))}
            </ul>
            {droppedFromServer.length > 0 ? (
              <p className="text-xs text-amber-200">
                {"These event types were in your saved digest but will be sent immediately instead: " +
                  droppedFromServer.map((type) => SECURITY_EVENT_TYPE_LABELS[type] ?? type).join(", ") + "."}
              </p>
            ) : null}
          </div>

          <div className="grid gap-2 rounded-lg border border-white/10 p-3" data-testid="digest-preview">
            <h3 className="text-sm font-semibold text-white">Preview (synthetic sample, redacted)</h3>
            <p className="text-sm text-slate-200">{draftDescription}</p>
            {dirty && draftDescription !== savedDescription ? (
              <p className="text-xs text-slate-400">{"Unsaved change. Currently scheduled: " + savedDescription}</p>
            ) : null}
            {value.frequency !== "off" ? (
              preview.length > 0 ? (
                <ul className="grid gap-1" aria-label="Sample digest entries">
                  {preview.map((item) => (
                    <li key={item.type} className="text-sm text-slate-300">
                      <span className="font-semibold text-slate-100">{item.label}: </span>
                      {item.sample}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-300">No event types selected: the digest would be empty.</p>
              )
            ) : null}
          </div>

          {errors.length > 0 ? (
            <ul id={ids.errors} role="alert" className="grid gap-1 rounded-lg border border-rose-300/30 bg-rose-300/10 p-3">
              {errors.map((error) => (
                <li key={error} className="text-sm text-rose-100">{VALIDATION_COPY[error]}</li>
              ))}
            </ul>
          ) : null}

          <div>
            <button type="submit" className="h-10 rounded-md border border-white/15 px-4 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-50">
              {saving ? "Saving…" : "Save digest settings"}
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
