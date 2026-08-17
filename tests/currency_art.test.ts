import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  CURRENCY_IMAGE_IDS,
  currencyIconHtml,
  currencyImageUrl,
  heroicMarkIconHtml,
} from '../src/ui/currency_art';
import { iconDataUrl } from '../src/ui/icons';

const ACCEPTED_CURRENCY_ART_SHA256 =
  'd71254050852510a7d1eb374e6693d360291bc5db261a55e146be67d9d7a3cb4';

describe('currency art', () => {
  const artDir = path.join(process.cwd(), 'public/ui/currency');

  it('owns the complete painted currency family', () => {
    expect([...CURRENCY_IMAGE_IDS]).toEqual([
      'coin_gold',
      'coin_silver',
      'coin_copper',
      'woc_token',
      'honor',
      'delve_mark',
    ]);
  });

  it('returns stable raw-public URLs only for registered currency identities', () => {
    expect(currencyImageUrl('honor')).toBe('/ui/currency/honor.webp');
    expect(currencyImageUrl('delve_mark')).toBe('/ui/currency/delve_mark.webp');
    expect(currencyImageUrl('missing')).toBeNull();
  });

  it('renders decorative inline art while localized surrounding text owns the label', () => {
    expect(currencyIconHtml('honor')).toBe(
      '<img class="currency-inline currency-honor" src="/ui/currency/honor.webp" alt="" draggable="false">',
    );
    expect(currencyIconHtml('missing')).toBe('');
    expect(heroicMarkIconHtml()).toContain('/ui/items/heroic_mark.webp');
  });

  it('keeps every live balance and spend surface wired to its painted identity', () => {
    const source = (relativePath: string): string =>
      readFileSync(path.join(process.cwd(), relativePath), 'utf8');
    const expectedCalls: Record<string, { needle: string; count: number }> = {
      'src/ui/char_window.ts': { needle: "currencyIconHtml('honor')", count: 1 },
      'src/ui/hud/delve/delve_board_controller.ts': {
        needle: "currencyIconHtml('delve_mark')",
        count: 3,
      },
      'src/ui/hud/delve/delve_tracker_controller.ts': {
        needle: "currencyIconHtml('delve_mark')",
        count: 1,
      },
      'src/ui/hud/vendor/heroic_vendor_window.ts': { needle: 'heroicMarkIconHtml()', count: 2 },
      'src/ui/hud/vendor/vendor_window.ts': { needle: "currencyIconHtml('honor')", count: 2 },
      'src/ui/hud/vendor/warfare_vendor_window.ts': {
        needle: "currencyIconHtml('honor')",
        count: 2,
      },
      'src/ui/claudium_window.ts': { needle: "currencyImageUrl('woc_token')", count: 1 },
      'src/ui/hud.ts': {
        needle: "coinIconUrl: () => iconDataUrl('item', 'coin_gold')",
        count: 1,
      },
    };
    for (const [relativePath, { needle, count }] of Object.entries(expectedCalls)) {
      const contents = source(relativePath);
      expect(contents.split(needle).length - 1, `${relativePath}: ${needle}`).toBe(count);
    }

    const css = source('src/styles/components.css');
    const denominations = [
      { selector: 'g', id: 'coin_gold' },
      { selector: 's', id: 'coin_silver' },
      { selector: 'c', id: 'coin_copper' },
    ] as const;
    for (const denomination of denominations) {
      const matches = [
        ...css.matchAll(new RegExp(`\\.coin\\.${denomination.selector}\\s*\\{([^}]*)\\}`, 'g')),
      ];
      expect(matches, `.coin.${denomination.selector}`).toHaveLength(1);
      const rule = matches[0][1];
      expect(rule, `.coin.${denomination.selector}`).toContain(
        `url("/ui/currency/${denomination.id}.webp")`,
      );
      for (const other of denominations) {
        if (other.id !== denomination.id) {
          expect(rule, `.coin.${denomination.selector} must not render ${other.id}`).not.toContain(
            `/ui/currency/${other.id}.webp`,
          );
        }
      }
    }
    expect(css, 'woc_token').toContain('url("/ui/currency/woc_token.webp")');
  });

  it('keeps registry, mapping, and opaque shipping files in exact parity', async () => {
    const mapping = JSON.parse(readFileSync(path.join(artDir, 'mapping.json'), 'utf8')) as {
      schemaVersion: number;
      family: string;
      iconSize: number;
      runtimeDir: string;
      acceptedArtManifest: string;
      acceptedCohortManifest: string;
      acceptedCohortSha256: string;
      assets: Array<{
        id: string;
        output: string;
        sourceFile: string;
        source: string;
        owner: string;
        license: string;
        sourceSha256: string;
        acceptedSha256: string;
        acceptedBytes: number;
      }>;
    };
    const files = readdirSync(artDir)
      .filter((name) => name.endsWith('.webp'))
      .sort();
    const ids = [...CURRENCY_IMAGE_IDS].sort();

    expect(files).toEqual(ids.map((id) => `${id}.webp`));
    expect(mapping.assets.map(({ id }) => id).sort()).toEqual(ids);
    expect(mapping).toMatchObject({
      schemaVersion: 1,
      family: 'currency',
      iconSize: 128,
      runtimeDir: 'public/ui/currency',
      acceptedArtManifest:
        'docs/achievements/release-v039-icon-art-second-pass-2026-08-16/accepted-art.json',
      acceptedCohortManifest:
        'docs/achievements/release-v039-icon-art-second-pass-2026-08-16/accepted-currency-art.json',
      acceptedCohortSha256: ACCEPTED_CURRENCY_ART_SHA256,
    });

    const hashes = new Set<string>();
    for (const asset of mapping.assets) {
      expect(asset.output).toBe(`${asset.id}.webp`);
      expect(asset.source).toBe('OpenAI built-in image generation');
      expect(asset.owner).toBe('World of ClaudeCraft');
      expect(asset.license).toContain('project asset');
      expect(asset.sourceSha256).toMatch(/^[0-9a-f]{64}$/);

      const bytes = readFileSync(path.join(artDir, asset.output));
      const hash = createHash('sha256').update(bytes).digest('hex');
      const metadata = await sharp(bytes).metadata();
      expect(bytes.length).toBe(asset.acceptedBytes);
      expect(bytes.length).toBeLessThanOrEqual(15 * 1024);
      expect(hash).toBe(asset.acceptedSha256);
      expect(metadata).toMatchObject({
        format: 'webp',
        width: 128,
        height: 128,
        space: 'srgb',
        hasAlpha: false,
      });
      hashes.add(hash);
    }
    expect(hashes.size).toBe(ids.length);
    expect(iconDataUrl('item', 'coin_gold')).toBe('/ui/currency/coin_gold.webp');

    const acceptedRecordBytes = readFileSync(
      path.join(process.cwd(), mapping.acceptedCohortManifest),
    );
    expect(createHash('sha256').update(acceptedRecordBytes).digest('hex')).toBe(
      ACCEPTED_CURRENCY_ART_SHA256,
    );
    expect(mapping.acceptedCohortSha256).toBe(ACCEPTED_CURRENCY_ART_SHA256);

    const acceptedRecord = JSON.parse(acceptedRecordBytes.toString('utf8')) as {
      schemaVersion: number;
      batch: string;
      generator: {
        tool: string;
        workflow: string;
        callsPerAsset: number;
        variantsPerCall: number;
        referenceImagesPassedToGenerator: boolean;
      };
      visualReferences: Array<{ id: string; path: string; role: string; sha256: string }>;
      processing: { shippingRequirements: { maximumBytes: number } };
      review: { colorScales: number[]; grayscaleScales: number[]; circularCropScales: number[] };
      assets: Array<{
        id: string;
        prompt: string;
        referenceIds: string[];
        generatorOutputFilename: string;
        raw: { path: string; sha256: string };
        output: { path: string; sha256: string; bytes: number };
        decision: { status: string; attempt: number; regenerated: boolean };
      }>;
    };
    expect(acceptedRecord).toMatchObject({
      schemaVersion: 1,
      batch: 'release-v0.39.0-second-pass-currency',
      generator: {
        tool: 'OpenAI built-in image generation',
        workflow: 'imagegen',
        callsPerAsset: 1,
        variantsPerCall: 1,
        referenceImagesPassedToGenerator: false,
      },
      processing: { shippingRequirements: { maximumBytes: 15 * 1024 } },
      review: {
        colorScales: [128, 48, 32, 16, 11],
        grayscaleScales: [32, 16, 11],
        circularCropScales: [128, 48, 32, 16, 11],
      },
    });
    expect(acceptedRecord.assets.map(({ id }) => id).sort()).toEqual(ids);

    const referencesById = new Map(acceptedRecord.visualReferences.map((ref) => [ref.id, ref]));
    for (const asset of mapping.assets) {
      const accepted = acceptedRecord.assets.find(({ id }) => id === asset.id);
      expect(accepted, asset.id).toBeDefined();
      expect(accepted?.prompt, asset.id).toContain('Use case: stylized-concept.');
      expect(accepted?.generatorOutputFilename, asset.id).toMatch(/^exec-[0-9a-f-]+\.png$/);
      expect(accepted?.raw).toMatchObject({ path: asset.sourceFile, sha256: asset.sourceSha256 });
      expect(accepted?.output).toMatchObject({
        path: `public/ui/currency/${asset.output}`,
        sha256: asset.acceptedSha256,
        bytes: asset.acceptedBytes,
      });
      expect(accepted?.decision).toMatchObject({
        status: 'accepted',
        attempt: 1,
        regenerated: false,
      });
      expect(accepted?.referenceIds.length, asset.id).toBeGreaterThan(0);
      for (const referenceId of accepted?.referenceIds ?? []) {
        expect(referencesById.get(referenceId), `${asset.id}: ${referenceId}`).toMatchObject({
          path: expect.any(String),
          role: expect.any(String),
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        });
      }
    }
  });
});
