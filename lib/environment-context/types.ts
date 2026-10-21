/**
 * #233: organizations need a visually and behaviorally distinct sandbox
 * vs. production context so that sandbox credentials/records never leak
 * into a production workflow.
 *
 * There is no `environment` field anywhere on the generated API types
 * (see lib/api/generated/v1.ts's Organization) or on the session/auth
 * contracts - the backend does not model sandbox vs. production as a
 * first-class concept per organization. This is a disclosed scope-down:
 * environment is tracked entirely on the client, per organization, and
 * is not (and cannot be) validated against a server-side record. A real
 * implementation would need the backend to expose which environment(s)
 * an organization's credentials/records belong to.
 */
export const ENVIRONMENTS = ["sandbox", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const DEFAULT_ENVIRONMENT: Environment = "sandbox";

export function isEnvironment(value: unknown): value is Environment {
  return typeof value === "string" && (ENVIRONMENTS as readonly string[]).includes(value);
}
