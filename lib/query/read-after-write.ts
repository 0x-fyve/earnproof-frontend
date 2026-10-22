/**
 * Read-after-write consistency coordinator and query store (#256).
 *
 * Protects confirmed mutation results from being overwritten by lagging read
 * replicas or out-of-order network responses, tracks bounded propagation
 * windows, supports optimistic mutation rollback on failure, and cleans up
 * route-scoped listeners on navigation.
 *
 * Key invariants:
 * 1. Consistency indicators clear ONLY when a read response for the matching
 *    `(organizationId, resourceType, resourceId)` observes
 *    `observedVersion >= expectedVersion`.
 * 2. Cross-tenant or mismatched-resource tokens are rejected before touching
 *    any local state.
 * 3. Stale reads (`incomingVersion < expectedVersion` or lower than already
 *    observed version, or out-of-order `requestSeq < latestRequestSeq`) NEVER
 *    overwrite confirmed local results.
 * 4. Failed optimistic updates roll back cleanly to the last confirmed snapshot
 *    without leaving a hanging pending-propagation indicator.
 */

import {
  ConsistencyTokenError,
  validateConsistencyToken,
  type ServerConsistencyToken,
} from "@/lib/api/consistency";

export type ConsistencyPropagationStatus =
  | "idle"
  | "optimistic-pending"
  | "pending-propagation"
  | "consistent"
  | "expired";

export interface ResourceConsistencyState<TData = unknown> {
  organizationId: string;
  resourceType: string;
  resourceId: string;
  routePathname: string;
  status: ConsistencyPropagationStatus;
  /** Authoritative local data (optimistic while in-flight, confirmed after write, or replica data once caught up). */
  data: TData;
  /** Snapshot prior to an in-flight optimistic update so rollback can restore it. */
  rollbackSnapshot: {
    data: TData;
    version: number;
  } | null;
  /** Version confirmed by the mutation's consistency token. */
  expectedVersion: number;
  /** Highest version observed from read replicas so far. */
  observedReplicaVersion: number;
  /** Highest request sequence number processed for out-of-order protection. */
  latestRequestSeq: number;
  /** Active consistency token while awaiting replica catch-up or after expiry. */
  consistencyToken: ServerConsistencyToken | null;
  /** Count of stale replica reads ignored while protecting confirmed state. */
  ignoredStaleReadCount: number;
  /** Count of out-of-order responses dropped. */
  droppedOutOfOrderCount: number;
  updatedAt: string;
}

function makeResourceKey(
  organizationId: string,
  resourceType: string,
  resourceId: string,
): string {
  return `${organizationId}::${resourceType}::${resourceId}`;
}

export class ReadAfterWriteCoordinator {
  private readonly records = new Map<string, ResourceConsistencyState<unknown>>();
  private activePathname = "/";

  /**
   * Begins an optimistic mutation, capturing the prior confirmed state so it
   * can be rolled back if the mutation fails.
   */
  beginOptimisticMutation<TData>(params: {
    organizationId: string;
    resourceType: string;
    resourceId: string;
    previousData: TData;
    previousVersion: number;
    optimisticData: TData;
    routePathname?: string;
    nowMs?: number;
  }): ResourceConsistencyState<TData> {
    const key = makeResourceKey(
      params.organizationId,
      params.resourceType,
      params.resourceId,
    );
    const existing = this.records.get(key) as
      | ResourceConsistencyState<TData>
      | undefined;

    const baselineData = existing ? existing.data : params.previousData;
    const baselineVersion = existing
      ? Math.max(existing.expectedVersion, existing.observedReplicaVersion)
      : params.previousVersion;

    const state: ResourceConsistencyState<TData> = {
      organizationId: params.organizationId,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      routePathname: params.routePathname ?? this.activePathname,
      status: "optimistic-pending",
      data: params.optimisticData,
      rollbackSnapshot: {
        data: baselineData,
        version: baselineVersion,
      },
      expectedVersion: baselineVersion,
      observedReplicaVersion: existing?.observedReplicaVersion ?? params.previousVersion,
      latestRequestSeq: existing?.latestRequestSeq ?? 0,
      consistencyToken: existing?.consistencyToken ?? null,
      ignoredStaleReadCount: existing?.ignoredStaleReadCount ?? 0,
      droppedOutOfOrderCount: existing?.droppedOutOfOrderCount ?? 0,
      updatedAt: new Date(params.nowMs ?? Date.now()).toISOString(),
    };

    this.records.set(key, state);
    return state;
  }

  /**
   * Rolls back a failed optimistic mutation to its pre-mutation snapshot and
   * clears any transient optimistic state.
   */
  rollbackOptimisticMutation<TData>(params: {
    organizationId: string;
    resourceType: string;
    resourceId: string;
    nowMs?: number;
  }): ResourceConsistencyState<TData> | null {
    const key = makeResourceKey(
      params.organizationId,
      params.resourceType,
      params.resourceId,
    );
    const existing = this.records.get(key) as
      | ResourceConsistencyState<TData>
      | undefined;

    if (!existing) return null;

    const restoredData = existing.rollbackSnapshot
      ? existing.rollbackSnapshot.data
      : existing.data;
    const restoredVersion = existing.rollbackSnapshot
      ? existing.rollbackSnapshot.version
      : existing.observedReplicaVersion;

    const rolledBack: ResourceConsistencyState<TData> = {
      ...existing,
      status: "idle",
      data: restoredData,
      rollbackSnapshot: null,
      expectedVersion: restoredVersion,
      observedReplicaVersion: restoredVersion,
      consistencyToken: null,
      updatedAt: new Date(params.nowMs ?? Date.now()).toISOString(),
    };

    this.records.set(key, rolledBack);
    return rolledBack;
  }

  /**
   * Records a server-confirmed mutation and starts a bounded read-after-write
   * consistency fence using the server's consistency token.
   *
   * Throws `ConsistencyTokenError` if the token belongs to another tenant or
   * a mismatched resource.
   */
  recordConfirmedMutation<TData>(params: {
    viewerOrganizationId: string;
    expectedResourceType: string;
    expectedResourceId: string;
    confirmedData: TData;
    tokenCandidate: unknown;
    routePathname?: string;
    nowMs?: number;
  }): ResourceConsistencyState<TData> {
    const nowMs = params.nowMs ?? Date.now();
    const validation = validateConsistencyToken(params.tokenCandidate, {
      viewerOrganizationId: params.viewerOrganizationId,
      expectedResourceType: params.expectedResourceType,
      expectedResourceId: params.expectedResourceId,
      nowMs,
    });

    if (!validation.ok) {
      throw new ConsistencyTokenError(validation.reason, validation.message);
    }

    const token = validation.token;
    const key = makeResourceKey(
      token.organizationId,
      token.resourceType,
      token.resourceId,
    );
    const existing = this.records.get(key) as
      | ResourceConsistencyState<TData>
      | undefined;

    const observedSoFar = existing?.observedReplicaVersion ?? 0;
    const isAlreadyCaughtUp = observedSoFar >= token.expectedVersion;

    const nextState: ResourceConsistencyState<TData> = {
      organizationId: token.organizationId,
      resourceType: token.resourceType,
      resourceId: token.resourceId,
      routePathname: params.routePathname ?? existing?.routePathname ?? this.activePathname,
      status: isAlreadyCaughtUp ? "consistent" : "pending-propagation",
      data: params.confirmedData,
      rollbackSnapshot: null,
      expectedVersion: token.expectedVersion,
      observedReplicaVersion: observedSoFar,
      latestRequestSeq: existing?.latestRequestSeq ?? 0,
      consistencyToken: isAlreadyCaughtUp ? null : token,
      ignoredStaleReadCount: existing?.ignoredStaleReadCount ?? 0,
      droppedOutOfOrderCount: existing?.droppedOutOfOrderCount ?? 0,
      updatedAt: new Date(nowMs).toISOString(),
    };

    this.records.set(key, nextState);
    return nextState;
  }

  /**
   * Reconciles a read response against the active consistency fence.
   *
   * - Rejects cross-tenant reads.
   * - Drops out-of-order responses (`requestSeq < latestRequestSeq`).
   * - Prevents stale replica reads (`incomingVersion < expectedVersion`) from
   *   overwriting confirmed local results, keeping the indicator in
   *   `pending-propagation` (or `expired` if the window elapsed).
   * - Clears the indicator (`status = "consistent"`) ONLY when
   *   `incomingVersion >= expectedVersion`.
   */
  reconcileReadResponse<TData>(params: {
    viewerOrganizationId: string;
    organizationId: string;
    resourceType: string;
    resourceId: string;
    incomingData: TData;
    incomingVersion: number;
    requestSeq?: number;
    nowMs?: number;
  }): {
    state: ResourceConsistencyState<TData>;
    acceptedRead: boolean;
    staleReadIgnored: boolean;
    outOfOrderDropped: boolean;
  } {
    if (
      !params.viewerOrganizationId ||
      params.organizationId !== params.viewerOrganizationId
    ) {
      throw new ConsistencyTokenError(
        "cross-tenant-token",
        "Cannot reconcile read response for a different tenant.",
      );
    }

    const nowMs = params.nowMs ?? Date.now();
    const key = makeResourceKey(
      params.organizationId,
      params.resourceType,
      params.resourceId,
    );
    const existing = this.records.get(key) as
      | ResourceConsistencyState<TData>
      | undefined;

    if (!existing) {
      const initial: ResourceConsistencyState<TData> = {
        organizationId: params.organizationId,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        routePathname: this.activePathname,
        status: "consistent",
        data: params.incomingData,
        rollbackSnapshot: null,
        expectedVersion: params.incomingVersion,
        observedReplicaVersion: params.incomingVersion,
        latestRequestSeq: params.requestSeq ?? 1,
        consistencyToken: null,
        ignoredStaleReadCount: 0,
        droppedOutOfOrderCount: 0,
        updatedAt: new Date(nowMs).toISOString(),
      };
      this.records.set(key, initial);
      return {
        state: initial,
        acceptedRead: true,
        staleReadIgnored: false,
        outOfOrderDropped: false,
      };
    }

    // 1. Out-of-order request sequence check
    if (
      params.requestSeq !== undefined &&
      params.requestSeq < existing.latestRequestSeq
    ) {
      const updated: ResourceConsistencyState<TData> = {
        ...existing,
        droppedOutOfOrderCount: existing.droppedOutOfOrderCount + 1,
      };
      this.records.set(key, updated);
      return {
        state: updated,
        acceptedRead: false,
        staleReadIgnored: false,
        outOfOrderDropped: true,
      };
    }

    const nextSeq =
      params.requestSeq !== undefined
        ? Math.max(existing.latestRequestSeq, params.requestSeq)
        : existing.latestRequestSeq + 1;

    // 2. Out-of-order older version arriving after a newer replica version was already observed
    if (params.incomingVersion < existing.observedReplicaVersion) {
      const updated: ResourceConsistencyState<TData> = {
        ...existing,
        latestRequestSeq: nextSeq,
        droppedOutOfOrderCount: existing.droppedOutOfOrderCount + 1,
      };
      this.records.set(key, updated);
      return {
        state: updated,
        acceptedRead: false,
        staleReadIgnored: true,
        outOfOrderDropped: true,
      };
    }

    // 3. Stale replica lag check against confirmed mutation fence
    if (params.incomingVersion < existing.expectedVersion) {
      const isExpired =
        existing.consistencyToken !== null &&
        nowMs >= new Date(existing.consistencyToken.expiresAt).getTime();

      const updated: ResourceConsistencyState<TData> = {
        ...existing,
        status: isExpired ? "expired" : "pending-propagation",
        // Keep confirmed local data; never overwrite with stale replica data!
        data: existing.data,
        observedReplicaVersion: Math.max(
          existing.observedReplicaVersion,
          params.incomingVersion,
        ),
        latestRequestSeq: nextSeq,
        ignoredStaleReadCount: existing.ignoredStaleReadCount + 1,
        updatedAt: new Date(nowMs).toISOString(),
      };
      this.records.set(key, updated);
      return {
        state: updated,
        acceptedRead: false,
        staleReadIgnored: true,
        outOfOrderDropped: false,
      };
    }

    // 4. Expected resource version (or newer) has been observed -> clear indicator!
    const caughtUp: ResourceConsistencyState<TData> = {
      ...existing,
      status: "consistent",
      data: params.incomingData,
      rollbackSnapshot: null,
      expectedVersion: params.incomingVersion,
      observedReplicaVersion: params.incomingVersion,
      latestRequestSeq: nextSeq,
      consistencyToken: null,
      updatedAt: new Date(nowMs).toISOString(),
    };
    this.records.set(key, caughtUp);
    return {
      state: caughtUp,
      acceptedRead: true,
      staleReadIgnored: false,
      outOfOrderDropped: false,
    };
  }

  /**
   * Evaluates whether a pending consistency window has expired at `nowMs`.
   * Indicators do NOT clear on timeout — they transition to `"expired"` while
   * continuing to protect confirmed local state and surfacing retry/support guidance.
   */
  evaluateWindowExpiry<TData = unknown>(params: {
    organizationId: string;
    resourceType: string;
    resourceId: string;
    nowMs?: number;
  }): ResourceConsistencyState<TData> | null {
    const nowMs = params.nowMs ?? Date.now();
    const key = makeResourceKey(
      params.organizationId,
      params.resourceType,
      params.resourceId,
    );
    const existing = this.records.get(key) as
      | ResourceConsistencyState<TData>
      | undefined;

    if (!existing) return null;

    if (
      existing.status === "pending-propagation" &&
      existing.consistencyToken &&
      nowMs >= new Date(existing.consistencyToken.expiresAt).getTime()
    ) {
      const expiredState: ResourceConsistencyState<TData> = {
        ...existing,
        status: "expired",
        updatedAt: new Date(nowMs).toISOString(),
      };
      this.records.set(key, expiredState);
      return expiredState;
    }

    return existing;
  }

  /**
   * Handles route navigation: updates active pathname, rolls back any
   * unconfirmed optimistic state from the previous route, and scopes visible
   * indicators to the current route and tenant.
   */
  handleRouteChange(
    nextPathname: string,
    viewerOrganizationId: string,
  ): Array<ResourceConsistencyState<unknown>> {
    this.activePathname = nextPathname;

    for (const [key, record] of this.records.entries()) {
      if (
        record.status === "optimistic-pending" &&
        record.routePathname !== nextPathname
      ) {
        if (record.rollbackSnapshot) {
          this.records.set(key, {
            ...record,
            status: "idle",
            data: record.rollbackSnapshot.data,
            expectedVersion: record.rollbackSnapshot.version,
            observedReplicaVersion: record.rollbackSnapshot.version,
            rollbackSnapshot: null,
            consistencyToken: null,
          });
        } else {
          this.records.delete(key);
        }
      }
    }

    return Array.from(this.records.values()).filter(
      (record) =>
        record.organizationId === viewerOrganizationId &&
        record.routePathname === nextPathname &&
        (record.status === "pending-propagation" || record.status === "expired"),
    );
  }

  getResourceState<TData = unknown>(params: {
    viewerOrganizationId: string;
    organizationId: string;
    resourceType: string;
    resourceId: string;
  }): ResourceConsistencyState<TData> | null {
    if (
      !params.viewerOrganizationId ||
      params.organizationId !== params.viewerOrganizationId
    ) {
      throw new ConsistencyTokenError(
        "cross-tenant-token",
        "Cannot inspect consistency state belonging to another tenant.",
      );
    }
    const key = makeResourceKey(
      params.organizationId,
      params.resourceType,
      params.resourceId,
    );
    return (
      (this.records.get(key) as ResourceConsistencyState<TData> | undefined) ??
      null
    );
  }
}
