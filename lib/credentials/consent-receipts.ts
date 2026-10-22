/**
 * Proof disclosure consent receipts (#226).
 *
 * A verifier requests access to specific proof fields for a stated
 * purpose and a bounded expiry; the user reviews that request (identity
 * commitment, purpose, expiry, disclosed fields) and approves or
 * declines it. On approval only, a durable receipt is generated
 * recording exactly what was approved — never anything broader than the
 * request, and never the raw credential or any hidden/non-disclosed
 * claim field.
 *
 * Storage: receipts persist in localStorage, keyed by the user's wallet
 * hash (tenant isolation, same convention as lib/payment-backfill/
 * store.ts and lib/verifier-policies/store.ts), and are looked up by
 * their own `receiptId` — a random identifier unrelated to the proof ID,
 * credential hash, or wallet address, so a receipt ID alone does not
 * reveal which proof or wallet it belongs to ("privacy-safe receipt
 * identifier").
 *
 * NOTE: as with the other speculative modules in this batch, a real
 * server-attested receipt (one the backend itself signs/stores) would
 * need an endpoint this app doesn't have yet; `attestation` below models
 * that shape so the UI/data model are ready for it, but this module's
 * own `createConsentReceipt` always produces a client-generated receipt
 * (attestation: null) today.
 */

const STORAGE_KEY_PREFIX = "earnproof.consent-receipts.";

export interface VerifierIdentityCommitment {
  /** Opaque commitment to the verifier's identity (e.g. a hash of their public key or registered identifier) — never the raw identity claim itself. */
  commitment: string;
  displayName: string;
}

export interface DisclosureRequest {
  requestId: string;
  verifier: VerifierIdentityCommitment;
  purpose: string;
  /** ISO 8601 — after this, the request itself can no longer be approved. */
  requestExpiresAt: string;
  /** Exactly which proof fields the verifier is asking to see — never a wildcard/"all fields" request. */
  requestedFields: string[];
  proofId: string;
}

export type ConsentDecision = "approved" | "declined";

export interface ConsentReceipt {
  receiptId: string;
  decision: "approved"; // A receipt only ever exists for an approval — see createConsentReceipt.
  requestId: string;
  verifier: VerifierIdentityCommitment;
  purpose: string;
  /** The fields actually approved for disclosure. Always a subset of (never broader than) the originating request's requestedFields. */
  approvedFields: string[];
  /** The disclosure's own expiry, copied from the request at approval time and never later extended by this module. */
  expiresAt: string;
  approvedAt: string;
  proofId: string;
  /** Null for a client-generated receipt; populated if/when a server attestation endpoint exists. */
  attestation: { signature: string; attestedAt: string } | null;
}

function storageKey(walletHash: string): string {
  return `${STORAGE_KEY_PREFIX}${walletHash}`;
}

function isConsentReceipt(value: unknown): value is ConsentReceipt {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.receiptId === "string" &&
    r.decision === "approved" &&
    typeof r.requestId === "string" &&
    typeof r.purpose === "string" &&
    Array.isArray(r.approvedFields) &&
    typeof r.expiresAt === "string" &&
    typeof r.approvedAt === "string" &&
    typeof r.proofId === "string"
  );
}

function readAll(walletHash: string): ConsentReceipt[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(walletHash));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isConsentReceipt);
  } catch {
    return [];
  }
}

function writeAll(walletHash: string, receipts: ConsentReceipt[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(walletHash), JSON.stringify(receipts));
}

/**
 * Generates a receipt ID that is NOT derived from the proof ID, wallet
 * address, or verifier identity — a privacy-safe identifier an approved
 * verifier or the user themselves can use to look the receipt up later
 * without that identifier itself leaking which proof/wallet it concerns.
 */
function generateReceiptId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `receipt_${random}`;
}

/**
 * True when the request itself has expired and can no longer be acted
 * on — approving or declining a request past its own expiry is refused
 * by the caller (see components/proofs that consume this), not silently
 * allowed through.
 */
export function isRequestExpired(request: DisclosureRequest): boolean {
  return new Date(request.requestExpiresAt) <= new Date();
}

/**
 * Builds a receipt from a request and the user's explicit field
 * selection. `approvedFields` MUST be a subset of `request.requestedFields`
 * — this function rejects (throws) anything else, enforcing "the receipt
 * matches the approved disclosure policy exactly" at the data layer
 * rather than trusting every caller to check it themselves.
 *
 * There is deliberately no equivalent function for a decline: a decline
 * produces no receipt at all (the caller simply records the decision
 * locally, if it wants to, outside this module) — "declined requests
 * produce no consent receipt" is enforced by this module having no API
 * surface that could create one for a decline.
 */
export function createConsentReceipt(
  request: DisclosureRequest,
  approvedFields: string[],
  walletHash: string,
): ConsentReceipt {
  if (isRequestExpired(request)) {
    throw new Error("Cannot approve a request that has already expired.");
  }

  const invalidFields = approvedFields.filter((f) => !request.requestedFields.includes(f));
  if (invalidFields.length > 0) {
    throw new Error(
      `Approved fields must be a subset of the requested fields; got unexpected field(s): ${invalidFields.join(", ")}`,
    );
  }
  if (approvedFields.length === 0) {
    throw new Error("At least one field must be approved to generate a receipt.");
  }

  const receipt: ConsentReceipt = {
    receiptId: generateReceiptId(),
    decision: "approved",
    requestId: request.requestId,
    verifier: request.verifier,
    purpose: request.purpose,
    approvedFields: [...approvedFields],
    expiresAt: request.requestExpiresAt,
    approvedAt: new Date().toISOString(),
    proofId: request.proofId,
    attestation: null,
  };

  const receipts = readAll(walletHash);
  receipts.push(receipt);
  writeAll(walletHash, receipts);

  return receipt;
}

export function listConsentReceipts(walletHash: string): ConsentReceipt[] {
  return readAll(walletHash).sort((a, b) => b.approvedAt.localeCompare(a.approvedAt));
}

/** Looks up a receipt by its own privacy-safe ID, scoped to this wallet's receipts only. */
export function getConsentReceiptById(walletHash: string, receiptId: string): ConsentReceipt | null {
  return readAll(walletHash).find((r) => r.receiptId === receiptId) ?? null;
}

export function isReceiptExpired(receipt: ConsentReceipt): boolean {
  return new Date(receipt.expiresAt) <= new Date();
}
