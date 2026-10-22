"use client";

import { useSyncExternalStore } from "react";
import { readStoredSession, subscribeSession } from "@/lib/session";

/**
 * React bindings for the in-memory session. Snapshots are primitives so
 * `useSyncExternalStore` sees a stable value between unrelated renders.
 */

const tokenSnapshot = () => readStoredSession()?.token ?? null;
const roleSnapshot = () => readStoredSession()?.user.role ?? null;
const serverSnapshot = () => null;

export function useSessionToken(): string | null {
  return useSyncExternalStore(subscribeSession, tokenSnapshot, serverSnapshot);
}

export function useSessionRole(): string | null {
  return useSyncExternalStore(subscribeSession, roleSnapshot, serverSnapshot);
}
