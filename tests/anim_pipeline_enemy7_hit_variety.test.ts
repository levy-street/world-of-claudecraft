// ENEMY7 hit-reaction stagger (issue #2889 round 2, Area C):
// HitRecieve_Heavy, authored by pose-sample-and-blend
// (scripts/build_enemy7_hit_variety_anims.mjs) off each rig's own Idle/
// HitRecieve donor poses. Follows the shipped-GLB-plus-manifest-source
// contract test pattern (tests/anim_pipeline_batch1.test.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

function clipNamesOf(glbPath: string): string[] {
  const glb = readFileSync(join(ROOT, glbPath));
  const jsonLen = glb.readUInt32LE(12);
  const doc = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
  return (doc.animations ?? []).map((a: { name?: string }) => a.name);
}

function meshCountOf(glbPath: string): number {
  const glb = readFileSync(join(ROOT, glbPath));
  const jsonLen = glb.readUInt32LE(12);
  const doc = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
  return (doc.meshes ?? []).length;
}

const MANIFEST_SRC = readFileSync(join(ROOT, 'src/render/characters/manifest.ts'), 'utf8');

function manifestBlock(startAnchor: string, endAnchor: string): string {
  const start = MANIFEST_SRC.indexOf(startAnchor);
  expect(start, startAnchor).toBeGreaterThanOrEqual(0);
  const end = MANIFEST_SRC.indexOf(endAnchor, start);
  expect(end, `${startAnchor} .. ${endAnchor}`).toBeGreaterThan(start);
  return MANIFEST_SRC.slice(start, end);
}

const DONOR_GLBS = [
  'public/models/creatures/goblin_hit_variety_anims.glb',
  'public/models/creatures/giant_hit_variety_anims.glb',
];

describe('ENEMY7 hit-reaction stagger (issue #2889 round 2)', () => {
  it.each(DONOR_GLBS)('%s ships exactly HitRecieve_Heavy in a mesh-free donor GLB', (glbPath) => {
    expect(clipNamesOf(glbPath)).toEqual(['HitRecieve_Heavy']);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it("adds HitRecieve_Heavy to ENEMY7's hit array without touching its other fields", () => {
    const block = manifestBlock('const ENEMY7: ClipMap = {', '};');
    expect(block).toContain("hit: ['HitRecieve', 'HitRecieve_Heavy']");
    expect(block).toContain("idle: 'Idle'");
    expect(block).toContain("walk: 'Walk'");
    expect(block).toContain("run: 'Run'");
    expect(block).toContain("attack: ['Attack']");
    expect(block).toContain("death: 'Death'");
  });

  it('wires a matching animUrls entry onto both ENEMY7 consumers', () => {
    const consumers: [string, string, string][] = [
      ['mob_kobold', 'goblin_hit_variety_anims.glb', 'clips: KOBOLD_ENEMY7'],
      ['mob_ogre', 'giant_hit_variety_anims.glb', 'clips: ENEMY7'],
    ];
    for (const [key, file, clipsLine] of consumers) {
      const idx = MANIFEST_SRC.indexOf(`  ${key}: {`);
      expect(idx, key).toBeGreaterThanOrEqual(0);
      const end = MANIFEST_SRC.indexOf('\n  },', idx);
      const block = MANIFEST_SRC.slice(idx, end);
      expect(block, key).toContain(clipsLine);
      expect(block, `${key} animUrls`).toContain(file);
    }
    // Scoped to these 2 ENEMY7-family donor basenames rather than every
    // `_hit_variety_anims.glb` in the manifest, since unrelated families
    // (KayKit's kaykit()/skeletonClips(), BIPED14/YETI_BIPED14/
    // TROLL_BIPED14, etc, issue #2889) independently wire their own
    // hit-variety donors in the same batch and would otherwise break this
    // pin.
    const occurrences = [...MANIFEST_SRC.matchAll(/(goblin|giant)_hit_variety_anims\.glb/g)].length;
    expect(occurrences).toBe(2);
  });
});
