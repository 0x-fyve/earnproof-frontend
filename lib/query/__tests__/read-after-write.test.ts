import { ReadAfterWriteCoordinator } from "../read-after-write";
import { ConsistencyTokenError } from "@/lib/api/consistency";

const ORG_A = "org-alpha";
const ORG_B = "org-beta";

describe("Read-after-write consistency coordinator (#256)", () => {
  let coordinator: ReadAfterWriteCoordinator;
  const baseNow = 1_700_000_000_000;

  beforeEach(() => {
    coordinator = new ReadAfterWriteCoordinator();
  });

  describe("replica lag and stale read protection", () => {
    it("prevents a stale replica read from overwriting confirmed local results", () => {
      // 1. Initial confirmed state v1
      coordinator.reconcileReadResponse({
        viewerOrganizationId: ORG_A,
        organizationId: ORG_A,
        resourceType: "policy",
        resourceId: "p1",
        incomingData: { name: "Original Policy v1" },
        incomingVersion: 1,
        nowMs: baseNow,
      });

      // 2. Mutation confirmed with token for v2
      coordinator.recordConfirmedMutation({
        viewerOrganizationId: ORG_A,
        expectedResourceType: "policy",
        expectedResourceId: "p1",
        confirmedData: { name: "Updated Policy v2" },
        tokenCandidate: {
          token: "tok-v2",
          organizationId: ORG_A,
          resourceType: "policy",
          resourceId: "p1",
          expectedVersion: 2,
          issuedAt: new Date(baseNow + 1000).toISOString(),
          expiresAt: new Date(baseNow + 15_000).toISOString(),
        },
        nowMs: baseNow + 1000,
      });

      // State is in pending-propagation
      const pendingState = coordinator.getResourceState({
        viewerOrganizationId: ORG_A,
        organizationId: ORG_A,
        resourceType: "policy",
        resourceId: "p1",
      });
      expect(pendingState?.status).toBe("pending-propagation");
      expect((pendingState?.data as { name: string }).name).toBe(
        "Updated Policy v2",
      );

      // 3. Lagging replica returns stale v1 response
      const staleReconcile = coordinator.reconcileReadResponse({
        viewerOrganizationId: ORG_A,
        organizationId: ORG_A,
        resourceType: "policy",
        resourceId: "p1",
        incomingData: { name: "Stale Replica Data v1" },
        incomingVersion: 1,
        requestSeq: 2,
        nowMs: baseNow + 2000,
      });

      expect(staleReconcile.acceptedRead).toBe(false);
      expect(staleReconcile.staleReadIgnored).toBe(true);
      // Confirmed data is preserved!
      expect((staleReconcile.state.data as { name: string }).name).toBe(
        "Updated Policy v2",
      );
      // Indicator has NOT cleared because expected version is 2
      expect(staleReconcile.state.status).toBe("pending-propagation");
    });

    it("clears the indicator ONLY when expected resource version is observed", () => {
      coordinator.recordConfirmedMutation({
        viewerOrganizationId: ORG_A,
        expectedResourceType: "policy",
        expectedResourceId: "p1",
        confirmedData: { name: "Updated Policy v2" },
        tokenCandidate: {
          token: "tok-v2",
          organizationId: ORG_A,
          resourceType: "policy",
          resourceId: "p1",
          expectedVersion: 2,
          issuedAt: new Date(baseNow).toISOString(),
          expiresAt: new Date(baseNow + 15_000).toISOString(),
        },
        nowMs: baseNow,
      });

      // Replica catches up and returns v2
      const caughtUp = coordinator.reconcileReadResponse({
        viewerOrganizationId: ORG_A,
        organizationId: ORG_A,
        resourceType: "policy",
        resourceId: "p1",
        incomingData: { name: "Replica Confirmed v2" },
        incomingVersion: 2,
        nowMs: baseNow + 3000,
      });

      expect(caughtUp.acceptedRead).toBe(true);
      expect(caughtUp.staleReadIgnored).toBe(false);
      expect(caughtUp.state.status).toBe("consistent"); // cleared!
      expect((caughtUp.state.data as { name: string }).name).toBe(
        "Replica Confirmed v2",
      );
    });
  });

  describe("out-of-order response handling", () => {
    it("drops out-of-order responses with lower request sequences", () => {
      // Fast request seq 10 arrives first with v3
      coordinator.reconcileReadResponse({
        viewerOrganizationId: ORG_A,
        organizationId: ORG_A,
        resourceType: "policy",
        resourceId: "p1",
        incomingData: { name: "Fast newer response" },
        incomingVersion: 3,
        requestSeq: 10,
        nowMs: baseNow,
      });

      // Slow in-flight request seq 5 arrives later with v2
      const slowResult = coordinator.reconcileReadResponse({
        viewerOrganizationId: ORG_A,
        organizationId: ORG_A,
        resourceType: "policy",
        resourceId: "p1",
        incomingData: { name: "Slow older response" },
        incomingVersion: 2,
        requestSeq: 5,
        nowMs: baseNow + 1000,
      });

      expect(slowResult.acceptedRead).toBe(false);
      expect(slowResult.outOfOrderDropped).toBe(true);
      expect((slowResult.state.data as { name: string }).name).toBe(
        "Fast newer response",
      );
    });
  });

  describe("optimistic update rollback", () => {
    it("rolls back optimistic data cleanly on mutation error", () => {
      coordinator.beginOptimisticMutation({
        organizationId: ORG_A,
        resourceType: "policy",
        resourceId: "p1",
        previousData: { name: "Previous stable name" },
        previousVersion: 1,
        optimisticData: { name: "Optimistic speculative name" },
        nowMs: baseNow,
      });

      const beforeRollback = coordinator.getResourceState({
        viewerOrganizationId: ORG_A,
        organizationId: ORG_A,
        resourceType: "policy",
        resourceId: "p1",
      });
      expect(beforeRollback?.status).toBe("optimistic-pending");
      expect((beforeRollback?.data as { name: string }).name).toBe(
        "Optimistic speculative name",
      );

      // Server returns error -> rollback
      const rolledBack = coordinator.rollbackOptimisticMutation({
        organizationId: ORG_A,
        resourceType: "policy",
        resourceId: "p1",
        nowMs: baseNow + 1000,
      });

      expect(rolledBack?.status).toBe("idle");
      expect((rolledBack?.data as { name: string }).name).toBe(
        "Previous stable name",
      );
      expect(rolledBack?.expectedVersion).toBe(1);
    });
  });

  describe("timeout and consistency window expiry", () => {
    it("transitions pending-propagation to expired when window elapses without clearing confirmed data", () => {
      const windowMs = 5000;
      coordinator.recordConfirmedMutation({
        viewerOrganizationId: ORG_A,
        expectedResourceType: "policy",
        expectedResourceId: "p1",
        confirmedData: { name: "Updated Policy v2" },
        tokenCandidate: {
          token: "tok-expire",
          organizationId: ORG_A,
          resourceType: "policy",
          resourceId: "p1",
          expectedVersion: 2,
          issuedAt: new Date(baseNow).toISOString(),
          expiresAt: new Date(baseNow + windowMs).toISOString(),
        },
        nowMs: baseNow,
      });

      const expired = coordinator.evaluateWindowExpiry({
        organizationId: ORG_A,
        resourceType: "policy",
        resourceId: "p1",
        nowMs: baseNow + windowMs + 1000,
      });

      expect(expired?.status).toBe("expired");
      // Local confirmed data is still preserved
      expect((expired?.data as { name: string }).name).toBe("Updated Policy v2");
    });
  });

  describe("route changes and cross-tenant protection", () => {
    it("cleans up unconfirmed optimistic mutations on route change", () => {
      coordinator.beginOptimisticMutation({
        organizationId: ORG_A,
        resourceType: "policy",
        resourceId: "p1",
        previousData: { name: "Original" },
        previousVersion: 1,
        optimisticData: { name: "Optimistic" },
        routePathname: "/settings/policies",
      });

      // User navigates away to /settings/security
      coordinator.handleRouteChange("/settings/security", ORG_A);

      const state = coordinator.getResourceState({
        viewerOrganizationId: ORG_A,
        organizationId: ORG_A,
        resourceType: "policy",
        resourceId: "p1",
      });

      expect(state?.status).toBe("idle");
      expect((state?.data as { name: string }).name).toBe("Original");
    });

    it("throws ConsistencyTokenError when accessing another tenant's state", () => {
      expect(() =>
        coordinator.getResourceState({
          viewerOrganizationId: ORG_A,
          organizationId: ORG_B,
          resourceType: "policy",
          resourceId: "p1",
        }),
      ).toThrow(ConsistencyTokenError);
    });
  });
});
