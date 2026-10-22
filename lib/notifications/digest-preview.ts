import { SECURITY_EVENT_TYPE_LABELS } from "@/lib/api/notification-digest-settings";

/**
 * Digest preview content (#269). Every sample line is a FIXED, SYNTHETIC,
 * already-redacted string: nothing is derived from the user's real events,
 * keys, sessions, wallets or claims, so a preview can never leak a secret,
 * token or private claim value.
 */
const SAMPLE_LINES: Record<string, string> = {
  "api-key-created": "An API key ending in ••••0000 was created.",
  "session-refreshed": "A session on a masked device (••••) was refreshed.",
  "session-expired": "A session on a masked device (••••) expired.",
  "issuer-approved": "An issuer in your organization (name hidden in preview) was approved.",
};

const GENERIC_SAMPLE = "A security event occurred (details hidden in preview).";

export interface DigestPreviewItem {
  type: string;
  label: string;
  sample: string;
}

export function buildDigestPreview(digestEventTypes: readonly string[]): DigestPreviewItem[] {
  return digestEventTypes.map((type) => ({
    type,
    label: SECURITY_EVENT_TYPE_LABELS[type] ?? type,
    sample: SAMPLE_LINES[type] ?? GENERIC_SAMPLE,
  }));
}
