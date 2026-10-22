/**
 * AuthContext: Centralized session and wallet state management.
 *
 * Coordinates:
 * - Session lifecycle (login, logout, recovery)
 * - Token management (in-memory, no persistence)
 * - Wallet state (account, network)
 * - Multi-tab sync
 * - 401 recovery flow
 */

"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { TokenManager } from "./token-manager";
import { SessionCoordinator } from "./session-coordinator";
import { WalletDetector, WalletState } from "./wallet-detector";
import { MultiTabSync, SyncMessage } from "./multi-tab-sync";
import { installBfcacheGuard } from "./bfcache-guard";

export interface SessionUser {
  id: string;
  walletAddress: string;
  email?: string;
  role?: string;
}

export interface AuthSessionContextType {
  // Session state
  user: SessionUser | null;
  isAuthenticated: boolean;
  isRecovering: boolean;
  recoveryError: string | null;

  // Wallet state
  walletState: WalletState;

  // Actions
  setSession: (user: SessionUser, token: string, expiresAt?: number) => void;
  clearSession: (reason?: string) => void;
  attemptRecovery: (recoveryFn: () => Promise<void>) => Promise<void>;
  invalidateWalletData: (reason: string) => void;

  // Getters
  getToken: () => string | null;
  getRedirectPath: () => string;
  setRedirectPath: (path: string) => void;
}

const AuthSessionContext = createContext<AuthSessionContextType | undefined>(
  undefined,
);

export interface AuthSessionProviderProps {
  children: ReactNode;
  onSessionChange?: (user: SessionUser | null) => void;
}

/**
 * AuthSessionProvider wraps the app and manages all session/wallet state.
 * Should be placed high in the component tree (e.g., in layout.tsx).
 */
export function AuthSessionProvider({
  children,
  onSessionChange,
}: AuthSessionProviderProps) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [walletState, setWalletState] = useState<WalletState>({
    address: null,
    network: process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet",
    isConnected: false,
    lastChecked: Date.now(),
  });
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [redirectPath, setRedirectPath] = useState("/");

  const tokenManager = TokenManager.getInstance();
  const coordinator = SessionCoordinator.getInstance();
  const walletDetector = WalletDetector.getInstance();
  const queryClient = useQueryClient();
  const multiTabSync = MultiTabSync.getInstance();

  // Initialize wallet detection and multi-tab sync
  useEffect(() => {
    walletDetector.initialize().catch((error) => {
      console.error("Wallet detector initialization error:", error);
    });

    return () => {
      walletDetector.destroy();
    };
  }, [walletDetector]);

  // Handle wallet changes (account switch, network switch, disconnection)
  useEffect(() => {
    const unsubscribe = walletDetector.onChange((changeEvent, newState) => {
      setWalletState(newState);

      // Invalidate user session if wallet changed
      if (
        changeEvent.type === "account_changed" ||
        changeEvent.type === "network_changed"
      ) {
        clearSession("wallet_changed");
        multiTabSync.broadcast("wallet_changed");
      } else if (changeEvent.type === "disconnected") {
        clearSession("wallet_disconnected");
      }
    });

    return unsubscribe;
  }, []);

  // Guard against the browser's back/forward cache restoring a sensitive
  // page (e.g. /proofs, /settings) with stale in-memory session state. See
  // lib/auth/bfcache-guard.ts for why this is needed even though
  // config/cache-headers.ts already sets `no-store` on these routes.
  useEffect(() => {
    return installBfcacheGuard({
      onRestore: () => {
        // `hasToken()` already treats an expired token as absent (see
        // TokenManager.getToken()'s 30s-grace expiry check), so this also
        // covers "the token simply expired while the page was cached".
        if (!tokenManager.hasToken()) {
          clearSession("bfcache_restored_with_invalid_token");
          return;
        }
        // Token looks locally valid, but another tab may have rotated or
        // revoked it while this page was cached. Drop the coordinator's
        // cached recovery state so the next request re-validates against
        // the server rather than trusting the restored UI outright.
        coordinator.reset();
      },
    });
  }, []);

  // Handle multi-tab sync messages
  useEffect(() => {
    const unsubscribe = multiTabSync.onSync((message: SyncMessage) => {
      switch (message.type) {
        case "logout":
        case "session_expired":
          clearSession(`synced_from_tab: ${message.type}`);
          break;
        case "wallet_changed":
          clearSession("wallet_changed_in_another_tab");
          break;
        case "token_rotated":
          // Token was rotated in another tab; local requests will fail
          // and trigger recovery flow
          setRecoveryError(null);
          break;
      }
    });

    return unsubscribe;
  }, []);

  const setSession = useCallback(
    (newUser: SessionUser, token: string, expiresAt?: number) => {
      setUser(newUser);
      tokenManager.setToken(token, expiresAt);
      setRecoveryError(null);
      setIsRecovering(false);
      onSessionChange?.(newUser);
    },
    [tokenManager, onSessionChange],
  );

  const clearSession = useCallback(
    (reason?: string) => {
      // Purge every cached query scoped to the outgoing wallet (#326)
      // before dropping the token/session state below - a wallet switch or
      // disconnect must never leave the previous wallet's cached API
      // keys/proofs/organizations visible to whatever connects next.
      if (user?.walletAddress) {
        purgeWalletQueries(queryClient, user.walletAddress);
      }

      setUser(null);
      tokenManager.clearToken();
      coordinator.reset();
      setRecoveryError(null);
      setIsRecovering(false);
      onSessionChange?.(null);

      if (reason) {
        console.debug(`Session cleared: ${reason}`);
      }
    },
    [tokenManager, coordinator, onSessionChange, queryClient, user],
  );

  const attemptRecovery = useCallback(
    async (recoveryFn: () => Promise<void>) => {
      setIsRecovering(true);
      setRecoveryError(null);

      try {
        await coordinator.handle401(async (signal) => {
          await recoveryFn();
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Recovery failed";
        setRecoveryError(message);
        setIsRecovering(false);
        // The server rejected the session and it could not be recovered:
        // treat it as revoked in every tab (#274). Downgrade only.
        multiTabSync.broadcast('session_expired');
        throw error;
      }

      setIsRecovering(false);
    },
    [coordinator, multiTabSync],
  );

  const invalidateWalletData = useCallback((reason: string) => {
    // Signal to components that wallet-specific cached data should be cleared
    // This is called proactively when wallet changes, before re-render
    console.debug(`Wallet data invalidated: ${reason}`);
    // Components listening to context will handle this via useMemo/useEffect
  }, []);

  const getToken = useCallback(() => {
    return tokenManager.getToken();
  }, [tokenManager]);

  const getRedirectPath = useCallback(() => {
    // Validate redirect path is internal (no open redirect)
    if (redirectPath.startsWith("/") && !redirectPath.includes("://")) {
      return redirectPath;
    }
    return "/";
  }, [redirectPath]);

  const value: AuthSessionContextType = {
    user,
    isAuthenticated: user !== null && tokenManager.hasToken(),
    isRecovering,
    recoveryError,
    walletState,
    setSession,
    clearSession,
    attemptRecovery,
    invalidateWalletData,
    getToken,
    getRedirectPath,
    setRedirectPath,
  };

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}

/**
 * Hook to access auth/session context.
 * Must be used within AuthSessionProvider.
 */
export function useAuthSession(): AuthSessionContextType {
  const context = useContext(AuthSessionContext);
  if (!context) {
    throw new Error("useAuthSession must be used within AuthSessionProvider");
  }
  return context;
}
