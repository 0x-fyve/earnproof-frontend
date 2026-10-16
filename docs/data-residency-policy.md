# Organization data residency policy

Implements [#277](https://github.com/veridatum-labs/earnproof-frontend/issues/277):
organizations need to review the allowed storage and processing regions for
regulated data classes and background jobs.

## Where it lives

| Concern | Module |
| --- | --- |
| Region capabilities, validation, compliance, blockers, versioning | `lib/api/organization-data-residency.ts` |
| Editor / impact preview / history UI | `components/organizations/data-residency-policy-panel.tsx` |
| Route | `app/settings/organizations/data-residency/page.tsx` |

## Region capabilities

`REGION_CAPABILITIES` maps each processing region to the data classes it may
store/process, and marks deprecated regions. `isRegionSupportedForClass()`
returns `false` for:

- a region that does not list the data class, and
- a deprecated region (existing data may remain, but no new placement).

The editor disables every unsupported checkbox, so an unsupported region cannot
be selected in the first place.

## Compliance is never implied

`computeComplianceStatus()` reports `compliant` **only** when all of the
following hold:

1. the policy validates (no unsupported selections);
2. `serverValidation === "accepted"`;
3. every data class's `migration` is `"complete"`;
4. `rollout.status === "complete"`.

Otherwise it returns `awaiting-server-validation`, `migration-incomplete` or
`invalid`, with the exact outstanding reasons. Saving a change resets
`serverValidation` to `"pending"` and the rollout to `"not-started"`, so the UI
immediately stops claiming compliance until the server catches up.

## Migration blockers

`computeMigrationBlockers(current, next)` blocks any change to a data class's
placement (or a region removal) while that class's migration is incomplete.
`applyResidencyUpdate()` refuses such a change with reason `"blocked"`.

## Deterministic failure behavior

| Reason | When |
| --- | --- |
| `stale` | server version advanced past `expectedVersion` (also replay), or a newer schema |
| `conflict` | client believes the server version is ahead — out of sync |
| `invalid` | draft selects a region that cannot store the chosen data class, or leaves a class with no region |
| `blocked` | an incomplete migration blocks the placement change |

## What the UI provides

- Per-data-class region selection (unsupported/deprecated regions disabled).
- Background-job region selection.
- Inline validation (errors block Save).
- Impact preview (`summarizeResidencyImpact`), including migration blockers.
- Explicit compliance banner with reasons and rollout/validation state.
- Version history with field-level comparison and rollback
  (`buildResidencyRollbackDraft` — versioned and re-validated as a new change).

Read-only roles (MEMBER/VIEWER) see the same information with controls disabled.
