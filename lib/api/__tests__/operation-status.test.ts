import { fetchOperationStatus } from "../operation-status";
import { apiClient } from "../client";

jest.mock("../client", () => ({
  ...jest.requireActual("../client"),
  apiClient: jest.fn(),
}));

const mockApiClient = apiClient as jest.MockedFunction<typeof apiClient>;

describe("fetchOperationStatus", () => {
  beforeEach(() => {
    mockApiClient.mockReset();
  });

  it("returns the status response on success", async () => {
    mockApiClient.mockResolvedValue({ idempotencyKey: "key-1", state: "succeeded" });
    const result = await fetchOperationStatus("key-1", "token");
    expect(result.state).toBe("succeeded");
  });

  // Acceptance criterion: unknown/expired records must fail safely.
  it("normalizes a 404 (record aged out or never existed) to 'unknown', not a failure", async () => {
    mockApiClient.mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 }));
    const result = await fetchOperationStatus("key-missing", "token");
    expect(result.state).toBe("unknown");
  });

  // Acceptance criterion: cross-tenant isolation — a 403 for a key that
  // belongs to another tenant must not be surfaced as proof of failure.
  it("normalizes a 403 (cross-tenant access attempt) to 'unknown', not a failure", async () => {
    mockApiClient.mockRejectedValue(Object.assign(new Error("forbidden"), { statusCode: 403 }));
    const result = await fetchOperationStatus("key-other-tenant", "token");
    expect(result.state).toBe("unknown");
  });

  it("propagates other errors (e.g. 500) rather than masking them as 'unknown'", async () => {
    mockApiClient.mockRejectedValue(Object.assign(new Error("server error"), { statusCode: 500 }));
    await expect(fetchOperationStatus("key-1", "token")).rejects.toThrow("server error");
  });
});
