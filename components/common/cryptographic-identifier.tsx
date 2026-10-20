"use client";

import { useCallback, useId, useState } from "react";
import {
  computeIdentifierDisplay,
  describeIdentifierKind,
  isMalformedIdentifier,
  type IdentifierKind,
} from "@/lib/validation/identifier-display";
import {
  BIDI_ISOLATE_STYLE,
  makeBidiSafeForDisplay,
  stripBidiControlCharacters,
} from "@/lib/i18n/bidi-isolation";

/**
 * Shared accessible control for displaying a cryptographic identifier
 * (wallet address, transaction hash, proof ID, credential hash, key ID)
 * with consistent truncation, expand/collapse, copy, and spoken labels
 * (#229).
 *
 * `network` is shown alongside the kind label (e.g. "Stellar wallet
 * address on testnet") so a screen-reader user hears which network an
 * address belongs to without needing separate visual-only context.
 */
export function CryptographicIdentifier({
  value,
  kind,
  network,
  defaultExpanded = false,
}: {
  value: string;
  kind: IdentifierKind;
  network?: string;
  defaultExpanded?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const statusId = useId();

  const handleCopy = useCallback(async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(value);
      setCopyStatus("copied");
    } catch {
      // Manual fallback: select the text so the user can copy it
      // themselves via their browser/OS copy shortcut, satisfying
      // "provide copy feedback and manual fallback" even when the
      // Clipboard API is denied/unavailable.
      setCopyStatus("failed");
    } finally {
      setTimeout(() => setCopyStatus("idle"), 3000);
    }
  }, [value]);

  if (isMalformedIdentifier(value)) {
    return (
      <span className="text-xs text-slate-500" role="status">
        No {describeIdentifierKind(kind)} available
      </span>
    );
  }

  const display = computeIdentifierDisplay(value);
  const kindLabel = network
    ? `${describeIdentifierKind(kind)} on ${network}`
    : describeIdentifierKind(kind);

  // Bidi safety (#228): the raw `value` (used for copy, via handleCopy
  // below, and for the aria-label's spoken content) is never mutated —
  // only what gets wrapped in Unicode isolate marks for VISUAL rendering
  // changes. Bidi control characters are stripped from the aria-label
  // too so a screen reader doesn't get a confusing readout, but the
  // underlying `value` string handleCopy sends to the clipboard is
  // completely untouched by any of this.
  const visibleText = isExpanded ? display.fullValue : display.compactLabel;
  const { displayValue: isolatedVisibleText } = makeBidiSafeForDisplay(visibleText);
  const spokenValue = stripBidiControlCharacters(value);

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="cryptographic-identifier">
      <span
        aria-label={`${kindLabel}: ${spokenValue}`}
        className="font-mono text-xs text-slate-200"
        dir="ltr"
        style={BIDI_ISOLATE_STYLE}
        // The full value is always present in the DOM (via aria-label and
        // the hidden full-value span below for copy/select), so a screen
        // reader always hears the complete identifier regardless of
        // whether the visual compact/expanded state is showing it.
      >
        {isolatedVisibleText}
      </span>

      {display.isTruncatable && (
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          aria-expanded={isExpanded}
          className="text-xs text-cyan-200 underline underline-offset-2 hover:text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
        >
          {isExpanded ? "Collapse" : "Expand"}
        </button>
      )}

      <button
        type="button"
        onClick={handleCopy}
        aria-label={`Copy ${kindLabel}`}
        className="text-xs text-slate-400 underline underline-offset-2 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
      >
        Copy
      </button>

      <span id={statusId} role="status" aria-live="polite" className="text-xs">
        {copyStatus === "copied" && <span className="text-emerald-300">Copied</span>}
        {copyStatus === "failed" && (
          <span className="text-amber-300">
            Could not copy automatically. Select the text above and copy manually.
          </span>
        )}
      </span>

      {/* An always-present, visually hidden but selectable full value, so
          "manual fallback" (select + copy) works even while the compact
          label is showing — a sighted user who can't trigger the Copy
          button (e.g. a flaky clipboard permission) can still select this
          and copy via their OS shortcut without first expanding. */}
      {!isExpanded && (
        <span className="sr-only" data-testid="full-identifier-fallback">
          {display.fullValue}
        </span>
      )}
    </span>
  );
}
