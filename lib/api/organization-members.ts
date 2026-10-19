import { apiClient, bearer, retryRead, retryMutation } from "./client";

/**
 * Organization membership and role management.
 *
 * NOTE: `/organizations/{id}/members` is not yet defined in
 * `lib/api/openapi/earnproof-api.v1.json` — the backend does not expose
 * these endpoints today. This module follows the same request/response
 * conventions as the sibling `organizations.ts` / `issuers.ts` clients
 * (REST resource under `/organizations/{id}`, bearer auth, `apiClient`
 * retry helpers) so it can be wired up with no shape changes once the
 * endpoints ship. Because the schema isn't in the OpenAPI spec, it is
 * deliberately NOT registered in `lib/api/client-contracts.json` (that
 * file is checked against the real spec by `npm run test:contracts`).
 *
 * The UI built on top of this module (`components/organizations/
 * organization-members.tsx`) treats any request failure as "unavailable"
 * rather than silently showing an empty list, so users aren't told a
 * member-less organization when the real cause is a missing endpoint.
 */

export const ORGANIZATION_ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export function isOrganizationMemberRole(value: string): value is OrganizationRole {
  return (ORGANIZATION_ROLES as readonly string[]).includes(value);
}

export type OrganizationMember = {
  id: string;
  userId: string;
  organizationId: string;
  walletAddress: string;
  role: OrganizationRole;
  status: "ACTIVE" | "INVITED";
  invitedAt?: string;
  joinedAt?: string;
};

export type InviteOrganizationMemberRequest = {
  walletAddress: string;
  role: OrganizationRole;
};

export type UpdateOrganizationMemberRoleRequest = {
  role: OrganizationRole;
};

export async function getOrganizationMembers(
  token: string,
  organizationId: string,
  signal: AbortSignal
): Promise<OrganizationMember[]> {
  return retryRead(async (signal) => {
    return apiClient<OrganizationMember[]>({
      path: `/organizations/${organizationId}/members`,
      method: "GET",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

export async function inviteOrganizationMember(
  token: string,
  organizationId: string,
  request: InviteOrganizationMemberRequest,
  signal: AbortSignal
): Promise<OrganizationMember> {
  return retryMutation(async (signal) => {
    return apiClient<OrganizationMember>({
      path: `/organizations/${organizationId}/members`,
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify(request),
      signal,
    });
  }, signal);
}

export async function updateOrganizationMemberRole(
  token: string,
  organizationId: string,
  memberId: string,
  request: UpdateOrganizationMemberRoleRequest,
  signal: AbortSignal
): Promise<OrganizationMember> {
  return retryMutation(async (signal) => {
    return apiClient<OrganizationMember>({
      path: `/organizations/${organizationId}/members/${memberId}`,
      method: "PATCH",
      headers: bearer(token),
      body: JSON.stringify(request),
      signal,
    });
  }, signal);
}

export async function removeOrganizationMember(
  token: string,
  organizationId: string,
  memberId: string,
  signal: AbortSignal
): Promise<void> {
  return retryMutation(async (signal) => {
    await apiClient<void>({
      path: `/organizations/${organizationId}/members/${memberId}`,
      method: "DELETE",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

/**
 * Effective, server-rendered capabilities for the current viewer against a
 * single member. The UI must render actions from this object rather than
 * inferring them from role names alone — the server is the source of truth
 * for what's actually permitted (RBAC rules, plan limits, etc. can all
 * change what's allowed beyond a simple role check). Hidden/disabled
 * buttons are a UX convenience only; the server-side endpoints above must
 * independently reject anything the caller isn't authorized to do.
 */
export type MemberCapabilities = {
  canChangeRole: boolean;
  canRemove: boolean;
};

/**
 * Derives a conservative, client-side approximation of capabilities for
 * use only when the server hasn't (yet) provided a `capabilities` field on
 * the member payload. Actual authorization is always re-checked server
 * side on the mutation endpoints above.
 */
export function deriveMemberCapabilities(
  member: OrganizationMember,
  members: OrganizationMember[],
  viewerRole: OrganizationRole | null
): MemberCapabilities {
  if (viewerRole !== "OWNER" && viewerRole !== "ADMIN") {
    return { canChangeRole: false, canRemove: false };
  }

  const ownerCount = members.filter((m) => m.role === "OWNER").length;
  const isLastOwner = member.role === "OWNER" && ownerCount <= 1;

  // Admins cannot demote/remove owners; only an owner can manage owners.
  if (member.role === "OWNER" && viewerRole !== "OWNER") {
    return { canChangeRole: false, canRemove: false };
  }

  return {
    canChangeRole: !isLastOwner,
    canRemove: !isLastOwner,
  };
}

export function formatOrganizationRole(role: OrganizationRole): string {
  switch (role) {
    case "OWNER":
      return "Owner";
    case "ADMIN":
      return "Admin";
    case "MEMBER":
      return "Member";
    default:
      return role;
  }
}

export function validateWalletAddressForInvite(walletAddress: string): string | null {
  const trimmed = walletAddress.trim();
  if (!trimmed) {
    return "Wallet address is required";
  }
  // Stellar public keys (G...) are 56 characters, base32.
  if (!/^G[A-Z2-7]{55}$/.test(trimmed)) {
    return "Enter a valid Stellar public key (starts with G, 56 characters)";
  }
  return null;
}
