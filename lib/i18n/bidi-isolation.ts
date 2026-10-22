/**
 * Bidirectional-text isolation for identifiers and addresses (#228).
 *
 * Two distinct problems, both addressed here:
 *
 * 1. Spoofing via bidi control characters: Unicode characters like RLO
 *    (U+202E), LRO (U+202D), RLE/LRE (U+202B/U+202A), and the newer
 *    isolate variants RLI/LRI/FSI/PDI can reorder how surrounding text
 *    is *displayed* without changing the underlying bytes - the
 *    "Trojan Source" class of attack. A wallet address or hash is
 *    supposed to be opaque, copy-pasted data; if one somehow contained
 *    an embedded RLO, it could visually disguise its own prefix/suffix
 *    (e.g. making a malicious address's tail look like its head).
 *    `stripBidiControlCharacters` removes these characters from what is
 *    DISPLAYED, while the original, byte-for-byte unmodified value is
 *    always what gets copied (see cryptographic-identifier.tsx, which
 *    already keeps `fullValue` separate from any display transform).
 *
 * 2. Reordering by surrounding RTL context: even with no malicious
 *    characters in the identifier itself, rendering "GA7Q...XYZ" inside
 *    an RTL sentence (e.g. Arabic/Hebrew UI copy) can cause the
 *    identifier's own LTR characters to visually reorder relative to
 *    the surrounding punctuation, because bidi algorithms look at
 *    context, not just the substring. `isolationWrap` brackets the
 *    value in Unicode isolate marks (FSI/PDI) so its internal rendering
 *    order is locked regardless of what's around it, and
 *    `BIDI_ISOLATE_DIR_ATTRS` gives the matching `dir`/CSS
 *    `unicode-bidi: isolate` for a DOM element doing the same thing
 *    without relying on the isolate characters alone.
 */

/**
 * Explicit bidi formatting/control characters that can alter display
 * order: RLO, LRO, RLE, LRE, PDF (legacy embedding/override controls),
 * plus RLI, LRI, FSI, PDI (the modern isolate controls) and ALM/LRM/RLM
 * (directional marks). Stripped from display text — an identifier has no
 * legitimate reason to contain any of these.
 */
const BIDI_CONTROL_CHARACTERS_PATTERN =
  /[‎‏‪-‮⁦-⁩؜]/g;

/**
 * Removes bidi control characters from `value` for DISPLAY. Never call
 * this on a value before it is copied to the clipboard or sent anywhere
 * — callers must keep the original string for that and only pass the
 * stripped result to rendering. See cryptographic-identifier.tsx's
 * `fullValue`/display separation for the pattern this expects callers to
 * follow.
 */
export function stripBidiControlCharacters(value: string): string {
  return value.replace(BIDI_CONTROL_CHARACTERS_PATTERN, "");
}

export function containsBidiControlCharacters(value: string): boolean {
  // The shared pattern has the `g` flag (needed for `.replace` in
  // stripBidiControlCharacters), which makes `.test()` stateful across
  // calls via `lastIndex` — constructing a fresh RegExp here avoids that
  // trap rather than relying on callers to never call this twice.
  return new RegExp(BIDI_CONTROL_CHARACTERS_PATTERN.source).test(value);
}

// Unicode isolate marks: First Strong Isolate ... Pop Directional Isolate.
const FIRST_STRONG_ISOLATE = "⁨";
const POP_DIRECTIONAL_ISOLATE = "⁩";

/**
 * Wraps `value` (already stripped of bidi control characters — callers
 * should run `stripBidiControlCharacters` first) in Unicode isolate
 * marks, so its own internal character order renders consistently
 * regardless of surrounding RTL/LTR context. This is purely a DISPLAY
 * transform: the isolate marks are additional characters wrapped around
 * the value and must never be included in anything copied or sent — see
 * `isolationWrap`'s companion `fullValue` contract in callers.
 */
export function isolationWrap(value: string): string {
  return `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`;
}

/**
 * DOM-level attributes that achieve the same isolation as
 * `isolationWrap`, for a `<span>`/`<bdi>`-style element wrapping an
 * identifier, as an alternative (or belt-and-suspenders addition) to the
 * Unicode isolate characters: `dir="ltr"` fixes the element's own base
 * direction (every identifier this app displays — Stellar addresses,
 * hex hashes — is LTR by construction), and `unicode-bidi: isolate` (via
 * the `bdi`-equivalent `style`) prevents the browser's bidi algorithm
 * from looking past this element's boundary into the surrounding text.
 */
export const BIDI_ISOLATE_DIR = "ltr" as const;
export const BIDI_ISOLATE_STYLE = { unicodeBidi: "isolate" as const };

/**
 * Full display-safe transform for an identifier: strips bidi control
 * characters, then wraps in isolate marks. Returns both the transformed
 * display string and a flag noting whether stripping changed anything
 * (useful for surfacing "this value contained hidden formatting
 * characters" to the caller, e.g. for an audit/warning banner, without
 * this module deciding whether that warning should be shown).
 */
export function makeBidiSafeForDisplay(value: string): {
  displayValue: string;
  hadBidiControlCharacters: boolean;
} {
  const hadBidiControlCharacters = containsBidiControlCharacters(value);
  const stripped = stripBidiControlCharacters(value);
  return {
    displayValue: isolationWrap(stripped),
    hadBidiControlCharacters,
  };
}
