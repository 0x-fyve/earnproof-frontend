/**
 * Signed webhook payload replay debugger (#250).
 *
 * This module builds and sends SYNTHETIC webhook deliveries — fabricated
 * payloads, freshly signed, POSTed straight to a configured endpoint's URL.
 * It exists so developers can validate their webhook receivers without ever
 * touching a real stored delivery, a real secret's storage path, or a real
 * production event.
 *
 * Structural safety guarantee: this module does not import anything from
 * the webhooks API client module and never calls the real delivery-replay
 * function (or any other function that mutates/replays a stored delivery).
 * It only knows how to (1) fabricate a payload, (2) sign it, and (3) POST it
 * directly with `fetch`. There is no code path here that can reach a real
 * delivery ID, because this module never accepts one as input —
 * `sendSyntheticWebhookDelivery` takes an endpoint URL + secret + payload,
 * nothing resembling a delivery identifier. A dedicated test asserts this
 * module's source text never references that replay function by name.
 */

const SYNTHETIC_REQUEST_ID_PREFIX = "synthetic_";
const SIGNATURE_HEADER = "X-Webhook-Signature";
const TIMESTAMP_HEADER = "X-Webhook-Timestamp";
const REQUEST_ID_HEADER = "X-Webhook-Request-Id";
const SIGNATURE_VERSION = "v1";

/** The only synthetic event types this debugger can fabricate. Mirrors the
 * real event types used elsewhere in the webhook UI (see
 * components/webhooks/webhook-delivery-logs.tsx's `eventTypes` filter list),
 * since those are the only shapes this codebase defines a payload for. */
export const SYNTHETIC_EVENT_TYPES = ["proof.created", "proof.verified", "proof.revoked"] as const;

export type SyntheticEventType = (typeof SYNTHETIC_EVENT_TYPES)[number];

export interface SyntheticWebhookPayload {
  /** Always prefixed `synthetic_` — never looks like a real event id. */
  id: string;
  type: SyntheticEventType;
  createdAt: string;
  synthetic: true;
  data: Record<string, unknown>;
}

export interface SyntheticSignature {
  /** The signing scheme version. Only one exists in this codebase today
   * (see module doc below) — this field exists so a future v2 scheme can be
   * introduced without a breaking change to the UI or this type. */
  version: "v1";
  /** Hex-encoded HMAC-SHA256 digest. Never the secret itself. */
  signature: string;
  timestamp: string;
  /** The exact header value sent on the wire, e.g. "v1=<hex>". */
  headerValue: string;
}

export interface SyntheticDeliveryRequest {
  endpointUrl: string;
  /** The webhook's real signing secret. Used only in-memory to compute the
   * HMAC — never returned, logged, or rendered by this module. */
  secret: string;
  eventType: SyntheticEventType;
  /** Reuse across retries of the "same" synthetic send so repeated attempts
   * are idempotent/retry-safe and distinguishable in receiver logs. */
  requestId?: string;
  timeoutMs?: number;
}

export interface SyntheticDeliveryResult {
  requestId: string;
  statusCode: number | null;
  ok: boolean;
  timedOut: boolean;
  durationMs: number;
  /** Bounded, sanitized response body — see sanitizeResponseBody. Never the
   * raw body verbatim. */
  responseBodyPreview: string;
  errorMessage: string | null;
}

/**
 * Mints a retry-safe synthetic request id. Distinct from any real delivery
 * id format in lib/api/webhooks.ts (those are opaque server-assigned ids
 * with no fixed prefix) so a receiver or log reader can tell at a glance
 * that this was never a real production delivery.
 */
export function generateSyntheticRequestId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${SYNTHETIC_REQUEST_ID_PREFIX}${random}`;
}

/**
 * Builds a synthetic payload matching the real shape for each event type,
 * mirroring the fields the real system sends (webhookId, eventType,
 * timestamps) per lib/api/webhooks.ts's `WebhookDelivery`/event conventions,
 * but with placeholder data — never a real proof id, wallet address, or
 * tenant value.
 */
export function buildSyntheticPayload(
  eventType: SyntheticEventType,
  requestId: string,
): SyntheticWebhookPayload {
  const createdAt = new Date().toISOString();
  const basePayload = {
    id: requestId,
    type: eventType,
    createdAt,
    synthetic: true as const,
  };

  switch (eventType) {
    case "proof.created":
      return {
        ...basePayload,
        data: {
          proofId: "EP-SYNTHETIC-0000",
          status: "PENDING",
          createdAt,
        },
      };
    case "proof.verified":
      return {
        ...basePayload,
        data: {
          proofId: "EP-SYNTHETIC-0000",
          status: "VERIFIED",
          verifiedAt: createdAt,
        },
      };
    case "proof.revoked":
      return {
        ...basePayload,
        data: {
          proofId: "EP-SYNTHETIC-0000",
          status: "REVOKED",
          revokedAt: createdAt,
        },
      };
    default: {
      const exhaustive: never = eventType;
      throw new Error(`Unsupported synthetic event type: ${String(exhaustive)}`);
    }
  }
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Signs a synthetic payload with HMAC-SHA256 over `${timestamp}.${body}`,
 * the same timestamped-HMAC construction used by the major webhook signing
 * conventions this codebase's `WebhookSecretDisplay` and `rotateWebhook`
 * assume on the receiving end (the frontend has no server-side signing code
 * to mirror directly — there is exactly one scheme in play here, so this
 * module defines and documents it as "v1" rather than inventing versions
 * that don't exist elsewhere in the codebase).
 */
export async function signSyntheticPayload(
  payload: SyntheticWebhookPayload,
  secret: string,
): Promise<{ body: string; signature: SyntheticSignature }> {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signedContent = `${timestamp}.${body}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
  const signatureHex = toHex(digest);

  return {
    body,
    signature: {
      version: "v1",
      signature: signatureHex,
      timestamp,
      headerValue: `${SIGNATURE_VERSION}=${signatureHex}`,
    },
  };
}

const MAX_RESPONSE_BODY_CHARS = 2000;

/** Shapes that look like secrets/credentials and must never reach the UI
 * verbatim, even inside an echoed response body from a test endpoint. */
const SECRET_SHAPED_PATTERNS: ReadonlyArray<RegExp> = [
  /\bwhsec_[A-Za-z0-9_]+\b/g,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/g, // long base64-ish blobs
  /-----BEGIN[\s\S]*?-----END[^-]*-----/g, // PEM blocks
  /\b[A-Fa-f0-9]{32,}\b/g, // hex secrets/signatures/tokens
];

/**
 * Bounds and redacts a raw response body before it is ever rendered.
 * Oversized bodies are truncated; anything secret-shaped is replaced with a
 * placeholder. This runs unconditionally — callers must never render the
 * untouched body.
 */
export function sanitizeResponseBody(raw: string): string {
  let sanitized = raw;
  for (const pattern of SECRET_SHAPED_PATTERNS) {
    sanitized = sanitized.replace(pattern, "<redacted>");
  }

  if (sanitized.length > MAX_RESPONSE_BODY_CHARS) {
    sanitized = `${sanitized.slice(0, MAX_RESPONSE_BODY_CHARS)}… (truncated, ${raw.length} chars total)`;
  }

  return sanitized;
}

const DEFAULT_SYNTHETIC_TIMEOUT_MS = 10_000;

/**
 * Sends a synthetic, freshly-signed payload directly to an endpoint URL.
 *
 * This is the ONLY send path this module exposes. It never imports from the
 * webhooks API client module, never accepts a delivery id, and cannot be
 * made to call the real delivery-replay function — that function's name
 * does not appear anywhere in this file (enforced by a dedicated test
 * reading this module's source).
 */
export async function sendSyntheticWebhookDelivery(
  request: SyntheticDeliveryRequest,
): Promise<SyntheticDeliveryResult> {
  const requestId = request.requestId ?? generateSyntheticRequestId();
  const payload = buildSyntheticPayload(request.eventType, requestId);
  const { body, signature } = await signSyntheticPayload(payload, request.secret);

  const controller = new AbortController();
  const timeoutMs = request.timeoutMs ?? DEFAULT_SYNTHETIC_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const startedAt = Date.now();
  try {
    const response = await fetch(request.endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [SIGNATURE_HEADER]: signature.headerValue,
        [TIMESTAMP_HEADER]: signature.timestamp,
        [REQUEST_ID_HEADER]: requestId,
      },
      body,
      signal: controller.signal,
    });

    const durationMs = Date.now() - startedAt;
    let rawBody = "";
    try {
      rawBody = await response.text();
    } catch {
      rawBody = "";
    }

    return {
      requestId,
      statusCode: response.status,
      ok: response.ok,
      timedOut: false,
      durationMs,
      responseBodyPreview: sanitizeResponseBody(rawBody),
      errorMessage: null,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return {
      requestId,
      statusCode: null,
      ok: false,
      timedOut,
      durationMs,
      responseBodyPreview: "",
      errorMessage: timedOut
        ? "The synthetic delivery timed out waiting for a response."
        : error instanceof Error
          ? error.message
          : "The synthetic delivery failed.",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
