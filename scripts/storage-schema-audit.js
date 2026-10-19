#!/usr/bin/env node

/**
 * Browser storage audit.
 *
 * Scans application source for every use of localStorage, sessionStorage,
 * IndexedDB and document.cookie, and checks it against the registry in
 * `lib/storage/registry.json`:
 *
 *  - every persisted key (or key prefix) must be registered, with an owner,
 *    area, classification, schema version, retention and cleanup rule
 *  - every file that touches browser storage must be a declared accessor of
 *    the key it uses
 *  - retired keys (for example the legacy bearer-token session) may only be
 *    deleted, never read or written
 *  - nothing that looks like a secret may be persisted: token, signature,
 *    private proof material and similar words are rejected in stored values,
 *    stored field names and key names
 *
 * Diagnostics are `{ code, file, line, message }`, sorted by file, line, code,
 * so two runs on the same tree print the same output.
 *
 * Usage:
 *   node scripts/storage-schema-audit.js          # audit this repo
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const APP_ROOT = path.join(__dirname, '..');
const DEFAULT_SCAN_DIRS = ['app', 'components', 'lib', 'hooks', 'contexts', 'config', 'data'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__', '__mocks__', 'generated']);

const VALID_AREAS = new Set(['local', 'session']);
const VALID_MATCH = new Set(['exact', 'prefix']);
const VALID_CLASSIFICATIONS = new Set(['preference', 'draft', 'cache', 'user-record', 'ui-state']);
const VALID_FORMATS = new Set(['envelope', 'legacy-unversioned']);
const VALID_SCOPES = new Set(['browser', 'user', 'user-organization']);

// Words that must never appear in persisted values, stored field names or
// storage key names. Matched per camelCase / snake / kebab word.
const SECRET_WORDS = new Set([
  'token', 'secret', 'password', 'passphrase', 'mnemonic', 'seed', 'signature',
  'bearer', 'jwt', 'apikey', 'credential', 'witness', 'privatekey', 'authorization',
]);
// A secret word followed by one of these is metadata about the secret (an id,
// a digest, an expiry), not the secret itself.
const SAFE_FOLLOWERS = new Set(['hash', 'digest', 'id', 'prefix', 'fingerprint', 'count', 'type', 'expiry']);

const KEY_LITERAL = /^earnproof[._:-]/;
const STORAGE_NAMES = new Set(['localStorage', 'sessionStorage']);
const GLOBAL_NAMES = new Set(['window', 'globalThis', 'self']);

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function splitWords(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/** Returns the offending word when `name` looks like it names a secret. */
function findSecretWord(name) {
  const words = splitWords(name);
  // "api key" / "private key" arrive as two words; check the joined pair too.
  for (let i = 0; i < words.length; i += 1) {
    const pair = i + 1 < words.length ? words[i] + words[i + 1] : null;
    const hit = SECRET_WORDS.has(words[i]) ? words[i] : pair && SECRET_WORDS.has(pair) ? pair : null;
    if (!hit) continue;
    const consumed = hit === pair ? i + 2 : i + 1;
    const follower = words[consumed];
    if (follower && SAFE_FOLLOWERS.has(follower)) continue;
    return hit;
  }
  return null;
}

function listSourceFiles(root, dirs) {
  const out = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        if (/\.(test|spec)\.[tj]sx?$/.test(entry.name)) continue;
        out.push(full);
      }
    }
  }
  for (const d of dirs) walk(path.join(root, d));
  return out;
}

function scriptKindFor(file) {
  switch (path.extname(file)) {
    case '.tsx': return ts.ScriptKind.TSX;
    case '.jsx': return ts.ScriptKind.JSX;
    case '.js':
    case '.mjs': return ts.ScriptKind.JS;
    default: return ts.ScriptKind.TS;
  }
}

function loadRegistry(registryPath, root) {
  const problems = [];
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch (error) {
    return {
      registry: null,
      problems: [{ code: 'REGISTRY_INVALID', file: toPosix(path.relative(root, registryPath)), line: 1, message: `Cannot read registry: ${error.message}` }],
    };
  }

  const file = toPosix(path.relative(root, registryPath));
  const add = (message) => problems.push({ code: 'REGISTRY_INVALID', file, line: 1, message });

  if (!registry || !Array.isArray(registry.entries)) {
    add('Registry must contain an "entries" array');
    return { registry: null, problems };
  }

  const seenIds = new Set();
  const seenKeys = new Set();
  for (const entry of registry.entries) {
    const label = entry && entry.id ? entry.id : '(missing id)';
    if (!entry || typeof entry.id !== 'string' || !entry.id) { add('Entry without an id'); continue; }
    if (seenIds.has(entry.id)) add(`${label}: duplicate id`);
    seenIds.add(entry.id);
    if (typeof entry.key !== 'string' || !KEY_LITERAL.test(entry.key)) add(`${label}: key must start with "earnproof" followed by . _ : or -`);
    if (seenKeys.has(entry.key)) add(`${label}: duplicate key "${entry.key}"`);
    seenKeys.add(entry.key);
    if (!VALID_MATCH.has(entry.match)) add(`${label}: match must be "exact" or "prefix"`);
    if (!VALID_AREAS.has(entry.area)) add(`${label}: area must be "local" or "session"`);
    if (!VALID_SCOPES.has(entry.scope)) add(`${label}: scope must be one of ${[...VALID_SCOPES].join(', ')}`);
    if (!VALID_CLASSIFICATIONS.has(entry.classification)) add(`${label}: classification must be one of ${[...VALID_CLASSIFICATIONS].join(', ')} (secrets are never a valid classification)`);
    if (!VALID_FORMATS.has(entry.format)) add(`${label}: format must be "envelope" or "legacy-unversioned"`);
    if (!Number.isInteger(entry.schemaVersion) || entry.schemaVersion < 1) add(`${label}: schemaVersion must be an integer >= 1`);
    for (const field of ['owner', 'retention', 'cleanup']) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) add(`${label}: ${field} is required`);
    }
    if (!Array.isArray(entry.accessors) || entry.accessors.length === 0) add(`${label}: accessors must list at least one file`);
    const keyWord = typeof entry.key === 'string' ? findSecretWord(entry.key) : null;
    if (keyWord) add(`${label}: key name contains secret-like word "${keyWord}"`);
    if (entry.match === 'prefix' && typeof entry.key === 'string' && !/[._:-]$/.test(entry.key)) add(`${label}: prefix keys must end with a separator`);
    for (const allowed of entry.allowedFields || []) {
      if (!allowed || typeof allowed.name !== 'string' || typeof allowed.reason !== 'string' || !allowed.reason.trim()) add(`${label}: allowedFields entries need a name and a reason`);
    }
    for (const f of [entry.owner, ...(entry.accessors || [])]) {
      if (typeof f === 'string' && !fs.existsSync(path.join(root, f))) add(`${label}: file does not exist: ${f}`);
    }
  }

  for (const a of registry.entries) {
    for (const b of registry.entries) {
      if (a === b || !a || !b || typeof a.key !== 'string' || typeof b.key !== 'string') continue;
      if (a.match === 'prefix' && a.key !== b.key && b.key.startsWith(a.key)) add(`${a.id}: prefix "${a.key}" shadows ${b.id} ("${b.key}")`);
    }
  }

  for (const retired of registry.retired || []) {
    if (!retired || typeof retired.key !== 'string' || !Array.isArray(retired.removedBy) || retired.removedBy.length === 0) {
      add('Retired entries need a key and a removedBy list');
    }
  }

  return { registry, problems };
}

function matchEntry(registry, literal) {
  for (const entry of registry.entries) {
    if (entry.match === 'exact' && literal === entry.key) return entry;
    if (entry.match === 'prefix' && literal.startsWith(entry.key)) return entry;
  }
  return null;
}

function matchRetired(registry, literal) {
  return (registry.retired || []).find((r) => literal === r.key) || null;
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function analyzeFile(file, root) {
  const text = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindFor(file));
  const rel = toPosix(path.relative(root, file));

  const result = {
    rel,
    access: [], // { kind, line }
    keyLiterals: [], // { value, line, node }
    setItemCalls: [], // { line, keyText, valueNodes, keyNode }
    storedFields: [], // { name, line }
  };

  function isStorageReference(node) {
    if (ts.isIdentifier(node) && STORAGE_NAMES.has(node.text)) {
      const p = node.parent;
      if (ts.isPropertyAccessExpression(p) && p.name === node) {
        return ts.isIdentifier(p.expression) && GLOBAL_NAMES.has(p.expression.text) ? p : null;
      }
      if (ts.isImportSpecifier(p) || ts.isTypeReferenceNode(p) || ts.isPropertySignature(p)) return null;
      if (ts.isTypeOfExpression(p)) return node;
      return node;
    }
    return null;
  }

  function visit(node) {
    if (ts.isIdentifier(node)) {
      if (STORAGE_NAMES.has(node.text) && isStorageReference(node)) {
        result.access.push({ kind: node.text, line: lineOf(sourceFile, node) });
      } else if (node.text === 'indexedDB') {
        const p = node.parent;
        if (!(ts.isPropertyAccessExpression(p) && p.name === node && !(ts.isIdentifier(p.expression) && GLOBAL_NAMES.has(p.expression.text)))) {
          result.access.push({ kind: 'indexedDB', line: lineOf(sourceFile, node) });
        }
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === 'cookie' &&
      ts.isIdentifier(node.left.expression) &&
      node.left.expression.text === 'document'
    ) {
      result.access.push({ kind: 'cookie', line: lineOf(sourceFile, node) });
    }

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)) {
      const value = node.text;
      if (KEY_LITERAL.test(value)) {
        result.keyLiterals.push({ value, line: lineOf(sourceFile, node) });
      }
      // Inline scripts shipped as strings (for example the pre-hydration
      // display preference script) still read browser storage.
      if (/\b(?:window\.)?(?:localStorage|sessionStorage)\s*\./.test(value)) {
        result.access.push({ kind: /sessionStorage/.test(value) ? 'sessionStorage' : 'localStorage', line: lineOf(sourceFile, node) });
      }
    } else if (ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (/\b(?:window\.)?(?:localStorage|sessionStorage)\s*\./.test(node.text)) {
        result.access.push({ kind: 'localStorage', line: lineOf(sourceFile, node) });
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'setItem') {
      result.setItemCalls.push({
        line: lineOf(sourceFile, node),
        keyNode: node.arguments[0],
        valueNode: node.arguments[1],
      });
    }

    if (
      (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      node.name &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
    ) {
      result.storedFields.push({ name: node.name.text, line: lineOf(sourceFile, node) });
    }

    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  result.sourceFile = sourceFile;
  return result;
}

function collectIdentifierNames(node, out = []) {
  if (!node) return out;
  if (ts.isIdentifier(node)) out.push(node.text);
  else if (ts.isStringLiteral(node)) out.push(node.text);
  ts.forEachChild(node, (child) => collectIdentifierNames(child, out));
  return out;
}

function diagnosticSort(a, b) {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.line !== b.line) return a.line - b.line;
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((d) => {
    const k = `${d.file}|${d.line}|${d.code}|${d.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Audit browser storage usage.
 *
 * @param {object} [options]
 * @param {string} [options.root] Project root (defaults to this repo)
 * @param {string} [options.registryPath] Registry JSON (defaults to lib/storage/registry.json)
 * @param {string[]} [options.scanDirs] Directories under root to scan
 */
function auditStorage(options = {}) {
  const root = options.root || APP_ROOT;
  const registryPath = options.registryPath || path.join(root, 'lib', 'storage', 'registry.json');
  const scanDirs = options.scanDirs || DEFAULT_SCAN_DIRS;

  const errors = [];
  const warnings = [];

  const { registry, problems } = loadRegistry(registryPath, root);
  errors.push(...problems);
  if (!registry) {
    return { success: false, errors: errors.map(formatDiagnostic), warnings: [], diagnostics: { errors, warnings }, stats: { filesScanned: 0, accessFiles: 0, entries: 0 } };
  }

  const files = listSourceFiles(root, scanDirs);
  const accessorsSeen = new Map(); // entry id -> Set(files that actually access storage)
  let accessFiles = 0;

  for (const file of files) {
    const info = analyzeFile(file, root);
    const retiredHere = [];
    const touchesStorage = info.access.length > 0;

    for (const literal of info.keyLiterals) {
      const retired = matchRetired(registry, literal.value);
      if (retired) retiredHere.push({ literal, retired });
    }

    for (const { literal, retired } of retiredHere) {
      if (!retired.removedBy.includes(info.rel)) {
        errors.push({ code: 'RETIRED_STORAGE_KEY', file: info.rel, line: literal.line, message: `"${literal.value}" is retired (${retired.reason}). Only ${retired.removedBy.join(', ')} may reference it, and only to delete it.` });
      }
    }

    if (!touchesStorage) continue;
    accessFiles += 1;

    // Non-key mechanisms need an explicit declaration.
    for (const access of info.access) {
      if (access.kind === 'indexedDB' || access.kind === 'cookie') {
        const allowed = (registry.otherMechanisms || []).some((m) => m.mechanism === access.kind && m.files.includes(info.rel));
        if (!allowed) {
          errors.push({ code: 'UNDECLARED_PERSISTENCE_MECHANISM', file: info.rel, line: access.line, message: `${access.kind} is not an approved persistence mechanism here. Declare it in otherMechanisms or remove it.` });
        }
      }
    }

    const storageAccess = info.access.filter((a) => a.kind === 'localStorage' || a.kind === 'sessionStorage');
    const isRetiredRemover = (registry.retired || []).some((r) => r.removedBy.includes(info.rel));

    if (storageAccess.length > 0) {
      const declaredEntries = registry.entries.filter((e) => e.accessors.includes(info.rel));
      if (declaredEntries.length === 0 && !isRetiredRemover) {
        errors.push({ code: 'UNDECLARED_STORAGE_ACCESS', file: info.rel, line: storageAccess[0].line, message: `${storageAccess[0].kind} is used here but this file is not a declared accessor of any registered key.` });
      }

      for (const literal of info.keyLiterals) {
        if (matchRetired(registry, literal.value)) continue;
        const entry = matchEntry(registry, literal.value);
        if (!entry) {
          errors.push({ code: 'UNREGISTERED_STORAGE_KEY', file: info.rel, line: literal.line, message: `"${literal.value}" is not in lib/storage/registry.json.` });
        } else {
          if (!entry.accessors.includes(info.rel)) {
            errors.push({ code: 'UNDECLARED_STORAGE_ACCESS', file: info.rel, line: literal.line, message: `${entry.id} ("${literal.value}") is used here but this file is not one of its declared accessors.` });
          }
          const kinds = new Set(storageAccess.map((a) => (a.kind === 'localStorage' ? 'local' : 'session')));
          if (!kinds.has(entry.area)) {
            errors.push({ code: 'WRONG_STORAGE_AREA', file: info.rel, line: literal.line, message: `${entry.id} is registered for ${entry.area}Storage but this file uses ${storageAccess[0].kind}.` });
          }
          if (!accessorsSeen.has(entry.id)) accessorsSeen.set(entry.id, new Set());
          accessorsSeen.get(entry.id).add(info.rel);
        }
      }

      for (const entry of declaredEntries) {
        if (!accessorsSeen.has(entry.id)) accessorsSeen.set(entry.id, new Set());
        accessorsSeen.get(entry.id).add(info.rel);
      }

      // Unsafe persistence: what is written, and what the stored shape names.
      const allowedFields = new Set(
        declaredEntries.flatMap((e) => (e.allowedFields || []).map((f) => f.name)),
      );

      for (const call of info.setItemCalls) {
        const names = [...collectIdentifierNames(call.valueNode), ...collectIdentifierNames(call.keyNode)];
        for (const name of names) {
          const word = findSecretWord(name);
          if (word && !allowedFields.has(name)) {
            errors.push({ code: 'UNSAFE_PERSISTED_VALUE', file: info.rel, line: call.line, message: `setItem writes "${name}" (contains "${word}"). Secrets, tokens and private proof material must stay in memory.` });
          }
        }
        if (call.keyNode && ts.isStringLiteral(call.keyNode)) {
          const retired = matchRetired(registry, call.keyNode.text);
          if (retired) {
            errors.push({ code: 'RETIRED_STORAGE_KEY_WRITE', file: info.rel, line: call.line, message: `setItem writes retired key "${call.keyNode.text}".` });
          }
        }
      }

      // Field names only matter in files that actually write to storage.
      const writesToStorage = info.setItemCalls.length > 0;
      for (const field of writesToStorage ? info.storedFields : []) {
        const word = findSecretWord(field.name);
        if (word && !allowedFields.has(field.name)) {
          errors.push({ code: 'UNSAFE_PERSISTED_FIELD', file: info.rel, line: field.line, message: `Field "${field.name}" in a storage-backed file contains "${word}". Rename it, keep it out of persisted data, or list it in allowedFields with a reason.` });
        }
      }
    }
  }

  // The registry must not claim accessors that no longer touch storage.
  for (const entry of registry.entries) {
    const seen = accessorsSeen.get(entry.id) || new Set();
    for (const accessor of entry.accessors) {
      const abs = path.join(root, accessor);
      if (!fs.existsSync(abs)) continue;
      const scanned = files.some((f) => toPosix(path.relative(root, f)) === accessor);
      if (scanned && !seen.has(accessor)) {
        // Drivers (lib/storage) reach storage through a registry id rather than a literal key.
        const analysis = analyzeFile(abs, root);
        if (analysis.access.length === 0 && !entry.viaDriver) {
          errors.push({ code: 'STALE_REGISTRY_ACCESSOR', file: 'lib/storage/registry.json', line: 1, message: `${entry.id} lists ${accessor} as an accessor but it no longer touches browser storage.` });
        }
      }
    }
    if (entry.format === 'legacy-unversioned') {
      warnings.push({ code: 'UNVERSIONED_STORAGE_SCHEMA', file: entry.owner, line: 1, message: `${entry.id} ("${entry.key}") persists an unversioned shape. Invalid data is discarded on read; move it to the versioned envelope in lib/storage when it next changes.` });
    }
  }

  errors.sort(diagnosticSort);
  warnings.sort(diagnosticSort);
  const finalErrors = dedupe(errors);
  const finalWarnings = dedupe(warnings);

  return {
    success: finalErrors.length === 0,
    errors: finalErrors.map(formatDiagnostic),
    warnings: finalWarnings.map(formatDiagnostic),
    diagnostics: { errors: finalErrors, warnings: finalWarnings },
    stats: { filesScanned: files.length, accessFiles, entries: registry.entries.length },
  };
}

function formatDiagnostic(d) {
  return `[${d.code}] ${d.file}:${d.line}: ${d.message}`;
}

if (require.main === module) {
  const result = auditStorage();
  console.log(`Scanned ${result.stats.filesScanned} files, ${result.stats.accessFiles} touch browser storage, ${result.stats.entries} registered keys.`);
  result.errors.forEach((e) => console.error(e));
  result.warnings.forEach((w) => console.warn(w));
  process.exit(result.success ? 0 : 1);
}

module.exports = { auditStorage, findSecretWord, formatDiagnostic };
