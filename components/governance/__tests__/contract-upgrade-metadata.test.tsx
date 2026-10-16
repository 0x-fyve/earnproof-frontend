import { render, screen } from "@testing-library/react";
import { ContractUpgradeMetadataPanel } from "../contract-upgrade-metadata";
import { makeContractUpgradeMetadata } from "@/data/fixtures/contract-upgrades";

describe("ContractUpgradeMetadataPanel", () => {
  it("renders metadata panel with all fields", () => {
    const metadata = makeContractUpgradeMetadata();

    render(<ContractUpgradeMetadataPanel metadata={metadata} />);

    expect(screen.getByText("Upgrade Metadata")).toBeInTheDocument();
    expect(screen.getByText("Contract Address")).toBeInTheDocument();
    expect(screen.getByText("Contract Identity")).toBeInTheDocument();
    expect(screen.getByText("Current Version")).toBeInTheDocument();
    expect(screen.getByText("Proposed Version")).toBeInTheDocument();
  });

  it("displays contract address", () => {
    const metadata = makeContractUpgradeMetadata();
    render(<ContractUpgradeMetadataPanel metadata={metadata} />);

    expect(screen.getByText(metadata.contractAddress)).toBeInTheDocument();
  });

  it("displays version numbers", () => {
    const metadata = makeContractUpgradeMetadata({
      currentVersion: "1.2.3",
      proposedVersion: "1.3.0",
    });
    render(<ContractUpgradeMetadataPanel metadata={metadata} />);

    expect(screen.getByText("1.2.3")).toBeInTheDocument();
    expect(screen.getByText("1.3.0")).toBeInTheDocument();
  });

  it("displays contract identity", () => {
    const metadata = makeContractUpgradeMetadata({
      contractIdentity: "test-contract",
    });
    render(<ContractUpgradeMetadataPanel metadata={metadata} />);

    expect(screen.getByText("test-contract")).toBeInTheDocument();
  });

  it("displays activation window dates", () => {
    const metadata = makeContractUpgradeMetadata();
    render(<ContractUpgradeMetadataPanel metadata={metadata} />);

    expect(screen.getByText("Activation Window")).toBeInTheDocument();
    expect(screen.getByText("Starts")).toBeInTheDocument();
    expect(screen.getByText("Ends")).toBeInTheDocument();
  });

  it("displays description", () => {
    const metadata = makeContractUpgradeMetadata({
      description: "This is a test upgrade description",
    });
    render(<ContractUpgradeMetadataPanel metadata={metadata} />);

    expect(screen.getByText("This is a test upgrade description")).toBeInTheDocument();
  });

  it("displays proposedBy information", () => {
    const metadata = makeContractUpgradeMetadata();
    render(<ContractUpgradeMetadataPanel metadata={metadata} />);

    expect(screen.getByText("Proposed By")).toBeInTheDocument();
  });
});
