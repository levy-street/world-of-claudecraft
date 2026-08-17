// Wildheart Basin round 2 (issue #2889): Zulgar, Voice of the Basin's own bespoke
// attack/cast clip. mob_wildheart_high_priest shared the literal TRIPO_BIPED_FULL_RIG
// ClipMap object, by reference, with the other 4 Wildheart Basin mobs; this clip is
// authored by pose-sample-and-blend (scripts/anim/pose_blend.mjs,
// scripts/build_wildheart_high_priest_anims.mjs) off the rig's own Cast and Jump donors.
// Follows the shipped-GLB-plus-manifest-source contract test pattern
// (tests/anim_pipeline_batch1.test.ts's elemental family describe block).
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

describe('Zulgar, Voice of the Basin bespoke attack/cast (issue #2889 round 2)', () => {
  it('ships Wildheart_High_Priest_Attack in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/creatures/wildheart_high_priest_ability_anims.glb';
    expect(clipNamesOf(glbPath)).toEqual(['Wildheart_High_Priest_Attack']);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('gives mob_wildheart_high_priest its own ClipMap (attack and cast) instead of mutating the shared TRIPO_BIPED_FULL_RIG constant', () => {
    const highPriestBlock = manifestBlock('mob_wildheart_high_priest: {', 'mob_elemental: {');
    expect(highPriestBlock).toContain('wildheart_high_priest_ability_anims.glb');
    expect(highPriestBlock).toContain('clips: WILDHEART_HIGH_PRIEST');
    expect(highPriestBlock).not.toContain('clips: TRIPO_BIPED_FULL_RIG,');

    const highPriestConstBlock = manifestBlock('const WILDHEART_HIGH_PRIEST: ClipMap = {', '};');
    expect(highPriestConstBlock).toContain("attack: ['Wildheart_High_Priest_Attack']");
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
