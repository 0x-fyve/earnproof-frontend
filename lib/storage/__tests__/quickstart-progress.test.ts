/**
 * @jest-environment jsdom
 */

import {
  loadQuickstartProgress,
  saveQuickstartProgress,
  clearQuickstartProgress,
} from "../quickstart-progress";
import { type StorageDriver } from "../index";

describe("quickstart progress persistence", () => {
  let mockDriver: StorageDriver;
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    mockDriver = {
      getItem: (key) => storage[key] || null,
      setItem: (key, value) => {
        storage[key] = value;
      },
      removeItem: (key) => {
        delete storage[key];
      },
    };
  });

  it("returns an empty checklist when nothing is stored", () => {
    const progress = loadQuickstartProgress(mockDriver);
    expect(progress.completedSteps).toEqual([]);
  });

  it("round-trips saved progress", () => {
    saveQuickstartProgress(
      { completedSteps: ["select-scopes", "create-key"], updatedAt: "2026-10-19T00:00:00.000Z" },
      mockDriver,
    );
    const loaded = loadQuickstartProgress(mockDriver);
    expect(loaded.completedSteps).toEqual(["select-scopes", "create-key"]);
  });

  it("clears progress", () => {
    saveQuickstartProgress({ completedSteps: ["select-scopes"], updatedAt: "2026-10-19T00:00:00.000Z" }, mockDriver);
    clearQuickstartProgress(mockDriver);
    expect(loadQuickstartProgress(mockDriver).completedSteps).toEqual([]);
  });

  it("drops unrecognized step ids rather than trusting corrupt storage (negative case)", () => {
    storage["QUICKSTART_PROGRESS"] = JSON.stringify({
      version: 1,
      timestamp: "2026-10-19T00:00:00.000Z",
      key: "QUICKSTART_PROGRESS",
      data: { completedSteps: ["select-scopes", "not-a-real-step"], updatedAt: "2026-10-19T00:00:00.000Z" },
    });
    const loaded = loadQuickstartProgress(mockDriver);
    expect(loaded.completedSteps).toEqual(["select-scopes"]);
  });

  it("security guard: never persists anything resembling a secret, even if a caller tries to smuggle one in", () => {
    // markStepComplete's type signature only accepts a QuickstartStep, so a
    // real call site cannot pass a secret through the typed path. This
    // guards the storage layer itself: even an untyped/JS caller writing
    // through saveQuickstartProgress's `state` argument can only persist
    // whatever is inside `completedSteps`/`updatedAt`, and this module
    // never reads or forwards any other field from its argument.
    const stateWithExtraField = {
      completedSteps: ["select-scopes"],
      updatedAt: "2026-10-19T00:00:00.000Z",
      secret: "sk_live_should_never_be_stored",
    } as unknown as Parameters<typeof saveQuickstartProgress>[0];

    saveQuickstartProgress(stateWithExtraField, mockDriver);

    const rawStored = JSON.stringify(storage);
    expect(rawStored).not.toContain("sk_live_should_never_be_stored");
  });
});
