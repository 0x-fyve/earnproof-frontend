/**
 * SessionRecoveryModal: Accessible re-authentication UI.
 *
 * Appears when session recovery is needed (token expired, revoked, etc.).
 * Allows user to reconnect wallet and establish a new session.
 *
 * Accessibility:
 * - Modal is screen-reader announced
 * - Keyboard navigable (Tab through buttons)
 * - Focus trap within modal (no focus escape)
 * - Semantic HTML
 */

'use client';

import React, { useCallback, useEffect, useRef } from 'react';

export interface SessionRecoveryModalProps {
  isOpen: boolean;
  isRecovering: boolean;
  error?: string | null;
  onRecover: () => void | Promise<void>;
  onDismiss: () => void;
  title?: string;
  description?: string;
}

export function SessionRecoveryModal({
  isOpen,
  isRecovering,
  error,
  onRecover,
  onDismiss,
  title = 'Session Expired',
  description = 'Your session has expired. Please reconnect your Freighter wallet to continue.',
}: SessionRecoveryModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const recoverButtonRef = useRef<HTMLButtonElement>(null);

  // Focus trap: keep focus within modal
  useEffect(() => {
    if (!isOpen || !modalRef.current) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const focusableElements = modalRef.current?.querySelectorAll(
        'button, [href], input, select, textarea',
      );
      if (!focusableElements || focusableElements.length === 0) return;

      const firstElement = focusableElements[0] as HTMLElement;
      const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;
      const activeElement = document.activeElement;

      if (e.shiftKey) {
        // Shift+Tab
        if (activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab
        if (activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Auto-focus recover button when modal opens
  useEffect(() => {
    if (isOpen && recoverButtonRef.current && !isRecovering) {
      recoverButtonRef.current.focus();
    }
  }, [isOpen, isRecovering]);

  const handleRecover = useCallback(async () => {
    try {
      await onRecover();
    } catch (err) {
      // Error is handled by parent state
      console.error('Recovery error:', err);
    }
  }, [onRecover]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        aria-hidden="true"
        onClick={onDismiss}
        role="presentation"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="recovery-modal-title"
        aria-describedby="recovery-modal-description"
      >
        <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200">
            <h2
              id="recovery-modal-title"
              className="text-lg font-semibold text-gray-900"
            >
              {title}
            </h2>
          </div>

          {/* Content */}
          <div className="px-6 py-4">
            <p
              id="recovery-modal-description"
              className="text-sm text-gray-600 mb-4"
            >
              {description}
            </p>

            {error && (
              <div
                className="bg-red-50 border border-red-200 rounded-md p-3 mb-4"
                role="alert"
              >
                <p className="text-sm text-red-700 font-medium">Error</p>
                <p className="text-sm text-red-600 mt-1">{error}</p>
              </div>
            )}

            {isRecovering && (
              <div className="text-center py-2">
                <div className="inline-block h-5 w-5 border-2 border-blue-500 border-r-transparent rounded-full animate-spin" />
                <p className="text-sm text-gray-600 mt-2">Reconnecting...</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex gap-3 justify-end">
            <button
              onClick={onDismiss}
              disabled={isRecovering}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Dismiss recovery modal"
            >
              Dismiss
            </button>
            <button
              ref={recoverButtonRef}
              onClick={handleRecover}
              disabled={isRecovering}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label="Reconnect wallet to recover session"
            >
              {isRecovering ? 'Reconnecting...' : 'Reconnect Wallet'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Hook to manage session recovery modal state.
 */
export function useSessionRecoveryModal() {
  const [isOpen, setIsOpen] = React.useState(false);
  const [isRecovering, setIsRecovering] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const openModal = useCallback(() => {
    setIsOpen(true);
    setError(null);
  }, []);

  const closeModal = useCallback(() => {
    setIsOpen(false);
  }, []);

  const startRecovery = useCallback(() => {
    setIsRecovering(true);
    setError(null);
  }, []);

  const completeRecovery = useCallback((recoveryError?: string) => {
    setIsRecovering(false);
    if (recoveryError) {
      setError(recoveryError);
    } else {
      setIsOpen(false);
    }
  }, []);

  return {
    isOpen,
    isRecovering,
    error,
    openModal,
    closeModal,
    startRecovery,
    completeRecovery,
  };
}
