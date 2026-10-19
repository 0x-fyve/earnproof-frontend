"use client";

import { useCallback, useEffect, useState } from "react";
import { SessionList } from "./session-list";
import { listActiveSessions, type SessionRecord } from "@/lib/sessions/store";
import { readStoredSession } from "@/lib/session";

type SessionData = {
  token: string;
  user: {
    id: string;
    role: string;
  };
};

export function SessionManagement() {
  const [session] = useState<SessionData | null>(() => readStoredSession());
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const sessionUserId = session?.user.id ?? null;

  const loadData = useCallback(() => {
    if (!sessionUserId) return;
    setLoading(true);
    try {
      setSessions(listActiveSessions(sessionUserId));
    } finally {
      setLoading(false);
    }
  }, [sessionUserId]);

  useEffect(() => {
    let active = true;

    void Promise.resolve().then(() => {
      if (active) {
        loadData();
      }
    });

    return () => {
      active = false;
    };
  }, [loadData]);

  if (!session) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 className="text-xl font-semibold text-white">Authentication Required</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Please authenticate with a Stellar wallet to view your active sessions.
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

  return (
    <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-xl font-semibold text-white">Active Sessions</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Devices currently signed in to your account. Sign out any device you
            don&apos;t recognize.
          </p>
        </div>
        <button
          className="h-10 rounded-md border border-white/15 px-4 text-xs font-semibold text-white disabled:opacity-50"
          disabled={loading}
          onClick={loadData}
          type="button"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <SessionList
        userId={session.user.id}
        sessions={sessions}
        loading={loading}
        onSessionsChanged={setSessions}
      />
    </section>
  );
}
