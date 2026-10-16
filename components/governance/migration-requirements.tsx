"use client";

import { useState } from "react";
import { type MigrationRequirement } from "@/lib/validation/contract-upgrades";

export interface MigrationRequirementsProps {
  requirements: MigrationRequirement[];
}

/**
 * Display individual migration requirement
 */
function MigrationRequirementItem({
  requirement,
  isCompleted,
}: {
  requirement: MigrationRequirement;
  isCompleted: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const typeLabel = {
    "pre-upgrade": "Pre-Upgrade",
    upgrade: "Upgrade",
    "post-upgrade": "Post-Upgrade",
  }[requirement.type];

  const typeColor = {
    "pre-upgrade": "bg-blue-900/30 text-blue-300",
    upgrade: "bg-purple-900/30 text-purple-300",
    "post-upgrade": "bg-teal-900/30 text-teal-300",
  }[requirement.type];

  return (
    <div className="border border-white/10 bg-slate-800/30 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-4 flex items-center justify-between hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-4 flex-1">
          <div className="flex-shrink-0">
            {isCompleted ? (
              <svg className="h-6 w-6 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              <div className="h-6 w-6 rounded-full border-2 border-white/20" />
            )}
          </div>

          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs px-2 py-1 rounded ${typeColor}`}>
                Phase {requirement.phase} • {typeLabel}
              </span>
              {isCompleted && (
                <span className="text-xs px-2 py-1 rounded bg-green-900/30 text-green-300">
                  Completed
                </span>
              )}
            </div>
            <h4 className={`font-medium ${isCompleted ? "text-slate-400 line-through" : "text-white"}`}>
              {requirement.title}
            </h4>
          </div>
        </div>

        <svg
          className={`h-5 w-5 text-slate-400 flex-shrink-0 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-white/5 p-4 bg-slate-900/20">
          <div className="space-y-3">
            <div>
              <p className="text-sm text-slate-300 leading-relaxed">{requirement.description}</p>
            </div>

            {requirement.estimatedDurationMinutes && (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Estimated duration: {requirement.estimatedDurationMinutes} minutes
              </div>
            )}

            {requirement.dependencies && requirement.dependencies.length > 0 && (
              <div>
                <p className="text-xs text-slate-400 mb-2">Dependencies:</p>
                <ul className="text-xs space-y-1 ml-4">
                  {requirement.dependencies.map(dep => (
                    <li key={dep} className="text-slate-300 flex items-center gap-2">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-400" />
                      {dep}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Display all migration requirements organized by phase
 */
export function MigrationRequirementsPanel({ requirements }: MigrationRequirementsProps) {
  if (requirements.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-slate-900/50 p-6">
        <h2 className="text-lg font-semibold text-white mb-6">Migration Requirements</h2>
        <div className="text-center py-8">
          <p className="text-slate-400">No migration requirements for this upgrade</p>
        </div>
      </div>
    );
  }

  // Group by phase
  const byPhase = requirements.reduce(
    (acc, req) => {
      if (!acc[req.phase]) {
        acc[req.phase] = [];
      }
      acc[req.phase].push(req);
      return acc;
    },
    {} as Record<number, MigrationRequirement[]>
  );

  const phases = Object.keys(byPhase)
    .map(Number)
    .sort((a, b) => a - b);

  const completedCount = requirements.filter(r => r.completed).length;

  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/50 p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-white mb-2">Migration Requirements</h2>
        <div className="flex items-center gap-4">
          <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all"
              style={{ width: `${(completedCount / requirements.length) * 100}%` }}
            />
          </div>
          <span className="text-sm text-slate-300 whitespace-nowrap">
            {completedCount} of {requirements.length} completed
          </span>
        </div>
      </div>

      <div className="space-y-6">
        {phases.map(phase => (
          <div key={phase}>
            <h3 className="text-sm font-semibold text-slate-200 mb-3 uppercase tracking-wide">
              Phase {phase}
            </h3>
            <div className="space-y-2">
              {byPhase[phase]!.map(requirement => (
                <MigrationRequirementItem
                  key={requirement.id}
                  requirement={requirement}
                  isCompleted={requirement.completed ?? false}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
