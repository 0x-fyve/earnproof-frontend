"use client";

/**
 * Signed webhook payload replay debugger (#250).
 *
 * Lets a developer send a SYNTHETIC, freshly-signed test delivery to one of
 * their configured webhook endpoints, to validate their receiver without
 * touching any real stored delivery or the real `replayWebhookDelivery` path
 * (see lib/webhooks/synthetic-delivery.ts for the structural separation
 * guarantee). Every synthetic request also carries the real signing secret
 * only in memory, for computing the HMAC — the secret itself is never
 * rendered here.
 *
 * Authorization: gated the same way components/webhooks/webhook-management.tsx
 * gates webhook management (DEVELOPER/ADMIN role from the stored session),
 * since this debugger uses the same real secrets and endpoints that page
 * manages and should not be reachable by anyone who couldn't already see them.
 *
 * Disabled endpoints: still selectable (matching webhook-list.tsx, which
 * lets a DISABLED webhook be re-enabled/acted on rather than hiding it), but
 * flagged with a visible warning, since a disabled endpoint's receiver may
 * not expect traffic right now and a developer intentionally testing a
 * not-yet-enabled endpoint is a legitimate use case.
 */

import { useCallback, useId, useMemo, useState } from "react";
import type { Webhook } from "@/lib/api/webhooks";
import {
  SYNTHETIC_EVENT_TYPES,
  buildSyntheticPayload,
  generateSyntheticRequestId,
  sendSyntheticWebhookDelivery,
  type SyntheticDeliveryResult,
  type SyntheticEventType,
} from "@/lib/webhooks/synthetic-delivery";
import { useAnnounce } from "@/lib/a11y/announcer-context";

type SessionRole = "DEVELOPER" | "ADMIN" | string;

export function WebhookReplayDebugger({
  webhooks,
  secretsByWebhookId,
  userRole,
}: {
  webhooks: Webhook[];
  /** Real signing secrets, keyed by webhook id, held only in the parent's
   * memory for exactly as long as needed to compute a signature. Never
   * logged or rendered by this component. */
  secretsByWebhookId: Record<string, string>;
  userRole: SessionRole | null;
}) {
  const [eventType, setEventType] = useState<SyntheticEventType>(SYNTHETIC_EVENT_TYPES[0]);
  const [webhookId, setWebhookId] = useState<string>(webhooks[0]?.id ?? "");
  const [requestId, setRequestId] = useState<string>(() => generateSyntheticRequestId());
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SyntheticDeliveryResult | null>(null);
  const { announce } = useAnnounce();

  const headingId = useId();
  const warningId = useId();

  const selectedWebhook = useMemo(
    () => webhooks.find((webhook) => webhook.id === webhookId) ?? null,
    [webhooks, webhookId],
  );

  const previewPayload = useMemo(
    () => buildSyntheticPayload(eventType, requestId),
    [eventType, requestId],
  );

  const isAuthorized = userRole === "DEVELOPER" || userRole === "ADMIN";

  const handleNewRequestId = useCallback(() => {
    setRequestId(generateSyntheticRequestId());
    setResult(null);
  }, []);

  const handleSend = useCallback(async () => {
    if (!selectedWebhook) return;
    const secret = secretsByWebhookId[selectedWebhook.id];
    if (!secret) {
      announce("No signing secret available for this endpoint.", {
        politeness: "assertive",
        source: "webhook-replay-debugger",
      });
      return;
    }

    setSending(true);
    setResult(null);
    announce("Sending synthetic test delivery.", { source: "webhook-replay-debugger" });

    try {
      const outcome = await sendSyntheticWebhookDelivery({
        endpointUrl: selectedWebhook.url,
        secret,
        eventType,
        requestId,
      });
      setResult(outcome);

      if (outcome.timedOut) {
        announce("Synthetic test delivery timed out.", {
          politeness: "assertive",
          source: "webhook-replay-debugger",
        });
      } else if (outcome.ok) {
        announce(`Synthetic test delivery succeeded with status ${outcome.statusCode}.`, {
          source: "webhook-replay-debugger",
        });
      } else {
        announce(
          `Synthetic test delivery failed${outcome.statusCode ? ` with status ${outcome.statusCode}` : ""}.`,
          { politeness: "assertive", source: "webhook-replay-debugger" },
        );
      }
    } finally {
      setSending(false);
    }
  }, [announce, eventType, requestId, secretsByWebhookId, selectedWebhook]);

  if (!isAuthorized) {
    return (
      <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-5">
        <h2 className="text-xl font-semibold text-amber-100">Access Restricted</h2>
        <p className="mt-2 text-sm leading-6 text-amber-200">
          The webhook replay debugger requires developer role access. Contact your administrator
          if you need access to developer tools.
        </p>
      </div>
    );
  }

  return (
    <section
      className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5"
      aria-labelledby={headingId}
    >
      <div>
        <h2 id={headingId} className="text-xl font-semibold text-white">
          Webhook Replay Debugger
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Sends a <strong>synthetic test delivery</strong> — a fabricated, freshly-signed payload —
          directly to a configured endpoint. This never resends or replays a real event; it never
          touches any stored delivery.
        </p>
      </div>

      <div
        role="note"
        className="rounded-md border border-cyan-300/30 bg-cyan-300/10 p-3 text-xs text-cyan-100"
      >
        Synthetic test delivery only — not a resend of a real event. The payload below is
        fabricated for this test and signed fresh; no production data is sent.
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="replay-debugger-event" className="block text-xs font-medium text-slate-300 mb-1">
            Event type
          </label>
          <select
            id="replay-debugger-event"
            value={eventType}
            onChange={(event) => {
              setEventType(event.target.value as SyntheticEventType);
              setResult(null);
            }}
            className="h-9 w-full rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-white"
          >
            {SYNTHETIC_EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="replay-debugger-endpoint" className="block text-xs font-medium text-slate-300 mb-1">
            Target endpoint
          </label>
          <select
            id="replay-debugger-endpoint"
            value={webhookId}
            onChange={(event) => {
              setWebhookId(event.target.value);
              setResult(null);
            }}
            className="h-9 w-full rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-white"
            aria-describedby={
              selectedWebhook && selectedWebhook.status === "DISABLED" ? warningId : undefined
            }
          >
            {webhooks.map((webhook) => (
              <option key={webhook.id} value={webhook.id}>
                {webhook.url} {webhook.status === "DISABLED" ? "(disabled)" : ""}
              </option>
            ))}
          </select>
          {selectedWebhook && selectedWebhook.status === "DISABLED" && (
            <p id={warningId} className="mt-1 text-xs text-amber-300" role="alert">
              This endpoint is disabled. The synthetic delivery will still be sent, but the
              receiver may not expect traffic right now.
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-300">Synthetic payload preview</h3>
          <button
            type="button"
            onClick={handleNewRequestId}
            className="h-8 rounded-md border border-white/15 px-3 text-xs font-semibold text-white hover:bg-white/[0.08] transition"
          >
            New request ID
          </button>
        </div>
        <pre className="max-h-64 overflow-auto rounded-md border border-white/10 bg-slate-950 p-3 text-xs text-slate-300">
          {JSON.stringify(previewPayload, null, 2)}
        </pre>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-400">
          <dt className="font-semibold text-slate-300">Request ID</dt>
          <dd className="font-mono">{requestId}</dd>
          <dt className="font-semibold text-slate-300">Signature scheme</dt>
          <dd>HMAC-SHA256, version v1 (header: X-Webhook-Signature)</dd>
          <dt className="font-semibold text-slate-300">Signing secret</dt>
          <dd>Used in memory to sign this request — never displayed.</dd>
        </dl>
      </div>

      <div>
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !selectedWebhook}
          className="h-10 rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-50"
        >
          {sending ? "Sending synthetic delivery..." : "Send synthetic test delivery"}
        </button>
      </div>

      {result && (
        <div
          className={`rounded-md border p-3 text-xs ${
            result.ok
              ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
              : "border-rose-300/30 bg-rose-300/10 text-rose-200"
          }`}
          role="status"
        >
          <div className="grid gap-1">
            <div>
              <span className="font-semibold">Request ID:</span> <span className="font-mono">{result.requestId}</span>
            </div>
            <div>
              <span className="font-semibold">Status:</span>{" "}
              {result.timedOut ? "Timed out" : (result.statusCode ?? "No response")}
            </div>
            <div>
              <span className="font-semibold">Duration:</span> {result.durationMs}ms
            </div>
            {result.errorMessage && (
              <div>
                <span className="font-semibold">Error:</span> {result.errorMessage}
              </div>
            )}
            {result.responseBodyPreview && (
              <div>
                <span className="font-semibold">Response body (sanitized):</span>
                <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-white/10 bg-slate-950 p-2 text-slate-300">
                  {result.responseBodyPreview}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
