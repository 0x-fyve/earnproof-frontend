# Contract successor migration readiness

Implements [#266](https://github.com/veridatum-labs/earnproof-frontend/issues/266):
clear route-level guidance when a contract is preparing to move, has been
decommissioned, or has been replaced by a successor.

## Where it lives

| Concern | Module |
| --- | --- |
| Status shape, validation, gating, link resolution | `lib/api/contract-migration.ts` |
| Banner, self-loading mount, action gate | `components/common/contract-migration-banner.tsx` |
| Global mount point | `app/layout.tsx` |

## Status document

```ts
type ContractMigrationStatus = {
  schemaVersion: number;              // must equal CONTRACT_MIGRATION_SCHEMA_VERSION (1)
  network: string;                    // must match appConfig.stellarNetwork
  currentContractId: string;
  phase: "stable" | "preparing" | "migrating" | "decommissioned" | "replaced";
  effectiveAt?: string;
  readOnlySince?: string;
  statusPageUrl?: string;
  successor?: {
    contractId: string;               // StrKey "C…" form
    verified: boolean;                // server-attested
    label?: string;
    migrationGuideUrl?: string;
  };
};
```

There is no `/contracts/migration` endpoint in the API spec yet, so
`fetchMockContractMigrationStatus()` is a fixture/forward contract, shaped
exactly like a real response. When a real endpoint ships, only the fetcher
changes — never the gating contract below.

## Deterministic behavior

| Situation | Reads | Writes | Banner |
| --- | --- | --- | --- |
| No status, or `phase: "stable"` | allowed | allowed | none |
| `phase: "preparing"` | allowed | allowed | warning |
| `phase: "migrating"` | allowed | blocked | warning + read-only note |
| `phase: "decommissioned"` | allowed | blocked | danger + read-only note |
| `phase: "replaced"` | allowed | blocked | danger + read-only note |
| Unsupported `schemaVersion` | allowed | blocked (fail closed) | none (surfaced as stale) |
| `network` ≠ `appConfig.stellarNetwork` | allowed | blocked (fail closed) | none (surfaced as stale) |

Read-only access — including on a decommissioned or replaced contract — is
always preserved.

## Successor identity checks

`resolveSuccessorGuideLink()` is the only function that can produce a link to a
successor, and it returns `null` unless **all** of the following hold:

1. the document is a supported schema and for the current network;
2. `successor.verified === true` (server-attested);
3. `successor.contractId` is a well-formed Stellar contract ID;
4. `successor.contractId` differs from `currentContractId`;
5. `successor.migrationGuideUrl` is an absolute HTTPS URL with no embedded
   credentials.

Consequently the client can never redirect a user to an unverified successor.
The public status page (`statusPageUrl`) is an announcement rather than a
redirect target, so it is shown independently of successor trust — but it is
still restricted to safe HTTPS URLs.

## Network awareness

The banner uses `useNetworkStatus()` from `lib/network`. While the browser is
offline it states that the displayed migration status may be out of date,
rather than implying the state is current.
