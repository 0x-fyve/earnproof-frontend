"use client";

/**
 * Shell component for the payment account rotation page (#281).
 *
 * Handles session read and authorization guard, then delegates to
 * AccountRotationWizard. Mirrors the pattern used by BackfillManagement
 * and WalletRotationManagement.
 *
 * Authorization: ADMIN role required. Workers and Developers see a
 * clear "Access Restricted" message with no data leakage.
 */

import { useState } from "react";
import { readStoredSession, type Session } from "@/lib/session";
import { AccountRotationWizard } from "./account-rotation-wizard";

export function AccountRotationManagement() {
  const [session] = useState<Session | null>(() => readStoredSession());

  if (!session) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 className="text-xl font-semibold text-white">Authentication Required</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Please authenticate with a Stellar wallet to access payment account
          rotation controls.
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

  const isAuthorized = session.user.role === "ADMIN";

  if (!isAuthorized) {
    return (
      <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-5">
        <h2 className="text-xl font-semibold text-amber-100">Access Restricted</h2>
        <p className="mt-2 text-sm leading-6 text-amber-200">
          Payment account rotation requires administrative access. Contact your
          administrator if you need access to this workflow.
        </p>
      </div>
    );
  }

  return (
    <AccountRotationWizard
      session={session}
      onRotationCompleted={() => {
        // A completed rotation means the new account is now active. A full
        // reload sends the user back through the normal connect flow rather
        // than trying to patch React state that may reference the old account.
        window.location.reload();
      }}
    />
  );
}
