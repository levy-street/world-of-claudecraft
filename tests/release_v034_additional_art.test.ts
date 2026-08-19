import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type AcceptedArtManifest,
  type AcceptedIconAsset,
  auditIconAssets,
} from '../scripts/lib/icon_asset_audit.mjs';
import { GUIDE_DEEDS } from '../src/guide/content.generated';
import { DEED_ORDER, DEEDS } from '../src/sim/content/deeds';
import { ABILITIES, ITEMS } from '../src/sim/data';
import { DEED_IMAGE_IDS } from '../src/ui/deed_image_ids';
import {
  ABILITY_IMAGE_IDS,
  abilityImageUrl,
  DEED_ART_PENDING,
  deedImageUrl,
  ITEM_ART_PENDING,
  iconDataUrl,
  itemImageUrl,
} from '../src/ui/icons';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repoRoot, 'docs/achievements/release-v034-additional-art.json');

const ABILITY_IDS = ['aspect_of_the_monkey'] as const;
const ITEM_IDS = ['last_keep_signet', 'silkspun_satchel'] as const;
const DEED_IDS = [
  'chr_farshore_first_cast',
  'chr_farshore_gatherer',
  'chr_galecrest_first_cast',
  'chr_galecrest_gatherer',
  'chr_willowfen_first_cast',
  'chr_willowfen_gatherer',
] as const;

const DEED_SHIPPING_GEOMETRY: Record<
  (typeof DEED_IDS)[number],
  { alphaBounds: [number, number, number, number]; visiblePixels: number }
> = {
  chr_farshore_first_cast: { alphaBounds: [14, 14, 113, 113], visiblePixels: 6742 },
  chr_farshore_gatherer: { alphaBounds: [15, 14, 112, 113], visiblePixels: 6882 },
  chr_galecrest_first_cast: { alphaBounds: [14, 14, 113, 113], visiblePixels: 6784 },
  chr_galecrest_gatherer: { alphaBounds: [15, 14, 112, 113], visiblePixels: 6916 },
  chr_willowfen_first_cast: { alphaBounds: [15, 14, 112, 113], visiblePixels: 7039 },
  chr_willowfen_gatherer: { alphaBounds: [14, 14, 113, 113], visiblePixels: 6865 },
};

const RETIRED_HASHES = {
  duplicatedMarten: '298aef26a1a4387418902d01256e1f8e69b08ee19993fe82caf6cd9dd2d6c384',
  hueShiftedSatchel: 'c14b3a75233220ff4fc05fec864a287b3a4b2f618a542c0696c5c3d8a108a2ce',
  proceduralSignet: 'c90769f6d7ace5473315bb0916574cd1ae65e8c12f5fa760797e81bc6b3eebf2',
} as const;

const GENERATED_ABILITY_PACK = 'woc_openai_release_v034_audit_2026_08_02';
const GENERATED_SOURCE = 'OpenAI built-in image generation';
const GENERATED_OWNER = 'World of ClaudeCraft';

interface ReferenceRecord {
  path: string;
  role: string;
  provenance: string;
  license: string;
}

interface ReleaseAsset extends AcceptedIconAsset {
  acceptedSha256: string;
  acceptedBytes: number;
  master: {
    path: string;
    sha256: string;
    width: number;
    height: number;
    format: string;
    colourspace: string;
  };
  source: {
    path: string;
    sha256: string;
    width: number;
    height: number;
    format: string;
    colourspace: string;
    geometry?: {
      alphaThreshold: number;
      bounds: [number, number, number, number];
      visiblePixels: number;
      coverage: number;
      centerOffset: [number, number];
    };
  };
  generation: {
    source: string;
    owner: string;
    license: string;
    prompt: string;
    references: ReferenceRecord[];
  };
  expected: {
    width: number;
    height: number;
    maxBytes: number;
    alpha: 'opaque' | 'transparent-subject';
    geometry?: {
      alphaThreshold: number;
      minPadding: number;
      maxCenterOffset: number;
      coverageMin: number;
      coverageMax: number;
      alphaBounds: [number, number, number, number];
      visiblePixels: number;
    };
  };
}

interface ReleaseManifest extends AcceptedArtManifest {
  scope: {
    targetRows: number;
    rasterPaintings: number;
    abilities: number;
    items: number;
    deeds: number;
  };
  targetSets: {
    abilities: string[];
    items: string[];
    deeds: string[];
  };
  assets: ReleaseAsset[];
}

interface AbilityMappingEntry {
  abilityId: string;
  sourcePack: string;
  sourceFile: string;
  output: string;
  source?: string;
  owner?: string;
  license?: string;
  references?: ReferenceRecord[];
  generationPrompt?: string;
}

interface ItemGeneratedBatch {
  batchId?: string;
  source: string;
  owner?: string;
  license: string;
  styleReference: string;
  styleReferencesByItem?: Record<string, ReferenceRecord[]>;
  commonPrompt: string;
  itemDirections?: Record<string, { generationPrompt: string }>;
  itemIds: string[];
}

function manifest(): ReleaseManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as ReleaseManifest;
}

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hashFile(file: string): string {
  return hashBytes(readFileSync(file));
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function filesUnder(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const current = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(current));
    else if (entry.isFile() && entry.name.endsWith('.webp')) files.push(current);
  }
  return files.sort();
}

function hashOwners(dir: string): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const file of filesUnder(dir)) {
    const hash = hashFile(file);
    owners.set(hash, [...(owners.get(hash) ?? []), path.relative(repoRoot, file)]);
  }
  return owners;
}

function currentComparator(
  kind: 'ability' | 'item',
  id: string,
  runtimeUrl: string,
  className?: string,
): AcceptedIconAsset {
  const bytes = readFileSync(path.join(repoRoot, 'public', runtimeUrl.slice(1)));
  return {
    kind,
    id,
    runtimeUrl,
    alpha: 'any',
    acceptedSha256: hashBytes(bytes),
    acceptedBytes: bytes.length,
    ...(className ? { class: className } : {}),
  };
}

function creditRow(credits: string, prefix: string): string {
  const matches = credits.split('\n').filter((line) => line.startsWith(`| ${prefix}`));
  expect(matches, `${prefix} credit row`).toHaveLength(1);
  return matches[0] ?? '';
}

function creditCells(row: string): string[] {
  return row
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
}

describe('release v0.34 additional painted art', () => {
  it('pins the exact nine-target scope and complete repository-owned generation record', () => {
    expect(existsSync(manifestPath), 'the accepted-art manifest must be committed').toBe(true);
    const accepted = manifest();
    expect(accepted.schemaVersion).toBe(1);
    expect(accepted.scope).toEqual({
      targetRows: 9,
      rasterPaintings: 9,
      abilities: 1,
      items: 2,
      deeds: 6,
    });
    expect(accepted.targetSets).toEqual({
      abilities: [...ABILITY_IDS],
      items: [...ITEM_IDS],
      deeds: [...DEED_IDS],
    });
    expect(sorted(accepted.assets.map((asset) => `${asset.kind}:${asset.id}`))).toEqual(
      sorted([
        ...ABILITY_IDS.map((id) => `ability:${id}`),
        ...ITEM_IDS.map((id) => `item:${id}`),
        ...DEED_IDS.map((id) => `deed:${id}`),
      ]),
    );

    for (const asset of accepted.assets) {
      expect(asset.acceptedSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.master.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.source.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(path.isAbsolute(asset.master.path), `${asset.id} master path`).toBe(false);
      expect(path.isAbsolute(asset.source.path), `${asset.id} source path`).toBe(false);
      expect(asset.master.path).toMatch(/^tmp\/imagegen\/release-v034-additions\/masters\//);
      expect(asset.source.path).toMatch(/^tmp\/imagegen\//);
      expect(asset.master.width).toBe(asset.master.height);
      expect(asset.master.width).toBeGreaterThanOrEqual(1024);
      expect(asset.master).toMatchObject({ format: 'png', colourspace: 'srgb' });
      expect(asset.source).toMatchObject({
        width: 512,
        height: 512,
        format: 'png',
        colourspace: 'srgb',
      });
      expect(asset.generation).toMatchObject({
        source: GENERATED_SOURCE,
        owner: GENERATED_OWNER,
      });
      expect(asset.generation.license).toContain('project asset');
      expect(asset.generation.prompt.length, `${asset.id} prompt`).toBeGreaterThan(100);
      expect(asset.generation.references.length, `${asset.id} references`).toBeGreaterThanOrEqual(
        3,
      );
      expect(asset.generation.references.length, `${asset.id} references`).toBeLessThanOrEqual(4);
      for (const reference of asset.generation.references) {
        expect(reference.role, `${asset.id} reference role`).toContain('reference');
        expect(path.isAbsolute(reference.path), `${asset.id} reference path`).toBe(false);
        expect(existsSync(path.join(repoRoot, reference.path)), reference.path).toBe(true);
        expect(reference.provenance, `${asset.id} reference provenance`).toBeTruthy();
        expect(reference.license, `${asset.id} reference license`).toBeTruthy();
        if (reference.provenance.includes('CraftPix')) {
          expect(reference.license, `${asset.id} CraftPix lineage`).toContain('CraftPix');
        }
      }

      if (asset.kind === 'deed') {
        expect(asset.source.geometry, `${asset.id} source geometry`).toBeDefined();
        const reviewed = DEED_SHIPPING_GEOMETRY[asset.id as (typeof DEED_IDS)[number]];
        expect(reviewed, `${asset.id} reviewed geometry pin`).toBeDefined();
        expect(asset.expected.geometry, `${asset.id} shipping geometry`).toMatchObject({
          alphaThreshold: 8,
          minPadding: expect.any(Number),
          maxCenterOffset: expect.any(Number),
          coverageMin: expect.any(Number),
          coverageMax: expect.any(Number),
          ...reviewed,
        });
      }
    }
  });

  it('audits exact shipping identity, colour, alpha geometry, and visual uniqueness', async () => {
    const accepted = manifest();
    const report = await auditIconAssets({ manifest: accepted, repoRoot });
    expect(report.summary).toEqual({
      ok: true,
      assetCount: 9,
      issueCount: 0,
      exactDuplicateGroupCount: 0,
      perceptualCandidateCount: 0,
      contactSheetCount: 0,
    });
    expect(report.exactDuplicates).toEqual([]);
    expect(report.perceptualCandidates).toEqual([]);
    for (const asset of report.assets) {
      expect(asset).toMatchObject({
        width: 128,
        height: 128,
        format: 'webp',
        colourspace: 'srgb',
        issues: [],
      });
    }

    const comparisonManifest: AcceptedArtManifest = {
      ...accepted,
      assets: [
        ...accepted.assets,
        currentComparator('ability', 'comparison_prowl', '/ui/skills/druid/prowl.webp', 'druid'),
        currentComparator('item', 'comparison_linen_pouch', '/ui/items/linen_pouch.webp'),
      ],
    };
    const comparison = await auditIconAssets({ manifest: comparisonManifest, repoRoot });
    expect(comparison.summary).toMatchObject({
      ok: true,
      assetCount: 11,
      issueCount: 0,
      exactDuplicateGroupCount: 0,
      perceptualCandidateCount: 0,
    });
    expect(comparison.exactDuplicates).toEqual([]);
    expect(comparison.perceptualCandidates).toEqual([]);
  });

  it('keeps each accepted hash unique and retires the duplicate and placeholder identities', () => {
    const accepted = manifest();
    const byKind = {
      ability: hashOwners(path.join(repoRoot, 'public/ui/skills')),
      item: hashOwners(path.join(repoRoot, 'public/ui/items')),
      deed: hashOwners(path.join(repoRoot, 'public/ui/deeds')),
    };
    for (const asset of accepted.assets) {
      expect(byKind[asset.kind].get(asset.acceptedSha256), `${asset.id} hash owners`).toEqual([
        `public${asset.runtimeUrl}`,
      ]);
    }

    const martensGuiseHash = hashFile(
      path.join(repoRoot, 'public/ui/skills/hunter/aspect_of_the_monkey.webp'),
    );
    const prowlHash = hashFile(path.join(repoRoot, 'public/ui/skills/druid/prowl.webp'));
    const satchelHash = hashFile(path.join(repoRoot, 'public/ui/items/silkspun_satchel.webp'));
    const linenHash = hashFile(path.join(repoRoot, 'public/ui/items/linen_pouch.webp'));
    const signetHash = hashFile(path.join(repoRoot, 'public/ui/items/last_keep_signet.webp'));

    expect(martensGuiseHash).not.toBe(RETIRED_HASHES.duplicatedMarten);
    expect(martensGuiseHash).not.toBe(prowlHash);
    expect(byKind.ability.get(RETIRED_HASHES.duplicatedMarten)).toEqual([
      'public/ui/skills/druid/prowl.webp',
    ]);
    expect(satchelHash).not.toBe(RETIRED_HASHES.hueShiftedSatchel);
    expect(satchelHash).not.toBe(linenHash);
    expect(byKind.item.has(RETIRED_HASHES.hueShiftedSatchel)).toBe(false);
    expect(signetHash).not.toBe(RETIRED_HASHES.proceduralSignet);
    expect(byKind.item.has(RETIRED_HASHES.proceduralSignet)).toBe(false);
  });

  it('resolves all nine targets through their painted runtime paths', () => {
    for (const id of ABILITY_IDS) {
      expect(ABILITIES[id]?.class).toBe('hunter');
      expect(ABILITY_IMAGE_IDS.has(id)).toBe(true);
      expect(abilityImageUrl(id)).toBe(`/ui/skills/hunter/${id}.webp`);
      expect(iconDataUrl('ability', id)).toBe(`/ui/skills/hunter/${id}.webp`);
      expect(iconDataUrl('aura', id)).toBe(`/ui/skills/hunter/${id}.webp`);
    }
    for (const id of ITEM_IDS) {
      expect(ITEMS[id], `${id} live item`).toBeDefined();
      expect(ITEMS[id].kind, `${id} nonweapon lane`).not.toBe('weapon');
      expect(ITEM_ART_PENDING.has(id), `${id} pending art`).toBe(false);
      expect(itemImageUrl(id)).toBe(`/ui/items/${id}.webp`);
      expect(iconDataUrl('item', id)).toBe(`/ui/items/${id}.webp`);
    }

    // No POSITIONAL pin on this wave's six. The assertion that broke on the base sync was
    // exactly that ("the six v0.34 targets are the catalog tail"), and catalog order is
    // incidental to what this test is for: that all nine targets resolve through their
    // painted runtime paths. Re-pinning the tail one slot further along would just hand the
    // same breakage to the next deed anyone appends. Membership plus painted resolution is
    // the durable claim, and the loop below is where it lands.
    // The artless set IS pinned, from its one owner, so unenumerated art debt still reds.
    expect(DEED_ORDER.filter((id) => !DEED_IMAGE_IDS.has(id))).toEqual([...DEED_ART_PENDING]);
    // This pack landed as one contiguous append block; it no longer sits at
    // DEED_ORDER's tail once a later change appends more deeds after it (the
    // zone chronicle extension did), so pin contiguity + membership instead
    // of an absolute tail slice.
    const deedIdIndices = DEED_IDS.map((id) => DEED_ORDER.indexOf(id));
    expect(
      deedIdIndices.every((i) => i >= 0),
      'every DEED_IDS member is live',
    ).toBe(true);
    const lo = Math.min(...deedIdIndices);
    const hi = Math.max(...deedIdIndices);
    expect(hi - lo + 1, 'the pack is a contiguous append block').toBe(DEED_IDS.length);
    expect(sorted(DEED_ORDER.slice(lo, hi + 1))).toEqual([...DEED_IDS]);
    // The twelve zone chronicle deeds appended after this pack ship
    // art-trailing (docs/design/deeds.md rule 6); this pack itself still
    // ships fully painted.
    expect(
      DEED_IDS.every((id) => DEED_IMAGE_IDS.has(id)),
      'this pack stays fully painted',
    ).toBe(true);
    for (const id of DEED_IDS) {
      expect(DEEDS[id], `${id} live deed`).toBeDefined();
      expect(DEED_IMAGE_IDS.has(id), `${id} generated registry`).toBe(true);
      expect(deedImageUrl(`deed_${id}`)).toBe(`/ui/deeds/${id}.webp`);
      expect(iconDataUrl('crest', `deed_${id}`)).toBe(`/ui/deeds/${id}.webp`);
      expect(GUIDE_DEEDS.find((deed) => deed.id === id)?.crest).toBe(`/ui/deeds/${id}.webp`);
    }
  });

  it("owns Marten's Guise exactly once with explicit generated-art provenance", () => {
    const accepted = manifest();
    const asset = accepted.assets.find(
      (candidate) => candidate.kind === 'ability' && candidate.id === ABILITY_IDS[0],
    );
    expect(asset).toBeDefined();

    const entries: Array<{ className: string; entry: AbilityMappingEntry }> = [];
    const skillsDir = path.join(repoRoot, 'public/ui/skills');
    for (const directory of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!directory.isDirectory()) continue;
      const mappingPath = path.join(skillsDir, directory.name, 'mapping.json');
      if (!existsSync(mappingPath)) continue;
      const mapping = JSON.parse(readFileSync(mappingPath, 'utf8')) as {
        abilities: AbilityMappingEntry[];
      };
      entries.push(...mapping.abilities.map((entry) => ({ className: directory.name, entry })));
    }
    const owners = entries.filter(({ entry }) => entry.abilityId === ABILITY_IDS[0]);
    expect(owners).toHaveLength(1);
    expect(owners[0]).toMatchObject({
      className: 'hunter',
      entry: {
        abilityId: ABILITY_IDS[0],
        sourcePack: GENERATED_ABILITY_PACK,
        sourceFile: asset?.source.path,
        output: `${ABILITY_IDS[0]}.webp`,
        source: GENERATED_SOURCE,
        owner: GENERATED_OWNER,
        references: asset?.generation.references,
        generationPrompt: asset?.generation.prompt,
      },
    });
    expect(owners[0].entry.license).toContain('project asset');
    expect(owners[0].entry.license).not.toContain('CraftPix');
  });

  it('owns both item replacements exactly once in nonprocedural generated batches', () => {
    const accepted = manifest();
    const mapping = JSON.parse(
      readFileSync(path.join(repoRoot, 'public/ui/items/mapping.json'), 'utf8'),
    ) as {
      entries: Array<{ itemId: string }>;
      generatedBatches: ItemGeneratedBatch[];
    };
    const targets = new Set<string>(ITEM_IDS);
    expect(mapping.entries.filter((entry) => targets.has(entry.itemId))).toEqual([]);

    for (const id of ITEM_IDS) {
      const asset = accepted.assets.find(
        (candidate) => candidate.kind === 'item' && candidate.id === id,
      );
      const owners = mapping.generatedBatches.filter((batch) => batch.itemIds.includes(id));
      expect(owners, `${id} mapping owner`).toHaveLength(1);
      const owner = owners[0];
      expect(owner).toMatchObject({
        source: GENERATED_SOURCE,
        owner: GENERATED_OWNER,
        itemIds: [id],
        styleReferencesByItem: { [id]: asset?.generation.references },
      });
      expect(owner.batchId).toContain('release-v034-additional-art');
      expect(owner.license).toContain('project asset');
      expect(owner.commonPrompt).toBe(asset?.generation.prompt);
      expect(owner.styleReference).toBeTruthy();
      expect(owner.itemIds).toEqual(sorted(new Set(owner.itemIds)));
      const directionPrompt = owner.itemDirections?.[id]?.generationPrompt;
      if (directionPrompt !== undefined) expect(directionPrompt).toBe(asset?.generation.prompt);
      expect(JSON.stringify(owner).toLowerCase()).not.toMatch(
        /procedural icon compositor|renderproceduraliconpng|deterministic compositor|hue-shift/,
      );
    }
  });

  it('credits generated ownership without erasing licensed reference lineage', () => {
    const credits = readFileSync(path.join(repoRoot, 'CREDITS.md'), 'utf8');
    const provenance = readFileSync(
      path.join(repoRoot, 'docs/achievements/professions-tuning-art-provenance.md'),
      'utf8',
    );
    const itemRow = creditRow(credits, 'Generated item icon rebrand');
    const abilityRow = creditRow(credits, 'Generated class ability additions');
    const deedRow = creditRow(credits, 'Generated Book of Deeds additions');
    const commissionedDeedRow = creditRow(credits, 'Book of Deeds achievement icons');

    for (const [row, label] of [
      [itemRow, 'item'],
      [abilityRow, 'ability'],
      [deedRow, 'deed'],
    ] as const) {
      const cells = creditCells(row);
      expect(cells[1], `${label} generated-art owner`).toBe(GENERATED_OWNER);
      expect(cells[2], `${label} generated-art source`).toContain(GENERATED_SOURCE);
      expect(cells[2], `${label} manifest`).toContain(
        'docs/achievements/release-v034-additional-art.json',
      );
      expect(cells[3], `${label} project license`).toContain('Project asset');
    }
    expect(abilityRow).toContain(GENERATED_ABILITY_PACK);
    for (const id of ITEM_IDS) {
      expect(count(credits, id), `${id} credit ownership`).toBe(1);
      expect(itemRow).toContain(id);
    }
    for (const id of DEED_IDS) {
      expect(count(credits, id), `${id} credit ownership`).toBe(1);
      expect(deedRow).toContain(id);
      expect(commissionedDeedRow).not.toContain(id);
      expect(provenance, `${id} provenance`).toContain(id);
    }
    expect(commissionedDeedRow).toContain('excluding the project-generated additions');
    expect(provenance).toContain(GENERATED_SOURCE);
    expect(provenance).toContain('docs/achievements/release-v034-additional-art.json');
    expect(credits).toContain('CraftPix Premium');
  });
});
