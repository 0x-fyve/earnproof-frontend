"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CreateTrustedSourceForm } from "./create-trusted-source-form";
import { TrustedSourceList } from "./trusted-source-list";
import { getIssuers } from "@/lib/api/issuers";
import { listTrustedSources, type TrustedSourceRecord } from "@/lib/trusted-sources/store";
import type { Issuer } from "@/lib/api/generated/v1";
import { readStoredSession } from "@/lib/session";

type SessionData = {
  token: string;
  user: {
    id: string;
    role: string;
  };
};

export function TrustedSourceManagement() {
  const [session] = useState<SessionData | null>(() => readStoredSession());
  const [trustedSources, setTrustedSources] = useState<TrustedSourceRecord[]>([]);
  const [issuers, setIssuers] = useState<Issuer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sessionToken = session?.token ?? null;
  const sessionUserId = session?.user.id ?? null;
  // Authorized organization roles only — an unauthorized session must never
  // invoke the issuer-loading API call, not just have its result hidden
  // (#135's own "Unauthorized roles cannot see or invoke mutating
  // controls" acceptance criterion).
  const isAuthorized =
    session?.user.role === "ADMIN" || session?.user.role === "ISSUER";

  const loadData = useCallback(async () => {
    if (!sessionToken || !sessionUserId || !isAuthorized) {
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const issuersData = await getIssuers(sessionToken, controller.signal);

      if (!controller.signal.aborted) {
        setIssuers(issuersData);
        setTrustedSources(listTrustedSources(sessionUserId));
      }
    } catch {
      if (!controller.signal.aborted) {
        setError("Failed to load issuers. Please try again.");
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [sessionToken, sessionUserId, isAuthorized]);

  useEffect(() => {
    let active = true;

    void Promise.resolve().then(() => {
      if (active) {
        void loadData();
      }
    });

    return () => {
      active = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [loadData]);

  const handleTrustedSourceCreated = useCallback((record: TrustedSourceRecord) => {
    setTrustedSources((prev) => [record, ...prev]);
  }, []);

  const handleTrustedSourceUpdated = useCallback((updated: TrustedSourceRecord) => {
    setTrustedSources((prev) =>
      prev.map((record) => (record.id === updated.id ? updated : record)),
    );
  }, []);

  const handleTrustedSourceDeleted = useCallback((id: string) => {
    setTrustedSources((prev) => prev.filter((record) => record.id !== id));
  }, []);

  if (!session) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 className="text-xl font-semibold text-white">Authentication Required</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Please authenticate with a Stellar wallet to access trusted-source management.
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

  if (!isAuthorized) {
    return (
      <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-5">
        <h2 className="text-xl font-semibold text-amber-100">Access Restricted</h2>
        <p className="mt-2 text-sm leading-6 text-amber-200">
          Trusted-source management requires administrative access. Contact your
          administrator if you need access to this tool.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-8 sm:gap-10">
      <CreateTrustedSourceForm
        userId={session.user.id}
        issuers={issuers}
        onTrustedSourceCreated={handleTrustedSourceCreated}
      />

      <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-semibold text-white">Trusted Sources</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Manage trusted sources and their linked issuer identities.
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

        {error && (
          <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
            <p className="text-sm text-rose-200" role="alert">
              {error}
            </p>
          </div>
        )}

        <TrustedSourceList
          userId={session.user.id}
          trustedSources={trustedSources}
          issuers={issuers}
          loading={loading}
          onTrustedSourceUpdated={handleTrustedSourceUpdated}
          onTrustedSourceDeleted={handleTrustedSourceDeleted}
        />
      </section>
    </div>
  );
}
