// ENEMY_BITE hit-reaction stagger (issue #2889 round 2, Area C):
// HitRecieve_Dazed, authored by pose-sample-and-blend
// (scripts/build_enemy_bite_hit_variety_anims.mjs) off each rig's own
// HitRecieve/Dance/Idle donor poses. crabenemy.glb and yeti.glb are
// confirmed different rigs (disjoint channel-key sets, different clip
// durations), so this is two independently baked donor files, not one
// shared file. Follows the shipped-GLB-plus-manifest-source contract test
// pattern (tests/anim_pipeline_batch1.test.ts).
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
  'public/models/creatures/crabenemy_hit_variety_anims.glb',
  'public/models/creatures/yeti_hit_variety_anims.glb',
];

describe('ENEMY_BITE hit-reaction stagger (issue #2889 round 2)', () => {
  it.each(DONOR_GLBS)('%s ships exactly HitRecieve_Dazed in a mesh-free donor GLB', (glbPath) => {
    expect(clipNamesOf(glbPath)).toEqual(['HitRecieve_Dazed']);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it("adds HitRecieve_Dazed to ENEMY_BITE's hit array without touching its other fields", () => {
    const block = manifestBlock('const ENEMY_BITE: ClipMap = {', '};');
    expect(block).toContain("hit: ['HitRecieve', 'HitRecieve_Dazed']");
    expect(block).toContain("idle: 'Idle'");
    expect(block).toContain("walk: 'Walk'");
    expect(block).toContain("run: 'Walk'");
    expect(block).toContain("attack: ['Bite_Front']");
    expect(block).toContain("death: 'Death'");
  });

  it('wires a matching animUrls entry onto both ENEMY_BITE consumers', () => {
    const consumers: [string, string][] = [
      ['mob_crab', 'crabenemy_hit_variety_anims.glb'],
      ['mob_treant', 'yeti_hit_variety_anims.glb'],
    ];
    for (const [key, file] of consumers) {
      const idx = MANIFEST_SRC.indexOf(`  ${key}: {`);
      expect(idx, key).toBeGreaterThanOrEqual(0);
      const end = MANIFEST_SRC.indexOf('\n  },', idx);
      const block = MANIFEST_SRC.slice(idx, end);
      // mob_crab wires its own CRAB_ENEMY_BITE and mob_treant its own
      // TREANT_ENEMY_BITE (both `{ ...ENEMY_BITE, attack: [...] }`, issue
      // #2889): each inherits ENEMY_BITE's hit array unchanged, so both still
      // qualify as ENEMY_BITE consumers for HitRecieve_Dazed.
      const ENEMY_BITE_VARIANTS: Record<string, string> = {
        mob_crab: 'CRAB_ENEMY_BITE',
        mob_treant: 'TREANT_ENEMY_BITE',
      };
      const clipsOk = block.includes(`clips: ${ENEMY_BITE_VARIANTS[key] ?? 'ENEMY_BITE'}`);
      expect(clipsOk, key).toBe(true);
      expect(block, `${key} animUrls`).toContain(file);
    }
    // Exactly 2 ENEMY_BITE consumers wire a hit-variety donor GLB: a stray
    // extra or missing wiring on either family changes this count. (Other
    // BIPED14 families independently wire their own `_hit_variety_anims.glb`
    // donors in the same batch, issue #2889, so this only counts ENEMY_BITE
    // consumers, not every `_hit_variety_anims.glb` occurrence repo-wide.)
    const occurrences = [
      ...MANIFEST_SRC.matchAll(/clips: (ENEMY_BITE|CRAB_ENEMY_BITE|TREANT_ENEMY_BITE),/g),
    ].length;
    expect(occurrences).toBe(2);
  });
});
