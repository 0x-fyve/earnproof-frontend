"use client";

import { type CompatibilityCheckResult } from "@/lib/validation/contract-upgrades";
import { getCompatibilityStatusInfo } from "@/lib/validation/contract-upgrades";

export interface CompatibilityChecksProps {
  checks: CompatibilityCheckResult[];
}

/**
 * Display individual compatibility check result
 */
function CompatibilityCheckItem({ check }: { check: CompatibilityCheckResult }) {
  const statusInfo = getCompatibilityStatusInfo(check.status);
  const categoryLabel = {
    abi: "ABI",
    storage: "Storage",
    dependency: "Dependency",
    client: "Client",
  }[check.category];

  const severityColor = {
    error: "bg-red-900/30 text-red-300",
    warning: "bg-amber-900/30 text-amber-300",
    info: "bg-blue-900/30 text-blue-300",
  }[check.severity];

  return (
    <div className="border border-white/10 bg-slate-800/50 rounded-lg p-4">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-start gap-3 flex-1">
          <div className="mt-1 flex-shrink-0">
            {check.status === "compatible" ? (
              <svg className="h-5 w-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
            ) : check.status === "incompatible" ? (
              <svg className="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              <svg className="h-5 w-5 text-slate-400" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 5a1 1 0 11-2 0 1 1 0 012 0zM6.975 13.852a.75.75 0 11-1.06-1.06 5.5 5.5 0 017.169 0 .75.75 0 01-1.06 1.06 4 4 0 00-5.049 0z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-white">{categoryLabel}</span>
              <span className={`text-xs px-2 py-1 rounded-md ${statusInfo.color}`}>
                {statusInfo.label}
              </span>
            </div>
            <p className="text-sm text-slate-300">{check.message}</p>
          </div>
        </div>
        <span className={`px-2 py-1 rounded text-xs font-medium flex-shrink-0 ${severityColor}`}>
          {check.severity.charAt(0).toUpperCase() + check.severity.slice(1)}
        </span>
      </div>

      {/* Details section */}
      {check.details && Object.keys(check.details).length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
          {Object.entries(check.details).map(([key, value]) => (
            <div key={key} className="text-xs">
              <span className="text-slate-400">{key}:</span>
              <span className="ml-2 text-slate-300 font-mono">
                {typeof value === "string" ? value : JSON.stringify(value)}
              </span>
            </div>
          ))}
        </div>
      )}

      {check.checkedAt && (
        <p className="text-xs text-slate-400 mt-3 pt-3 border-t border-white/5">
          Checked: {new Date(check.checkedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}

/**
 * Display all compatibility checks
 */
export function CompatibilityChecksPanel({ checks }: CompatibilityChecksProps) {
  const grouped = checks.reduce(
    (acc, check) => {
      if (!acc[check.category]) {
        acc[check.category] = [];
      }
      acc[check.category].push(check);
      return acc;
    },
    {} as Record<string, CompatibilityCheckResult[]>
  );

  const categoryOrder = ["abi", "storage", "dependency", "client"];
  const sortedCategories = categoryOrder.filter(cat => grouped[cat]);

  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/50 p-6">
      <h2 className="text-lg font-semibold text-white mb-6">Compatibility Checks</h2>

      {checks.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-slate-400">No compatibility checks available yet</p>
        </div>
      ) : (
        <div className="space-y-6">
          {sortedCategories.map(category => {
            const categoryLabel = {
              abi: "ABI Compatibility",
              storage: "Storage Compatibility",
              dependency: "Dependency Compatibility",
              client: "Client Compatibility",
            }[category];

            return (
              <div key={category}>
                <h3 className="text-sm font-semibold text-slate-200 mb-3 uppercase tracking-wide">
                  {categoryLabel}
                </h3>
                <div className="space-y-3">
                  {grouped[category]!.map((check, idx) => (
                    <CompatibilityCheckItem key={idx} check={check} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
