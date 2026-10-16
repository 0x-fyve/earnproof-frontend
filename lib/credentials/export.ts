export const CREDENTIAL_EXPORT_FILENAME = "earnproof-credential.json";
export const VERIFICATION_LINK_EXPORT_FILENAME = "earnproof-verification-link.txt";
export const AUDIT_LOG_EXPORT_FILENAME = "earnproof-audit-log.json";
/** Offline verification bundle (#294). */
export const OFFLINE_BUNDLE_EXPORT_FILENAME = "earnproof-offline-bundle.json";

const UNSAFE_FILENAME_PATTERN =
  /G[A-Z0-9]{55}|0x[a-fA-F0-9]{8,}|ep[_-][A-Za-z0-9._:-]+|EP-[A-Za-z0-9._:-]+/i;

export const PUBLIC_CREDENTIAL_FIELDS = [
  "id",
  "type",
  "schemaVersion",
  "issuer",
  "subject.walletHash",
  "claim.operator",
  "claim.thresholdAmount",
  "claim.assetCode",
  "claim.assetIssuer",
  "claim.periodStart",
  "claim.periodEnd",
  "claim.qualifyingPaymentCount",
  "privacy.exactIncomeHidden",
  "privacy.sourceTransactionsHidden",
  "issuedAt",
  "expiresAt",
  "proof.type",
  "proof.credentialHash",
  "proof.signature",
] as const;

export const PUBLIC_PROOF_FIELDS = [
  "id",
  "type",
  "schemaVersion",
  "network",
  "issuedAt",
  "expiresAt",
  "revokedAt",
] as const;

export type ExportableCredential = {
  id?: string;
  type?: string;
  schemaVersion?: string;
  issuer?: string;
  subject?: { walletHash?: string };
  claim?: {
    operator?: string;
    thresholdAmount?: string;
    assetCode?: string;
    assetIssuer?: string | null;
    periodStart?: string;
    periodEnd?: string;
    qualifyingPaymentCount?: number;
    amount?: string;
    sender?: string;
    sourceAddress?: string;
  };
  privacy?: {
    exactIncomeHidden?: boolean;
    sourceTransactionsHidden?: boolean;
  };
  issuedAt?: string;
  expiresAt?: string;
  proof?: {
    type?: string;
    credentialHash?: string;
    signature?: string;
  };
};

export type ExportableProof = {
  id?: string;
  type?: string;
  schemaVersion?: string;
  network?: string;
  issuedAt?: string;
  expiresAt?: string;
  revokedAt?: string | null;
};

export type DisclosureWarning = {
  field: "amount" | "sender" | "actor";
  message: string;
};

/** Server-provided integrity metadata for a downloaded export (#192).
 * Optional: not every export plan is built from a server response that
 * carries a digest yet. When absent, the download flow still computes and
 * displays a digest of the exact bytes served, just with nothing to verify
 * it against. */
export type ExportDigestMetadata = {
  algorithm: string;
  value: string;
};

export type ArtifactExportPlan = {
  filename: string;
  includedFields: string[];
  warnings: DisclosureWarning[];
  body: string;
  mimeType: string;
  digest?: ExportDigestMetadata;
};

function pick<T extends Record<string, unknown>>(
  source: T | undefined,
  keys: readonly string[],
): Record<string, unknown> | undefined {
  if (!source) return undefined;
  const next: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in source && source[key] !== undefined) {
      next[key] = source[key];
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function isSafeExportFilename(filename: string): boolean {
  if (
    filename !== CREDENTIAL_EXPORT_FILENAME &&
    filename !== VERIFICATION_LINK_EXPORT_FILENAME &&
    filename !== AUDIT_LOG_EXPORT_FILENAME &&
    filename !== OFFLINE_BUNDLE_EXPORT_FILENAME
  ) {
    return false;
  }
  return !UNSAFE_FILENAME_PATTERN.test(filename);
}

export function collectDisclosureWarnings(credential: ExportableCredential | undefined): DisclosureWarning[] {
  const warnings: DisclosureWarning[] = [];
  if (!credential) {
    return warnings;
  }
  const amountDisclosed =
    credential.privacy?.exactIncomeHidden === false ||
    Boolean(credential.claim?.amount);
  const senderDisclosed =
    Boolean(credential.claim?.sender) ||
    Boolean(credential.claim?.sourceAddress) ||
    credential.privacy?.sourceTransactionsHidden === false;

  if (amountDisclosed) {
    warnings.push({
      field: "amount",
      message: "This export includes optional amount disclosure.",
    });
  }
  if (senderDisclosed) {
    warnings.push({
      field: "sender",
      message: "This export includes optional sender or source disclosure.",
    });
  }
  return warnings;
}

/**
 * Preserve signature-critical structure. If the original JSON text is
 * supplied, it is returned unchanged after a parse check. Otherwise the
 * object is serialized without pretty-print or key sorting.
 */
export function serializeCredentialJson(input: {
  value: unknown;
  rawJson?: string;
}): string {
  if (typeof input.rawJson === "string") {
    const parsed = JSON.parse(input.rawJson) as unknown;
    if (parsed === null || typeof parsed !== "object") {
      throw new Error("Credential JSON must be an object.");
    }
    return input.rawJson;
  }
  return JSON.stringify(input.value);
}

export function buildCredentialExport(input: {
  credential?: ExportableCredential;
  proof?: ExportableProof;
  rawJson?: string;
}): ArtifactExportPlan {
  const credential = input.credential
    ? {
        id: input.credential.id,
        type: input.credential.type,
        schemaVersion: input.credential.schemaVersion,
        issuer: input.credential.issuer,
        subject: pick(input.credential.subject as Record<string, unknown> | undefined, ["walletHash"]),
        claim: pick(input.credential.claim as Record<string, unknown> | undefined, [
          "operator",
          "thresholdAmount",
          "assetCode",
          "assetIssuer",
          "periodStart",
          "periodEnd",
          "qualifyingPaymentCount",
          "amount",
          "sender",
          "sourceAddress",
        ]),
        privacy: pick(input.credential.privacy as Record<string, unknown> | undefined, [
          "exactIncomeHidden",
          "sourceTransactionsHidden",
        ]),
        issuedAt: input.credential.issuedAt,
        expiresAt: input.credential.expiresAt,
        proof: pick(input.credential.proof as Record<string, unknown> | undefined, [
          "type",
          "credentialHash",
          "signature",
        ]),
      }
    : undefined;

  const proof = input.proof
    ? {
        id: input.proof.id,
        type: input.proof.type,
        schemaVersion: input.proof.schemaVersion,
        network: input.proof.network,
        issuedAt: input.proof.issuedAt,
        expiresAt: input.proof.expiresAt,
        revokedAt: input.proof.revokedAt ?? null,
      }
    : undefined;

  const value = { credential, proof };
  const body = serializeCredentialJson({ value, rawJson: input.rawJson });
  const includedFields = [
    ...(credential ? PUBLIC_CREDENTIAL_FIELDS.map((field) => `credential.${field}`) : []),
    ...(proof ? PUBLIC_PROOF_FIELDS.map((field) => `proof.${field}`) : []),
  ];

  return {
    filename: CREDENTIAL_EXPORT_FILENAME,
    includedFields,
    warnings: collectDisclosureWarnings(input.credential),
    body,
    mimeType: "application/json",
  };
}

export function buildVerificationLinkExport(verificationUrl: string): ArtifactExportPlan {
  return {
    filename: VERIFICATION_LINK_EXPORT_FILENAME,
    includedFields: ["verificationUrl"],
    warnings: [],
    body: verificationUrl,
    mimeType: "text/plain",
  };
}

export type ExportableAuditLogEntry = {
  id: string;
  actor: string;
  action: string;
  resource: string;
  occurredAt: string;
  entryHash: string;
};

/**
 * Actor identifiers are the one field in an audit entry likely to carry PII
 * (an email, a wallet address) beyond what the entry's own action/resource
 * strictly needs, so the export redacts them by default and always flags
 * that redaction was applied - matching issue #161's "controlled export
 * flow with redaction disclosure": the person exporting sees explicitly
 * what was left out, not just an unlabeled subset of fields.
 */
export function buildAuditLogExport(
  entries: ExportableAuditLogEntry[],
  options: { redactActors: boolean } = { redactActors: true }
): ArtifactExportPlan {
  const rows = entries.map((entry) => ({
    id: entry.id,
    actor: options.redactActors ? "[redacted]" : entry.actor,
    action: entry.action,
    resource: entry.resource,
    occurredAt: entry.occurredAt,
    entryHash: entry.entryHash,
  }));

  const warnings: DisclosureWarning[] = options.redactActors
    ? []
    : [{ field: "actor", message: "This export includes unredacted actor identifiers." }];

  return {
    filename: AUDIT_LOG_EXPORT_FILENAME,
    includedFields: options.redactActors
      ? ["id", "action", "resource", "occurredAt", "entryHash", "actor (redacted)"]
      : ["id", "actor", "action", "resource", "occurredAt", "entryHash"],
    warnings,
    body: JSON.stringify(rows),
    mimeType: "application/json",
  };
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard is not available in this browser.");
  }
  await navigator.clipboard.writeText(text);
}

export function downloadTextFile(plan: ArtifactExportPlan): void {
  if (!isSafeExportFilename(plan.filename)) {
    throw new Error("Refusing to download an unsafe filename.");
  }
  const blob = new Blob([plan.body], { type: plan.mimeType });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = plan.filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}
