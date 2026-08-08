// BIPED14 hit-reaction stagger (issue #2889 round 2, Area C): HitReact_Heavy,
// authored by pose-sample-and-blend (scripts/build_biped14_hit_variety_anims.mjs)
// off each rig's own HitReact/Duck/Idle donor poses. Follows the
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
  'public/models/creatures/yetialt_hit_variety_anims.glb',
  'public/models/creatures/frog_hit_variety_anims.glb',
  'public/models/creatures/orc_hit_variety_anims.glb',
  'public/models/creatures/demonalt_hit_variety_anims.glb',
];

describe('BIPED14 hit-reaction stagger (issue #2889 round 2)', () => {
  it.each(DONOR_GLBS)('%s ships exactly HitReact_Heavy in a mesh-free donor GLB', (glbPath) => {
    expect(clipNamesOf(glbPath)).toEqual(['HitReact_Heavy']);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it("adds HitReact_Heavy to BIPED14's hit array without touching its other fields", () => {
    const block = manifestBlock('const BIPED14: ClipMap = {', '};');
    expect(block).toContain("hit: ['HitReact', 'HitReact_Heavy']");
    expect(block).toContain("idle: 'Idle'");
    expect(block).toContain("walk: 'Walk'");
    expect(block).toContain("run: 'Run'");
    expect(block).toContain("attack: ['Punch', 'Weapon']");
    expect(block).toContain("death: 'Death'");
  });

  it('wires a matching animUrls entry onto every BIPED14 consumer', () => {
    const consumers: [string, string][] = [
      ['mob_bear', 'yetialt_hit_variety_anims.glb'],
      ['mob_yeti', 'yetialt_hit_variety_anims.glb'],
      ['mob_murloc', 'frog_hit_variety_anims.glb'],
      ['mob_troll', 'orc_hit_variety_anims.glb'],
      ['mob_demon', 'demonalt_hit_variety_anims.glb'],
      ['mob_demonalt', 'demonalt_hit_variety_anims.glb'],
    ];
    for (const [key, file] of consumers) {
      const idx = MANIFEST_SRC.indexOf(`  ${key}: {`);
      expect(idx, key).toBeGreaterThanOrEqual(0);
      const end = MANIFEST_SRC.indexOf('\n  },', idx);
      const block = MANIFEST_SRC.slice(idx, end);
      // mob_troll, mob_yeti, mob_murloc, and mob_bear each wire their own
      // `{ ...BIPED14, attack: [...] }` variant (TROLL_BIPED14, YETI_BIPED14,
      // MURLOC_BIPED14, BEAR_BIPED14, issue #2889): each inherits BIPED14's
      // hit array unchanged, so they still qualify as BIPED14 consumers for
      // HitReact_Heavy.
      const BIPED14_VARIANTS: Record<string, string> = {
        mob_troll: 'TROLL_BIPED14',
        mob_yeti: 'YETI_BIPED14',
        mob_murloc: 'MURLOC_BIPED14',
        mob_bear: 'BEAR_BIPED14',
      };
      const clipsOk = block.includes(`clips: ${BIPED14_VARIANTS[key] ?? 'BIPED14'}`);
      expect(clipsOk, key).toBe(true);
      expect(block, `${key} animUrls`).toContain(file);
    }
    // Exactly 6 BIPED14-family consumers touched: a stray extra or missing
    // wiring changes this count. Scoped to this family's own donor
    // basenames rather than every `_hit_variety_anims.glb` in the manifest,
    // since unrelated families (e.g. the enemy7 hit-variety batch) land
    // their own donors independently and would otherwise break this pin.
    const occurrences = [
      ...MANIFEST_SRC.matchAll(/(yetialt|frog|orc|demonalt)_hit_variety_anims\.glb/g),
    ].length;
    expect(occurrences).toBe(6);
  });
});
