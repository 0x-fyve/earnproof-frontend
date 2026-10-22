import type { ZodType } from "zod";

/**
 * Validates untrusted JSON at the API boundary (#327).
 *
 * Generated TypeScript types (`lib/api/generated/v1.ts`) only protect
 * compilation: they tell the compiler what shape to *expect*, but a
 * malformed or version-skewed response still passes through `apiClient`'s
 * `response.json() as Promise<TResponse>` as a trusted object at runtime,
 * with nothing to catch a backend that silently renamed a field or
 * returned null where the type promises a string. This module is the
 * opt-in runtime check: callers pass a Zod schema alongside the expected
 * type, and a response that doesn't match it never reaches application
 * code as "valid" data.
 *
 * Deliberately NOT adopted repo-wide: wiring every one of the dozens of
 * `apiClient<T>()` call sites with a matching schema in one PR is far
 * beyond #327's stated scope ("add versioned runtime schemas at the API
 * boundary" - a pattern, not a mandate to migrate every endpoint at once).
 * This lands the validator, its API-key schemas, and api-keys.ts migrated
 * as the first representative call site; the rest can adopt it endpoint
 * by endpoint without needing another cross-cutting change.
 */

/**
 * Thrown when a response fails schema validation. Deliberately distinct
 * from ApiError/ApiNetworkError (#327's "must remain distinguishable from
 * transport errors") - a 200 with a malformed body is a contract problem,
 * not a network or HTTP-status problem, and callers that only catch
 * ApiError would otherwise treat it as if nothing came back at all.
 *
 * `issues` is a short, structural summary (path + validation message) for
 * logging/telemetry. It intentionally never includes the response body or
 * any field value - just which fields were wrong and why - because a
 * validation failure is exactly the moment the payload can't be trusted,
 * so it must not be echoed into logs, UI, or error reports (#327's
 * "failures must not expose response bodies or private values").
 */
export class ApiResponseValidationError extends Error {
  public readonly issues: Array<{ path: string; message: string }>;

  constructor(issues: Array<{ path: string; message: string }>, message = "API response did not match the expected schema.") {
    super(message);
    this.name = "ApiResponseValidationError";
    this.issues = issues;
    Object.setPrototypeOf(this, ApiResponseValidationError.prototype);
  }
}

/**
 * Parses `data` against `schema`, throwing ApiResponseValidationError (never
 * returning a partially-trusted value) on mismatch. Unknown/additional
 * fields on the response are allowed through by default - Zod object
 * schemas are permissive unless declared `.strict()` - so a server adding a
 * new field is forward-compatible (an additive, non-breaking change) rather
 * than failing validation; only fields the schema actually declares are
 * checked.
 */
export function validateApiResponse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    throw new ApiResponseValidationError(issues);
  }
  return result.data;
}
