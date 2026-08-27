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
      contents:
        "export { ITEMS } from './src/sim/data.ts';\n" +
        "export { ITEM_ART_PENDING } from './src/ui/icons.ts';",
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
  const module = await import(dataUrl);
  return { items: module.ITEMS, pendingArtIds: module.ITEM_ART_PENDING };
}

const arguments_ = parseArguments(process.argv.slice(2));
if (arguments_.help) {
  process.stdout.write(usage());
  process.exit(0);
}

const repoRoot = process.cwd();
await readFile(path.join(repoRoot, 'package.json'));
const { items, pendingArtIds } = await loadItems(repoRoot);
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
  pendingArtIds: [...pendingArtIds].sort(),
  expected: {
    // 913 at the v0.41.0 release merge: the v0.39.0 823 plus the 84
    // Masterwrought art-shipping ids (907 on the packet branch) plus the six
    // release additions, all Proving Shore ids (the castaway crate and ferry
    // bell pair, the passing stone, and the pearl detour's mother_of_pearl,
    // briny lure and lustrous pearl), measured as the committed .webp count
    // under public/ui/items.
    catalogCount: 913,
    // The ART-SUBJECT count: live defs minus the declared procedural-art
    // debt (ITEM_ART_PENDING, exact-set-pinned in tests/item_icons.test.ts).
    // 922 was the v0.39.0 reviewed universe (the 2026-08-09 831 plus the
    // release's seven art-shipping additions, the Dawnhold posy last) plus
    // the 84 Masterwrought item ids that each ship committed art; 928 adds
    // the v0.41.0 release's six art-shipping ids at the merge. It stays a
    // hard literal: a new item ships art (joining this count) or
    // joins the pending pin, and either move is a visible, deliberate edit.
    liveItemCount: 928,
    // The other half of the art-subject split: the declared procedural-art
    // debt, pinned as its own literal so the audit reds on new debt even
    // when it runs standalone (the vitest exact-set pin in
    // tests/item_icons.test.ts names the ids; this counts them). Total live
    // defs = liveItemCount + pendingArtCount, so both growth directions are
    // visible, deliberate edits. 44 was the farming Phase 6 39 plus the
    // Phase 11 well-fed phase's four buff dishes plus the Phase 12 shared
    // feast, carried unchanged through the farming absorb; Phase 11e's four
    // upper-tier crops add twelve ids (seed, produce and fine twin each) under
    // the packet's declared art park for 11e to 11k, taking it to 56; Phase
    // 11f's six farming PATTERNS park under the same declaration, taking it to
    // 62; Phase 11i's angler's endgame parks eleven more under the same
    // declaration (three high-band catches, the apex rod, two dishes, the
    // capstone feast and four patterns), taking it to 73; Phase 11j's apex
    // hoe parks one more under the same declaration, taking it to 74; and
    // Phase 11k's apex feast tier parks its six ids (three feasts, three
    // patterns) while RETIRING two of 11i's (that phase's capstone feast and
    // its pattern, removed from the game rather than moved), a net plus four
    // to 78; and Phase 11o's engineering on-ramp parks its two ids (the
    // cogwheel_blank part and the copperlens_ocular gadget) under the same
    // ip-16-ICON declaration, taking it to 80; and masterwrought Phase 13's
    // Deed of Making parks its one id under the same declaration, taking it
    // to 81 (one def minted, the same one parked, so liveItemCount holds at
    // 928, the Phase 13-era value, and catalogCount at 913 by the
    // cancellation below).
    // liveItemCount is unmoved by any of that, which is the point of the
    // split, and the 11k arithmetic is worth spelling out because "net plus
    // four" appears on BOTH terms and they are different sums. Live ITEMS defs
    // went up four (six minted, two deleted). The debt went up four (the same
    // six parked, the same two unparked). liveItemCount is defs MINUS debt, so
    // it held at 922, the 11k-era value (later phases moved it to the 928
    // above): an artless def joining the park moves the debt term and
    // the def count together and cancels out of this one.
    pendingArtCount: 81,
    generatedHeroicDefinitions: 64,
    heroicDefinitionsWithOwnWebp: 48,
    heroicWeaponArtAliases: 16,
    sheetPageCount: 29,
    groupCount: 25,
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
