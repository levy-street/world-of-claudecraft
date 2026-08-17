import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { resolveHudAuraIconUrl } from '../src/ui/aura_icon_runtime';
import { AURA_FILE_IMAGE_IDS, AURA_IMAGE_IDS, auraImageUrl, iconDataUrl } from '../src/ui/icons';
import { MOB_AURA_IMAGE_IDS } from '../src/ui/mob_aura_icon_art';

describe('exact runtime aura paintings', () => {
  const auraArtDir = path.join(process.cwd(), 'public/ui/auras');
  const firstPassManifest =
    'docs/achievements/release-v039-icon-art-first-pass-2026-08-16/accepted-art.json';
  const secondPassManifest =
    'docs/achievements/release-v039-icon-art-second-pass-2026-08-16/accepted-aura-art.json';
  const elixirManifest =
    'docs/achievements/release-v039-icon-art-second-pass-2026-08-16/accepted-elixir-aura-art.json';
  const fearManifest =
    'docs/achievements/release-v039-icon-art-second-pass-2026-08-16/accepted-fear-aura-art.json';
  const mobManifest =
    'docs/achievements/release-v039-icon-art-second-pass-2026-08-16/accepted-mob-aura-art.json';
  const secondPassManifestSha256 =
    'bdf2aeaf3db9c63f0952f55fbcde2458d9c0706aa9f08cf9f26ab4eff9ec83fe';
  const externalAuraArt = new Map([
    ['bad_air', '/ui/delve-affixes/bad_air.webp'],
    ['pow_berserker', '/ui/fiesta/powerups/pow_berserker.webp'],
    ['pow_colossus', '/ui/fiesta/powerups/pow_colossus.webp'],
    ['pow_moon_boots', '/ui/fiesta/powerups/pow_moon_boots.webp'],
    ['pow_speed_demon', '/ui/fiesta/powerups/pow_speed_demon.webp'],
  ]);

  it('keeps registry, files, and provenance in exact parity', async () => {
    const trackedPaths = new Set(
      execFileSync('git', ['ls-files'], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })
        .trim()
        .split('\n'),
    );
    const mapping = JSON.parse(readFileSync(path.join(auraArtDir, 'mapping.json'), 'utf8')) as {
      schemaVersion: number;
      family: string;
      iconSize: number;
      runtimeDir: string;
      acceptedArtManifest: string;
      acceptedArtManifests: string[];
      externalAssets: Array<{
        auraId: string;
        runtimeUrl: string;
        ownerManifest: string;
      }>;
      assets: Array<{
        auraId: string;
        output: string;
        sourceFile: string;
        sourceBytes: number;
        source: string;
        owner: string;
        license: string;
        acceptedArtManifest: string;
        sourceSha256: string;
        acceptedSha256: string;
        acceptedBytes: number;
        references: Array<{ path: string; role: string }>;
        sourceProvenance?: string;
      }>;
    };
    const firstPass = JSON.parse(
      readFileSync(path.join(process.cwd(), firstPassManifest), 'utf8'),
    ) as {
      assets: Array<{
        id: string;
        sourcePath: string;
        sourceBytes: number;
        sourceSha256: string;
        acceptedSha256: string;
        acceptedBytes: number;
        references: string[];
      }>;
    };
    const secondPassBytes = readFileSync(path.join(process.cwd(), secondPassManifest));
    const secondPass = JSON.parse(secondPassBytes.toString('utf8')) as {
      schemaVersion: number;
      batch: {
        id: string;
        baseRelease: string;
        rasterGenerator: string;
      };
      scope: {
        exactRuntimeAuras: number;
        cohorts: Record<string, number>;
      };
      assets: Array<{
        auraId: string;
        sourceProvenance: string;
        sourceFile: string;
        sourceBytes: number;
        sourceSha256: string;
        acceptedSha256: string;
        acceptedBytes: number;
        references: Array<{ path: string; role: string }>;
        prompt: string;
      }>;
    };
    const elixirBytes = readFileSync(path.join(process.cwd(), elixirManifest));
    const elixir = JSON.parse(elixirBytes.toString('utf8')) as {
      schemaVersion: number;
      batch: { id: string; baseRelease: string; rasterGenerator: string };
      scope: { exactRuntimeAuras: number; liveSourceItems: string[] };
      generationContract: { builtInImagegenCalls: number; acceptedFirstOutputs: number };
      assets: Array<{
        auraId: string;
        sourceProvenance: string;
        sourceFile: string;
        sourceBytes: number;
        sourceSha256: string;
        acceptedSha256: string;
        acceptedBytes: number;
        references: Array<{ path: string; role: string }>;
        prompt: string;
      }>;
    };
    const fearBytes = readFileSync(path.join(process.cwd(), fearManifest));
    const fear = JSON.parse(fearBytes.toString('utf8')) as {
      schemaVersion: number;
      batch: { id: string; baseRelease: string; rasterGenerator: string };
      scope: {
        exactRuntimeAuras: number;
        runtimeIdentity: string;
        liveProducerFamilies: string[];
        semanticConstraint: string;
      };
      generationContract: {
        builtInImagegenCalls: number;
        acceptedFirstOutputs: number;
        rejectedOutputs: number;
      };
      assets: Array<{
        auraId: string;
        sourceProvenance: string;
        sourceFile: string;
        sourceBytes: number;
        sourceSha256: string;
        acceptedSha256: string;
        acceptedBytes: number;
        references: Array<{ path: string; role: string }>;
        prompt: string;
      }>;
    };
    const committed = readdirSync(auraArtDir).sort();
    const committedIds = committed
      .filter((name) => name.endsWith('.webp') && !name.startsWith('mob_'))
      .map((name) => path.basename(name, '.webp'))
      .sort();
    const mappedEntries = mapping.assets.filter(({ auraId }) => !auraId.startsWith('mob_'));
    const mappedIds = mappedEntries.map(({ auraId }) => auraId).sort();
    const expectedIds = [...AURA_FILE_IMAGE_IDS].filter((id) => !id.startsWith('mob_')).sort();
    const acceptedById = new Map<
      string,
      {
        auraId: string;
        sourceFile: string;
        sourceBytes: number;
        sourceSha256: string;
        acceptedSha256: string;
        acceptedBytes: number;
        acceptedArtManifest: string;
        references: string[];
        sourceProvenance: string | undefined;
      }
    >([
      ...firstPass.assets
        .filter(({ id }) => id === 'cheater_mark')
        .map(
          (asset) =>
            [
              asset.id,
              {
                auraId: asset.id,
                sourceFile: asset.sourcePath,
                sourceBytes: asset.sourceBytes,
                sourceSha256: asset.sourceSha256,
                acceptedSha256: asset.acceptedSha256,
                acceptedBytes: asset.acceptedBytes,
                acceptedArtManifest: firstPassManifest,
                references: asset.references,
                sourceProvenance: undefined,
              },
            ] as const,
        ),
      ...secondPass.assets.map(
        (asset) =>
          [
            asset.auraId,
            {
              auraId: asset.auraId,
              sourceFile: asset.sourceFile,
              sourceBytes: asset.sourceBytes,
              sourceSha256: asset.sourceSha256,
              acceptedSha256: asset.acceptedSha256,
              acceptedBytes: asset.acceptedBytes,
              acceptedArtManifest: secondPassManifest,
              references: asset.references.map(({ path: referencePath }) => referencePath),
              sourceProvenance: asset.sourceProvenance,
            },
          ] as const,
      ),
      ...elixir.assets.map(
        (asset) =>
          [
            asset.auraId,
            {
              auraId: asset.auraId,
              sourceFile: asset.sourceFile,
              sourceBytes: asset.sourceBytes,
              sourceSha256: asset.sourceSha256,
              acceptedSha256: asset.acceptedSha256,
              acceptedBytes: asset.acceptedBytes,
              acceptedArtManifest: elixirManifest,
              references: asset.references.map(({ path: referencePath }) => referencePath),
              sourceProvenance: asset.sourceProvenance,
            },
          ] as const,
      ),
      ...fear.assets.map(
        (asset) =>
          [
            asset.auraId,
            {
              auraId: asset.auraId,
              sourceFile: asset.sourceFile,
              sourceBytes: asset.sourceBytes,
              sourceSha256: asset.sourceSha256,
              acceptedSha256: asset.acceptedSha256,
              acceptedBytes: asset.acceptedBytes,
              acceptedArtManifest: fearManifest,
              references: asset.references.map(({ path: referencePath }) => referencePath),
              sourceProvenance: asset.sourceProvenance,
            },
          ] as const,
      ),
    ]);

    expect(committed.filter((name) => name !== 'mapping.json' && !name.endsWith('.webp'))).toEqual(
      [],
    );
    expect(expectedIds).toHaveLength(85);
    expect(committedIds).toEqual(expectedIds);
    expect(mappedIds).toEqual(expectedIds);
    expect([...acceptedById.keys()].sort()).toEqual(expectedIds);
    expect(createHash('sha256').update(secondPassBytes).digest('hex')).toBe(
      secondPassManifestSha256,
    );
    expect(secondPass).toMatchObject({
      schemaVersion: 1,
      batch: {
        id: 'release-v039-icon-art-second-pass-auras-2026-08-16',
        baseRelease: 'release/v0.39.0',
        rasterGenerator: 'OpenAI built-in image generation',
      },
      scope: {
        exactRuntimeAuras: 82,
        cohorts: {
          'collision-auras': 28,
          'core-auras-a': 12,
          'core-auras-b': 10,
          'core-auras-c': 3,
          'delve-encounters': 13,
          'set-weapon-procs': 16,
        },
      },
    });
    expect(createHash('sha256').update(elixirBytes).digest('hex')).toBe(
      '28c725f7828c607b613d7fea47b32a016aff17d0d1f653cfb77fcd51db8233e9',
    );
    expect(elixir).toMatchObject({
      schemaVersion: 1,
      batch: {
        id: 'release-v039-icon-art-second-pass-elixir-aura-2026-08-16',
        baseRelease: 'release/v0.39.0',
        rasterGenerator: 'OpenAI built-in image generation',
      },
      scope: { exactRuntimeAuras: 1 },
      generationContract: { builtInImagegenCalls: 1, acceptedFirstOutputs: 1 },
    });
    expect(elixir.scope.liveSourceItems).toEqual([
      'elixir_of_the_bear',
      'elixir_of_the_boar',
      'venomfire_elixir',
      'elixir_of_the_serpent',
    ]);
    expect(elixir.assets).toHaveLength(1);
    expect(createHash('sha256').update(fearBytes).digest('hex')).toBe(
      '230a8deef4869b88061f12bccdb75bd1bc8b480a14ccc3bbfb5d178103a3c0da',
    );
    expect(fear).toMatchObject({
      schemaVersion: 1,
      batch: {
        id: 'release-v039-icon-art-second-pass-fear-aura-2026-08-16',
        baseRelease: 'release/v0.39.0',
        rasterGenerator: 'OpenAI built-in image generation',
      },
      scope: { exactRuntimeAuras: 1, runtimeIdentity: 'fear_incap' },
      generationContract: {
        builtInImagegenCalls: 1,
        acceptedFirstOutputs: 1,
        rejectedOutputs: 0,
      },
    });
    expect(fear.scope.liveProducerFamilies).toHaveLength(6);
    expect(fear.scope.semanticConstraint).toContain('does not claim a caster class');
    expect(fear.assets).toHaveLength(1);
    for (const asset of [...secondPass.assets, ...elixir.assets, ...fear.assets]) {
      expect(asset.sourceFile, asset.auraId).toMatch(/^tmp\/imagegen\/v039-second-pass\//);
      expect(asset.sourceBytes, asset.auraId).toBeGreaterThan(0);
      expect(asset.sourceSha256, asset.auraId).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.references.length, asset.auraId).toBeGreaterThanOrEqual(2);
      expect(asset.references.length, asset.auraId).toBeLessThanOrEqual(4);
      expect(asset.prompt, asset.auraId).toMatch(/\b(text|letters)\b/i);
      expect(asset.prompt, asset.auraId).toMatch(/\b(border|frame)\b/i);
      for (const reference of asset.references) {
        expect(reference.role.length, asset.auraId).toBeGreaterThan(0);
        expect(trackedPaths.has(reference.path), `${asset.auraId}: ${reference.path}`).toBe(true);
        expect(existsSync(path.join(process.cwd(), reference.path)), asset.auraId).toBe(true);
      }
    }
    expect(mapping).toMatchObject({
      schemaVersion: 1,
      family: 'auras',
      iconSize: 128,
      runtimeDir: 'public/ui/auras',
      acceptedArtManifest: firstPassManifest,
    });
    expect(mapping.acceptedArtManifests).toEqual(
      expect.arrayContaining([
        firstPassManifest,
        secondPassManifest,
        elixirManifest,
        fearManifest,
        mobManifest,
      ]),
    );
    expect(mapping.externalAssets.map(({ auraId, runtimeUrl }) => [auraId, runtimeUrl])).toEqual([
      ...externalAuraArt,
    ]);
    for (const { auraId, runtimeUrl, ownerManifest } of mapping.externalAssets) {
      expect(ownerManifest).toMatch(/^public\/ui\/(delve-affixes|fiesta)\/mapping\.json$/);
      const owner = JSON.parse(readFileSync(path.join(process.cwd(), ownerManifest), 'utf8')) as {
        runtimeDir: string;
        assets: Array<{ id: string; output: string; url?: string }>;
      };
      const owned = owner.assets.filter(({ id }) => id === auraId);
      expect(owned, auraId).toHaveLength(1);
      expect(
        owned[0]?.url ?? `/${owner.runtimeDir.replace(/^public\//, '')}/${owned[0]?.output}`,
        auraId,
      ).toBe(runtimeUrl);
    }

    const hashes = new Set<string>();
    for (const entry of mappedEntries) {
      expect(entry.output, entry.auraId).toBe(`${entry.auraId}.webp`);
      expect(entry.source, entry.auraId).toBe('OpenAI built-in image generation');
      expect(entry.owner, entry.auraId).toBe('World of ClaudeCraft');
      expect(entry.license, entry.auraId).toContain('project asset');
      expect(entry.sourceSha256, entry.auraId).toMatch(/^[0-9a-f]{64}$/);
      expect(
        {
          auraId: entry.auraId,
          sourceFile: entry.sourceFile,
          sourceBytes: entry.sourceBytes,
          sourceSha256: entry.sourceSha256,
          acceptedSha256: entry.acceptedSha256,
          acceptedBytes: entry.acceptedBytes,
          acceptedArtManifest: entry.acceptedArtManifest,
          references: entry.references.map(({ path: referencePath }) => referencePath),
          sourceProvenance: entry.sourceProvenance,
        },
        entry.auraId,
      ).toEqual(acceptedById.get(entry.auraId));

      const url = auraImageUrl(entry.auraId);
      expect(url, entry.auraId).toBe(`/ui/auras/${entry.auraId}.webp`);
      expect(iconDataUrl('aura', entry.auraId), entry.auraId).toBe(url);
      const bytes = readFileSync(path.join(process.cwd(), 'public', (url as string).slice(1)));
      const hash = createHash('sha256').update(bytes).digest('hex');
      const metadata = await sharp(bytes).metadata();

      expect(bytes.length, entry.auraId).toBe(entry.acceptedBytes);
      expect(bytes.length, entry.auraId).toBeLessThanOrEqual(15 * 1024);
      expect(hash, entry.auraId).toBe(entry.acceptedSha256);
      expect(metadata, entry.auraId).toMatchObject({
        format: 'webp',
        width: 128,
        height: 128,
        space: 'srgb',
        hasAlpha: false,
      });
      hashes.add(hash);
    }
    expect(hashes.size).toBe(expectedIds.length);
    expect(readFileSync(path.join(process.cwd(), 'CREDITS.md'), 'utf8')).toContain(
      'Exact runtime aura paintings',
    );
  });

  it('keeps the closed mob-aura family, files, mapping, and accepted lineage in parity', async () => {
    const mapping = JSON.parse(readFileSync(path.join(auraArtDir, 'mapping.json'), 'utf8')) as {
      acceptedArtManifests: string[];
      assets: Array<{
        auraId: string;
        output: string;
        sourceFile: string;
        sourceBytes: number;
        source: string;
        owner: string;
        license: string;
        acceptedArtManifest: string;
        sourceSha256: string;
        acceptedSha256: string;
        acceptedBytes: number;
        references: Array<{ path: string; role: string }>;
        sourceProvenance?: string;
      }>;
    };
    const manifestBytes = readFileSync(path.join(process.cwd(), mobManifest));
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
      schemaVersion: number;
      batch: { id: string; baseRelease: string; rasterGenerator: string };
      scope: {
        paintedMobAuraFamilies: number;
        exactRuntimeAuraIds: number;
        liveCarrierRows: number;
      };
      assets: Array<{
        auraId: string;
        runtimeIds: string[];
        carrierCount: number;
        sourceFile: string;
        sourceBytes: number;
        sourceSha256: string;
        acceptedBytes: number;
        acceptedSha256: string;
        references: Array<{ path: string; role: string }>;
        prompt: string;
      }>;
    };
    const ids = [...MOB_AURA_IMAGE_IDS].sort();
    const fileIds = readdirSync(auraArtDir)
      .filter((name) => name.startsWith('mob_') && name.endsWith('.webp'))
      .map((name) => path.basename(name, '.webp'))
      .sort();
    const entries = mapping.assets.filter(({ auraId }) => auraId.startsWith('mob_'));
    const manifestById = new Map(manifest.assets.map((asset) => [asset.auraId, asset]));

    expect(createHash('sha256').update(manifestBytes).digest('hex')).toBe(
      'db55c232d88c6f0b4dc9bdac72d0b497166f1f5ec8455db87aace35b80a428c1',
    );
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      batch: {
        id: 'release-v039-icon-art-second-pass-mob-auras-2026-08-16',
        baseRelease: 'release/v0.39.0',
        rasterGenerator: 'OpenAI built-in image generation',
      },
      scope: {
        paintedMobAuraFamilies: 44,
        exactRuntimeAuraIds: 89,
        liveCarrierRows: 108,
      },
    });
    expect(ids).toHaveLength(44);
    expect(fileIds).toEqual(ids);
    expect(entries.map(({ auraId }) => auraId).sort()).toEqual(ids);
    expect([...manifestById.keys()].sort()).toEqual(ids);
    expect(mapping.acceptedArtManifests).toContain(mobManifest);

    const hashes = new Set<string>();
    for (const entry of entries) {
      const accepted = manifestById.get(entry.auraId);
      expect(accepted, entry.auraId).toBeDefined();
      expect(entry).toMatchObject({
        output: `${entry.auraId}.webp`,
        sourceFile: accepted?.sourceFile,
        sourceBytes: accepted?.sourceBytes,
        source: 'OpenAI built-in image generation',
        owner: 'World of ClaudeCraft',
        acceptedArtManifest: mobManifest,
        sourceSha256: accepted?.sourceSha256,
        acceptedSha256: accepted?.acceptedSha256,
        acceptedBytes: accepted?.acceptedBytes,
        sourceProvenance: 'tmp/imagegen/v039-second-pass/mob-aura-families/provenance.json',
      });
      expect(entry.license).toContain('project asset');
      expect(entry.references).toEqual(accepted?.references);
      expect(accepted?.runtimeIds.length, entry.auraId).toBeGreaterThan(0);
      expect(accepted?.carrierCount, entry.auraId).toBeGreaterThan(0);
      expect(accepted?.prompt, entry.auraId).toMatch(/\b(text|letters)\b/i);
      expect(accepted?.prompt, entry.auraId).toMatch(/\b(border|frame)\b/i);

      const url = `/ui/auras/${entry.auraId}.webp`;
      expect(auraImageUrl(entry.auraId), entry.auraId).toBe(url);
      const bytes = readFileSync(path.join(process.cwd(), 'public', url.slice(1)));
      const hash = createHash('sha256').update(bytes).digest('hex');
      const metadata = await sharp(bytes).metadata();
      expect(bytes.length, entry.auraId).toBe(accepted?.acceptedBytes);
      expect(bytes.length, entry.auraId).toBeLessThanOrEqual(15 * 1024);
      expect(hash, entry.auraId).toBe(accepted?.acceptedSha256);
      expect(metadata, entry.auraId).toMatchObject({
        format: 'webp',
        width: 128,
        height: 128,
        space: 'srgb',
        hasAlpha: false,
      });
      hashes.add(hash);
    }
    expect(hashes.size).toBe(ids.length);
  });

  it('continues to reuse ordinary ability paintings for matching aura ids', () => {
    expect(auraImageUrl('moonfire')).toBe('/ui/skills/druid/moonfire.webp');
    for (const [id, url] of externalAuraArt) {
      expect(AURA_FILE_IMAGE_IDS.has(id), id).toBe(false);
      expect(AURA_IMAGE_IDS.has(id), id).toBe(true);
      expect(auraImageUrl(id), id).toBe(url);
    }
    expect(auraImageUrl('missing_aura_identity')).toBeNull();
  });

  it('routes exact aura paintings through the HUD layered-background resolver', () => {
    expect(resolveHudAuraIconUrl('cheater_mark')).toMatch(
      /^url\(\/ui\/auras\/cheater_mark\.webp\), url\(/,
    );
    expect(resolveHudAuraIconUrl('fear_incap')).toMatch(
      /^url\(\/ui\/auras\/fear_incap\.webp\), url\(/,
    );
  });
});
