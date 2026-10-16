import { render, screen } from "@testing-library/react";
import { BlockingFindingsPanel } from "../blocking-findings";
import { makeBlockingFinding, makeBlockedContractUpgradeReview } from "@/data/fixtures/contract-upgrades";

describe("BlockingFindingsPanel", () => {
  it("renders success state when no findings", () => {
    render(<BlockingFindingsPanel findings={[]} />);

    expect(screen.getByText("Blocking Findings")).toBeInTheDocument();
    expect(screen.getByText("No blocking findings")).toBeInTheDocument();
    expect(screen.getByText("This upgrade is clear to proceed")).toBeInTheDocument();
  });

  it("renders findings list when findings present", () => {
    const findings = makeBlockedContractUpgradeReview().blockingFindings;

    render(<BlockingFindingsPanel findings={findings} />);

    expect(screen.getByText("Blocking Findings")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(findings.length.toString()))).toBeInTheDocument();
  });

  it("displays finding title and description", () => {
    const findings = [
      makeBlockingFinding({
        title: "Critical Issue",
        description: "This is a critical issue that must be resolved",
      }),
    ];

    render(<BlockingFindingsPanel findings={findings} />);

    expect(screen.getByText("Critical Issue")).toBeInTheDocument();
    expect(screen.getByText("This is a critical issue that must be resolved")).toBeInTheDocument();
  });

  it("displays finding category", () => {
    const findings = [
      makeBlockingFinding({ category: "critical" }),
      makeBlockingFinding({ category: "security" }),
      makeBlockingFinding({ category: "compatibility" }),
      makeBlockingFinding({ category: "migration" }),
    ];

    render(<BlockingFindingsPanel findings={findings} />);

    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("Security")).toBeInTheDocument();
    expect(screen.getByText("Compatibility")).toBeInTheDocument();
    expect(screen.getByText("Migration")).toBeInTheDocument();
  });

  it("displays affected component", () => {
    const findings = [
      makeBlockingFinding({
        affectedComponent: "PaymentVerificationService",
      }),
    ];

    render(<BlockingFindingsPanel findings={findings} />);

    expect(screen.getByText("Affected Component:")).toBeInTheDocument();
    expect(screen.getByText("PaymentVerificationService")).toBeInTheDocument();
  });

  it("displays resolution when provided", () => {
    const findings = [
      makeBlockingFinding({
        resolution: "Run migration script to fix the issue",
      }),
    ];

    render(<BlockingFindingsPanel findings={findings} />);

    expect(screen.getByText("Resolution:")).toBeInTheDocument();
    expect(screen.getByText("Run migration script to fix the issue")).toBeInTheDocument();
  });

  it("omits resolution section when not provided", () => {
    const findings = [
      makeBlockingFinding({
        resolution: undefined,
      }),
    ];

    render(<BlockingFindingsPanel findings={findings} />);

    expect(screen.queryByText("Resolution:")).not.toBeInTheDocument();
  });

  it("sorts findings by severity (critical first)", () => {
    const findings = [
      makeBlockingFinding({ id: "1", category: "migration", title: "Migration" }),
      makeBlockingFinding({ id: "2", category: "critical", title: "Critical" }),
      makeBlockingFinding({ id: "3", category: "security", title: "Security" }),
    ];

    render(<BlockingFindingsPanel findings={findings} />);

    const titles = screen.getAllByText(/^(Critical|Security|Migration)$/);
    expect(titles[0].textContent).toBe("Critical");
  });

  it("displays detection timestamp", () => {
    const findings = [
      makeBlockingFinding({
        detectedAt: new Date("2024-01-01T12:00:00Z").toISOString(),
      }),
    ];

    render(<BlockingFindingsPanel findings={findings} />);

    expect(screen.getByText(/Detected:/)).toBeInTheDocument();
  });

  it("shows finding count in header", () => {
    const findings = Array(3).fill(null).map((_, i) =>
      makeBlockingFinding({
        id: `finding-${i}`,
        title: `Finding ${i}`,
      })
    );

    render(<BlockingFindingsPanel findings={findings} />);

    expect(screen.getByText(/3 findings/)).toBeInTheDocument();
  });

  it("uses singular form for single finding", () => {
    const findings = [makeBlockingFinding()];

    render(<BlockingFindingsPanel findings={findings} />);

    expect(screen.getByText(/1 finding/)).toBeInTheDocument();
  });
});
