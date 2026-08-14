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
    expect(sha256(bytes)).toBe('b9169b865723c28fa3fa000a725fac8aafd64459ce75677890d75a75ab886f96');
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
        bytes: 2832,
        sha256: '6659380d8e6fed07b916c78026b8e860dd3a58d4e1569e25c049a18ac2faf06f',
      },
      {
        path: 'public/ui/mobs/training_dummy.webp',
        bytes: 1812,
        sha256: '400afcac22527f9e0145b7a1dcc39f068f8f50d265798497925559464cd70915',
      },
      {
        path: 'public/ui/mobs/stable_horse.webp',
        bytes: 1964,
        sha256: 'f302dc2653f312a7fba93fd68563b70e14bdd5b1cfc746b21d1549f88d9429be',
      },
      {
        path: 'public/ui/mobs/old_greyjaw.webp',
        bytes: 2042,
        sha256: '8f633043c612c2fa7b5a911afbf4b90d6d0aa57098666be2545d40fb8e6cde33',
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
