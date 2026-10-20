/**
 * Auth context helpers for testing authenticated admin routes
 * Provides renderAs* functions that wrap components with proper auth session
 */

import { render, RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';
import {
  MOCK_ADMIN_SESSION,
  MOCK_DEVELOPER_SESSION,
  MOCK_ISSUER_SESSION,
  MOCK_READONLY_SESSION,
} from '@/tests/fixtures/admin-fixtures';

/**
 * Set up localStorage with a mock session
 */
function setStoredSession(session: typeof MOCK_ADMIN_SESSION | null) {
  if (session) {
    window.localStorage.setItem('earnproof.session', JSON.stringify(session));
  } else {
    window.localStorage.removeItem('earnproof.session');
  }
}

/**
 * Clean up localStorage session
 */
function clearStoredSession() {
  window.localStorage.removeItem('earnproof.session');
}

/**
 * Render component with admin authentication
 * Admin has access to all admin routes
 */
export function renderAsAdmin(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  setStoredSession(MOCK_ADMIN_SESSION);
  const result = render(ui, options);

  // Cleanup on unmount
  const cleanup = result.unmount;
  result.unmount = () => {
    clearStoredSession();
    cleanup();
  };

  return result;
}

/**
 * Render component with developer authentication
 * Developer can manage API keys
 */
export function renderAsDeveloper(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  setStoredSession(MOCK_DEVELOPER_SESSION);
  const result = render(ui, options);

  const cleanup = result.unmount;
  result.unmount = () => {
    clearStoredSession();
    cleanup();
  };

  return result;
}

/**
 * Render component with issuer authentication
 * Issuer can manage organizations and issuers
 */
export function renderAsIssuer(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  setStoredSession(MOCK_ISSUER_SESSION);
  const result = render(ui, options);

  const cleanup = result.unmount;
  result.unmount = () => {
    clearStoredSession();
    cleanup();
  };

  return result;
}

/**
 * Render component with read-only (worker) authentication
 * Read-only user has minimal permissions, no admin access
 */
export function renderAsReadOnly(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  setStoredSession(MOCK_READONLY_SESSION);
  const result = render(ui, options);

  const cleanup = result.unmount;
  result.unmount = () => {
    clearStoredSession();
    cleanup();
  };

  return result;
}

/**
 * Render component with no authentication
 * Unauthenticated user should see auth-required messages
 */
export function renderUnauthenticated(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  clearStoredSession();
  const result = render(ui, options);

  const cleanup = result.unmount;
  result.unmount = () => {
    clearStoredSession();
    cleanup();
  };

  return result;
}

/**
 * Set up and tear down auth helpers for a test
 * Ensures clean localStorage state before and after each test
 */
export function setupAuthHelpers() {
  beforeEach(() => {
    clearStoredSession();
  });

  afterEach(() => {
    clearStoredSession();
  });
}
