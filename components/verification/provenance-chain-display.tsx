/**
 * Provenance chain display component for showing verification source attribution.
 *
 * Displays:
 * - Ordered verification checkpoints with their observations
 * - Which sources (issuer, contract, blockchain, registry) verified each step
 * - Timestamped observations with pass/fail results
 * - Missing links and unavailable sources
 *
 * Accessibility:
 * - Semantic structure with proper heading hierarchy
 * - ARIA labels for status indicators
 * - Keyboard navigation support
 * - Expandable/collapsible sections for detail
 */

import type { ReactNode } from "react";
import { Timestamp } from "@/components/common/timestamp";
import type { ProvenianceChain } from "@/lib/api/generated/v1";
import {
  getObservationTypeLabel,
  getSourceTypeLabel,
  getMissingLinkReasonLabel,
  getProvenianceSummary,
  getCheckpointObservations,
  findSource,
  findCheckpoint,
} from "@/lib/proofs/provenance-chain";

interface ProvenianceChainDisplayProps {
  /**
   * The provenance chain to display.
   * Required - component assumes chain is present and valid.
   */
  chain: ProvenianceChain;

  /**
   * Optional title override. Defaults to "Verification Sources".
   */
  title?: string;

  /**
   * Whether to show detailed timestamps and observation details.
   * Defaults to true. When false, shows summary only.
   */
  showDetails?: boolean;

  /**
   * Whether to expand all sections by default.
   * Defaults to false (expandable/collapsible).
   */
  expandedByDefault?: boolean;
}

function StatusBadge({
  status,
  label,
}: {
  status: "verified" | "unavailable" | "failed";
  label: string;
}): ReactNode {
  const statusConfig = {
    verified: {
      bg: "bg-emerald-400/20",
      border: "border-emerald-400/40",
      text: "text-emerald-100",
      icon: "✓",
      ariaLabel: "verified",
    },
    unavailable: {
      bg: "bg-slate-400/20",
      border: "border-slate-400/40",
      text: "text-slate-100",
      icon: "—",
      ariaLabel: "unavailable",
    },
    failed: {
      bg: "bg-rose-400/20",
      border: "border-rose-400/40",
      text: "text-rose-100",
      icon: "✕",
      ariaLabel: "failed",
    },
  };

  const config = statusConfig[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium border ${config.bg} ${config.border} ${config.text}`}
      aria-label={`${label}: ${config.ariaLabel}`}
    >
      <span className="font-bold">{config.icon}</span>
      <span>{label}</span>
    </span>
  );
}

function ObservationResult({
  result,
  details,
}: {
  result: boolean;
  details?: string;
}): ReactNode {
  return (
    <div className="flex items-start gap-2">
      <span
        className={`mt-0.5 text-sm font-bold ${result ? "text-emerald-300" : "text-rose-300"}`}
        aria-label={result ? "passed" : "failed"}
      >
        {result ? "✓" : "✕"}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase text-slate-400">
          {result ? "Passed" : "Failed"}
        </p>
        {details && <p className="mt-1 text-xs text-slate-300">{details}</p>}
      </div>
    </div>
  );
}

function CheckpointObservations({ checkpointId, chain, showDetails }: { checkpointId: string; chain: ProvenianceChain; showDetails?: boolean }): ReactNode {
  const observations = getCheckpointObservations(chain, checkpointId);

  if (observations.length === 0) {
    return (
      <p className="text-xs text-slate-400 italic">
        No observations recorded for this checkpoint.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {observations.map((obs, idx) => {
        const source = findSource(chain, obs.sourceId);
        return (
          <div key={`${obs.checkpointId}-${obs.sourceId}-${idx}`} className="border-l border-slate-600 pl-3">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-300">
                  {source ? getSourceTypeLabel(source.type) : obs.sourceId}
                </p>
                <p className="text-xs text-slate-500">
                  {getObservationTypeLabel(obs.observationType)}
                </p>
              </div>
            </div>
            <ObservationResult result={obs.result} details={obs.details} />
            {showDetails && (
              <p className="text-xs text-slate-500 mt-2">
                <Timestamp value={obs.timestamp} />
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CheckpointSection({
  checkpoint,
  chain,
  showDetails,
  expandedByDefault,
}: {
  checkpoint: { id: string; name: string; order: number };
  chain: ProvenianceChain;
  showDetails?: boolean;
  expandedByDefault?: boolean;
}): ReactNode {
  const [isExpanded, setIsExpanded] = React.useState(expandedByDefault ?? false);
  const observations = getCheckpointObservations(chain, checkpoint.id);
  const passedCount = observations.filter((o) => o.result).length;
  const failedCount = observations.filter((o) => !o.result).length;

  return (
    <div key={checkpoint.id} className="border border-white/10 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition text-left"
        aria-expanded={isExpanded}
        aria-controls={`checkpoint-details-${checkpoint.id}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-slate-100">
              {checkpoint.order + 1}. {checkpoint.name}
            </span>
            {failedCount > 0 && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-rose-400/10 border border-rose-400/30 text-rose-100">
                <span>✕</span>
                <span>{failedCount} failed</span>
              </span>
            )}
            {passedCount > 0 && failedCount === 0 && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-emerald-400/10 border border-emerald-400/30 text-emerald-100">
                <span>✓</span>
                <span>{passedCount} verified</span>
              </span>
            )}
          </div>
          {checkpoint.description && (
            <p className="text-xs text-slate-400">{checkpoint.description}</p>
          )}
        </div>
        <span className={`text-slate-500 transition ${isExpanded ? "rotate-180" : ""}`}>
          ▼
        </span>
      </button>

      {isExpanded && (
        <div id={`checkpoint-details-${checkpoint.id}`} className="px-4 py-3 bg-white/[0.02] border-t border-white/10">
          <CheckpointObservations checkpointId={checkpoint.id} chain={chain} showDetails={showDetails} />
        </div>
      )}
    </div>
  );
}

function MissingLinksSection({ chain }: { chain: ProvenianceChain }): ReactNode {
  if (chain.missingLinks.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4">
      <h4 className="text-sm font-semibold text-amber-100 mb-3">Unavailable Sources</h4>
      <div className="space-y-2">
        {chain.missingLinks.map((link) => {
          const source = findSource(chain, link.sourceId);
          return (
            <div key={link.sourceId} className="text-sm">
              <p className="font-medium text-amber-100">
                {source ? getSourceTypeLabel(source.type) : link.sourceId}
              </p>
              <p className="text-xs text-amber-200/80 mt-1">
                {getMissingLinkReasonLabel(link.reason)}
                {link.retryable && " (retryable)"}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SourcesSummary({ chain }: { chain: ProvenianceChain }): ReactNode {
  const summary = getProvenianceSummary(chain);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div className="rounded-lg bg-emerald-400/10 border border-emerald-400/30 p-3">
        <p className="text-xs font-semibold text-emerald-200">Verified</p>
        <p className="text-lg font-bold text-emerald-100 mt-1">{summary.verifiedSources}</p>
      </div>
      <div className="rounded-lg bg-slate-400/10 border border-slate-400/30 p-3">
        <p className="text-xs font-semibold text-slate-200">Unavailable</p>
        <p className="text-lg font-bold text-slate-100 mt-1">{summary.unavailableSources}</p>
      </div>
      <div className="rounded-lg bg-rose-400/10 border border-rose-400/30 p-3">
        <p className="text-xs font-semibold text-rose-200">Failed</p>
        <p className="text-lg font-bold text-rose-100 mt-1">{summary.failedSources}</p>
      </div>
      <div className="rounded-lg bg-cyan-400/10 border border-cyan-400/30 p-3">
        <p className="text-xs font-semibold text-cyan-200">Checkpoints</p>
        <p className="text-lg font-bold text-cyan-100 mt-1">{summary.checkpointsExecuted}</p>
      </div>
    </div>
  );
}

function SourcesPanel({ chain }: { chain: ProvenianceChain }): ReactNode {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <h4 className="text-sm font-semibold text-slate-100 mb-3">Verification Sources</h4>
      <div className="space-y-2">
        {chain.sources.map((source) => (
          <div
            key={source.id}
            className="flex items-start justify-between gap-3 p-2 rounded bg-white/[0.04] border border-white/5"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-200">{source.name}</p>
              {source.description && (
                <p className="text-xs text-slate-400 mt-1">{source.description}</p>
              )}
            </div>
            <StatusBadge status={source.status} label={getSourceTypeLabel(source.type)} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Main provenance chain display component.
 *
 * Shows the complete verification journey with:
 * - Ordered checkpoints with collapsible observations
 * - Source status summary
 * - Missing links and unavailable sources
 * - Detailed timestamps and observation results
 */
export function ProvenianceChainDisplay({
  chain,
  title = "Verification Sources",
  showDetails = true,
  expandedByDefault = false,
}: ProvenianceChainDisplayProps): ReactNode {
  // Sort checkpoints by order for display
  const sortedCheckpoints = [...chain.checkpoints].sort((a, b) => a.order - b.order);
  const summary = getProvenianceSummary(chain);

  return (
    <div className="space-y-6">
      {/* Header with summary statistics */}
      <div>
        <h3 className="text-lg font-semibold text-slate-100 mb-4">{title}</h3>
        <SourcesSummary chain={chain} />
      </div>

      {/* Verification checkpoints */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-slate-200">Verification Steps</h4>
        <div className="space-y-2">
          {sortedCheckpoints.map((checkpoint) => (
            <CheckpointSection
              key={checkpoint.id}
              checkpoint={checkpoint}
              chain={chain}
              showDetails={showDetails}
              expandedByDefault={expandedByDefault}
            />
          ))}
        </div>
      </div>

      {/* Sources detail panel */}
      <SourcesPanel chain={chain} />

      {/* Missing links section (only shown if there are missing links) */}
      {chain.missingLinks.length > 0 && <MissingLinksSection chain={chain} />}

      {/* Retry information */}
      {!summary.allVerified && summary.isRetryable && (
        <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/5 p-4">
          <p className="text-sm text-cyan-200">
            Some sources were temporarily unavailable. Verification can be retried.
          </p>
        </div>
      )}

      {!summary.isRetryable && summary.failedSources > 0 && (
        <div className="rounded-lg border border-rose-300/20 bg-rose-300/5 p-4">
          <p className="text-sm text-rose-200">
            Verification cannot be retried due to permanent failures. A failed cryptographic
            result can never be upgraded.
          </p>
        </div>
      )}
    </div>
  );
}

// Import React for useState
import * as React from "react";
