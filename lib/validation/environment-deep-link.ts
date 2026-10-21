import { isEnvironment, type Environment } from "@/lib/environment-context/types";

/**
 * #233 acceptance criterion: "Deep links validate the requested
 * environment before loading data." A deep link carries its intended
 * environment as an `env` search param (e.g. a shared link into a
 * sandbox dashboard should never silently render production data just
 * because production happens to be the active context, or vice versa).
 *
 * This only validates the param's shape/presence against the active
 * environment - there is no backend record of which environment a given
 * resource actually belongs to (see lib/environment-context/types.ts's
 * disclosure), so a mismatch here means "this link disagrees with the
 * environment you're currently in," not "this link is cryptographically
 * proven to belong to that environment."
 */
export type DeepLinkEnvironmentCheck =
  | { status: "match"; environment: Environment }
  | { status: "no-param"; environment: Environment }
  | { status: "invalid-param"; requested: string }
  | { status: "mismatch"; requested: Environment; active: Environment };

export function checkDeepLinkEnvironment(
  searchParams: URLSearchParams | Record<string, string | string[] | undefined>,
  activeEnvironment: Environment,
): DeepLinkEnvironmentCheck {
  const raw =
    searchParams instanceof URLSearchParams
      ? searchParams.get("env")
      : normalizeRecordValue(searchParams.env);

  if (raw === null || raw === undefined) {
    return { status: "no-param", environment: activeEnvironment };
  }

  if (!isEnvironment(raw)) {
    return { status: "invalid-param", requested: raw };
  }

  if (raw !== activeEnvironment) {
    return { status: "mismatch", requested: raw, active: activeEnvironment };
  }

  return { status: "match", environment: activeEnvironment };
}

function normalizeRecordValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}
