import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';

const repoRoot = path.join(__dirname, '..');
const formerAssetPaths = [
  'models/creatures/rabbit_critter.glb',
  'models/creatures/songbird_critter.glb',
  'models/creatures/squirrel_critter.glb',
] as const;

describe('ambient critters stay removed', () => {
  it('has no renderer module or wiring for the decorative pool', () => {
    expect(existsSync(path.join(repoRoot, 'src/render/critters.ts'))).toBe(false);

    const rendererSource = readFileSync(path.join(repoRoot, 'src/render/renderer.ts'), 'utf8');
    expect(rendererSource).not.toMatch(/buildCritters|CritterField|\.\/critters/);
  });

  it('does not ship or manifest the former rabbit, songbird, and squirrel models', () => {
    for (const assetPath of formerAssetPaths) {
      expect(existsSync(path.join(repoRoot, 'public', assetPath)), assetPath).toBe(false);
      expect(MEDIA_ASSETS[assetPath], assetPath).toBeUndefined();
    }
  });
});
