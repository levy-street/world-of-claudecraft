import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ABILITIES, ITEMS } from '../src/sim/data';
import { ActionBarController } from '../src/ui/hud/action_bar/action_bar_controller';
import { abilityImageUrl, ITEM_ART_PENDING, itemImageUrl } from '../src/ui/icons';

interface AcceptedAsset {
  kind: 'ability' | 'aura';
  id: string;
  runtimeUrl: string;
  sourcePath: string;
  sourceBytes: number;
  sourceSha256: string;
  acceptedBytes: number;
  acceptedSha256: string;
  references: string[];
  prompt: string;
}

interface MappingAsset {
  id: string;
  runtimeUrl: string;
  sourcePath: string;
  sourceSha256: string;
  acceptedBytes: number;
  acceptedSha256: string;
  references: string[];
}

const repoRoot = process.cwd();
const recordPath = path.join(
  repoRoot,
  'docs/achievements/release-v039-icon-art-first-pass-2026-08-16/accepted-art.json',
);
const ACCEPTED_ART_SHA256 = '3d8cb36726050e3a708720b650744005f4ce23d3ac49c0323761441beb50eb51';
const SECOND_PASS_RECORD =
  'docs/achievements/release-v039-icon-art-second-pass-2026-08-16/accepted-art.json';
// Advanced at the feature/masterwrought release/v0.40.0 sync: the branch's
// three role foods (stonepot_stew, warspice_skewers, sageleaf_chowder) join
// the live isHotbarItemId census, so the sealed runtimeClosure.hotbarItems
// moves 72 to 75 (each food ships committed painted art, so painted moves
// with live and the no-gap assertions below still bind). Carried unchanged
// through the farming absorb (Phase 11d): farming's sixteen pending hotbar
// items are ITEM_ART_PENDING debt, outside the art-subject universe the
// record seals, so the record bytes did not move.
const SECOND_PASS_RECORD_SHA256 =
  // RE-MINTED at the Phase 11k QA release sync: each parent moved exactly one
  // number in the sealed record (ours the hotbar census 72 to 75 for the three
  // role foods, the release the ability census 410 to 412), the record
  // auto-merged carrying BOTH, and this seal is the merged file's own bytes.
  // RE-MINTED again at the release/v0.41.0 sync: the release moved the
  // ability census 412 to 402 (the ten Vale Cup sport abilities retired with
  // the Sowfield demolition), this branch holds the hotbar census at 75, the
  // record auto-merged carrying both again, and this seal is the merged
  // file's own bytes (shasum -a 256 of the record).
  // RE-MINTED at the v0.42.0 sync on 2026-08-31 (ours 2ab5c2f7d0, theirs
  // 22e909839f, base e6b8edb375). Both parents moved exactly one number in the
  // sealed record again, and nothing else: a line-by-line diff of the three
  // sides shows base->ours and base->theirs each touching only the two
  // runtimeClosure.hotbarItems lines. The base read 72 / 72; ours moved it to
  // 75 / 75 for the three phase 10 role foods; the release moved it to 73 / 73
  // for the Bonebound Rickshaw reins. Both additions are real hotbar items that
  // ship committed painted art, so the merged census is 76 / 76, and the record
  // was hand-merged to exactly that by substituting the two lines (never a JSON
  // round trip, which would reformat bytes the merge never touched). 76 is not
  // arithmetic: the "derives the sealed ability and hotbar-item totals from live
  // production inventories" case below computes artSubjectHotbarItemIds from the
  // live ITEMS inventory and independently asserts 76, and it read 76 against
  // the un-merged 73 record before the fix. The seal is `shasum -a 256` of the
  // merged file. No capture or asset was retaken.
  '70c60f346c819b637a9780dd7625ec027ffbe4420650203f47197d7005cbd282';
const EVIDENCE = {
  'icon-art-before-after-desktop.png': {
    sha256: '61d19fb321f2b30eb3749e0966f26efea0fa4df53edae4b253cfd70edb82cd7a',
  },
  'icon-art-before-after-mobile.png': {
    sha256: '9ae2dc510d304a3c3667fb611884055ef2b6cb3617f6806ed1e4f4c8dae69a8d',
  },
} as const;

const inventoryController = new ActionBarController({
  storage: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  },
  playerClass: 'warrior',
  playerName: 'IconArtInventory',
  playerLevel: () => 1,
  talentSpec: () => null,
  knownAbilityIds: () => [],
  hasAura: () => false,
  showAttackButton: () => true,
});

function shippingImageExists(runtimeUrl: string | null): boolean {
  if (!runtimeUrl?.startsWith('/')) return false;
  return existsSync(path.join(repoRoot, 'public', runtimeUrl.slice(1)));
}

describe('release v0.39 icon-art first-pass lineage', () => {
  it('pins every accepted painting to its prompt, references, and shipping bytes', () => {
    const recordBytes = readFileSync(recordPath);
    expect(createHash('sha256').update(recordBytes).digest('hex')).toBe(ACCEPTED_ART_SHA256);
    const record = JSON.parse(recordBytes.toString('utf8')) as {
      schemaVersion: number;
      batch: {
        id: string;
        acceptedDate: string;
        baseRelease: string;
        baseCommit: string;
        rasterGenerator: string;
        owner: string;
        license: string;
      };
      scope: {
        rasterPaintings: number;
        petActionCommands: number;
        exactRuntimeAuras: number;
      };
      generationContract: {
        oneCallPerDistinctAsset: boolean;
        freshDistinctCompositions: boolean;
        sourceRetention: string;
        processing: string;
        review: string;
      };
      assets: AcceptedAsset[];
    };
    const expectedIds = [
      'cheater_mark',
      'pet_aggressive',
      'pet_attack',
      'pet_defensive',
      'pet_feed',
      'pet_growl',
      'pet_mend',
      'pet_passive',
      'pet_water_jet',
    ];

    expect(record).toMatchObject({
      schemaVersion: 1,
      batch: {
        id: 'release-v039-icon-art-first-pass-2026-08-16',
        acceptedDate: '2026-08-16',
        baseRelease: 'release/v0.39.0',
        baseCommit: 'd2d1a8ad5c11',
        rasterGenerator: 'OpenAI built-in image generation',
        owner: 'World of ClaudeCraft',
        license: 'World of ClaudeCraft project-generated art, project asset, rights reserved',
      },
      scope: {
        rasterPaintings: 9,
        petActionCommands: 8,
        exactRuntimeAuras: 1,
      },
      generationContract: {
        oneCallPerDistinctAsset: true,
        freshDistinctCompositions: true,
        sourceRetention:
          'Accepted 1254px masters remain under the gitignored tmp/imagegen tree in this worktree.',
        processing:
          'Each square sRGB master was scaled to exact 128px and encoded as opaque WebP at quality 82 by scripts/convert_skill_icons_webp.mjs with its 15 KiB gate.',
        review:
          'Every source and shipping icon was inspected as a family at 128px and at its relevant 13px to 48px runtime sizes.',
      },
    });
    expect(record.assets.map(({ id }) => id).sort()).toEqual(expectedIds);

    const shippingHashes = new Set<string>();
    for (const asset of record.assets) {
      expect(asset.prompt, asset.id).toMatch(/^Use case: stylized-concept\n/);
      expect(asset.prompt, asset.id).toMatch(/\btext\b/i);
      expect(asset.prompt, asset.id).toMatch(/\bwatermark\b/i);
      expect(asset.sourcePath, asset.id).toMatch(/^tmp\/imagegen\//);
      expect(asset.sourceBytes, asset.id).toBeGreaterThan(0);
      expect(asset.sourceSha256, asset.id).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.references.length, asset.id).toBeGreaterThanOrEqual(3);
      for (const reference of asset.references) {
        expect(existsSync(path.join(repoRoot, reference)), `${asset.id}: ${reference}`).toBe(true);
      }

      const file = path.join(repoRoot, 'public', asset.runtimeUrl.slice(1));
      const bytes = readFileSync(file);
      const hash = createHash('sha256').update(bytes).digest('hex');
      expect(bytes.length, asset.id).toBe(asset.acceptedBytes);
      expect(hash, asset.id).toBe(asset.acceptedSha256);
      shippingHashes.add(hash);
    }
    expect(shippingHashes.size).toBe(expectedIds.length);
  });

  it('retains desktop and mobile visual-review evidence', () => {
    const screenshotDir = path.join(
      repoRoot,
      'docs/screenshots/release-v039-icon-art-first-pass-2026-08-16',
    );
    const hashes = new Set<string>();
    for (const [file, expected] of Object.entries(EVIDENCE)) {
      const bytes = readFileSync(path.join(screenshotDir, file));
      expect(bytes.subarray(1, 4).toString('ascii'), file).toBe('PNG');
      expect(bytes.length, file).toBeGreaterThan(100_000);
      const hash = createHash('sha256').update(bytes).digest('hex');
      expect(hash, file).toBe(expected.sha256);
      hashes.add(hash);
    }
    expect(hashes.size).toBe(2);
  });

  it('keeps public mapping provenance identical to the sealed acceptance record', () => {
    const record = JSON.parse(readFileSync(recordPath, 'utf8')) as { assets: AcceptedAsset[] };
    const petMapping = JSON.parse(
      readFileSync(path.join(repoRoot, 'public/ui/skills/pet/mapping.json'), 'utf8'),
    ) as {
      abilities: Array<{
        abilityId: string;
        output: string;
        sourceFile: string;
        sourceSha256: string;
        acceptedBytes: number;
        acceptedSha256: string;
        references: Array<{ path: string }>;
      }>;
    };
    const auraMapping = JSON.parse(
      readFileSync(path.join(repoRoot, 'public/ui/auras/mapping.json'), 'utf8'),
    ) as {
      assets: Array<{
        auraId: string;
        output: string;
        sourceFile: string;
        sourceSha256: string;
        acceptedBytes: number;
        acceptedSha256: string;
        references: Array<{ path: string }>;
      }>;
    };
    const mapped: MappingAsset[] = [
      ...petMapping.abilities.map((entry) => ({
        id: entry.abilityId,
        runtimeUrl: `/ui/skills/pet/${entry.output}`,
        sourcePath: entry.sourceFile,
        sourceSha256: entry.sourceSha256,
        acceptedBytes: entry.acceptedBytes,
        acceptedSha256: entry.acceptedSha256,
        references: entry.references.map(({ path: referencePath }) => referencePath),
      })),
      ...auraMapping.assets
        .filter(({ auraId }) => auraId === 'cheater_mark')
        .map((entry) => ({
          id: entry.auraId,
          runtimeUrl: `/ui/auras/${entry.output}`,
          sourcePath: entry.sourceFile,
          sourceSha256: entry.sourceSha256,
          acceptedBytes: entry.acceptedBytes,
          acceptedSha256: entry.acceptedSha256,
          references: entry.references.map(({ path: referencePath }) => referencePath),
        })),
    ];
    const acceptedById = new Map(record.assets.map((asset) => [asset.id, asset]));

    expect(mapped.map(({ id }) => id).sort()).toEqual(record.assets.map(({ id }) => id).sort());
    for (const mapping of mapped) {
      const accepted = acceptedById.get(mapping.id);
      expect(accepted, `${mapping.id} accepted record`).toBeDefined();
      expect(mapping, mapping.id).toEqual({
        id: accepted?.id,
        runtimeUrl: accepted?.runtimeUrl,
        sourcePath: accepted?.sourcePath,
        sourceSha256: accepted?.sourceSha256,
        acceptedBytes: accepted?.acceptedBytes,
        acceptedSha256: accepted?.acceptedSha256,
        references: accepted?.references,
      });
    }
  });
});

describe('release v0.39 icon-art second-pass lineage', () => {
  it('seals every cohort and new-family shipping catalog behind one immutable record', () => {
    const aggregateBytes = readFileSync(path.join(repoRoot, SECOND_PASS_RECORD));
    expect(createHash('sha256').update(aggregateBytes).digest('hex')).toBe(
      SECOND_PASS_RECORD_SHA256,
    );
    const aggregate = JSON.parse(aggregateBytes.toString('utf8')) as {
      schemaVersion: number;
      batch: {
        id: string;
        baseRelease: string;
        baseCommit: string;
        rasterGenerator: string;
      };
      scope: {
        acceptedPaintings: number;
        newPaintedIdentities: number;
        legacySkillReplacements: number;
        families: Record<string, number>;
      };
      generation: {
        builtInImagegenCalls: number;
        acceptedPaintings: number;
        acceptedFirstOutputs: number;
        rejectedOutputs: number;
        retriedAssets: string[];
      };
      acceptedRecords: Array<{
        family: string;
        acceptedCount: number;
        path: string;
        sha256: string;
      }>;
      shippingCatalogs: Array<{
        family: string;
        assetCount: number;
        secondPassAssetCount: number;
        path: string;
        sha256: string;
      }>;
      runtimeClosure: {
        abilities: { live: number; painted: number };
        hotbarItems: { live: number; painted: number };
        fixedActions: { painted: number };
        mobAuraRouting: { paintedFamilies: number; exactRuntimeIds: number };
        fiesta: { augments: number; powerups: number; painted: number };
        rollableDelveAffixes: { live: number; painted: number };
        remainingExactLiveSemanticRasterGaps: number;
      };
    };

    expect(aggregate).toMatchObject({
      schemaVersion: 1,
      batch: {
        id: 'release-v039-icon-art-second-pass-2026-08-16',
        baseRelease: 'release/v0.39.0',
        baseCommit: 'd2d1a8ad5c11',
        rasterGenerator: 'OpenAI built-in image generation',
      },
      scope: {
        acceptedPaintings: 223,
        newPaintedIdentities: 165,
        legacySkillReplacements: 58,
        families: {
          runtimeAuras: 128,
          delveAffixes: 6,
          fiesta: 24,
          currency: 6,
          reliquary: 1,
          legacySkills: 58,
        },
      },
      generation: {
        builtInImagegenCalls: 224,
        acceptedPaintings: 223,
        acceptedFirstOutputs: 222,
        rejectedOutputs: 1,
        retriedAssets: ['dismiss_pet'],
      },
      runtimeClosure: {
        // 412 from the release side (its own two new abilities), 75 on this
        // branch: the three phase 10 role foods joined the census (see the
        // record-sha comment above). The art-subject universe, live minus
        // ITEM_ART_PENDING.
        // 402 at the release/v0.41.0 sync: the ten Vale Cup sport abilities
        // retired with the New Eastbrook program's Sowfield demolition, plus
        // the release arm's two new abilities riding the v0.40.0 sync merge.
        // The hotbar census stays at this branch's 75 (the release's own arm
        // read 72 without the three role foods).
        abilities: { live: 402, painted: 402 },
        // 76 at the v0.42.0 sync: the release's one new hotbar item, the
        // Bonebound Rickshaw reins (reins_rickshaw_mount, kind 'mount'), joins
        // the census and ships committed painted art, so painted moves with
        // live (the release's own arm read 72 to 73, without the three role
        // foods).
        hotbarItems: { live: 76, painted: 76 },
        fixedActions: { painted: 11 },
        mobAuraRouting: { paintedFamilies: 44, exactRuntimeIds: 89 },
        fiesta: { augments: 20, powerups: 4, painted: 24 },
        rollableDelveAffixes: { live: 6, painted: 6 },
        remainingExactLiveSemanticRasterGaps: 0,
      },
    });

    expect(aggregate.acceptedRecords).toHaveLength(9);
    const recordHashes = new Set<string>();
    for (const record of aggregate.acceptedRecords) {
      const bytes = readFileSync(path.join(repoRoot, record.path));
      expect(createHash('sha256').update(bytes).digest('hex'), record.family).toBe(record.sha256);
      expect(record.acceptedCount, record.family).toBeGreaterThan(0);
      recordHashes.add(record.sha256);
    }
    expect(recordHashes.size).toBe(aggregate.acceptedRecords.length);
    expect(
      aggregate.acceptedRecords
        .filter(({ family }) => family.includes('legacy-'))
        .reduce((sum, { acceptedCount }) => sum + acceptedCount, 0),
    ).toBe(58);
    expect(
      aggregate.acceptedRecords
        .filter(({ family }) => !family.includes('legacy-'))
        .reduce((sum, { acceptedCount }) => sum + acceptedCount, 0),
    ).toBe(140);

    expect(aggregate.shippingCatalogs.map(({ family }) => family).sort()).toEqual([
      'auras',
      'currency',
      'delve-affixes',
      'fiesta',
      'reliquary',
    ]);
    const secondPassHashes = new Set<string>();
    for (const catalog of aggregate.shippingCatalogs) {
      const bytes = readFileSync(path.join(repoRoot, catalog.path));
      expect(createHash('sha256').update(bytes).digest('hex'), catalog.family).toBe(catalog.sha256);
      const mapping = JSON.parse(bytes.toString('utf8')) as {
        acceptedArtManifest?: string;
        assets: Array<{ auraId?: string; acceptedSha256: string }>;
      };
      expect(mapping.assets, catalog.family).toHaveLength(catalog.assetCount);
      if (catalog.family !== 'auras') {
        expect(mapping.acceptedArtManifest, catalog.family).toBe(SECOND_PASS_RECORD);
      }
      const assets =
        catalog.family === 'auras'
          ? mapping.assets.filter(({ auraId }) => auraId !== 'cheater_mark')
          : mapping.assets;
      expect(assets, catalog.family).toHaveLength(catalog.secondPassAssetCount);
      for (const asset of assets) {
        expect(asset.acceptedSha256, catalog.family).toMatch(/^[0-9a-f]{64}$/);
        expect(secondPassHashes.has(asset.acceptedSha256), asset.acceptedSha256).toBe(false);
        secondPassHashes.add(asset.acceptedSha256);
      }
    }
    expect(secondPassHashes.size).toBe(aggregate.scope.newPaintedIdentities);
  });

  it('derives the sealed ability and hotbar-item totals from live production inventories', () => {
    const aggregate = JSON.parse(readFileSync(path.join(repoRoot, SECOND_PASS_RECORD), 'utf8')) as {
      runtimeClosure: {
        abilities: { live: number; painted: number };
        hotbarItems: { live: number; painted: number };
      };
    };
    const liveAbilityIds = Object.keys(ABILITIES);
    const paintedAbilityIds = new Set(
      liveAbilityIds.filter((id) => shippingImageExists(abilityImageUrl(id))),
    );
    const liveHotbarItemIds = Object.keys(ITEMS).filter((id) =>
      inventoryController.isHotbarItemId(id),
    );
    // The ART-SUBJECT split, the same rule scripts/item_art_audit.mjs applies:
    // ids in ITEM_ART_PENDING are declared procedural-art debt (exact-set
    // pinned in tests/item_icons.test.ts; the hotbar paints them through the
    // art-or-procedural resolver iconDataUrl), so the painted closure sealed
    // in the record is over the art-subject universe, live minus pending. The
    // debt is policed both directions here: a pending hotbar item may ship NO
    // committed webp (a stale entry once art lands), and the pending hotbar
    // count is a hard literal so new debt is a visible, deliberate edit.
    const pendingHotbarItemIds = liveHotbarItemIds.filter((id) => ITEM_ART_PENDING.has(id));
    const artSubjectHotbarItemIds = liveHotbarItemIds.filter((id) => !ITEM_ART_PENDING.has(id));
    const paintedHotbarItemIds = new Set(
      artSubjectHotbarItemIds.filter((id) => shippingImageExists(itemImageUrl(id))),
    );

    expect(new Set(liveAbilityIds).size, 'live ability ids remain unique').toBe(
      liveAbilityIds.length,
    );
    expect(liveAbilityIds, 'live production ability inventory').toHaveLength(402);
    expect(
      liveAbilityIds.filter((id) => !paintedAbilityIds.has(id)),
      'every live ability resolves through production to committed painted art',
    ).toEqual([]);
    expect(aggregate.runtimeClosure.abilities).toEqual({
      live: liveAbilityIds.length,
      painted: paintedAbilityIds.size,
    });

    expect(new Set(liveHotbarItemIds).size, 'live hotbar item ids remain unique').toBe(
      liveHotbarItemIds.length,
    );
    // 72 at the v0.39 pass; 75 on the masterwrought branch (the three phase
    // 10 role foods classify as hotbar items and ship painted art). Re-derived
    // on the merged tree at the farming absorb (Phase 11d): farming's 72 plus
    // masterwrought's three painted role foods.
    // 76 at the v0.42.0 sync: the release's Bonebound Rickshaw reins
    // (reins_rickshaw_mount) is a hotbar item that ships committed painted
    // art, so it joins the art-subject term, not the parked term below. The
    // release moved its own arm's plain live-count assertion 72 to 73; that
    // assertion is this branch's art-subject split now, so its one id lands
    // here instead.
    expect(
      artSubjectHotbarItemIds,
      'production isHotbarItemId art-subject inventory (live minus ITEM_ART_PENDING)',
    ).toHaveLength(76);
    // The farming branch's declared debt on the hotbar: eight plain farm
    // dishes plus the four Phase 11 buff dishes (kind 'food') and the hoe
    // ladder (use.type 'gatherTool'). Re-derived unchanged on
    // the merged tree at the farming absorb (Phase 11d); grows as 11e
    // through 11k park ids.
    // 19 at Phase 11i: the apex rod (use.type 'gatherTool') and the two plain
    // fish dishes (kind 'food') join the hotbar debt. The three catches, the
    // feast and the four patterns are not hotbar items, so the park grew by
    // eleven while THIS term grew by three.
    // 20 at Phase 11j: the apex hoe, the hoe ladder's fifth rung and a
    // gatherTool like every rung below it. It is the ONLY term the phase moved
    // here, because artSubjectHotbarItemIds above counts ART-SUBJECT ids (live
    // minus the park) and the hoe is parked rather than painted.
    //
    // THIS IS THE THIRD INDEPENDENT PIN OVER THE SAME PARK, after the exact-set
    // arm in tests/item_icons.test.ts and pendingArtCount in
    // scripts/item_art_audit.mjs, and all three must move together. TWO of the
    // three ARE reachable by a targeted run: this file and item_icons both
    // import ITEMS and ITEM_ART_PENDING, so `vitest related` on either source
    // selects them. The one that is not is pendingArtCount, which lives under
    // scripts/ and is reached out-of-graph through execFileSync, so it is
    // invisible to selection and the full suite is the only thing that catches
    // it. Do not read this as "targeted verification cannot help here": it
    // helps for two of the three, and the third is the reason to run the suite
    // anyway.
    expect(pendingHotbarItemIds, 'ITEM_ART_PENDING hotbar items').toHaveLength(20);
    expect(
      pendingHotbarItemIds.filter((id) => shippingImageExists(`/ui/items/${id}.webp`)),
      'no pending hotbar item ships committed art (a stale ITEM_ART_PENDING entry)',
    ).toEqual([]);
    expect(
      artSubjectHotbarItemIds.filter((id) => !paintedHotbarItemIds.has(id)),
      'every art-subject hotbar item resolves to committed painted art',
    ).toEqual([]);
    expect(aggregate.runtimeClosure.hotbarItems).toEqual({
      live: artSubjectHotbarItemIds.length,
      painted: paintedHotbarItemIds.size,
    });
  });
});
