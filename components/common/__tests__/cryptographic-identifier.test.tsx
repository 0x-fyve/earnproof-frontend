/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CryptographicIdentifier } from "../cryptographic-identifier";

const STELLAR_ADDRESS = "GA7QYNF7SOWQ3GLR2BGMZEHXAVAVGVHWGD5CDGDRA7VYAGF5D5MFBXBW";

describe("CryptographicIdentifier — rendering", () => {
  it("shows a compact label by default for a long identifier (the visible text, excluding the sr-only fallback copy)", () => {
    render(<CryptographicIdentifier value={STELLAR_ADDRESS} kind="wallet-address" />);
    const identifier = screen.getByTestId("cryptographic-identifier");
    const fallback = screen.getByTestId("full-identifier-fallback");
    const visibleText = identifier.textContent?.replace(fallback.textContent ?? "", "") ?? "";
    expect(visibleText).not.toContain(STELLAR_ADDRESS);
  });

  it("shows the full value directly for a short identifier (no expand control)", () => {
    render(<CryptographicIdentifier value="short-id" kind="key-id" />);
    expect(screen.queryByRole("button", { name: "Expand" })).not.toBeInTheDocument();
    expect(screen.getByTestId("cryptographic-identifier").textContent).toContain("short-id");
  });

  it("includes a full-value aria-label with the kind so screen readers hear the complete value", () => {
    render(<CryptographicIdentifier value={STELLAR_ADDRESS} kind="wallet-address" network="testnet" />);
    expect(
      screen.getByLabelText(`Stellar wallet address on testnet: ${STELLAR_ADDRESS}`),
    ).toBeInTheDocument();
  });
});

describe("CryptographicIdentifier — malformed values", () => {
  it("shows an explicit no-value state for an empty string rather than an empty control", () => {
    render(<CryptographicIdentifier value="" kind="proof-id" />);
    expect(screen.getByRole("status")).toHaveTextContent("No proof identifier available");
    expect(screen.queryByTestId("cryptographic-identifier")).not.toBeInTheDocument();
  });

  it("shows the no-value state for a whitespace-only value", () => {
    render(<CryptographicIdentifier value="   " kind="transaction-hash" />);
    expect(screen.getByRole("status")).toHaveTextContent("No transaction hash available");
  });
});

describe("CryptographicIdentifier — expand/collapse via keyboard", () => {
  it("can be expanded and collapsed with the keyboard (native button, Enter/Space)", async () => {
    const user = userEvent.setup();
    render(<CryptographicIdentifier value={STELLAR_ADDRESS} kind="wallet-address" />);

    const expandButton = screen.getByRole("button", { name: "Expand" });
    expandButton.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByTestId("cryptographic-identifier").textContent).toContain(STELLAR_ADDRESS);
    expect(screen.getByRole("button", { name: "Collapse" })).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Expand" })).toHaveAttribute("aria-expanded", "false");
  });

  it("reflects expanded state via aria-expanded", () => {
    render(<CryptographicIdentifier value={STELLAR_ADDRESS} kind="wallet-address" />);
    expect(screen.getByRole("button", { name: "Expand" })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("CryptographicIdentifier — copy behavior", () => {
  const originalClipboard = navigator.clipboard;

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      configurable: true,
    });
  });

  it("copies the FULL value, not the truncated compact label", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<CryptographicIdentifier value={STELLAR_ADDRESS} kind="wallet-address" />);
    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(STELLAR_ADDRESS));
  });

  it("shows copied feedback after a successful copy", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<CryptographicIdentifier value={STELLAR_ADDRESS} kind="wallet-address" />);
    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));

    await waitFor(() => expect(screen.getByText("Copied")).toBeInTheDocument());
  });

  it("shows a manual-fallback message when the Clipboard API is denied/unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });

    render(<CryptographicIdentifier value={STELLAR_ADDRESS} kind="wallet-address" />);
    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));

    await waitFor(() =>
      expect(screen.getByText(/Could not copy automatically/)).toBeInTheDocument(),
    );
  });

  it("shows a manual-fallback message when clipboard.writeText itself rejects", async () => {
    const writeText = jest.fn().mockRejectedValue(new Error("permission denied"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<CryptographicIdentifier value={STELLAR_ADDRESS} kind="wallet-address" />);
    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));

    await waitFor(() =>
      expect(screen.getByText(/Could not copy automatically/)).toBeInTheDocument(),
    );
  });

  it("the full value remains present (selectable) in the DOM even while collapsed, as a manual fallback", () => {
    render(<CryptographicIdentifier value={STELLAR_ADDRESS} kind="wallet-address" />);
    expect(screen.getByTestId("full-identifier-fallback")).toHaveTextContent(STELLAR_ADDRESS);
  });
});

describe("CryptographicIdentifier — distinguishable similar prefixes", () => {
  it("renders different compact labels for two identifiers sharing a long common prefix", () => {
    const addressA = "GA7QYNF7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const addressB = "GA7QYNF7BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

    const { unmount } = render(<CryptographicIdentifier value={addressA} kind="wallet-address" />);
    const labelA = screen.getByTestId("cryptographic-identifier").textContent;
    unmount();

    render(<CryptographicIdentifier value={addressB} kind="wallet-address" />);
    const labelB = screen.getByTestId("cryptographic-identifier").textContent;

    expect(labelA).not.toBe(labelB);
  });
});
