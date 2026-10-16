import React from "react";
import { render, screen, act } from "@testing-library/react";
import { appConfig } from "@/config/app";
import {
  CONTRACT_MIGRATION_SCHEMA_VERSION,
  type ContractMigrationStatus,
} from "@/lib/api/contract-migration";
import {
  ContractMigrationActionGate,
  ContractMigrationBanner,
} from "../contract-migration-banner";

const VALID_CONTRACT_ID = `C${"A".repeat(55)}`;
const OTHER_CONTRACT_ID = `C${"B".repeat(55)}`;

function status(
  overrides: Partial<ContractMigrationStatus> = {},
): ContractMigrationStatus {
  return {
    schemaVersion: CONTRACT_MIGRATION_SCHEMA_VERSION,
    network: appConfig.stellarNetwork,
    currentContractId: VALID_CONTRACT_ID,
    phase: "stable",
    ...overrides,
  };
}

afterEach(() => {
  // The network status module keeps module-level state; make sure it is reset
  // so an offline assertion in one test cannot leak into the next.
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
});

describe("ContractMigrationBanner", () => {
  it("renders nothing for a stable contract", () => {
    const { container } = render(<ContractMigrationBanner status={status()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there is no status", () => {
    const { container } = render(<ContractMigrationBanner status={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("announces the preparing phase as a status with write access intact", () => {
    render(<ContractMigrationBanner status={status({ phase: "preparing" })} />);
    expect(
      screen.getByText(/preparing to migrate/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/read-only access is preserved/i)).toBeNull();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows a read-only status while migrating", () => {
    render(<ContractMigrationBanner status={status({ phase: "migrating" })} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/read-only access is preserved/i)).toBeInTheDocument();
  });

  it("escalates to a danger alert once replaced", () => {
    render(<ContractMigrationBanner status={status({ phase: "replaced" })} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/read-only access is preserved/i)).toBeInTheDocument();
  });

  it("never links to an unverified successor", () => {
    render(
      <ContractMigrationBanner
        status={status({
          phase: "replaced",
          successor: {
            contractId: OTHER_CONTRACT_ID,
            verified: false,
            migrationGuideUrl: "https://example.com/migrate",
          },
        })}
      />,
    );
    expect(screen.queryByRole("link", { name: /migration guide/i })).toBeNull();
    expect(screen.getByText(/has not been verified/i)).toBeInTheDocument();
  });

  it("links to a verified successor and the status page", () => {
    render(
      <ContractMigrationBanner
        status={status({
          phase: "replaced",
          statusPageUrl: "https://status.example.com",
          successor: {
            contractId: OTHER_CONTRACT_ID,
            verified: true,
            migrationGuideUrl: "https://example.com/migrate",
          },
        })}
      />,
    );
    expect(screen.getByRole("link", { name: /migration guide/i })).toHaveAttribute(
      "href",
      "https://example.com/migrate",
    );
    expect(screen.getByRole("link", { name: /migration status/i })).toHaveAttribute(
      "href",
      "https://status.example.com",
    );
  });

  it("warns that the status may be stale while offline", async () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    render(<ContractMigrationBanner status={status({ phase: "migrating" })} />);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(await screen.findByText(/you are offline/i)).toBeInTheDocument();
  });
});

describe("ContractMigrationActionGate", () => {
  it("renders children while writes are allowed", () => {
    render(
      <ContractMigrationActionGate capability="write" status={status({ phase: "preparing" })}>
        <button type="button">Issue credential</button>
      </ContractMigrationActionGate>,
    );
    expect(screen.getByRole("button", { name: /issue credential/i })).toBeInTheDocument();
  });

  it("gates a write action from migrating onward", () => {
    render(
      <ContractMigrationActionGate capability="write" status={status({ phase: "migrating" })}>
        <button type="button">Issue credential</button>
      </ContractMigrationActionGate>,
    );
    expect(screen.queryByRole("button", { name: /issue credential/i })).toBeNull();
    expect(screen.getByText(/changes are temporarily disabled/i)).toBeInTheDocument();
  });

  it("keeps read-only actions available during migration", () => {
    render(
      <ContractMigrationActionGate capability="read" status={status({ phase: "replaced" })}>
        <span>Proof history</span>
      </ContractMigrationActionGate>,
    );
    expect(screen.getByText("Proof history")).toBeInTheDocument();
  });
});
