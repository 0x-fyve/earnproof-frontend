#!/usr/bin/env node

/**
 * Production readiness validation for EarnProof frontend
 * 
 * This script runs all production-readiness validations:
 * 1. Route manifest and metadata validation
 * 2. Internal link validation
 * 3. Storage schema validation (placeholder)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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
  console.log('Validating storage schemas...');
  
  // This is a placeholder - actual implementation would:
  // 1. Scan for localStorage/sessionStorage usage
  // 2. Validate schemas
  // 3. Check migration paths
  
  // For now, just check that SESSION_KEY is consistently used
  const storageCheck = spawnSync('node', ['-e', `
    const fs = require('fs');
    const path = require('path');
    
    const componentsDir = path.join(__dirname, '..', 'components');
    let hasSessionKey = false;
    let inconsistentKeys = [];
    
    function scanDir(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (content.includes('localStorage') || content.includes('sessionStorage')) {
            if (content.includes('SESSION_KEY')) {
              hasSessionKey = true;
            } else if (content.includes('"earnproof.session"')) {
              // Direct string usage - should use constant
              inconsistentKeys.push(path.relative(path.join(__dirname, '..'), fullPath));
            }
          }
        }
      }
    }
    
    try {
      scanDir(componentsDir);
      if (inconsistentKeys.length > 0) {
        console.log(JSON.stringify({
          success: false,
          errors: inconsistentKeys.map(file => \`[INCONSISTENT_STORAGE_KEY] \${file}: Direct string usage instead of SESSION_KEY constant\`),
          warnings: []
        }));
      } else {
        console.log(JSON.stringify({
          success: true,
          errors: [],
          warnings: hasSessionKey ? [] : ['[NO_STORAGE_FOUND] No browser storage usage found']
        }));
      }
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        errors: [\`Storage scan failed: \${error.message}\`],
        warnings: []
      }));
    }
  `], { cwd: __dirname, encoding: 'utf8' });
  
  try {
    return JSON.parse(storageCheck.stdout);
  } catch (error) {
    return {
      success: false,
      errors: [`Failed to parse storage validation output: ${error.message}`],
      warnings: []
    };
  }
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