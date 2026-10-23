/**
 * Opaque pagination cursors, shared by cursor-paginated endpoints.
 *
 * A cursor is only ever copied from a server `nextCursor` back into a
 * request. The client bounds its length and character set so a hostile or
 * buggy response cannot smuggle a URL, markup or an oversized value into a
 * later request.
 */

/** Longest cursor the client will send or accept. */
export const MAX_CURSOR_LENGTH = 512;

const CURSOR_PATTERN = /^[A-Za-z0-9_\-.=:~]+$/;

export function isValidOpaqueCursor(cursor: unknown): cursor is string {
  return (
    typeof cursor === "string" &&
    cursor.length > 0 &&
    cursor.length <= MAX_CURSOR_LENGTH &&
    CURSOR_PATTERN.test(cursor)
  );
}
