/**
 * Developer quickstart checklist persistence (#232).
 *
 * Security/privacy guarantee: only step identifiers (e.g. "select-scopes",
 * "create-key") are ever persisted here. An API secret, key id, or any
 * request/response payload from the quickstart's test request must never
 * be passed into `saveQuickstartProgress` - there is no field for one, by
 * design, so a future caller cannot "accidentally" widen this to store a
 * secret without changing this file's shape first.
 */

import {
  getStorageValue,
  setStorageValue,
  removeStorageValue,
  type StorageDriver,
  localStorageDriver,
} from "./index";
import {
  QUICKSTART_STEPS,
  type QuickstartChecklistState,
  type QuickstartStep,
} from "@/lib/developers/quickstart";

function isQuickstartStep(value: string): value is QuickstartStep {
  return (QUICKSTART_STEPS as readonly string[]).includes(value);
}

export function loadQuickstartProgress(
  driver: StorageDriver = localStorageDriver,
): QuickstartChecklistState {
  try {
    const stored = getStorageValue("QUICKSTART_PROGRESS", driver);
    if (!stored?.data) {
      return { completedSteps: [], updatedAt: new Date(0).toISOString() };
    }

    const completedSteps = stored.data.completedSteps.filter(isQuickstartStep);
    return { completedSteps, updatedAt: stored.data.updatedAt };
  } catch {
    return { completedSteps: [], updatedAt: new Date(0).toISOString() };
  }
}

export function saveQuickstartProgress(
  state: QuickstartChecklistState,
  driver: StorageDriver = localStorageDriver,
): void {
  try {
    setStorageValue(
      "QUICKSTART_PROGRESS",
      { data: { completedSteps: state.completedSteps, updatedAt: state.updatedAt } },
      driver,
    );
  } catch {
    // Non-fatal: progress just won't persist across a reload.
  }
}

export function clearQuickstartProgress(driver: StorageDriver = localStorageDriver): void {
  removeStorageValue("QUICKSTART_PROGRESS", driver);
}
