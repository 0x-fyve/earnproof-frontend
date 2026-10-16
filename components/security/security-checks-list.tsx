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
import { SecurityCheckCard } from "./security-check-card";

interface SecurityChecksListProps {
  checks: SecurityCheck[];
  onPostureRefresh: () => void;
}

type FilterStatus = "all" | "failed" | "passed" | "unknown" | "acknowledged";

/**
 * Displays a filterable list of security checks.
 */
export function SecurityChecksList({
  checks,
  onPostureRefresh,
}: SecurityChecksListProps) {
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [expandedCheckId, setExpandedCheckId] = useState<string | null>(null);

  // Filter checks based on status
  const filteredChecks = checks.filter((check) => {
    if (filterStatus === "all") return true;
    if (filterStatus === "failed") return check.status === "FAIL";
    if (filterStatus === "passed") return check.status === "PASS";
    if (filterStatus === "unknown") return check.status === "UNKNOWN";
    if (filterStatus === "acknowledged") return check.status === "ACKNOWLEDGED";
    return true;
  });

  // Count checks by status
  const counts = {
    all: checks.length,
    failed: checks.filter((c) => c.status === "FAIL").length,
    passed: checks.filter((c) => c.status === "PASS").length,
    unknown: checks.filter((c) => c.status === "UNKNOWN").length,
    acknowledged: checks.filter((c) => c.status === "ACKNOWLEDGED").length,
  };

  const filters: { label: string; value: FilterStatus; count: number }[] = [
    { label: "All", value: "all", count: counts.all },
    { label: "Failed", value: "failed", count: counts.failed },
    { label: "Passed", value: "passed", count: counts.passed },
    { label: "Unknown", value: "unknown", count: counts.unknown },
    { label: "Acknowledged", value: "acknowledged", count: counts.acknowledged },
  ];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {filters.map((filter) => (
          <button
            key={filter.value}
            onClick={() => setFilterStatus(filter.value)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              filterStatus === filter.value
                ? "bg-cyan-300/20 text-cyan-300"
                : "bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
          >
            {filter.label} ({filter.count})
          </button>
        ))}
      </div>

      {/* Empty state */}
      {filteredChecks.length === 0 && (
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-8 text-center">
          <p className="text-sm text-slate-400">No checks match the selected filter.</p>
        </div>
      )}

      {/* Checks list */}
      <div className="space-y-3">
        {filteredChecks.map((check) => (
          <SecurityCheckCard
            key={check.id}
            check={check}
            isExpanded={expandedCheckId === check.id}
            onToggleExpand={() =>
              setExpandedCheckId(
                expandedCheckId === check.id ? null : check.id
              )
            }
            onAcknowledged={onPostureRefresh}
          />
        ))}
      </div>

      {/* Summary */}
      <div className="mt-6 rounded-lg border border-white/10 bg-white/[0.04] p-4">
        <div className="text-sm text-slate-300">
          Showing <span className="font-semibold text-white">{filteredChecks.length}</span> of{" "}
          <span className="font-semibold text-white">{checks.length}</span> checks
        </div>
      </div>
    </div>
  );
}
