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

  it('wires a matching animUrls entry onto every ENEMY7 consumer', () => {
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
    // The two authored mixamorig drops (kobold.glb, grix.glb) must NOT consume
    // the goblin-rig donor: its tracks target Head/Arm.L/Arm.R/Body, none of
    // which exist on a mixamorig skeleton, so on these bodies the clip
    // resolved by name and bound nothing, freezing the rig mid-pose on every
    // hit taken (the Grix the Tunnelking statue). The binding gate in
    // tests/character_clipmaps.test.ts owns the general rule; these pins keep
    // the two known-bad wirings from quietly returning.
    const nonConsumers: [string, string][] = [
      ['mob_kobold_digger', 'clips: KOBOLD_DIGGER'],
      ['mob_grix', 'clips: GRIX'],
    ];
    for (const [key, clipsLine] of nonConsumers) {
      const idx = MANIFEST_SRC.indexOf(`  ${key}: {`);
      expect(idx, key).toBeGreaterThanOrEqual(0);
      const end = MANIFEST_SRC.indexOf('\n  },', idx);
      const block = MANIFEST_SRC.slice(idx, end);
      expect(block, key).toContain(clipsLine);
      expect(block, `${key} must not wire the goblin-rig donor`).not.toContain(
        'goblin_hit_variety_anims.glb',
      );
    }
    // Scoped to this family's own donor basenames: an unscoped
    // `_hit_variety_anims.glb` count also picks up unrelated families
    // (e.g. BIPED14's yetialt/frog/orc/demonalt donors) whenever they land
    // their own hit-variety clips, which happens constantly in this repo.
    //
    // And anchored to the `${CREATURES}/` template prefix every real wiring is
    // written with, so this counts CODE and not prose: the kobold/grix defs
    // carry comments that NAME the goblin donor while explaining their wiring,
    // and a bare-basename count would tally those sentences as consumers.
    const occurrences = [
      ...MANIFEST_SRC.matchAll(/\$\{CREATURES\}\/(?:goblin|giant)_hit_variety_anims\.glb/g),
    ].length;
    expect(occurrences).toBe(consumers.length);
  });
});
