/**
 * Fixture-based tests for scripts/storage-schema-audit.js (issue #304).
 * Every fixture is a synthetic temp tree: no real keys, tokens or wallets.
 */

import fs from "fs";
import os from "os";
import path from "path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { auditStorage, findSecretWord } = require("../../scripts/storage-schema-audit.js") as {
  auditStorage: (options: { root: string; scanDirs?: string[] }) => {
    success: boolean;
    errors: string[];
    warnings: string[];
    diagnostics: { errors: { code: string; file: string; line: number }[] };
    stats: { filesScanned: number; accessFiles: number; entries: number };
  };
  findSecretWord: (name: string) => string | null;
};

type Entry = Record<string, unknown>;

function entry(overrides: Entry = {}): Entry {
  return {
    id: "THEME",
    key: "earnproof.theme",
    match: "exact",
    area: "local",
    scope: "browser",
    classification: "preference",
    format: "envelope",
    schemaVersion: 1,
    owner: "lib/theme.ts",
    accessors: ["lib/theme.ts"],
    retention: "Until reset.",
    cleanup: "Removed on reset.",
    description: "Synthetic theme preference.",
    ...overrides,
  };
}

const SAFE_THEME = `
export function read() { return window.localStorage.getItem("earnproof.theme"); }
export function write(v: string) { window.localStorage.setItem("earnproof.theme", v); }
`;

let root: string;

function build(files: Record<string, string>, registry: Partial<{ entries: Entry[]; retired: unknown[]; otherMechanisms: unknown[] }> = {}) {
  const full = { registryVersion: 1, entries: [entry()], retired: [], otherMechanisms: [], ...registry };
  const all: Record<string, string> = { "lib/storage/registry.json": JSON.stringify(full), ...files };
  for (const [rel, content] of Object.entries(all)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return auditStorage({ root, scanDirs: ["lib", "components", "app"] });
}

function codes(result: ReturnType<typeof build>) {
  return result.diagnostics.errors.map((d) => d.code);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "storage-audit-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("registered, declared storage", () => {
  it("passes when a registered key is used by a declared accessor", () => {
    const result = build({ "lib/theme.ts": SAFE_THEME });

    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
    expect(result.stats).toMatchObject({ accessFiles: 1, entries: 1 });
  });

  it("passes for prefix keys with a user-scoped template", () => {
    const result = build(
      { "lib/notes.ts": 'export const k = (id: string) => `earnproof.notes.${id}`;\nexport const r = (id: string) => window.localStorage.getItem(k(id));' },
      { entries: [entry({ id: "NOTES", key: "earnproof.notes.", match: "prefix", scope: "user", owner: "lib/notes.ts", accessors: ["lib/notes.ts"] })] },
    );
    expect(result.errors).toEqual([]);
  });

  it("ignores storage words in comments and test files", () => {
    const result = build({
      "lib/theme.ts": SAFE_THEME,
      "lib/comment-only.ts": "// uses localStorage.setItem('earnproof.nope', token)\n/* localStorage */\nexport const x = 1;",
      "lib/theme.test.ts": "window.localStorage.setItem('earnproof.undeclared', 'x');",
      "lib/__tests__/other.ts": "window.localStorage.setItem('earnproof.undeclared', 'x');",
    });
    expect(result.errors).toEqual([]);
  });

  it("finds storage reads inside an inline script string", () => {
    const result = build({
      "lib/theme.ts": SAFE_THEME,
      "app/layout.tsx": 'export const script = `var v = window.localStorage.getItem(${JSON.stringify("earnproof.theme")});`;',
    });
    // One for the inline access, one for the registered key used by a file that is not its accessor.
    expect(codes(result)).toEqual(["UNDECLARED_STORAGE_ACCESS", "UNDECLARED_STORAGE_ACCESS"]);
    expect(result.errors.every((e) => e.includes("app/layout.tsx"))).toBe(true);
  });
});

describe("undeclared and unregistered persistence", () => {
  it("fails a file that touches storage without being a declared accessor", () => {
    const result = build({ "lib/theme.ts": SAFE_THEME, "components/rogue.tsx": "export const r = () => window.sessionStorage.getItem('anything');" });

    expect(codes(result)).toEqual(["UNDECLARED_STORAGE_ACCESS"]);
    expect(result.errors[0]).toBe(
      "[UNDECLARED_STORAGE_ACCESS] components/rogue.tsx:1: sessionStorage is used here but this file is not a declared accessor of any registered key.",
    );
  });

  it("fails an unregistered earnproof key even in a declared accessor file", () => {
    const result = build({
      "lib/theme.ts": SAFE_THEME + '\nwindow.localStorage.setItem("earnproof.extra", "1");',
    });
    expect(codes(result)).toEqual(["UNREGISTERED_STORAGE_KEY"]);
  });

  it("fails when a file uses a key owned by another entry", () => {
    const result = build(
      { "lib/theme.ts": SAFE_THEME, "lib/other.ts": 'window.localStorage.getItem("earnproof.theme");' },
      { entries: [entry(), entry({ id: "OTHER", key: "earnproof.other", owner: "lib/other.ts", accessors: ["lib/other.ts"] })] },
    );
    expect(codes(result)).toEqual(["UNDECLARED_STORAGE_ACCESS"]);
  });

  it("fails when the registered area does not match the storage used", () => {
    const result = build({ "lib/theme.ts": SAFE_THEME.replace(/localStorage/g, "sessionStorage") });
    expect(codes(result)).toContain("WRONG_STORAGE_AREA");
  });

  it.each([
    ["indexedDB", "export const open = () => indexedDB.open('db');"],
    ["cookie", "export const set = () => { document.cookie = 'a=b'; };"],
  ])("fails undeclared %s persistence", (_name, source) => {
    const result = build({ "lib/theme.ts": SAFE_THEME, "lib/other.ts": source });
    expect(codes(result)).toEqual(["UNDECLARED_PERSISTENCE_MECHANISM"]);
  });

  it("accepts indexedDB when it is explicitly declared", () => {
    const result = build(
      { "lib/theme.ts": SAFE_THEME, "lib/other.ts": "export const open = () => indexedDB.open('db');" },
      { otherMechanisms: [{ mechanism: "indexedDB", files: ["lib/other.ts"] }] },
    );
    expect(result.errors).toEqual([]);
  });

  it("fails a stale accessor that no longer touches storage", () => {
    const result = build({ "lib/theme.ts": "export const x = 1;" });
    expect(codes(result)).toEqual(["STALE_REGISTRY_ACCESSOR"]);
  });
});

describe("retired keys and secrets", () => {
  const retired = [{ key: "earnproof.session", reason: "Bearer tokens stay in memory.", removedBy: ["lib/session.ts"], since: "2026-10" }];

  it("lets the declared remover delete a retired key", () => {
    const result = build(
      { "lib/theme.ts": SAFE_THEME, "lib/session.ts": 'window.localStorage.removeItem("earnproof.session");' },
      { retired },
    );
    expect(result.errors).toEqual([]);
  });

  it("fails any other file that references a retired key", () => {
    const result = build(
      { "lib/theme.ts": SAFE_THEME, "components/legacy.tsx": 'const raw = window.localStorage.getItem("earnproof.session");' },
      { retired },
    );
    expect(codes(result)).toContain("RETIRED_STORAGE_KEY");
  });

  it("fails a write to a retired key from the remover itself", () => {
    const result = build(
      { "lib/theme.ts": SAFE_THEME, "lib/session.ts": 'window.localStorage.setItem("earnproof.session", "x");' },
      { retired },
    );
    expect(codes(result)).toContain("RETIRED_STORAGE_KEY_WRITE");
  });

  it("rejects raw tokens and private proof material in stored values", () => {
    const result = build({
      "lib/theme.ts": SAFE_THEME + "\nexport const save = (sessionToken: string) => window.localStorage.setItem('earnproof.theme', sessionToken);",
    });
    expect(codes(result)).toEqual(["UNSAFE_PERSISTED_VALUE"]);
    expect(result.errors[0]).toContain('"sessionToken"');
  });

  it("rejects secret-named fields in a file that writes storage", () => {
    const result = build({
      "lib/theme.ts": SAFE_THEME + "\nexport type Stored = { theme: string; privateKey: string; witness: string };",
    });
    expect(codes(result)).toEqual(["UNSAFE_PERSISTED_FIELD", "UNSAFE_PERSISTED_FIELD"]);
  });

  it("allows a declared exception with a reason, and nothing else", () => {
    const source = SAFE_THEME + "\nexport type R = { token: string; signature: string };";
    const result = build({ "lib/theme.ts": source }, {
      entries: [entry({ allowedFields: [{ name: "token", reason: "Returned once, never written." }] })],
    });
    expect(codes(result)).toEqual(["UNSAFE_PERSISTED_FIELD"]);
    expect(result.errors[0]).toContain('"signature"');
  });

  it("does not flag read-only files for secret-named types", () => {
    const result = build({
      "lib/theme.ts": 'export type Session = { token: string };\nexport const r = () => window.localStorage.getItem("earnproof.theme");',
    });
    expect(result.errors).toEqual([]);
  });
});

describe("secret word boundaries", () => {
  it.each([
    ["token", "token"],
    ["accessToken", "token"],
    ["refresh_token", "token"],
    ["API_KEY", "apikey"],
    ["apiKey", "apikey"],
    ["privateKey", "privatekey"],
    ["mnemonic", "mnemonic"],
    ["Authorization", "authorization"],
    ["tokenHash", null],
    ["tokenId", null],
    ["secretDigest", null],
    ["tokenizer", null],
    ["theme", null],
    ["publicKey", null],
  ])("%s -> %s", (name, expected) => {
    expect(findSecretWord(name)).toBe(expected);
  });
});

describe("registry validation", () => {
  it.each([
    ["secret classification", entry({ classification: "secret" }), "classification"],
    ["missing retention", entry({ retention: "" }), "retention is required"],
    ["missing cleanup", entry({ cleanup: " " }), "cleanup is required"],
    ["invalid schema version", entry({ schemaVersion: 0 }), "schemaVersion"],
    ["fractional schema version", entry({ schemaVersion: 1.5 }), "schemaVersion"],
    ["unknown format", entry({ format: "free-form" }), "format"],
    ["secret-like key name", entry({ key: "earnproof.auth-token" }), "secret-like word"],
    ["non-earnproof key", entry({ key: "theme" }), "key must start with"],
    ["prefix without separator", entry({ match: "prefix", key: "earnproof.notes" }), "end with a separator"],
    ["no accessors", entry({ accessors: [] }), "accessors"],
    ["missing file", entry({ accessors: ["lib/missing.ts"] }), "does not exist"],
    ["allowed field without reason", entry({ allowedFields: [{ name: "token" }] }), "name and a reason"],
  ])("rejects %s", (_name, bad, fragment) => {
    const result = build({ "lib/theme.ts": SAFE_THEME }, { entries: [bad] });
    expect(result.success).toBe(false);
    expect(codes(result)).toContain("REGISTRY_INVALID");
    expect(result.errors.join("\n")).toContain(fragment);
  });

  it("rejects duplicate ids, duplicate keys and shadowing prefixes", () => {
    const result = build({ "lib/theme.ts": SAFE_THEME }, {
      entries: [
        entry(),
        entry(),
        entry({ id: "PREFIX", key: "earnproof.", match: "prefix" }),
      ],
    });
    const text = result.errors.join("\n");
    expect(text).toContain("duplicate id");
    expect(text).toContain("duplicate key");
    expect(text).toContain("shadows");
  });

  it("fails clearly when the registry is missing or malformed", () => {
    fs.mkdirSync(path.join(root, "lib"), { recursive: true });
    expect(auditStorage({ root }).errors[0]).toMatch(/^\[REGISTRY_INVALID\] lib\/storage\/registry\.json:1: Cannot read registry/);

    fs.mkdirSync(path.join(root, "lib/storage"), { recursive: true });
    fs.writeFileSync(path.join(root, "lib/storage/registry.json"), "{not json");
    expect(auditStorage({ root }).success).toBe(false);

    fs.writeFileSync(path.join(root, "lib/storage/registry.json"), JSON.stringify({ entries: "nope" }));
    expect(auditStorage({ root }).errors[0]).toContain('"entries" array');
  });
});

describe("determinism and warnings", () => {
  it("reports unversioned legacy schemas as warnings, never as errors", () => {
    const result = build({ "lib/theme.ts": SAFE_THEME }, { entries: [entry({ format: "legacy-unversioned" })] });
    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([
      '[UNVERSIONED_STORAGE_SCHEMA] lib/theme.ts:1: THEME ("earnproof.theme") persists an unversioned shape. Invalid data is discarded on read; move it to the versioned envelope in lib/storage when it next changes.',
    ]);
  });

  it("orders diagnostics by file, line and code regardless of write order", () => {
    const files: Record<string, string> = {
      "lib/theme.ts": SAFE_THEME,
      "components/b.tsx": "window.localStorage.getItem('x');",
      "components/a.tsx": "\n\nwindow.localStorage.getItem('x');",
      "app/z.tsx": "window.localStorage.getItem('x');",
    };
    const first = build(files).errors;
    const reversed = build(Object.fromEntries(Object.entries(files).reverse())).errors;

    expect(first).toEqual(reversed);
    expect(first.map((e) => e.split(": ")[0])).toEqual([
      "[UNDECLARED_STORAGE_ACCESS] app/z.tsx:1",
      "[UNDECLARED_STORAGE_ACCESS] components/a.tsx:3",
      "[UNDECLARED_STORAGE_ACCESS] components/b.tsx:1",
    ]);
  });

  it("produces identical output on repeated runs", () => {
    const files = { "lib/theme.ts": SAFE_THEME, "components/x.tsx": "window.localStorage.clear();" };
    expect(build(files)).toEqual(build(files));
  });
});
