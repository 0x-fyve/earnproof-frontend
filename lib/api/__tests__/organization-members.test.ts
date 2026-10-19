/**
 * @jest-environment jsdom
 */

import {
  formatOrganizationRole,
  isOrganizationMemberRole,
  validateWalletAddressForInvite,
  deriveMemberCapabilities,
  type OrganizationMember,
} from "../organization-members";

function member(overrides: Partial<OrganizationMember> = {}): OrganizationMember {
  return {
    id: "member-1",
    userId: "user-1",
    organizationId: "org-1",
    walletAddress: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW",
    role: "MEMBER",
    status: "ACTIVE",
    ...overrides,
  };
}

describe("Organization Members Utilities", () => {
  describe("formatOrganizationRole", () => {
    it("formats known roles", () => {
      expect(formatOrganizationRole("OWNER")).toBe("Owner");
      expect(formatOrganizationRole("ADMIN")).toBe("Admin");
      expect(formatOrganizationRole("MEMBER")).toBe("Member");
    });

    it("returns original value for unknown role", () => {
      expect(
        formatOrganizationRole("UNKNOWN" as unknown as Parameters<typeof formatOrganizationRole>[0])
      ).toBe("UNKNOWN");
    });
  });

  describe("isOrganizationMemberRole", () => {
    it("accepts every real member role", () => {
      expect(isOrganizationMemberRole("OWNER")).toBe(true);
      expect(isOrganizationMemberRole("ADMIN")).toBe(true);
      expect(isOrganizationMemberRole("MEMBER")).toBe(true);
    });

    it("rejects a policy-only role not assignable to a member", () => {
      expect(isOrganizationMemberRole("VIEWER")).toBe(false);
    });

    it("rejects an arbitrary string", () => {
      expect(isOrganizationMemberRole("NOT_A_ROLE")).toBe(false);
    });
  });

  describe("validateWalletAddressForInvite", () => {
    it("accepts a valid Stellar public key", () => {
      expect(
        validateWalletAddressForInvite("GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW")
      ).toBeNull();
    });

    it("requires a non-empty value", () => {
      expect(validateWalletAddressForInvite("")).toBe("Wallet address is required");
      expect(validateWalletAddressForInvite("   ")).toBe("Wallet address is required");
    });

    it("rejects addresses that don't start with G", () => {
      expect(
        validateWalletAddressForInvite("SABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW")
      ).toBe("Enter a valid Stellar public key (starts with G, 56 characters)");
    });

    it("rejects addresses of the wrong length", () => {
      expect(validateWalletAddressForInvite("GSHORT")).toBe(
        "Enter a valid Stellar public key (starts with G, 56 characters)"
      );
    });

    it("rejects lowercase or non-base32 characters", () => {
      expect(
        validateWalletAddressForInvite("Gabcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvw")
      ).toBe("Enter a valid Stellar public key (starts with G, 56 characters)");
    });
  });

  describe("deriveMemberCapabilities", () => {
    it("denies all actions to a non-admin, non-owner viewer", () => {
      const target = member({ id: "m1", role: "MEMBER" });
      const capabilities = deriveMemberCapabilities(target, [target], "MEMBER");
      expect(capabilities).toEqual({ canChangeRole: false, canRemove: false });
    });

    it("denies all actions when the viewer has no role in the organization", () => {
      const target = member({ id: "m1", role: "MEMBER" });
      const capabilities = deriveMemberCapabilities(target, [target], null);
      expect(capabilities).toEqual({ canChangeRole: false, canRemove: false });
    });

    it("allows an owner to change and remove a regular member", () => {
      const owner = member({ id: "owner", role: "OWNER" });
      const target = member({ id: "m1", role: "MEMBER" });
      const capabilities = deriveMemberCapabilities(target, [owner, target], "OWNER");
      expect(capabilities).toEqual({ canChangeRole: true, canRemove: true });
    });

    it("allows an admin to change and remove a regular member", () => {
      const owner = member({ id: "owner", role: "OWNER" });
      const target = member({ id: "m1", role: "MEMBER" });
      const capabilities = deriveMemberCapabilities(target, [owner, target], "ADMIN");
      expect(capabilities).toEqual({ canChangeRole: true, canRemove: true });
    });

    it("blocks demoting or removing the last owner, even by that owner", () => {
      const soleOwner = member({ id: "owner", role: "OWNER" });
      const capabilities = deriveMemberCapabilities(soleOwner, [soleOwner], "OWNER");
      expect(capabilities).toEqual({ canChangeRole: false, canRemove: false });
    });

    it("allows managing an owner when there is more than one owner", () => {
      const ownerA = member({ id: "owner-a", role: "OWNER" });
      const ownerB = member({ id: "owner-b", role: "OWNER" });
      const capabilities = deriveMemberCapabilities(ownerA, [ownerA, ownerB], "OWNER");
      expect(capabilities).toEqual({ canChangeRole: true, canRemove: true });
    });

    it("blocks an admin from changing or removing an owner", () => {
      const ownerA = member({ id: "owner-a", role: "OWNER" });
      const ownerB = member({ id: "owner-b", role: "OWNER" });
      const capabilities = deriveMemberCapabilities(ownerA, [ownerA, ownerB], "ADMIN");
      expect(capabilities).toEqual({ canChangeRole: false, canRemove: false });
    });
  });
});
