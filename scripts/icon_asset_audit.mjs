#!/usr/bin/env node

// Deterministic accepted-art verifier and contact-sheet entry point.
//
// Usage:
//   node scripts/icon_asset_audit.mjs <manifest.json> <output-dir>
//     [--root <repo-root>] [--no-sheets]

import { runIconAssetAudit } from './lib/icon_asset_audit.mjs';

function usage(message) {
  if (message) console.error(`[icon-asset-audit] ${message}`);
  console.error(
    'usage: node scripts/icon_asset_audit.mjs <manifest.json> <output-dir> [--root <repo-root>] [--no-sheets]',
  );
  process.exitCode = 1;
}

function parseArgs(argv) {
  const positional = [];
  let repoRoot = process.cwd();
  let sheets = true;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--root') {
      const value = argv[++index];
      if (!value) return { error: '--root requires a directory argument' };
      repoRoot = value;
    } else if (argument === '--no-sheets') {
      sheets = false;
    } else if (argument === '--help' || argument === '-h') {
      return { help: true };
    } else if (argument.startsWith('-')) {
      return { error: `unknown option ${argument}` };
    } else {
      positional.push(argument);
    }
  }
  if (positional.length !== 2) {
    return { error: 'expected a manifest path and output directory' };
  }
  return {
    manifestPath: positional[0],
    outputDir: positional[1],
    repoRoot,
    sheets,
  };
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(
    'usage: node scripts/icon_asset_audit.mjs <manifest.json> <output-dir> [--root <repo-root>] [--no-sheets]',
  );
} else if (options.error) {
  usage(options.error);
} else {
  try {
    const report = await runIconAssetAudit(options);
    console.log(
      `[icon-asset-audit] ${report.summary.assetCount} asset(s), ` +
        `${report.summary.issueCount} issue(s), ` +
        `${report.summary.exactDuplicateGroupCount} exact duplicate group(s), ` +
        `${report.summary.perceptualCandidateCount} perceptual candidate(s), ` +
        `${report.summary.contactSheetCount} sheet(s)`,
    );
    if (!report.summary.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`[icon-asset-audit] ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
