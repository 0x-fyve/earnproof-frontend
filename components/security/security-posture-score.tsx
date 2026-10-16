"use client";

import { getSeverityColor, formatSeverity, type SeverityLevel } from "@/lib/api/security-posture";

interface SecurityPostureScoreProps {
  score: number;
  severity: SeverityLevel;
  isFresh: boolean;
}

/**
 * Displays the overall security posture score with visual indicator.
 */
export function SecurityPostureScore({
  score,
  severity,
  isFresh,
}: SecurityPostureScoreProps) {
  const color = getSeverityColor(severity);
  const colorClasses: Record<string, string> = {
    red: "text-red-400 border-red-500/30 bg-red-500/5",
    orange: "text-orange-400 border-orange-500/30 bg-orange-500/5",
    yellow: "text-yellow-400 border-yellow-500/30 bg-yellow-500/5",
    blue: "text-blue-400 border-blue-500/30 bg-blue-500/5",
    green: "text-green-400 border-green-500/30 bg-green-500/5",
  };

  const borderColorClasses: Record<string, string> = {
    red: "border-red-500/30",
    orange: "border-orange-500/30",
    yellow: "border-yellow-500/30",
    blue: "border-blue-500/30",
    green: "border-green-500/30",
  };

  const bgColorClasses: Record<string, string> = {
    red: "bg-red-500/5",
    orange: "bg-orange-500/5",
    yellow: "bg-yellow-500/5",
    blue: "bg-blue-500/5",
    green: "bg-green-500/5",
  };

  const scoreClasses: Record<string, string> = {
    red: "text-red-300",
    orange: "text-orange-300",
    yellow: "text-yellow-300",
    blue: "text-blue-300",
    green: "text-green-300",
  };

  const scorePercentage = (score / 100) * 100;

  return (
    <div
      className={`rounded-lg border ${borderColorClasses[color]} ${bgColorClasses[color]} p-6`}
    >
      <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
        {/* Score display */}
        <div className="flex-shrink-0">
          <div className="relative h-32 w-32">
            <svg
              className="h-full w-full transform -rotate-90"
              viewBox="0 0 100 100"
            >
              {/* Background circle */}
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                className="text-white/10"
              />
              {/* Progress circle */}
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                strokeDasharray={`${(scorePercentage / 100) * 282.7} 282.7`}
                className={`text-${
                  color === "red"
                    ? "red"
                    : color === "orange"
                      ? "orange"
                      : color === "yellow"
                        ? "yellow"
                        : color === "blue"
                          ? "blue"
                          : "green"
                }-400 transition-all duration-500`}
              />
            </svg>
            {/* Score text */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className={`text-3xl font-bold ${scoreClasses[color]}`}>
                {Math.round(score)}
              </div>
              <div className="text-xs text-white/60">/ 100</div>
            </div>
          </div>
        </div>

        {/* Info */}
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-white">
            {formatSeverity(severity)} Severity
          </h3>
          <p className="mt-2 text-sm text-slate-300">
            {score >= 80
              ? "Your organization has strong security controls in place."
              : score >= 60
                ? "Your organization has adequate security controls, but improvements are recommended."
                : score >= 40
                  ? "Your organization should prioritize addressing identified security issues."
                  : "Your organization has significant security concerns that require immediate attention."}
          </p>

          {!isFresh && (
            <div className="mt-4 flex items-center gap-2 rounded-md bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300">
              <svg
                className="h-4 w-4 flex-shrink-0"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <span>This data may be stale. Consider refreshing.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
