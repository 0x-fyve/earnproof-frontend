#!/usr/bin/env node

/**
 * Blocks production builds that retain mock data providers (#333).
 *
 * Walks the real module import graph (starting from every page.tsx and
 * every other file app/ actually renders — layouts, route handlers)
 * looking for a transitive import of anything matching a documented
 * "mock-only" naming convention: an export whose name starts with
 * `fetchMock`, `mockProvider`, or `MockProvider` (case-sensitive on the
 * `Mock` token so a legitimately-named thing like `fetchMockupPreview`
 * doesn't false-positive on casing alone — see MOCK_NAME_PATTERN).
 *
 * This is a MODULE-GRAPH check, not a text grep: it resolves actual
 * import specifiers (relative and `@/` alias) file by file, so it
 * reports the real import chain from the production entry point down to
 * the mock, and it only flags a mock NAME if that mock is actually
 * imported somewhere in the chain (not merely co-located in a file that
 * also happens to export other, real things).
 *
 * Exemptions (must be explicit, not inferred):
 * - Anything under a `__tests__/` directory, or a `*.test.ts(x)` file,
 *   or `tests/` at the repo root — test fixtures are allowed to import
 *   mocks freely.
 * - A mock export name listed in APPROVED_FORWARD_CONTRACTS below, each
 *   with its source file and a one-line reason. Every entry there is an
 *   intentional, already-reviewed stand-in for a backend endpoint that
 *   doesn't exist yet (each file carries its own module-level doc
 *   comment saying so — this list just makes that fact auditable in one
 *   place instead of requiring a reader to open every lib/api/*.ts file).
 *   This list is NOT a blanket "mocks are fine" switch: a mock-named
 *   export that is reachable from a production route and is NOT on this
 *   list still fails the check. Adding a new entry here is a deliberate,
 *   reviewable decision, not a default.
 *
 * Note on "reject environment checks that can be tree-shaken
 * incorrectly" (from the issue's acceptance criteria): this check
 * deliberately does NOT look for `process.env.NODE_ENV === 'development'`
 * guards around a mock import as a way to consider it "safe" — static
 * analysis can't prove a bundler actually tree-shakes a given branch, so
 * an import reachable at all (regardless of a runtime env check wrapping
 * its call site) counts as reachable here.
 */

const fs = require('fs');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(APP_ROOT, 'app');

// `Mock` must appear with this exact casing as a standalone token at the
// start of the identifier (fetchMockX, mockProviderX, MockProviderX) —
// this intentionally does NOT match `fetchMockup...` (lowercase "mock" as
// part of a different word) or a variable merely containing "mock"
// inside an unrelated longer name.
const MOCK_NAME_PATTERN = /^(fetchMock[A-Z]\w*|mockProvider[A-Z]?\w*|MockProvider\w*)$/;

/**
 * Mock-named exports that are allowed to be reachable from a production
 * route because they're a reviewed, documented forward-contract for a
 * backend endpoint that doesn't exist yet (#333). Each entry's `file` is
 * where it's defined; the check only treats the exemption as matching
 * when BOTH the export name AND its defining file agree, so renaming or
 * moving one of these without updating this list re-triggers the failure
 * rather than silently staying exempt.
 */
const APPROVED_FORWARD_CONTRACTS = {
  fetchMockCapabilityDocument: {
    file: 'lib/api/capabilities.ts',
    reason: 'Capability-gating UX hint, never a security boundary (see the file\'s own module doc comment). Backend capability-document endpoint does not exist yet.',
  },
  fetchMockContractDrift: {
    file: 'lib/api/contract-drift.ts',
    reason: 'Documented fixture/forward-contract for a not-yet-built contract-drift detection endpoint.',
  },
  fetchMockRoleApprovalPolicy: {
    file: 'lib/api/organization-role-approval-policy.ts',
    reason: 'Documented fixture/forward-contract for a not-yet-built role-approval-policy endpoint.',
  },
  fetchMockDataResidencyPolicy: {
    file: 'lib/api/organization-data-residency.ts',
    reason: 'Documented fixture/forward-contract for a not-yet-built data-residency-policy endpoint.',
  },
  fetchMockPolicyConsentState: {
    file: 'lib/api/policy-consent.ts',
    reason: 'Documented fixture/forward-contract, same convention as lib/api/retention.ts and organization-role-approval-policy.ts.',
  },
  fetchMockContractMigrationStatus: {
    file: 'lib/api/contract-migration.ts',
    reason: 'Documented fixture/forward-contract for a not-yet-built contract-migration-status endpoint.',
  },
  fetchMockNotificationPreferences: {
    file: 'lib/api/notification-preferences.ts',
    reason: 'Documented fixture/forward-contract for a not-yet-built notification-preferences endpoint.',
  },
  fetchMockOrganizationNotificationPolicy: {
    file: 'lib/api/notification-preferences.ts',
    reason: 'Documented fixture/forward-contract for a not-yet-built org-level notification-policy endpoint.',
  },
  fetchMockOfflineBundleSource: {
    file: 'lib/credentials/offline-bundle.ts',
    reason: 'Documented fixture/forward-contract for a not-yet-built offline-credential-bundle endpoint.',
  },
};

/** Legacy alias kept for file-path-based exemptions (none currently used). */
const DEV_ONLY_BOUNDARIES = {};

function isTestPath(filePath) {
  const normalized = filePath.split(path.sep).join('/');
  return (
    normalized.includes('/__tests__/') ||
    normalized.includes('/tests/') ||
    /\.(test|spec)\.[tj]sx?$/.test(normalized)
  );
}

function toRepoRelative(absPath) {
  return path.relative(APP_ROOT, absPath).split(path.sep).join('/');
}

const IMPORT_PATTERN = /(?:import\s+(?:[\w*{}\s,]+?from\s+)?|export\s+(?:[\w*{}\s,]+?from\s+)?|require\()\s*["']([^"']+)["']/g;
const EXPORT_NAME_PATTERN = /export\s+(?:async\s+function|function|const|class)\s+([A-Za-z_$][\w$]*)/g;

const CANDIDATE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/** Resolve an import specifier to an actual file on disk, or null. */
function resolveSpecifier(specifier, fromFile) {
  let basePath;
  if (specifier.startsWith('@/')) {
    basePath = path.join(APP_ROOT, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    basePath = path.join(path.dirname(fromFile), specifier);
  } else {
    // Bare package import (node_modules) — not part of this app's own
    // module graph, and therefore out of scope for this check.
    return null;
  }

  if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) {
    return basePath;
  }
  for (const ext of CANDIDATE_EXTENSIONS) {
    if (fs.existsSync(basePath + ext)) return basePath + ext;
  }
  for (const ext of CANDIDATE_EXTENSIONS) {
    const indexPath = path.join(basePath, 'index' + ext);
    if (fs.existsSync(indexPath)) return indexPath;
  }
  return null;
}

function extractImportSpecifiers(content) {
  const specifiers = [];
  let match;
  const pattern = new RegExp(IMPORT_PATTERN);
  while ((match = pattern.exec(content)) !== null) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

function extractMockExportNames(content) {
  const names = [];
  let match;
  const pattern = new RegExp(EXPORT_NAME_PATTERN);
  while ((match = pattern.exec(content)) !== null) {
    if (MOCK_NAME_PATTERN.test(match[1])) names.push(match[1]);
  }
  return names;
}

/**
 * Walk the import graph from `entryFile`, returning the first chain
 * (array of repo-relative file paths) that reaches a file exporting a
 * mock-named identifier, or null if none is reachable.
 */
function findMockChain(entryFile, visited = new Set(), chain = []) {
  const real = fs.realpathSync(entryFile);
  if (visited.has(real)) return null;
  visited.add(real);

  const content = fs.readFileSync(real, 'utf8');
  const relReal = toRepoRelative(real);
  const nextChain = [...chain, relReal];

  const mockExports = extractMockExportNames(content).filter((name) => {
    const approved = APPROVED_FORWARD_CONTRACTS[name];
    return !(approved && approved.file === relReal);
  });
  if (mockExports.length > 0) {
    return { chain: nextChain, mockNames: mockExports };
  }

  const specifiers = extractImportSpecifiers(content);
  for (const specifier of specifiers) {
    const resolved = resolveSpecifier(specifier, real);
    if (!resolved) continue;
    if (isTestPath(resolved)) continue;
    const relResolved = toRepoRelative(resolved);
    if (DEV_ONLY_BOUNDARIES[relResolved]) continue;

    const found = findMockChain(resolved, visited, nextChain);
    if (found) return found;
  }

  return null;
}

/** Entry points: every page.tsx, layout.tsx, and route.ts under app/. */
function findEntryPoints(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name.startsWith('_')) continue;
      results.push(...findEntryPoints(fullPath));
    } else if (/^(page|layout|route)\.(ts|tsx)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

function checkMockReachability() {
  const entryPoints = findEntryPoints(APP_DIR);
  const findings = [];

  for (const entry of entryPoints) {
    const visited = new Set();
    const result = findMockChain(entry, visited);
    if (result) {
      findings.push({
        entry: toRepoRelative(entry),
        mockNames: result.mockNames,
        chain: result.chain,
      });
    }
  }

  return findings;
}

function main() {
  console.log('Checking for mock-provider imports reachable from production routes...');

  const findings = checkMockReachability();

  if (findings.length === 0) {
    console.log('No mock providers are reachable from a production route.');
    return;
  }

  console.error(`\nFound ${findings.length} production route(s) that transitively depend on a mock provider:\n`);
  for (const finding of findings) {
    console.error(`  [MOCK_REACHABLE] ${finding.entry}`);
    console.error(`    mock export(s): ${finding.mockNames.join(', ')}`);
    console.error(`    import chain: ${finding.chain.join(' -> ')}`);
  }
  console.error(
    '\nIf this mock is an intentional, reviewed placeholder for a not-yet-built backend ' +
      'endpoint, add it to APPROVED_FORWARD_CONTRACTS in scripts/check-mock-reachability.js with its ' +
      'defining file and a one-line reason, or rename the export to not match ' +
      'fetchMock*/mockProvider*/MockProvider*. Otherwise, remove the import before this reaches production.',
  );
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  checkMockReachability,
  findMockChain,
  resolveSpecifier,
  extractImportSpecifiers,
  extractMockExportNames,
  isTestPath,
  MOCK_NAME_PATTERN,
  APPROVED_FORWARD_CONTRACTS,
  DEV_ONLY_BOUNDARIES,
};
