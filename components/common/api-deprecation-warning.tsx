"use client";

import { formatSunsetDateWithTimezone } from "@/lib/api/deprecation-warnings";
import {
  dismissDeprecationWarning,
  useDeprecationWarning,
} from "@/lib/api/use-deprecation-warning";

const severityCopy: Record<"future" | "imminent" | "expired", { label: string; tone: string }> = {
  future: {
    label: "This API version is deprecated",
    tone: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  },
  imminent: {
    label: "This API version will stop working soon",
    tone: "border-amber-400/40 bg-amber-400/15 text-amber-100",
  },
  expired: {
    label: "This API version is no longer supported",
    tone: "border-rose-400/40 bg-rose-400/15 text-rose-100",
  },
};

/**
 * Surfaces a deprecation/sunset warning parsed from the most recent API
 * response (#231). Mounted in developer-facing and affected workflow
 * surfaces (app/developers, and any page making authenticated API
 * calls) via `useDeprecationWarning`.
 *
 * An expired sunset date renders as a blocking compatibility notice
 * (role="alert", no dismiss action) rather than a dismissible warning —
 * "expired API versions produce a blocking compatibility state" means
 * the user cannot suppress their way past having already lost
 * compatibility, even though a future/imminent warning can be dismissed.
 */
export function ApiDeprecationWarning() {
  const warning = useDeprecationWarning();

  if (!warning || !warning.isDeprecated) {
    return null;
  }

  const severity = warning.severity ?? "future";
  const copy = severityCopy[severity];
  const isBlocking = severity === "expired";

  return (
    <div
      role={isBlocking ? "alert" : "status"}
      className={`rounded-lg border p-4 text-sm ${copy.tone}`}
      data-testid="api-deprecation-warning"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{copy.label}</p>
          {warning.sunsetAt && (
            <p className="mt-1 text-xs">
              {isBlocking ? "Unsupported since" : "Scheduled to stop working on"}{" "}
              {formatSunsetDateWithTimezone(warning.sunsetAt)}.
            </p>
          )}
          {warning.replacementHref && (
            <p className="mt-1 text-xs">
              <a
                href={warning.replacementHref}
                rel="noopener noreferrer"
                target="_blank"
                className="underline underline-offset-2 hover:text-white"
              >
                View the replacement API documentation
              </a>
            </p>
          )}
        </div>
        {!isBlocking && (
          <button
            type="button"
            onClick={dismissDeprecationWarning}
            aria-label="Dismiss deprecation warning"
            className="shrink-0 text-xs underline underline-offset-2 hover:text-white"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
