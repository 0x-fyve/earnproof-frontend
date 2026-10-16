/**
 * Accessible network status message component.
 *
 * Displays status/error messages for network failures with proper a11y:
 * - aria-live="assertive" for immediate alerts
 * - aria-live="polite" for non-urgent status updates
 * - role="alert" for error conditions
 * - Focus management for keyboard users
 * - Screen reader announcements
 *
 * Never traps focus — users can navigate away at any time.
 */

"use client";

import { useEffect, useRef } from "react";
import { ApiNetworkError } from "@/lib/network";

export type MessageSeverity = "error" | "warning" | "info";

export interface NetworkStatusMessageProps {
  error?: ApiNetworkError | Error | null;
  severity?: MessageSeverity;
  message?: string;
  onDismiss?: () => void;
  actions?: Array<{
    label: string;
    onClick: () => void;
    variant?: "primary" | "secondary";
  }>;
  /**
   * Whether to focus the message for screen reader users.
   * Default: true for errors, false for info.
   */
  autoFocus?: boolean;
}

const SEVERITY_COLORS = {
  error: {
    container: "border-rose-300/50 bg-rose-300/10",
    icon: "text-rose-200",
    heading: "text-rose-100",
    text: "text-slate-300",
  },
  warning: {
    container: "border-amber-300/50 bg-amber-300/10",
    icon: "text-amber-200",
    heading: "text-amber-100",
    text: "text-slate-300",
  },
  info: {
    container: "border-cyan-300/50 bg-cyan-300/10",
    icon: "text-cyan-200",
    heading: "text-cyan-100",
    text: "text-slate-300",
  },
};

const SEVERITY_ICONS = {
  error: "⚠️",
  warning: "⚡",
  info: "ℹ️",
};

/**
 * Get aria-live setting based on severity and auto-focus.
 * - Errors with autofocus: assertive (immediate announcement)
 * - Warnings/info: polite (announce without interrupting)
 */
function getAriaLive(severity: MessageSeverity, autoFocus: boolean): "assertive" | "polite" {
  if (severity === "error" && autoFocus) {
    return "assertive";
  }
  return "polite";
}

export function NetworkStatusMessage({
  error,
  severity = "error",
  message,
  onDismiss,
  actions = [],
  autoFocus: autoFocusProp,
}: NetworkStatusMessageProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Determine if we should show this message
  const shouldShow = error || message;
  const autoFocus = autoFocusProp !== false && (autoFocusProp || severity === "error");

  // Extract message from error or use provided message
  const displayMessage =
    message ||
    (error instanceof ApiNetworkError
      ? error.getUserMessage()
      : error instanceof Error
        ? error.message
        : "Something went wrong");

  // Determine heading text based on severity and error type
  const getHeading = (): string => {
    if (error instanceof ApiNetworkError) {
      switch (error.type) {
        case "offline":
          return "You're offline";
        case "timeout":
          return "Request timed out";
        case "server-error":
          return "Server error";
        case "auth-failure":
          return "Session expired";
        case "validation-error":
          return "Invalid input";
        default:
          return "Error";
      }
    }
    return severity === "error" ? "Error" : severity === "warning" ? "Warning" : "Status";
  };

  // Focus the heading after render for accessible announcement
  useEffect(() => {
    if (autoFocus && shouldShow && headingRef.current) {
      // Use queueMicrotask to ensure the DOM has committed
      queueMicrotask(() => {
        headingRef.current?.focus();
      });
    }
  }, [autoFocus, shouldShow]);

  if (!shouldShow) {
    return null;
  }

  const colors = SEVERITY_COLORS[severity];
  const icon = SEVERITY_ICONS[severity];
  const ariaLive = getAriaLive(severity, autoFocus);

  return (
    <div
      aria-live={ariaLive}
      aria-atomic="true"
      role={severity === "error" ? "alert" : "status"}
      className={`rounded-lg border p-4 sm:p-5 ${colors.container}`}
    >
      <div className="flex items-start gap-3">
        <span className={`text-lg leading-none ${colors.icon}`} aria-hidden="true">
          {icon}
        </span>
        <div className="flex-1">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className={`text-lg font-semibold focus-visible:outline-none ${colors.heading}`}
          >
            {getHeading()}
          </h2>
          <p className={`mt-1 text-sm leading-6 ${colors.text}`}>{displayMessage}</p>

          {/* Action buttons */}
          {actions.length > 0 && (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              {actions.map((action, index) => (
                <button
                  key={index}
                  onClick={action.onClick}
                  className={`inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                    action.variant === "primary" || !action.variant
                      ? "border border-cyan-300/50 bg-cyan-300 text-slate-950 hover:bg-cyan-200 focus-visible:outline-cyan-300"
                      : "border border-white/15 text-white hover:bg-white/10 focus-visible:outline-cyan-300"
                  }`}
                  type="button"
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}

          {/* Dismiss button */}
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="mt-3 text-xs text-slate-400 transition hover:text-slate-300 focus-visible:outline-none focus-visible:underline"
              type="button"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Hooks to manage network status message state in a component.
 */
export function useNetworkStatusMessage() {
  const error = useRef<ApiNetworkError | Error | null>(null);
  const message = useRef<string>("");
  const severity = useRef<MessageSeverity>("error");

  const showError = (err: ApiNetworkError | Error, sev: MessageSeverity = "error") => {
    error.current = err;
    severity.current = sev;
    message.current = "";
  };

  const showMessage = (msg: string, sev: MessageSeverity = "info") => {
    message.current = msg;
    severity.current = sev;
    error.current = null;
  };

  const clear = () => {
    error.current = null;
    message.current = "";
  };

  return {
    error: error.current,
    message: message.current,
    severity: severity.current,
    showError,
    showMessage,
    clear,
  };
}
