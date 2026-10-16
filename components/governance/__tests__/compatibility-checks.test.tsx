import { render, screen } from "@testing-library/react";
import { CompatibilityChecksPanel } from "../compatibility-checks";
import { makeCompatibilityCheck } from "@/data/fixtures/contract-upgrades";

describe("CompatibilityChecksPanel", () => {
  it("renders empty state when no checks provided", () => {
    render(<CompatibilityChecksPanel checks={[]} />);

    expect(screen.getByText("Compatibility Checks")).toBeInTheDocument();
    expect(screen.getByText("No compatibility checks available yet")).toBeInTheDocument();
  });

  it("renders all compatibility checks", () => {
    const checks = [
      makeCompatibilityCheck({ category: "abi", status: "compatible" }),
      makeCompatibilityCheck({ category: "storage", status: "compatible" }),
      makeCompatibilityCheck({ category: "dependency", status: "compatible" }),
      makeCompatibilityCheck({ category: "client", status: "compatible" }),
    ];

    render(<CompatibilityChecksPanel checks={checks} />);

    expect(screen.getByText("ABI Compatibility")).toBeInTheDocument();
    expect(screen.getByText("Storage Compatibility")).toBeInTheDocument();
    expect(screen.getByText("Dependency Compatibility")).toBeInTheDocument();
    expect(screen.getByText("Client Compatibility")).toBeInTheDocument();
  });

  it("groups checks by category", () => {
    const checks = [
      makeCompatibilityCheck({ category: "abi", status: "compatible" }),
      makeCompatibilityCheck({ category: "abi", status: "compatible" }),
    ];

    render(<CompatibilityChecksPanel checks={checks} />);

    const abiElements = screen.getAllByText("ABI Compatibility");
    expect(abiElements).toHaveLength(1); // Should only show heading once
  });

  it("displays check status indicators", () => {
    const checks = [
      makeCompatibilityCheck({
        category: "abi",
        status: "compatible",
        message: "Compatible message",
      }),
    ];

    render(<CompatibilityChecksPanel checks={checks} />);

    expect(screen.getByText("Compatible")).toBeInTheDocument();
    expect(screen.getByText("Compatible message")).toBeInTheDocument();
  });

  it("displays severity badge", () => {
    const checks = [
      makeCompatibilityCheck({
        category: "abi",
        severity: "error",
        message: "Error severity",
      }),
    ];

    render(<CompatibilityChecksPanel checks={checks} />);

    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("displays check details when provided", () => {
    const checks = [
      makeCompatibilityCheck({
        category: "abi",
        message: "Test",
        details: { field1: "value1", field2: "value2" },
      }),
    ];

    render(<CompatibilityChecksPanel checks={checks} />);

    expect(screen.getByText(/field1/)).toBeInTheDocument();
    expect(screen.getByText(/field2/)).toBeInTheDocument();
  });

  it("displays checked timestamp", () => {
    const now = new Date().toISOString();
    const checks = [
      makeCompatibilityCheck({
        category: "abi",
        checkedAt: now,
        message: "Test",
      }),
    ];

    render(<CompatibilityChecksPanel checks={checks} />);

    expect(screen.getByText(/Checked:/)).toBeInTheDocument();
  });

  it("displays incompatibility indicators", () => {
    const checks = [
      makeCompatibilityCheck({
        category: "abi",
        status: "incompatible",
        message: "Incompatible check",
      }),
    ];

    render(<CompatibilityChecksPanel checks={checks} />);

    expect(screen.getByText("Incompatible")).toBeInTheDocument();
    expect(screen.getByText("Incompatible check")).toBeInTheDocument();
  });
});
