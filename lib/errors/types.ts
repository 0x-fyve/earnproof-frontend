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
