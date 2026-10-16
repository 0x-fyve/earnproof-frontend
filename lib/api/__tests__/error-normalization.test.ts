import {
  normalizeError,
  isValidationError,
  isConflictError,
  isRetryableError,
  formatFieldErrors,
  type NormalizedError,
} from "../error-normalization";

describe("error-normalization", () => {
  describe("normalizeError", () => {
    describe("validation errors (400/422)", () => {
      it("should normalize 400 validation error with field errors", async () => {
        const error = new Error("HTTP 400: Bad Request") as Error & { statusCode?: number; body?: string };
        error.statusCode = 400;
        error.body = JSON.stringify({
          errors: {
            name: "Name is too short",
            website: ["Must be a valid URL"],
          },
        });

        const result = await normalizeError(error);

        expect(result.type).toBe("validation");
        expect(result.statusCode).toBe(400);
        expect(result.isRetryable).toBe(false);
        expect(result.fieldErrors).toEqual({
          name: "Name is too short",
          website: ["Must be a valid URL"],
        });
      });

      it("should normalize 422 unprocessable entity", async () => {
        const error = new Error("HTTP 422") as Error & { statusCode?: number; body?: string };
        error.statusCode = 422;
        error.body = JSON.stringify({
          validation_errors: {
            email: "Email already exists",
          },
        });

        const result = await normalizeError(error);

        expect(result.type).toBe("validation");
        expect(result.statusCode).toBe(422);
        expect(result.fieldErrors.email).toBe("Email already exists");
      });

      it("should extract message from validation error", async () => {
        const error = new Error("HTTP 400") as Error & { statusCode?: number; body?: string };
        error.statusCode = 400;
        error.body = JSON.stringify({
          message: "Validation failed",
          errors: {},
        });

        const result = await normalizeError(error);

        expect(result.message).toBe("Validation failed");
      });
    });

    describe("conflict errors (409)", () => {
      it("should normalize 409 conflict error", async () => {
        const error = new Error("HTTP 409: Conflict") as Error & { statusCode?: number; body?: string };
        error.statusCode = 409;
        error.body = JSON.stringify({
          message: "Resource was modified by another user",
        });

        const result = await normalizeError(error);

        expect(result.type).toBe("conflict");
        expect(result.statusCode).toBe(409);
        expect(result.isRetryable).toBe(true);
        expect(result.message).toBe("Resource was modified by another user");
      });

      it("should use default message for conflict without message field", async () => {
        const error = new Error("HTTP 409") as Error & { statusCode?: number; body?: string };
        error.statusCode = 409;
        error.body = JSON.stringify({});

        const result = await normalizeError(error);

        expect(result.type).toBe("conflict");
        expect(result.message).toContain("modified concurrently");
      });
    });

    describe("authorization errors (401/403)", () => {
      it("should normalize 401 unauthorized", async () => {
        const error = new Error("HTTP 401: Unauthorized") as Error & { statusCode?: number };
        error.statusCode = 401;

        const result = await normalizeError(error);

        expect(result.type).toBe("authorization");
        expect(result.statusCode).toBe(401);
        expect(result.isRetryable).toBe(false);
        expect(result.message).toContain("not authenticated");
      });

      it("should normalize 403 forbidden", async () => {
        const error = new Error("HTTP 403: Forbidden") as Error & { statusCode?: number };
        error.statusCode = 403;

        const result = await normalizeError(error);

        expect(result.type).toBe("authorization");
        expect(result.statusCode).toBe(403);
        expect(result.isRetryable).toBe(false);
        expect(result.message).toContain("permission");
      });
    });

    describe("network errors", () => {
      it("should normalize timeout error", async () => {
        const error = new Error("timeout");
        error.name = "AbortError";

        const result = await normalizeError(error);

        expect(result.type).toBe("network");
        expect(result.isRetryable).toBe(true);
        expect(result.message).toContain("timeout");
      });

      it("should normalize network error", async () => {
        const error = new Error("Network error");

        const result = await normalizeError(error);

        expect(result.type).toBe("network");
        expect(result.isRetryable).toBe(true);
      });

      it("should handle AbortError", async () => {
        const error = new Error("Aborted");
        error.name = "AbortError";

        const result = await normalizeError(error);

        expect(result.type).toBe("network");
      });
    });

    describe("server errors", () => {
      it("should mark 5xx errors as retryable", async () => {
        const error = new Error("HTTP 500: Internal Server Error") as Error & { statusCode?: number };
        error.statusCode = 500;

        const result = await normalizeError(error);

        expect(result.isRetryable).toBe(true);
      });

      it("should mark 4xx errors as non-retryable", async () => {
        const error = new Error("HTTP 404: Not Found") as Error & { statusCode?: number };
        error.statusCode = 404;

        const result = await normalizeError(error);

        expect(result.isRetryable).toBe(false);
      });
    });

    describe("unknown errors", () => {
      it("should handle non-Error objects", async () => {
        const result = await normalizeError("string error");

        expect(result.type).toBe("unknown");
        expect(result.message).toContain("unexpected error");
        expect(result.isRetryable).toBe(false);
      });

      it("should preserve original error", async () => {
        const error = new Error("Original error");
        const result = await normalizeError(error);

        expect(result.originalError).toBe(error);
      });
    });
  });

  describe("isValidationError", () => {
    it("should return true for validation type", () => {
      const error: NormalizedError = {
        message: "Validation failed",
        type: "validation",
        fieldErrors: {},
        isRetryable: false,
      };

      expect(isValidationError(error)).toBe(true);
    });

    it("should return true when fieldErrors exist", () => {
      const error: NormalizedError = {
        message: "Error",
        type: "conflict",
        fieldErrors: { name: "Required" },
        isRetryable: false,
      };

      expect(isValidationError(error)).toBe(true);
    });

    it("should return false otherwise", () => {
      const error: NormalizedError = {
        message: "Network error",
        type: "network",
        fieldErrors: {},
        isRetryable: true,
      };

      expect(isValidationError(error)).toBe(false);
    });
  });

  describe("isConflictError", () => {
    it("should return true for conflict type", () => {
      const error: NormalizedError = {
        message: "Conflict",
        type: "conflict",
        fieldErrors: {},
        statusCode: 409,
        isRetryable: true,
      };

      expect(isConflictError(error)).toBe(true);
    });

    it("should return false otherwise", () => {
      const error: NormalizedError = {
        message: "Validation",
        type: "validation",
        fieldErrors: {},
        isRetryable: false,
      };

      expect(isConflictError(error)).toBe(false);
    });
  });

  describe("isRetryableError", () => {
    it("should return isRetryable value", () => {
      const retryable: NormalizedError = {
        message: "Timeout",
        type: "network",
        fieldErrors: {},
        isRetryable: true,
      };

      const notRetryable: NormalizedError = {
        message: "Validation",
        type: "validation",
        fieldErrors: {},
        isRetryable: false,
      };

      expect(isRetryableError(retryable)).toBe(true);
      expect(isRetryableError(notRetryable)).toBe(false);
    });
  });

  describe("formatFieldErrors", () => {
    it("should format field errors, taking first if array", () => {
      const fieldErrors = {
        name: ["Too short", "Must be unique"],
        email: "Invalid email",
        website: [],
      };

      const formatted = formatFieldErrors(fieldErrors);

      expect(formatted.name).toBe("Too short");
      expect(formatted.email).toBe("Invalid email");
      expect(formatted.website).toBe(undefined);
    });

    it("should handle string errors", () => {
      const fieldErrors = {
        slug: "Invalid format",
      };

      const formatted = formatFieldErrors(fieldErrors);

      expect(formatted.slug).toBe("Invalid format");
    });
  });
});
