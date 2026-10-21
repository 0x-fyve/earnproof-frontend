import { test } from "@playwright/test";

/**
 * Capability discovery smoke coverage (#334's "capability discovery"
 * requirement).
 *
 * As of this suite's authoring, `lib/api/capabilities.ts` documents (see
 * its module-level comment) that the real EarnProof API has no capability
 * document endpoint: `fetchMockCapabilityDocument` is an explicitly-named
 * client-side stand-in, and `lib/api/openapi/earnproof-api.v1.json` has no
 * corresponding path. There is nothing for this spec to make a live
 * request against yet without inventing a path the contract doesn't
 * define — doing so would make this suite assert behavior of an endpoint
 * that may not match whatever path/shape the real one eventually takes.
 *
 * This spec is deliberately kept as a dedicated, always-skipped file
 * (rather than silently omitted) for two reasons: `npm run test:e2e:api`
 * then visibly reports 0/1 "skipped" for capability discovery instead of
 * looking like coverage was never considered, and the skip reason below
 * is the pointer for whoever adds the real endpoint to come fill this in.
 */
test.describe("API contract smoke: capability discovery", () => {
  test("GET capability document (no live endpoint exists yet)", async () => {
    test.skip(
      true,
      "No capability-document endpoint exists in lib/api/openapi/earnproof-api.v1.json yet — " +
        "lib/api/capabilities.ts's fetchMockCapabilityDocument is a client-side mock, not a real " +
        "backend path. Replace this skip with a real request once that endpoint ships.",
    );
  });
});
