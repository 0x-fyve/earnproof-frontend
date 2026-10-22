import { cacheHeaderRules } from "@/config/cache-headers";

/**
 * Minimal re-implementation of the `:path*` matching semantics this
 * project's next.config.ts rules rely on (see
 * node_modules/next/dist/docs/.../headers.md#wildcard-path-matching):
 * `/:path*` matches every path, and `/segment/:path*` matches `/segment`
 * itself plus anything nested under it. This is not a general
 * path-to-regexp implementation — it only covers the patterns actually
 * used in config/cache-headers.ts, so it fails loudly (via the "unhandled
 * source pattern" throw) if a rule starts using a pattern this test
 * doesn't understand, rather than silently reporting a false pass.
 */
function matches(source: string, pathname: string): boolean {
  if (source === "/:path*") {
    return true;
  }
  const prefixMatch = source.match(/^(\/[a-z-]+)\/:path\*$/);
  if (prefixMatch) {
    const prefix = prefixMatch[1];
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  }
  if (!source.includes(":") && !source.includes("*")) {
    return pathname === source;
  }
  throw new Error(`Unhandled source pattern in test matcher: ${source}`);
}

/**
 * Resolves the effective Cache-Control value for a path the same way
 * Next.js resolves header overrides: apply every matching rule in array
 * order, last matching value for a given key wins. See
 * node_modules/next/dist/docs/.../headers.md#header-overriding-behavior.
 */
function cacheControlFor(pathname: string): string | undefined {
  const rules = cacheHeaderRules();
  let value: string | undefined;
  for (const rule of rules) {
    if (!matches(rule.source, pathname)) continue;
    const header = rule.headers.find((h) => h.key === "Cache-Control");
    if (header) {
      value = header.value;
    }
  }
  return value;
}

describe("cacheHeaderRules", () => {
  it("declares exactly the four documented policies", () => {
    const policies = cacheHeaderRules().map((rule) => rule.policy);
    expect(new Set(policies)).toEqual(
      new Set(["public-static", "health", "verification", "authenticated"]),
    );
  });

  it.each([
    ["/", "public, max-age=0, must-revalidate"],
    ["/how-it-works", "public, max-age=0, must-revalidate"],
    ["/privacy", "public, max-age=0, must-revalidate"],
    ["/developers", "public, max-age=0, must-revalidate"],
    ["/issuers", "public, max-age=0, must-revalidate"],
  ])(
    "serves public static route %s as revalidate-on-use, not no-store",
    (pathname, expected) => {
      expect(cacheControlFor(pathname)).toBe(expected);
    },
  );

  it("never lets a public-static rule apply no-store", () => {
    for (const pathname of ["/", "/how-it-works", "/developers"]) {
      expect(cacheControlFor(pathname)).not.toMatch(/no-store/);
    }
  });

  it.each(["/status"])(
    "marks the health surface %s as no-store",
    (pathname) => {
      expect(cacheControlFor(pathname)).toBe("no-store, private");
    },
  );

  it.each(["/verify", "/verify/credential", "/verify/scan"])(
    "marks the verification route %s as no-store",
    (pathname) => {
      expect(cacheControlFor(pathname)).toBe("no-store, private");
    },
  );

  it.each(["/proofs", "/settings"])(
    "marks the authenticated route %s as no-store",
    (pathname) => {
      expect(cacheControlFor(pathname)).toBe("no-store, private");
    },
  );

  it.each([
    "/settings/security",
    "/settings/payments",
    "/settings/sessions",
    "/settings/audit",
  ])("marks the nested settings route %s as no-store", (pathname) => {
    expect(cacheControlFor(pathname)).toBe("no-store, private");
  });

  it("resolves the last matching rule, so overrides always win over the public default", () => {
    const rules = cacheHeaderRules();
    const publicIndex = rules.findIndex((r) => r.policy === "public-static");
    const overrideIndices = rules
      .filter((r) => r.policy !== "public-static")
      .map((r) => rules.indexOf(r));

    expect(publicIndex).toBe(0);
    for (const index of overrideIndices) {
      expect(index).toBeGreaterThan(publicIndex);
    }
  });
});
