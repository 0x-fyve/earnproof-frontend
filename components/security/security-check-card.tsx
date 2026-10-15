"use client";

import { useState } from "react";
import {
  formatCheckStatus,
  getStatusColor,
  formatSeverity,
  getSeverityColor,
  formatRiskCategory,
  type SecurityCheck,
} from "@/lib/api/security-posture";
import { SecurityCheckAcknowledge } from "./security-check-acknowledge";

interface SecurityCheckCardProps {
  check: SecurityCheck;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onAcknowledged: () => void;
}

/**
 * Displays a single security check with expandable details.
 */
export function SecurityCheckCard({
  check,
  isExpanded,
  onToggleExpand,
  onAcknowledged,
}: SecurityCheckCardProps) {
  const statusColor = getStatusColor(check.status);
  const severityColor = getSeverityColor(check.severity);

  const statusColorMap: Record<string, string> = {
    green: "bg-green-500/10 text-green-300 border-green-500/20",
    red: "bg-red-500/10 text-red-300 border-red-500/20",
    gray: "bg-gray-500/10 text-gray-300 border-gray-500/20",
    blue: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  };

  const severityColorMap: Record<string, string> = {
    red: "bg-red-500/10 text-red-300 border-red-500/20",
    orange: "bg-orange-500/10 text-orange-300 border-orange-500/20",
    yellow: "bg-yellow-500/10 text-yellow-300 border-yellow-500/20",
    blue: "bg-blue-500/10 text-blue-300 border-blue-500/20",
    green: "bg-green-500/10 text-green-300 border-green-500/20",
  };

  const isAcknowledged = check.status === "ACKNOWLEDGED";

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={onToggleExpand}
        className="w-full px-4 py-4 text-left transition hover:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-cyan-300/50 focus:ring-inset"
      >
        <div className="flex items-start gap-4">
          {/* Status indicator */}
          <div className="flex-shrink-0 pt-1">
            <div
              className={`h-3 w-3 rounded-full ${
                statusColor === "green"
                  ? "bg-green-400"
                  : statusColor === "red"
                    ? "bg-red-400"
                    : statusColor === "gray"
                      ? "bg-gray-400"
                      : "bg-blue-400"
              }`}
            />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex-1">
                <h4 className="font-semibold text-white">{check.name}</h4>
                <p className="mt-1 text-sm text-slate-400">{check.description}</p>
              </div>

              {/* Badges */}
              <div className="flex flex-wrap gap-2">
                <span
                  className={`rounded border px-2 py-1 text-xs font-medium ${statusColorMap[statusColor]}`}
                >
                  {formatCheckStatus(check.status)}
                </span>
                <span
                  className={`rounded border px-2 py-1 text-xs font-medium ${severityColorMap[severityColor]}`}
                >
                  {formatSeverity(check.severity)}
                </span>
                <span className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-xs font-medium text-slate-300">
                  {formatRiskCategory(check.category)}
                </span>
              </div>
            </div>
          </div>

          {/* Expand indicator */}
          <div className="flex-shrink-0 pt-1">
            <svg
              className={`h-5 w-5 text-slate-400 transition ${
                isExpanded ? "rotate-180" : ""
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 14l-7 7m0 0l-7-7m7 7V3"
              />
            </svg>
          </div>
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-white/10 px-4 py-4 space-y-4">
          {/* Evidence */}
          {check.evidence && (
            <div>
              <h5 className="text-sm font-semibold text-white">Evidence</h5>
              {check.evidence.findings && (
                <ul className="mt-2 space-y-1">
                  {check.evidence.findings.map((finding, idx) => (
                    <li key={idx} className="text-sm text-slate-300 ml-4">
                      • {finding}
                    </li>
                  ))}
                </ul>
              )}
              {check.evidence.affectedCount !== undefined && (
                <p className="mt-2 text-sm text-slate-400">
                  Affected items: <span className="font-semibold">{check.evidence.affectedCount}</span>
                </p>
              )}
            </div>
          )}

          {/* Remediation */}
          {check.remediation && check.status === "FAIL" && (
            <div>
              <h5 className="text-sm font-semibold text-white">Remediation</h5>
              {check.remediation.steps && (
                <ol className="mt-2 space-y-2">
                  {check.remediation.steps.map((step, idx) => (
                    <li key={idx} className="text-sm text-slate-300">
                      <span className="inline-block w-6 font-semibold">{idx + 1}.</span>
                      {step}
                    </li>
                  ))}
                </ol>
              )}
              {check.remediation.remediationLink && (
                <a
                  href={check.remediation.remediationLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-sm text-cyan-300 hover:text-cyan-200"
                >
                  View detailed guide
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </a>
              )}
            </div>
          )}

          {/* Acknowledgement */}
          {isAcknowledged && check.acknowledgement && (
            <div className="rounded-md border border-blue-500/20 bg-blue-500/5 p-3">
              <h5 className="text-sm font-semibold text-blue-300">Acknowledged Exception</h5>
              <p className="mt-1 text-sm text-blue-200">{check.acknowledgement.reason}</p>
              <p className="mt-2 text-xs text-blue-300">
                Acknowledged by {check.acknowledgement.acknowledgedBy} on{" "}
                {new Date(check.acknowledgement.acknowledgedAt).toLocaleDateString()}
                {check.acknowledgement.expiresAt && (
                  <>
                    {" "}
                    • Expires {new Date(check.acknowledgement.expiresAt).toLocaleDateString()}
                  </>
                )}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            {check.status === "FAIL" && !isAcknowledged && (
              <SecurityCheckAcknowledge
                checkId={check.id}
                onAcknowledged={onAcknowledged}
              />
            )}
          </div>

          {/* Metadata */}
          <div className="border-t border-white/10 pt-3 text-xs text-slate-500">
            <p>
              Last evaluated: {new Date(check.evaluatedAt).toLocaleString()}
            </p>
            {check.owner && <p>Owner: {check.owner}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
