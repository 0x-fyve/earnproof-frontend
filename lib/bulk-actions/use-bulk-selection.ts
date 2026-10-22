"use client";

/**
 * React hook wrapper over lib/bulk-actions/selection-store.ts.
 *
 * Automatically reconciles the selection against `visibleIds` on every
 * render where `visibleIds` has changed (filter/page/data change) — this
 * is what makes the scoping contract in selection-store.ts hold
 * automatically for any consumer, rather than relying on every call site
 * remembering to call `reconcileWithVisibleRows` itself.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  EMPTY_SELECTION,
  clearSelection,
  isAllVisibleSelected,
  isSelected,
  isSomeVisibleSelected,
  reconcileWithVisibleRows,
  selectAllVisible,
  selectedIdsArray,
  selectionCount,
  toggleSelection,
  type SelectionState,
} from "./selection-store";

export interface UseBulkSelectionResult {
  selectedIds: string[];
  count: number;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  selectAllVisible: () => void;
  clear: () => void;
  isAllVisibleSelected: boolean;
  isSomeVisibleSelected: boolean;
}

export function useBulkSelection(visibleIds: readonly string[]): UseBulkSelectionResult {
  const [state, setState] = useState<SelectionState>(EMPTY_SELECTION);
  const previousVisibleIds = useRef<readonly string[]>(visibleIds);

  useEffect(() => {
    const prev = previousVisibleIds.current;
    const changed =
      prev.length !== visibleIds.length || prev.some((id, index) => id !== visibleIds[index]);
    if (changed) {
      previousVisibleIds.current = visibleIds;
      setState((current) => reconcileWithVisibleRows(current, visibleIds));
    }
     
  }, [visibleIds]);

  return useMemo(
    () => ({
      selectedIds: selectedIdsArray(state),
      count: selectionCount(state),
      isSelected: (id: string) => isSelected(state, id),
      toggle: (id: string) => setState((current) => toggleSelection(current, id)),
      selectAllVisible: () => setState(() => selectAllVisible(visibleIds)),
      clear: () => setState(() => clearSelection()),
      isAllVisibleSelected: isAllVisibleSelected(state, visibleIds),
      isSomeVisibleSelected: isSomeVisibleSelected(state, visibleIds),
    }),
    [state, visibleIds],
  );
}
