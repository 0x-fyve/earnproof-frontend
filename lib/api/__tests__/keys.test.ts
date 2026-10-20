/**
 * @jest-environment jsdom
 */

import { validateApiKeyName, validateApiKeyScopes, formatApiKeyPrefix } from "../keys";

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
});