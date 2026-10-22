#!/usr/bin/env node

/**
 * Production readiness validation for EarnProof frontend
 * 
 * This script runs all production-readiness validations:
 * 1. Route manifest and metadata validation
 * 2. Internal link validation
 * 3. Browser storage schema audit (registered keys, versioned schemas,
 *    declared accessors, no secrets or retired keys persisted)
 */

const fs = require('fs');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

function runValidation(name, validationFn) {
  console.log(`\n${colorize('='.repeat(60), 'cyan')}`);
  console.log(`${colorize(`Running: ${name}`, 'cyan')}`);
  console.log(`${colorize('='.repeat(60), 'cyan')}`);
  
  try {
    return validationFn();
  } catch (error) {
    console.error(`${colorize(`Error in ${name}:`, 'red')} ${error.message}`);
    return { 
      success: false, 
      errors: [`Uncaught error: ${error.message}`],
      warnings: []
    };
  }
}

function validateRouteManifest() {
  const { generateRouteManifest, validateManifest } = require('./generate-route-manifest');
  
  console.log('Generating route manifest...');
  const manifest = generateRouteManifest();
  
  console.log(`Found ${manifest.length} routes`);
  
  const errors = validateManifest(manifest);
  
  // Write manifest to file
  const manifestPath = path.join(APP_ROOT, 'scripts', 'route-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  
  // Check for pages using layout metadata that should have custom metadata
  const warnings = [];
  manifest.forEach(route => {
    if (route.validationRequirements.needsTitle && 
        route.metadata && 
        route.metadata.usesLayoutMetadata && 
        !route.metadata.hasCustomMetadata) {
      warnings.push(`[LAYOUT_METADATA] ${route.route}: Public indexable route uses layout metadata (consider adding custom metadata)`);
    }
  });
  
  return {
    success: errors.length === 0,
    errors,
    warnings,
    manifest
  };
}

function validateInternalLinks() {
  const { validateLinks } = require('./validate-internal-links');

  const { errors, warnings, links } = validateLinks();

  return {
    success: errors.length === 0,
    errors,
    warnings,
    linkCount: links.length
  };
}

function validateRouteAuthManifest() {
  const { generateRouteAuthManifest, validateRouteAuthManifest: validate } = require('./generate-route-auth-manifest');

  console.log('Generating route authorization manifest...');
  const manifest = generateRouteAuthManifest();

  console.log(`Found ${manifest.length} routes`);

  const errors = validate(manifest);

  const manifestPath = path.join(APP_ROOT, 'scripts', 'route-auth-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return {
    success: errors.length === 0,
    errors,
    warnings: [],
    manifest
  };
}

function validateMockReachability() {
  const { checkMockReachability } = require('./check-mock-reachability');

  console.log('Checking for mock-provider imports reachable from production routes...');
  const findings = checkMockReachability();

  const errors = findings.map(
    (finding) =>
      `[MOCK_REACHABLE] ${finding.entry}: imports ${finding.mockNames.join(', ')} via ${finding.chain.join(' -> ')}`,
  );

  return {
    success: errors.length === 0,
    errors,
    warnings: [],
    findings
  };
}

function validateStorageSchemas() {
  const { auditStorage } = require('./storage-schema-audit');

  console.log('Auditing browser storage against lib/storage/registry.json...');
  const result = auditStorage({ root: APP_ROOT });

  console.log(
    `Scanned ${result.stats.filesScanned} files; ${result.stats.accessFiles} touch browser storage; ` +
    `${result.stats.entries} registered keys.`
  );

  return {
    success: result.success,
    errors: result.errors,
    warnings: result.warnings,
  };
}

function main() {
  console.log(colorize('\n🚀 EarnProof Production Readiness Validation', 'green'));
  console.log(colorize('='.repeat(60), 'green'));
  
  const results = {
    routeManifest: runValidation('Route Manifest & Metadata', validateRouteManifest),
    routeAuthManifest: runValidation('Route Authorization Manifest (#332)', validateRouteAuthManifest),
    mockReachability: runValidation('Mock Provider Reachability (#333)', validateMockReachability),
    internalLinks: runValidation('Internal Link Validation', validateInternalLinks),
    storageSchemas: runValidation('Storage Schema Validation', validateStorageSchemas)
  };
  
  // Summary
  console.log(`\n${colorize('='.repeat(60), 'magenta')}`);
  console.log(colorize('VALIDATION SUMMARY', 'magenta'));
  console.log(`${colorize('='.repeat(60), 'magenta')}`);
  
  let allSuccess = true;
  let totalErrors = 0;
  let totalWarnings = 0;
  
  Object.entries(results).forEach(([name, result]) => {
    const status = result.success ? colorize('✓ PASS', 'green') : colorize('✗ FAIL', 'red');
    console.log(`${name}: ${status}`);
    
    if (result.errors && result.errors.length > 0) {
      console.log(`  Errors: ${result.errors.length}`);
      totalErrors += result.errors.length;
    }
    
    if (result.warnings && result.warnings.length > 0) {
      console.log(`  Warnings: ${result.warnings.length}`);
      totalWarnings += result.warnings.length;
    }
    
    if (!result.success) {
      allSuccess = false;
    }
  });
  
  console.log(`\n${colorize('─'.repeat(60), 'cyan')}`);
  console.log(`Total Errors: ${colorize(totalErrors.toString(), totalErrors > 0 ? 'red' : 'green')}`);
  console.log(`Total Warnings: ${colorize(totalWarnings.toString(), totalWarnings > 0 ? 'yellow' : 'green')}`);
  
  if (totalErrors > 0) {
    console.log(`\n${colorize('Detailed Errors:', 'red')}`);
    Object.entries(results).forEach(([name, result]) => {
      if (result.errors && result.errors.length > 0) {
        console.log(`\n${colorize(`${name}:`, 'yellow')}`);
        result.errors.forEach(error => console.log(`  ${error}`));
      }
    });
  }
  
  if (totalWarnings > 0) {
    console.log(`\n${colorize('Detailed Warnings:', 'yellow')}`);
    Object.entries(results).forEach(([name, result]) => {
      if (result.warnings && result.warnings.length > 0) {
        console.log(`\n${colorize(`${name}:`, 'yellow')}`);
        result.warnings.forEach(warning => console.log(`  ${warning}`));
      }
    });
  }
  
  console.log(`\n${colorize('='.repeat(60), allSuccess ? 'green' : 'red')}`);
  console.log(colorize(allSuccess ? '✅ ALL VALIDATIONS PASSED' : '❌ VALIDATION FAILED', allSuccess ? 'green' : 'red'));
  console.log(`${colorize('='.repeat(60), allSuccess ? 'green' : 'red')}`);
  
  process.exit(allSuccess ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = {
  validateRouteManifest,
  validateRouteAuthManifest,
  validateMockReachability,
  validateInternalLinks,
  validateStorageSchemas,
  runValidation
};