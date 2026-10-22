import fs from "node:fs";
import path from "node:path";
import {
  buildSyntheticPayload,
  generateSyntheticRequestId,
  sanitizeResponseBody,
  sendSyntheticWebhookDelivery,
  signSyntheticPayload,
  SYNTHETIC_EVENT_TYPES,
} from "../synthetic-delivery";

describe("synthetic-delivery: structural separation from replayWebhookDelivery", () => {
  it("never references replayWebhookDelivery or imports lib/api/webhooks in its source", () => {
    const sourcePath = path.join(__dirname, "..", "synthetic-delivery.ts");
    const source = fs.readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/replayWebhookDelivery/);
    expect(source).not.toMatch(/from ["']@\/lib\/api\/webhooks["']/);
    expect(source).not.toMatch(/from ["']\.\.?\/.*\/api\/webhooks["']/);
  });

  it("sendSyntheticWebhookDelivery's only network side effect is a fetch to the given endpoint URL, never a delivery-replay endpoint path", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => "ok",
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await sendSyntheticWebhookDelivery({
      endpointUrl: "https://example.com/hook",
      secret: "test-secret",
      eventType: "proof.created",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("https://example.com/hook");
    expect(calledUrl).not.toMatch(/\/replay/);
  });
});

describe("synthetic-delivery: request id scheme", () => {
  it("generates ids prefixed with synthetic_", () => {
    const id = generateSyntheticRequestId();
    expect(id.startsWith("synthetic_")).toBe(true);
  });

  it("reuses the same request id across retries of the same send when one is supplied", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => "ok",
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const requestId = generateSyntheticRequestId();
    const first = await sendSyntheticWebhookDelivery({
      endpointUrl: "https://example.com/hook",
      secret: "secret",
      eventType: "proof.created",
      requestId,
    });
    const second = await sendSyntheticWebhookDelivery({
      endpointUrl: "https://example.com/hook",
      secret: "secret",
      eventType: "proof.created",
      requestId,
    });

    expect(first.requestId).toBe(requestId);
    expect(second.requestId).toBe(requestId);
  });
});

describe("synthetic-delivery: payload shape", () => {
  it.each(SYNTHETIC_EVENT_TYPES)("builds a synthetic=true payload for %s", (eventType) => {
    const payload = buildSyntheticPayload(eventType, "synthetic_abc");
    expect(payload.synthetic).toBe(true);
    expect(payload.type).toBe(eventType);
    expect(payload.id).toBe("synthetic_abc");
    expect(payload.data).toBeDefined();
  });
});

describe("synthetic-delivery: signature scheme (v1 — the only version in this codebase)", () => {
  it("signs with HMAC-SHA256 producing a v1=<hex> header value", async () => {
    const payload = buildSyntheticPayload("proof.created", "synthetic_sig");
    const { signature } = await signSyntheticPayload(payload, "test-secret");

    expect(signature.version).toBe("v1");
    expect(signature.headerValue).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(signature.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different signatures for different secrets over the same payload", async () => {
    const payload = buildSyntheticPayload("proof.created", "synthetic_sig2");
    const a = await signSyntheticPayload(payload, "secret-a");
    const b = await signSyntheticPayload(payload, "secret-b");

    expect(a.signature.signature).not.toBe(b.signature.signature);
  });

  it("never includes the raw secret anywhere in the signed output", async () => {
    const payload = buildSyntheticPayload("proof.created", "synthetic_sig3");
    const secret = "super-secret-value-should-not-leak";
    const { body, signature } = await signSyntheticPayload(payload, secret);

    expect(body).not.toContain(secret);
    expect(JSON.stringify(signature)).not.toContain(secret);
  });
});

describe("synthetic-delivery: response sanitization", () => {
  it("truncates an oversized response body", () => {
    const huge = Array.from({ length: 1000 }, () => "hello world ").join("");
    const sanitized = sanitizeResponseBody(huge);

    expect(sanitized.length).toBeLessThan(huge.length);
    expect(sanitized).toMatch(/truncated/);
  });

  it("redacts secret-shaped content (hex tokens, whsec_ prefixed keys) from a response body", () => {
    const body = JSON.stringify({
      message: "echoed signing secret",
      secret: "whsec_abcdef1234567890",
      hash: "a".repeat(40),
    });
    const sanitized = sanitizeResponseBody(body);

    expect(sanitized).not.toContain("whsec_abcdef1234567890");
    expect(sanitized).not.toContain("a".repeat(40));
    expect(sanitized).toContain("<redacted>");
  });
});

describe("synthetic-delivery: timeout handling", () => {
  it("reports timedOut when the POST does not resolve within timeoutMs", async () => {
    const fetchMock = jest.fn().mockImplementation(
      (_url: string, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            const err = new DOMException("Aborted", "AbortError");
            reject(err);
          });
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await sendSyntheticWebhookDelivery({
      endpointUrl: "https://example.com/hook",
      secret: "secret",
      eventType: "proof.created",
      timeoutMs: 20,
    });

    expect(result.timedOut).toBe(true);
    expect(result.statusCode).toBeNull();
    expect(result.errorMessage).toMatch(/timed out/i);
  }, 10000);
});

describe("synthetic-delivery: non-ok and network failure results", () => {
  it("reports ok=false with the status code for a non-2xx response", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      status: 500,
      ok: false,
      text: async () => "internal error",
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await sendSyntheticWebhookDelivery({
      endpointUrl: "https://example.com/hook",
      secret: "secret",
      eventType: "proof.created",
    });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(500);
  });
});
