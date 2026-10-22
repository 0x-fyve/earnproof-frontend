"use client";

/**
 * React wiring for the live-region announcement coordinator (#252).
 *
 * Mounted once in app/layout.tsx so every route shares the same two
 * `aria-live` regions. Flows call `useAnnounce()` to report status changes;
 * they never render their own `aria-live` element.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { LiveAnnouncer, type AnnounceOptions, type AnnouncerState } from "./announcer";

interface AnnouncerContextValue {
  announcer: LiveAnnouncer;
}

const AnnouncerContext = createContext<AnnouncerContextValue | undefined>(undefined);

/**
 * A visually-hidden-but-screen-reader-visible style, matching the
 * long-standing "sr-only" utility pattern already used elsewhere in this
 * codebase (e.g. components/proofs/artifact-export.tsx's `className="sr-only"`
 * status region) but defined inline here so this module has no dependency on
 * the Tailwind build for a single, fixed, non-visual rule.
 */
const SR_ONLY_STYLE: React.CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export function AnnouncerProvider({ children }: { children: ReactNode }) {
  // Lazy initializer: the LiveAnnouncer instance is created exactly once
  // per mounted provider and never replaced, since useState ignores the
  // initializer function on every render after the first.
  const [announcer] = useState(() => new LiveAnnouncer());

  const subscribe = useCallback(
    (onStoreChange: () => void) => announcer.subscribe(onStoreChange),
    [announcer],
  );
  const getSnapshot = useCallback(() => announcer.getState(), [announcer]);
  const state = useSyncExternalStore<AnnouncerState>(subscribe, getSnapshot, getSnapshot);

  // Route changes: an announcement in flight for the page the user is
  // leaving must not linger and read out over the next page, and must not
  // throw if the flow that started it has since unmounted (clear() is a
  // no-op write to local state, never a DOM touch).
  const pathname = usePathname();
  const previousPathname = useRef(pathname);
  useEffect(() => {
    if (previousPathname.current !== pathname) {
      previousPathname.current = pathname;
      announcer.clear();
    }
  }, [announcer, pathname]);

  return (
    <AnnouncerContext.Provider value={{ announcer }}>
      {children}
      {/*
        Two fixed regions, present for the lifetime of the app, never
        unmounted by a flow. Only their text content changes, so assistive
        tech reliably picks up each update; nothing here is ever focusable
        or receives focus, so a status change can never steal keyboard
        focus from whatever the user is doing elsewhere on the page.
      */}
      <div
        aria-live="polite"
        aria-atomic="true"
        role="status"
        style={SR_ONLY_STYLE}
        data-testid="a11y-live-region-polite"
      >
        {state.polite?.message ?? ""}
      </div>
      <div
        aria-live="assertive"
        aria-atomic="true"
        role="alert"
        style={SR_ONLY_STYLE}
        data-testid="a11y-live-region-assertive"
      >
        {state.assertive?.message ?? ""}
      </div>
    </AnnouncerContext.Provider>
  );
}

export interface UseAnnounceResult {
  /** Announce a status message through the shared live regions. */
  announce: (message: string, options?: AnnounceOptions) => number | null;
}

/**
 * Hook for flows to report status changes. Falls back to a no-op in test
 * environments that don't wrap their subject in `AnnouncerProvider`, the
 * same accommodation `usePrivacy()` makes in contexts/privacy-context.tsx,
 * so existing component tests aren't forced to add the provider just to
 * render a component that happens to call `useAnnounce()`.
 */
export function useAnnounce(): UseAnnounceResult {
  const context = useContext(AnnouncerContext);
  // The hook call below must run unconditionally on every render (rules of
  // hooks), so the "no provider" fallback is expressed as a stable no-op
  // dependency rather than an early return before useCallback.
  const announcer = context?.announcer ?? null;
  const announce = useCallback(
    (message: string, options?: AnnounceOptions) => {
      if (!announcer) {
        if (process.env.NODE_ENV === "test") {
          return null;
        }
        throw new Error("useAnnounce must be used within an AnnouncerProvider");
      }
      return announcer.announce(message, options);
    },
    [announcer],
  );
  return { announce };
}
