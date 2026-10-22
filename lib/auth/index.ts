/**
 * Auth module exports
 */

export { SessionCoordinator } from './session-coordinator';
export type { RecoveryState, SessionCoordinatorConfig, PendingRequest } from './session-coordinator';

export { TokenManager } from './token-manager';
export type { TokenPayload } from './token-manager';

export { WalletDetector } from './wallet-detector';
export type { WalletState, WalletChangeListener, WalletChangeEvent } from './wallet-detector';

/** @deprecated Use getTabSyncCoordinator; MultiTabSync is a compatibility adapter. */
export { MultiTabSync } from './multi-tab-sync';
export type { SyncMessageType, SyncMessage, SyncListener } from './multi-tab-sync';

export {
  createTabSyncCoordinator,
  getTabSyncCoordinator,
  TAB_SYNC_PUBLISH_LIMIT,
  TAB_SYNC_INBOUND_LIMIT,
  TAB_SYNC_DEDUPE_WINDOW_MS,
} from './tab-sync-coordinator';
export type {
  TabSyncCoordinator,
  TabSyncCoordinatorOptions,
  TabSyncEvent,
  TabSyncListener,
  TabSyncPublishResult,
  TabSyncDropReason,
} from './tab-sync-coordinator';
export {
  TAB_SYNC_PROTOCOL_VERSION,
  TAB_SYNC_EVENT_TYPES,
  TAB_SYNC_RESTRICTIVENESS,
  TAB_SYNC_MAX_MESSAGE_BYTES,
  TAB_SYNC_MAX_CLOCK_SKEW_MS,
  validateTabSyncMessage,
  decodeTabSyncPayload,
  decideTabSyncMessage,
} from './tab-sync-protocol';
export type { TabSyncEventType, TabSyncMessage, TabSyncRejectReason } from './tab-sync-protocol';

export { AuthSessionProvider, useAuthSession } from './auth-context';
export type { AuthSessionContextType, SessionUser, AuthSessionProviderProps } from './auth-context';
