# Issuer policy commitment history (#267)

Lets issuers and admins compare current and historical on-chain policy
commitments used for proof issuance, see which commitment applied at a
given ledger, and see whether the backend's index agrees with the chain.

| Layer | File |
| --- | --- |
| Proposed contract, zod validation | [lib/api/issuer-policy-commitments.ts](../lib/api/issuer-policy-commitments.ts) |
| Pure rules (hash comparison, effective ledger, reconciliation, role gate) | [lib/issuers/policy-commitment-history.ts](../lib/issuers/policy-commitment-history.ts) |
| Viewer | [components/issuers/policy-commitment-history.tsx](../components/issuers/policy-commitment-history.tsx) |
| Synthetic fixtures | [tests/fixtures/issuer-policy-commitment-fixtures.ts](../tests/fixtures/issuer-policy-commitment-fixtures.ts) |

## Backend status: proposed contract, not wired

There is **no** commitment-history, ledger or reconciliation endpoint in
`lib/api/openapi/earnproof-api.v1.json`. Following the precedent of #242 and
#245, this change defines and validates the response the UI needs but adds
no fetcher, no spec entry and no `client-contracts.json` entry. The viewer
takes a `loadHistory(request, signal)` prop. Once the backend confirms the
route (assumed `GET /issuers/{id}/policy-commitments`) and shape, mount
`<PolicyCommitmentHistory>` in `app/settings/issuers` (e.g. as a panel in
`IssuerList`, like `IssuerAttestations`) with a loader built on `apiClient`.

Proposed response, `schemaVersion: 1`:

```ts
{
  schemaVersion: 1,
  issuerId: string,
  latestLedger: number,              // latest ledger the backend observed on chain
  indexedLedger: number | null,      // ledger the commitment index has processed to; null = not indexed
  indexedAt: string | null,          // ISO 8601
  onChainCurrentHash: string | null, // read from the contract at latestLedger; null = not read
  commitments: Array<{
    version: number,                 // strictly increasing
    commitmentHash: string,          // 64 hex chars, opaque
    effectiveLedger: number,         // strictly increasing with version, <= indexedLedger
    recordedAt: string,
    relatedProofCount: number,
    relatedProofIds: string[],       // opaque ids, at most 20, never more than the count
  }>,
}
```

Responses are rejected (explicit error state, nothing rendered) when the
version is not 1, any field is unknown or malformed, versions or effective
ledgers are duplicated or non-increasing, `indexedLedger > latestLedger`, a
commitment is effective after `indexedLedger`, or the response's `issuerId`
is not the requested issuer.

## Commitment hashes are opaque

Hashes are shown as full lower-case hex with a copy button. Nothing decodes,
parses or interprets them as policy content. Comparison is exact,
case-normalized and full-length: two hashes are **identical** or
**different**. Prefixes, truncated values, `0x`-prefixed values and padded
values are **not valid** rather than a partial match. The UI never claims to
show what changed inside a policy.

## Effective ledger: exact boundary

The commitment effective **at** ledger `L` is the highest version with
`effectiveLedger <= L`. The boundary is inclusive: when `effectiveLedger ==
L`, the new version already applies at `L`, and the previous version
applies through `L - 1`.

- `L` below the first `effectiveLedger`: no commitment was effective yet.
- `L > indexedLedger` (or nothing indexed): **cannot be determined** from
  the projection. It is reported as such and never answered from stale data.
- Empty history: no commitments. Single-version history: that version from
  its effective ledger onwards.

This rule is a frontend assumption and must be confirmed against the
contract's semantics when the endpoint is defined.

## Reconciliation states

Evaluated in this order; the first match wins:

| State | Condition | Shown as |
| --- | --- | --- |
| Pending: not yet indexed | `indexedLedger` is null | `…` neutral panel |
| Stale projection | `indexedLedger < latestLedger` (even if the hashes match) | `⏳` amber panel with indexed ledger, indexed-at time and latest ledger. The current commitment heading becomes "Last indexed commitment (may not be current)", and table rows say "(last indexed)" instead of "(current)". |
| Unknown | Caught up but `onChainCurrentHash` is null | `?` neutral panel. Agreement is not confirmed, so the state is never "in sync". |
| Mismatch | Caught up and the latest indexed hash differs from the on-chain hash, or the backend has no commitment | `✕` rose panel |
| In sync | Caught up and the hashes are identical | `✓` emerald panel |

Every state has its own symbol and text label, so meaning never depends on
colour alone.

## Authorization

Only `ADMIN` and `ISSUER` roles can view the history (`AuthUser` has no
separate verifier role). Other roles see "Access restricted" and no
signed-in viewer sees "Authentication required", in both cases without the
loader being called. A server `401` or `403` renders the same explicit
states, without a retry button.

## Concurrency and replay

- Changing the issuer or tenant (organization) immediately hides the previous
  data, shows the loading state, and aborts the in-flight request through its
  `AbortSignal`.
- Only the newest request may update the view: a late success or error from
  a superseded request is ignored. A response for a different issuer is
  rejected by validation.
- The selected version, ledger lookup and pasted-hash comparison are tied to
  the current issuer and tenant and reset when they change.

## Privacy

Related proofs are shown only as opaque ids and counts, with no proof
bodies, claim values or policy content. Fixtures use repeated-byte hashes
(e.g. `11…11`) and `*-synthetic-*` ids.
