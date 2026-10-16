# Organization role approval policy

Implements [#258](https://github.com/veridatum-labs/earnproof-frontend/issues/258):
organizations need to configure which role changes require independent approval
and how long approval requests remain valid.

## Where it lives

| Concern | Module |
| --- | --- |
| Types, validation, impact, versioning, fail-closed apply | `lib/api/organization-role-approval-policy.ts` |
| Editor / preview / history UI | `components/organizations/role-approval-policy-panel.tsx` |
| Route | `app/settings/organizations/role-approval/page.tsx` |

## Server-enforced minimums

`RoleApprovalMinimums` (defaulting to `DEFAULT_ROLE_APPROVAL_MINIMUMS`) is what
the client may never weaken. The UI can only make a policy *stricter*:

- at least `minApprovalsRequired` independent approvals (default 1);
- request validity within `[min..max]` hours (default 1–720);
- `allowSelfApproval` only when `selfApprovalPermitted` (default false);
- roles in `alwaysRequireApproval` (default `OWNER`) must always require
  approval.

`validateRoleApprovalPolicy()` returns the exact list of issues, so the editor,
the tests and the server all agree. A policy with any `error` issue cannot be
submitted. The server still re-validates every write — this layer only stops the
client offering a change it already knows will be rejected.

## Deterministic failure behavior

`applyPolicyUpdate()` fails closed with a specific reason:

| Reason | When |
| --- | --- |
| `unauthorized` | the viewer is not OWNER/ADMIN |
| `stale` | the server policy version has advanced past `expectedVersion` (also what replaying an already-applied update looks like), or the server uses a newer schema |
| `conflict` | the client believes the server version is *ahead* of it — versions are out of sync |
| `invalid` | the draft would weaken a server-enforced minimum |

On success the returned policy gets `policyVersion = current + 1` and a fresh
`updatedAt`, which is what makes replaying the same request fail closed the
second time.

Exact boundaries (approvals = 1 and 5; validity = 1 and 720 hours) are valid;
one step outside is rejected. Round-trip freshness and field-level comparisons
are exposed through `comparePolicyVersions()`.

## What the UI provides

- Per-role toggles for "requires independent approval".
- Independent-approvals and request-validity inputs.
- Self-approval toggle.
- Inline validation (errors block Save).
- Impact preview (`summarizePolicyImpact`) labelling a change as a
  strengthening or a relaxation.
- Version history with field-level comparison and
  **rollback-to-current** (`buildRollbackDraft` — a rollback is versioned and
  validated as a new change, so it can never resurrect a policy that violates
  current minimums).

Read-only roles (MEMBER/VIEWER) see a summary with all controls disabled.

## Authorization

`canManageRoleApprovalPolicy()` (OWNER/ADMIN) is UX gating only. The server is
the only authority for whether a policy write is allowed.
