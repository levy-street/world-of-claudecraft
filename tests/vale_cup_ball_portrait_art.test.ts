import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { targetPortraitUrl } from '../src/ui/target_portrait_view';

const EVIDENCE_PATH = resolve(
  process.cwd(),
  'docs/achievements/release-art-audit-v036-2026-08-10/vale-cup-ball-portrait.accepted.json',
);

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

interface AcceptedReference {
  path: string;
  bytes: number;
  sha256: string;
}

describe('Vale Cup ball target portrait art', () => {
  it('pins the accepted generation and processing record', () => {
    const bytes = readFileSync(EVIDENCE_PATH);
    expect(bytes.byteLength).toBe(3316);
    expect(sha256(bytes)).toBe('ff16d7f2dae949e4a85a60696d62b4dd24cec50b150e4524850a6a3dcb70d1a5');
    const evidence = JSON.parse(bytes.toString('utf8')) as {
      generationPrompt: string;
      references: AcceptedReference[];
    };
    expect(evidence).toMatchObject({
      schemaVersion: 1,
      batch: 'vale-cup-ball-portrait-2026-08-10',
      generator: 'OpenAI built-in image generation',
      owner: 'World of ClaudeCraft',
      license: 'World of ClaudeCraft project-generated art, project asset, rights reserved',
      generatedResultPath:
        '/Users/fernando/.codex/generated_images/019fe6e9-7ed7-7bc3-a44e-c7475af3a73f/exec-b4dd6091-fe31-46d0-b49e-cf0b3cc48217.png',
      retainedRaw: {
        path: 'tmp/imagegen/release-art-audit-v036/vale-cup-ball/raw/vale_cup_ball.png',
        bytes: 1911842,
        sha256: '953137699d496a25839853f7b797b6cc07cfb06688ec4dfc688499c0666f06a6',
        width: 1254,
        height: 1254,
        format: 'png',
        colorspace: 'sRGB',
        opaque: true,
      },
      processing: {
        library: 'Sharp 0.35.3',
        resize: { width: 128, height: 128, fit: 'cover', kernel: 'lanczos3' },
        removeAlpha: true,
        colorspace: 'sRGB',
        format: 'webp',
        quality: 88,
        alphaQuality: 100,
        effort: 6,
      },
      visualReview: {
        accepted: true,
        attempts: 1,
        retries: 0,
        reviewedSizes: [128, 54, 40, 28],
        grayscaleSizes: [28],
      },
    });
    expect(evidence.generationPrompt).toContain('Paint exactly one round tournament ball');
    expect(evidence.generationPrompt).toContain('No wolf, boar, animal');
    expect(evidence.references).toEqual([
      {
        path: 'public/ui/mobs/wild_boar.webp',
        bytes: 2824,
        sha256: 'c53fe2d306738e14aec1f08339b1a48a274e2a4e8de6bb28b3f694fcb7a87a21',
      },
      {
        path: 'public/ui/mobs/training_dummy.webp',
        bytes: 1790,
        sha256: '66efb4999739669201bd44e21aca2d6e222ba8dfeb410d018c1e5e7d156e0e65',
      },
      {
        path: 'public/ui/mobs/stable_horse.webp',
        bytes: 1960,
        sha256: 'ae6839c40d2839e30f89722c2ad5450af25b6864efe601ff3257a2c68c1061b8',
      },
      {
        path: 'public/ui/mobs/old_greyjaw.webp',
        bytes: 2046,
        sha256: 'a4df215ed61a7f58f526b168be66815be716c7d7edac604785a27b373ecc7b4d',
      },
    ]);
    for (const reference of evidence.references) {
      const referenceBytes = readFileSync(resolve(process.cwd(), reference.path));
      expect(referenceBytes.byteLength, `${reference.path} byte length`).toBe(reference.bytes);
      expect(sha256(referenceBytes), `${reference.path} SHA-256`).toBe(reference.sha256);
    }
  });

  it('ships the accepted static painting on the live target route', async () => {
    const url = targetPortraitUrl('vale_cup_ball', true);
    expect(url).toBe('/ui/portraits/vale_cup_ball.webp');
    const bytes = readFileSync(resolve(process.cwd(), `public${url}`));
    expect(bytes.byteLength).toBe(2068);
    expect(sha256(bytes)).toBe('a7c60d03e01897459a70d9d79aaf575ea6c12fc13db38e981fee3614a8076670');
    expect(await sharp(bytes).metadata()).toMatchObject({
      width: 128,
      height: 128,
      space: 'srgb',
      channels: 3,
      hasAlpha: false,
    });
  });
});
