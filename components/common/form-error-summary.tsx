"use client";

import { useEffect, useRef } from "react";
import type { FieldError } from "@/lib/validation/form-error-summary";

/**
 * Reusable form-level error summary with focus navigation (#230).
 *
 * On first appearing with one or more errors, focus moves to the
 * summary itself (so a screen-reader user, or anyone tabbing, lands on
 * "here is what's wrong" right after a failed submission, rather than
 * focus staying wherever the submit button was or silently going
 * nowhere). Clicking an entry moves focus to that field directly — this
 * component only calls `.focus()` on the target element; it never
 * touches form state, so no entered data is lost by navigating via the
 * summary.
 *
 * The component does not fetch/compute errors itself — `errors` is
 * already-merged, already-visible-filtered data (see
 * lib/validation/form-error-summary.ts's `mergeFieldErrors` /
 * `filterVisibleFieldErrors`), kept that way so this component's own
 * logic stays limited to rendering and focus management.
 */
export function FormErrorSummary({
  errors,
  heading = "There is a problem",
}: {
  errors: FieldError[];
  heading?: string;
}) {
  const summaryRef = useRef<HTMLDivElement>(null);
  const previousErrorCount = useRef(0);

  useEffect(() => {
    if (errors.length > 0 && previousErrorCount.current === 0) {
      summaryRef.current?.focus();
    }
    previousErrorCount.current = errors.length;
  }, [errors.length]);

  if (errors.length === 0) {
    return null;
  }

  function focusField(fieldId: string) {
    const target = document.getElementById(fieldId);
    // Returning focus to the field "without losing entered data" holds
    // by construction here: this only calls .focus(), never anything
    // that could reset or re-mount the field (no key change, no value
    // assignment).
    target?.focus();
  }

  return (
    <div
      ref={summaryRef}
      role="alert"
      tabIndex={-1}
      aria-labelledby="form-error-summary-heading"
      className="rounded-lg border border-rose-300/40 bg-rose-300/10 p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300"
      data-testid="form-error-summary"
    >
      <h2 id="form-error-summary-heading" className="text-sm font-semibold text-rose-100">
        {heading}
      </h2>
      <ul className="mt-2 grid gap-1 text-sm text-rose-200">
        {errors.map((error) => (
          <li key={error.fieldId}>
            <a
              href={`#${error.fieldId}`}
              onClick={(event) => {
                event.preventDefault();
                focusField(error.fieldId);
              }}
              className="underline underline-offset-2 hover:text-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300"
            >
              {error.label}: {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
