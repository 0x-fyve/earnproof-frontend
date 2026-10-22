"use client";

import { useCallback, useEffect, useState } from "react";
import { CreateSupportedAssetForm } from "./create-supported-asset-form";
import { SupportedAssetList } from "./supported-asset-list";
import { listSupportedAssets, type SupportedAssetRecord } from "@/lib/supported-assets/store";
import { readStoredSession } from "@/lib/session";

type SessionData = {
  token: string;
  user: {
    id: string;
    role: string;
  };
};

export function SupportedAssetManagement() {
  const [session] = useState<SessionData | null>(() => readStoredSession());
  const [assets, setAssets] = useState<SupportedAssetRecord[]>([]);
  const [loading, setLoading] = useState(false);

  // Only authorized organization roles can mutate asset policy (#156's own
  // acceptance criterion) — mirroring IssuerManagement's admin gate.
  const isAuthorized =
    session?.user.role === "ADMIN" || session?.user.role === "ISSUER";

  const loadData = useCallback(() => {
    if (!isAuthorized) return;
    setLoading(true);
    try {
      setAssets(listSupportedAssets());
    } finally {
      setLoading(false);
    }
  }, [isAuthorized]);

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

  const handleAssetCreated = useCallback((record: SupportedAssetRecord) => {
    setAssets((prev) => [record, ...prev]);
  }, []);

  const handleAssetUpdated = useCallback((updated: SupportedAssetRecord) => {
    setAssets((prev) => prev.map((record) => (record.id === updated.id ? updated : record)));
  }, []);

  if (!session) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 className="text-xl font-semibold text-white">Authentication Required</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Please authenticate with a Stellar wallet to access supported-asset
          administration.
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
          Supported-asset administration requires administrative access. Contact
          your administrator if you need access to this tool.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-8 sm:gap-10">
      <CreateSupportedAssetForm onAssetCreated={handleAssetCreated} />

      <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-semibold text-white">Supported Assets</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Manage which Stellar assets can be indexed and used for proofs.
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

        <SupportedAssetList assets={assets} loading={loading} onAssetUpdated={handleAssetUpdated} />
      </section>
    </div>
  );
}
