// Wildheart Basin round 2 (issue #2889): Zulgar, Voice of the Basin's own bespoke
// attack/cast clip. mob_wildheart_high_priest shared the literal TRIPO_BIPED_FULL_RIG
// ClipMap object, by reference, with the other 4 Wildheart Basin mobs; this clip is
// authored by pose-sample-and-blend (scripts/anim/pose_blend.mjs,
// scripts/build_wildheart_high_priest_anims.mjs) off the rig's own Cast and Jump donors.
// Follows the shipped-GLB-plus-manifest-source contract test pattern
// (tests/anim_pipeline_batch1.test.ts's elemental family describe block).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
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

describe('Zulgar, Voice of the Basin bespoke attack/cast (issue #2889 round 2)', () => {
  it('ships Wildheart_High_Priest_Attack in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/creatures/wildheart_high_priest_ability_anims.glb';
    expect(clipNamesOf(glbPath)).toEqual([
      'Wildheart_High_Priest_Attack',
      'Wildheart_High_Priest_Swing',
    ]);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('gives mob_wildheart_high_priest its own ClipMap (attack and cast) instead of mutating the shared TRIPO_BIPED_FULL_RIG constant', () => {
    const highPriestBlock = manifestBlock('mob_wildheart_high_priest: {', 'mob_elemental: {');
    expect(highPriestBlock).toContain('wildheart_high_priest_ability_anims.glb');
    expect(highPriestBlock).toContain('clips: WILDHEART_HIGH_PRIEST');
    expect(highPriestBlock).not.toContain('clips: TRIPO_BIPED_FULL_RIG,');

    const highPriestConstBlock = manifestBlock('const WILDHEART_HIGH_PRIEST: ClipMap = {', '};');
    // The melee swing is its own planted clip; the slam stays his cast.
    expect(highPriestConstBlock).toContain("attack: ['Wildheart_High_Priest_Swing']");
    expect(highPriestConstBlock).toContain("cast: 'Wildheart_High_Priest_Attack'");

    // TRIPO_BIPED_FULL_RIG itself (the constant definition, not a VisualDef using it) must
    // still read the original shared Attack and Cast clips: the other 4 Wildheart mobs
    // sharing it by reference must be untouched by this change.
    const rigConstBlock = manifestBlock('const TRIPO_BIPED_FULL_RIG: ClipMap = {', '};');
    expect(rigConstBlock).toContain("attack: ['Attack']");
    expect(rigConstBlock).toContain("cast: 'Cast'");

    // Every other VisualDef still pointing at the shared constant is untouched: exactly 1
    // remaining direct `clips: TRIPO_BIPED_FULL_RIG,` usage (mob_wildheart_beastmaster; 5
    // originally, minus the ones migrated to WILDHEART_STALKER, WILDHEART_RAVAGER,
    // WILDHEART_HEXCALLER, and WILDHEART_HIGH_PRIEST above).
    const remaining = [...MANIFEST_SRC.matchAll(/clips: TRIPO_BIPED_FULL_RIG,/g)].length;
    expect(remaining).toBe(1);
  });
});

/** The widest turn (degrees) a bone's rotation channel makes away from its first key. */
async function boneSwing(glbPath: string, clip: string): Promise<Map<string, number>> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(join(ROOT, glbPath));
  const anim = doc
    .getRoot()
    .listAnimations()
    .find((a) => a.getName() === clip);
  if (!anim) throw new Error(`no ${clip}`);
  const out = new Map<string, number>();
  for (const ch of anim.listChannels()) {
    if (ch.getTargetPath() !== 'rotation') continue;
    const v = ch.getSampler()?.getOutput()?.getArray();
    if (!v) continue;
    let widest = 0;
    for (let i = 0; i < v.length; i += 4) {
      const dot = Math.abs(v[0] * v[i] + v[1] * v[i + 1] + v[2] * v[i + 2] + v[3] * v[i + 3]);
      widest = Math.max(widest, (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI);
    }
    out.set(ch.getTargetNode()?.getName() ?? '', widest);
  }
  return out;
}

describe('Zulgar swings with his arms, not his whole body (playtest 03/10)', () => {
  const glbPath = 'public/models/creatures/wildheart_high_priest_ability_anims.glb';

  it('the swing keeps the pelvis and legs on the stance while the arms carry the blow', async () => {
    const swing = await boneSwing(glbPath, 'Wildheart_High_Priest_Swing');
    for (const bone of ['Root', 'Pelvis', 'L_Thigh', 'R_Thigh', 'L_Calf', 'R_Calf'])
      expect(swing.get(bone), bone).toBeLessThan(15);
    expect(swing.get('R_Upperarm')).toBeGreaterThan(60);
    expect(swing.get('Waist')).toBeLessThan(45);
  });

  it('the slam it replaced as the swing heaves the whole body (it stays his cast)', async () => {
    const slam = await boneSwing(glbPath, 'Wildheart_High_Priest_Attack');
    expect(slam.get('Pelvis')).toBeGreaterThan(100);
  });
});
