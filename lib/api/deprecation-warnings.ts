/**
 * API version deprecation and sunset warnings (#231).
 *
 * Parses the IETF-draft `Deprecation` and `Sunset` response headers
 * (https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-deprecation-header)
 * plus a `Link: <url>; rel="deprecation"` replacement-link header, all of
 * which this app's backend may set on any response once it starts
 * announcing deprecations. No endpoint for this exists in the OpenAPI
 * spec as a *body* field — these are headers, which `apiClient` (see
 * lib/api/client.ts) currently discards entirely after a successful
 * response, so this module is the parsing layer that makes the
 * information available at all.
 */

import { toSafeExternalHref } from "@/lib/validation/external-url";
import { appConfig } from "@/config/app";
import { formatDateTimeWithZone } from "@/lib/i18n/format";

export type DeprecationSeverity = "future" | "imminent" | "expired";

/** A sunset date within this many days of "now" is "imminent" rather than merely "future" — gives integrators a concrete heads-up window before the deadline. */
export const IMMINENT_WINDOW_DAYS = 30;

export interface ParsedDeprecationWarning {
  apiVersion: string | null;
  /** True once the `Deprecation` header is present at all, regardless of date. */
  isDeprecated: boolean;
  /** Parsed `Sunset` header value, or null if absent/unparseable. */
  sunsetAt: Date | null;
  severity: DeprecationSeverity | null;
  /** A validated, safe-to-render replacement link, or null if absent/malformed/untrusted. */
  replacementHref: string | null;
}

/**
 * Parses the `Deprecation`, `Sunset`, and `Link` headers from a Fetch
 * `Headers` object. Returns null if there is no deprecation signal at
 * all (both `Deprecation` and `Sunset` absent) — a response with
 * neither header is not a deprecation warning, not an error state.
 */
export function parseDeprecationHeaders(headers: Headers): ParsedDeprecationWarning | null {
  const deprecationHeader = headers.get("Deprecation");
  const sunsetHeader = headers.get("Sunset");

  if (!deprecationHeader && !sunsetHeader) {
    return null;
  }

  const isDeprecated = Boolean(deprecationHeader);
  const sunsetAt = sunsetHeader ? parseHttpDate(sunsetHeader) : null;
  const severity = sunsetAt ? classifySeverity(sunsetAt) : null;

  const linkHeader = headers.get("Link");
  const replacementHref = linkHeader ? extractSafeReplacementLink(linkHeader) : null;

  return {
    // The Deprecation header, per the draft spec, can carry an HTTP-date
    // (when deprecation took effect) rather than a version string; this
    // app has no reliable way to read "the current API version" from
    // response headers alone, so this is left null for now rather than
    // guessed at from the request path.
    apiVersion: null,
    isDeprecated,
    sunsetAt,
    severity,
    replacementHref,
  };
}

function parseHttpDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function classifySeverity(sunsetAt: Date, now: Date = new Date()): DeprecationSeverity {
  const msRemaining = sunsetAt.getTime() - now.getTime();
  if (msRemaining <= 0) return "expired";
  const daysRemaining = msRemaining / (1000 * 60 * 60 * 24);
  return daysRemaining <= IMMINENT_WINDOW_DAYS ? "imminent" : "future";
}

/**
 * Extracts a `rel="deprecation"` link from a standard HTTP `Link` header
 * value (which may contain multiple comma-separated links with
 * different rel values) and validates it with the same
 * `toSafeExternalHref` helper used for the Stellar explorer link
 * (lib/stellar/explorer.ts) — malformed URLs and non-http(s) schemes are
 * rejected, and the allowed origin is restricted to the API's own
 * origin, since a deprecation notice legitimately pointing anywhere
 * else would be unusual for this app's backend to emit. Returns null,
 * never a raw/unvalidated string, for anything that doesn't pass.
 */
export function extractSafeReplacementLink(linkHeaderValue: string): string | null {
  const parts = linkHeaderValue.split(",");
  for (const part of parts) {
    const match = part.match(/<([^>]*)>/);
    const relMatch = part.match(/rel="?deprecation"?/i);
    if (!match || !relMatch) continue;

    const rawUrl = match[1];
    const safe = toSafeExternalHref(rawUrl, {
      allowedOrigins: [appConfig.apiUrl],
      requireHttps: false,
    });
    if (safe.ok) {
      return safe.href;
    }
    // Found a rel="deprecation" link but it was malformed/untrusted —
    // deliberately return null rather than falling through to try
    // another part of the header, so a single bad link can't be
    // silently swapped for a different, possibly also-suspicious one.
    return null;
  }
  return null;
}

/**
 * Formats a sunset date with its exact date, time, and timezone, per
 * "warnings include exact dates and timezone" — never a vague relative
 * phrase like "soon" on its own. Delegates to the existing
 * `formatDateTimeWithZone` (lib/i18n/format.ts) rather than
 * reimplementing the dateStyle/timeZoneName ECMA-402 workaround it
 * already documents and handles.
 */
export function formatSunsetDateWithTimezone(date: Date): string {
  return formatDateTimeWithZone(date);
}
