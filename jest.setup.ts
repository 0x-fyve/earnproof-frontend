import "@testing-library/jest-dom";
import { TextEncoder, TextDecoder } from "node:util";
import { webcrypto } from "node:crypto";

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
    private readonly bodyText: string;

    constructor(body: BodyInit | null = null, init: ResponseInit = {}) {
      this.status = init.status ?? 200;
      this.ok = this.status >= 200 && this.status < 300;
      this.bodyText = typeof body === "string" ? body : "";
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
