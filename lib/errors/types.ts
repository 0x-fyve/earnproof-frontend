/**
 * Represents a safe error response that can be shown to users
 * Contains only allowlisted identifiers, no sensitive data
 */
export type ApiErrorResponse = {
  /**
   * HTTP status code
   */
  status: number;

  /**
   * User-facing error message
   */
  message: string;

  /**
   * Support-safe request identifier (if available)
   * Used for customer support and debugging
   */
  requestId?: string;

  /**
   * Optional correlation ID for distributed tracing
   */
  correlationId?: string;
};

/**
 * Error thrown by API client with safe error reference data
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly requestId?: string;
  public readonly correlationId?: string;

  constructor(response: ApiErrorResponse) {
    super(response.message);
    this.name = "ApiError";
    this.status = response.status;
    this.requestId = response.requestId;
    this.correlationId = response.correlationId;
  }
}

/**
 * Thrown when an API response violates the client's content-type or
 * byte-size contract (#328): a missing/mismatched content-type, a
 * Content-Length (or streamed size) over the configured budget, or a
 * missing body on an endpoint that requires one. The response body is
 * never parsed or logged when this error is thrown — a reason is always
 * available without needing to look at the (possibly non-JSON, possibly
 * huge) body.
 */
export class ApiResponseContractError extends Error {
  public readonly reason:
    | "missing_content_type"
    | "unexpected_content_type"
    | "content_length_exceeded"
    | "stream_size_exceeded"
    | "missing_body";
  public readonly status?: number;
  public readonly contentType?: string | null;
  public readonly contentLength?: number | null;

  constructor(params: {
    reason: ApiResponseContractError["reason"];
    message: string;
    status?: number;
    contentType?: string | null;
    contentLength?: number | null;
  }) {
    super(params.message);
    this.name = "ApiResponseContractError";
    this.reason = params.reason;
    this.status = params.status;
    this.contentType = params.contentType;
    this.contentLength = params.contentLength;
  }
}
