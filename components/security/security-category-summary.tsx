"use client";

import {
  formatRiskCategory,
  type RiskCategory,
  type SecurityCheck,
} from "@/lib/api/security-posture";

interface SecurityCategorySummaryProps {
  categorized: Record<RiskCategory, SecurityCheck[]>;
}

/**
 * Displays a summary of security checks grouped by category.
 */
export function SecurityCategorySummary({
  categorized,
}: SecurityCategorySummaryProps) {
  const categories: RiskCategory[] = [
    "KEY_ROTATION",
    "SESSION_MANAGEMENT",
    "WEBHOOK_SECURITY",
    "ROLE_BASED_ACCESS",
    "CONTRACT_VERIFICATION",
    "RECOVERY_OPTIONS",
    "API_SECURITY",
    "DATA_ACCESS",
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {categories.map((category) => {
        const checks = categorized[category];
        const failed = checks.filter((c) => c.status === "FAIL").length;
        const passed = checks.filter((c) => c.status === "PASS").length;
        const unknown = checks.filter((c) => c.status === "UNKNOWN").length;

        if (checks.length === 0) {
          return null;
        }

        const statusColor =
          failed > 0
            ? "red"
            : unknown > 0
              ? "yellow"
              : "green";

        const borderColorMap: Record<string, string> = {
          red: "border-red-500/20",
          yellow: "border-yellow-500/20",
          green: "border-green-500/20",
        };

        const bgColorMap: Record<string, string> = {
          red: "bg-red-500/5",
          yellow: "bg-yellow-500/5",
          green: "bg-green-500/5",
        };

        const textColorMap: Record<string, string> = {
          red: "text-red-300",
          yellow: "text-yellow-300",
          green: "text-green-300",
        };

        return (
          <div
            key={category}
            className={`rounded-lg border ${borderColorMap[statusColor]} ${bgColorMap[statusColor]} p-4`}
          >
            <h4 className="font-semibold text-white">
              {formatRiskCategory(category)}
            </h4>
            <div className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-300">Passed</span>
                <span className={`font-semibold ${passed > 0 ? "text-green-300" : "text-slate-400"}`}>
                  {passed}
                </span>
              </div>
              {failed > 0 && (
                <div className="flex justify-between">
                  <span className="text-red-300">Failed</span>
                  <span className="font-semibold text-red-300">{failed}</span>
                </div>
              )}
              {unknown > 0 && (
                <div className="flex justify-between">
                  <span className="text-yellow-300">Unknown</span>
                  <span className="font-semibold text-yellow-300">{unknown}</span>
                </div>
              )}
            </div>
            <div className="mt-3 border-t border-white/10 pt-2">
              <p className="text-xs text-slate-400">
                {checks.length} check{checks.length !== 1 ? "s" : ""} total
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
