"use client";

import { useCallback, useEffect, useState } from "react";
import {
  acceptInvitation,
  declineInvitation,
  getInvitationByToken,
  getInvitationDisplayStatus,
  isInvitationActionable,
  isWalletMismatch,
  type Invitation,
} from "@/lib/api/invitations";
import { formatOrganizationRole } from "@/lib/api/organization-members";
import { useOrganizationContext } from "@/lib/organization-context/context";
import { Timestamp } from "@/components/common/timestamp";
import { readStoredSession, type Session as SessionData } from "@/lib/session";

type LoadState = "loading" | "ready" | "not-found" | "error";

/**
 * Organization invitation acceptance (#237).
 *
 * The invitation `token` is only ever used as a path segment in the
 * acceptInvitation/declineInvitation/getInvitationByToken calls and in
 * this component's own React state - it is never passed to a logger,
 * analytics call, or `localStorage`/`sessionStorage` write anywhere in
 * this file, and every error message shown to the user is a fixed
 * string rather than one that echoes the token or raw server error text.
 */
export function InvitationAcceptance({ token }: { token: string }) {
  const [session] = useState<SessionData | null>(() => readStoredSession());
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<"accepted" | "declined" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { switchOrganization } = useOrganizationContext();

  useEffect(() => {
    const controller = new AbortController();

    getInvitationByToken(token, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setInvitation(result);
        setLoadState("ready");
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof Error && err.message.includes("404")) {
          setLoadState("not-found");
        } else {
          setLoadState("error");
        }
      });

    return () => controller.abort();
  }, [token]);

  const handleAccept = useCallback(async () => {
    if (!session || !invitation) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      const controller = new AbortController();
      const response = await acceptInvitation(session.token, token, controller.signal);
      // Refresh active tenant context so membership (and anything scoped
      // to the organization, via the `generation` counter) reflects the
      // newly-accepted membership immediately.
      await switchOrganization({
        id: response.organizationId,
        name: response.invitation.organizationName,
        slug: response.invitation.organizationName.toLowerCase().replace(/\s+/g, "-"),
        status: "ACTIVE",
      });
      setActionResult("accepted");
    } catch {
      setActionError(
        "This invitation could not be accepted. It may have expired, been revoked, or already been used.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [session, invitation, token, switchOrganization]);

  const handleDecline = useCallback(async () => {
    if (!session) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      const controller = new AbortController();
      await declineInvitation(session.token, token, controller.signal);
      setActionResult("declined");
    } catch {
      setActionError("This invitation could not be declined. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }, [session, token]);

  if (loadState === "loading") {
    return (
      <div
        className="rounded-lg border border-white/10 bg-white/[0.04] p-5 text-sm text-slate-300"
        role="status"
        aria-live="polite"
      >
        Loading invitation...
      </div>
    );
  }

  if (loadState === "not-found") {
    return (
      <div className="rounded-lg border border-rose-300/30 bg-rose-300/10 p-5" role="alert">
        <h2 className="text-lg font-semibold text-rose-100">Invitation not found</h2>
        <p className="mt-2 text-sm text-rose-200">
          This invitation link is invalid. Double-check the link you received, or ask the
          organization to send a new invitation.
        </p>
      </div>
    );
  }

  if (loadState === "error" || !invitation) {
    return (
      <div className="rounded-lg border border-rose-300/30 bg-rose-300/10 p-5" role="alert">
        <h2 className="text-lg font-semibold text-rose-100">Something went wrong</h2>
        <p className="mt-2 text-sm text-rose-200">
          We couldn&apos;t load this invitation. Please try again in a moment.
        </p>
      </div>
    );
  }

  const displayStatus = getInvitationDisplayStatus(invitation);

  if (actionResult === "accepted") {
    return (
      <div className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 p-5" role="status">
        <h2 className="text-lg font-semibold text-emerald-100">
          You&apos;ve joined {invitation.organizationName}
        </h2>
        <p className="mt-2 text-sm text-emerald-200">
          You now have {formatOrganizationRole(invitation.role)} access. Your active
          organization has been switched to {invitation.organizationName}.
        </p>
      </div>
    );
  }

  if (actionResult === "declined") {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5" role="status">
        <h2 className="text-lg font-semibold text-slate-100">Invitation declined</h2>
        <p className="mt-2 text-sm text-slate-300">
          You&apos;ve declined the invitation to join {invitation.organizationName}.
        </p>
      </div>
    );
  }

  if (displayStatus === "expired") {
    return (
      <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-5" role="alert">
        <h2 className="text-lg font-semibold text-amber-100">Invitation expired</h2>
        <p className="mt-2 text-sm text-amber-200">
          This invitation to join <strong>{invitation.organizationName}</strong> expired on{" "}
          <Timestamp value={invitation.expiresAt} />. Ask the organization to send a new one.
        </p>
      </div>
    );
  }

  if (displayStatus === "revoked") {
    return (
      <div className="rounded-lg border border-rose-300/30 bg-rose-300/10 p-5" role="alert">
        <h2 className="text-lg font-semibold text-rose-100">Invitation revoked</h2>
        <p className="mt-2 text-sm text-rose-200">
          This invitation to join <strong>{invitation.organizationName}</strong> has been
          revoked by the organization and can no longer be accepted.
        </p>
      </div>
    );
  }

  if (displayStatus === "accepted" || displayStatus === "declined") {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5" role="status">
        <h2 className="text-lg font-semibold text-slate-100">Invitation already used</h2>
        <p className="mt-2 text-sm text-slate-300">
          This invitation to join <strong>{invitation.organizationName}</strong> has already
          been {displayStatus}. It cannot be used again.
        </p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 className="text-lg font-semibold text-white">Connect your wallet to continue</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          You&apos;ve been invited to join <strong>{invitation.organizationName}</strong> as{" "}
          {formatOrganizationRole(invitation.role)}. Connect the wallet this invitation was
          sent to before accepting or declining.
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

  const mismatch = isWalletMismatch(invitation, session.user.walletAddress);
  const isActionable = isInvitationActionable(invitation) && !mismatch;

  return (
    <div
      className="rounded-lg border border-white/10 bg-white/[0.04] p-5"
      role="region"
      aria-labelledby="invitation-heading"
    >
      <h2 id="invitation-heading" className="text-lg font-semibold text-white">
        Join {invitation.organizationName}
      </h2>

      <dl className="mt-4 grid gap-2 text-sm text-slate-300">
        <div>
          <dt className="inline font-semibold text-slate-200">Organization: </dt>
          <dd className="inline">{invitation.organizationName}</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-slate-200">Role: </dt>
          <dd className="inline">{formatOrganizationRole(invitation.role)}</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-slate-200">Expires: </dt>
          <dd className="inline">
            <Timestamp value={invitation.expiresAt} />
          </dd>
        </div>
      </dl>

      {mismatch && (
        <div
          className="mt-4 rounded-md border border-amber-300/30 bg-amber-300/10 p-3"
          role="alert"
        >
          <p className="text-xs text-amber-200">
            This invitation was sent to a different wallet address than the one you&apos;re
            currently connected with. Connect the correct wallet to accept it.
          </p>
        </div>
      )}

      {actionError && (
        <div className="mt-4 rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
          <p className="text-xs text-rose-200" role="alert">
            {actionError}
          </p>
        </div>
      )}

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={handleAccept}
          disabled={!isActionable || isSubmitting}
          className="h-10 rounded-md border border-emerald-300/30 bg-emerald-300 px-4 text-xs font-semibold text-slate-950 hover:bg-emerald-200 transition disabled:opacity-50"
        >
          {isSubmitting ? "Processing..." : "Accept invitation"}
        </button>
        <button
          type="button"
          onClick={handleDecline}
          disabled={!isInvitationActionable(invitation) || isSubmitting}
          className="h-10 rounded-md border border-white/10 px-4 text-xs font-semibold text-slate-300 hover:bg-white/5 transition disabled:opacity-50"
        >
          Decline
        </button>
      </div>
    </div>
  );
}
