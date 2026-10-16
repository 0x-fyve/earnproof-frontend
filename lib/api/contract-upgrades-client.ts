/**
 * Enhanced client for contract upgrade compatibility review operations.
 * 
 * This module wraps the base contract-upgrades API with higher-level
 * functionality for caching, optimistic updates, and state management.
 */

import {
  getContractUpgradeReview,
  getPendingContractUpgrades,
  getContractUpgradeHistory,
  approveContractUpgradeSafe,
  rejectContractUpgradeSafe,
  canApproveReview,
  getApprovalDisabledReason,
  type ContractUpgradeReview,
  type ContractUpgradeReviewWithRevision,
  type ApproveContractUpgradeRequest,
  type RejectContractUpgradeRequest,
  type ApiResult,
} from "./contract-upgrades";

/**
 * Client for managing contract upgrade reviews with enhanced state tracking
 */
export class ContractUpgradeClient {
  private cache: Map<string, ContractUpgradeReviewWithRevision> = new Map();
  private pendingCache: ContractUpgradeReviewWithRevision[] | null = null;
  private historyCache: Map<string, ContractUpgradeReviewWithRevision[]> = new Map();
  private lastCacheTime: Map<string, number> = new Map();
  private cacheMaxAge = 5 * 60 * 1000; // 5 minutes

  /**
   * Check if cache entry is still valid
   */
  private isCacheValid(key: string): boolean {
    const lastTime = this.lastCacheTime.get(key);
    if (!lastTime) return false;
    return Date.now() - lastTime < this.cacheMaxAge;
  }

  /**
   * Fetch a contract upgrade review with caching
   */
  async fetchReview(
    token: string,
    upgradePlanId: string,
    signal: AbortSignal,
    skipCache = false
  ): Promise<ContractUpgradeReviewWithRevision> {
    const cacheKey = `review:${upgradePlanId}`;

    if (!skipCache && this.isCacheValid(cacheKey)) {
      const cached = this.cache.get(upgradePlanId);
      if (cached) {
        return cached;
      }
    }

    const review = await getContractUpgradeReview(token, upgradePlanId, signal);
    this.cache.set(upgradePlanId, review);
    this.lastCacheTime.set(cacheKey, Date.now());

    return review;
  }

  /**
   * Fetch all pending contract upgrades with caching
   */
  async fetchPending(
    token: string,
    signal: AbortSignal,
    skipCache = false
  ): Promise<ContractUpgradeReviewWithRevision[]> {
    const cacheKey = "pending";

    if (!skipCache && this.isCacheValid(cacheKey) && this.pendingCache) {
      return this.pendingCache;
    }

    const reviews = await getPendingContractUpgrades(token, signal);
    this.pendingCache = reviews;
    this.lastCacheTime.set(cacheKey, Date.now());

    return reviews;
  }

  /**
   * Fetch upgrade history for a contract with caching
   */
  async fetchHistory(
    token: string,
    contractAddress: string,
    signal: AbortSignal,
    skipCache = false
  ): Promise<ContractUpgradeReviewWithRevision[]> {
    const cacheKey = `history:${contractAddress}`;

    if (!skipCache && this.isCacheValid(cacheKey)) {
      const cached = this.historyCache.get(contractAddress);
      if (cached) {
        return cached;
      }
    }

    const reviews = await getContractUpgradeHistory(token, contractAddress, signal);
    this.historyCache.set(contractAddress, reviews);
    this.lastCacheTime.set(cacheKey, Date.now());

    return reviews;
  }

  /**
   * Approve a contract upgrade with optimistic cache update
   */
  async approve(
    token: string,
    upgradePlanId: string,
    request: ApproveContractUpgradeRequest,
    signal: AbortSignal
  ): Promise<ApiResult<ContractUpgradeReview>> {
    const result = await approveContractUpgradeSafe(
      token,
      upgradePlanId,
      request,
      signal
    );

    if (result.success) {
      // Update cache with new state
      this.cache.set(upgradePlanId, result.data as ContractUpgradeReviewWithRevision);
      this.lastCacheTime.set(`review:${upgradePlanId}`, Date.now());

      // Invalidate pending cache since status changed
      this.pendingCache = null;
    }

    return result;
  }

  /**
   * Reject a contract upgrade with optimistic cache update
   */
  async reject(
    token: string,
    upgradePlanId: string,
    request: RejectContractUpgradeRequest,
    signal: AbortSignal
  ): Promise<ApiResult<ContractUpgradeReview>> {
    const result = await rejectContractUpgradeSafe(
      token,
      upgradePlanId,
      request,
      signal
    );

    if (result.success) {
      // Update cache with new state
      this.cache.set(upgradePlanId, result.data as ContractUpgradeReviewWithRevision);
      this.lastCacheTime.set(`review:${upgradePlanId}`, Date.now());

      // Invalidate pending cache since status changed
      this.pendingCache = null;
    }

    return result;
  }

  /**
   * Check if a review can be approved
   */
  canApprove(review: ContractUpgradeReview): boolean {
    return canApproveReview(review);
  }

  /**
   * Get reason why approval is disabled (if applicable)
   */
  getApprovalDisabledReason(review: ContractUpgradeReview): string | null {
    return getApprovalDisabledReason(review);
  }

  /**
   * Invalidate a specific cache entry
   */
  invalidateReview(upgradePlanId: string): void {
    this.cache.delete(upgradePlanId);
    this.lastCacheTime.delete(`review:${upgradePlanId}`);
  }

  /**
   * Invalidate pending cache
   */
  invalidatePending(): void {
    this.pendingCache = null;
    this.lastCacheTime.delete("pending");
  }

  /**
   * Invalidate history for a contract
   */
  invalidateHistory(contractAddress: string): void {
    this.historyCache.delete(contractAddress);
    this.lastCacheTime.delete(`history:${contractAddress}`);
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.cache.clear();
    this.pendingCache = null;
    this.historyCache.clear();
    this.lastCacheTime.clear();
  }
}

/**
 * Create a new contract upgrade client instance
 */
export function createContractUpgradeClient(): ContractUpgradeClient {
  return new ContractUpgradeClient();
}
