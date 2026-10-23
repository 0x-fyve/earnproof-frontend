# Storage schema validation

`npm run validate:production` fails when the app persists anything in the browser that is not declared, versioned and safe. The check is `scripts/storage-schema-audit.js`; the contract is `lib/storage/registry.json`.

## The registry

Each entry declares one key (or a key prefix for per-account keys):

| Field | Meaning |
| --- | --- |
| `id`, `key`, `match` | Name, storage key, and `exact` or `prefix` (prefix keys end in a separator and are followed by an account or organization id). |
| `area`, `scope` | `local` or `session`; `browser`, `user` or `user-organization`. |
| `classification` | `preference`, `draft`, `cache`, `user-record` or `ui-state`. There is no secret classification. |
| `format`, `schemaVersion` | `envelope` (versioned, migrated by `lib/storage`) or `legacy-unversioned`. |
| `owner`, `accessors` | The module that owns the shape, and every file allowed to touch the key. |
| `retention`, `cleanup` | How long it lives and what removes it. Both are required. |
| `allowedFields` | Explicit exceptions for field names that look secret, each with a reason. |

`retired` lists keys that must never be read, written or trusted again. Today that is `earnproof.session` (see [privacy](./privacy.md)). Only the files in `removedBy` may mention it, and only to delete it.

## What fails the build

Diagnostics print as `[CODE] file:line: message`, sorted by file, line and code, so output is stable between runs.

| Code | Cause |
| --- | --- |
| `REGISTRY_INVALID` | Missing or malformed registry, duplicate id or key, bad enum, missing retention/cleanup, missing file, a prefix that shadows another key, a secret-like key name. |
| `UNDECLARED_STORAGE_ACCESS` | A file uses `localStorage` or `sessionStorage` and is not a declared accessor of the key it uses. |
| `UNREGISTERED_STORAGE_KEY` | An `earnproof...` key literal in a storage-touching file that is not in the registry. |
| `WRONG_STORAGE_AREA` | A key registered for `localStorage` is used through `sessionStorage` (or the reverse). |
| `RETIRED_STORAGE_KEY` / `RETIRED_STORAGE_KEY_WRITE` | A retired key is referenced outside its remover, or written anywhere. |
| `UNSAFE_PERSISTED_VALUE` | A `setItem` call writes or keys on a value whose name contains token, secret, password, mnemonic, seed, signature, bearer, jwt, api key, private key, credential, witness or authorization. |
| `UNSAFE_PERSISTED_FIELD` | A file that writes storage declares a field with one of those words, unless listed in `allowedFields`. |
| `UNDECLARED_PERSISTENCE_MECHANISM` | `indexedDB` or a `document.cookie` write with no matching `otherMechanisms` entry. |
| `STALE_REGISTRY_ACCESSOR` | The registry lists an accessor that no longer touches storage. |

Words are matched per camelCase, snake or kebab segment. A secret word followed by `hash`, `digest`, `id`, `prefix`, `fingerprint`, `count`, `type` or `expiry` is metadata, not the secret (`tokenHash` passes, `token` does not).

The scan covers `app`, `components`, `lib`, `hooks`, `contexts`, `config` and `data`, skips tests, mocks and generated code, parses with the TypeScript compiler (so comments never count), and also finds storage reads inside inline script strings such as the pre-hydration script in `app/layout.tsx`.

## Warnings

`UNVERSIONED_STORAGE_SCHEMA` is a warning for every `legacy-unversioned` entry. Those stores validate shape on read and discard anything invalid, but they have no version number yet. Moving one onto the `lib/storage` envelope is a data migration for that store, so it is tracked here and not forced by this check. New keys must use `envelope`.

## Adding or changing a key

1. Add the entry to `lib/storage/registry.json` (new keys: `format: "envelope"`).
2. For an envelope key, add it to `STORAGE_KEYS`, `StorageSchema`, `CURRENT_VERSIONS` and `migrations` in `lib/storage/index.ts`. `tests/storage/storage-registry-contract.test.ts` checks the key, version and migration chain agree with the registry.
3. Bumping a version means adding the `migrations[key][n]` step and a fixture test. Unknown, future and corrupt versions are discarded on read (fail closed).
4. Run `node scripts/storage-schema-audit.js`.

## Behavior reference

- **Stale state:** invalid, expired or wrong-version values are removed on read and treated as absent.
- **Replay:** the audit has no state; a failed run changes nothing and a rerun on the same tree prints the same output.
- **Boundary:** a version equal to the current one loads; one above it is dropped.
- **Authorization:** per-account keys are prefix keys, so one account's records are never read through another account's key. Authorization is still enforced by the server.
- **Accessibility:** this is a build-time check with no UI.
