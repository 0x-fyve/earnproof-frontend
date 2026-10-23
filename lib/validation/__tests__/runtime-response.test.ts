import { z } from "zod";
import { ApiResponseValidationError, validateApiResponse } from "../runtime-response";

describe("validateApiResponse (#327)", () => {
  const schema = z.object({
    id: z.string(),
    count: z.number(),
  });

  it("returns the parsed value when the data matches the schema", () => {
    const data = { id: "abc", count: 3 };
    expect(validateApiResponse(schema, data)).toEqual(data);
  });

  it("throws ApiResponseValidationError when a required field is missing", () => {
    expect(() => validateApiResponse(schema, { id: "abc" })).toThrow(ApiResponseValidationError);
  });

  it("throws ApiResponseValidationError when a field has the wrong type", () => {
    expect(() => validateApiResponse(schema, { id: "abc", count: "not-a-number" })).toThrow(
      ApiResponseValidationError,
    );
  });

  it("throws when the response is null or not an object", () => {
    expect(() => validateApiResponse(schema, null)).toThrow(ApiResponseValidationError);
    expect(() => validateApiResponse(schema, "a string")).toThrow(ApiResponseValidationError);
    expect(() => validateApiResponse(schema, 42)).toThrow(ApiResponseValidationError);
  });

  it("records the invalid field paths and messages without echoing any data value", () => {
    try {
      validateApiResponse(schema, { id: "abc", count: "nope" });
      throw new Error("expected validateApiResponse to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiResponseValidationError);
      const validationError = error as ApiResponseValidationError;
      expect(validationError.issues).toEqual([
        expect.objectContaining({ path: "count" }),
      ]);
      // The issue list must never contain the rejected value itself.
      expect(JSON.stringify(validationError.issues)).not.toContain("nope");
    }
  });

  it("allows additive/unknown fields through a passthrough schema (forward compatibility)", () => {
    const passthroughSchema = z.object({ id: z.string() }).passthrough();
    const data = { id: "abc", newField: "server added this" };
    expect(validateApiResponse(passthroughSchema, data)).toEqual(data);
  });

  it("rejects unknown fields when the schema is strict", () => {
    const strictSchema = z.object({ id: z.string() }).strict();
    expect(() => validateApiResponse(strictSchema, { id: "abc", extra: true })).toThrow(
      ApiResponseValidationError,
    );
  });
});
