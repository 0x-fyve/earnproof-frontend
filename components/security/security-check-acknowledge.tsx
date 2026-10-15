"use client";

import { useState } from "react";
import { useOrganizationContext } from "@/lib/organization-context";
import { useAuthSession } from "@/lib/auth";
import { acknowledgeSecurityCheck } from "@/lib/api/security-posture";

interface SecurityCheckAcknowledgeProps {
  checkId: string;
  onAcknowledged: () => void;
}

/**
 * Dialog/form for acknowledging a security check as an acceptable risk.
 */
export function SecurityCheckAcknowledge({
  checkId,
  onAcknowledged,
}: SecurityCheckAcknowledgeProps) {
  const { organization } = useOrganizationContext();
  const { token } = useAuthSession();

  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!organization || !token || !reason.trim()) {
      setError("Missing required information");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const controller = new AbortController();
      await acknowledgeSecurityCheck(
        token,
        organization.id,
        {
          checkId,
          reason,
          expiresAt: expiresAt || undefined,
        },
        controller.signal
      );

      setIsOpen(false);
      setReason("");
      setExpiresAt("");
      onAcknowledged();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to acknowledge check";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-300 transition hover:bg-blue-500/20"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
        Acknowledge as Exception
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-slate-950 p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-white">Acknowledge Exception</h3>
        <p className="mt-1 text-sm text-slate-400">
          Document why this security finding is acceptable as a business risk.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Reason field */}
          <div>
            <label className="block text-sm font-medium text-white">
              Reason for Exception *
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this risk is acceptable..."
              className="mt-2 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-300/50 focus:outline-none focus:ring-1 focus:ring-cyan-300/50"
              rows={4}
              required
            />
          </div>

          {/* Expiration field */}
          <div>
            <label className="block text-sm font-medium text-slate-300">
              Expiration Date (optional)
            </label>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="mt-2 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-cyan-300/50 focus:outline-none focus:ring-1 focus:ring-cyan-300/50"
            />
            <p className="mt-1 text-xs text-slate-500">
              Leave blank for permanent acknowledgment
            </p>
          </div>

          {/* Error message */}
          {error && (
            <div className="rounded-md border border-red-500/20 bg-red-500/5 p-3">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setReason("");
                setExpiresAt("");
                setError(null);
              }}
              className="flex-1 rounded-md border border-white/10 px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !reason.trim()}
              className="flex-1 rounded-md bg-blue-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Saving..." : "Acknowledge"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
