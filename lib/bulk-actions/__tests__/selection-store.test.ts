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
} from "../selection-store";

describe("selection-store", () => {
  describe("toggleSelection", () => {
    it("adds an unselected id and removes an already-selected id", () => {
      const afterAdd = toggleSelection(EMPTY_SELECTION, "a");
      expect(isSelected(afterAdd, "a")).toBe(true);

      const afterRemove = toggleSelection(afterAdd, "a");
      expect(isSelected(afterRemove, "a")).toBe(false);
    });
  });

  describe("selectAllVisible", () => {
    it("selects exactly the given visible ids and nothing else (selection-scoping contract)", () => {
      const state = selectAllVisible(["a", "b", "c"]);
      expect(selectedIdsArray(state).sort()).toEqual(["a", "b", "c"]);
      expect(isSelected(state, "d")).toBe(false);
    });

    it("replaces a prior selection rather than merging with it", () => {
      const prior = toggleSelection(EMPTY_SELECTION, "z");
      const next = selectAllVisible(["a", "b"]);
      // selectAllVisible does not consult `prior` — this test documents
      // that the caller is expected to call it fresh, not merge results.
      expect(selectedIdsArray(next).sort()).toEqual(["a", "b"]);
      expect(prior).not.toBe(next);
    });
  });

  describe("reconcileWithVisibleRows — filter/pagination boundary", () => {
    it("prunes a selected id that is no longer visible after a filter change, never expanding to unfiltered data", () => {
      const selected = selectAllVisible(["a", "b", "c"]);
      // Filter changes; now only "b" matches.
      const reconciled = reconcileWithVisibleRows(selected, ["b"]);
      expect(selectedIdsArray(reconciled)).toEqual(["b"]);
    });

    it("prunes a selected id that is no longer visible after a page change", () => {
      const selected = selectAllVisible(["a", "b"]);
      // Page changes to a different page with different rows.
      const reconciled = reconcileWithVisibleRows(selected, ["c", "d"]);
      expect(selectionCount(reconciled)).toBe(0);
    });

    it("never re-adds or reinterprets a selection as broader than visibleIds", () => {
      const selected = selectAllVisible(["a"]);
      const reconciled = reconcileWithVisibleRows(selected, ["a", "b", "c", "d", "e"]);
      // Even though many more rows are now visible, the selection must stay
      // exactly what it was — reconcile only prunes, it never adds.
      expect(selectedIdsArray(reconciled)).toEqual(["a"]);
    });

    it("keeps a selection scoped to only the rows still actually visible when some but not all rows persist", () => {
      const selected = selectAllVisible(["a", "b", "c"]);
      const reconciled = reconcileWithVisibleRows(selected, ["b", "c", "d"]);
      expect(selectedIdsArray(reconciled).sort()).toEqual(["b", "c"]);
    });

    it("returns the same reference when nothing needs pruning (no-op optimization)", () => {
      const selected = selectAllVisible(["a", "b"]);
      const reconciled = reconcileWithVisibleRows(selected, ["a", "b", "c"]);
      expect(reconciled).toBe(selected);
    });
  });

  describe("isAllVisibleSelected / isSomeVisibleSelected", () => {
    it("is true only when every visible row is selected and nothing extra", () => {
      const state = selectAllVisible(["a", "b"]);
      expect(isAllVisibleSelected(state, ["a", "b"])).toBe(true);
      expect(isAllVisibleSelected(state, ["a", "b", "c"])).toBe(false);
    });

    it("reports indeterminate (some but not all) correctly", () => {
      const state = toggleSelection(EMPTY_SELECTION, "a");
      expect(isSomeVisibleSelected(state, ["a", "b"])).toBe(true);
      expect(isAllVisibleSelected(state, ["a", "b"])).toBe(false);
    });

    it("is false for an empty visible set even with a non-empty selection", () => {
      const state = selectAllVisible(["a"]);
      expect(isAllVisibleSelected(state, [])).toBe(false);
    });
  });

  describe("clearSelection", () => {
    it("empties the selection", () => {
      const state = selectAllVisible(["a", "b"]);
      const cleared = clearSelection();
      expect(selectionCount(cleared)).toBe(0);
      expect(selectionCount(state)).toBe(2);
    });
  });
});
