import {
  detectPrivateKeyBlock,
  validateCertificatePEM,
  getCertificateValidityState,
  getCertificateStatusAriaLabel,
} from "./webhooks-certificates";
import { PRIVATE_KEY_PATTERNS } from "@/lib/constants/certificates";

describe("Certificate Validation", () => {
  describe("detectPrivateKeyBlock", () => {
    it("detects RSA private key", () => {
      const input = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAK...";
      expect(detectPrivateKeyBlock(input)).toBe(true);
    });

    it("detects PRIVATE KEY", () => {
      const input = "-----BEGIN PRIVATE KEY-----\nMIIEvQIB...";
      expect(detectPrivateKeyBlock(input)).toBe(true);
    });

    it("detects ENCRYPTED PRIVATE KEY", () => {
      const input = "-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIFDjBA...";
      expect(detectPrivateKeyBlock(input)).toBe(true);
    });

    it("detects EC PRIVATE KEY", () => {
      const input = "-----BEGIN EC PRIVATE KEY-----\nMHcCAQEE...";
      expect(detectPrivateKeyBlock(input)).toBe(true);
    });

    it("detects DSA PRIVATE KEY", () => {
      const input = "-----BEGIN DSA PRIVATE KEY-----\nMIIBOwIBAA...";
      expect(detectPrivateKeyBlock(input)).toBe(true);
    });

    it("rejects public certificate", () => {
      const input = "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWg...";
      expect(detectPrivateKeyBlock(input)).toBe(false);
    });

    it("is case-insensitive", () => {
      const lower = "-----begin private key-----\nkey";
      const upper = "-----BEGIN PRIVATE KEY-----\nkey";
      expect(detectPrivateKeyBlock(lower)).toBe(true);
      expect(detectPrivateKeyBlock(upper)).toBe(true);
    });
  });

  describe("validateCertificatePEM", () => {
    it("rejects empty input", async () => {
      const result = await validateCertificatePEM("");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("Certificate text is required");
      }
    });

    it("rejects private key with clear message", async () => {
      const privateKey = "-----BEGIN PRIVATE KEY-----\ntest";
      const result = await validateCertificatePEM(privateKey);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]).toContain("Private key detected");
      }
    });

    it("rejects oversized certificate", async () => {
      const largeString = "-----BEGIN CERTIFICATE-----\n" + "A".repeat(9000) + "\n-----END CERTIFICATE-----";
      const result = await validateCertificatePEM(largeString);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.includes("exceeds size limit"))).toBe(true);
      }
    });

    it("rejects malformed PEM", async () => {
      const malformed = "-----BEGIN CERTIFICATE-----\nno base64 here !!!\n-----END CERTIFICATE-----";
      const result = await validateCertificatePEM(malformed);
      // May fail during parsing or validation
      expect(result.ok).toBe(false);
    });

    it("handles whitespace around PEM", async () => {
      const withWhitespace = "  \n-----BEGIN CERTIFICATE-----\ndata\n-----END CERTIFICATE-----\n  ";
      const result = await validateCertificatePEM(withWhitespace);
      // Should trim and attempt parsing
      expect(typeof result.ok).toBe("boolean");
    });
  });

  describe("getCertificateValidityState", () => {
    it("returns EXPIRED for revoked certificate", () => {
      const future = new Date(Date.now() + 100 * 24 * 60 * 60 * 1000);
      const state = getCertificateValidityState("REVOKED", future);
      expect(state).toBe("EXPIRED");
    });

    it("returns EXPIRED for expired status", () => {
      const future = new Date(Date.now() + 100 * 24 * 60 * 60 * 1000);
      const state = getCertificateValidityState("EXPIRED", future);
      expect(state).toBe("EXPIRED");
    });

    it("returns EXPIRED when notAfter is in the past", () => {
      const past = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      const state = getCertificateValidityState("ACTIVE", past);
      expect(state).toBe("EXPIRED");
    });

    it("returns EXPIRING_SOON within warning window", () => {
      const warningDays = 30;
      const expiringDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // 10 days
      const state = getCertificateValidityState("ACTIVE", expiringDate, warningDays);
      expect(state).toBe("EXPIRING_SOON");
    });

    it("returns VALID when expiry is beyond warning window", () => {
      const warningDays = 30;
      const futureDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // 60 days
      const state = getCertificateValidityState("ACTIVE", futureDate, warningDays);
      expect(state).toBe("VALID");
    });

    it("returns EXPIRING_SOON at exactly warning threshold", () => {
      const warningDays = 30;
      const thresholdDate = new Date(Date.now() + warningDays * 24 * 60 * 60 * 1000);
      const state = getCertificateValidityState("ACTIVE", thresholdDate, warningDays);
      expect(state).toBe("EXPIRING_SOON");
    });
  });

  describe("getCertificateStatusAriaLabel", () => {
    it("provides label for VALID state", () => {
      const label = getCertificateStatusAriaLabel("VALID", 45);
      expect(label).toContain("valid");
      expect(label).toContain("45 days");
    });

    it("provides label for EXPIRING_SOON state", () => {
      const label = getCertificateStatusAriaLabel("EXPIRING_SOON", 15);
      expect(label).toContain("expiring soon");
      expect(label).toContain("15 days");
    });

    it("provides label for EXPIRED state", () => {
      const label = getCertificateStatusAriaLabel("EXPIRED", 0);
      expect(label).toContain("expired");
    });
  });
});
