"use client";

import { useCallback, useState } from "react";
import { formatApiKeyPrefix, rotateApiKey, revokeApiKey } from "@/lib/api/keys";
import { getExpirationStatus, isApiKeyValid } from "@/lib/api/api-key-expiration";
import { Redacted } from "@/components/common/redacted";
import { ConfirmationDialog } from "@/components/common/confirmation-dialog";
import { CursorPagination, type PaginationState } from "@/components/common/cursor-pagination";
import { ResultsHeading } from "@/components/common/results-heading";
import { RecentAuthGate } from "@/components/common/recent-auth-gate";
import { OneTimeSecret } from "./one-time-secret";
import { KeyOverlapRotationDialog } from "./key-overlap-rotation";
import { KeyActivityDetailView } from "./key-activity-detail";
import { formatDate, formatMessage, formatRelativeTime } from "@/lib/i18n";
import { useRecentAuth } from "@/lib/auth/recent-auth";
import { signWithFreighter } from "@/lib/wallet/sign-message";
import type { ApiKey } from "@/lib/api/generated/v1";

const apiKeyActionTitles = {
  rotate: "Rotate API Key",
  revoke: "Revoke API Key",
} as const;

const apiKeyConfirmText = {
  rotate: "Rotate Key",
  revoke: "Revoke Key",
} as const;

export function ApiKeyList({
  apiKeys,
  loading,
  token,
  walletAddress,
  paginationState,
  onPreviousPage,
  onNextPage,
  focusResults,
  onKeyUpdated,
  onKeyRevoked,
}: {
  apiKeys: ApiKey[];
  loading: boolean;
  token: string;
  walletAddress: string;
  paginationState: PaginationState;
  onPreviousPage: () => void;
  onNextPage: () => void;
  focusResults: boolean;
  onKeyUpdated: (key: ApiKey) => void;
  onKeyRevoked: (keyId: string) => void;
}) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: "rotate" | "revoke";
    keyId: string;
    keyName: string;
  } | null>(null);
  const [rotatedKey, setRotatedKey] = useState<{
    apiKey: ApiKey;
    secret: string;
  } | null>(null);
  const [pendingRevokeName, setPendingRevokeName] = useState<string | null>(null);
  const [overlapDialogKey, setOverlapDialogKey] = useState<ApiKey | null>(null);
  const recentAuth = useRecentAuth({
    walletAddress,
    signMessage: (message) => signWithFreighter(message, walletAddress),
  });

  // Separate valid and expired keys for display
  const validApiKeys = apiKeys.filter((key) => isApiKeyValid(key.expiresAt));
  const expiredApiKeys = apiKeys.filter((key) => !isApiKeyValid(key.expiresAt));

  const handleRotate = useCallback(async (keyId: string) => {
    setActionLoading(keyId);
    setError(null);

    try {
      const controller = new AbortController();
      const response = await rotateApiKey(token, keyId, controller.signal);
      onKeyUpdated(response.apiKey);
      setRotatedKey(response);
    } catch {
      setError("Failed to rotate API key. Please try again.");
    } finally {
      setActionLoading(null);
      setConfirmAction(null);
    }
  }, [token, onKeyUpdated]);

  const handleRevoke = useCallback(async (keyId: string) => {
    setActionLoading(keyId);
    setError(null);

    try {
      const controller = new AbortController();
      await revokeApiKey(token, keyId, controller.signal);
      onKeyRevoked(keyId);
    } catch {
      setError("Failed to revoke API key. Please try again.");
    } finally {
      setActionLoading(null);
      setConfirmAction(null);
      setPendingRevokeName(null);
    }
  }, [token, onKeyRevoked]);

  const announcement = focusResults && apiKeys.length > 0
    ? formatMessage(
        apiKeys.length === 1
          ? "Results updated. Showing {count} API key."
          : "Results updated. Showing {count} API keys.",
        { count: apiKeys.length }
      )
    : undefined;

  if (loading && apiKeys.length === 0) {
    return (
      <div className="rounded-md border border-white/10 bg-slate-950 p-4 text-center">
        <p className="text-sm text-slate-400">Loading API keys...</p>
      </div>
    );
  }

  if (validApiKeys.length === 0) {
    // Show message if all keys are expired or if there are no keys at all
    const allExpired = apiKeys.length > 0 && validApiKeys.length === 0;
    return (
      <div className="rounded-md border border-white/10 bg-slate-950 p-4 text-center">
        <p className="text-sm text-slate-400">
          {allExpired
            ? "All API keys have expired. Create a new key or rotate an existing key to continue using the API."
            : "No API keys found. Create your first API key above."}
        </p>
      </div>
    );
  }

  return (
    <>
      {rotatedKey && (
        <OneTimeSecret
          apiKey={rotatedKey.apiKey}
          secret={rotatedKey.secret}
          onDismiss={() => setRotatedKey(null)}
        />
      )}

      {overlapDialogKey && (
        <KeyOverlapRotationDialog
          apiKey={overlapDialogKey}
          token={token}
          recentAuth={recentAuth}
          onClose={() => setOverlapDialogKey(null)}
          onOverlapStarted={() => setOverlapDialogKey(null)}
        />
      )}

      <div className="grid gap-3">
        {error && (
          <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
            <p className="text-sm text-rose-200" role="alert">
              {error}
            </p>
          </div>
        )}

        {/* Results heading with focus management and announcements */}
        <ResultsHeading
          onFocusRequested={focusResults}
          announcement={announcement}
        >
          API Keys
        </ResultsHeading>

        {/* Desktop header */}
        <div className="hidden grid-cols-[1.5fr_1fr_1fr_1fr_auto] gap-4 border-b border-white/10 pb-2 text-xs font-semibold uppercase text-slate-400 md:grid">
          <div>Name & Prefix</div>
          <div>Scopes</div>
          <div>Created</div>
          <div>Expires</div>
          <div>Actions</div>
        </div>

        {validApiKeys.map((key) => (
          <ApiKeyRow
            key={key.id}
            apiKey={key}
            isLoading={actionLoading === key.id}
            onRotate={() =>
              setConfirmAction({
                type: "rotate",
                keyId: key.id,
                keyName: key.name,
              })
            }
            onRevoke={() =>
              setConfirmAction({
                type: "revoke",
                keyId: key.id,
                keyName: key.name,
              })
            }
            onOverlapRotate={() => setOverlapDialogKey(key)}
          />
        ))}
      </div>

      {/* Expired keys section */}
      {expiredApiKeys.length > 0 && (
        <div className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <h3 className="text-sm font-semibold text-white">Expired API Keys</h3>
          <p className="text-sm text-slate-300">
            These API keys have expired and can no longer be used. Rotate or revoke them, or create a new key.
          </p>
          <div className="grid gap-3">
            {expiredApiKeys.map((key) => (
              <ApiKeyRow
                key={key.id}
                apiKey={key}
                isLoading={actionLoading === key.id}
                onRotate={() =>
                  setConfirmAction({
                    type: "rotate",
                    keyId: key.id,
                    keyName: key.name,
                  })
                }
                onRevoke={() =>
                  setConfirmAction({
                    type: "revoke",
                    keyId: key.id,
                    keyName: key.name,
                  })
                }
              />
            ))}
          </div>
        </div>
      )}
      {/* Pagination controls */}
      <div className="mt-4">
        <CursorPagination
          state={{
            ...paginationState,
            isLoading: loading,
          }}
          onPrevious={onPreviousPage}
          onNext={onNextPage}
          resultCount={apiKeys.length}
        />
      </div>

      {confirmAction && (
        <ConfirmationDialog
          title={apiKeyActionTitles[confirmAction.type]}
          message={
            confirmAction.type === "rotate"
              ? formatMessage(
                  'Are you sure you want to rotate "{keyName}"? The current secret will become invalid immediately and a new secret will be generated.',
                  { keyName: confirmAction.keyName },
                )
              : formatMessage(
                  'Are you sure you want to revoke "{keyName}"? This action cannot be undone and will immediately invalidate the API key.',
                  { keyName: confirmAction.keyName },
                )
          }
          confirmText={apiKeyConfirmText[confirmAction.type]}
          confirmVariant={confirmAction.type === "rotate" ? "primary" : "danger"}
          onConfirm={() => {
            if (confirmAction.type === "rotate") {
              handleRotate(confirmAction.keyId);
            } else {
              const { keyId, keyName } = confirmAction;
              setConfirmAction(null);
              setPendingRevokeName(keyName);
              recentAuth.requestRecentAuth(() => handleRevoke(keyId));
            }
          }}
          onCancel={() => setConfirmAction(null)}
          isProcessing={actionLoading === confirmAction.keyId}
        />
      )}

      {recentAuth.isPromptOpen && (
        <RecentAuthGate
          recentAuth={recentAuth}
          actionDescription={`revoke the API key${pendingRevokeName ? ` "${pendingRevokeName}"` : ""}.`}
        />
      )}
    </>
  );
}

function ApiKeyRow({
  apiKey,
  isLoading,
  onRotate,
  onRevoke,
  onOverlapRotate,
}: {
  apiKey: ApiKey;
  isLoading: boolean;
  onRotate: () => void;
  onRevoke: () => void;
  /** Optional: when provided, shows a "Start overlap rotation" action (#239) alongside the instant Rotate button. */
  onOverlapRotate?: () => void;
}) {
  const expirationStatus = getExpirationStatus(apiKey.expiresAt);
  const [activityExpanded, setActivityExpanded] = useState(false);

  const formatOptionalDate = (dateString: string | null | undefined) => {
    if (!dateString) return "Never";
    return formatDate(dateString);
  };

  const getExpirationDisplay = () => {
    if (!apiKey.expiresAt) {
      return "Never";
    }

    const formatted = formatOptionalDate(apiKey.expiresAt);
    const relative = formatRelativeTime(apiKey.expiresAt);
    return `${formatted} — ${relative}`;
  };

  const getExpirationBgColor = () => {
    switch (expirationStatus.tier) {
      case "expired":
        return "bg-rose-300/10";
      case "expiring-very-soon":
        return "bg-amber-300/10";
      case "expiring-soon":
        return "bg-yellow-300/10";
      default:
        return "";
    }
  };

  const getExpirationTextColor = () => {
    switch (expirationStatus.tier) {
      case "expired":
        return "text-rose-300";
      case "expiring-very-soon":
        return "text-amber-300";
      case "expiring-soon":
        return "text-yellow-300";
      default:
        return "text-slate-400";
    }
  };

  const getExpirationBorderColor = () => {
    switch (expirationStatus.tier) {
      case "expired":
        return "border-rose-300/30";
      case "expiring-very-soon":
        return "border-amber-300/30";
      case "expiring-soon":
        return "border-yellow-300/30";
      default:
        return "border-white/10";
    }
  };

  const getExpirationWarningLabel = () => {
    switch (expirationStatus.tier) {
      case "expired":
        return "Expired";
      case "expiring-very-soon":
        return "Expiring very soon";
      case "expiring-soon":
        return "Expiring soon";
      default:
        return null;
    }
  };

  return (
    <div
      className={`grid gap-3 rounded-md border p-4 text-sm transition ${getExpirationBgColor()} ${getExpirationBorderColor()}`}
    >
    <div className="grid gap-3 md:grid-cols-[1.5fr_1fr_1fr_1fr_auto] md:items-center md:gap-4">
      {/* Name & Prefix */}
      <div className="min-w-0">
        <div className="font-medium text-white">{apiKey.name}</div>
        <div className="mt-1 font-mono text-xs text-slate-400">
          <Redacted>{formatApiKeyPrefix(apiKey.prefix)}***</Redacted>
        </div>
        {!expirationStatus.isActive && (
          <div className={`mt-1 text-xs font-semibold ${getExpirationTextColor()}`}>
            {getExpirationWarningLabel()}
          </div>
        )}
      </div>

      {/* Scopes */}
      <div className="min-w-0">
        <div className="text-slate-300 md:hidden font-semibold">Scopes:</div>
        <div className="flex flex-wrap gap-1">
          {apiKey.scopes.map((scope) => (
            <span
              key={scope}
              className="inline-flex rounded bg-slate-800 px-2 py-1 text-xs text-slate-300"
            >
              {scope}
            </span>
          ))}
        </div>
      </div>

      {/* Created */}
      <div>
        <div className="text-slate-300 md:hidden font-semibold">Created:</div>
        <div className="text-slate-400">
          {/* Using a placeholder date since it's not in the API response */}
          Recently
        </div>
      </div>

      {/* Expires */}
      <div>
        <div className="text-slate-300 md:hidden font-semibold">Expires:</div>
        <div
          className={getExpirationTextColor()}
          role={expirationStatus.tier !== "active" ? "status" : undefined}
          aria-live={expirationStatus.tier !== "active" ? "polite" : undefined}
        >
          {getExpirationDisplay()}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActivityExpanded((expanded) => !expanded)}
          className="h-8 rounded border border-white/15 px-3 text-xs font-medium text-white hover:bg-white/5 transition"
          aria-expanded={activityExpanded}
          aria-label={`${activityExpanded ? "Hide" : "Show"} activity for API key ${apiKey.name}`}
        >
          {activityExpanded ? "Hide activity" : "Activity"}
        </button>
        <button
          onClick={onRotate}
          disabled={isLoading}
          className="h-8 rounded border border-white/15 px-3 text-xs font-medium text-white hover:bg-white/5 disabled:opacity-50 transition"
          aria-label={`Rotate API key ${apiKey.name}`}
        >
          {isLoading ? "..." : "Rotate"}
        </button>
        {onOverlapRotate && (
          <button
            onClick={onOverlapRotate}
            disabled={isLoading}
            className="h-8 rounded border border-cyan-300/30 px-3 text-xs font-medium text-cyan-200 hover:bg-cyan-300/10 disabled:opacity-50 transition"
            aria-label={`Start overlap rotation for API key ${apiKey.name}`}
          >
            Overlap rotation
          </button>
        )}
        <button
          onClick={onRevoke}
          disabled={isLoading}
          className="h-8 rounded border border-rose-300/30 px-3 text-xs font-medium text-rose-200 hover:bg-rose-300/10 disabled:opacity-50 transition"
          aria-label={`Revoke API key ${apiKey.name}`}
        >
          {isLoading ? "..." : "Revoke"}
        </button>
      </div>
    </div>

      {activityExpanded ? <KeyActivityDetailView keyId={apiKey.id} /> : null}
    </div>
  );
}
