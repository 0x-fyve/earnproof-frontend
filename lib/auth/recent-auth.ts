"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/api/client";
import { getTabSyncCoordinator } from "./tab-sync-coordinator";
import { TAB_SYNC_RESTRICTIVENESS } from "./tab-sync-protocol";
import type { AuthChallengeResponse, AuthVerifyResponse } from "@/lib/api/generated/v1";

/**
 * How long a completed wallet reauthentication stays "fresh" before a
 * destructive action requires another one. The API contract
 * (AuthChallengeResponse/AuthVerifyResponse) does not carry a
 * backend-provided freshness window today, so this is a documented
 * client-side default rather than a value read from the backend; tighten
 * or replace this once the API exposes one.
 */
export const RECENT_AUTH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export type RecentAuthChallenge = AuthChallengeResponse;

export type RecentAuthStatus = "idle" | "awaiting-signature" | "verifying" | "error";

export interface UseRecentAuthOptions {
  /** The wallet address the reauth signature must come from. */
  walletAddress: string;
  /** Signs `message` with the connected wallet, returning the base64 signature, or null if the user cancelled/it failed. */
  signMessage: (message: string) => Promise<string | null>;
}

export interface UseRecentAuthResult {
  /** True while a reauth confirmation is being shown/attempted for a pending action. */
  isPromptOpen: boolean;
  status: RecentAuthStatus;
  error: string | null;
  /** The challenge to show in the confirmation UI, once one has been requested. */
  challenge: RecentAuthChallenge | null;
  /**
   * Runs `action` if reauthentication is still fresh, otherwise stores it and
   * opens the reauth prompt. `action` is held only in memory (a ref), never
   * persisted, and is discarded on cancel or on unmount.
   */
  requestRecentAuth: (action: () => void | Promise<void>) => void;
  /** Called by the confirmation UI's Continue action. */
  confirmRecentAuth: () => Promise<void>;
  /** Called by the confirmation UI's Cancel action, or on account switch/timeout. Discards the pending action. */
  cancelRecentAuth: () => void;
}

/**
 * Gates a destructive action behind a fresh wallet-signature assertion,
 * instead of relying only on the long-lived session token. Runs the same
 * challenge -> sign -> verify sequence as the existing wallet login flow
 * (see e.g. aggregate-earnings-proof-wizard.tsx's connectWallet), but a
 * successful verify here only refreshes a local "last verified" timestamp;
 * it never replaces the caller's session.
 */
export function useRecentAuth({
  walletAddress,
  signMessage,
}: UseRecentAuthOptions): UseRecentAuthResult {
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [status, setStatus] = useState<RecentAuthStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<RecentAuthChallenge | null>(null);

  // Held in refs, not state: the pending action and the wallet address it
  // was requested for are not meant to trigger renders, and must never be
  // written to storage.
  const pendingActionRef = useRef<(() => void | Promise<void>) | null>(null);
  const requestedForAddressRef = useRef<string | null>(null);
  const lastVerifiedAtRef = useRef<number | null>(null);

  const clearPending = useCallback(() => {
    pendingActionRef.current = null;
    requestedForAddressRef.current = null;
    setChallenge(null);
    setIsPromptOpen(false);
    setStatus("idle");
    setError(null);
  }, []);

  // Freshness ends at exactly lastVerifiedAt + RECENT_AUTH_WINDOW_MS (the
  // comparison below is strict). At that instant this tab tells every other
  // tab its recent auth expired (#274), so a stale confirmation can't
  // linger in one tab after expiring in another.
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isFresh = useCallback(() => {
    if (lastVerifiedAtRef.current === null) return false;
    return Date.now() - lastVerifiedAtRef.current < RECENT_AUTH_WINDOW_MS;
  }, []);

  const clearExpiryTimer = useCallback(() => {
    if (expiryTimerRef.current !== null) {
      clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
  }, []);

  const markVerified = useCallback(() => {
    clearExpiryTimer();
    lastVerifiedAtRef.current = Date.now();
    expiryTimerRef.current = setTimeout(() => {
      expiryTimerRef.current = null;
      lastVerifiedAtRef.current = null;
      getTabSyncCoordinator()?.publish("recent_auth_expired");
    }, RECENT_AUTH_WINDOW_MS);
  }, [clearExpiryTimer]);

  // Downgrades from other tabs: recent-auth expiry (level 2) and anything
  // more restrictive drop this tab's freshness; logout/revocation (level 3+)
  // also discard a pending action. Nothing received can make auth fresh.
  useEffect(() => {
    const coordinator = getTabSyncCoordinator();
    if (!coordinator) return undefined;
    const unsubscribe = coordinator.subscribe((event) => {
      if (event.level >= TAB_SYNC_RESTRICTIVENESS.recent_auth_expired) {
        clearExpiryTimer();
        lastVerifiedAtRef.current = null;
      }
      if (event.level >= TAB_SYNC_RESTRICTIVENESS.wallet_logout) {
        pendingActionRef.current = null;
        requestedForAddressRef.current = null;
        setChallenge(null);
        setIsPromptOpen(false);
        setStatus("idle");
        setError(null);
      }
    });
    return () => {
      unsubscribe();
      clearExpiryTimer();
    };
  }, [clearExpiryTimer]);

  const requestRecentAuth = useCallback(
    (action: () => void | Promise<void>) => {
      if (isFresh()) {
        void action();
        return;
      }

      pendingActionRef.current = action;
      requestedForAddressRef.current = walletAddress;
      setError(null);
      setStatus("awaiting-signature");
      setIsPromptOpen(true);

      apiClient<RecentAuthChallenge>({
        path: "/auth/challenge",
        method: "POST",
        body: JSON.stringify({ walletAddress }),
      })
        .then((response) => {
          // The prompt may have been cancelled while the challenge was in flight.
          if (pendingActionRef.current === action) {
            setChallenge(response);
          }
        })
        .catch(() => {
          if (pendingActionRef.current === action) {
            setError("Could not start reauthentication. Please try again.");
            setStatus("error");
          }
        });
    },
    [isFresh, walletAddress],
  );

  const cancelRecentAuth = useCallback(() => {
    clearPending();
  }, [clearPending]);

  const confirmRecentAuth = useCallback(async () => {
    const action = pendingActionRef.current;
    const requestedFor = requestedForAddressRef.current;
    if (!action || !challenge) return;

    // The wallet account changed while the prompt was open; the signature
    // would come from the wrong address, so the pending action must not run.
    if (requestedFor !== walletAddress) {
      setError("The connected wallet changed. Please try again.");
      setStatus("error");
      pendingActionRef.current = null;
      return;
    }

    // The backend-issued challenge has its own expiry window; if the user
    // took too long to sign, request a fresh challenge rather than sending a
    // signature the server will reject anyway.
    if (Date.now() >= new Date(challenge.expiresAt).getTime()) {
      setError("This confirmation expired. Please try again.");
      setStatus("error");
      setChallenge(null);
      return;
    }

    setStatus("verifying");
    setError(null);

    try {
      const signature = await signMessage(challenge.message);
      if (!signature) {
        setError("Wallet did not return a signature. Please try again.");
        setStatus("error");
        return;
      }

      // A challenge is single-use server-side; replaying an old signature
      // against a stale challenge id is rejected by /auth/verify itself.
      await apiClient<AuthVerifyResponse>({
        path: "/auth/verify",
        method: "POST",
        body: JSON.stringify({
          challengeId: challenge.id,
          walletAddress,
          signature,
        }),
      });

      markVerified();
      clearPending();
      await action();
    } catch {
      setError("Reauthentication failed. Please try again.");
      setStatus("error");
    }
  }, [challenge, clearPending, markVerified, signMessage, walletAddress]);

  return {
    isPromptOpen,
    status,
    error,
    challenge,
    requestRecentAuth,
    confirmRecentAuth,
    cancelRecentAuth,
  };
}
