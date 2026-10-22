/**
 * Centralized live-region announcement coordinator (#252).
 *
 * Independent forms and background jobs (proof submission, payment sync,
 * credential import/export, webhook management) each used to be free to
 * render their own ad-hoc `aria-live` region. With several mounted at once,
 * a screen reader can announce the same status twice, announce two
 * operations' statuses in an order that doesn't match when they actually
 * happened, or simply go silent if a region unmounts mid-update. This module
 * is the single source of truth: one polite queue and one assertive queue,
 * fed by every flow in the app through `announce()` / `useAnnounce()`.
 *
 * Design:
 *  - Two independent priority lanes ("polite", "assertive") mirroring the
 *    two ARIA live-region politeness levels. They are never merged into one
 *    queue because assistive tech treats them as genuinely different
 *    channels (assertive interrupts; polite waits its turn).
 *  - Ordering: within a lane, announcements are delivered in the order
 *    `announce()` was called, keyed by a monotonic sequence number — not by
 *    when the async operation that triggered them *finishes*. A
 *    later-started-but-faster operation that calls `announce()` after an
 *    earlier operation already called it will still queue behind it. (If a
 *    caller wants "finish order", it should call `announce()` only when the
 *    result is known, which is what every integration in this change does.)
 *  - Dedup: an announcement identical to the immediately-preceding one in
 *    the same lane is dropped. This specifically targets "re-announce the
 *    identical message twice in a row" (e.g. a status effect re-running with
 *    the same text) without suppressing a legitimately repeated error
 *    (two distinct failures with the same message, separated by any other
 *    announcement, are each delivered).
 *  - Scrubbing: every message is passed through `redactMessage` (the same
 *    redaction already used for client error telemetry, see
 *    lib/telemetry/redact.ts) before it ever reaches the DOM, so a caller
 *    that accidentally interpolates a raw proof id, wallet address, token,
 *    or similar cannot leak it into a live region.
 *  - No focus movement: the coordinator only ever changes the text content
 *    of its own off-screen live regions. It never calls `.focus()`,
 *    `scrollIntoView`, or otherwise touches the DOM outside those two
 *    regions, so an announcement can never steal focus from whatever the
 *    user is doing.
 */

import { redactMessage } from "@/lib/telemetry/redact";

export type AnnouncementPoliteness = "polite" | "assertive";

export interface Announcement {
  /** Monotonic, coordinator-assigned; defines delivery order within a lane. */
  readonly sequence: number;
  readonly politeness: AnnouncementPoliteness;
  /** Already scrubbed via redactMessage — safe to render verbatim. */
  readonly message: string;
  /** Logical source, for debugging/tests only; never rendered. */
  readonly source?: string;
}

type Listener = (state: AnnouncerState) => void;

export interface AnnouncerState {
  readonly polite: Announcement | null;
  readonly assertive: Announcement | null;
}

export interface AnnounceOptions {
  /** Defaults to "polite". Use "assertive" only for errors/interruptions. */
  politeness?: AnnouncementPoliteness;
  /** Logical source name, surfaced only in tests/devtools. */
  source?: string;
}

/**
 * One coordinator instance holds the two lanes' current (latest-delivered)
 * announcement plus enough history to dedup against. It is deliberately not
 * a queue that drains over time — a live region only ever needs to reflect
 * the latest announcement in each lane, and assistive tech reads whatever
 * text is currently in the region when it changes. "Ordering" therefore
 * means "later announce() calls always overwrite earlier ones in the same
 * lane, never the reverse", which the sequence number enforces defensively
 * even if calls resolve out of the order they were issued from async code.
 */
export class LiveAnnouncer {
  private sequenceCounter = 0;
  private lastDeliveredSequence: Record<AnnouncementPoliteness, number> = {
    polite: -1,
    assertive: -1,
  };
  private lastMessage: Record<AnnouncementPoliteness, string | null> = {
    polite: null,
    assertive: null,
  };
  private state: AnnouncerState = { polite: null, assertive: null };
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): AnnouncerState {
    return this.state;
  }

  /**
   * Announce a status message. Returns the sequence number assigned (useful
   * in tests), or null if the message was dropped as a duplicate.
   */
  announce(message: string, options: AnnounceOptions = {}): number | null {
    const politeness = options.politeness ?? "polite";
    const scrubbed = redactMessage(message) || message.trim();
    if (!scrubbed) {
      return null;
    }

    // Dedup: identical to the immediately-preceding message in this lane.
    if (this.lastMessage[politeness] === scrubbed) {
      return null;
    }

    const sequence = this.sequenceCounter++;

    // Guard against a stale async caller delivering out of order: never let
    // an earlier-sequenced announcement overwrite a later-delivered one.
    if (sequence < this.lastDeliveredSequence[politeness]) {
      return null;
    }

    this.lastDeliveredSequence[politeness] = sequence;
    this.lastMessage[politeness] = scrubbed;

    const entry: Announcement = {
      sequence,
      politeness,
      message: scrubbed,
      source: options.source,
    };

    this.state =
      politeness === "polite"
        ? { ...this.state, polite: entry }
        : { ...this.state, assertive: entry };

    this.notify();
    return sequence;
  }

  /** Clears a lane (e.g. on route change) without announcing anything new. */
  clear(politeness?: AnnouncementPoliteness): void {
    if (!politeness) {
      this.state = { polite: null, assertive: null };
      this.lastMessage = { polite: null, assertive: null };
    } else {
      this.state = { ...this.state, [politeness]: null };
      this.lastMessage[politeness] = null;
    }
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
