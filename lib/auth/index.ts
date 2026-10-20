/**
 * Auth module exports
 */

export { SessionCoordinator } from './session-coordinator';
export type { RecoveryState, SessionCoordinatorConfig, PendingRequest } from './session-coordinator';

export { TokenManager } from './token-manager';
export type { TokenPayload } from './token-manager';

export { WalletDetector } from './wallet-detector';
export type { WalletState, WalletChangeListener, WalletChangeEvent } from './wallet-detector';

export { MultiTabSync } from './multi-tab-sync';
export type { SyncMessageType, SyncMessage, SyncListener } from './multi-tab-sync';

export { AuthSessionProvider, useAuthSession } from './auth-context';
export type { AuthSessionContextType, SessionUser, AuthSessionProviderProps } from './auth-context';
