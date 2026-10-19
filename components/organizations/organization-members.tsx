"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import {
  getOrganizationMembers,
  inviteOrganizationMember,
  updateOrganizationMemberRole,
  removeOrganizationMember,
  formatOrganizationRole,
  deriveMemberCapabilities,
  ORGANIZATION_ROLES,
  type OrganizationMember,
  type OrganizationRole,
} from "@/lib/api/organization-members";
import {
  inviteOrganizationMemberSchema,
  type InviteOrganizationMemberInput,
} from "@/lib/validation/organization-members";
import { ConfirmationDialog } from "@/components/common/confirmation-dialog";
import { formatMessage } from "@/lib/i18n";
import { readStoredSession, clearStoredSession } from "@/lib/session";

type SessionData = {
  token: string;
  user: {
    id: string;
    walletAddress: string;
    role: string;
  };
};

/**
 * Member listing, invitation, role change, and removal for a single
 * organization. Rendered inline under an organization row in
 * `OrganizationList` when an admin expands "Manage Members".
 *
 * Server-endpoint status: `/organizations/{id}/members` does not exist in
 * the current backend (see `lib/api/organization-members.ts`). A failed
 * fetch renders an explicit "member management is unavailable" state
 * rather than an empty member list, so the two situations are never
 * confused (see the loadError/hasLoaded distinction below).
 */
export function OrganizationMembers({
  organizationId,
  organizationName,
  token,
}: {
  organizationId: string;
  organizationName: string;
  token: string;
}) {
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<OrganizationMember | null>(null);
  const [sessionStale, setSessionStale] = useState(false);

  const session = readStoredSession();
  const viewerWalletAddress = session?.user.walletAddress ?? null;
  const viewerMembership = members.find((m) => m.walletAddress === viewerWalletAddress) ?? null;
  // Fall back to null (no elevated permissions) rather than guessing when
  // the viewer isn't found in the member list yet.
  const viewerRole: OrganizationRole | null = viewerMembership?.role ?? null;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteOrganizationMemberInput>({
    defaultValues: { role: "MEMBER" },
  });

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const controller = new AbortController();
      const result = await getOrganizationMembers(token, organizationId, controller.signal);
      setMembers(result);
      setHasLoaded(true);
    } catch {
      setLoadError(
        "Member management is unavailable right now. The organization membership service could not be reached."
      );
      setHasLoaded(false);
    } finally {
      setLoading(false);
    }
  }, [token, organizationId]);

  useEffect(() => {
    let active = true;

    void Promise.resolve().then(() => {
      if (active) {
        void loadMembers();
      }
    });

    return () => {
      active = false;
    };
  }, [loadMembers]);

  const onInvite = useCallback(
    async (data: InviteOrganizationMemberInput) => {
      setActionError(null);
      try {
        const validated = inviteOrganizationMemberSchema.parse(data);
        const controller = new AbortController();
        const member = await inviteOrganizationMember(token, organizationId, validated, controller.signal);
        setMembers((prev) => [...prev, member]);
        reset({ walletAddress: "", role: "MEMBER" });
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : "Failed to invite member. Please check the wallet address and try again."
        );
      }
    },
    [token, organizationId, reset]
  );

  const onChangeRole = useCallback(
    async (member: OrganizationMember, role: OrganizationRole) => {
      setActionLoading(member.id);
      setActionError(null);
      try {
        const controller = new AbortController();
        const updated = await updateOrganizationMemberRole(
          token,
          organizationId,
          member.id,
          { role },
          controller.signal
        );
        setMembers((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        // A role change may affect the acting viewer's own permissions
        // (e.g. an owner demoting themselves). Force re-authentication by
        // clearing the local session so stale role/session data can't be
        // relied on for subsequent authorization decisions in this tab.
        if (member.walletAddress === viewerWalletAddress) {
          setSessionStale(true);
        }
        // Refresh from the server so any server-side side effects
        // (ownership transfer invariants, etc.) are reflected exactly.
        await loadMembers();
      } catch {
        setActionError("Failed to update member role. Please try again.");
      } finally {
        setActionLoading(null);
      }
    },
    [token, organizationId, viewerWalletAddress, loadMembers]
  );

  const onRemove = useCallback(
    async (member: OrganizationMember) => {
      setActionLoading(member.id);
      setActionError(null);
      try {
        const controller = new AbortController();
        await removeOrganizationMember(token, organizationId, member.id, controller.signal);
        setMembers((prev) => prev.filter((m) => m.id !== member.id));
        if (member.walletAddress === viewerWalletAddress) {
          setSessionStale(true);
        }
      } catch {
        setActionError("Failed to remove member. Please try again.");
      } finally {
        setActionLoading(null);
        setConfirmRemove(null);
      }
    },
    [token, organizationId, viewerWalletAddress]
  );

  const handleSignOutStaleSession = useCallback(() => {
    clearStoredSession("unauthorized");
    window.location.reload();
  }, []);

  return (
    <section
      aria-label={formatMessage("Members of {organizationName}", { organizationName })}
      className="grid gap-4 rounded-lg border border-white/10 bg-slate-950 p-4"
    >
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-lg font-semibold text-white">Members</h3>
          <p className="mt-1 text-xs text-slate-400">
            Invite members, change roles, and remove access. Removing the last owner is blocked.
          </p>
        </div>
        <button
          className="h-9 rounded-md border border-white/15 px-3 text-xs font-semibold text-white disabled:opacity-50"
          disabled={loading}
          onClick={loadMembers}
          type="button"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {sessionStale && (
        <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3" role="alert">
          <p className="text-sm text-amber-100">
            Your role in this organization changed. Sign in again to continue with up-to-date permissions.
          </p>
          <button
            className="mt-2 h-8 rounded border border-amber-300/40 px-3 text-xs font-semibold text-amber-100 hover:bg-amber-300/10"
            onClick={handleSignOutStaleSession}
            type="button"
          >
            Sign out
          </button>
        </div>
      )}

      {loadError && (
        <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
          <p className="text-sm text-rose-200" role="alert">
            {loadError}
          </p>
        </div>
      )}

      {actionError && (
        <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
          <p className="text-sm text-rose-200" role="alert">
            {actionError}
          </p>
        </div>
      )}

      <form className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end" onSubmit={handleSubmit(onInvite)}>
        <div>
          <label className="block text-xs font-medium text-slate-200" htmlFor={`invite-wallet-${organizationId}`}>
            Wallet address
          </label>
          <input
            className="mt-1 h-10 w-full rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-white placeholder:text-slate-400"
            id={`invite-wallet-${organizationId}`}
            placeholder="G..."
            type="text"
            {...register("walletAddress", { required: "Wallet address is required" })}
          />
          {errors.walletAddress && (
            <p className="mt-1 text-xs text-rose-200" role="alert">
              {errors.walletAddress.message}
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-200" htmlFor={`invite-role-${organizationId}`}>
            Role
          </label>
          <select
            className="mt-1 h-10 w-full rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-white"
            id={`invite-role-${organizationId}`}
            {...register("role")}
          >
            {ORGANIZATION_ROLES.map((role) => (
              <option key={role} value={role}>
                {formatOrganizationRole(role)}
              </option>
            ))}
          </select>
        </div>
        <button
          className="h-10 rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 disabled:opacity-50"
          type="submit"
        >
          Invite
        </button>
      </form>

      {loading && members.length === 0 && !loadError ? (
        <p className="text-sm text-slate-400">Loading members...</p>
      ) : !hasLoaded && loadError ? null : members.length === 0 ? (
        <p className="text-sm text-slate-400">No members yet. Invite someone above.</p>
      ) : (
        <ul className="grid gap-2">
          {members.map((member) => {
            const capabilities = deriveMemberCapabilities(member, members, viewerRole);
            const isSelf = member.walletAddress === viewerWalletAddress;
            return (
              <li
                className="grid gap-2 rounded-md border border-white/10 bg-white/[0.03] p-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-center"
                key={member.id}
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-slate-300">{member.walletAddress}</p>
                  {isSelf && <p className="text-[11px] text-cyan-200">You</p>}
                </div>
                <div className="text-xs text-slate-300">{member.status === "INVITED" ? "Invited" : "Active"}</div>
                <div>
                  <label className="sr-only" htmlFor={`role-${member.id}`}>
                    {formatMessage("Role for {walletAddress}", { walletAddress: member.walletAddress })}
                  </label>
                  <select
                    className="h-8 w-full rounded border border-white/10 bg-slate-900 px-2 text-xs text-white disabled:opacity-50"
                    disabled={!capabilities.canChangeRole || actionLoading === member.id}
                    id={`role-${member.id}`}
                    onChange={(event) => onChangeRole(member, event.target.value as OrganizationRole)}
                    value={member.role}
                  >
                    {ORGANIZATION_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {formatOrganizationRole(role)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end">
                  <button
                    aria-label={formatMessage("Remove {walletAddress} from {organizationName}", {
                      walletAddress: member.walletAddress,
                      organizationName,
                    })}
                    className="h-8 rounded border border-rose-300/30 px-3 text-xs font-medium text-rose-200 hover:bg-rose-300/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    disabled={!capabilities.canRemove || actionLoading === member.id}
                    onClick={() => setConfirmRemove(member)}
                    title={
                      !capabilities.canRemove
                        ? "The last owner of an organization cannot be removed"
                        : undefined
                    }
                    type="button"
                  >
                    {actionLoading === member.id ? "..." : "Remove"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {confirmRemove && (
        <ConfirmationDialog
          confirmText="Remove Member"
          confirmVariant="danger"
          isProcessing={actionLoading === confirmRemove.id}
          message={formatMessage(
            'Are you sure you want to remove "{walletAddress}" from {organizationName}? They will immediately lose access to this organization.',
            { walletAddress: confirmRemove.walletAddress, organizationName }
          )}
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() => onRemove(confirmRemove)}
          title="Remove Member"
        />
      )}
    </section>
  );
}
