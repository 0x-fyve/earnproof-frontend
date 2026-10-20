/**
 * Verifier policy profile editor (#235).
 *
 * Relying parties need *reusable local* profiles describing which
 * issuers/schemas/proof types they accept, a freshness bound, and which
 * claim fields must be disclosed — the issue is explicit that these are
 * local profiles, not a server-side policy engine, so this is modeled the
 * same way `lib/payment-backfill/store.ts` models a client-local feature
 * with no backing endpoint: persisted in `localStorage`, scoped per
 * `userId` (so one wallet's profiles are isolated from another's on a
 * shared browser), with CRUD + archive + duplicate operations.
 *
 * Crucially, this store (and `evaluateProfile` in `evaluation.ts`) never
 * touches cryptographic verification itself — it only reads the already-
 * computed `VerifyProofResponse` a real verification call produced and
 * layers a policy decision on top. A profile can reject a cryptographically
 * valid proof (e.g. unknown issuer) but can never promote a failed
 * cryptographic result to "accepted" — see evaluation.ts's doc comment for
 * how that invariant is enforced in code, not just by convention here.
 */

const STORAGE_KEY_PREFIX = "earnproof.verifier-policies.";

export type PolicyProfileStatus = "active" | "archived";

export interface VerifierPolicyProfile {
  id: string;
  name: string;
  description: string;
  status: PolicyProfileStatus;
  /** Issuer IDs this profile accepts proofs from. Empty means "no issuers accepted" (fails closed), not "any issuer". */
  acceptedIssuerIds: string[];
  /** Schema version strings this profile accepts, e.g. "1.0", "2.0". */
  acceptedSchemaVersions: string[];
  /** Proof types this profile accepts, e.g. "minimum_income", "recurring_income". */
  acceptedProofTypes: string[];
  /** Maximum age, in seconds, since issuedAt before a proof is considered stale by this profile. */
  maxFreshnessSeconds: number;
  /** Claim fields that must be present and disclosed for a proof to pass (e.g. "thresholdAmount", "assetCode"). */
  requiredDisclosureFields: string[];
  createdAt: string;
  updatedAt: string;
}

export type CreatePolicyProfileInput = Omit<
  VerifierPolicyProfile,
  "id" | "status" | "createdAt" | "updatedAt"
>;

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

function isVerifierPolicyProfile(value: unknown): value is VerifierPolicyProfile {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.name === "string" &&
    (r.status === "active" || r.status === "archived") &&
    Array.isArray(r.acceptedIssuerIds) &&
    Array.isArray(r.acceptedSchemaVersions) &&
    Array.isArray(r.acceptedProofTypes) &&
    typeof r.maxFreshnessSeconds === "number" &&
    Array.isArray(r.requiredDisclosureFields) &&
    typeof r.createdAt === "string" &&
    typeof r.updatedAt === "string"
  );
}

function readAll(userId: string): VerifierPolicyProfile[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isVerifierPolicyProfile);
  } catch {
    return [];
  }
}

function writeAll(userId: string, profiles: VerifierPolicyProfile[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(userId), JSON.stringify(profiles));
}

function generateId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `policy_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function listPolicyProfiles(userId: string): VerifierPolicyProfile[] {
  return readAll(userId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getPolicyProfile(userId: string, id: string): VerifierPolicyProfile | null {
  return readAll(userId).find((p) => p.id === id) ?? null;
}

export function createPolicyProfile(
  userId: string,
  input: CreatePolicyProfileInput,
): VerifierPolicyProfile {
  const now = new Date().toISOString();
  const profile: VerifierPolicyProfile = {
    ...input,
    id: generateId(),
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  const profiles = readAll(userId);
  profiles.push(profile);
  writeAll(userId, profiles);
  return profile;
}

export class PolicyProfileNotFoundError extends Error {
  constructor(id: string) {
    super(`Verifier policy profile ${id} not found`);
    this.name = "PolicyProfileNotFoundError";
  }
}

export function updatePolicyProfile(
  userId: string,
  id: string,
  input: Partial<CreatePolicyProfileInput>,
): VerifierPolicyProfile {
  const profiles = readAll(userId);
  const index = profiles.findIndex((p) => p.id === id);
  if (index === -1) {
    throw new PolicyProfileNotFoundError(id);
  }

  const updated: VerifierPolicyProfile = {
    ...profiles[index],
    ...input,
    updatedAt: new Date().toISOString(),
  };
  profiles[index] = updated;
  writeAll(userId, profiles);
  return updated;
}

/**
 * Duplicates a profile as a new, independent `active` profile (even if
 * the source is archived) with a "(Copy)" suffix, so editing the copy
 * never mutates the original.
 */
export function duplicatePolicyProfile(userId: string, id: string): VerifierPolicyProfile {
  const source = getPolicyProfile(userId, id);
  if (!source) {
    throw new PolicyProfileNotFoundError(id);
  }

  return createPolicyProfile(userId, {
    name: `${source.name} (Copy)`,
    description: source.description,
    acceptedIssuerIds: [...source.acceptedIssuerIds],
    acceptedSchemaVersions: [...source.acceptedSchemaVersions],
    acceptedProofTypes: [...source.acceptedProofTypes],
    maxFreshnessSeconds: source.maxFreshnessSeconds,
    requiredDisclosureFields: [...source.requiredDisclosureFields],
  });
}

/**
 * Archives a profile. Archived profiles are excluded from
 * `listSelectableProfiles` so they can never be picked for a new check
 * (#235's "Archived profiles cannot be selected for new checks") — this
 * is enforced here, not left to callers to remember to filter.
 */
export function archivePolicyProfile(userId: string, id: string): VerifierPolicyProfile {
  return updateProfileStatus(userId, id, "archived");
}

export function reactivatePolicyProfile(userId: string, id: string): VerifierPolicyProfile {
  return updateProfileStatus(userId, id, "active");
}

function updateProfileStatus(
  userId: string,
  id: string,
  status: PolicyProfileStatus,
): VerifierPolicyProfile {
  const profiles = readAll(userId);
  const index = profiles.findIndex((p) => p.id === id);
  if (index === -1) {
    throw new PolicyProfileNotFoundError(id);
  }
  profiles[index] = { ...profiles[index], status, updatedAt: new Date().toISOString() };
  writeAll(userId, profiles);
  return profiles[index];
}

/** Profiles eligible to be picked for a new verification check. */
export function listSelectableProfiles(userId: string): VerifierPolicyProfile[] {
  return listPolicyProfiles(userId).filter((p) => p.status === "active");
}
