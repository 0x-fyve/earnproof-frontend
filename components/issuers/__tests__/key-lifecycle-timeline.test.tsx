/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { IssuerKeyLifecycleTimeline } from "../key-lifecycle-timeline";
import type { IssuerSigningKeyRecord } from "@/lib/issuers/key-lifecycle-timeline";

const FIXED_TIME_ZONE = "America/New_York";
const FAKE_PRIVATE_KEY_MATERIAL = "SECRET_ED25519_PRIVATE_SCALAR_DO_NOT_RENDER_abcdef0123456789";

function key(overrides: Partial<IssuerSigningKeyRecord> = {}): IssuerSigningKeyRecord {
  return {
    keyId: "key-1",
    keyFingerprint: "fp-ab12cd34",
    algorithm: "Ed25519",
    lifecycleState: "ACTIVE",
    activatedAt: "2026-01-01T00:00:00.000Z",
    retiredAt: null,
    supersedes: null,
    supersededBy: null,
    compromisedAt: null,
    ...overrides,
  };
}

describe("IssuerKeyLifecycleTimeline (#245)", () => {
  it("renders an empty state when the issuer has no keys", () => {
    render(<IssuerKeyLifecycleTimeline keys={[]} timeZone={FIXED_TIME_ZONE} />);
    expect(screen.getByText("No signing keys on record for this issuer.")).toBeInTheDocument();
  });

  it("renders one entry per key, ordered by activation time", () => {
    render(
      <IssuerKeyLifecycleTimeline
        keys={[
          key({ keyId: "newer", keyFingerprint: "fp-newer", activatedAt: "2026-03-01T00:00:00.000Z" }),
          key({ keyId: "older", keyFingerprint: "fp-older", activatedAt: "2026-01-01T00:00:00.000Z" }),
        ]}
        timeZone={FIXED_TIME_ZONE}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("fp-older");
    expect(items[1]).toHaveTextContent("fp-newer");
  });

  it("shows activation and retirement times with an explicit timezone label", () => {
    render(
      <IssuerKeyLifecycleTimeline
        keys={[key({ retiredAt: "2026-06-01T00:00:00.000Z" })]}
        timeZone={FIXED_TIME_ZONE}
      />,
    );
    expect(screen.getAllByText(/EST|EDT/).length).toBeGreaterThan(0);
  });

  it("shows rotation provenance (supersedes/supersededBy) when present", () => {
    render(
      <IssuerKeyLifecycleTimeline
        keys={[key({ keyId: "key-2", supersedes: "key-1" })]}
        timeZone={FIXED_TIME_ZONE}
      />,
    );
    expect(screen.getByText("key-1")).toBeInTheDocument();
  });

  it("shows a compromised banner for a compromised key", () => {
    render(
      <IssuerKeyLifecycleTimeline
        keys={[key({ compromisedAt: "2026-05-01T00:00:00.000Z" })]}
        timeZone={FIXED_TIME_ZONE}
      />,
    );
    expect(screen.getByText(/Marked compromised/)).toBeInTheDocument();
  });

  it("renders a blocking (role=alert) banner for an unknown-key reference warning", () => {
    render(
      <IssuerKeyLifecycleTimeline
        keys={[key()]}
        referenceWarning={{ kind: "unknown-key", keyId: "key-ghost" }}
        timeZone={FIXED_TIME_ZONE}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/not recognized/i);
  });

  it("renders a non-blocking (role=status) banner for a retired-key reference warning", () => {
    render(
      <IssuerKeyLifecycleTimeline
        keys={[key()]}
        referenceWarning={{ kind: "retired-key", key: key({ lifecycleState: "RETIRED" }) }}
        timeZone={FIXED_TIME_ZONE}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/retired signing key/i);
  });

  it("renders the rotation review link only when a href is provided, and it carries no key material", () => {
    const { rerender } = render(<IssuerKeyLifecycleTimeline keys={[key()]} timeZone={FIXED_TIME_ZONE} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    rerender(
      <IssuerKeyLifecycleTimeline
        keys={[key()]}
        timeZone={FIXED_TIME_ZONE}
        rotationReviewHref="/settings/issuers/issuer-1/rotation-review"
      />,
    );
    const link = screen.getByRole("link", { name: "Review key rotation" });
    expect(link).toHaveAttribute("href", "/settings/issuers/issuer-1/rotation-review");
  });

  it("CRITICAL SECURITY: never renders key material even if a caller mistakenly attaches it to a record via an unexpected extra field", () => {
    const keyWithExtraField = {
      ...key(),
      // Simulates a caller mistake: attaching a field the type doesn't
      // declare. The component must still never render it, since it only
      // ever reads the fields it explicitly destructures.
      unexpectedRawKeyField: FAKE_PRIVATE_KEY_MATERIAL,
    } as IssuerSigningKeyRecord;

    render(<IssuerKeyLifecycleTimeline keys={[keyWithExtraField]} timeZone={FIXED_TIME_ZONE} />);
    expect(screen.queryByText(FAKE_PRIVATE_KEY_MATERIAL)).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(FAKE_PRIVATE_KEY_MATERIAL);
  });

  it("renders only the fingerprint, never anything implying a full key value, for every key in a list", () => {
    render(
      <IssuerKeyLifecycleTimeline
        keys={[key({ keyFingerprint: "fp-only-this-should-show" })]}
        timeZone={FIXED_TIME_ZONE}
      />,
    );
    expect(screen.getByText("fp-only-this-should-show")).toBeInTheDocument();
  });

  it("tenant isolation: rendering is a pure function of the keys prop, so keys from a different issuer never appear unless explicitly passed in", () => {
    const issuerAKeys = [key({ keyId: "a-key", keyFingerprint: "fp-issuer-a" })];
    render(<IssuerKeyLifecycleTimeline keys={issuerAKeys} timeZone={FIXED_TIME_ZONE} />);
    expect(screen.queryByText(/fp-issuer-b/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});
