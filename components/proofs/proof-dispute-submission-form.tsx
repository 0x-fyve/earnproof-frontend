"use client";

import { useState } from "react";
import { DISPUTE_CATEGORIES, type DisputeCategory } from "@/lib/proof-disputes/store";
import { isSafeEvidenceCommitment, isValidDisputeNote, MAX_DISPUTE_NOTE_LENGTH } from "@/lib/validation/proof-dispute";

const CATEGORY_LABELS: Record<DisputeCategory, string> = {
  incorrect_amount: "Incorrect amount",
  unauthorized_claim: "Unauthorized claim",
  stale_data: "Stale data",
  wrong_recipient: "Wrong recipient",
  other: "Other",
};

/**
 * #234: bounded dispute categories (a fixed enum, never free text) plus
 * an evidence *commitment* rather than a file/URL upload - see
 * lib/validation/proof-dispute.ts's isSafeEvidenceCommitment for why.
 * The note field is optional plain text, length-capped, and never
 * rendered as markup anywhere downstream.
 */
export function ProofDisputeSubmissionForm({
  onSubmit,
  submitting,
}: {
  onSubmit: (input: { category: DisputeCategory; evidenceCommitment: string; note?: string }) => void;
  submitting: boolean;
}) {
  const [category, setCategory] = useState<DisputeCategory>(DISPUTE_CATEGORIES[0]);
  const [evidenceCommitment, setEvidenceCommitment] = useState("");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);

  const evidenceValid = isSafeEvidenceCommitment(evidenceCommitment);
  const noteValid = isValidDisputeNote(note || undefined);
  const isValid = evidenceValid && noteValid;

  function handleSubmit() {
    setTouched(true);
    if (!isValid) {
      return;
    }
    onSubmit({ category, evidenceCommitment: evidenceCommitment.trim(), note: note.trim() || undefined });
  }

  return (
    <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
      <div>
        <h2 className="text-xl font-semibold text-white">Raise a dispute</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Disputing a proof does not change its cryptographic validity or revoke it - it flags
          the claim for review alongside the proof.
        </p>
      </div>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium text-slate-200">Category</legend>
        {DISPUTE_CATEGORIES.map((value) => (
          <label key={value} className="flex items-center gap-3 text-sm text-slate-200">
            <input
              type="radio"
              name="dispute-category"
              checked={category === value}
              onChange={() => setCategory(value)}
              className="h-4 w-4"
            />
            {CATEGORY_LABELS[value]}
          </label>
        ))}
      </fieldset>

      <label className="grid gap-2 text-sm text-slate-200" htmlFor="dispute-evidence-commitment">
        Evidence commitment
        <input
          id="dispute-evidence-commitment"
          type="text"
          value={evidenceCommitment}
          onChange={(event) => setEvidenceCommitment(event.target.value)}
          placeholder="e.g. a reference id or hash, not a link or file"
          className="h-10 rounded-md border border-white/15 bg-slate-950 px-3 text-sm text-white"
        />
        {touched && !evidenceValid && (
          <span className="text-xs text-rose-200" role="alert" data-testid="evidence-validation-error">
            Enter a plain reference id or hash (8-128 characters, no links or markup).
          </span>
        )}
      </label>

      <label className="grid gap-2 text-sm text-slate-200" htmlFor="dispute-note">
        Note (optional)
        <textarea
          id="dispute-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={MAX_DISPUTE_NOTE_LENGTH}
          rows={3}
          className="rounded-md border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white"
        />
        <span className="text-xs text-slate-400">
          {note.length}/{MAX_DISPUTE_NOTE_LENGTH}
        </span>
      </label>

      <button
        type="button"
        disabled={submitting}
        onClick={handleSubmit}
        className="h-10 w-fit rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 disabled:opacity-50"
      >
        {submitting ? "Submitting..." : "Submit dispute"}
      </button>
    </section>
  );
}
