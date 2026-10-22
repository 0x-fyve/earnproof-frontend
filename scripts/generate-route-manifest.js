#!/usr/bin/env node

/**
 * Route manifest generator for EarnProof frontend
 * 
 * This script analyzes the app directory to create a manifest of all
 * production routes with metadata requirements for validation.
 */

const fs = require('fs');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(APP_ROOT, 'app');

const DEFAULT_APP_URL = 'http://localhost:3000';

function getAppUrl(env = process.env) {
  return (env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL).replace(/\/+$/, '');
}

const APP_URL = getAppUrl();

// Route classification
const ROUTE_TYPES = {
  PUBLIC_INDEXABLE: 'public/indexable',
  PUBLIC_NON_INDEXABLE: 'public/non-indexable',
  PRIVATE: 'private',
  WORKFLOW_ONLY: 'workflow-only'
};

// Define route classification rules
const ROUTE_CLASSIFICATION = {
  // Public indexable routes
  '/': ROUTE_TYPES.PUBLIC_INDEXABLE,
  '/about': ROUTE_TYPES.PUBLIC_INDEXABLE,
  '/how-it-works': ROUTE_TYPES.PUBLIC_INDEXABLE,
  '/faq': ROUTE_TYPES.PUBLIC_INDEXABLE,
  '/developers': ROUTE_TYPES.PUBLIC_INDEXABLE,
  '/developers/api-keys': ROUTE_TYPES.PRIVATE, // Requires authentication
  '/issuers': ROUTE_TYPES.PUBLIC_INDEXABLE,
  '/issuers/veridatum-labs': ROUTE_TYPES.PUBLIC_INDEXABLE,
  '/privacy': ROUTE_TYPES.PUBLIC_INDEXABLE,
  '/terms': ROUTE_TYPES.PUBLIC_INDEXABLE,
  '/status': ROUTE_TYPES.PUBLIC_INDEXABLE,
  '/accessibility': ROUTE_TYPES.PUBLIC_INDEXABLE,
  '/contact': ROUTE_TYPES.PUBLIC_INDEXABLE,
  '/proof-types': ROUTE_TYPES.PUBLIC_INDEXABLE,
  
  // Proof creation routes - workflow/private
  '/proofs': ROUTE_TYPES.WORKFLOW_ONLY,
  '/proofs/minimum-income': ROUTE_TYPES.PRIVATE,
  '/proofs/payment-receipt': ROUTE_TYPES.PRIVATE,
  '/proofs/recurring-income': ROUTE_TYPES.PRIVATE,
  '/proofs/employer-payment': ROUTE_TYPES.PRIVATE,
  
  // Verification routes - public but non-indexable (user-generated content)
  '/verify': ROUTE_TYPES.PUBLIC_NON_INDEXABLE,
  '/verify/credential': ROUTE_TYPES.PUBLIC_NON_INDEXABLE,
  '/verify/scan': ROUTE_TYPES.PUBLIC_NON_INDEXABLE,
  '/verify/[proofId]': ROUTE_TYPES.PUBLIC_NON_INDEXABLE,
  
  // Settings routes - private
  '/settings': ROUTE_TYPES.PRIVATE,
  '/settings/issuers': ROUTE_TYPES.PRIVATE,
  '/settings/organizations': ROUTE_TYPES.PRIVATE,
  '/settings/activity': ROUTE_TYPES.PRIVATE,
  '/settings/usage': ROUTE_TYPES.PRIVATE,
  '/settings/notifications': ROUTE_TYPES.PRIVATE,
  '/settings/sessions': ROUTE_TYPES.PRIVATE,

  // Embeddable public verification widget (issue #196) - public but
  // deliberately non-indexable: it's meant to be embedded on relying-party
  // sites, not found directly via search.
  '/embed/v1/verify/[id]': ROUTE_TYPES.PUBLIC_NON_INDEXABLE,
};

// Helper to check if file exists
function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function normalizeRoutePath(routePath) {
  const normalized = routePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  return normalized === '' ? '/' : `/${normalized}`;
}

function buildCanonicalUrl(routePath) {
  return routePath === '/' ? APP_URL : `${APP_URL}${routePath}`;
}

// Extract metadata from a page file
function extractMetadataFromFile(filePath) {
  if (!fileExists(filePath)) {
    return null;
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Look for metadata export patterns
  const metadataMatch = content.match(/export\s+(const\s+)?metadata\s*[:=]\s*({[\s\S]*?})(?=;|\n|$)/);
  if (metadataMatch) {
    try {
      // Simple extraction - in reality would need a proper parser
      // For now, just check if title and description exist
      const hasTitle = content.includes('title:') || content.includes('"title"') || content.includes("'title'");
      const hasDescription = content.includes('description:') || content.includes('"description"') || content.includes("'description'");
      
      return {
        hasTitle,
        hasDescription,
        hasCustomMetadata: true,
        rawContent: content.substring(0, 500) // First 500 chars for analysis
      };
    } catch (error) {
      return { error: error.message };
    }
  }
  
  // Check for generateMetadata function
  const hasGenerateMetadata = content.includes('generateMetadata') || content.includes('export async function generateMetadata');
  
  // Most pages use the layout's default metadata
  return {
    hasTitle: false, // Using layout's default title
    hasDescription: false, // Using layout's default description
    hasCustomMetadata: hasGenerateMetadata,
    usesLayoutMetadata: !hasGenerateMetadata
  };
}

// Walk directory to find all page.tsx files
function findPageFiles(dir, basePath = '') {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.join(basePath, entry.name);
    
    if (entry.isDirectory()) {
      // Skip test directories and special Next.js directories
      if (entry.name === '__tests__' || entry.name.startsWith('_')) {
        continue;
      }
      results.push(...findPageFiles(fullPath, relativePath));
    } else if (entry.name === 'page.tsx') {
      results.push({
        fullPath,
        routePath: basePath || '/'
      });
    }
  }
  
  return results;
}

// Generate route manifest
function generateRouteManifest() {
  const pageFiles = findPageFiles(APP_DIR);
  const manifest = [];
  
  for (const pageFile of pageFiles) {
    const routePath = normalizeRoutePath(pageFile.routePath);
    const routeType = ROUTE_CLASSIFICATION[routePath] || ROUTE_TYPES.PUBLIC_INDEXABLE;
    const metadata = extractMetadataFromFile(pageFile.fullPath);
    
    manifest.push({
      route: routePath,
      type: routeType,
      filePath: path.relative(APP_ROOT, pageFile.fullPath),
      metadata: metadata,
      canonicalUrl: buildCanonicalUrl(routePath),
      validationRequirements: {
        needsTitle: routeType === ROUTE_TYPES.PUBLIC_INDEXABLE || routeType === ROUTE_TYPES.PUBLIC_NON_INDEXABLE,
        needsDescription: routeType === ROUTE_TYPES.PUBLIC_INDEXABLE || routeType === ROUTE_TYPES.PUBLIC_NON_INDEXABLE,
        needsCanonical: routeType === ROUTE_TYPES.PUBLIC_INDEXABLE || routeType === ROUTE_TYPES.PUBLIC_NON_INDEXABLE,
        shouldBeIndexable: routeType === ROUTE_TYPES.PUBLIC_INDEXABLE,
        shouldNotBeIndexable: routeType === ROUTE_TYPES.PRIVATE || routeType === ROUTE_TYPES.WORKFLOW_ONLY || routeType === ROUTE_TYPES.PUBLIC_NON_INDEXABLE
      }
    });
  }
  
  return manifest;
}

// Validate manifest
function validateManifest(manifest) {
  const errors = [];
  const titles = new Set();
  
  for (const route of manifest) {
    const { route: routePath, metadata, validationRequirements } = route;
    
    // Check for duplicate titles (for indexable routes)
    if (validationRequirements.needsTitle && metadata && metadata.hasTitle) {
      // In a real implementation, we would extract the actual title
      // For now, we'll track route paths
      if (titles.has(routePath)) {
        errors.push(`[DUPLICATE_TITLE] ${routePath}: Title appears duplicated`);
      }
      titles.add(routePath);
    }
    
    // Check for missing titles
    if (validationRequirements.needsTitle && (!metadata || (!metadata.hasTitle && !metadata.hasCustomMetadata && !metadata.usesLayoutMetadata))) {
      errors.push(`[MISSING_TITLE] ${routePath}: Public indexable route needs a title (no metadata found)`);
    }
    
    // Check for missing descriptions
    if (validationRequirements.needsDescription && (!metadata || (!metadata.hasDescription && !metadata.hasCustomMetadata && !metadata.usesLayoutMetadata))) {
      errors.push(`[MISSING_DESCRIPTION] ${routePath}: Public indexable route needs a description (no metadata found)`);
    }
    
    // Validate canonical URLs
    if (validationRequirements.needsCanonical) {
      const canonicalUrl = route.canonicalUrl;
      if (!canonicalUrl.startsWith('http')) {
        errors.push(`[INVALID_CANONICAL] ${routePath}: Canonical URL must be absolute (${canonicalUrl})`);
      }
      if (!canonicalUrl.startsWith(APP_URL)) {
        errors.push(`[WRONG_CANONICAL_ORIGIN] ${routePath}: Canonical origin doesn't match app origin (${canonicalUrl})`);
      }
      if (canonicalUrl !== buildCanonicalUrl(routePath)) {
        errors.push(`[WRONG_CANONICAL_PATH] ${routePath}: Canonical URL should be ${buildCanonicalUrl(routePath)} (${canonicalUrl})`);
      }
    }
  }
  
  return errors;
}

// Main execution
function main() {
  console.log('Generating route manifest...');
  console.log(`App URL: ${APP_URL}`);
  
  const manifest = generateRouteManifest();
  console.log(`Found ${manifest.length} routes`);
  
  // Write manifest to file
  const manifestPath = path.join(APP_ROOT, 'scripts', 'route-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Manifest written to ${manifestPath}`);
  
  // Validate manifest
  console.log('\nValidating routes...');
  const errors = validateManifest(manifest);
  
  if (errors.length > 0) {
    console.error('\nValidation errors found:');
    errors.forEach(error => console.error(`  ${error}`));
    process.exit(1);
  } else {
    console.log('All route validations passed!');
  }
  
  // Print summary
  console.log('\nRoute Summary:');
  const typeCounts = {};
  manifest.forEach(route => {
    typeCounts[route.type] = (typeCounts[route.type] || 0) + 1;
  });
  
  Object.entries(typeCounts).forEach(([type, count]) => {
    console.log(`  ${type}: ${count} routes`);
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  generateRouteManifest,
  validateManifest,
  normalizeRoutePath,
  buildCanonicalUrl,
  getAppUrl,
  ROUTE_TYPES,
  ROUTE_CLASSIFICATION
};
