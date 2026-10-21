import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CertificateUploadForm } from "./certificate-upload-form";

// Mock the API and validation modules
jest.mock("@/lib/api/webhooks-certificates");
jest.mock("@/lib/validation/webhooks-certificates");

import { uploadWebhookCertificate } from "@/lib/api/webhooks-certificates";
import { validateCertificatePEM, detectPrivateKeyBlock } from "@/lib/validation/webhooks-certificates";

const mockValidateCertificatePEM = validateCertificatePEM as jest.MockedFunction<
  typeof validateCertificatePEM
>;
const mockDetectPrivateKeyBlock = detectPrivateKeyBlock as jest.MockedFunction<
  typeof detectPrivateKeyBlock
>;
const mockUploadWebhookCertificate = uploadWebhookCertificate as jest.MockedFunction<
  typeof uploadWebhookCertificate
>;

describe("CertificateUploadForm", () => {
  const mockToken = "test-token";
  const mockWebhookId = "webhook-123";
  const mockWebhookUrl = "https://example.com/webhook";
  const mockOnCertificateUploaded = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateCertificatePEM.mockResolvedValue({ ok: true });
    mockDetectPrivateKeyBlock.mockReturnValue(false);
  });

  describe("Rendering", () => {
    it("renders upload form with file input and textarea", () => {
      render(
        <CertificateUploadForm
          token={mockToken}
          webhookId={mockWebhookId}
          webhookUrl={mockWebhookUrl}
          onCertificateUploaded={mockOnCertificateUploaded}
        />
      );

      expect(screen.getByText("Upload Client Certificate")).toBeInTheDocument();
      expect(screen.getByText(/drag and drop/i)).toBeInTheDocument();
      expect(screen.getByText(/paste certificate text/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /upload certificate/i })).toBeInTheDocument();
    });

    it("shows upload button disabled initially", () => {
      render(
        <CertificateUploadForm
          token={mockToken}
          webhookId={mockWebhookId}
          webhookUrl={mockWebhookUrl}
          onCertificateUploaded={mockOnCertificateUploaded}
        />
      );

      const button = screen.getByRole("button", { name: /upload certificate/i });
      expect(button).toBeDisabled();
    });
  });

  describe("Private Key Detection", () => {
    it("rejects private key and shows warning", async () => {
      mockDetectPrivateKeyBlock.mockReturnValue(true);

      render(
        <CertificateUploadForm
          token={mockToken}
          webhookId={mockWebhookId}
          webhookUrl={mockWebhookUrl}
          onCertificateUploaded={mockOnCertificateUploaded}
        />
      );

      const textarea = screen.getByPlaceholderText(/BEGIN CERTIFICATE/);
      await userEvent.type(textarea, "-----BEGIN PRIVATE KEY-----");

      await waitFor(() => {
        expect(screen.getByText(/private key detected and rejected/i)).toBeInTheDocument();
      });
    });

    it("clears private key after detection", async () => {
      mockDetectPrivateKeyBlock.mockReturnValue(true);

      render(
        <CertificateUploadForm
          token={mockToken}
          webhookId={mockWebhookId}
          webhookUrl={mockWebhookUrl}
          onCertificateUploaded={mockOnCertificateUploaded}
        />
      );

      const textarea = screen.getByPlaceholderText(/BEGIN CERTIFICATE/) as HTMLTextAreaElement;
      fireEvent.change(textarea, {
        target: { value: "-----BEGIN PRIVATE KEY-----\nkey" },
      });

      await waitFor(() => {
        expect(screen.getByText(/private key detected/i)).toBeInTheDocument();
      });
    });
  });

  describe("Certificate Validation", () => {
    it("enables submit button when certificate is valid", async () => {
      mockValidateCertificatePEM.mockResolvedValue({ ok: true });

      render(
        <CertificateUploadForm
          token={mockToken}
          webhookId={mockWebhookId}
          webhookUrl={mockWebhookUrl}
          onCertificateUploaded={mockOnCertificateUploaded}
        />
      );

      const textarea = screen.getByPlaceholderText(/BEGIN CERTIFICATE/);
      await userEvent.type(
        textarea,
        "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAK...\n-----END CERTIFICATE-----"
      );

      await waitFor(() => {
        const button = screen.getByRole("button", { name: /upload certificate/i });
        expect(button).not.toBeDisabled();
      });
    });

    it("disables submit button when certificate validation fails", async () => {
      mockValidateCertificatePEM.mockResolvedValue({
        ok: false,
        errors: ["Certificate has expired"],
      });

      render(
        <CertificateUploadForm
          token={mockToken}
          webhookId={mockWebhookId}
          webhookUrl={mockWebhookUrl}
          onCertificateUploaded={mockOnCertificateUploaded}
        />
      );

      const textarea = screen.getByPlaceholderText(/BEGIN CERTIFICATE/);
      await userEvent.type(
        textarea,
        "-----BEGIN CERTIFICATE-----\nexpired\n-----END CERTIFICATE-----"
      );

      await waitFor(() => {
        expect(screen.getByText("Certificate has expired")).toBeInTheDocument();
        const button = screen.getByRole("button", { name: /upload certificate/i });
        expect(button).toBeDisabled();
      });
    });

    it("shows multiple validation errors", async () => {
      mockValidateCertificatePEM.mockResolvedValue({
        ok: false,
        errors: [
          "Certificate has expired",
          "Hostname mismatch",
          "Invalid signature algorithm",
        ],
      });

      render(
        <CertificateUploadForm
          token={mockToken}
          webhookId={mockWebhookId}
          webhookUrl={mockWebhookUrl}
          onCertificateUploaded={mockOnCertificateUploaded}
        />
      );

      const textarea = screen.getByPlaceholderText(/BEGIN CERTIFICATE/);
      await userEvent.type(textarea, "-----BEGIN CERTIFICATE-----\ndata\n-----END CERTIFICATE-----");

      await waitFor(() => {
        expect(screen.getByText("Certificate has expired")).toBeInTheDocument();
        expect(screen.getByText("Hostname mismatch")).toBeInTheDocument();
        expect(screen.getByText("Invalid signature algorithm")).toBeInTheDocument();
      });
    });
  });

  describe("File Upload", () => {
    it("accepts file upload and validates", async () => {
      mockValidateCertificatePEM.mockResolvedValue({ ok: true });

      render(
        <CertificateUploadForm
          token={mockToken}
          webhookId={mockWebhookId}
          webhookUrl={mockWebhookUrl}
          onCertificateUploaded={mockOnCertificateUploaded}
        />
      );

      const fileInput = screen.getByRole("button", { name: /drag and drop/i }).parentElement?.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement;

      const file = new File(
        ["-----BEGIN CERTIFICATE-----\ndata\n-----END CERTIFICATE-----"],
        "cert.pem",
        { type: "text/plain" }
      );

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(mockValidateCertificatePEM).toHaveBeenCalled();
      });
    });

    it("rejects non-PEM files", async () => {
      render(
        <CertificateUploadForm
          token={mockToken}
          webhookId={mockWebhookId}
          webhookUrl={mockWebhookUrl}
          onCertificateUploaded={mockOnCertificateUploaded}
        />
      );

      const fileInput = screen.getByRole("button", { name: /drag and drop/i }).parentElement?.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement;

      const file = new File(["not a cert"], "cert.json", { type: "application/json" });

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText(/must be a .pem certificate file/i)).toBeInTheDocument();
      });
    });
  });

  describe("Form Submission", () => {
    it("submits valid certificate and calls callback", async () => {
      mockValidateCertificatePEM.mockResolvedValue({ ok: true });
      mockUploadWebhookCertificate.mockResolvedValue({
        certificate: {
          id: "cert-123",
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
      });

      render(
        <CertificateUploadForm
          token={mockToken}
          webhookId={mockWebhookId}
          webhookUrl={mockWebhookUrl}
          onCertificateUploaded={mockOnCertificateUploaded}
        />
      );

      const textarea = screen.getByPlaceholderText(/BEGIN CERTIFICATE/);
      await userEvent.type(
        textarea,
        "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAK...\n-----END CERTIFICATE-----"
      );

      const button = screen.getByRole("button", { name: /upload certificate/i });

      await waitFor(() => {
        expect(button).not.toBeDisabled();
      });

      await userEvent.click(button);

      await waitFor(() => {
        expect(mockUploadWebhookCertificate).toHaveBeenCalledWith(
          mockToken,
          mockWebhookId,
          expect.stringContaining("BEGIN CERTIFICATE"),
          expect.any(AbortSignal)
        );
        expect(mockOnCertificateUploaded).toHaveBeenCalled();
      });
    });

    it("shows error if upload fails", async () => {
      mockValidateCertificatePEM.mockResolvedValue({ ok: true });
      mockUploadWebhookCertificate.mockRejectedValue(new Error("Server error"));

      render(
        <CertificateUploadForm
          token={mockToken}
          webhookId={mockWebhookId}
          webhookUrl={mockWebhookUrl}
          onCertificateUploaded={mockOnCertificateUploaded}
        />
      );

      const textarea = screen.getByPlaceholderText(/BEGIN CERTIFICATE/);
      await userEvent.type(textarea, "-----BEGIN CERTIFICATE-----\ndata\n-----END CERTIFICATE-----");

      const button = screen.getByRole("button", { name: /upload certificate/i });

      await waitFor(() => {
        expect(button).not.toBeDisabled();
      });

      await userEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText(/server error/i)).toBeInTheDocument();
      });
    });
  });

  describe("Accessibility", () => {
    it("has accessible form labels", () => {
      render(
        <CertificateUploadForm
          token={mockToken}
          webhookId={mockWebhookId}
          webhookUrl={mockWebhookUrl}
          onCertificateUploaded={mockOnCertificateUploaded}
        />
      );

      expect(screen.getByLabelText(/paste certificate text/i)).toBeInTheDocument();
    });

    it("announces validation errors with aria-live", async () => {
      mockValidateCertificatePEM.mockResolvedValue({
        ok: false,
        errors: ["Certificate expired"],
      });

      render(
        <CertificateUploadForm
          token={mockToken}
          webhookId={mockWebhookId}
          webhookUrl={mockWebhookUrl}
          onCertificateUploaded={mockOnCertificateUploaded}
        />
      );

      const textarea = screen.getByPlaceholderText(/BEGIN CERTIFICATE/);
      await userEvent.type(textarea, "-----BEGIN CERTIFICATE-----\ndata\n-----END CERTIFICATE-----");

      await waitFor(() => {
        const alertBox = screen.getByRole("alert");
        expect(alertBox).toHaveAttribute("aria-live", "polite");
      });
    });
  });
});
