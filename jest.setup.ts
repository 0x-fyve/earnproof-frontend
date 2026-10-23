import "@testing-library/jest-dom";
import { TextEncoder, TextDecoder } from "node:util";
import { webcrypto } from "node:crypto";
import { ReadableStream } from "node:stream/web";

// jsdom doesn't implement the Streams API; Node's node:stream/web does.
// Needed by TestResponse's body getter below, mirroring a real fetch
// Response's streamable body (lib/api/client.ts's bounded-read path, #328).
if (typeof globalThis.ReadableStream === "undefined") {
  globalThis.ReadableStream = ReadableStream as unknown as typeof globalThis.ReadableStream;
}

// jsdom doesn't implement TextEncoder/TextDecoder; Node's util module does.
// Needed by anything that pulls in lib/validation/qr-payload.ts (byte-length
// checks on proof IDs), directly or transitively.
if (typeof globalThis.TextEncoder === "undefined") {
  globalThis.TextEncoder = TextEncoder as typeof globalThis.TextEncoder;
}
if (typeof globalThis.TextDecoder === "undefined") {
  globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
}

// jsdom's window.crypto only implements getRandomValues, not SubtleCrypto —
// needed by lib/credentials/verify-digest.ts's SHA-256 digest verification.
// Node's own webcrypto implementation is spec-compliant, so reuse it rather
// than adding a mocking library.
if (typeof globalThis.crypto === "undefined" || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

if (typeof globalThis.structuredClone === "undefined") {
  globalThis.structuredClone = <T>(value: T): T =>
    JSON.parse(JSON.stringify(value)) as T;
}

if (typeof globalThis.Response === "undefined") {
  class TestResponse {
    readonly status: number;
    readonly ok: boolean;
    readonly headers: Headers;
    private readonly bodyText: string;

    constructor(body: BodyInit | null = null, init: ResponseInit = {}) {
      this.status = init.status ?? 200;
      this.ok = this.status >= 200 && this.status < 300;
      this.bodyText = typeof body === "string" ? body : "";
      this.headers = new Headers(init.headers);
      // Real fetch Responses report Content-Length; mirror that here so
      // code that preflights on it (e.g. lib/api/client.ts's #328 size
      // budget) sees realistic behavior under test.
      if (!this.headers.has("content-length") && this.bodyText.length > 0) {
        this.headers.set(
          "content-length",
          String(new TextEncoder().encode(this.bodyText).byteLength),
        );
      }
    }

    get body(): ReadableStream<Uint8Array> | null {
      if (this.bodyText.length === 0) return null;
      const bytes = new TextEncoder().encode(this.bodyText);
      let sent = false;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sent) {
            controller.enqueue(bytes);
            sent = true;
          } else {
            controller.close();
          }
        },
      });
    }

    async json(): Promise<unknown> {
      return JSON.parse(this.bodyText);
    }

    async text(): Promise<string> {
      return this.bodyText;
    }
  }

  globalThis.Response = TestResponse as unknown as typeof Response;
}

if (typeof globalThis.fetch === "undefined") {
  globalThis.fetch = jest.fn() as unknown as typeof fetch;
}

if (typeof URL.createObjectURL === "undefined") {
  URL.createObjectURL = jest.fn(() => "blob:earnproof-test") as unknown as typeof URL.createObjectURL;
}

if (typeof URL.revokeObjectURL === "undefined") {
  URL.revokeObjectURL = jest.fn() as unknown as typeof URL.revokeObjectURL;
}

// jsdom doesn't implement matchMedia. Components that gate print-only
// content on `window.matchMedia("print").matches` (see usePrintMode.ts)
// need this to exist and report "not printing" so that content isn't
// rendered into the DOM during tests, where it would otherwise duplicate
// on-screen text and break getByText/getByRole uniqueness assumptions.
if (typeof window.matchMedia === "undefined") {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
}

// The session lives in memory (never in browser storage), so it survives
// between tests in a file unless it is reset explicitly. Required lazily so a
// test file's own jest.mock() calls still apply to lib/session's dependencies.
function resetSession() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const session = require("@/lib/session") as Partial<typeof import("@/lib/session")>;
  // Some suites replace lib/session with a partial mock; nothing to reset there.
  session.resetSessionForTests?.();
}
beforeEach(resetSession);
afterEach(resetSession);
