import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as esbuild from 'esbuild';
import {
  assertItemArtAuditPass,
  buildItemArtAudit,
  writeItemArtAuditVerdict,
} from './lib/item_art_audit.mjs';

const DEFAULT_OUTPUT = 'tmp/imagegen/item-art-consistency/final-audit';
const DEFAULT_VERDICT =
  'docs/achievements/item-art-consistency-2026-08-09/final-item-art-audit-verdict.json';

function usage() {
  return `Usage: node scripts/item_art_audit.mjs [options]

Rebuild the complete current item-art machine catalog and visual-review contact sheets.

Options:
  --output <path>      Repository-relative output under tmp/ (default: ${DEFAULT_OUTPUT})
  --verify-only        Validate the real catalog and sheet plan without writing output
  --refresh-verdict    Refresh reproducible evidence in ${DEFAULT_VERDICT}
  --help               Show this help
`;
}

function parseArguments(arguments_) {
  let outputDirectory = DEFAULT_OUTPUT;
  let refreshVerdict = false;
  let verifyOnly = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--help') {
      return { help: true, outputDirectory, refreshVerdict, verifyOnly };
    }
    if (argument === '--refresh-verdict') {
      refreshVerdict = true;
      continue;
    }
    if (argument === '--verify-only') {
      verifyOnly = true;
      continue;
    }
    if (argument === '--output') {
      const value = arguments_[index + 1];
      if (!value) throw new Error('--output requires a repository-relative path');
      outputDirectory = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (refreshVerdict && verifyOnly) {
    throw new Error('--verify-only cannot be combined with --refresh-verdict');
  }
  return { help: false, outputDirectory, refreshVerdict, verifyOnly };
}

async function loadItems(repoRoot) {
  const build = await esbuild.build({
    stdin: {
      contents: "export { ITEMS } from './src/sim/data.ts';",
      resolveDir: repoRoot,
      sourcefile: 'item-art-audit-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  });
  const bundled = build.outputFiles[0].text;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`;
  return (await import(dataUrl)).ITEMS;
}

const arguments_ = parseArguments(process.argv.slice(2));
if (arguments_.help) {
  process.stdout.write(usage());
  process.exit(0);
}

const repoRoot = process.cwd();
await readFile(path.join(repoRoot, 'package.json'));
const items = await loadItems(repoRoot);
const mapping = JSON.parse(
  await readFile(path.join(repoRoot, 'public/ui/items/mapping.json'), 'utf8'),
);
const build = await buildItemArtAudit({
  repoRoot,
  itemDirectory: 'public/ui/items',
  outputDirectory: arguments_.outputDirectory,
  renderOutputs: !arguments_.verifyOnly,
  items,
  mapping,
  expected: {
    catalogCount: 817,
    liveItemCount: 831,
    generatedHeroicDefinitions: 63,
    heroicDefinitionsWithOwnWebp: 48,
    heroicWeaponArtAliases: 15,
    sheetPageCount: 26,
    groupCount: 22,
  },
});
assertItemArtAuditPass(build);

let verdict = null;
if (arguments_.refreshVerdict) {
  assertDefaultOutput(arguments_.outputDirectory);
  verdict = await writeItemArtAuditVerdict(path.join(repoRoot, DEFAULT_VERDICT), build);
  await writeFile(path.join(repoRoot, DEFAULT_OUTPUT, 'verdict.json'), verdict.bytes);
}

process.stdout.write(
  `${JSON.stringify(
    {
      catalogPath: build.catalogPath,
      catalogSha256: build.catalogSha256,
      catalogBytes: build.catalogBytes.length,
      rendererFingerprint: build.rendererFingerprint,
      catalogCount: build.catalog.catalogCount,
      liveItemCount: build.catalog.liveItemCount,
      generatedHeroicDefinitions: build.catalog.generatedHeroicDefinitions,
      heroicDefinitionsWithOwnWebp: build.catalog.heroicDefinitionsWithOwnWebp,
      heroicWeaponArtAliases: build.catalog.heroicWeaponArtAliases,
      groupCount: Object.keys(build.catalog.groups).length,
      sheetPageCount: build.catalog.sheetPageCount,
      sheetCount: build.catalog.sheetPaths.length,
      sheetModeCounts: build.sheetModeCounts,
      sheetSetSha256: build.sheetSetSha256,
      shippingCatalogSha256: build.shippingCatalogSha256,
      machineChecksPassed: build.catalog.machineChecks.passed,
      verdict: verdict
        ? {
            path: DEFAULT_VERDICT,
            sha256: verdict.sha256,
            bytes: verdict.bytes.length,
          }
        : null,
    },
    null,
    2,
  )}\n`,
);

function assertDefaultOutput(outputDirectory) {
  if (outputDirectory !== DEFAULT_OUTPUT) {
    throw new Error('--refresh-verdict requires the default final-audit output directory');
  }
}
