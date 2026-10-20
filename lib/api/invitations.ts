import { apiClient, bearer, retryRead, retryMutation } from "./client";
import type { OrganizationRole } from "./organization-members";

/**
 * Organization invitation acceptance (#237).
 *
 * NOTE: as with `organization-members.ts`, `/invitations/{token}` is not
 * yet defined in `lib/api/openapi/earnproof-api.v1.json` - the backend
 * does not expose these endpoints today. This module follows the same
 * request/response conventions as the sibling clients (REST resource,
 * bearer auth, `apiClient` retry helpers) so it can be wired up with no
 * shape changes once the endpoints ship, and is deliberately NOT
 * registered in `lib/api/client-contracts.json` for the same reason.
 */

export type InvitationStatus = "pending" | "accepted" | "declined" | "expired" | "revoked";

export type Invitation = {
  /** Opaque invitation token from the invite link. Never logged or persisted beyond this request's lifetime. */
  token: string;
  organizationId: string;
  organizationName: string;
  role: OrganizationRole;
  /** Wallet address the invitation was issued to. Acceptance is rejected if it doesn't match the connected wallet. */
  inviteeWalletAddress: string;
  inviterWalletAddress: string;
  status: InvitationStatus;
  createdAt: string;
  expiresAt: string;
};

export type AcceptInvitationResponse = {
  invitation: Invitation;
  organizationId: string;
};

/**
 * Looks up an invitation by its token. Does not require the viewer to be
 * authenticated as the invitee yet - this is the "review" step, so an
 * anonymous or differently-authenticated visitor can still see who/what
 * organization/role the invite is for before connecting the right wallet.
 */
export async function getInvitationByToken(
  token: string,
  signal: AbortSignal
): Promise<Invitation> {
  return retryRead(async (signal) => {
    return apiClient<Invitation>({
      path: `/invitations/${encodeURIComponent(token)}`,
      method: "GET",
      signal,
    });
  }, signal);
}

/**
 * Accepts an invitation. The server is the sole source of truth for
 * expiry/revocation/replay/wallet-mismatch rejection - this call either
 * succeeds or throws; the client never decides acceptance is valid on its
 * own. `authToken` must belong to a session for `inviteeWalletAddress`.
 */
export async function acceptInvitation(
  authToken: string,
  invitationToken: string,
  signal: AbortSignal
): Promise<AcceptInvitationResponse> {
  return retryMutation(async (signal) => {
    return apiClient<AcceptInvitationResponse>({
      path: `/invitations/${encodeURIComponent(invitationToken)}/accept`,
      method: "POST",
      headers: bearer(authToken),
      signal,
    });
  }, signal);
}

export async function declineInvitation(
  authToken: string,
  invitationToken: string,
  signal: AbortSignal
): Promise<void> {
  return retryMutation(async (signal) => {
    await apiClient({
      path: `/invitations/${encodeURIComponent(invitationToken)}/decline`,
      method: "POST",
      headers: bearer(authToken),
      signal,
    });
  }, signal);
}

export function isInvitationActionable(invitation: Invitation): boolean {
  return invitation.status === "pending" && new Date(invitation.expiresAt) > new Date();
}

export function getInvitationDisplayStatus(
  invitation: Invitation,
): "pending" | "accepted" | "declined" | "expired" | "revoked" {
  if (invitation.status === "pending" && new Date(invitation.expiresAt) <= new Date()) {
    return "expired";
  }
  return invitation.status;
}

/**
 * True when the connected wallet doesn't match who the invite was issued
 * to. Acceptance must fail closed on this - the UI blocks the accept
 * action rather than relying on the server to reject it, so the mismatch
 * is explained before a signature is ever requested.
 */
export function isWalletMismatch(invitation: Invitation, connectedWalletAddress: string): boolean {
  return invitation.inviteeWalletAddress.toLowerCase() !== connectedWalletAddress.toLowerCase();
}
