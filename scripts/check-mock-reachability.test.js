const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  checkMockReachability,
  findMockChain,
  resolveSpecifier,
  extractImportSpecifiers,
  extractMockExportNames,
  isTestPath,
  MOCK_NAME_PATTERN,
} = require("./check-mock-reachability");

describe("checkMockReachability against the real app tree (#333)", () => {
  it("finds no mock-provider imports reachable from a production route (all are on the approved forward-contract list)", () => {
    const findings = checkMockReachability();
    expect(findings).toEqual([]);
  });
});

describe("MOCK_NAME_PATTERN", () => {
  it("matches fetchMock-prefixed exports", () => {
    expect(MOCK_NAME_PATTERN.test("fetchMockCapabilityDocument")).toBe(true);
    expect(MOCK_NAME_PATTERN.test("fetchMockContractDrift")).toBe(true);
  });

  it("matches mockProvider/MockProvider-prefixed exports", () => {
    expect(MOCK_NAME_PATTERN.test("mockProviderForTests")).toBe(true);
    expect(MOCK_NAME_PATTERN.test("MockProviderWrapper")).toBe(true);
  });

  it("does not match an unrelated name merely containing 'mock' as a word fragment", () => {
    expect(MOCK_NAME_PATTERN.test("fetchMockupPreview")).toBe(false);
    expect(MOCK_NAME_PATTERN.test("hammockState")).toBe(false);
  });

  it("does not match a real fetch function with no mock in its name", () => {
    expect(MOCK_NAME_PATTERN.test("fetchCapabilityDocument")).toBe(false);
  });
});

describe("extractMockExportNames", () => {
  it("extracts a mock-named async function export", () => {
    const content = `export async function fetchMockThing() { return {}; }`;
    expect(extractMockExportNames(content)).toEqual(["fetchMockThing"]);
  });

  it("extracts a mock-named const export", () => {
    const content = `export const mockProviderThing = () => {};`;
    expect(extractMockExportNames(content)).toEqual(["mockProviderThing"]);
  });

  it("ignores a non-mock-named export", () => {
    const content = `export function fetchRealThing() { return {}; }`;
    expect(extractMockExportNames(content)).toEqual([]);
  });

  it("extracts multiple mock exports from the same file", () => {
    const content = `
      export async function fetchMockA() {}
      export function fetchRealThing() {}
      export const fetchMockB = () => {};
    `;
    expect(extractMockExportNames(content)).toEqual(["fetchMockA", "fetchMockB"]);
  });
});

describe("extractImportSpecifiers", () => {
  it("extracts a relative import specifier", () => {
    expect(extractImportSpecifiers(`import { x } from "./foo";`)).toEqual(["./foo"]);
  });

  it("extracts an @/ alias import specifier", () => {
    expect(extractImportSpecifiers(`import { x } from "@/lib/foo";`)).toEqual(["@/lib/foo"]);
  });

  it("extracts a re-export specifier", () => {
    expect(extractImportSpecifiers(`export { x } from "./foo";`)).toEqual(["./foo"]);
  });

  it("extracts a require() specifier", () => {
    expect(extractImportSpecifiers(`const x = require("./foo");`)).toEqual(["./foo"]);
  });

  it("ignores a bare package import (out of scope — not part of this app's own module graph)", () => {
    const specifiers = extractImportSpecifiers(`import React from "react";`);
    expect(specifiers).toEqual(["react"]);
  });
});

describe("isTestPath", () => {
  it("treats a __tests__ directory as a test path", () => {
    expect(isTestPath("/repo/lib/api/__tests__/foo.ts")).toBe(true);
  });

  it("treats a tests/ root directory as a test path", () => {
    expect(isTestPath("/repo/tests/lib/foo.ts")).toBe(true);
  });

  it("treats a .test.ts(x) file as a test path", () => {
    expect(isTestPath("/repo/lib/foo.test.ts")).toBe(true);
    expect(isTestPath("/repo/components/Foo.test.tsx")).toBe(true);
  });

  it("does not treat a normal production file as a test path", () => {
    expect(isTestPath("/repo/lib/api/foo.ts")).toBe(false);
  });
});

describe("findMockChain detects a new, unapproved mock import (#333 regression guard)", () => {
  const scratchDir = path.join(__dirname, "__mock-reachability-scratch__");

  afterEach(() => {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  it("reports the import chain when a production file imports a new fetchMock* export not on the approved list", () => {
    fs.mkdirSync(scratchDir, { recursive: true });
    fs.writeFileSync(
      path.join(scratchDir, "new-mock-source.ts"),
      `export async function fetchMockSomethingNew() { return {}; }`,
    );
    fs.writeFileSync(
      path.join(scratchDir, "consumer.ts"),
      `import { fetchMockSomethingNew } from "./new-mock-source";\nexport function useIt() { return fetchMockSomethingNew(); }`,
    );

    const result = findMockChain(path.join(scratchDir, "consumer.ts"));

    expect(result).not.toBeNull();
    expect(result.mockNames).toEqual(["fetchMockSomethingNew"]);
    expect(result.chain).toEqual([
      "scripts/__mock-reachability-scratch__/consumer.ts",
      "scripts/__mock-reachability-scratch__/new-mock-source.ts",
    ]);
  });

  it("does not follow an import into a __tests__ directory, even if that file exports a mock", () => {
    const testsDir = path.join(scratchDir, "__tests__");
    fs.mkdirSync(testsDir, { recursive: true });
    fs.writeFileSync(
      path.join(testsDir, "mock-fixture.ts"),
      `export async function fetchMockFixtureOnly() { return {}; }`,
    );
    fs.writeFileSync(
      path.join(scratchDir, "consumer-of-test-fixture.ts"),
      `import { fetchMockFixtureOnly } from "./__tests__/mock-fixture";\nexport function useIt() { return fetchMockFixtureOnly(); }`,
    );

    // A real production file importing from a __tests__ directory would be
    // unusual, but the point of this test is specifically that
    // findMockChain's traversal skips test paths — it must not report the
    // mock as reachable via this chain.
    const result = findMockChain(path.join(scratchDir, "consumer-of-test-fixture.ts"));
    expect(result).toBeNull();
  });
});

describe("resolveSpecifier with a temporary fixture tree", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mock-reachability-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves a relative import to its .ts file", () => {
    const fromFile = path.join(tmpDir, "a.ts");
    const targetFile = path.join(tmpDir, "b.ts");
    fs.writeFileSync(fromFile, "");
    fs.writeFileSync(targetFile, "");

    expect(resolveSpecifier("./b", fromFile)).toBe(targetFile);
  });

  it("resolves a relative import to an index file in a directory", () => {
    const fromFile = path.join(tmpDir, "a.ts");
    const dir = path.join(tmpDir, "sub");
    fs.mkdirSync(dir);
    const indexFile = path.join(dir, "index.ts");
    fs.writeFileSync(fromFile, "");
    fs.writeFileSync(indexFile, "");

    expect(resolveSpecifier("./sub", fromFile)).toBe(indexFile);
  });

  it("returns null for an unresolvable specifier", () => {
    const fromFile = path.join(tmpDir, "a.ts");
    fs.writeFileSync(fromFile, "");
    expect(resolveSpecifier("./does-not-exist", fromFile)).toBeNull();
  });

  it("returns null for a bare package import", () => {
    const fromFile = path.join(tmpDir, "a.ts");
    fs.writeFileSync(fromFile, "");
    expect(resolveSpecifier("some-npm-package", fromFile)).toBeNull();
  });
});
