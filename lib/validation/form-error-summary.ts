/**
 * Shared data model for form-level error summaries with focus navigation
 * (#230). Pure logic only — no DOM, no React — so merging/deduplication
 * is independently testable from the component that renders it.
 */

export interface FieldError {
  /** A stable DOM id for the invalid field — what the summary link's href/focus target points at. Must be unique even for nested/repeated fields (e.g. "items.2.amount", not just "amount"). */
  fieldId: string;
  /** Human-readable field label, shown in the summary entry. */
  label: string;
  message: string;
  /** Where the error came from — used only for merge/dedup decisions, never shown to the user as a separate "source" label. */
  source: "client" | "server";
}

/**
 * Merges client-side and server-side validation errors for the same
 * field set, without duplicating an entry for a field that has errors
 * from both sources. Dedup key is `fieldId` alone (not fieldId+message):
 * if both a client check and a server response flag the same field,
 * only one summary entry is shown for it, and "server and client
 * validation errors merge without duplication" means exactly one entry,
 * not two with different wording for the same field.
 *
 * When both sources have an error for the same field, the message
 * chosen is the SERVER one — a server validation error is authoritative
 * (it reflects what the backend actually rejected), whereas a client
 * check is often just an early, possibly looser approximation of the
 * same rule.
 */
export function mergeFieldErrors(clientErrors: FieldError[], serverErrors: FieldError[]): FieldError[] {
  const byFieldId = new Map<string, FieldError>();

  for (const error of clientErrors) {
    byFieldId.set(error.fieldId, error);
  }
  // Server errors are applied second so they win the dedup when both
  // sources flag the same fieldId.
  for (const error of serverErrors) {
    byFieldId.set(error.fieldId, error);
  }

  return [...byFieldId.values()];
}

/**
 * Filters `errors` down to only the fields that are currently visible in
 * the DOM ("only current visible errors are listed" — a field that was
 * removed, e.g. a dynamic/conditional field toggled off after
 * submission, must not leave a dangling summary entry pointing at
 * nothing). `isFieldVisible` is injected rather than this module reading
 * the DOM itself, so the filtering logic stays testable without jsdom.
 */
export function filterVisibleFieldErrors(
  errors: FieldError[],
  isFieldVisible: (fieldId: string) => boolean,
): FieldError[] {
  return errors.filter((error) => isFieldVisible(error.fieldId));
}

/**
 * Validates that every error's `fieldId` is unique within the list —
 * "nested and repeated fields have unique stable targets" is a
 * requirement on the CALLER (whoever builds the FieldError list for a
 * repeated field group must include the index/key in fieldId, e.g.
 * "items.2.amount"), and this function exists so that requirement is
 * checkable/testable rather than only enforced by convention.
 */
export function findDuplicateFieldIds(errors: FieldError[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const error of errors) {
    if (seen.has(error.fieldId)) {
      duplicates.add(error.fieldId);
    }
    seen.add(error.fieldId);
  }
  return [...duplicates];
}
