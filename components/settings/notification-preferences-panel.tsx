"use client";

/**
 * Security notification preferences panel (#223).
 *
 * Category + channel controls for session/key/webhook/proof/governance
 * events. Mandatory categories/channels are rendered as disabled,
 * explained checkboxes rather than hidden, so the user can see *why* a
 * control can't be changed. A "preview" always shows the merged effective
 * set (lib/api/notification-preferences.ts's resolveAllEffectivePreferences)
 * before saving.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  NOTIFICATION_CHANNELS,
  applyPreferencesUpdate,
  describePreferencesChange,
  resolveAllEffectivePreferences,
  fetchMockNotificationPreferences,
  fetchMockOrganizationNotificationPolicy,
  type NotificationCategory,
  type NotificationChannel,
  type OrganizationNotificationPolicy,
  type UserNotificationPreferences,
} from "@/lib/api/notification-preferences";

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  SESSION: "Session activity",
  KEY: "Key lifecycle",
  WEBHOOK: "Webhook delivery",
  PROOF: "Proof events",
  GOVERNANCE: "Governance actions",
};

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  EMAIL: "Email",
  IN_APP: "In-app",
  WEBHOOK_CALLBACK: "Webhook callback",
};

export interface NotificationPreferencesPanelProps {
  user: UserNotificationPreferences;
  org: OrganizationNotificationPolicy;
  onSave: (next: UserNotificationPreferences) => Promise<void> | void;
}

export function NotificationPreferencesPanel({ user, org, onSave }: NotificationPreferencesPanelProps) {
  const [draft, setDraft] = useState<UserNotificationPreferences>(user);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);

  const effective = useMemo(() => resolveAllEffectivePreferences(draft, org), [draft, org]);
  const changeSummary = useMemo(() => describePreferencesChange(user, draft), [user, draft]);

  const toggleChannel = useCallback(
    (category: NotificationCategory, channel: NotificationChannel) => {
      setDraft((prev) => ({
        ...prev,
        categories: prev.categories.map((entry) =>
          entry.category === category
            ? { ...entry, channels: { ...entry.channels, [channel]: !entry.channels[channel] } }
            : entry,
        ),
      }));
    },
    [],
  );

  const handleSave = useCallback(async () => {
    setError(null);
    const outcome = applyPreferencesUpdate({
      current: user,
      draft,
      expectedVersion: user.preferencesVersion,
    });

    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }

    setSaving(true);
    try {
      await onSave(outcome.preferences);
      setConfirmedAt(new Date().toISOString());
    } catch {
      setError("Could not save your preferences. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [draft, user, onSave]);

  return (
    <div className="grid gap-6">
      <section aria-labelledby="notification-prefs-heading" className="grid gap-4">
        <h2 id="notification-prefs-heading" className="text-xl font-semibold text-white">
          Notification categories
        </h2>

        {effective.map((entry) => {
          const draftEntry = draft.categories.find((c) => c.category === entry.category);
          return (
            <fieldset
              key={entry.category}
              className="grid gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-4"
            >
              <legend className="flex items-center gap-2 text-sm font-semibold text-white">
                {CATEGORY_LABELS[entry.category]}
                {entry.mandatory ? (
                  <span className="rounded-full bg-amber-300/10 px-2 py-0.5 text-xs font-medium text-amber-200">
                    Mandatory
                  </span>
                ) : null}
              </legend>
              {entry.mandatory ? (
                <p className="text-xs text-slate-400">
                  This category cannot be fully disabled; it protects your account or organization.
                </p>
              ) : null}

              <div className="flex flex-wrap gap-4">
                {NOTIFICATION_CHANNELS.map((channel) => {
                  const forcedOn = entry.channelSource[channel] === "org-mandatory";
                  const checked = draftEntry ? draftEntry.channels[channel] : entry.channels[channel];
                  const inputId = `${entry.category}-${channel}`;
                  return (
                    <label key={channel} htmlFor={inputId} className="flex items-center gap-2 text-sm text-slate-200">
                      <input
                        id={inputId}
                        type="checkbox"
                        checked={checked}
                        disabled={forcedOn}
                        onChange={() => toggleChannel(entry.category, channel)}
                        aria-describedby={forcedOn ? `${inputId}-note` : undefined}
                      />
                      {CHANNEL_LABELS[channel]}
                      {forcedOn ? (
                        <span id={`${inputId}-note`} className="text-xs text-slate-500">
                          (required by organization policy)
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </section>

      <section aria-labelledby="notification-preview-heading" className="grid gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-4">
        <h3 id="notification-preview-heading" className="text-sm font-semibold text-white">
          Preview of changes
        </h3>
        {changeSummary.length === 0 ? (
          <p className="text-xs text-slate-400">No changes to save.</p>
        ) : (
          <ul aria-label="Pending preference changes" className="grid gap-1 text-xs text-slate-300">
            {changeSummary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </section>

      {error ? (
        <p role="alert" className="text-sm text-rose-200">
          {error}
        </p>
      ) : null}

      {confirmedAt ? (
        <p role="status" aria-live="polite" className="text-sm text-emerald-200">
          Preferences saved.
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={saving || changeSummary.length === 0}
        className="w-fit rounded-md border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save preferences"}
      </button>
    </div>
  );
}

/**
 * Self-loading wrapper for the settings page.
 */
export function NotificationPreferencesSettingsPanel() {
  const [user, setUser] = useState<UserNotificationPreferences | null>(null);
  const [org, setOrg] = useState<OrganizationNotificationPolicy | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [loadedUser, loadedOrg] = await Promise.all([
        fetchMockNotificationPreferences(),
        fetchMockOrganizationNotificationPolicy(),
      ]);
      if (!cancelled) {
        setUser(loadedUser);
        setOrg(loadedOrg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!user || !org) {
    return (
      <div className="h-24 animate-pulse rounded-lg border border-white/10 bg-white/[0.04]" aria-hidden="true" />
    );
  }

  return (
    <NotificationPreferencesPanel
      user={user}
      org={org}
      onSave={(next) => {
        setUser(next);
      }}
    />
  );
}
