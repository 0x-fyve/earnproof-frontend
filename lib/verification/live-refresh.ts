import {
  VERIFICATION_EVIDENCE_SOURCES,
  VERIFICATION_EVIDENCE_SOURCE_LABELS,
  isVerificationEvidenceSource,
  type VerificationEvidenceSource,
  type VerifierFreshnessPolicy,
} from "@/lib/api/live-verification-refresh";

/**
 * Pure rules for live verification refresh (#268). See
 * docs/live-verification-refresh.md.
 */

/** A live refresh is aborted (and reported as timed out) after this long. */
export const LIVE_REFRESH_TIMEOUT_MS = 15_000;
/** Minimum gap between refresh attempts, successful or not. */
export const LIVE_REFRESH_COOLDOWN_MS = 30_000;
/** Upper bound honoured for a server Retry-After, so a bad header cannot lock the button for hours. */
export const MAX_RETRY_AFTER_MS = 10 * 60_000;
/** Evidence observed further than this in the future is treated as an invalid timestamp. */
export const EVIDENCE_CLOCK_SKEW_MS = 30_000;

const SIGNED_IN_ROLES = ["WORKER", "ISSUER", "ADMIN", "DEVELOPER"] as const;

/**
 * Live refresh costs contract RPC calls, so it requires a signed-in session
 * with a known role. The server must enforce the same rule; this only
 * avoids offering a control that would be rejected.
 */
export function canRequestLiveRefresh(role: string | null | undefined): boolean {
  return (SIGNED_IN_ROLES as readonly string[]).includes(role ?? "");
}

export type FreshnessAssessment =
  | { status: "fresh"; ageMs: number; maxAgeMs: number }
  | { status: "stale"; ageMs: number; maxAgeMs: number }
  | { status: "no_policy"; ageMs: number }
  | { status: "invalid_timestamp" };

/**
 * Exact boundary: evidence is fresh only while age < maxEvidenceAgeMs.
 * At age == maxEvidenceAgeMs it is STALE. This matches the repository's
 * other freshness window (RECENT_AUTH_WINDOW_MS uses a strict comparison);
 * the backend does not define one today.
 *
 * Small negative ages (sender clock ahead by at most EVIDENCE_CLOCK_SKEW_MS)
 * count as age 0; anything further in the future is an invalid timestamp.
 * Without a valid policy, freshness is "no_policy", which never meets the
 * policy.
 */
export function assessFreshness(
  observedAt: string,
  policy: VerifierFreshnessPolicy | null,
  now: number,
): FreshnessAssessment {
  const observed = Date.parse(observedAt);
  if (Number.isNaN(observed)) return { status: "invalid_timestamp" };
  const rawAge = now - observed;
  if (rawAge < -EVIDENCE_CLOCK_SKEW_MS) return { status: "invalid_timestamp" };
  const ageMs = Math.max(0, rawAge);

  const maxAgeMs = policy?.maxEvidenceAgeMs;
  if (typeof maxAgeMs !== "number" || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    return { status: "no_policy", ageMs };
  }
  return ageMs < maxAgeMs ? { status: "fresh", ageMs, maxAgeMs } : { status: "stale", ageMs, maxAgeMs };
}

/**
 * Parses a Retry-After header (delta-seconds or HTTP-date) into a delay in
 * ms, clamped to [0, MAX_RETRY_AFTER_MS]. Unparseable values return null so
 * the caller falls back to the default cooldown.
 */
export function parseRetryAfter(value: string | null | undefined, now: number): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;

  let delay: number;
  if (/^\d+$/.test(trimmed)) {
    delay = Number(trimmed) * 1000;
  } else {
    // An HTTP-date always contains a weekday/month name; without this,
    // Date.parse would read values like "-5" or "1.5" as years.
    if (!/[A-Za-z]/.test(trimmed)) return null;
    const at = Date.parse(trimmed);
    if (Number.isNaN(at)) return null;
    delay = at - now;
  }
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, delay));
}

/** Remaining cooldown; exactly at `availableAt` it is 0 and a refresh is allowed. */
export function cooldownRemainingMs(availableAt: number | null, now: number): number {
  return availableAt === null ? 0 : Math.max(0, availableAt - now);
}

export interface SourceOption {
  value: string;
  label: string;
  description: string;
  /** Known to this client. */
  known: boolean;
  /** Known AND advertised as supported by the backend; only these are selectable. */
  selectable: boolean;
}

/**
 * Every known source is listed (so unsupported ones are visible and labeled
 * as such), followed by any advertised source this client does not know,
 * which is never selectable.
 */
export function buildSourceOptions(supported: readonly string[]): SourceOption[] {
  const advertised = new Set(supported);
  const known: SourceOption[] = VERIFICATION_EVIDENCE_SOURCES.map((source) => ({
    value: source,
    ...VERIFICATION_EVIDENCE_SOURCE_LABELS[source],
    known: true,
    selectable: advertised.has(source),
  }));
  const unknown: SourceOption[] = [...advertised]
    .filter((source) => !isVerificationEvidenceSource(source))
    .map((source) => ({
      value: source,
      label: source,
      description: "This server advertised a source this app does not recognise.",
      known: false,
      selectable: false,
    }));
  return [...known, ...unknown];
}

export function firstSelectableSource(supported: readonly string[]): VerificationEvidenceSource | null {
  return VERIFICATION_EVIDENCE_SOURCES.find((source) => supported.includes(source)) ?? null;
}
