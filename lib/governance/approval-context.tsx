/**
 * Governance Approval Intent Context
 *
 * Centralized state management for governance approval intents and receipts.
 * Provides:
 * - Server-confirmed receipt storage and retrieval
 * - Authorization state (current wallet address)
 * - Expiration tracking and refresh logic
 * - Error state and recovery
 * - Minimal client-side caching (no secrets)
 */

"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from "react";
import {
  GovernanceApprovalIntentConfirmation,
  isGovernanceApprovalIntentConfirmation,
  validateGovernanceApprovalConfirmation,
  isGovernanceApprovalIntentExpired,
  GovernanceApprovalValidationResult,
} from "@/lib/api/governance-approvals";

/** Internal cache entry for a single approval receipt. */
type ApprovalReceiptCacheEntry = {
  confirmation: GovernanceApprovalIntentConfirmation;
  cachedAt: Date;
  expiresAt: Date;
};

/** Approval context state and actions. */
export interface GovernanceApprovalContextType {
  // State
  currentWalletAddress: string | null;
  receipts: Map<string, GovernanceApprovalIntentConfirmation>;
  isLoading: boolean;
  error: string | null;

  // Actions
  setWalletAddress: (address: string | null) => void;
  addReceipt: (confirmation: GovernanceApprovalIntentConfirmation) => void;
  getReceipt: (receiptId: string) => GovernanceApprovalIntentConfirmation | null;
  removeReceipt: (receiptId: string) => void;
  clearReceipts: () => void;
  refreshReceipt: (
    receiptId: string,
    fetcher: () => Promise<GovernanceApprovalIntentConfirmation>
  ) => Promise<void>;
  validateReceipt: (confirmation: unknown) => GovernanceApprovalValidationResult;
  setError: (error: string | null) => void;
}

/** React Context for governance approvals. */
const GovernanceApprovalContext = createContext<GovernanceApprovalContextType | undefined>(
  undefined
);

/**
 * Provider component for governance approval state.
 * Wraps components that need access to approval receipts and state.
 */
export function GovernanceApprovalProvider({ children }: { children: ReactNode }) {
  // State
  const [currentWalletAddress, setCurrentWalletAddress] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<Map<string, GovernanceApprovalIntentConfirmation>>(
    new Map()
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cache for TTL tracking
  const [cacheEntries] = useState<Map<string, ApprovalReceiptCacheEntry>>(new Map());

  // Add a receipt to state
  const addReceipt = useCallback(
    (confirmation: GovernanceApprovalIntentConfirmation) => {
      // Validate before storing
      const validation = validateGovernanceApprovalConfirmation(confirmation);
      if (!validation.isValid) {
        setError(
          `Cannot store invalid receipt: ${validation.errors.join("; ")}`
        );
        return;
      }

      setReceipts((prev) => {
        const next = new Map(prev);
        next.set(confirmation.id, confirmation);
        return next;
      });

      // Track cache entry for TTL
      const now = new Date();
      const expiresDate = new Date(confirmation.expiresAt);
      cacheEntries.set(confirmation.id, {
        confirmation,
        cachedAt: now,
        expiresAt: expiresDate,
      });

      setError(null);
    },
    [cacheEntries]
  );

  // Retrieve a receipt
  const getReceipt = useCallback(
    (receiptId: string): GovernanceApprovalIntentConfirmation | null => {
      const receipt = receipts.get(receiptId);
      if (!receipt) return null;

      // Check cache expiration
      const cacheEntry = cacheEntries.get(receiptId);
      if (cacheEntry && new Date() > cacheEntry.expiresAt) {
        // Cache expired; remove it
        setReceipts((prev) => {
          const next = new Map(prev);
          next.delete(receiptId);
          return next;
        });
        cacheEntries.delete(receiptId);
        return null;
      }

      return receipt;
    },
    [receipts, cacheEntries]
  );

  // Remove a receipt
  const removeReceipt = useCallback((receiptId: string) => {
    setReceipts((prev) => {
      const next = new Map(prev);
      next.delete(receiptId);
      return next;
    });
    cacheEntries.delete(receiptId);
  }, [cacheEntries]);

  // Clear all receipts
  const clearReceipts = useCallback(() => {
    setReceipts(new Map());
    cacheEntries.clear();
  }, [cacheEntries]);

  // Refresh a receipt from server
  const refreshReceipt = useCallback(
    async (
      receiptId: string,
      fetcher: () => Promise<GovernanceApprovalIntentConfirmation>
    ) => {
      setIsLoading(true);
      setError(null);
      try {
        const freshConfirmation = await fetcher();
        if (!isGovernanceApprovalIntentConfirmation(freshConfirmation)) {
          throw new Error("Server returned invalid governance approval confirmation.");
        }
        addReceipt(freshConfirmation);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to refresh approval receipt from server.";
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [addReceipt]
  );

  // Validate a receipt (does not store it)
  const validateReceipt = useCallback(
    (confirmation: unknown): GovernanceApprovalValidationResult => {
      return validateGovernanceApprovalConfirmation(confirmation);
    },
    []
  );

  const contextValue: GovernanceApprovalContextType = {
    currentWalletAddress,
    receipts,
    isLoading,
    error,
    setWalletAddress: setCurrentWalletAddress,
    addReceipt,
    getReceipt,
    removeReceipt,
    clearReceipts,
    refreshReceipt,
    validateReceipt,
    setError,
  };

  return (
    <GovernanceApprovalContext.Provider value={contextValue}>
      {children}
    </GovernanceApprovalContext.Provider>
  );
}

/**
 * Hook to access governance approval context.
 * Must be called within a GovernanceApprovalProvider.
 */
export function useGovernanceApprovalContext(): GovernanceApprovalContextType {
  const context = useContext(GovernanceApprovalContext);
  if (!context) {
    throw new Error(
      "useGovernanceApprovalContext must be used within a GovernanceApprovalProvider."
    );
  }
  return context;
}

/**
 * Hook to retrieve a specific receipt by ID.
 * Automatically tracks expiration.
 */
export function useApprovalReceipt(receiptId: string | null) {
  const { getReceipt } = useGovernanceApprovalContext();
  const [receipt, setReceipt] = useState<GovernanceApprovalIntentConfirmation | null>(null);
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    if (!receiptId) {
      setReceipt(null);
      setIsExpired(false);
      return;
    }

    const fetched = getReceipt(receiptId);
    setReceipt(fetched);

    if (fetched) {
      setIsExpired(isGovernanceApprovalIntentExpired(fetched));
    }
  }, [receiptId, getReceipt]);

  return { receipt, isExpired };
}

/**
 * Hook to track expiration status with polling.
 * Polls server periodically to check if receipt state has changed.
 */
export function useApprovalReceiptExpirationPolling(
  receiptId: string | null,
  fetcher?: () => Promise<GovernanceApprovalIntentConfirmation>,
  pollIntervalMs: number = 30000 // 30 seconds default
) {
  const { getReceipt, refreshReceipt } = useGovernanceApprovalContext();
  const [isExpired, setIsExpired] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);

  useEffect(() => {
    if (!receiptId || !fetcher) return;

    const checkExpiration = () => {
      const receipt = getReceipt(receiptId);
      if (receipt) {
        const expired = isGovernanceApprovalIntentExpired(receipt);
        setIsExpired(expired);

        // Refresh from server if available
        if (!expired) {
          refreshReceipt(receiptId, fetcher).catch((err) => {
            setPollError(err instanceof Error ? err.message : "Refresh failed");
          });
        }
      }
    };

    // Check immediately
    checkExpiration();

    // Set up polling interval
    const interval = setInterval(checkExpiration, pollIntervalMs);

    return () => clearInterval(interval);
  }, [receiptId, fetcher, pollIntervalMs, getReceipt, refreshReceipt]);

  return { isExpired, pollError };
}

/**
 * Hook to synchronize wallet address with context.
 * Call this when wallet connection changes.
 */
export function useGovernanceApprovalWalletSync(walletAddress: string | null) {
  const { setWalletAddress, currentWalletAddress } = useGovernanceApprovalContext();

  useEffect(() => {
    if (walletAddress && walletAddress !== currentWalletAddress) {
      setWalletAddress(walletAddress);
    }
  }, [walletAddress, currentWalletAddress, setWalletAddress]);

  return currentWalletAddress;
}

/**
 * Hook to retrieve all receipts for current wallet.
 * Filters receipts by authorization.
 */
export function useApprovalReceiptsForWallet(walletAddress: string | null) {
  const { receipts } = useGovernanceApprovalContext();
  const [filteredReceipts, setFilteredReceipts] = useState<
    GovernanceApprovalIntentConfirmation[]
  >([]);

  useEffect(() => {
    if (!walletAddress) {
      setFilteredReceipts([]);
      return;
    }

    const matches: GovernanceApprovalIntentConfirmation[] = [];
    for (const receipt of receipts.values()) {
      if (receipt.walletAddress.toLowerCase() === walletAddress.toLowerCase()) {
        matches.push(receipt);
      }
    }

    // Sort by confirmedAt descending (newest first)
    matches.sort(
      (a, b) => new Date(b.confirmedAt).getTime() - new Date(a.confirmedAt).getTime()
    );

    setFilteredReceipts(matches);
  }, [receipts, walletAddress]);

  return filteredReceipts;
}

/**
 * Hook to track active (non-expired) approval receipts.
 */
export function useActiveApprovalReceipts() {
  const { receipts } = useGovernanceApprovalContext();
  const [activeReceipts, setActiveReceipts] = useState<
    GovernanceApprovalIntentConfirmation[]
  >([]);

  useEffect(() => {
    const active: GovernanceApprovalIntentConfirmation[] = [];
    for (const receipt of receipts.values()) {
      if (receipt.state === "confirmed" && !isGovernanceApprovalIntentExpired(receipt)) {
        active.push(receipt);
      }
    }

    setActiveReceipts(active);
  }, [receipts]);

  return activeReceipts;
}
