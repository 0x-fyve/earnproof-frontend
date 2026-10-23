"use client";

import { CapabilityProvider, useCapability } from "@/lib/capabilities/capability-context";
import { CapabilityUnavailable } from "@/components/common/capability-unavailable";
import { ActivityLog } from "@/components/activity/activity-log";

/**
 * Wires the account activity view up to the capability system from issue
 * #194 — see `lib/api/capabilities.ts` for why this is a UX-only gate,
 * never a security boundary. The server-side scoping/redaction
 * `lib/api/activity.ts` documents is what actually protects this data;
 * this gate only decides whether to *offer* the page at all. The log itself
 * still handles 401/403/404 from the live endpoint on its own.
 */
function GatedActivityLog() {
  const { enabled, status } = useCapability("activity-log");

  if (status === "loading") {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5" role="status">
        <p className="text-sm text-slate-400">Checking availability...</p>
      </div>
    );
  }

  if (!enabled) {
    return (
      <CapabilityUnavailable
        description="Account activity history isn't enabled for your account or deployment yet."
        title="Activity log unavailable"
      />
    );
  }

  return <ActivityLog />;
}

export function ActivityLogGate() {
  return (
    <CapabilityProvider>
      <GatedActivityLog />
    </CapabilityProvider>
  );
}
