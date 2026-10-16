"use client";

/**
 * Contract successor migration readiness banner (#266).
 *
 * Three exports:
 *   - `ContractMigrationBanner`      — presentational, prop-driven.
 *   - `ContractMigrationStatusBanner`— self-loading wrapper mounted in the
 *                                      root layout.
 *   - `ContractMigrationActionGate`  — disables an affected action (with a
 *                                      reason) while preserving read-only
 *                                      access.
 *
 * The banner is network-aware: when the browser is offline it says so, and it
 * never claims the displayed migration state is current while disconnected.
 */

import { useEffect, useState } from "react";
import { useNetworkStatus } from "@/lib/network";
import {
  canPerform,
  fetchMockContractMigrationStatus,
  migrationBannerCopy,
  migrationGateReason,
  isMigrationStatusForCurrentNetwork,
  resolveStatusPageLink,
  resolveSuccessorGuideLink,
  type ContractMigrationStatus,
  type MigrationCapability,
} from "@/lib/api/contract-migration";

export interface ContractMigrationBannerProps {
  status: ContractMigrationStatus | null | undefined;
  className?: string;
}

function toneClasses(tone: "warning" | "danger"): string {
  return tone === "danger"
    ? "border-rose-300/40 bg-rose-300/10 text-rose-100"
    : "border-amber-300/40 bg-amber-300/10 text-amber-100";
}

export function ContractMigrationBanner({
  status,
  className = "",
}: ContractMigrationBannerProps) {
  const { isOnline } = useNetworkStatus();
  const copy = migrationBannerCopy(status);

  if (!copy) {
    return null;
  }

  const successorLink = resolveSuccessorGuideLink(status);
  const statusPageLink = resolveStatusPageLink(status);
  const successor = status?.successor;
  const showUnverifiedSuccessorNote =
    Boolean(successor) && !successorLink;

  return (
    <div
      role={copy.tone === "danger" ? "alert" : "status"}
      aria-live={copy.tone === "danger" ? "assertive" : "polite"}
      aria-atomic="true"
      className={`rounded-lg border px-4 py-3 text-sm ${toneClasses(copy.tone)} ${className}`}
    >
      <p className="font-semibold">{copy.title}</p>
      <p className="mt-1">{copy.detail}</p>

      {copy.readOnly ? (
        <p className="mt-1 font-medium">
          Read-only access is preserved during the migration.
        </p>
      ) : null}

      {!isOnline ? (
        <p className="mt-1 text-xs opacity-90">
          You are offline. This migration status may be out of date until you
          reconnect.
        </p>
      ) : null}

      {successorLink || statusPageLink ? (
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {successorLink ? (
            <a
              className="font-medium underline underline-offset-2"
              href={successorLink.href}
              rel="noopener noreferrer"
              target="_blank"
            >
              {successorLink.label}
            </a>
          ) : null}
          {statusPageLink ? (
            <a
              className="font-medium underline underline-offset-2"
              href={statusPageLink.href}
              rel="noopener noreferrer"
              target="_blank"
            >
              {statusPageLink.label}
            </a>
          ) : null}
        </p>
      ) : null}

      {showUnverifiedSuccessorNote ? (
        <p className="mt-2 text-xs opacity-90">
          A successor contract is listed but has not been verified — this app
          will not link to it automatically.
        </p>
      ) : null}
    </div>
  );
}

export interface ContractMigrationStatusBannerProps {
  /** Optional pre-resolved status; when omitted the banner self-loads it. */
  initialStatus?: ContractMigrationStatus | null;
}

/**
 * Self-loading banner intended for the root layout. It fetches the migration
 * status once on mount and renders nothing while the contract is stable.
 * Fetch failures are swallowed: a missing status simply means "not migrating".
 */
export function ContractMigrationStatusBanner({
  initialStatus = null,
}: ContractMigrationStatusBannerProps) {
  const [status, setStatus] = useState<ContractMigrationStatus | null>(initialStatus);

  useEffect(() => {
    if (initialStatus) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await fetchMockContractMigrationStatus();
        if (!cancelled) {
          setStatus(loaded);
        }
      } catch {
        if (!cancelled) {
          setStatus(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialStatus]);

  return <ContractMigrationBanner className="mx-4 my-2 sm:mx-12" status={status} />;
}

export interface ContractMigrationActionGateProps {
  status: ContractMigrationStatus | null | undefined;
  capability: MigrationCapability;
  children: React.ReactNode;
  /** Rendered instead of `children` when the action is gated. */
  fallback?: React.ReactNode;
}

/**
 * Renders `children` when the capability is available, otherwise a disabled
 * notice. Reads are always allowed; writes are gated from "migrating" onward.
 */
export function ContractMigrationActionGate({
  status,
  capability,
  children,
  fallback,
}: ContractMigrationActionGateProps) {
  if (canPerform(status, capability)) {
    return <>{children}</>;
  }

  if (fallback !== undefined) {
    return <>{fallback}</>;
  }

  return (
    <p className="rounded-md border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
      {migrationGateReason(status) ??
        "This action is unavailable while the contract migrates."}
    </p>
  );
}

/**
 * True when a status document cannot be trusted for this network/schema, so
 * callers can surface a "status unavailable" state instead of the standard
 * banner copy.
 */
export function isMigrationStatusStale(
  status: ContractMigrationStatus | null | undefined,
): boolean {
  if (!status) {
    return false;
  }
  return !isMigrationStatusForCurrentNetwork(status);
}
