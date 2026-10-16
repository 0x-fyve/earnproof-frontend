"use client";

import { type ContractUpgradeMetadata } from "@/lib/validation/contract-upgrades";
import { formatDistanceToNow } from "date-fns";

export interface ContractUpgradeMetadataProps {
  metadata: ContractUpgradeMetadata;
}

export function ContractUpgradeMetadataPanel({ metadata }: ContractUpgradeMetadataProps) {
  const proposedDate = new Date(metadata.proposedAt);
  const startsDate = new Date(metadata.activationWindow.startsAt);
  const endsDate = new Date(metadata.activationWindow.endsAt);

  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/50 p-6">
      <h2 className="text-lg font-semibold text-white mb-6">Upgrade Metadata</h2>

      <div className="space-y-4">
        {/* Contract Information */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Contract Address
            </label>
            <code className="block text-xs font-mono text-cyan-300 break-all bg-slate-800/50 p-2 rounded border border-white/5">
              {metadata.contractAddress}
            </code>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Contract Identity
            </label>
            <p className="text-sm text-slate-200">{metadata.contractIdentity}</p>
          </div>
        </div>

        {/* Version Information */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Current Version
            </label>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-md bg-slate-800/50 px-3 py-1 text-sm font-mono text-blue-300">
                {metadata.currentVersion}
              </span>
            </div>
          </div>

          <div className="flex items-end justify-center">
            <svg
              className="h-5 w-5 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 7l5 5m0 0l-5 5m5-5H6"
              />
            </svg>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Proposed Version
            </label>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-md bg-slate-800/50 px-3 py-1 text-sm font-mono text-green-300">
                {metadata.proposedVersion}
              </span>
            </div>
          </div>
        </div>

        {/* Proposal Information */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Proposed By
            </label>
            <p className="text-sm text-slate-200 truncate">{metadata.proposedBy}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Proposed
            </label>
            <p className="text-sm text-slate-200">
              {formatDistanceToNow(proposedDate, { addSuffix: true })}
            </p>
          </div>
        </div>

        {/* Activation Window */}
        <div className="border-t border-white/5 pt-4">
          <h3 className="text-sm font-medium text-slate-300 mb-3">Activation Window</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="bg-slate-800/30 rounded border border-white/5 p-3">
              <p className="text-xs text-slate-400 mb-1">Starts</p>
              <p className="text-sm font-mono text-slate-200">
                {startsDate.toLocaleString()}
              </p>
            </div>
            <div className="bg-slate-800/30 rounded border border-white/5 p-3">
              <p className="text-xs text-slate-400 mb-1">Ends</p>
              <p className="text-sm font-mono text-slate-200">
                {endsDate.toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="border-t border-white/5 pt-4">
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Description
          </label>
          <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
            {metadata.description}
          </p>
        </div>
      </div>
    </div>
  );
}
