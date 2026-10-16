import { appConfig } from "@/config/app";
import {
  CONTRACT_MIGRATION_SCHEMA_VERSION,
  canPerform,
  fetchMockContractMigrationStatus,
  isReadOnlyPhase,
  isSafeSuccessorUrl,
  isSuccessorTrusted,
  isSupportedMigrationStatus,
  isValidContractId,
  migrationBannerCopy,
  migrationGateReason,
  resolveStatusPageLink,
  resolveSuccessorGuideLink,
  type ContractMigrationStatus,
} from "../contract-migration";

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

describe("contract-migration: contract ID + URL validation", () => {
  it("accepts a well-formed Stellar contract ID", () => {
    expect(isValidContractId(VALID_CONTRACT_ID)).toBe(true);
  });

  it("rejects malformed contract IDs", () => {
    expect(isValidContractId("")).toBe(false);
    expect(isValidContractId("C123")).toBe(false);
    expect(isValidContractId(`G${"A".repeat(55)}`)).toBe(false);
    // "0"/"1"/"8"/"9" are not in the base32 alphabet.
    expect(isValidContractId(`C${"0".repeat(55)}`)).toBe(false);
    expect(isValidContractId(null)).toBe(false);
  });

  it("only accepts absolute HTTPS successor URLs without credentials", () => {
    expect(isSafeSuccessorUrl("https://example.com/migrate")).toBe(true);
    expect(isSafeSuccessorUrl("http://example.com/migrate")).toBe(false);
    expect(isSafeSuccessorUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeSuccessorUrl("https://user:pass@example.com")).toBe(false);
    expect(isSafeSuccessorUrl("not a url")).toBe(false);
    expect(isSafeSuccessorUrl(undefined)).toBe(false);
  });
});

describe("contract-migration: successor identity checks", () => {
  it("trusts only a verified, valid, distinct successor", () => {
    expect(
      isSuccessorTrusted(
        status({
          phase: "replaced",
          successor: {
            contractId: OTHER_CONTRACT_ID,
            verified: true,
            migrationGuideUrl: "https://example.com/migrate",
          },
        }),
      ),
    ).toBe(true);
  });

  it("does not trust an unverified successor", () => {
    expect(
      isSuccessorTrusted(
        status({
          phase: "replaced",
          successor: { contractId: OTHER_CONTRACT_ID, verified: false },
        }),
      ),
    ).toBe(false);
  });

  it("does not trust a successor with an invalid contract ID", () => {
    expect(
      isSuccessorTrusted(
        status({
          phase: "replaced",
          successor: { contractId: "not-a-contract", verified: true },
        }),
      ),
    ).toBe(false);
  });

  it("does not trust the current contract listed as its own successor", () => {
    expect(
      isSuccessorTrusted(
        status({
          phase: "replaced",
          successor: { contractId: VALID_CONTRACT_ID, verified: true },
        }),
      ),
    ).toBe(false);
  });
});

describe("contract-migration: link resolution", () => {
  it("never resolves a successor guide link for an unverified successor", () => {
    const result = resolveSuccessorGuideLink(
      status({
        phase: "replaced",
        successor: {
          contractId: OTHER_CONTRACT_ID,
          verified: false,
          migrationGuideUrl: "https://example.com/migrate",
        },
      }),
    );
    expect(result).toBeNull();
  });

  it("resolves a verified successor guide link", () => {
    const result = resolveSuccessorGuideLink(
      status({
        phase: "replaced",
        successor: {
          contractId: OTHER_CONTRACT_ID,
          verified: true,
          migrationGuideUrl: "https://example.com/migrate",
        },
      }),
    );
    expect(result).toEqual({
      href: "https://example.com/migrate",
      label: "Migration guide",
    });
  });

  it("rejects an unsafe successor guide URL even when verified", () => {
    const result = resolveSuccessorGuideLink(
      status({
        phase: "replaced",
        successor: {
          contractId: OTHER_CONTRACT_ID,
          verified: true,
          migrationGuideUrl: "javascript:alert(1)",
        },
      }),
    );
    expect(result).toBeNull();
  });

  it("resolves a status-page link independently of successor trust", () => {
    const result = resolveStatusPageLink(
      status({ phase: "migrating", statusPageUrl: "https://status.example.com" }),
    );
    expect(result).toEqual({
      href: "https://status.example.com",
      label: "Migration status",
    });
  });
});

describe("contract-migration: capability gating", () => {
  it("does not gate anything when there is no status", () => {
    expect(canPerform(null, "read")).toBe(true);
    expect(canPerform(null, "write")).toBe(true);
  });

  it("allows reads and writes while stable", () => {
    expect(canPerform(status(), "read")).toBe(true);
    expect(canPerform(status(), "write")).toBe(true);
  });

  it("allows writes while preparing", () => {
    expect(canPerform(status({ phase: "preparing" }), "read")).toBe(true);
    expect(canPerform(status({ phase: "preparing" }), "write")).toBe(true);
  });

  it("preserves reads but blocks writes from migrating onward", () => {
    for (const phase of ["migrating", "decommissioned", "replaced"] as const) {
      expect(canPerform(status({ phase }), "read")).toBe(true);
      expect(canPerform(status({ phase }), "write")).toBe(false);
    }
  });

  it("fails closed for writes on an unsupported schema version", () => {
    const unsupported = { ...status(), schemaVersion: 999 };
    expect(canPerform(unsupported, "read")).toBe(true);
    expect(canPerform(unsupported, "write")).toBe(false);
  });

  it("fails closed for writes when the status is for a different network", () => {
    const otherNetwork = status({ network: "futurenet", phase: "stable" });
    expect(canPerform(otherNetwork, "read")).toBe(true);
    expect(canPerform(otherNetwork, "write")).toBe(false);
  });

  it("treats only migrating/decommissioned/replaced as read-only", () => {
    expect(isReadOnlyPhase("stable")).toBe(false);
    expect(isReadOnlyPhase("preparing")).toBe(false);
    expect(isReadOnlyPhase("migrating")).toBe(true);
    expect(isReadOnlyPhase("decommissioned")).toBe(true);
    expect(isReadOnlyPhase("replaced")).toBe(true);
  });

  it("explains why writes are gated, and stays silent when they are not", () => {
    expect(migrationGateReason(status({ phase: "stable" }))).toBeNull();
    expect(migrationGateReason(status({ phase: "migrating" }))).toMatch(/migrating/i);
  });
});

describe("contract-migration: banner copy", () => {
  it("renders nothing for a stable contract", () => {
    expect(migrationBannerCopy(status())).toBeNull();
  });

  it("renders nothing for an unsupported or wrong-network document", () => {
    expect(migrationBannerCopy({ ...status(), schemaVersion: 999 })).toBeNull();
    expect(migrationBannerCopy(status({ network: "futurenet" }))).toBeNull();
  });

  it("announces the preparing phase without claiming read-only", () => {
    const copy = migrationBannerCopy(status({ phase: "preparing" }));
    expect(copy?.tone).toBe("warning");
    expect(copy?.readOnly).toBe(false);
  });

  it("marks migrating as read-only and replaced as danger", () => {
    expect(migrationBannerCopy(status({ phase: "migrating" }))?.readOnly).toBe(true);
    const replaced = migrationBannerCopy(status({ phase: "replaced" }));
    expect(replaced?.tone).toBe("danger");
    expect(replaced?.readOnly).toBe(true);
  });
});

describe("contract-migration: status validation + fixture", () => {
  it("rejects a malformed status document", () => {
    expect(isSupportedMigrationStatus(null)).toBe(false);
    expect(isSupportedMigrationStatus({ ...status(), phase: "nope" as never })).toBe(false);
  });

  it("defaults the fixture to a stable, current-network status", async () => {
    const fixture = await fetchMockContractMigrationStatus();
    expect(fixture.phase).toBe("stable");
    expect(fixture.network).toBe(appConfig.stellarNetwork);
    expect(fixture.schemaVersion).toBe(CONTRACT_MIGRATION_SCHEMA_VERSION);
  });

  it("honors overrides in the fixture", async () => {
    const fixture = await fetchMockContractMigrationStatus({ phase: "migrating" });
    expect(fixture.phase).toBe("migrating");
  });
});
