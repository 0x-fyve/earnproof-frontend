"use client";

import { useCallback, useState } from "react";
import { disableWebhook, enableWebhook, deleteWebhook, rotateWebhook, formatWebhookUrl, type Webhook } from "@/lib/api/webhooks";
import { WebhookActionMenu } from "./webhook-action-menu";
import { WebhookOwnershipVerificationStatus } from "./webhook-ownership-verification-status";

export function WebhookList({
  webhooks,
  loading,
  token,
  onWebhookUpdated,
  onWebhookDeleted,
  onWebhookRotated,
}: {
  webhooks: Webhook[];
  loading: boolean;
  token: string;
  onWebhookUpdated: (webhook: Webhook) => void;
  onWebhookDeleted: (webhookId: string) => void;
  onWebhookRotated: (webhookId: string) => void;
}) {
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [actioningIds, setActioningIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState<string | null>(null);

  const handleToggleStatus = useCallback(
    async (webhook: Webhook) => {
      setActioningIds((prev) => new Set([...prev, webhook.id]));
      setActionErrors((prev) => ({ ...prev, [webhook.id]: "" }));

      try {
        const controller = new AbortController();
        const isActive = webhook.status === "ACTIVE";
        const action = isActive ? disableWebhook : enableWebhook;
        const updated = await action(token, webhook.id, controller.signal);
        onWebhookUpdated(updated);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update webhook";
        setActionErrors((prev) => ({
          ...prev,
          [webhook.id]: message,
        }));
      } finally {
        setActioningIds((prev) => {
          const next = new Set(prev);
          next.delete(webhook.id);
          return next;
        });
      }
    },
    [token, onWebhookUpdated]
  );

  const handleRotate = useCallback(
    async (webhookId: string) => {
      setConfirmRotate(null);
      setActioningIds((prev) => new Set([...prev, webhookId]));
      setActionErrors((prev) => ({ ...prev, [webhookId]: "" }));

      try {
        const controller = new AbortController();
        await rotateWebhook(token, webhookId, controller.signal);
        onWebhookRotated(webhookId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to rotate webhook";
        setActionErrors((prev) => ({
          ...prev,
          [webhookId]: message,
        }));
      } finally {
        setActioningIds((prev) => {
          const next = new Set(prev);
          next.delete(webhookId);
          return next;
        });
      }
    },
    [token, onWebhookRotated]
  );

  const handleDelete = useCallback(
    async (webhookId: string) => {
      setConfirmDelete(null);
      setActioningIds((prev) => new Set([...prev, webhookId]));
      setActionErrors((prev) => ({ ...prev, [webhookId]: "" }));

      try {
        const controller = new AbortController();
        await deleteWebhook(token, webhookId, controller.signal);
        onWebhookDeleted(webhookId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to delete webhook";
        setActionErrors((prev) => ({
          ...prev,
          [webhookId]: message,
        }));
      } finally {
        setActioningIds((prev) => {
          const next = new Set(prev);
          next.delete(webhookId);
          return next;
        });
      }
    },
    [token, onWebhookDeleted]
  );

  if (webhooks.length === 0) {
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.02] p-6 text-center">
        <p className="text-sm text-slate-400">
          No webhook endpoints yet. Create one to start receiving events.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {webhooks.map((webhook) => {
        const isActioning = actioningIds.has(webhook.id);
        const error = actionErrors[webhook.id];
        const isConfirmingDelete = confirmDelete === webhook.id;
        const isConfirmingRotate = confirmRotate === webhook.id;

        return (
          <div
            key={webhook.id}
            className="rounded-lg border border-white/10 bg-white/[0.02] p-4 hover:bg-white/[0.03] transition"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-white truncate">
                    {formatWebhookUrl(webhook.url)}
                  </h3>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                      webhook.status === "ACTIVE"
                        ? "bg-emerald-300/20 text-emerald-200"
                        : "bg-slate-400/20 text-slate-300"
                    }`}
                  >
                    {webhook.status === "ACTIVE" ? "Active" : "Disabled"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400 truncate">
                  {webhook.url}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {webhook.events.map((event) => (
                    <span
                      key={event}
                      className="inline-flex items-center rounded-full bg-cyan-300/10 px-2 py-0.5 text-xs text-cyan-200 font-mono"
                    >
                      {event}
                    </span>
                  ))}
                </div>
              </div>

              <WebhookActionMenu
                webhook={webhook}
                isActioning={isActioning}
                onToggleStatus={handleToggleStatus}
                onRotate={() => setConfirmRotate(webhook.id)}
                onDelete={() => setConfirmDelete(webhook.id)}
              />
            </div>

            <div className="mt-3">
              <WebhookOwnershipVerificationStatus url={webhook.url} webhookId={webhook.id} />
            </div>

            {error && (
              <div className="mt-3 rounded-md border border-rose-300/30 bg-rose-300/10 p-2">
                <p className="text-xs text-rose-200" role="alert">
                  {error}
                </p>
              </div>
            )}

            {isConfirmingDelete && (
              <div className="mt-3 rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
                <p className="text-xs text-rose-200 mb-2">
                  Are you sure you want to delete this webhook? This action cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    className="h-8 rounded-md bg-rose-300 px-3 text-xs font-semibold text-slate-950 hover:bg-rose-200 transition disabled:opacity-50"
                    onClick={() => handleDelete(webhook.id)}
                    disabled={isActioning}
                    type="button"
                  >
                    {isActioning ? "Deleting..." : "Delete Webhook"}
                  </button>
                  <button
                    className="h-8 rounded-md border border-rose-300/30 px-3 text-xs font-semibold text-rose-200 hover:bg-rose-300/10 transition"
                    onClick={() => setConfirmDelete(null)}
                    disabled={isActioning}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {isConfirmingRotate && (
              <div className="mt-3 rounded-md border border-amber-300/30 bg-amber-300/10 p-3">
                <p className="text-xs text-amber-200 mb-2">
                  Rotating the signing secret will generate a new secret. The old secret will become invalid.
                  You&apos;ll need to update your endpoint to use the new secret.
                </p>
                <div className="flex gap-2">
                  <button
                    className="h-8 rounded-md bg-amber-300 px-3 text-xs font-semibold text-slate-950 hover:bg-amber-200 transition disabled:opacity-50"
                    onClick={() => handleRotate(webhook.id)}
                    disabled={isActioning}
                    type="button"
                  >
                    {isActioning ? "Rotating..." : "Confirm Rotation"}
                  </button>
                  <button
                    className="h-8 rounded-md border border-amber-300/30 px-3 text-xs font-semibold text-amber-200 hover:bg-amber-300/10 transition"
                    onClick={() => setConfirmRotate(null)}
                    disabled={isActioning}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
