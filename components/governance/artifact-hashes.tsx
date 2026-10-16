"use client";

import { useState } from "react";
import { type SignedArtifactHash } from "@/lib/validation/contract-upgrades";

export interface ArtifactHashesProps {
  hashes: SignedArtifactHash[];
}

/**
 * Display individual artifact hash
 */
function ArtifactHashItem({ hash }: { hash: SignedArtifactHash }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(hash.hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const typeLabel = {
    "contract-bytecode": "Contract Bytecode",
    abi: "ABI",
    metadata: "Metadata",
  }[hash.type];

  const typeIcon = {
    "contract-bytecode": "📦",
    abi: "📋",
    metadata: "📄",
  }[hash.type];

  const signedDate = new Date(hash.signedAt);

  return (
    <div className="border border-white/10 bg-slate-800/30 rounded-lg p-4">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-start gap-3">
          <span className="text-lg flex-shrink-0">{typeIcon}</span>
          <div className="flex-1">
            <h4 className="font-medium text-white mb-1">{typeLabel}</h4>
            <div className="flex items-center gap-2">
              <span className="text-xs px-2 py-1 rounded bg-slate-900/50 text-slate-300 font-mono uppercase">
                {hash.algorithm}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-slate-900/50 rounded border border-white/5 p-3 mb-3">
        <p className="text-xs text-slate-400 mb-1">Hash Value</p>
        <div className="flex items-center justify-between gap-2">
          <code className="text-xs font-mono text-cyan-300 break-all">{hash.hash}</code>
          <button
            onClick={handleCopy}
            className="flex-shrink-0 p-1.5 hover:bg-white/10 rounded transition-colors"
            title="Copy hash"
            aria-label="Copy hash"
          >
            {copied ? (
              <svg className="h-4 w-4 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            )}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 text-xs">
        <div>
          <span className="text-slate-400">Signed By:</span>
          <p className="text-slate-300 mt-0.5 truncate">{hash.signedBy}</p>
        </div>
        <div>
          <span className="text-slate-400">Signed:</span>
          <p className="text-slate-300 mt-0.5">{signedDate.toLocaleString()}</p>
        </div>
      </div>

      {hash.signature && (
        <details className="mt-3 pt-3 border-t border-white/5">
          <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-300 transition-colors">
            Show signature
          </summary>
          <div className="mt-2 bg-slate-900/50 rounded border border-white/5 p-2">
            <code className="text-xs font-mono text-slate-300 break-all block max-h-24 overflow-auto">
              {hash.signature}
            </code>
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * Display all artifact hashes
 */
export function ArtifactHashesPanel({ hashes }: ArtifactHashesProps) {
  if (hashes.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-slate-900/50 p-6">
        <h2 className="text-lg font-semibold text-white mb-6">Artifact Hashes</h2>
        <div className="text-center py-8">
          <p className="text-slate-400">No artifact hashes available</p>
        </div>
      </div>
    );
  }

  // Group by type
  const byType = hashes.reduce(
    (acc, hash) => {
      if (!acc[hash.type]) {
        acc[hash.type] = [];
      }
      acc[hash.type].push(hash);
      return acc;
    },
    {} as Record<string, SignedArtifactHash[]>
  );

  const typeOrder: Array<SignedArtifactHash["type"]> = [
    "contract-bytecode",
    "abi",
    "metadata",
  ];
  const sortedTypes = typeOrder.filter(type => byType[type]);

  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/50 p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-white mb-1">Artifact Hashes</h2>
        <p className="text-sm text-slate-300">
          {hashes.length} signed artifact{hashes.length !== 1 ? "s" : ""} available for verification
        </p>
      </div>

      <div className="space-y-4">
        {sortedTypes.map(type => (
          <div key={type}>
            {byType[type]!.map((hash, idx) => (
              <ArtifactHashItem key={`${type}-${idx}`} hash={hash} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
