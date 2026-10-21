const {
  generateRouteAuthManifest,
  validateRouteAuthManifest,
  extractRouteAuth,
  normalizeRoutePath,
  ACCESS_TYPES,
} = require("./generate-route-auth-manifest");

describe("generateRouteAuthManifest (#332)", () => {
  it("classifies every real page.tsx under app/ with no unclassified or malformed entries", () => {
    const manifest = generateRouteAuthManifest();
    const errors = validateRouteAuthManifest(manifest);

    expect(manifest.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  it("gives every non-exempt route an effective routeAuth, own or inherited", () => {
    const manifest = generateRouteAuthManifest();
    for (const entry of manifest) {
      if (entry.exempt) continue;
      expect(entry.routeAuth).not.toBeNull();
      expect([ACCESS_TYPES.PUBLIC, ACCESS_TYPES.PROTECTED]).toContain(entry.routeAuth.access);
    }
  });

  it("classifies settings routes as protected, inherited from app/settings/_route-auth.ts", () => {
    const manifest = generateRouteAuthManifest();
    const usage = manifest.find((r) => r.route === "/settings/usage");

    expect(usage).toBeDefined();
    expect(usage.routeAuth.access).toBe(ACCESS_TYPES.PROTECTED);
    expect(usage.routeAuth.cache).toBe("no-store");
    expect(usage.inherited).toBe(true);
  });

  it("classifies a page-level override independently of its section default", () => {
    const manifest = generateRouteAuthManifest();
    const approvals = manifest.find((r) => r.route === "/settings/approvals");

    expect(approvals).toBeDefined();
    expect(approvals.declaredOwn).toBe(true);
    expect(approvals.routeAuth.access).toBe(ACCESS_TYPES.PROTECTED);
    expect(approvals.routeAuth.role).toBe("ADMIN");
  });

  it("classifies the embed verification widget as public, overriding its default cache setting", () => {
    const manifest = generateRouteAuthManifest();
    const embed = manifest.find((r) => r.route === "/embed/v1/verify/[id]");

    expect(embed).toBeDefined();
    expect(embed.declaredOwn).toBe(true);
    expect(embed.routeAuth.access).toBe(ACCESS_TYPES.PUBLIC);
    expect(embed.routeAuth.cache).toBe("no-store");
  });

  it("classifies dynamic ([param]) routes the same as static ones", () => {
    const manifest = generateRouteAuthManifest();
    const dynamicRoutes = manifest.filter((r) => r.route.includes("["));

    expect(dynamicRoutes.length).toBeGreaterThan(0);
    for (const entry of dynamicRoutes) {
      expect(entry.routeAuth).not.toBeNull();
    }
  });

  it("covers verification routes as public but never cacheable, overriding the app-root cache default", () => {
    const manifest = generateRouteAuthManifest();
    const verifyRoute = manifest.find((r) => r.route === "/verify/[proofId]");

    expect(verifyRoute).toBeDefined();
    expect(verifyRoute.routeAuth.access).toBe(ACCESS_TYPES.PUBLIC);
    expect(verifyRoute.routeAuth.cache).toBe("no-store");
  });
});

describe("validateRouteAuthManifest (#332)", () => {
  it("flags a route with no routeAuth and no inherited default as UNCLASSIFIED_ROUTE", () => {
    const manifest = [
      { route: "/mystery", filePath: "app/mystery/page.tsx", exempt: false, routeAuth: null, malformed: false },
    ];
    const errors = validateRouteAuthManifest(manifest);
    expect(errors.some((e) => e.includes("UNCLASSIFIED_ROUTE"))).toBe(true);
  });

  it("flags a malformed routeAuth export", () => {
    const manifest = [
      { route: "/broken", filePath: "app/broken/page.tsx", exempt: false, routeAuth: null, malformed: true },
    ];
    const errors = validateRouteAuthManifest(manifest);
    expect(errors.some((e) => e.includes("MALFORMED_ROUTE_AUTH"))).toBe(true);
  });

  it("flags a protected route with no declared cache requirement", () => {
    const manifest = [
      {
        route: "/no-cache",
        filePath: "app/no-cache/page.tsx",
        exempt: false,
        malformed: false,
        routeAuth: { access: "protected", role: null, capability: null, cache: null },
      },
    ];
    const errors = validateRouteAuthManifest(manifest);
    expect(errors.some((e) => e.includes("MISSING_CACHE_REQUIREMENT"))).toBe(true);
  });

  it("flags a protected route that declares cache: public as unsafe", () => {
    const manifest = [
      {
        route: "/bad-cache",
        filePath: "app/bad-cache/page.tsx",
        exempt: false,
        malformed: false,
        routeAuth: { access: "protected", role: null, capability: null, cache: "public" },
      },
    ];
    const errors = validateRouteAuthManifest(manifest);
    expect(errors.some((e) => e.includes("UNSAFE_CACHE_FOR_PROTECTED_ROUTE"))).toBe(true);
  });

  it("does not flag a public route for a missing cache requirement", () => {
    const manifest = [
      {
        route: "/fine",
        filePath: "app/fine/page.tsx",
        exempt: false,
        malformed: false,
        routeAuth: { access: "public", role: null, capability: null, cache: null },
      },
    ];
    expect(validateRouteAuthManifest(manifest)).toEqual([]);
  });

  it("skips exempt routes entirely", () => {
    const manifest = [
      { route: "/exempt-thing", filePath: "app/exempt-thing/page.tsx", exempt: true, exemptReason: "test" },
    ];
    expect(validateRouteAuthManifest(manifest)).toEqual([]);
  });
});

describe("extractRouteAuth (#332)", () => {
  it("returns null for a file with no routeAuth export", () => {
    expect(extractRouteAuth(__filename)).toBeNull();
  });

  it("returns null for a nonexistent file", () => {
    expect(extractRouteAuth("/no/such/file.ts")).toBeNull();
  });
});

describe("normalizeRoutePath (#332)", () => {
  it("normalizes an empty path to the root route", () => {
    expect(normalizeRoutePath("")).toBe("/");
  });

  it("ensures a single leading slash and no trailing slash", () => {
    expect(normalizeRoutePath("settings/usage/")).toBe("/settings/usage");
    expect(normalizeRoutePath("//settings/usage//")).toBe("/settings/usage");
  });
});
