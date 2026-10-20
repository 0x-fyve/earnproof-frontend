"use client";

import { DataPanel, MetricGrid, StatusBadge, pageContainer } from "@/components/common/production-ui";
import { PageHeading } from "@/components/common/page-heading";
import { PublicShell } from "@/components/layout/public-shell";
import { StatusCheckSkeleton } from "@/components/common/skeleton/status-check-skeleton";
import { SupportDiagnosticsExport } from "@/components/common/support-diagnostics-export";
import { ContractDriftStatusPanel } from "@/components/common/contract-drift-panel";
import { useHealthCheck } from "@/lib/health-check";
import { defineMessages, formatMessage, formatRelativeTime, formatTime } from "@/lib/i18n";

const messages = defineMessages("status", {
  title: "System status",
  description:
    "Live health for the EarnProof API, indexer, Stellar providers, contracts, and webhooks.",
  retry: "Retry",
  timeout: "Timeout",
  unreachable: "Unreachable",
  servicesOnline: "Services online",
  openIncidents: "Open incidents",
  apiStatus: "API status",
  up: "Up",
  degraded: "Degraded",
  lastCheckedLabel: "Last checked:",
  apiTimestampLabel: "API timestamp:",
  never: "Never",
  justNow: "Just now",
  lastSeen: "Last seen",
  unknown: "Unknown",
  active: "Active",
  errored: "Error",
  serviceApi: "EarnProof API",
  serviceDatabase: "Database",
  serviceIndexer: "Stellar indexer",
  serviceContracts: "Smart contracts",
  serviceWebhooks: "Webhook delivery",
  regionGlobal: "Global",
  regionTestnet: "Testnet",
  columnService: "Service",
  columnRegion: "Region",
  columnChecked: "Checked",
  columnStatus: "Status",
  searchPlaceholder: "Search services",
  cachedStatus:
    "Showing the last known status as of {time}. The connection could not be refreshed just now. This may not be the current state.",
  earlierCheck: "an earlier check",
  supportDiagnosticsTitle: "Support diagnostics",
  supportDiagnosticsDescription:
    "Generate a local, redacted diagnostics bundle to attach to a support request.",
});

type StatusRow = {
  primary: string;
  secondary: string;
  tertiary: string;
  status: string;
  tone?: "success" | "warning";
};

function deriveStatusRow(label: string, region: string, value: string | null): StatusRow {
  if (value === null) {
    return {
      primary: label,
      secondary: region,
      tertiary: messages.unknown,
      status: messages.unknown,
      tone: "warning",
    };
  }

  const ok = value === "ok";
  return {
    primary: label,
    secondary: region,
    tertiary: messages.justNow,
    status: ok ? messages.active : messages.errored,
    tone: ok ? undefined : "warning",
  };
}

function formatRelative(date: Date | null): string {
  return date ? formatRelativeTime(date) : messages.never;
}

export default function StatusPage() {
  const {
    data,
    loading,
    error,
    lastChecked,
    lastUpdated,
    isDataLive,
    refetch,
  } = useHealthCheck();

  const showingCachedData = data !== null && !isDataLive;

  const isOperational =
    data !== null &&
    data.status === "ok" &&
    data.database === "ok" &&
    !error;

  const allRows: StatusRow[] = [
    deriveStatusRow(messages.serviceApi, messages.regionGlobal, data?.status ?? null),
    deriveStatusRow(messages.serviceDatabase, messages.regionGlobal, data?.database ?? null),
    {
      primary: messages.serviceIndexer,
      secondary: messages.regionTestnet,
      tertiary: data?.timestamp ? messages.lastSeen : messages.unknown,
      status: data?.timestamp ? messages.active : messages.unknown,
      tone: data?.timestamp ? undefined : "warning",
    },
    {
      primary: messages.serviceContracts,
      secondary: messages.regionTestnet,
      tertiary: messages.unknown,
      status: messages.unknown,
      tone: "warning",
    },
    {
      primary: messages.serviceWebhooks,
      secondary: messages.regionGlobal,
      tertiary: messages.unknown,
      status: messages.unknown,
      tone: "warning",
    },
  ];

  const activeCount = allRows.filter((row) => row.status === messages.active).length;
  const totalCount = allRows.length;
  const metricValue = loading && !data ? "..." : `${activeCount}/${totalCount}`;
  const headers: [string, string, string, string] = [
    messages.columnService,
    messages.columnRegion,
    messages.columnChecked,
    messages.columnStatus,
  ];

  return (
    <PublicShell>
      <div className={pageContainer}>
        <PageHeading title={messages.title} description={messages.description} />

        {error && (
          <div className="flex items-center gap-3 rounded-lg border border-amber-300/30 bg-amber-300/10 px-4 py-3">
            <StatusBadge tone="warning">
              {error === "Request timed out" ? messages.timeout : messages.unreachable}
            </StatusBadge>
            <span className="text-sm text-slate-300">{error}</span>
            <button
              className="ml-auto rounded-lg border border-white/15 px-3 py-1 text-sm font-medium transition hover:bg-white/10"
              onClick={refetch}
              type="button"
            >
              {messages.retry}
            </button>
          </div>
        )}

        {showingCachedData && (
          <div
            aria-live="polite"
            className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300"
          >
            {formatMessage(messages.cachedStatus, {
              time: lastUpdated ? formatTime(lastUpdated) : messages.earlierCheck,
            })}
          </div>
        )}

        {loading && !data ? (
          <StatusCheckSkeleton rows={allRows.length} />
        ) : (
          <>
            <MetricGrid
              items={[
                { value: metricValue, label: messages.servicesOnline },
                {
                  value: isOperational ? "0" : data ? "1" : "...",
                  label: messages.openIncidents,
                },
                {
                  value: isOperational ? messages.up : data ? messages.degraded : "...",
                  label: messages.apiStatus,
                },
              ]}
            />

            <div className="flex items-center gap-4 text-xs text-slate-400">
              <span>
                {messages.lastCheckedLabel} {formatRelative(lastChecked)}
              </span>
              {lastUpdated && (
                <span>
                  {messages.apiTimestampLabel} {formatTime(data?.timestamp ?? lastUpdated)}
                </span>
              )}
            </div>

            <DataPanel
              headers={headers}
              rows={allRows}
              searchPlaceholder={messages.searchPlaceholder}
            />

            <div>
              <h2 className="text-xl font-semibold text-white">Backend-to-contract drift</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Whether the backend&apos;s configuration matches what is live on-chain, and any
                active operator acknowledgements.
              </p>
              <div className="mt-4">
                <ContractDriftStatusPanel />
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-white">{messages.supportDiagnosticsTitle}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                {messages.supportDiagnosticsDescription}
              </p>
              <div className="mt-4">
                <SupportDiagnosticsExport />
              </div>
            </div>
          </>
        )}
      </div>
    </PublicShell>
  );
}
