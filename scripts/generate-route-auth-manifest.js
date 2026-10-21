#!/usr/bin/env node

/**
 * Route authorization manifest generator for EarnProof frontend (#332).
 *
 * This is a BUILD-TIME AUDIT TOOL, not a runtime authorization source.
 * It never gates a request — it only proves, at build/CI time, that every
 * sensitive page under `app/` has declared its auth requirements
 * explicitly (or is explicitly marked public), so a new protected page
 * can't silently ship with no classification at all.
 *
 * Each `page.tsx` under `app/` must export a `routeAuth` object:
 *
 *   export const routeAuth = {
 *     access: "public" | "protected",
 *     // Required when access is "protected":
 *     role: string | null,          // minimum role, or null for "any authenticated user"
 *     capability: string | null,    // required capability flag, or null
 *     cache: "no-store" | "private" | "public",
 *   };
 *
 * A nested route inherits its nearest ancestor's `routeAuth` unless it
 * exports its own — an explicit export always overrides inheritance, even
 * to loosen it (e.g. a public embed route nested under a protected
 * parent), which is intentional and required for cases like
 * `/embed/v1/verify/[id]` and `/verify/[proofId]` (public verification
 * routes nested under otherwise-private trees).
 *
 * Routes that are deliberately exempt from classification (e.g. a route
 * group layout with no real page, Next.js special files) are listed in
 * EXEMPT_ROUTES below with a documented reason — anything not listed and
 * not classified fails the build.
 */

const fs = require('fs');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(APP_ROOT, 'app');

const ACCESS_TYPES = { PUBLIC: 'public', PROTECTED: 'protected' };

/**
 * Routes explicitly exempt from requiring their own `routeAuth` export,
 * with the reason documented inline. Only add an entry here when the
 * route truly cannot declare routeAuth (not as a way to skip the work).
 */
const EXEMPT_ROUTES = {
  // None yet — every real page.tsx is expected to classify itself or
  // inherit explicitly from a parent `_route-auth.ts` sibling file.
};

function normalizeRoutePath(routePath) {
  const normalized = routePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  return normalized === '' ? '/' : `/${normalized}`;
}

/** Walk the app directory, collecting every page.tsx with its directory chain. */
function findPageFiles(dir, basePath = '') {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.join(basePath, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name.startsWith('_')) continue;
      results.push(...findPageFiles(fullPath, relativePath));
    } else if (entry.name === 'page.tsx') {
      results.push({ fullPath, routePath: basePath || '/', dir });
    }
  }

  return results;
}

/**
 * Extract a `routeAuth` object literal from a file's source via a bounded
 * regex scan (not a full parser — acceptable here because the manifest is
 * only ever this tool's own input; a malformed export simply fails to
 * match and is reported as unclassified rather than silently misread).
 */
function extractRouteAuth(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');

  const match = content.match(/export\s+const\s+routeAuth\s*(?::\s*[\w.<>[\] ]+)?\s*=\s*({[\s\S]*?^});/m);
  if (!match) return null;

  const accessMatch = match[1].match(/access\s*:\s*["'](public|protected)["']/);
  const roleMatch = match[1].match(/role\s*:\s*["']([^"']+)["']/);
  const capabilityMatch = match[1].match(/capability\s*:\s*["']([^"']+)["']/);
  const cacheMatch = match[1].match(/cache\s*:\s*["'](no-store|private|public)["']/);

  if (!accessMatch) return { malformed: true, raw: match[1] };

  return {
    access: accessMatch[1],
    role: roleMatch ? roleMatch[1] : null,
    capability: capabilityMatch ? capabilityMatch[1] : null,
    cache: cacheMatch ? cacheMatch[1] : null,
  };
}

/**
 * Look for a `_route-auth.ts` sibling file in `dir` or any ancestor under
 * APP_DIR, used to declare a shared `routeAuth` for every page beneath it
 * that doesn't export its own. Returns the nearest ancestor's routeAuth,
 * or null if none declare one.
 */
function findInheritedRouteAuth(dir) {
  let current = dir;
  while (current.startsWith(APP_DIR)) {
    const sharedFile = path.join(current, '_route-auth.ts');
    if (fs.existsSync(sharedFile)) {
      const routeAuth = extractRouteAuth(sharedFile);
      if (routeAuth && !routeAuth.malformed) return routeAuth;
    }
    if (current === APP_DIR) break;
    current = path.dirname(current);
  }
  return null;
}

function generateRouteAuthManifest() {
  const pageFiles = findPageFiles(APP_DIR);
  const manifest = [];

  for (const pageFile of pageFiles) {
    const routePath = normalizeRoutePath(pageFile.routePath);
    if (EXEMPT_ROUTES[routePath]) {
      manifest.push({
        route: routePath,
        filePath: path.relative(APP_ROOT, pageFile.fullPath),
        exempt: true,
        exemptReason: EXEMPT_ROUTES[routePath],
      });
      continue;
    }

    const ownRouteAuth = extractRouteAuth(pageFile.fullPath);
    const inheritedRouteAuth = ownRouteAuth ? null : findInheritedRouteAuth(pageFile.dir);
    const effectiveRouteAuth = ownRouteAuth && !ownRouteAuth.malformed ? ownRouteAuth : inheritedRouteAuth;

    manifest.push({
      route: routePath,
      filePath: path.relative(APP_ROOT, pageFile.fullPath),
      exempt: false,
      declaredOwn: Boolean(ownRouteAuth && !ownRouteAuth.malformed),
      inherited: Boolean(!ownRouteAuth && inheritedRouteAuth),
      malformed: Boolean(ownRouteAuth && ownRouteAuth.malformed),
      routeAuth: effectiveRouteAuth,
    });
  }

  return manifest;
}

function validateRouteAuthManifest(manifest) {
  const errors = [];

  for (const entry of manifest) {
    if (entry.exempt) continue;

    if (entry.malformed) {
      errors.push(`[MALFORMED_ROUTE_AUTH] ${entry.route} (${entry.filePath}): routeAuth export could not be parsed.`);
      continue;
    }

    if (!entry.routeAuth) {
      errors.push(
        `[UNCLASSIFIED_ROUTE] ${entry.route} (${entry.filePath}): no routeAuth export, and no ancestor ` +
          `_route-auth.ts declares one. Every page must explicitly declare { access: "public" | "protected", ... } ` +
          `or be added to EXEMPT_ROUTES with a documented reason.`,
      );
      continue;
    }

    if (entry.routeAuth.access === ACCESS_TYPES.PROTECTED) {
      if (!entry.routeAuth.cache) {
        errors.push(
          `[MISSING_CACHE_REQUIREMENT] ${entry.route} (${entry.filePath}): protected routes must declare a ` +
            `cache requirement ("no-store", "private", or "public").`,
        );
      } else if (entry.routeAuth.cache === 'public') {
        errors.push(
          `[UNSAFE_CACHE_FOR_PROTECTED_ROUTE] ${entry.route} (${entry.filePath}): a protected route must not ` +
            `declare cache: "public" — that would let shared/CDN caches serve one user's authenticated response ` +
            `to another.`,
        );
      }
    }
  }

  return errors;
}

function main() {
  console.log('Generating route authorization manifest...');

  const manifest = generateRouteAuthManifest();
  console.log(`Found ${manifest.length} routes`);

  const manifestPath = path.join(APP_ROOT, 'scripts', 'route-auth-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Manifest written to ${manifestPath}`);

  const errors = validateRouteAuthManifest(manifest);

  if (errors.length > 0) {
    console.error('\nRoute authorization validation errors:');
    errors.forEach((error) => console.error(`  ${error}`));
    process.exitCode = 1;
  } else {
    console.log('All routes are classified!');
  }

  const protectedCount = manifest.filter((r) => r.routeAuth?.access === ACCESS_TYPES.PROTECTED).length;
  const publicCount = manifest.filter((r) => r.routeAuth?.access === ACCESS_TYPES.PUBLIC).length;
  console.log(`\nRoute Summary: ${protectedCount} protected, ${publicCount} public, ${manifest.length} total`);
}

if (require.main === module) {
  main();
}

module.exports = {
  generateRouteAuthManifest,
  validateRouteAuthManifest,
  extractRouteAuth,
  findInheritedRouteAuth,
  normalizeRoutePath,
  ACCESS_TYPES,
  EXEMPT_ROUTES,
};
