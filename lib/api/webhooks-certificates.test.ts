import {
  listWebhookCertificates,
  uploadWebhookCertificate,
  revokeWebhookCertificate,
  completeWebhookCertificateRotation,
  getWebhookCertificate,
} from "./webhooks-certificates";
import { apiClient } from "./client";

// Mock the API client
jest.mock("./client");

const mockApiClient = apiClient as jest.MockedFunction<typeof apiClient>;

describe("Webhook Certificates API", () => {
  const mockToken = "test-token";
  const mockWebhookId = "webhook-123";
  const mockCertificateId = "cert-456";
  const mockSignal = new AbortController().signal;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("listWebhookCertificates", () => {
    it("fetches certificates from API", async () => {
      const mockCertificates = [
        {
          id: mockCertificateId,
          webhookId: mockWebhookId,
          subject: "CN=example.com",
          issuer: "CN=My CA",
          serial: "abc123",
          fingerprint: "aa:bb:cc",
          sans: ["example.com"],
          notBefore: new Date("2024-01-01"),
          notAfter: new Date("2025-01-01"),
          status: "ACTIVE",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockApiClient.mockResolvedValue({
        certificates: mockCertificates,
      });

      const result = await listWebhookCertificates(mockToken, mockWebhookId, mockSignal);

      expect(result).toEqual(mockCertificates);
      expect(mockApiClient).toHaveBeenCalledWith({
        path: `/webhooks/${mockWebhookId}/certificates`,
        method: "GET",
        headers: expect.any(Object),
        signal: mockSignal,
      });
    });

    it("handles API errors", async () => {
      mockApiClient.mockRejectedValue(new Error("Network error"));

      await expect(
        listWebhookCertificates(mockToken, mockWebhookId, mockSignal)
      ).rejects.toThrow("Network error");
    });
  });

  describe("uploadWebhookCertificate", () => {
    it("uploads certificate and returns metadata", async () => {
      const mockCertPEM = "-----BEGIN CERTIFICATE-----\ndata\n-----END CERTIFICATE-----";
      const mockResponse = {
        certificate: {
          id: "new-cert",
          webhookId: mockWebhookId,
          subject: "CN=example.com",
          issuer: "CN=My CA",
          serial: "def456",
          fingerprint: "dd:ee:ff",
          sans: ["example.com"],
          notBefore: new Date("2024-01-01"),
          notAfter: new Date("2025-01-01"),
          status: "ACTIVE",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        validationWarnings: [],
      };

      mockApiClient.mockResolvedValue(mockResponse);

      const result = await uploadWebhookCertificate(
        mockToken,
        mockWebhookId,
        mockCertPEM,
        mockSignal
      );

      expect(result.certificate).toBeDefined();
      expect(result.certificate.status).toBe("ACTIVE");
      expect(mockApiClient).toHaveBeenCalled();
    });

    it("includes certificate in FormData", async () => {
      const mockCertPEM = "-----BEGIN CERTIFICATE-----\ndata\n-----END CERTIFICATE-----";
      mockApiClient.mockResolvedValue({
        certificate: {
          id: "new-cert",
          webhookId: mockWebhookId,
          subject: "CN=example.com",
          issuer: "CN=CA",
          serial: "xyz",
          fingerprint: "aa:bb:cc",
          sans: ["example.com"],
          notBefore: new Date(),
          notAfter: new Date(),
          status: "ACTIVE",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      await uploadWebhookCertificate(mockToken, mockWebhookId, mockCertPEM, mockSignal);

      expect(mockApiClient).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          path: `/webhooks/${mockWebhookId}/certificates`,
        })
      );
    });
  });

  describe("revokeWebhookCertificate", () => {
    it("revokes certificate", async () => {
      const mockResponse = {
        certificate: {
          id: mockCertificateId,
          webhookId: mockWebhookId,
          subject: "CN=example.com",
          issuer: "CN=CA",
          serial: "abc123",
          fingerprint: "aa:bb:cc",
          sans: ["example.com"],
          notBefore: new Date("2024-01-01"),
          notAfter: new Date("2025-01-01"),
          status: "REVOKED",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };

      mockApiClient.mockResolvedValue(mockResponse);

      const result = await revokeWebhookCertificate(
        mockToken,
        mockWebhookId,
        mockCertificateId,
        mockSignal
      );

      expect(result.certificate.status).toBe("REVOKED");
      expect(mockApiClient).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          path: `/webhooks/${mockWebhookId}/certificates/${mockCertificateId}/revoke`,
        })
      );
    });

    it("handles revocation conflicts (409)", async () => {
      mockApiClient.mockRejectedValue(
        new Error("Cannot revoke last active certificate")
      );

      await expect(
        revokeWebhookCertificate(mockToken, mockWebhookId, mockCertificateId, mockSignal)
      ).rejects.toThrow("Cannot revoke last active certificate");
    });
  });

  describe("completeWebhookCertificateRotation", () => {
    it("completes rotation by revoking RETIRING cert", async () => {
      const mockResponse = {
        certificate: {
          id: mockCertificateId,
          webhookId: mockWebhookId,
          subject: "CN=old.example.com",
          issuer: "CN=CA",
          serial: "old123",
          fingerprint: "old:old:old",
          sans: ["old.example.com"],
          notBefore: new Date("2023-01-01"),
          notAfter: new Date("2024-01-01"),
          status: "REVOKED",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };

      mockApiClient.mockResolvedValue(mockResponse);

      const result = await completeWebhookCertificateRotation(
        mockToken,
        mockWebhookId,
        mockCertificateId,
        mockSignal
      );

      expect(result.certificate.status).toBe("REVOKED");
      expect(mockApiClient).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          path: `/webhooks/${mockWebhookId}/certificates/${mockCertificateId}/complete-rotation`,
        })
      );
    });
  });

  describe("getWebhookCertificate", () => {
    it("fetches single certificate by ID", async () => {
      const mockResponse = {
        id: mockCertificateId,
        webhookId: mockWebhookId,
        subject: "CN=example.com",
        issuer: "CN=CA",
        serial: "abc123",
        fingerprint: "aa:bb:cc",
        sans: ["example.com"],
        notBefore: new Date("2024-01-01"),
        notAfter: new Date("2025-01-01"),
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockApiClient.mockResolvedValue(mockResponse);

      const result = await getWebhookCertificate(
        mockToken,
        mockWebhookId,
        mockCertificateId,
        mockSignal
      );

      expect(result.id).toBe(mockCertificateId);
      expect(mockApiClient).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          path: `/webhooks/${mockWebhookId}/certificates/${mockCertificateId}`,
        })
      );
    });
  });

  describe("Error Handling", () => {
    it("handles 400 validation errors", async () => {
      mockApiClient.mockRejectedValue(
        new Error("Certificate exceeded size limit")
      );

      await expect(
        uploadWebhookCertificate(mockToken, mockWebhookId, "cert", mockSignal)
      ).rejects.toThrow("Certificate exceeded size limit");
    });

    it("handles 401 authorization errors", async () => {
      mockApiClient.mockRejectedValue(new Error("Unauthorized"));

      await expect(
        listWebhookCertificates(mockToken, mockWebhookId, mockSignal)
      ).rejects.toThrow("Unauthorized");
    });
  });
});
