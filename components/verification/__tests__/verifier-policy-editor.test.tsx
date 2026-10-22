/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VerifierPolicyEditor } from "../verifier-policy-editor";
import { getIssuers } from "@/lib/api/issuers";
import { storeSession, clearStoredSession } from "@/lib/session";
import type { Issuer } from "@/lib/api/generated/v1";

jest.mock("@/lib/api/issuers", () => ({
  ...jest.requireActual("@/lib/api/issuers"),
  getIssuers: jest.fn(),
}));

const mockGetIssuers = getIssuers as jest.MockedFunction<typeof getIssuers>;

const activeIssuer: Issuer = { id: "issuer-1", name: "Trusted Issuer Co", status: "ACTIVE" };

function setSession() {
  storeSession({
    token: "token-123",
    user: {
      id: "u1",
      walletAddress: "GAAA000000000000000000000000000000000000000000000000AAAA",
      walletHash: "hash1",
      role: "VERIFIER" as never,
    },
  });
}

beforeEach(() => {
  window.localStorage.clear();
  clearStoredSession();
  jest.clearAllMocks();
  mockGetIssuers.mockResolvedValue([activeIssuer]);
});

describe("VerifierPolicyEditor — authentication", () => {
  it("prompts for authentication when there is no session", () => {
    render(<VerifierPolicyEditor />);
    expect(screen.getByText("Authentication Required")).toBeInTheDocument();
  });
});

describe("VerifierPolicyEditor — create, duplicate, archive", () => {
  it("creates a new profile from the form", async () => {
    setSession();
    render(<VerifierPolicyEditor />);

    fireEvent.click(screen.getByRole("button", { name: "New profile" }));
    await waitFor(() => expect(screen.getByText("Trusted Issuer Co")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Strict profile" } });
    fireEvent.click(screen.getByLabelText(/Trusted Issuer Co/));
    fireEvent.change(screen.getByLabelText(/Accepted schema versions/), {
      target: { value: "1.0" },
    });
    fireEvent.change(screen.getByLabelText(/Accepted proof types/), {
      target: { value: "minimum_income" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByTestId(/policy-profile-/)).toBeInTheDocument());
    expect(screen.getByText("Strict profile")).toBeInTheDocument();
  });

  it("shows a validation error and does not save when required fields are missing", async () => {
    setSession();
    render(<VerifierPolicyEditor />);

    fireEvent.click(screen.getByRole("button", { name: "New profile" }));
    await waitFor(() => expect(screen.getByText("Trusted Issuer Co")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Incomplete" } });
    // No issuer checked, no schema version, no proof type.
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText("Incomplete")).not.toBeInTheDocument();
  });

  it("duplicates a profile as an independent copy", async () => {
    setSession();
    render(<VerifierPolicyEditor />);

    fireEvent.click(screen.getByRole("button", { name: "New profile" }));
    await waitFor(() => expect(screen.getByText("Trusted Issuer Co")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Original" } });
    fireEvent.click(screen.getByLabelText(/Trusted Issuer Co/));
    fireEvent.change(screen.getByLabelText(/Accepted schema versions/), {
      target: { value: "1.0" },
    });
    fireEvent.change(screen.getByLabelText(/Accepted proof types/), {
      target: { value: "minimum_income" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("Original")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));

    await waitFor(() => expect(screen.getByText("Original (Copy)")).toBeInTheDocument());
    expect(screen.getByText("Original")).toBeInTheDocument();
  });

  it("archiving a profile removes its Edit button and marks it Archived; it can be reactivated", async () => {
    setSession();
    render(<VerifierPolicyEditor />);

    fireEvent.click(screen.getByRole("button", { name: "New profile" }));
    await waitFor(() => expect(screen.getByText("Trusted Issuer Co")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "To be archived" } });
    fireEvent.click(screen.getByLabelText(/Trusted Issuer Co/));
    fireEvent.change(screen.getByLabelText(/Accepted schema versions/), {
      target: { value: "1.0" },
    });
    fireEvent.change(screen.getByLabelText(/Accepted proof types/), {
      target: { value: "minimum_income" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("To be archived")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(screen.getByText("Archived")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reactivate" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument());
  });
});

describe("VerifierPolicyEditor — stale server metadata", () => {
  it("flags an accepted issuer that has since become inactive on the server", async () => {
    setSession();
    mockGetIssuers.mockResolvedValue([{ id: "issuer-1", name: "Now Revoked", status: "REVOKED" }]);

    render(<VerifierPolicyEditor />);

    fireEvent.click(screen.getByRole("button", { name: "New profile" }));
    await waitFor(() => expect(screen.getByText("Now Revoked")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Stale profile" } });
    fireEvent.click(screen.getByLabelText(/Now Revoked/));
    fireEvent.change(screen.getByLabelText(/Accepted schema versions/), {
      target: { value: "1.0" },
    });
    fireEvent.change(screen.getByLabelText(/Accepted proof types/), {
      target: { value: "minimum_income" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByText(/no longer active on the server/)).toBeInTheDocument(),
    );
  });
});

describe("VerifierPolicyEditor — evaluation preview", () => {
  it("previews the profile against representative verification results", async () => {
    setSession();
    render(<VerifierPolicyEditor />);

    fireEvent.click(screen.getByRole("button", { name: "New profile" }));
    await waitFor(() => expect(screen.getByText("Trusted Issuer Co")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Preview profile" } });
    fireEvent.click(screen.getByLabelText(/Trusted Issuer Co/));
    fireEvent.change(screen.getByLabelText(/Accepted schema versions/), {
      target: { value: "1.0" },
    });
    fireEvent.change(screen.getByLabelText(/Accepted proof types/), {
      target: { value: "minimum_income" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("Preview profile")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() =>
      expect(screen.getByText(/Preview against representative verification results/)).toBeInTheDocument(),
    );
    // Sample results include at least one accepted and one rejected case
    // for this profile's "issuer-1" (which does not match "issuer-known"
    // used by the fixtures), demonstrating both outcomes render.
    expect(screen.getByText(/Cryptographically invalid \(revoked\): Rejected/)).toBeInTheDocument();
  });
});
