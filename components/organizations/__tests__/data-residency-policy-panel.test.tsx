import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  defaultDataResidencyPolicy,
  type DataResidencyPolicy,
} from "@/lib/api/organization-data-residency";
import { DataResidencyPolicyPanel } from "../data-residency-policy-panel";

function policy(overrides: Partial<DataResidencyPolicy> = {}): DataResidencyPolicy {
  return { ...defaultDataResidencyPolicy(), ...overrides };
}

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof DataResidencyPolicyPanel>> = {},
) {
  return render(
    <DataResidencyPolicyPanel
      initialPolicy={policy()}
      organizationId="org-1"
      viewerRole="OWNER"
      {...overrides}
    />,
  );
}

describe("DataResidencyPolicyPanel", () => {
  it("renders a read-only view for non-managers", () => {
    renderPanel({ viewerRole: "VIEWER" });
    expect(screen.getByText(/read-only access to this policy/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save policy/i })).toBeNull();
    expect(screen.getByLabelText("proofs in us-east")).toBeDisabled();
  });

  it("reports the default policy as compliant", () => {
    renderPanel();
    expect(screen.getByTestId("compliance-status")).toHaveTextContent("Compliant");
  });

  it("does not imply compliance while a migration is in progress", () => {
    renderPanel({
      initialPolicy: policy({
        migration: { ...policy().migration, proofs: "in-progress" },
      }),
    });
    const status = screen.getByTestId("compliance-status");
    expect(status).toHaveTextContent("Not yet compliant");
    expect(status).toHaveTextContent(/proofs migration is in-progress/i);
  });

  it("disables regions that cannot store a data class", () => {
    renderPanel();
    // personal-data is not supported in us-west.
    expect(screen.getByLabelText("personal-data in us-west")).toBeDisabled();
    // ap-northeast is deprecated.
    expect(screen.getByLabelText("proofs in ap-northeast")).toBeDisabled();
    // a supported combination stays enabled.
    expect(screen.getByLabelText("payment-records in eu-west")).toBeEnabled();
  });

  it("previews the impact of adding a region", () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText("backups in eu-west"));
    expect(
      screen.getByText(/eu-west will additionally store backups/i),
    ).toBeInTheDocument();
  });

  it("blocks saving when a data class has no region", () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText("backups in us-west"));
    expect(screen.getByText(/select at least one region for backups/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save policy/i })).toBeDisabled();
  });

  it("shows a migration blocker while a class is still migrating", () => {
    renderPanel({
      initialPolicy: policy({
        migration: { ...policy().migration, proofs: "in-progress" },
      }),
    });
    fireEvent.click(screen.getByLabelText("proofs in eu-west"));
    expect(screen.getByTestId("migration-blockers")).toHaveTextContent(
      /cannot change proofs placement/i,
    );
  });

  it("saves a valid change, increments the version and re-pends validation", () => {
    const onSaved = jest.fn();
    renderPanel({ onSaved });

    fireEvent.click(screen.getByLabelText("proofs in us-west"));
    fireEvent.click(screen.getByRole("button", { name: /save policy/i }));

    expect(screen.getByRole("status")).toHaveTextContent(/saved residency policy version 2/i);
    expect(screen.getByTestId("residency-version")).toHaveTextContent("Version 2");
    // A saved policy is not compliant until the server re-validates it.
    expect(screen.getByTestId("compliance-status")).toHaveTextContent("Not yet compliant");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("compares an earlier version and rolls back to it", () => {
    const earlier = policy({ policyVersion: 1, backgroundJobRegion: "eu-west" });
    renderPanel({
      initialPolicy: policy({ policyVersion: 3, backgroundJobRegion: "us-east" }),
      initialHistory: [earlier],
    });

    fireEvent.change(screen.getByLabelText(/compare with current version/i), {
      target: { value: "1" },
    });
    expect(screen.getByText(/backgroundJobRegion/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /roll back to version 1/i }));
    expect(screen.getByLabelText(/background job region/i)).toHaveValue("eu-west");
  });
});
