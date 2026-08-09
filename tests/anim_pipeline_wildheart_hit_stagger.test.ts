// TRIPO_BIPED_FULL_RIG hit-reaction stagger (issue #2889 round 2, Area C):
// Hit_Stagger, authored by pose-sample-and-blend
// (scripts/build_wildheart_hit_stagger_anims.mjs) off each rig's own
// Hit/Idle donor poses (no unused bonus clips on these 5 rigs, so the whole
// clip is a re-timed blend of donors already in use). Follows the
// shipped-GLB-plus-manifest-source contract test pattern
// (tests/anim_pipeline_batch1.test.ts).
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
  'public/models/creatures/wildheart_stalker_hit_variety_anims.glb',
  'public/models/creatures/wildheart_ravager_hit_variety_anims.glb',
  'public/models/creatures/wildheart_hexcaller_hit_variety_anims.glb',
  'public/models/creatures/wildheart_beastmaster_hit_variety_anims.glb',
  'public/models/creatures/wildheart_high_priest_hit_variety_anims.glb',
];

describe('TRIPO_BIPED_FULL_RIG hit-reaction stagger (issue #2889 round 2)', () => {
  it.each(DONOR_GLBS)('%s ships exactly Hit_Stagger in a mesh-free donor GLB', (glbPath) => {
    expect(clipNamesOf(glbPath)).toEqual(['Hit_Stagger']);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it("adds Hit_Stagger to TRIPO_BIPED_FULL_RIG's hit array without touching its other fields", () => {
    const block = manifestBlock('const TRIPO_BIPED_FULL_RIG: ClipMap = {', '};');
    expect(block).toContain("hit: ['Hit', 'Hit_Stagger']");
    expect(block).toContain("idle: 'Idle'");
    expect(block).toContain("walk: 'Walk'");
    expect(block).toContain("run: 'Run'");
    expect(block).toContain("attack: ['Attack']");
    expect(block).toContain("death: 'Death'");
    expect(block).toContain("cast: 'Cast'");
    expect(block).toContain("jump: 'Jump'");
  });

  it('wires a matching animUrls entry onto every TRIPO_BIPED_FULL_RIG consumer', () => {
    // mob_wildheart_stalker, mob_wildheart_ravager, mob_wildheart_hexcaller, and
    // mob_wildheart_high_priest were each split onto their own clips const
    // (WILDHEART_STALKER / WILDHEART_RAVAGER / WILDHEART_HEXCALLER /
    // WILDHEART_HIGH_PRIEST) for their own attack clip; all spread
    // TRIPO_BIPED_FULL_RIG (including the shared Hit_Stagger hit array), so they
    // still count as consumers, just under their own clips constant.
    const consumers: [string, string, string][] = [
      [
        'mob_wildheart_stalker',
        'wildheart_stalker_hit_variety_anims.glb',
        'clips: WILDHEART_STALKER',
      ],
      [
        'mob_wildheart_ravager',
        'wildheart_ravager_hit_variety_anims.glb',
        'clips: WILDHEART_RAVAGER',
      ],
      [
        'mob_wildheart_hexcaller',
        'wildheart_hexcaller_hit_variety_anims.glb',
        'clips: WILDHEART_HEXCALLER',
      ],
      [
        'mob_wildheart_beastmaster',
        'wildheart_beastmaster_hit_variety_anims.glb',
        'clips: TRIPO_BIPED_FULL_RIG',
      ],
      [
        'mob_wildheart_high_priest',
        'wildheart_high_priest_hit_variety_anims.glb',
        'clips: WILDHEART_HIGH_PRIEST',
      ],
    ];
    for (const [key, file, clipsRef] of consumers) {
      const idx = MANIFEST_SRC.indexOf(`  ${key}: {`);
      expect(idx, key).toBeGreaterThanOrEqual(0);
      const end = MANIFEST_SRC.indexOf('\n  },', idx);
      const block = MANIFEST_SRC.slice(idx, end);
      expect(block, key).toContain(clipsRef);
      expect(block, `${key} animUrls`).toContain(file);
    }
    // Exactly 5 Wildheart consumers touched (other rig families, e.g. yeti/frog/orc/demon,
    // ship their own unrelated *_hit_variety_anims.glb donors from other issues).
    const occurrences = [...MANIFEST_SRC.matchAll(/wildheart_\w+_hit_variety_anims\.glb/g)].length;
    expect(occurrences).toBe(5);
  });
});
