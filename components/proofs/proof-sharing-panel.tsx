"use client";

import { useState } from "react";
import { CreateShareLinkForm } from "./create-share-link-form";
import { ShareLinkTokenReveal } from "./share-link-token-reveal";
import { ShareLinkList } from "./share-link-list";
import { createShareLink, revokeShareLink, listShareLinks, type ShareLinkRecord } from "@/lib/proof-sharing/store";

export function ProofSharingPanel({ proofId, userId }: { proofId: string; userId: string }) {
  const [links, setLinks] = useState(() => listShareLinks(userId, proofId));
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revealedToken, setRevealedToken] = useState<{ token: string; record: ShareLinkRecord } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(input: { expiresInHours: number; discloseAmount: boolean; discloseSender: boolean }) {
    setError(null);
    setCreating(true);
    try {
      const created = await createShareLink(userId, { proofId, ...input });
      setRevealedToken(created);
      setLinks(listShareLinks(userId, proofId));
    } catch {
      setError("Could not create the share link. Try again.");
    } finally {
      setCreating(false);
    }
  }

  function handleRevoke(id: string) {
    setError(null);
    setRevokingId(id);
    try {
      revokeShareLink(userId, id);
      setLinks(listShareLinks(userId, proofId));
    } catch {
      setError("Could not revoke this link. Try again.");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="grid gap-6">
      {revealedToken ? (
        <ShareLinkTokenReveal
          token={revealedToken.token}
          expiresAt={revealedToken.record.expiresAt}
          onDismiss={() => setRevealedToken(null)}
        />
      ) : (
        <CreateShareLinkForm onCreate={(input) => void handleCreate(input)} creating={creating} />
      )}

      {error && (
        <p className="text-sm text-rose-200" role="alert">
          {error}
        </p>
      )}

      <section className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 className="text-xl font-semibold text-white">Active share links</h2>
        <ShareLinkList links={links} onRevoke={handleRevoke} revokingId={revokingId} userId={userId} />
      </section>
    </div>
  );
}
