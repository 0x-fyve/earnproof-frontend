import {
  captureRevision,
  createEntityHash,
  extractRevision,
  isConflictError,
} from "../revision-tracking";
import { ApiConflictError } from "../client";
import type { Organization } from "../generated/v1";

describe("Revision Tracking", () => {
  describe("createEntityHash", () => {
    it("creates a stable hash for the same entity", () => {
      const entity = { id: "org-1", name: "Test Org", status: "ACTIVE" };
      const hash1 = createEntityHash(entity);
      const hash2 = createEntityHash(entity);

      expect(hash1).toBe(hash2);
    });

    it("creates different hashes for different entities", () => {
      const entity1 = { id: "org-1", name: "Test Org", status: "ACTIVE" };
      const entity2 = { id: "org-1", name: "Test Org", status: "SUSPENDED" };

      const hash1 = createEntityHash(entity1);
      const hash2 = createEntityHash(entity2);

      expect(hash1).not.toBe(hash2);
    });

    it("creates different hashes when any field changes", () => {
      const baseEntity = { id: "org-1", name: "Test Org", status: "ACTIVE" };
      const baseHash = createEntityHash(baseEntity);

      const changedName = { ...baseEntity, name: "Different Name" };
      const changedNameHash = createEntityHash(changedName);

      expect(baseHash).not.toBe(changedNameHash);

      const changedStatus = { ...baseEntity, status: "SUSPENDED" as const };
      const changedStatusHash = createEntityHash(changedStatus);

      expect(baseHash).not.toBe(changedStatusHash);
    });

    it("produces numeric string output", () => {
      const entity = { id: "test" };
      const hash = createEntityHash(entity);

      expect(typeof hash).toBe("string");
      expect(/^\d+$/.test(hash)).toBe(true);
    });
  });

  describe("captureRevision", () => {
    it("adds __revision and __loadedAt to entity", () => {
      const entity: Organization = {
        id: "org-1",
        name: "Test Org",
        slug: "test-org",
        status: "ACTIVE",
      };

      const withRevision = captureRevision(entity);

      expect(withRevision.__revision).toBeDefined();
      expect(withRevision.__loadedAt).toBeDefined();
      expect(typeof withRevision.__revision).toBe("string");
      expect(typeof withRevision.__loadedAt).toBe("string");
    });

    it("preserves original entity fields", () => {
      const entity: Organization = {
        id: "org-1",
        name: "Test Org",
        slug: "test-org",
        status: "ACTIVE",
      };

      const withRevision = captureRevision(entity);

      expect(withRevision.id).toBe(entity.id);
      expect(withRevision.name).toBe(entity.name);
      expect(withRevision.slug).toBe(entity.slug);
      expect(withRevision.status).toBe(entity.status);
    });

    it("uses provided loadedAt timestamp if given", () => {
      const entity: Organization = {
        id: "org-1",
        name: "Test Org",
        slug: "test-org",
        status: "ACTIVE",
      };

      const customDate = new Date("2024-01-15T10:30:00Z");
      const withRevision = captureRevision(entity, customDate);

      expect(withRevision.__loadedAt).toBe(customDate.toISOString());
    });

    it("uses current time if loadedAt not provided", () => {
      const entity: Organization = {
        id: "org-1",
        name: "Test Org",
        slug: "test-org",
        status: "ACTIVE",
      };

      const before = new Date();
      const withRevision = captureRevision(entity);
      const after = new Date();

      const loadedAt = new Date(withRevision.__loadedAt!);
      expect(loadedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(loadedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("creates consistent revision for same entity state", () => {
      const entity: Organization = {
        id: "org-1",
        name: "Test Org",
        slug: "test-org",
        status: "ACTIVE",
      };

      const rev1 = captureRevision(entity);
      const rev2 = captureRevision(entity);

      expect(rev1.__revision).toBe(rev2.__revision);
    });

    it("creates different revisions for different entity states", () => {
      const entity1: Organization = {
        id: "org-1",
        name: "Test Org",
        slug: "test-org",
        status: "ACTIVE",
      };

      const entity2: Organization = {
        id: "org-1",
        name: "Test Org",
        slug: "test-org",
        status: "SUSPENDED",
      };

      const rev1 = captureRevision(entity1);
      const rev2 = captureRevision(entity2);

      expect(rev1.__revision).not.toBe(rev2.__revision);
    });

    it("does not mutate original entity", () => {
      const entity: Organization = {
        id: "org-1",
        name: "Test Org",
        slug: "test-org",
        status: "ACTIVE",
      };

      const originalKeys = Object.keys(entity);
      const withRevision = captureRevision(entity);

      // Original entity should not have revision fields
      expect(Object.keys(entity)).toEqual(originalKeys);
      expect((entity as unknown as Record<string, unknown>).__revision).toBeUndefined();
      expect((entity as unknown as Record<string, unknown>).__loadedAt).toBeUndefined();

      // But returned object should have them
      expect(withRevision.__revision).toBeDefined();
      expect(withRevision.__loadedAt).toBeDefined();
    });
  });

  describe("extractRevision", () => {
    it("extracts revision info from entity", () => {
      const entity: Organization = {
        id: "org-1",
        name: "Test Org",
        slug: "test-org",
        status: "ACTIVE",
      };

      const withRevision = captureRevision(entity);
      const extracted = extractRevision(withRevision);

      expect(extracted.revision).toBe(withRevision.__revision);
      expect(extracted.loadedAt).toBe(withRevision.__loadedAt);
    });

    it("returns undefined for missing revision fields", () => {
      const entity: Record<string, unknown> = { id: "org-1", name: "Test Org" };
      const extracted = extractRevision(entity as unknown as { __revision?: string; __loadedAt?: number });

      expect(extracted.revision).toBeUndefined();
      expect(extracted.loadedAt).toBeUndefined();
    });

    it("handles partial revision info", () => {
      const entity: Record<string, unknown> = { __revision: "rev-123" };
      const extracted = extractRevision(entity as unknown as { __revision?: string; __loadedAt?: number });

      expect(extracted.revision).toBe("rev-123");
      expect(extracted.loadedAt).toBeUndefined();
    });
  });

  describe("isConflictError", () => {
    it("returns true for ApiConflictError", () => {
      const error = new ApiConflictError({ id: "test" });
      expect(isConflictError(error)).toBe(true);
    });

    it("returns false for regular Error", () => {
      const error = new Error("Something went wrong");
      expect(isConflictError(error)).toBe(false);
    });

    it("returns false for non-Error values", () => {
      expect(isConflictError("error string")).toBe(false);
      expect(isConflictError(null)).toBe(false);
      expect(isConflictError(undefined)).toBe(false);
      expect(isConflictError({})).toBe(false);
    });

    it("returns false for Error with statusCode 400", () => {
      const error = new Error("Bad request") as Error & { statusCode?: number };
      error.statusCode = 400;
      expect(isConflictError(error)).toBe(false);
    });

    it("returns true for Error with statusCode 409", () => {
      const error = new Error("Conflict") as Error & { statusCode?: number };
      error.statusCode = 409;
      expect(isConflictError(error)).toBe(true);
    });
  });

  describe("Integration: Load → Modify → Update Flow", () => {
    it("tracks entity through complete conflict detection flow", () => {
      // 1. Load entity
      const serverEntity: Organization = {
        id: "org-1",
        name: "Original Name",
        slug: "original",
        status: "ACTIVE",
      };

      const loadedEntity = captureRevision(serverEntity);
      const originalRevision = loadedEntity.__revision;

      // 2. Server entity changes
      const updatedServerEntity: Organization = {
        id: "org-1",
        name: "Updated Name",
        slug: "original",
        status: "SUSPENDED",
      };

      const updatedRevision = createEntityHash(updatedServerEntity);

      // 3. Revisions should differ
      expect(originalRevision).not.toBe(updatedRevision);

      // 4. Extract revision for sending to API
      const revisionInfo = extractRevision(loadedEntity);
      expect(revisionInfo.revision).toBe(originalRevision);

      // 5. Simulate conflict error response
      const conflictError = new ApiConflictError(updatedServerEntity);
      expect(isConflictError(conflictError)).toBe(true);
    });

    it("supports retry with updated revision after successful update", () => {
      // Initial load
      const entity: Organization = {
        id: "org-1",
        name: "Test Org",
        slug: "test",
        status: "ACTIVE",
      };

      const initial = captureRevision(entity);
      const initialRev = initial.__revision;

      // Simulate successful update
      const updated: Organization = {
        id: "org-1",
        name: "Updated Org",
        slug: "updated",
        status: "SUSPENDED",
      };

      const afterUpdate = captureRevision(updated);
      const updatedRev = afterUpdate.__revision;

      // Revision should change after update
      expect(initialRev).not.toBe(updatedRev);

      // New revision should be stable
      expect(updatedRev).toBe(createEntityHash(updated));
    });
  });
});
