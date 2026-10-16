"use client";

import { type BlockingFinding } from "@/lib/validation/contract-upgrades";

export interface BlockingFindingsProps {
  findings: BlockingFinding[];
}

/**
 * Display individual blocking finding
 */
function BlockingFindingItem({ finding }: { finding: BlockingFinding }) {
  const categoryColor = {
    critical: "bg-red-900/30 text-red-300 border-red-500/20",
    security: "bg-rose-900/30 text-rose-300 border-rose-500/20",
    compatibility: "bg-amber-900/30 text-amber-300 border-amber-500/20",
    migration: "bg-blue-900/30 text-blue-300 border-blue-500/20",
  }[finding.category];

  const categoryIcon = {
    critical: "🚫",
    security: "🔒",
    compatibility: "⚠️",
    migration: "📋",
  }[finding.category];

  const categoryLabel = {
    critical: "Critical",
    security: "Security",
    compatibility: "Compatibility",
    migration: "Migration",
  }[finding.category];

  const detectedDate = new Date(finding.detectedAt);

  return (
    <div className={`border rounded-lg p-4 ${categoryColor}`}>
      <div className="flex items-start gap-3">
        <span className="text-lg flex-shrink-0 mt-0.5">{categoryIcon}</span>
        <div className="flex-1">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h4 className="font-semibold text-sm">{finding.title}</h4>
            <span className={`px-2 py-1 rounded text-xs font-medium flex-shrink-0 whitespace-nowrap`}>
              {categoryLabel}
            </span>
          </div>

          <p className="text-sm leading-relaxed mb-2">{finding.description}</p>

          {finding.affectedComponent && (
            <div className="text-xs mb-2">
              <span className="text-slate-400">Affected Component:</span>
              <code className="ml-2 font-mono bg-black/20 px-2 py-1 rounded">
                {finding.affectedComponent}
              </code>
            </div>
          )}

          {finding.resolution && (
            <div className="text-xs mb-2 bg-black/20 rounded p-2">
              <p className="text-slate-300 font-medium mb-1">Resolution:</p>
              <p className="text-slate-200">{finding.resolution}</p>
            </div>
          )}

          <p className="text-xs text-slate-400 mt-2">
            Detected: {detectedDate.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Display all blocking findings
 */
export function BlockingFindingsPanel({ findings }: BlockingFindingsProps) {
  const severityOrder: Array<BlockingFinding["category"]> = [
    "critical",
    "security",
    "compatibility",
    "migration",
  ];

  const grouped = findings.reduce(
    (acc, finding) => {
      if (!acc[finding.category]) {
        acc[finding.category] = [];
      }
      acc[finding.category].push(finding);
      return acc;
    },
    {} as Record<BlockingFinding["category"], BlockingFinding[]>
  );

  const sortedFindings = severityOrder.flatMap(cat => grouped[cat] || []);

  if (findings.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-slate-900/50 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Blocking Findings</h2>
        <div className="flex items-center justify-center p-8 bg-green-900/10 border border-green-500/20 rounded">
          <div className="text-center">
            <svg className="h-8 w-8 text-green-400 mx-auto mb-2" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <p className="text-green-300 font-medium">No blocking findings</p>
            <p className="text-sm text-green-200">This upgrade is clear to proceed</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/50 p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-white mb-1">Blocking Findings</h2>
        <p className="text-sm text-slate-300">
          {findings.length} finding{findings.length !== 1 ? "s" : ""} must be resolved before approval
        </p>
      </div>

      <div className="space-y-3">
        {sortedFindings.map((finding, idx) => (
          <BlockingFindingItem key={finding.id || idx} finding={finding} />
        ))}
      </div>
    </div>
  );
}
