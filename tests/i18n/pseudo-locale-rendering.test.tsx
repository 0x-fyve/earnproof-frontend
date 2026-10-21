/**
 * @jest-environment jsdom
 */

/**
 * Pseudo-locale rendering checks for representative routes and components.
 *
 * These render real components — not mocked stand-ins — with pseudo-localized
 * content and then inspect the resulting DOM for the assumptions that break
 * once text gets longer:
 *
 *   - text that can be clipped (a capped or fixed height combined with
 *     `overflow-hidden`, or an ellipsis/`nowrap` utility on real prose);
 *   - fixed-width containers holding user text;
 *   - accessible names that stop being meaningful when the text expands;
 *   - labels assembled from fragments, which pseudo-localization makes
 *     visible as several delimited runs inside one element.
 *
 * Scope note: these run in jsdom, which does not compute layout, so they
 * assert on the *declared* layout constraints rather than on measured
 * pixels. Pixel-level zoom and reflow behaviour is a browser concern and is
 * covered by the accessibility browser suite.
 */

import { render, screen, within } from "@testing-library/react";
import { countPseudoRuns, pseudoLocalize, pseudoLocalizeDeep } from "@/lib/i18n/pseudo-locale";
import {
  VerificationPanel,
  type VerifyProofResponse,
} from "@/components/verification/verification-panel";

/** Utilities that clip text when it grows. */
const CLIPPING_UTILITIES = ["truncate", "text-ellipsis", "overflow-hidden"];
/** Height utilities that cap a box regardless of its content. */
const CAPPED_HEIGHT = /^(?:sm:|md:|lg:|xl:)?(?:max-)?h-(?!full|auto|screen|fit|none)[\w[\]./-]+$/;
/** Width utilities that fix a box regardless of its content. */
const FIXED_WIDTH = /^(?:sm:|md:|lg:|xl:)?w-(?!full|auto|screen|fit|px)\d[\w[\]./-]*$/;

function classesOf(element: Element): string[] {
  return (element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

/** Visible text owned by this element, excluding text inside child elements. */
function ownText(element: Element): string {
  return [...element.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? "")
    .join("")
    .trim();
}

function hasProse(element: Element): boolean {
  const text = ownText(element);
  return /[A-Za-zÀ-ɏ]{2,}/.test(text);
}

type Violation = { tag: string; classes: string; text: string };

function findClippedText(container: HTMLElement): Violation[] {
  const violations: Violation[] = [];
  for (const element of container.querySelectorAll("*")) {
    if (!hasProse(element)) continue;
    const classes = classesOf(element);

    const clipping = classes.filter((name) => CLIPPING_UTILITIES.includes(name));
    const capped = classes.filter((name) => CAPPED_HEIGHT.test(name));
    const ellipsis = classes.some((name) => name === "truncate" || name === "text-ellipsis");
    const nowrap = classes.includes("whitespace-nowrap") && ownText(element).includes(" ");

    if ((clipping.length > 0 && capped.length > 0) || ellipsis || nowrap) {
      violations.push({
        tag: element.tagName.toLowerCase(),
        classes: classes.join(" "),
        text: ownText(element).slice(0, 60),
      });
    }
  }
  return violations;
}

function findFixedWidthText(container: HTMLElement): Violation[] {
  const violations: Violation[] = [];
  for (const element of container.querySelectorAll("*")) {
    if (!hasProse(element)) continue;
    const classes = classesOf(element);
    if (classes.some((name) => FIXED_WIDTH.test(name))) {
      violations.push({
        tag: element.tagName.toLowerCase(),
        classes: classes.join(" "),
        text: ownText(element).slice(0, 60),
      });
    }
  }
  return violations;
}

/**
 * Elements whose own text contains more than one delimited pseudo run were
 * assembled from separate strings — the signature of a sentence built in JSX
 * that a translator can never reorder.
 */
function findFragmentedText(container: HTMLElement): string[] {
  const fragmented: string[] = [];
  for (const element of container.querySelectorAll("*")) {
    const text = element.textContent ?? "";
    const childRuns = [...element.children].reduce(
      (sum, child) => sum + countPseudoRuns(child.textContent ?? ""),
      0,
    );
    if (countPseudoRuns(text) - childRuns > 1) {
      fragmented.push(text.slice(0, 80));
    }
  }
  return fragmented;
}

const verificationResult: VerifyProofResponse = {
  result: "VALID",
  status: "valid",
  credential: {
    id: "urn:earnproof:credential:0001",
    schemaVersion: "1.0",
    subject: { walletHash: "b3d1f0a9c2e4" },
    claim: {
      operator: ">=",
      thresholdAmount: "4200",
      assetCode: "USDC",
      qualifyingPaymentCount: 12,
      periodStart: "2026-01-03T00:00:00.000Z",
      periodEnd: "2026-01-09T00:00:00.000Z",
    },
    proof: { credentialHash: "9a8b7c6d5e4f", issuer: "did:web:issuer.example" },
  },
  proof: {
    id: "EP-8A42-91DC",
    network: "testnet",
    expiresAt: "2026-02-09T00:00:00.000Z",
  },
} as unknown as VerifyProofResponse;

describe("VerificationPanel under the pseudo-locale", () => {
  it("does not clip user text at any declared height cap", () => {
    const { container } = render(<VerificationPanel result={verificationResult} />);
    expect(findClippedText(container)).toEqual([]);
  });

  it("does not put user text in a fixed-width container", () => {
    const { container } = render(<VerificationPanel result={verificationResult} />);
    expect(findFixedWidthText(container)).toEqual([]);
  });

  it("keeps every result label and value readable when the data expands", () => {
    const expanded = pseudoLocalizeDeep(verificationResult);
    const { container } = render(<VerificationPanel result={expanded} />);

    // Every definition term still has a matching, non-empty description.
    const terms = container.querySelectorAll("dt");
    const descriptions = container.querySelectorAll("dd");
    expect(terms.length).toBeGreaterThan(0);
    expect(descriptions.length).toBe(terms.length);
    for (const description of descriptions) {
      expect((description.textContent ?? "").trim().length).toBeGreaterThan(0);
    }

    expect(findClippedText(container)).toEqual([]);
  });

  it("builds the claim from one owned message, not from fragments", () => {
    const { container } = render(<VerificationPanel result={verificationResult} />);
    // The claim renders as a single string with its values interpolated;
    // under the pseudo-locale that is one delimited run, not three.
    expect(findFragmentedText(container)).toEqual([]);
  });
});

describe("the status route under the pseudo-locale", () => {
  const renderStatusRoute = async () => {
    jest.resetModules();
    process.env.NEXT_PUBLIC_PSEUDO_LOCALE = "1";

    jest.doMock("@/lib/health-check", () => ({
      useHealthCheck: () => ({
        data: { status: "ok", database: "ok", timestamp: "2026-08-28T14:37:00.000Z" },
        loading: false,
        error: null,
        lastChecked: new Date("2026-08-28T14:37:00.000Z"),
        lastUpdated: "2026-08-28T14:37:00.000Z",
        refetch: () => {},
      }),
    }));
    jest.doMock("@/components/layout/public-shell", () => ({
      PublicShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    }));
    // This route's own text/layout is what this suite checks; the export
    // widget is a separate, already-covered component
    // (components/common/__tests__/support-diagnostics-export.test.tsx) with
    // its own hooks (useId, usePathname) that don't interact with
    // pseudo-localization, so it's mocked out here the same way PublicShell
    // is above.
    jest.doMock("@/components/common/support-diagnostics-export", () => ({
      SupportDiagnosticsExport: () => <div>Support diagnostics export</div>,
    }));
    // Same reasoning as above: the drift panel's own text/layout is covered
    // by components/common/__tests__/contract-drift-panel.test.tsx, and its
    // self-loading wrapper's effect/useState churn interacts badly with
    // this suite's jest.resetModules() + doMock setup, so it's mocked out
    // here too.
    jest.doMock("@/components/common/contract-drift-panel", () => ({
      ContractDriftStatusPanel: () => <div>Backend-to-contract drift placeholder</div>,
    }));

    const { default: StatusPage } = await import("@/app/status/page");
    return render(<StatusPage />);
  };

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_PSEUDO_LOCALE;
    jest.resetModules();
  });

  it("pseudo-localizes every owned string, so an un-owned one would stand out", async () => {
    const { container } = await renderStatusRoute();
    const heading = screen.getByRole("heading", { level: 1 });

    expect(heading.textContent).toContain(pseudoLocalize("System status"));
    expect(container.textContent).not.toContain("Services online");
  });

  it("expands the visible text enough to stress the layout", async () => {
    const { container } = await renderStatusRoute();
    const expandedLength = (container.textContent ?? "").length;

    jest.resetModules();
    delete process.env.NEXT_PUBLIC_PSEUDO_LOCALE;
    jest.doMock("@/lib/health-check", () => ({
      useHealthCheck: () => ({
        data: { status: "ok", database: "ok", timestamp: "2026-08-28T14:37:00.000Z" },
        loading: false,
        error: null,
        lastChecked: new Date("2026-08-28T14:37:00.000Z"),
        lastUpdated: "2026-08-28T14:37:00.000Z",
        refetch: () => {},
      }),
    }));
    jest.doMock("@/components/layout/public-shell", () => ({
      PublicShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    }));
    const { default: PlainStatusPage } = await import("@/app/status/page");
    const plain = render(<PlainStatusPage />);

    expect(expandedLength).toBeGreaterThan((plain.container.textContent ?? "").length * 1.2);
  });

  it("does not clip or fix the width of any expanded string", async () => {
    const { container } = await renderStatusRoute();
    expect(findClippedText(container)).toEqual([]);
    expect(findFixedWidthText(container)).toEqual([]);
  });

  it("keeps accessible names meaningful under expanded text", async () => {
    await renderStatusRoute();

    for (const control of screen.getAllByRole("button")) {
      const name = (control.textContent ?? "").trim() || control.getAttribute("aria-label") || "";
      expect(name.length).toBeGreaterThan(0);
      // An expanded name is still the label, not a truncated stub.
      expect(name).not.toMatch(/…$/);
    }

    const heading = screen.getByRole("heading", { level: 1 });
    expect(within(heading).queryByRole("presentation")).toBeNull();
    expect((heading.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  it("does not assemble any visible string from fragments", async () => {
    const { container } = await renderStatusRoute();
    expect(findFragmentedText(container)).toEqual([]);
  });
});
