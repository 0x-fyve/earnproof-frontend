import {
  classifySeverity,
  extractSafeReplacementLink,
  formatSunsetDateWithTimezone,
  parseDeprecationHeaders,
} from "../deprecation-warnings";

function headers(values: Record<string, string>): Headers {
  const h = new Headers();
  for (const [key, value] of Object.entries(values)) {
    h.set(key, value);
  }
  return h;
}

describe("parseDeprecationHeaders — missing headers", () => {
  it("returns null when neither Deprecation nor Sunset is present", () => {
    expect(parseDeprecationHeaders(headers({}))).toBeNull();
  });

  it("returns null for an unrelated set of headers", () => {
    expect(parseDeprecationHeaders(headers({ "Content-Type": "application/json" }))).toBeNull();
  });
});

describe("parseDeprecationHeaders — future sunset", () => {
  it("classifies a sunset date far in the future as 'future'", () => {
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
    const result = parseDeprecationHeaders(
      headers({ Deprecation: "true", Sunset: farFuture }),
    );
    expect(result?.isDeprecated).toBe(true);
    expect(result?.severity).toBe("future");
  });
});

describe("parseDeprecationHeaders — imminent sunset", () => {
  it("classifies a sunset date within the imminent window as 'imminent'", () => {
    const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toUTCString();
    const result = parseDeprecationHeaders(headers({ Deprecation: "true", Sunset: soon }));
    expect(result?.severity).toBe("imminent");
  });

  it("the imminent boundary itself (exactly 30 days out) is imminent, not future", () => {
    const now = new Date();
    const exactlyAtBoundary = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(classifySeverity(exactlyAtBoundary, now)).toBe("imminent");
  });

  it("just past the boundary (31 days out) is future", () => {
    const now = new Date();
    const justPast = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);
    expect(classifySeverity(justPast, now)).toBe("future");
  });
});

describe("parseDeprecationHeaders — expired sunset", () => {
  it("classifies a sunset date in the past as 'expired'", () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toUTCString();
    const result = parseDeprecationHeaders(headers({ Deprecation: "true", Sunset: past }));
    expect(result?.severity).toBe("expired");
  });

  it("a sunset date exactly at the current moment is expired (boundary inclusive)", () => {
    const now = new Date();
    expect(classifySeverity(now, now)).toBe("expired");
  });
});

describe("parseDeprecationHeaders — Deprecation present without Sunset", () => {
  it("still reports isDeprecated true with a null severity", () => {
    const result = parseDeprecationHeaders(headers({ Deprecation: "true" }));
    expect(result?.isDeprecated).toBe(true);
    expect(result?.sunsetAt).toBeNull();
    expect(result?.severity).toBeNull();
  });
});

describe("parseDeprecationHeaders — Sunset present without Deprecation", () => {
  it("reports isDeprecated false but still parses the sunset date", () => {
    const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toUTCString();
    const result = parseDeprecationHeaders(headers({ Sunset: future }));
    expect(result?.isDeprecated).toBe(false);
    expect(result?.sunsetAt).not.toBeNull();
  });
});

describe("parseDeprecationHeaders — malformed Sunset value", () => {
  it("treats an unparseable Sunset date as null rather than throwing", () => {
    const result = parseDeprecationHeaders(
      headers({ Deprecation: "true", Sunset: "not-a-real-date" }),
    );
    expect(result?.sunsetAt).toBeNull();
    expect(result?.severity).toBeNull();
  });
});

describe("extractSafeReplacementLink — replaced version", () => {
  it("extracts a valid rel=deprecation link pointing at the API's own origin", () => {
    const base = "http://localhost:4000";
    const link = `<${base}/api/v2/docs>; rel="deprecation"`;
    expect(extractSafeReplacementLink(link)).toBe(`${base}/api/v2/docs`);
  });

  it("returns null when no rel=deprecation link is present", () => {
    const link = `<https://example.com/other>; rel="alternate"`;
    expect(extractSafeReplacementLink(link)).toBeNull();
  });

  it("returns null for a malformed Link header", () => {
    expect(extractSafeReplacementLink("not a link header at all")).toBeNull();
  });

  it("returns null for a javascript: scheme masquerading as a deprecation link", () => {
    const link = `<javascript:alert(1)>; rel="deprecation"`;
    expect(extractSafeReplacementLink(link)).toBeNull();
  });

  it("returns null for a link pointing at an untrusted (non-API) origin", () => {
    const link = `<https://attacker.example.com/phish>; rel="deprecation"`;
    expect(extractSafeReplacementLink(link)).toBeNull();
  });

  it("picks the rel=deprecation link out of a multi-link header with other rels present", () => {
    const base = "http://localhost:4000";
    const link = `<https://example.com/other>; rel="alternate", <${base}/api/v2>; rel="deprecation"`;
    expect(extractSafeReplacementLink(link)).toBe(`${base}/api/v2`);
  });
});

describe("parseDeprecationHeaders — full replaced-version scenario", () => {
  it("surfaces isDeprecated, severity, and a validated replacement link together", () => {
    const base = "http://localhost:4000";
    const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toUTCString();
    const result = parseDeprecationHeaders(
      headers({
        Deprecation: "true",
        Sunset: soon,
        Link: `<${base}/api/v2/docs>; rel="deprecation"`,
      }),
    );
    expect(result?.isDeprecated).toBe(true);
    expect(result?.severity).toBe("imminent");
    expect(result?.replacementHref).toBe(`${base}/api/v2/docs`);
  });

  it("never renders a malformed/untrusted link even alongside a valid deprecation signal", () => {
    const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toUTCString();
    const result = parseDeprecationHeaders(
      headers({
        Deprecation: "true",
        Sunset: soon,
        Link: `<javascript:alert(1)>; rel="deprecation"`,
      }),
    );
    expect(result?.isDeprecated).toBe(true);
    expect(result?.replacementHref).toBeNull();
  });
});

describe("formatSunsetDateWithTimezone", () => {
  it("includes a timezone name in the formatted output", () => {
    const formatted = formatSunsetDateWithTimezone(new Date("2026-12-31T12:00:00Z"));
    // Intl.DateTimeFormat's timeZoneName: "short" always appends an
    // abbreviation distinct from the date/time digits — e.g. "GMT",
    // "UTC", "PST", or an offset form like "GMT+1" depending on the
    // runtime's resolved timezone, so this checks for the presence of a
    // recognizable zone marker rather than assuming a specific format.
    expect(formatted).toMatch(/GMT|UTC|[A-Z]{2,5}$/);
  });

  it("includes the exact date, not a relative phrase", () => {
    const formatted = formatSunsetDateWithTimezone(new Date("2026-12-31T12:00:00Z"));
    expect(formatted).toMatch(/2026/);
    expect(formatted).not.toMatch(/soon|ago|later/i);
  });
});
