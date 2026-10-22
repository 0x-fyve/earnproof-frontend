"use client";

import { formatDate } from "@/lib/i18n";
import type { ShareLinkWithStatus } from "@/lib/proof-sharing/store";
import type { ShareLinkStatus } from "@/lib/validation/proof-sharing";
import { summarizeAccessHistory } from "@/lib/proof-sharing/access-history";
import { ShareLinkAccessInsights } from "./share-link-access-insights";

const STATUS_STYLES: Record<ShareLinkStatus, string> = {
  ACTIVE: "border-emerald-300/30 bg-emerald-300/10 text-emerald-200",
  EXPIRED: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  REVOKED: "border-rose-300/30 bg-rose-300/10 text-rose-200",
};

/**
 * Lists only safe metadata: id, expiry, disclosure policy, and status.
 * Neither the raw token nor its hash is rendered here - the store never
 * exposes the raw token past creation, and the hash carries no reason to
 * be shown to the user.
 */
export function ShareLinkList({
  links,
  onRevoke,
  revokingId,
  userId,
}: {
  links: ShareLinkWithStatus[];
  onRevoke: (id: string) => void;
  revokingId: string | null;
  /** When provided, each link also shows its access history / revocation insights. */
  userId?: string;
}) {
  if (links.length === 0) {
    return (
      <p className="text-sm text-slate-400">No share links have been created for this proof yet.</p>
    );
  }

  return (
    <ul className="grid gap-2" aria-label="Share links">
      {links.map((link) => (
        <li
          key={link.id}
          className={`rounded-md border p-3 text-sm ${STATUS_STYLES[link.status]}`}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold uppercase">{link.status}</span>
            {link.status === "ACTIVE" && (
              <button
                type="button"
                onClick={() => onRevoke(link.id)}
                disabled={revokingId === link.id}
                className="h-7 rounded-md border border-white/20 px-2 text-xs text-white disabled:opacity-50"
              >
                {revokingId === link.id ? "Revoking..." : "Revoke"}
              </button>
            )}
          </div>
          <dl className="mt-2 grid gap-1 text-xs">
            <div className="flex justify-between">
              <dt>Expires</dt>
              <dd>{formatDate(new Date(link.expiresAt))}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Created</dt>
              <dd>{formatDate(new Date(link.createdAt))}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Discloses</dt>
              <dd>
                {[link.discloseAmount && "amount", link.discloseSender && "sender"].filter(Boolean).join(", ") ||
                  "nothing extra"}
              </dd>
            </div>
          </dl>
          {userId ? <ShareLinkAccessInsights summary={summarizeAccessHistory(userId, link)} /> : null}
        </li>
      ))}
    </ul>
  );
}
