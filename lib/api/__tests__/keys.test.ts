/**
 * @jest-environment jsdom
 */

import {
  validateApiKeyName,
  validateApiKeyScopes,
  formatApiKeyPrefix,
  hasKnownCreationDate,
  sortApiKeys,
  filterApiKeysByCreationAvailability,
  getApiKeys,
} from "../keys";
import type { ApiKey } from "../generated/v1";
import { ApiResponseValidationError } from "@/lib/validation/runtime-response";

describe("API Key Utilities", () => {
  describe("validateApiKeyName", () => {
    it("returns null for valid names", () => {
      expect(validateApiKeyName("My API Key")).toBeNull();
      expect(validateApiKeyName("test_key-123")).toBeNull();
      expect(validateApiKeyName("Production.Key")).toBeNull();
      expect(validateApiKeyName("Valid Key Name 123")).toBeNull();
    });

    it("requires non-empty name", () => {
      expect(validateApiKeyName("")).toBe("API key name is required");
      expect(validateApiKeyName("   ")).toBe("API key name is required");
    });

    it("requires minimum length", () => {
      expect(validateApiKeyName("ab")).toBe("API key name must be at least 3 characters");
    });

    it("enforces maximum length", () => {
      const longName = "a".repeat(65);
      expect(validateApiKeyName(longName)).toBe("API key name must be less than 64 characters");
    });

    it("only allows valid characters", () => {
      expect(validateApiKeyName("key@invalid")).toBe(
        "API key name can only contain letters, numbers, spaces, hyphens, underscores, and periods"
      );
      expect(validateApiKeyName("key#invalid")).toBe(
        "API key name can only contain letters, numbers, spaces, hyphens, underscores, and periods"
      );
    });

    it("trims whitespace", () => {
      expect(validateApiKeyName("  valid key  ")).toBeNull();
    });
  });

  describe("validateApiKeyScopes", () => {
    it("returns null for valid scopes", () => {
      expect(validateApiKeyScopes(["verification:read"])).toBeNull();
      expect(validateApiKeyScopes(["verification:read", "proofs:create"])).toBeNull();
    });

    it("requires at least one scope", () => {
      expect(validateApiKeyScopes([])).toBe("At least one scope is required");
    });

    it("rejects invalid scopes", () => {
      expect(validateApiKeyScopes(["invalid:scope"])).toBe("Invalid scopes: invalid:scope");
      expect(validateApiKeyScopes(["verification:read", "invalid:scope", "another:invalid"])).toBe(
        "Invalid scopes: invalid:scope, another:invalid"
      );
    });
  });

  describe("formatApiKeyPrefix", () => {
    it("returns short prefixes unchanged", () => {
      expect(formatApiKeyPrefix("ep_test")).toBe("ep_test");
      expect(formatApiKeyPrefix("12345678")).toBe("12345678");
    });

    it("truncates long prefixes", () => {
      expect(formatApiKeyPrefix("ep_test_long_prefix")).toBe("ep_test_...");
      expect(formatApiKeyPrefix("very_long_prefix")).toBe("very_lon...");
    });

    it("handles edge case of exactly 8 characters", () => {
      expect(formatApiKeyPrefix("exactly8")).toBe("exactly8");
    });
  });

  describe("hasKnownCreationDate (#323)", () => {
    it("returns true for a valid ISO timestamp", () => {
      expect(hasKnownCreationDate({ createdAt: "2026-01-15T09:30:00.000Z" })).toBe(true);
    });

    it("returns false when createdAt is null", () => {
      expect(hasKnownCreationDate({ createdAt: null })).toBe(false);
    });

    it("returns false when createdAt is undefined", () => {
      expect(hasKnownCreationDate({ createdAt: undefined })).toBe(false);
    });

    it("returns false when createdAt is an empty string", () => {
      expect(hasKnownCreationDate({ createdAt: "" })).toBe(false);
    });

    it("fails safe (false) for an unparseable string rather than throwing", () => {
      expect(hasKnownCreationDate({ createdAt: "not-a-date" })).toBe(false);
    });
  });

  describe("sortApiKeys (#323)", () => {
    const keyA: ApiKey = {
      id: "a",
      name: "Alpha",
      prefix: "ep_a",
      scopes: ["proofs:read"],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const keyB: ApiKey = {
      id: "b",
      name: "Beta",
      prefix: "ep_b",
      scopes: ["proofs:read"],
      createdAt: "2026-02-01T00:00:00.000Z",
    };
    const keyNoDate: ApiKey = {
      id: "c",
      name: "Zeta-no-date",
      prefix: "ep_c",
      scopes: ["proofs:read"],
      createdAt: null,
    };

    it("sorts by creation date descending (newest first)", () => {
      const result = sortApiKeys([keyA, keyB], "created-desc");
      expect(result.map((k) => k.id)).toEqual(["b", "a"]);
    });

    it("sorts by creation date ascending (oldest first)", () => {
      const result = sortApiKeys([keyB, keyA], "created-asc");
      expect(result.map((k) => k.id)).toEqual(["a", "b"]);
    });

    it("always orders keys with an unknown creation date after keys with a known one, in both directions", () => {
      const desc = sortApiKeys([keyNoDate, keyB, keyA], "created-desc");
      expect(desc.map((k) => k.id)).toEqual(["b", "a", "c"]);

      const asc = sortApiKeys([keyNoDate, keyB, keyA], "created-asc");
      expect(asc.map((k) => k.id)).toEqual(["a", "b", "c"]);
    });

    it("sorts multiple unknown-date keys among themselves by name", () => {
      const anotherNoDate: ApiKey = { ...keyNoDate, id: "d", name: "Aardvark-no-date" };
      const result = sortApiKeys([keyNoDate, anotherNoDate], "created-desc");
      expect(result.map((k) => k.id)).toEqual(["d", "c"]);
    });

    it("sorts by name ascending and descending", () => {
      expect(sortApiKeys([keyB, keyA], "name-asc").map((k) => k.id)).toEqual(["a", "b"]);
      expect(sortApiKeys([keyA, keyB], "name-desc").map((k) => k.id)).toEqual(["b", "a"]);
    });

    it("does not mutate the input array", () => {
      const input = [keyB, keyA];
      const inputCopy = [...input];
      sortApiKeys(input, "created-asc");
      expect(input).toEqual(inputCopy);
    });
  });

  describe("filterApiKeysByCreationAvailability (#323)", () => {
    const withDate: ApiKey = {
      id: "a",
      name: "Has Date",
      prefix: "ep_a",
      scopes: ["proofs:read"],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const withoutDate: ApiKey = {
      id: "b",
      name: "No Date",
      prefix: "ep_b",
      scopes: ["proofs:read"],
      createdAt: null,
    };

    it("returns all keys when availability is 'all'", () => {
      expect(filterApiKeysByCreationAvailability([withDate, withoutDate], "all")).toEqual([
        withDate,
        withoutDate,
      ]);
    });

    it("returns only keys with a known creation date when availability is 'known'", () => {
      expect(filterApiKeysByCreationAvailability([withDate, withoutDate], "known")).toEqual([
        withDate,
      ]);
    });

    it("returns only keys with an unavailable creation date when availability is 'unavailable'", () => {
      expect(
        filterApiKeysByCreationAvailability([withDate, withoutDate], "unavailable"),
      ).toEqual([withoutDate]);
    });
  });

  describe("getApiKeys response validation (#327)", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("resolves with the list when every item matches the ApiKey schema", async () => {
      const apiKeys = [
        { id: "k1", name: "Key One", prefix: "ep_1", scopes: ["proofs:read"], createdAt: null },
      ];
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: new Headers(),
        json: async () => apiKeys,
      } as Response);

      await expect(getApiKeys("token", new AbortController().signal)).resolves.toEqual(apiKeys);
    });

    it("rejects with ApiResponseValidationError when an item is missing a required field", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: new Headers(),
        json: async () => [{ id: "k1", scopes: ["proofs:read"] }], // missing name, prefix
      } as Response);

      await expect(getApiKeys("token", new AbortController().signal)).rejects.toBeInstanceOf(
        ApiResponseValidationError,
      );
    });

    it("rejects with ApiResponseValidationError when the response is not an array at all", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: new Headers(),
        json: async () => ({ unexpected: "shape" }),
      } as Response);

      await expect(getApiKeys("token", new AbortController().signal)).rejects.toBeInstanceOf(
        ApiResponseValidationError,
      );
    });
  });
});