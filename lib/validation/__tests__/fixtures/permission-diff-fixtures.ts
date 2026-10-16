/**
 * Synthetic fixtures for permission diff testing.
 *
 * Covers positive cases (added, removed, unchanged), negative cases
 * (unknown permissions, edge boundaries), authorization scenarios,
 * and concurrency/stale-state patterns.
 *
 * No secrets, wallet material, private proof data, or production
 * credentials are included.
 */

import type { PermissionChange, PermissionDiff } from "@/lib/validation/permission-diff";

/**
 * Sample permission metadata for testing (mimics scope catalog entries).
 */
export const FIXTURE_PERMISSIONS: Record<string, PermissionChange> = {
  "verification:read": {
    id: "verification:read",
    title: "Read Verification Status",
    description: "Verify proof credentials and read verification status",
    status: "unchanged",
    isBroad: false,
    category: "verification",
  },

  "proofs:read": {
    id: "proofs:read",
    title: "Read Proofs",
    description: "Read proof metadata and status",
    status: "unchanged",
    isBroad: false,
    category: "proofs",
  },

  "proofs:create": {
    id: "proofs:create",
    title: "Create Proofs",
    description: "Create and submit new proofs for verification",
    status: "unchanged",
    isBroad: true,
    category: "proofs",
  },

  "webhooks:manage": {
    id: "webhooks:manage",
    title: "Manage Webhooks",
    description: "Create, update, and delete webhook endpoints",
    status: "unchanged",
    isBroad: true,
    category: "webhooks",
  },
};

/**
 * Sample organization roles for testing.
 */
export const FIXTURE_ROLES: Record<string, PermissionChange> = {
  OWNER: {
    id: "OWNER",
    title: "Owner",
    description: "Full control over organization and all data",
    status: "unchanged",
    isBroad: true,
    category: "roles",
  },

  ADMIN: {
    id: "ADMIN",
    title: "Administrator",
    description: "Can manage members, API keys, and settings",
    status: "unchanged",
    isBroad: true,
    category: "roles",
  },

  MEMBER: {
    id: "MEMBER",
    title: "Member",
    description: "Can access proofs and verification data",
    status: "unchanged",
    isBroad: false,
    category: "roles",
  },
};

/**
 * Fixture: API key scope diff - adding a read-only scope (minimal risk).
 */
export const FIXTURE_DIFF_ADD_READ_SCOPE: PermissionDiff = {
  all: [
    { ...FIXTURE_PERMISSIONS["proofs:read"], status: "unchanged" },
    { ...FIXTURE_PERMISSIONS["verification:read"], status: "added" },
  ],
  added: [{ ...FIXTURE_PERMISSIONS["verification:read"], status: "added" }],
  removed: [],
  unchanged: [{ ...FIXTURE_PERMISSIONS["proofs:read"], status: "unchanged" }],
  inherited: [],
  riskSummary: {
    hasBroadPermissions: false,
    hasRemovals: false,
    hasDestructiveRemovals: false,
    addedCount: 1,
    removedCount: 0,
    unchangedCount: 1,
    inheritedCount: 0,
  },
  requiresConfirmation: false,
};

/**
 * Fixture: API key scope diff - adding a broad scope (requires confirmation).
 */
export const FIXTURE_DIFF_ADD_BROAD_SCOPE: PermissionDiff = {
  all: [
    { ...FIXTURE_PERMISSIONS["proofs:read"], status: "unchanged" },
    { ...FIXTURE_PERMISSIONS["proofs:create"], status: "added" },
  ],
  added: [{ ...FIXTURE_PERMISSIONS["proofs:create"], status: "added" }],
  removed: [],
  unchanged: [{ ...FIXTURE_PERMISSIONS["proofs:read"], status: "unchanged" }],
  inherited: [],
  riskSummary: {
    hasBroadPermissions: true,
    hasRemovals: false,
    hasDestructiveRemovals: false,
    addedCount: 1,
    removedCount: 0,
    unchangedCount: 1,
    inheritedCount: 0,
  },
  requiresConfirmation: true,
  confirmationReason:
    "This change adds broad permissions that can create, modify, or delete data.",
};

/**
 * Fixture: API key scope diff - removing a scope (requires confirmation).
 */
export const FIXTURE_DIFF_REMOVE_SCOPE: PermissionDiff = {
  all: [
    { ...FIXTURE_PERMISSIONS["proofs:read"], status: "unchanged" },
    { ...FIXTURE_PERMISSIONS["verification:read"], status: "removed" },
  ],
  added: [],
  removed: [
    { ...FIXTURE_PERMISSIONS["verification:read"], status: "removed", isDestructiveRemoval: false },
  ],
  unchanged: [{ ...FIXTURE_PERMISSIONS["proofs:read"], status: "unchanged" }],
  inherited: [],
  riskSummary: {
    hasBroadPermissions: false,
    hasRemovals: true,
    hasDestructiveRemovals: false,
    addedCount: 0,
    removedCount: 1,
    unchangedCount: 1,
    inheritedCount: 0,
  },
  requiresConfirmation: true,
  confirmationReason:
    "Permissions are being removed. This action may cause integrations to fail.",
};

/**
 * Fixture: API key scope diff - removing a broad scope (high risk, destructive).
 */
export const FIXTURE_DIFF_REMOVE_BROAD_SCOPE: PermissionDiff = {
  all: [
    { ...FIXTURE_PERMISSIONS["proofs:read"], status: "unchanged" },
    {
      ...FIXTURE_PERMISSIONS["webhooks:manage"],
      status: "removed",
      isDestructiveRemoval: true,
    },
  ],
  added: [],
  removed: [
    {
      ...FIXTURE_PERMISSIONS["webhooks:manage"],
      status: "removed",
      isDestructiveRemoval: true,
    },
  ],
  unchanged: [{ ...FIXTURE_PERMISSIONS["proofs:read"], status: "unchanged" }],
  inherited: [],
  riskSummary: {
    hasBroadPermissions: false,
    hasRemovals: true,
    hasDestructiveRemovals: true,
    addedCount: 0,
    removedCount: 1,
    unchangedCount: 1,
    inheritedCount: 0,
  },
  requiresConfirmation: true,
  confirmationReason:
    "Destructive permission removals require confirmation to prevent service interruption.",
};

/**
 * Fixture: API key scope diff - no changes (unchanged state).
 */
export const FIXTURE_DIFF_NO_CHANGES: PermissionDiff = {
  all: [
    { ...FIXTURE_PERMISSIONS["proofs:read"], status: "unchanged" },
    { ...FIXTURE_PERMISSIONS["verification:read"], status: "unchanged" },
  ],
  added: [],
  removed: [],
  unchanged: [
    { ...FIXTURE_PERMISSIONS["proofs:read"], status: "unchanged" },
    { ...FIXTURE_PERMISSIONS["verification:read"], status: "unchanged" },
  ],
  inherited: [],
  riskSummary: {
    hasBroadPermissions: false,
    hasRemovals: false,
    hasDestructiveRemovals: false,
    addedCount: 0,
    removedCount: 0,
    unchangedCount: 2,
    inheritedCount: 0,
  },
  requiresConfirmation: false,
};

/**
 * Fixture: API key scope diff - complex change (added, removed, unchanged).
 */
export const FIXTURE_DIFF_COMPLEX_CHANGE: PermissionDiff = {
  all: [
    { ...FIXTURE_PERMISSIONS["proofs:read"], status: "unchanged" },
    { ...FIXTURE_PERMISSIONS["proofs:create"], status: "added" },
    { ...FIXTURE_PERMISSIONS["verification:read"], status: "removed" },
  ],
  added: [{ ...FIXTURE_PERMISSIONS["proofs:create"], status: "added" }],
  removed: [
    { ...FIXTURE_PERMISSIONS["verification:read"], status: "removed", isDestructiveRemoval: false },
  ],
  unchanged: [{ ...FIXTURE_PERMISSIONS["proofs:read"], status: "unchanged" }],
  inherited: [],
  riskSummary: {
    hasBroadPermissions: true,
    hasRemovals: true,
    hasDestructiveRemovals: false,
    addedCount: 1,
    removedCount: 1,
    unchangedCount: 1,
    inheritedCount: 0,
  },
  requiresConfirmation: true,
  confirmationReason:
    "This change adds broad permissions that can create, modify, or delete data.",
};

/**
 * Fixture: Role change diff - member to admin (adds capabilities).
 */
export const FIXTURE_DIFF_ROLE_PROMOTION: PermissionDiff = {
  all: [
    {
      ...FIXTURE_ROLES.MEMBER,
      status: "removed",
      isDestructiveRemoval: false,
    },
    {
      ...FIXTURE_ROLES.ADMIN,
      status: "added",
      isBroad: true,
    },
  ],
  added: [
    {
      ...FIXTURE_ROLES.ADMIN,
      status: "added",
      isBroad: true,
    },
  ],
  removed: [
    {
      ...FIXTURE_ROLES.MEMBER,
      status: "removed",
      isDestructiveRemoval: false,
    },
  ],
  unchanged: [],
  inherited: [],
  riskSummary: {
    hasBroadPermissions: true,
    hasRemovals: true,
    hasDestructiveRemovals: false,
    addedCount: 1,
    removedCount: 1,
    unchangedCount: 0,
    inheritedCount: 0,
  },
  requiresConfirmation: true,
  confirmationReason:
    "This change adds broad permissions that can create, modify, or delete data.",
};

/**
 * Fixture: Role change diff - admin to member (removes capabilities, destructive).
 */
export const FIXTURE_DIFF_ROLE_DEMOTION: PermissionDiff = {
  all: [
    {
      ...FIXTURE_ROLES.ADMIN,
      status: "removed",
      isDestructiveRemoval: true,
    },
    {
      ...FIXTURE_ROLES.MEMBER,
      status: "added",
    },
  ],
  added: [
    {
      ...FIXTURE_ROLES.MEMBER,
      status: "added",
    },
  ],
  removed: [
    {
      ...FIXTURE_ROLES.ADMIN,
      status: "removed",
      isDestructiveRemoval: true,
    },
  ],
  unchanged: [],
  inherited: [],
  riskSummary: {
    hasBroadPermissions: false,
    hasRemovals: true,
    hasDestructiveRemovals: true,
    addedCount: 1,
    removedCount: 1,
    unchangedCount: 0,
    inheritedCount: 0,
  },
  requiresConfirmation: true,
  confirmationReason:
    "Destructive permission removals require confirmation to prevent service interruption.",
};

/**
 * Fixture: Diff with inherited permissions (e.g., role-based inheritance).
 */
export const FIXTURE_DIFF_WITH_INHERITED: PermissionDiff = {
  all: [
    { ...FIXTURE_PERMISSIONS["proofs:read"], status: "unchanged" },
    { ...FIXTURE_PERMISSIONS["proofs:create"], status: "inherited" },
  ],
  added: [],
  removed: [],
  unchanged: [{ ...FIXTURE_PERMISSIONS["proofs:read"], status: "unchanged" }],
  inherited: [
    {
      ...FIXTURE_PERMISSIONS["proofs:create"],
      status: "inherited",
    },
  ],
  riskSummary: {
    hasBroadPermissions: true,
    hasRemovals: false,
    hasDestructiveRemovals: false,
    addedCount: 0,
    removedCount: 0,
    unchangedCount: 1,
    inheritedCount: 1,
  },
  requiresConfirmation: true,
  confirmationReason:
    "This change adds broad permissions that can create, modify, or delete data.",
};

/**
 * Fixture: Unknown permission handling (fail-closed pattern).
 */
export const FIXTURE_UNKNOWN_PERMISSION: PermissionChange = {
  id: "unknown:scope",
  title: "unknown:scope",
  description: "Unknown permission - will be filtered out",
  status: "unchanged",
  category: "unknown",
};

/**
 * Fixture for authorization tests: Owner role capabilities.
 */
export const FIXTURE_OWNER_CAPABILITIES = {
  canChangeRole: true,
  canRemove: true,
  canInvite: true,
  canArchive: true,
};

/**
 * Fixture for authorization tests: Admin role capabilities.
 */
export const FIXTURE_ADMIN_CAPABILITIES = {
  canChangeRole: true,
  canRemove: true,
  canInvite: true,
  canArchive: false,
};

/**
 * Fixture for authorization tests: Member role capabilities.
 */
export const FIXTURE_MEMBER_CAPABILITIES = {
  canChangeRole: false,
  canRemove: false,
  canInvite: false,
  canArchive: false,
};

/**
 * Fixture: Replay scenario - same diff calculated twice should be identical.
 */
export function createReplayScenario() {
  return {
    before: ["proofs:read"],
    after: ["proofs:read", "proofs:create"],
    expectedAdded: ["proofs:create"],
    expectedRemoved: [] as string[],
    expectedUnchanged: ["proofs:read"],
  };
}

/**
 * Fixture: Concurrency scenario - multiple diff calculations in parallel.
 */
export function createConcurrencyScenarios() {
  return [
    {
      name: "concurrent_add_different_scopes",
      scenarios: [
        { before: [], after: ["proofs:read"] },
        { before: [], after: ["verification:read"] },
        { before: [], after: ["webhooks:manage"] },
      ],
    },
    {
      name: "concurrent_remove_different_scopes",
      scenarios: [
        { before: ["proofs:read", "verification:read"], after: ["verification:read"] },
        { before: ["proofs:read", "proofs:create"], after: ["proofs:read"] },
        { before: ["webhooks:manage"], after: [] },
      ],
    },
  ];
}

/**
 * Fixture: Boundary case - empty permission sets.
 */
export const FIXTURE_BOUNDARY_EMPTY: PermissionDiff = {
  all: [],
  added: [],
  removed: [],
  unchanged: [],
  inherited: [],
  riskSummary: {
    hasBroadPermissions: false,
    hasRemovals: false,
    hasDestructiveRemovals: false,
    addedCount: 0,
    removedCount: 0,
    unchangedCount: 0,
    inheritedCount: 0,
  },
  requiresConfirmation: false,
};

/**
 * Fixture: Boundary case - all permissions at once (large set).
 */
export const FIXTURE_BOUNDARY_ALL_PERMISSIONS: PermissionDiff = {
  all: [
    { ...FIXTURE_PERMISSIONS["proofs:read"], status: "unchanged" },
    { ...FIXTURE_PERMISSIONS["verification:read"], status: "unchanged" },
    { ...FIXTURE_PERMISSIONS["proofs:create"], status: "unchanged" },
    { ...FIXTURE_PERMISSIONS["webhooks:manage"], status: "unchanged" },
  ],
  added: [],
  removed: [],
  unchanged: [
    { ...FIXTURE_PERMISSIONS["proofs:read"], status: "unchanged" },
    { ...FIXTURE_PERMISSIONS["verification:read"], status: "unchanged" },
    { ...FIXTURE_PERMISSIONS["proofs:create"], status: "unchanged" },
    { ...FIXTURE_PERMISSIONS["webhooks:manage"], status: "unchanged" },
  ],
  inherited: [],
  riskSummary: {
    hasBroadPermissions: true,
    hasRemovals: false,
    hasDestructiveRemovals: false,
    addedCount: 0,
    removedCount: 0,
    unchangedCount: 4,
    inheritedCount: 0,
  },
  requiresConfirmation: true,
  confirmationReason:
    "This change adds broad permissions that can create, modify, or delete data.",
};
