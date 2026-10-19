import { checkDeepLinkEnvironment } from "../environment-deep-link";

describe("checkDeepLinkEnvironment", () => {
  it("reports no-param when the link carries no env param", () => {
    const result = checkDeepLinkEnvironment(new URLSearchParams(""), "sandbox");
    expect(result).toEqual({ status: "no-param", environment: "sandbox" });
  });

  it("reports match when the link's env agrees with the active environment", () => {
    const result = checkDeepLinkEnvironment(new URLSearchParams("env=production"), "production");
    expect(result).toEqual({ status: "match", environment: "production" });
  });

  it("reports mismatch when the link's env disagrees with the active environment", () => {
    const result = checkDeepLinkEnvironment(new URLSearchParams("env=production"), "sandbox");
    expect(result).toEqual({ status: "mismatch", requested: "production", active: "sandbox" });
  });

  it("reports invalid-param for an unrecognized env value", () => {
    const result = checkDeepLinkEnvironment(new URLSearchParams("env=staging"), "sandbox");
    expect(result).toEqual({ status: "invalid-param", requested: "staging" });
  });

  it("accepts a plain search-params record (e.g. Next.js page props)", () => {
    const result = checkDeepLinkEnvironment({ env: "production" }, "production");
    expect(result).toEqual({ status: "match", environment: "production" });
  });

  it("takes the first value when a record param is an array", () => {
    const result = checkDeepLinkEnvironment({ env: ["production", "sandbox"] }, "production");
    expect(result).toEqual({ status: "match", environment: "production" });
  });

  it("treats a missing record key as no-param", () => {
    const result = checkDeepLinkEnvironment({}, "sandbox");
    expect(result).toEqual({ status: "no-param", environment: "sandbox" });
  });

  it("treats an empty string env param as invalid, not absent", () => {
    const result = checkDeepLinkEnvironment(new URLSearchParams("env="), "sandbox");
    expect(result).toEqual({ status: "invalid-param", requested: "" });
  });
});
