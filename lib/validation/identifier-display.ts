/**
 * Shared truncation/validation logic for cryptographic identifier
 * display (#229). Pure functions only — no DOM, no clipboard — so the
 * truncation math itself is independently testable from the component
 * that renders it.
 */

export type IdentifierKind = "wallet-address" | "transaction-hash" | "proof-id" | "credential-hash" | "key-id";

/**
 * How many leading/trailing characters to show in the compact view, kept
 * long enough that two similar-prefixed identifiers (e.g. two accounts
 * both starting "GA7Q...") remain visually distinguishable even before
 * expanding — a single truncation width that worked for short
 * identifiers would collapse many real Stellar addresses to an
 * indistinguishable "GA7Q...XYZ" for every account sharing that prefix.
 */
export const COMPACT_LEADING_CHARS = 8;
export const COMPACT_TRAILING_CHARS = 6;
/** Below this length, truncating saves nothing meaningful — show the full value. */
export const MIN_LENGTH_TO_TRUNCATE = COMPACT_LEADING_CHARS + COMPACT_TRAILING_CHARS + 4;

export interface IdentifierDisplayResult {
  /** True if the value is long enough that compact/expanded views actually differ. */
  isTruncatable: boolean;
  /** What to render when collapsed. Always derived from `value` — never a separate, potentially-stale copy. */
  compactLabel: string;
  /** The exact original value — this is what copy-to-clipboard must always use, never `compactLabel`. */
  fullValue: string;
}

/**
 * Computes the compact label for `value`. Truncation operates on the
 * value's own characters only (no normalization, no case-folding) so
 * "truncation never changes the copied value" holds structurally: the
 * compact label is only ever used for display, `fullValue` (an
 * unmodified copy of the input) is what every copy action reads.
 */
export function computeIdentifierDisplay(value: string): IdentifierDisplayResult {
  const trimmed = value ?? "";

  if (trimmed.length <= MIN_LENGTH_TO_TRUNCATE) {
    return { isTruncatable: false, compactLabel: trimmed, fullValue: trimmed };
  }

  const leading = trimmed.slice(0, COMPACT_LEADING_CHARS);
  const trailing = trimmed.slice(-COMPACT_TRAILING_CHARS);
  return {
    isTruncatable: true,
    compactLabel: `${leading}…${trailing}`,
    fullValue: trimmed,
  };
}

const KNOWN_KIND_LABELS: Record<IdentifierKind, string> = {
  "wallet-address": "Stellar wallet address",
  "transaction-hash": "transaction hash",
  "proof-id": "proof identifier",
  "credential-hash": "credential hash",
  "key-id": "key identifier",
};

export function describeIdentifierKind(kind: IdentifierKind): string {
  return KNOWN_KIND_LABELS[kind];
}

/**
 * True when `value` is empty, whitespace-only, or not a string at all —
 * the component must render an explicit "no value" state for this
 * rather than attempting to truncate/copy something meaningless
 * ("malformed values" per the issue's test requirements).
 */
export function isMalformedIdentifier(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}
