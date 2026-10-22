"use client";

import { useCallback, useState } from "react";
import type { ApiKey } from "@/lib/api/generated/v1";
import {
  endKeyOverlapEarly,
  startKeyOverlapRotation,
  type ApiKeyOverlap,
} from "@/lib/api/keys";
import { OneTimeSecret } from "./one-time-secret";
import { Timestamp } from "@/components/common/timestamp";
import { RecentAuthGate } from "@/components/common/recent-auth-gate";
import { ConfirmationDialog } from "@/components/common/confirmation-dialog";
import type { UseRecentAuthResult } from "@/lib/auth/recent-auth";

const OVERLAP_HOUR_OPTIONS = [24, 72, 168] as const; // 1 day, 3 days, 7 days

/**
 * Guided overlap rotation workflow (#239): starting rotation keeps the old
 * key alive until `overlapDeadline` instead of invalidating it immediately
 * (contrast with the plain `rotateApiKey` flow in api-key-list.tsx), so
 * integrations have a real migration window. The old key's state is always
 * shown alongside the new one so there is never ambiguity about which key
 * is which or whether the old one still works.
 */
export function KeyOverlapRotationDialog({
  apiKey,
  token,
  recentAuth,
  onClose,
  onOverlapStarted,
}: {
  apiKey: ApiKey;
  token: string;
  recentAuth: UseRecentAuthResult;
  onClose: () => void;
  onOverlapStarted: (overlap: ApiKeyOverlap) => void;
}) {
  const [overlapHours, setOverlapHours] = useState<number>(OVERLAP_HOUR_OPTIONS[1]);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<{ overlap: ApiKeyOverlap; secret: string } | null>(
    null,
  );

  const handleStart = useCallback(async () => {
    setIsStarting(true);
    setError(null);
    try {
      const controller = new AbortController();
      const response = await startKeyOverlapRotation(
        token,
        apiKey.id,
        overlapHours,
        controller.signal,
      );
      setStarted(response);
      onOverlapStarted(response.overlap);
    } catch {
      setError("Failed to start overlap rotation. Please try again.");
    } finally {
      setIsStarting(false);
    }
  }, [token, apiKey.id, overlapHours, onOverlapStarted]);

  if (started) {
    return (
      <div className="grid gap-4">
        <OneTimeSecret
          apiKey={started.overlap.newApiKey}
          secret={started.secret}
          onDismiss={onClose}
        />
        <p className="text-xs text-slate-400" role="status">
          The old key (<code>{apiKey.prefix}</code>) remains active until{" "}
          <Timestamp value={started.overlap.overlapDeadline} />. After that it will stop
          working automatically.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border border-white/10 bg-white/[0.04] p-5"
      role="dialog"
      aria-labelledby="overlap-rotation-heading"
    >
      <h2 id="overlap-rotation-heading" className="text-lg font-semibold text-slate-100">
        Start overlap rotation for &quot;{apiKey.name}&quot;
      </h2>
      <p className="mt-1 text-sm text-slate-300">
        A new key is issued immediately. The current key (<code>{apiKey.prefix}</code>)
        keeps working until the overlap deadline you choose below, so you have time to
        update every integration before it stops accepting requests.
      </p>

      <fieldset className="mt-4">
        <legend className="text-xs font-semibold text-slate-200">Overlap window</legend>
        <div className="mt-2 flex gap-2">
          {OVERLAP_HOUR_OPTIONS.map((hours) => (
            <button
              key={hours}
              type="button"
              onClick={() => setOverlapHours(hours)}
              aria-pressed={overlapHours === hours}
              className={`h-9 rounded-md border px-3 text-xs font-semibold transition ${
                overlapHours === hours
                  ? "border-emerald-300/60 bg-emerald-300/20 text-emerald-100"
                  : "border-white/10 text-slate-300 hover:bg-white/5"
              }`}
            >
              {hours === 24 ? "1 day" : hours === 168 ? "7 days" : `${hours / 24} days`}
            </button>
          ))}
        </div>
      </fieldset>

      {error && (
        <p className="mt-3 text-xs text-rose-300" role="alert">
          {error}
        </p>
      )}

      {recentAuth.isPromptOpen ? (
        <div className="mt-4">
          <RecentAuthGate
            recentAuth={recentAuth}
            actionDescription={`Start overlap rotation for "${apiKey.name}"`}
          />
        </div>
      ) : (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => recentAuth.requestRecentAuth(handleStart)}
            disabled={isStarting}
            className="h-10 rounded-md border border-emerald-300/30 bg-emerald-300 px-4 text-xs font-semibold text-slate-950 hover:bg-emerald-200 transition disabled:opacity-50"
          >
            {isStarting ? "Starting..." : "Start overlap rotation"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-md border border-white/10 px-4 text-xs font-semibold text-slate-300 hover:bg-white/5 transition"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Status panel for a key that has an active or past overlap rotation.
 * Shown inline wherever the key is listed; makes old/new state and the
 * cutover deadline unambiguous, and offers "end overlap early" gated by
 * recent auth. Expired/ended overlaps show as read-only history — the
 * client never offers to extend or restart a window that the server has
 * already closed.
 */
export function KeyOverlapStatusPanel({
  overlap,
  token,
  recentAuth,
  onOverlapUpdated,
}: {
  overlap: ApiKeyOverlap;
  token: string;
  recentAuth: UseRecentAuthResult;
  onOverlapUpdated: (overlap: ApiKeyOverlap) => void;
}) {
  const [isEnding, setIsEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEndEarly, setConfirmEndEarly] = useState(false);

  const handleEndEarly = useCallback(async () => {
    setIsEnding(true);
    setError(null);
    try {
      const controller = new AbortController();
      const updated = await endKeyOverlapEarly(token, overlap.oldKeyId, controller.signal);
      onOverlapUpdated(updated);
    } catch {
      setError(
        "Failed to end the overlap window. It may have already expired or ended elsewhere.",
      );
    } finally {
      setIsEnding(false);
      setConfirmEndEarly(false);
    }
  }, [token, overlap.oldKeyId, onOverlapUpdated]);

  const isActive = overlap.status === "active";

  return (
    <div
      className="rounded-md border border-white/10 bg-white/[0.03] p-4 text-sm"
      data-testid="key-overlap-status-panel"
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-100">
          Overlap rotation —{" "}
          <span
            className={
              isActive
                ? "text-amber-300"
                : overlap.status === "ended"
                  ? "text-emerald-300"
                  : "text-slate-400"
            }
          >
            {overlap.status === "active"
              ? "In progress"
              : overlap.status === "ended"
                ? "Ended early"
                : "Expired"}
          </span>
        </span>
      </div>

      <dl className="mt-2 grid gap-1 text-xs text-slate-300">
        <div>
          <dt className="inline font-semibold">Old key usage: </dt>
          <dd className="inline">
            {overlap.oldKeyLastUsedAt ? (
              <>
                last used <Timestamp value={overlap.oldKeyLastUsedAt} />
              </>
            ) : (
              "not used since rotation started"
            )}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold">
            {isActive ? "Cutover deadline: " : "Deadline was: "}
          </dt>
          <dd className="inline">
            <Timestamp value={overlap.overlapDeadline} />
          </dd>
        </div>
      </dl>

      {isActive && (
        <div className="mt-3">
          {error && (
            <p className="mb-2 text-xs text-rose-300" role="alert">
              {error}
            </p>
          )}
          {recentAuth.isPromptOpen ? (
            <RecentAuthGate
              recentAuth={recentAuth}
              actionDescription="End the overlap window early"
            />
          ) : (
            <button
              type="button"
              onClick={() => setConfirmEndEarly(true)}
              disabled={isEnding}
              className="h-9 rounded-md border border-rose-300/30 px-3 text-xs font-semibold text-rose-200 hover:bg-rose-300/10 transition disabled:opacity-50"
            >
              End overlap early
            </button>
          )}
          {confirmEndEarly && (
            <ConfirmationDialog
              title="End overlap early?"
              message="The old key will stop working immediately instead of waiting for the cutover deadline. This cannot be undone."
              confirmText="End overlap now"
              confirmVariant="danger"
              onConfirm={() => {
                setConfirmEndEarly(false);
                recentAuth.requestRecentAuth(handleEndEarly);
              }}
              onCancel={() => setConfirmEndEarly(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}
