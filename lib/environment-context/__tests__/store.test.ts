/**
 * @jest-environment jsdom
 */

import { clearStoredEnvironment, readStoredEnvironment, storeEnvironment } from "../store";

describe("environment-context store", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to sandbox when nothing is stored", () => {
    expect(readStoredEnvironment("org-1")).toBe("sandbox");
  });

  it("defaults to sandbox for an empty organization id", () => {
    expect(readStoredEnvironment("")).toBe("sandbox");
  });

  it("stores and reads back production for a given organization", () => {
    storeEnvironment("org-1", "production");
    expect(readStoredEnvironment("org-1")).toBe("production");
  });

  it("scopes storage per organization id", () => {
    storeEnvironment("org-1", "production");
    storeEnvironment("org-2", "sandbox");

    expect(readStoredEnvironment("org-1")).toBe("production");
    expect(readStoredEnvironment("org-2")).toBe("sandbox");
  });

  it("falls back to sandbox when stored value is corrupted or invalid", () => {
    window.localStorage.setItem("earnproof.environment.org-1", "not-a-real-environment");
    expect(readStoredEnvironment("org-1")).toBe("sandbox");
  });

  it("clears the stored value for an organization", () => {
    storeEnvironment("org-1", "production");
    clearStoredEnvironment("org-1");
    expect(readStoredEnvironment("org-1")).toBe("sandbox");
  });

  it("does not throw when storing with an empty organization id", () => {
    expect(() => storeEnvironment("", "production")).not.toThrow();
  });
});
