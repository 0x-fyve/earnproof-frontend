/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
import EmbedVerifyPage from "../page";
import { fetchWidgetVerification } from "@/lib/api/verification-widget";
import { fetchMockCapabilityDocument, CAPABILITY_DOCUMENT_SHAPE_VERSION } from "@/lib/api/capabilities";
import { API_SPEC_VERSION } from "@/lib/api/generated/v1";
import type { VerifyProofResponse } from "@/lib/api/generated/v1";

jest.mock("@/lib/api/capabilities", () => ({
  ...jest.requireActual("@/lib/api/capabilities"),
  fetchMockCapabilityDocument: jest.fn(),
}));

jest.mock("@/lib/api/verification-widget", () => ({
  ...jest.requireActual("@/lib/api/verification-widget"),
  fetchWidgetVerification: jest.fn(),
}));

const mockedFetchCapabilities = fetchMockCapabilityDocument as jest.MockedFunction<
  typeof fetchMockCapabilityDocument
>;
const mockedFetchWidget = fetchWidgetVerification as jest.MockedFunction<
  typeof fetchWidgetVerification
>;

const VALID_RESULT: VerifyProofResponse = { result: "VALID", status: "valid" };

function enabledCapabilities() {
  return {
    documentVersion: CAPABILITY_DOCUMENT_SHAPE_VERSION,
    apiVersion: API_SPEC_VERSION,
    network: "testnet",
    generatedAt: new Date().toISOString(),
    capabilities: { "embeddable-verification-widget": { enabled: true } },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  mockedFetchCapabilities.mockReset();
  mockedFetchWidget.mockReset();
  mockedFetchCapabilities.mockResolvedValue(enabledCapabilities());
  mockedFetchWidget.mockResolvedValue({ kind: "result", response: VALID_RESULT });
});

describe("EmbedVerifyPage", () => {
  it("renders the widget for a well-formed proof id route param", async () => {
    render(<EmbedVerifyPage params={{ id: "EP-8A42-91DC" }} />);

    await waitFor(() => expect(screen.getByText("valid")).toBeInTheDocument());
    expect(mockedFetchWidget).toHaveBeenCalledWith(
      "EP-8A42-91DC",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("renders an inline invalid-link state (not a 500, not a raw error) for a malformed id, without ever calling the API", () => {
    render(<EmbedVerifyPage params={{ id: "<script>alert(1)</script>" }} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Invalid verification link");
    expect(mockedFetchWidget).not.toHaveBeenCalled();
    expect(mockedFetchCapabilities).not.toHaveBeenCalled();
  });

  it("renders an inline invalid-link state for an empty id", () => {
    render(<EmbedVerifyPage params={{ id: "" }} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Invalid verification link");
    expect(mockedFetchWidget).not.toHaveBeenCalled();
  });

  it("renders an inline invalid-link state for a javascript: URL passed as the id", () => {
    render(<EmbedVerifyPage params={{ id: "javascript:alert(document.cookie)" }} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Invalid verification link");
    expect(mockedFetchWidget).not.toHaveBeenCalled();
  });

  it("labels the main region for assistive tech and does not render the full app shell/nav", async () => {
    render(<EmbedVerifyPage params={{ id: "EP-8A42-91DC" }} />);

    expect(
      screen.getByRole("main", { name: "EarnProof proof verification" }),
    ).toBeInTheDocument();
    // The main app's PublicShell renders primary navigation links (Verify,
    // Proofs, Settings, ...) — none of that belongs in a small
    // relying-party-embedded iframe.
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();

    // Let the capability check / widget fetch settle before the test ends.
    await waitFor(() => expect(screen.getByText("valid")).toBeInTheDocument());
  });
});
