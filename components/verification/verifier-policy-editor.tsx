"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  archivePolicyProfile,
  createPolicyProfile,
  duplicatePolicyProfile,
  listPolicyProfiles,
  reactivatePolicyProfile,
  updatePolicyProfile,
  type VerifierPolicyProfile,
} from "@/lib/verifier-policies/store";
import { evaluateProfile, describeFailureReason } from "@/lib/verifier-policies/evaluation";
import {
  findStaleIssuerReferences,
  validatePolicyProfileForm,
} from "@/lib/validation/verifier-policies";
import { getIssuers } from "@/lib/api/issuers";
import type { Issuer, VerifyProofResponse } from "@/lib/api/generated/v1";
import { readStoredSession, type Session as SessionData } from "@/lib/session";

type FormState = {
  name: string;
  description: string;
  acceptedIssuerIds: string[];
  acceptedSchemaVersions: string;
  acceptedProofTypes: string;
  maxFreshnessSeconds: number;
  requiredDisclosureFields: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  acceptedIssuerIds: [],
  acceptedSchemaVersions: "",
  acceptedProofTypes: "",
  maxFreshnessSeconds: 3600,
  requiredDisclosureFields: "",
};

function toCsvArray(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function fromArray(values: string[]): string {
  return values.join(", ");
}

function profileToFormState(profile: VerifierPolicyProfile): FormState {
  return {
    name: profile.name,
    description: profile.description,
    acceptedIssuerIds: [...profile.acceptedIssuerIds],
    acceptedSchemaVersions: fromArray(profile.acceptedSchemaVersions),
    acceptedProofTypes: fromArray(profile.acceptedProofTypes),
    maxFreshnessSeconds: profile.maxFreshnessSeconds,
    requiredDisclosureFields: fromArray(profile.requiredDisclosureFields),
  };
}

/**
 * Representative sample verification results for the "preview how a
 * profile evaluates representative verification results" requirement.
 * These are fixtures, never a real network call — the preview is purely
 * local/instant.
 */
function buildSampleVerificationResults(): Array<{ label: string; response: VerifyProofResponse }> {
  const freshIssuedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const staleIssuedAt = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();

  return [
    {
      label: "Valid, fresh, known issuer",
      response: {
        result: "VALID",
        status: "valid",
        credential: {
          id: "cred-1",
          type: "minimum_income",
          schemaVersion: "1.0",
          issuer: "issuer-known",
          subject: { walletHash: "wh-1" },
          claim: { operator: "gte", thresholdAmount: "1000", assetCode: "USDC" },
        } as VerifyProofResponse["credential"],
        proof: {
          id: "proof-1",
          type: "minimum_income",
          schemaVersion: "1.0",
          network: "testnet",
          issuedAt: freshIssuedAt,
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        },
      },
    },
    {
      label: "Valid, but issuer unknown to this profile",
      response: {
        result: "VALID",
        status: "valid",
        credential: {
          id: "cred-2",
          type: "minimum_income",
          schemaVersion: "1.0",
          issuer: "issuer-unrecognized",
          subject: { walletHash: "wh-2" },
          claim: { operator: "gte", thresholdAmount: "500", assetCode: "USDC" },
        } as VerifyProofResponse["credential"],
        proof: {
          id: "proof-2",
          type: "minimum_income",
          schemaVersion: "1.0",
          network: "testnet",
          issuedAt: freshIssuedAt,
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        },
      },
    },
    {
      label: "Valid, but stale (issued almost a year ago)",
      response: {
        result: "VALID",
        status: "valid",
        credential: {
          id: "cred-3",
          type: "minimum_income",
          schemaVersion: "1.0",
          issuer: "issuer-known",
          subject: { walletHash: "wh-3" },
          claim: { operator: "gte", thresholdAmount: "1000", assetCode: "USDC" },
        } as VerifyProofResponse["credential"],
        proof: {
          id: "proof-3",
          type: "minimum_income",
          schemaVersion: "1.0",
          network: "testnet",
          issuedAt: staleIssuedAt,
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        },
      },
    },
    {
      label: "Cryptographically invalid (revoked)",
      response: {
        result: "REVOKED",
        status: "revoked",
      },
    },
  ];
}

export function VerifierPolicyEditor() {
  const [session] = useState<SessionData | null>(() => readStoredSession());
  const [profiles, setProfiles] = useState<VerifierPolicyProfile[]>([]);
  const [issuers, setIssuers] = useState<Issuer[]>([]);
  const [issuersError, setIssuersError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const refreshProfiles = useCallback(() => {
    if (!session) return;
    setProfiles(listPolicyProfiles(session.user.id));
  }, [session]);

  useEffect(() => {
    void Promise.resolve().then(refreshProfiles);
  }, [refreshProfiles]);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    getIssuers(session.token, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setIssuers(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setIssuersError("Could not load issuer capabilities; validation against the server issuer list is unavailable.");
        }
      });
    return () => controller.abort();
  }, [session]);

  const startCreate = useCallback(() => {
    setEditingId("new");
    setForm(EMPTY_FORM);
    setFormError(null);
  }, []);

  const startEdit = useCallback((profile: VerifierPolicyProfile) => {
    setEditingId(profile.id);
    setForm(profileToFormState(profile));
    setFormError(null);
  }, []);

  const handleSave = useCallback(() => {
    if (!session) return;

    const parsed = validatePolicyProfileForm({
      name: form.name,
      description: form.description,
      acceptedIssuerIds: form.acceptedIssuerIds,
      acceptedSchemaVersions: toCsvArray(form.acceptedSchemaVersions),
      acceptedProofTypes: toCsvArray(form.acceptedProofTypes),
      maxFreshnessSeconds: form.maxFreshnessSeconds,
      requiredDisclosureFields: toCsvArray(form.requiredDisclosureFields),
    });

    if (!parsed.success) {
      setFormError(parsed.error);
      return;
    }

    if (editingId === "new") {
      createPolicyProfile(session.user.id, parsed.data);
    } else if (editingId) {
      updatePolicyProfile(session.user.id, editingId, parsed.data);
    }

    setEditingId(null);
    refreshProfiles();
  }, [session, form, editingId, refreshProfiles]);

  const handleDuplicate = useCallback(
    (id: string) => {
      if (!session) return;
      duplicatePolicyProfile(session.user.id, id);
      refreshProfiles();
    },
    [session, refreshProfiles],
  );

  const handleArchive = useCallback(
    (id: string) => {
      if (!session) return;
      archivePolicyProfile(session.user.id, id);
      refreshProfiles();
    },
    [session, refreshProfiles],
  );

  const handleReactivate = useCallback(
    (id: string) => {
      if (!session) return;
      reactivatePolicyProfile(session.user.id, id);
      refreshProfiles();
    },
    [session, refreshProfiles],
  );

  const sampleResults = useMemo(() => buildSampleVerificationResults(), []);

  if (!session) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 className="text-xl font-semibold text-white">Authentication Required</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Please authenticate with a Stellar wallet to manage verifier policy profiles.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      {issuersError && (
        <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3">
          <p className="text-xs text-amber-200" role="alert">
            {issuersError}
          </p>
        </div>
      )}

      <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-semibold text-white">Verifier Policy Profiles</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Reusable local profiles describing which issuers, schemas, and proof types you accept.
            </p>
          </div>
          <button
            type="button"
            onClick={startCreate}
            className="h-10 rounded-md border border-cyan-300/30 bg-cyan-300 px-4 text-xs font-semibold text-slate-950 hover:bg-cyan-200 transition"
          >
            New profile
          </button>
        </div>

        {profiles.length === 0 ? (
          <p className="text-sm text-slate-400">No policy profiles yet. Create one to get started.</p>
        ) : (
          <div className="grid gap-3">
            {profiles.map((profile) => {
              const staleIssuers = findStaleIssuerReferences(profile.acceptedIssuerIds, issuers);
              return (
                <div
                  key={profile.id}
                  data-testid={`policy-profile-${profile.id}`}
                  className={`rounded-md border p-4 text-sm ${
                    profile.status === "archived"
                      ? "border-white/5 bg-white/[0.02] opacity-70"
                      : "border-white/10 bg-white/[0.03]"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-white">{profile.name}</span>
                      {profile.status === "archived" && (
                        <span className="ml-2 rounded-full border border-white/20 px-2 py-0.5 text-xs text-slate-400">
                          Archived
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {profile.status === "active" && (
                        <button
                          type="button"
                          onClick={() => startEdit(profile)}
                          className="h-8 rounded border border-white/15 px-3 text-xs font-medium text-white hover:bg-white/5 transition"
                        >
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDuplicate(profile.id)}
                        className="h-8 rounded border border-white/15 px-3 text-xs font-medium text-white hover:bg-white/5 transition"
                      >
                        Duplicate
                      </button>
                      {profile.status === "active" ? (
                        <button
                          type="button"
                          onClick={() => handleArchive(profile.id)}
                          className="h-8 rounded border border-rose-300/30 px-3 text-xs font-medium text-rose-200 hover:bg-rose-300/10 transition"
                        >
                          Archive
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleReactivate(profile.id)}
                          className="h-8 rounded border border-emerald-300/30 px-3 text-xs font-medium text-emerald-200 hover:bg-emerald-300/10 transition"
                        >
                          Reactivate
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setPreviewingId(previewingId === profile.id ? null : profile.id)}
                        className="h-8 rounded border border-white/15 px-3 text-xs font-medium text-white hover:bg-white/5 transition"
                      >
                        {previewingId === profile.id ? "Hide preview" : "Preview"}
                      </button>
                    </div>
                  </div>

                  <dl className="mt-3 grid gap-1 text-xs text-slate-300">
                    <div>
                      <dt className="inline font-semibold">Accepted issuers: </dt>
                      <dd className="inline">{profile.acceptedIssuerIds.length}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold">Accepted schema versions: </dt>
                      <dd className="inline">{fromArray(profile.acceptedSchemaVersions) || "none"}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold">Accepted proof types: </dt>
                      <dd className="inline">{fromArray(profile.acceptedProofTypes) || "none"}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold">Max freshness: </dt>
                      <dd className="inline">{profile.maxFreshnessSeconds}s</dd>
                    </div>
                  </dl>

                  {staleIssuers.length > 0 && (
                    <p className="mt-2 text-xs text-amber-200" role="alert">
                      {staleIssuers.length} accepted issuer{staleIssuers.length > 1 ? "s are" : " is"} no
                      longer active on the server. Review and update this profile.
                    </p>
                  )}

                  {previewingId === profile.id && (
                    <div className="mt-4 grid gap-2 border-t border-white/10 pt-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Preview against representative verification results
                      </h3>
                      {sampleResults.map((sample) => {
                        const evaluation = evaluateProfile(profile, sample.response);
                        return (
                          <div
                            key={sample.label}
                            className={`rounded border p-2 text-xs ${
                              evaluation.accepted
                                ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
                                : "border-rose-300/30 bg-rose-300/10 text-rose-100"
                            }`}
                          >
                            <p className="font-semibold">
                              {sample.label}: {evaluation.accepted ? "Accepted" : "Rejected"}
                            </p>
                            {!evaluation.accepted && (
                              <ul className="mt-1 list-inside list-disc opacity-90">
                                {evaluation.failureReasons.map((reason) => (
                                  <li key={reason}>{describeFailureReason(reason)}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {editingId && (
        <section
          className="grid gap-4 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.03] p-5"
          role="region"
          aria-labelledby="policy-editor-heading"
        >
          <h3 id="policy-editor-heading" className="text-lg font-semibold text-white">
            {editingId === "new" ? "New policy profile" : "Edit policy profile"}
          </h3>

          {formError && (
            <p className="text-xs text-rose-300" role="alert">
              {formError}
            </p>
          )}

          <label className="grid gap-1 text-xs font-semibold text-slate-300">
            Name
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="h-9 rounded-md border border-white/15 bg-slate-950 px-3 text-sm text-white"
            />
          </label>

          <label className="grid gap-1 text-xs font-semibold text-slate-300">
            Description
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="rounded-md border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white"
              rows={2}
            />
          </label>

          <fieldset className="grid gap-1">
            <legend className="text-xs font-semibold text-slate-300">Accepted issuers</legend>
            {issuers.length === 0 ? (
              <p className="text-xs text-slate-500">No issuers available.</p>
            ) : (
              <div className="grid gap-1">
                {issuers.map((issuer) => (
                  <label key={issuer.id} className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={form.acceptedIssuerIds.includes(issuer.id)}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          acceptedIssuerIds: e.target.checked
                            ? [...f.acceptedIssuerIds, issuer.id]
                            : f.acceptedIssuerIds.filter((id) => id !== issuer.id),
                        }))
                      }
                    />
                    {issuer.name}
                    {issuer.status !== "ACTIVE" && (
                      <span className="text-amber-300">({issuer.status.toLowerCase()})</span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <label className="grid gap-1 text-xs font-semibold text-slate-300">
            Accepted schema versions (comma-separated)
            <input
              value={form.acceptedSchemaVersions}
              onChange={(e) => setForm((f) => ({ ...f, acceptedSchemaVersions: e.target.value }))}
              placeholder="1.0, 2.0"
              className="h-9 rounded-md border border-white/15 bg-slate-950 px-3 text-sm text-white"
            />
          </label>

          <label className="grid gap-1 text-xs font-semibold text-slate-300">
            Accepted proof types (comma-separated)
            <input
              value={form.acceptedProofTypes}
              onChange={(e) => setForm((f) => ({ ...f, acceptedProofTypes: e.target.value }))}
              placeholder="minimum_income, recurring_income"
              className="h-9 rounded-md border border-white/15 bg-slate-950 px-3 text-sm text-white"
            />
          </label>

          <label className="grid gap-1 text-xs font-semibold text-slate-300">
            Max freshness (seconds)
            <input
              type="number"
              value={form.maxFreshnessSeconds}
              onChange={(e) =>
                setForm((f) => ({ ...f, maxFreshnessSeconds: Number(e.target.value) }))
              }
              className="h-9 rounded-md border border-white/15 bg-slate-950 px-3 text-sm text-white"
            />
          </label>

          <label className="grid gap-1 text-xs font-semibold text-slate-300">
            Required disclosure fields (comma-separated)
            <input
              value={form.requiredDisclosureFields}
              onChange={(e) => setForm((f) => ({ ...f, requiredDisclosureFields: e.target.value }))}
              placeholder="thresholdAmount, assetCode"
              className="h-9 rounded-md border border-white/15 bg-slate-950 px-3 text-sm text-white"
            />
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              className="h-10 rounded-md border border-emerald-300/30 bg-emerald-300 px-4 text-xs font-semibold text-slate-950 hover:bg-emerald-200 transition"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditingId(null)}
              className="h-10 rounded-md border border-white/10 px-4 text-xs font-semibold text-slate-300 hover:bg-white/5 transition"
            >
              Cancel
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
