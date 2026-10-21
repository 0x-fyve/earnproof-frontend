import { z } from "zod";
import type { Issuer } from "@/lib/api/generated/v1";

export const MIN_FRESHNESS_SECONDS = 60; // 1 minute
export const MAX_FRESHNESS_SECONDS = 60 * 60 * 24 * 365; // 1 year

export const policyProfileFormSchema = z.object({
  name: z.string().trim().min(3, "Name must be at least 3 characters").max(80),
  description: z.string().trim().max(500).optional().default(""),
  acceptedIssuerIds: z.array(z.string()),
  acceptedSchemaVersions: z.array(z.string().trim().min(1)),
  acceptedProofTypes: z.array(z.string().trim().min(1)),
  maxFreshnessSeconds: z
    .number()
    .int()
    .min(MIN_FRESHNESS_SECONDS, `Freshness must be at least ${MIN_FRESHNESS_SECONDS} seconds`)
    .max(MAX_FRESHNESS_SECONDS, "Freshness cannot exceed 1 year"),
  requiredDisclosureFields: z.array(z.string().trim().min(1)),
});

export type PolicyProfileFormInput = z.infer<typeof policyProfileFormSchema>;

/**
 * Validates a profile's accepted issuers against the server's current
 * issuer capabilities ("Validate policies against server capabilities
 * and schema metadata"): an issuer ID the profile lists but that is no
 * longer ACTIVE on the server (revoked, suspended, or deleted since the
 * profile was created) is surfaced as stale metadata, not silently kept.
 */
export function findStaleIssuerReferences(
  acceptedIssuerIds: string[],
  knownIssuers: Issuer[],
): string[] {
  const activeIssuerIds = new Set(
    knownIssuers.filter((issuer) => issuer.status === "ACTIVE").map((issuer) => issuer.id),
  );
  return acceptedIssuerIds.filter((id) => !activeIssuerIds.has(id));
}

export function validatePolicyProfileForm(
  input: unknown,
): { success: true; data: PolicyProfileFormInput } | { success: false; error: string } {
  const result = policyProfileFormSchema.safeParse(input);
  if (!result.success) {
    return { success: false, error: result.error.issues[0]?.message ?? "Invalid profile" };
  }
  if (result.data.acceptedIssuerIds.length === 0) {
    return {
      success: false,
      error: "At least one accepted issuer is required (an empty list accepts no issuers).",
    };
  }
  if (result.data.acceptedSchemaVersions.length === 0) {
    return { success: false, error: "At least one accepted schema version is required." };
  }
  if (result.data.acceptedProofTypes.length === 0) {
    return { success: false, error: "At least one accepted proof type is required." };
  }
  return { success: true, data: result.data };
}
