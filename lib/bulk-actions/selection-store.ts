/**
 * Scoped multi-select state for bulk admin actions (#251).
 *
 * SELECTION-SCOPING CONTRACT (the #251 acceptance criterion this module
 * exists to satisfy):
 *
 *   - A selection is always a concrete `Set<string>` of row IDs drawn from
 *     the rows the caller currently considers "visible" (i.e. whatever is
 *     on screen after the active filter + pagination have been applied).
 *     It is never a query/filter description, and it is never "all rows
 *     matching the filter on the server."
 *   - "Select all" (`selectAllVisible`) means exactly one thing: select
 *     every row ID in the `visibleIds` array passed to it at the moment
 *     it's called. It can never expand to rows outside that array.
 *   - Whenever the set of visible rows changes — a filter changes, the
 *     page changes, or the server returns a different page of results —
 *     the caller MUST call `reconcileWithVisibleRows(selection, visibleIds)`.
 *     That function prunes any selected ID that is no longer in
 *     `visibleIds`. It never adds IDs. This is what stops a selection from
 *     "silently reinterpreting" itself as something broader once the scope
 *     that produced it is gone — a row that scrolls out of the current
 *     filter/page is simply no longer selected.
 *   - There is deliberately no API in this module for "select everything
 *     matching the current filter across all pages." A caller that wants
 *     that distinct, more dangerous action must implement it as its own
 *     explicit, separately-labeled affordance (e.g. a dedicated "select
 *     all N matching results" button that itself calls a bulk endpoint
 *     designed for unbounded scope) — it must never be the implicit
 *     meaning of the checkbox-in-the-header "select all" control.
 */

export interface SelectionState {
  selectedIds: ReadonlySet<string>;
}

export const EMPTY_SELECTION: SelectionState = { selectedIds: new Set() };

export function toggleSelection(state: SelectionState, id: string): SelectionState {
  const next = new Set(state.selectedIds);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return { selectedIds: next };
}

/**
 * Selects every row currently visible. Scoped strictly to `visibleIds` —
 * see the contract above. Replaces (not merges with) the prior selection,
 * since "select all" is read as "select all of what I can see right now,"
 * not "add these to whatever I had selected under a different scope."
 */
export function selectAllVisible(visibleIds: readonly string[]): SelectionState {
  return { selectedIds: new Set(visibleIds) };
}

export function clearSelection(): SelectionState {
  return { selectedIds: new Set() };
}

export function isSelected(state: SelectionState, id: string): boolean {
  return state.selectedIds.has(id);
}

/**
 * True only when every currently-visible row is selected AND nothing
 * outside the visible set is selected. Used to drive the header
 * checkbox's checked/indeterminate state.
 */
export function isAllVisibleSelected(
  state: SelectionState,
  visibleIds: readonly string[],
): boolean {
  if (visibleIds.length === 0) return false;
  return visibleIds.every((id) => state.selectedIds.has(id));
}

export function isSomeVisibleSelected(
  state: SelectionState,
  visibleIds: readonly string[],
): boolean {
  return visibleIds.some((id) => state.selectedIds.has(id));
}

/**
 * The core scoping guard. Prunes any selected ID that is not in the
 * current `visibleIds` (because the filter changed, the page changed, or
 * the row itself disappeared from the latest server response). Never adds
 * an ID. Idempotent: calling it twice in a row with the same `visibleIds`
 * is a no-op on the second call.
 *
 * Returns the SAME `state` reference (not a new object) when nothing
 * needed pruning, so callers can use referential equality to skip a
 * re-render.
 */
export function reconcileWithVisibleRows(
  state: SelectionState,
  visibleIds: readonly string[],
): SelectionState {
  const visible = new Set(visibleIds);
  let changed = false;
  const next = new Set<string>();
  for (const id of state.selectedIds) {
    if (visible.has(id)) {
      next.add(id);
    } else {
      changed = true;
    }
  }
  return changed ? { selectedIds: next } : state;
}

export function selectionCount(state: SelectionState): number {
  return state.selectedIds.size;
}

export function selectedIdsArray(state: SelectionState): string[] {
  return Array.from(state.selectedIds);
}
