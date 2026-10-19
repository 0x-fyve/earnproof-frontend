"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CreateWebhookForm } from "./create-webhook-form";
import { WebhookList } from "./webhook-list";
import { WebhookSecretDisplay } from "./webhook-secret-display";
import { getWebhooks, type CreateWebhookResponse, type Webhook, rotateWebhook } from "@/lib/api/webhooks";
import { readStoredSession } from "@/lib/session";

type SessionData = {
  token: string;
  user: {
    id: string;
    role: string;
  };
};

export function WebhookManagement() {
  const [session] = useState<SessionData | null>(() => readStoredSession());
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdWebhook, setCreatedWebhook] = useState<CreateWebhookResponse | null>(null);
  const [rotatedWebhookId, setRotatedWebhookId] = useState<string | null>(null);
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sessionToken = session?.token ?? null;

  const loadWebhooks = useCallback(async () => {
    if (!sessionToken) {
      return;
    }

    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const result = await getWebhooks(sessionToken, controller.signal);
      if (!controller.signal.aborted) {
        setWebhooks(result);
      }
    } catch {
      if (!controller.signal.aborted) {
        setError("Failed to load webhooks. Please try again.");
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [sessionToken]);

  useEffect(() => {
    let active = true;

    void Promise.resolve().then(() => {
      if (active) {
        void loadWebhooks();
      }
    });

    // Cleanup on unmount
    return () => {
      active = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [loadWebhooks]);

  const handleWebhookCreated = useCallback((response: CreateWebhookResponse) => {
    setCreatedWebhook(response);
    setWebhooks((prev) => [...prev, response.webhook]);
  }, []);

  const handleWebhookUpdated = useCallback((updated: Webhook) => {
    setWebhooks((prev) =>
      prev.map((webhook) =>
        webhook.id === updated.id ? updated : webhook
      )
    );
  }, []);

  const handleWebhookDeleted = useCallback((webhookId: string) => {
    setWebhooks((prev) => prev.filter((webhook) => webhook.id !== webhookId));
  }, []);

  const handleWebhookRotated = useCallback(
    async (webhookId: string) => {
      try {
        const controller = new AbortController();
        const response = await rotateWebhook(sessionToken!, webhookId, controller.signal);
        setRotatedWebhookId(webhookId);
        setRotatedSecret(response.secret);
        // Auto-hide after showing the secret
        setTimeout(() => {
          setRotatedWebhookId(null);
          setRotatedSecret(null);
        }, 60000); // Auto-dismiss after 1 minute
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to rotate webhook");
      }
    },
    [sessionToken]
  );

  const handleSecretDismissed = useCallback(() => {
    setCreatedWebhook(null);
    setRotatedWebhookId(null);
    setRotatedSecret(null);
  }, []);

  // Check if user has developer role
  const isDeveloper = session?.user.role === "DEVELOPER" || session?.user.role === "ADMIN";

  if (!session) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 className="text-xl font-semibold text-white">Authentication Required</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Please authenticate with a Stellar wallet to access webhook management.
        </p>
        <a
          className="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200"
          href="/proofs"
        >
          Connect Wallet
        </a>
      </div>
    );
  }

  if (!isDeveloper) {
    return (
      <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-5">
        <h2 className="text-xl font-semibold text-amber-100">Access Restricted</h2>
        <p className="mt-2 text-sm leading-6 text-amber-200">
          Webhook management requires developer role access. Contact your administrator if you need access to developer tools.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-8 sm:gap-10">
      {createdWebhook && !rotatedWebhookId && (
        <WebhookSecretDisplay
          webhook={createdWebhook.webhook}
          secret={createdWebhook.secret}
          onDismiss={handleSecretDismissed}
        />
      )}

      {rotatedWebhookId && rotatedSecret && (
        <WebhookSecretDisplay
          webhook={webhooks.find((w) => w.id === rotatedWebhookId)!}
          secret={rotatedSecret}
          onDismiss={handleSecretDismissed}
        />
      )}

      <CreateWebhookForm
        token={session.token}
        onWebhookCreated={handleWebhookCreated}
      />

      <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-semibold text-white">Webhook Endpoints</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Manage your webhook subscriptions and view delivery status.
            </p>
          </div>
          <button
            className="h-10 rounded-md border border-white/15 px-4 text-xs font-semibold text-white disabled:opacity-50"
            disabled={loading}
            onClick={loadWebhooks}
            type="button"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {error && (
          <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
            <p className="text-sm text-rose-200" role="alert">
              {error}
            </p>
          </div>
        )}

        <WebhookList
          webhooks={webhooks}
          loading={loading}
          token={session.token}
          onWebhookUpdated={handleWebhookUpdated}
          onWebhookDeleted={handleWebhookDeleted}
          onWebhookRotated={handleWebhookRotated}
        />
      </section>
    </div>
  );
}
