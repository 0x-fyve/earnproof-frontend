import {
  compareCredentialWithPublicState,
  describeMismatchKind,
  describeOutcome,
  type ImportedCredentialSummary,
  type PublicStateComparisonResult,
} from "@/lib/credentials/public-state-comparison";
import type { VerifyProofResponse } from "@/components/verification/verification-panel";
import { Timestamp } from "@/components/common/timestamp";

const outcomeTone: Record<PublicStateComparisonResult["outcome"], string> = {
  exact_match: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  field_mismatch: "border-rose-300/30 bg-rose-300/10 text-rose-100",
  stale: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  revoked: "border-rose-400/40 bg-rose-400/15 text-rose-100",
  superseded: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  unknown_proof: "border-slate-300/20 bg-slate-300/10 text-slate-100",
  malformed_credential: "border-slate-300/20 bg-slate-300/10 text-slate-100",
};

const outcomeLabel: Record<PublicStateComparisonResult["outcome"], string> = {
  exact_match: "Matches public record",
  field_mismatch: "Mismatch found",
  stale: "Stale",
  revoked: "Revoked",
  superseded: "Superseded",
  unknown_proof: "Unknown proof",
  malformed_credential: "Malformed credential",
};

/**
 * Renders the comparison between an imported credential and the current
 * public proof record (#225). Deliberately rendered as its own section,
 * separate from VerificationPanel's signature-result badge — this
 * component never reads `signatureResult` to decide its own content, and
 * the caller must never collapse the two into a single "verified"
 * badge (see public-state-comparison.ts's header comment for the
 * invariant this enforces).
 */
export function CredentialPublicStateComparison({
  imported,
  response,
  signatureResult,
}: {
  imported: ImportedCredentialSummary | null;
  response: VerifyProofResponse;
  /** Shown read-only, side by side with the comparison outcome — never merged into it. */
  signatureResult: VerifyProofResponse["result"];
}) {
  if (!imported) {
    return (
      <div
        className="rounded-lg border border-slate-300/20 bg-slate-300/10 p-5"
        role="status"
      >
        <h3 className="text-sm font-semibold text-slate-100">Public state comparison unavailable</h3>
        <p className="mt-2 text-xs text-slate-300">
          The imported credential could not be parsed well enough to compare against the
          public proof record.
        </p>
      </div>
    );
  }

  const comparison = compareCredentialWithPublicState(imported, response);

  return (
    <div
      className="rounded-lg border border-white/10 bg-white/[0.04] p-5"
      role="region"
      aria-labelledby="comparison-heading"
    >
      <h3 id="comparison-heading" className="text-lg font-semibold text-white">
        Comparison with public proof state
      </h3>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
          <p className="text-xs font-semibold uppercase text-slate-400">Signature verification</p>
          <p className="mt-1 text-sm text-slate-200">{signatureResult}</p>
          <p className="mt-1 text-xs text-slate-500">
            Independent of the comparison below — a valid signature does not imply the proof is
            still current, and a stale/revoked proof does not imply the signature was invalid.
          </p>
        </div>

        <div
          className={`rounded-md border p-3 text-sm font-semibold ${outcomeTone[comparison.outcome]}`}
        >
          {outcomeLabel[comparison.outcome]}
        </div>
      </div>

      <p className="mt-3 text-sm text-slate-300">{describeOutcome(comparison.outcome)}</p>

      {comparison.mismatches.length > 0 && (
        <table className="mt-4 w-full text-left text-xs">
          <thead>
            <tr className="text-slate-400">
              <th className="pb-1 pr-4 font-semibold">Field</th>
              <th className="pb-1 pr-4 font-semibold">Imported credential said</th>
              <th className="pb-1 font-semibold">Public record currently says</th>
            </tr>
          </thead>
          <tbody>
            {comparison.mismatches.map((mismatch) => (
              <tr key={mismatch.kind} className="border-t border-white/10 text-slate-200">
                <td className="py-2 pr-4 font-medium">{describeMismatchKind(mismatch.kind)}</td>
                <td className="py-2 pr-4 break-all">{mismatch.importedValue ?? "—"}</td>
                <td className="py-2 break-all">{mismatch.currentValue ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {comparison.currentProof && (
        <dl className="mt-4 grid gap-1 border-t border-white/10 pt-3 text-xs text-slate-400">
          <div>
            <dt className="inline font-semibold">Current public record expires: </dt>
            <dd className="inline">
              <Timestamp value={comparison.currentProof.expiresAt} />
            </dd>
          </div>
          {comparison.currentProof.revokedAt && (
            <div>
              <dt className="inline font-semibold">Revoked at: </dt>
              <dd className="inline">
                <Timestamp value={comparison.currentProof.revokedAt} />
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
