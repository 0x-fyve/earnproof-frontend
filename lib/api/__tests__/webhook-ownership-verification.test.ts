import {
  WebhookVerificationForbiddenError,
  buildDiagnostic,
  fetchMockWebhookVerification,
  invalidateVerificationForUrlChange,
  isProductionReady,
  retryMockWebhookVerification,
  startMockWebhookVerification,
  verificationStateLabel,
} from "../webhook-ownership-verification";

describe("webhook-ownership-verification: success", () => {
  it("reports verified and production-ready for a verified webhook", async () => {
    const verification = await fetchMockWebhookVerification("hook-verified", "https://example.com/hook");
    expect(verification.state).toBe("verified");
    expect(isProductionReady(verification)).toBe(true);
  });

  it("never reports production-ready for a non-verified state", async () => {
    const verification = await fetchMockWebhookVerification("hook-pending", "https://example.com/hook");
    expect(isProductionReady(verification)).toBe(false);
  });
});

describe("webhook-ownership-verification: expiry", () => {
  it("reports expired with a bounded diagnostic and no secret-shaped data", async () => {
    const verification = await fetchMockWebhookVerification("hook-expired", "https://example.com/hook");
    expect(verification.state).toBe("expired");
    expect(verification.diagnostic).not.toBeNull();
    expect(Object.keys(verification.diagnostic ?? {})).toEqual(["statusCode", "category"]);
  });
});

describe("webhook-ownership-verification: retry", () => {
  it("retries an expired verification to a verified result", async () => {
    const expired = await fetchMockWebhookVerification("hook-expired", "https://example.com/hook");
    const retried = await retryMockWebhookVerification(expired);
    expect(retried.state).toBe("verified");
    expect(retried.attemptCount).toBe(expired.attemptCount + 1);
  });

  it("retries a failed verification to a verified result", async () => {
    const failed = await fetchMockWebhookVerification("hook-failed", "https://example.com/hook");
    const retried = await retryMockWebhookVerification(failed);
    expect(retried.state).toBe("verified");
  });

  it("rejects retrying a verification that is not expired or failed", async () => {
    const verified = await fetchMockWebhookVerification("hook-verified", "https://example.com/hook");
    await expect(retryMockWebhookVerification(verified)).rejects.toThrow(
      /can only be retried/,
    );
  });
});

describe("webhook-ownership-verification: destination edit invalidates", () => {
  it("resets a verified record to unverified when the URL changes", async () => {
    const verified = await fetchMockWebhookVerification("hook-verified", "https://old.example.com/hook");
    const invalidated = invalidateVerificationForUrlChange(verified, "https://new.example.com/hook");
    expect(invalidated.state).toBe("unverified");
    expect(invalidated.verifiedUrl).toBe("https://new.example.com/hook");
    expect(invalidated.diagnostic).toBeNull();
    expect(invalidated.attemptCount).toBe(0);
  });

  it("resets even a pending record, not only a completed one", async () => {
    const pending = await fetchMockWebhookVerification("hook-pending", "https://old.example.com/hook");
    const invalidated = invalidateVerificationForUrlChange(pending, "https://new.example.com/hook");
    expect(invalidated.state).toBe("unverified");
  });
});

describe("webhook-ownership-verification: authorization failure", () => {
  it("rejects fetch with a forbidden error, never partial data", async () => {
    await expect(
      fetchMockWebhookVerification("hook-forbidden", "https://example.com/hook"),
    ).rejects.toBeInstanceOf(WebhookVerificationForbiddenError);
  });

  it("rejects starting verification for a forbidden webhook", async () => {
    await expect(
      startMockWebhookVerification("hook-forbidden", "https://example.com/hook"),
    ).rejects.toBeInstanceOf(WebhookVerificationForbiddenError);
  });
});

describe("webhook-ownership-verification: diagnostic construction", () => {
  it("truncates an overlong category label", () => {
    const longLabel = "x".repeat(200) as never;
    const diagnostic = buildDiagnostic(500, longLabel);
    expect(diagnostic.category.length).toBeLessThanOrEqual(64);
  });
});

describe("webhook-ownership-verification: labels", () => {
  it("has a label for every state", () => {
    expect(verificationStateLabel("unverified")).toBe("Unverified");
    expect(verificationStateLabel("pending")).toBe("Pending");
    expect(verificationStateLabel("verified")).toBe("Verified");
    expect(verificationStateLabel("expired")).toBe("Expired");
    expect(verificationStateLabel("failed")).toBe("Failed");
  });
});
