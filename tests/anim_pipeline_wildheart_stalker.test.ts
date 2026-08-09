// Wildheart Basin round 2 (issue #2889): the Vineclaw Stalker's own bespoke attack.
// mob_wildheart_stalker shared the literal TRIPO_BIPED_FULL_RIG ClipMap object, by
// reference, with the other 4 Wildheart Basin mobs; this clip is authored by
// pose-sample-and-blend (scripts/anim/pose_blend.mjs, scripts/build_wildheart_stalker_anims.mjs)
// off the rig's own Attack donor. Follows the shipped-GLB-plus-manifest-source contract
// test pattern (tests/anim_pipeline_batch1.test.ts's elemental family describe block).
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

describe('Vineclaw Stalker bespoke attack (issue #2889 round 2)', () => {
  it('ships Wildheart_Stalker_Attack in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/creatures/wildheart_stalker_ability_anims.glb';
    expect(clipNamesOf(glbPath)).toEqual(['Wildheart_Stalker_Attack']);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('gives mob_wildheart_stalker its own ClipMap instead of mutating the shared TRIPO_BIPED_FULL_RIG constant', () => {
    const stalkerBlock = manifestBlock('mob_wildheart_stalker: {', 'mob_wildheart_ravager: {');
    expect(stalkerBlock).toContain('wildheart_stalker_ability_anims.glb');
    expect(stalkerBlock).toContain('clips: WILDHEART_STALKER');
    expect(stalkerBlock).not.toContain('clips: TRIPO_BIPED_FULL_RIG,');

    // TRIPO_BIPED_FULL_RIG itself (the constant definition, not a VisualDef using it) must
    // still read the original shared Attack clip: the other 4 Wildheart mobs sharing it by
    // reference must be untouched by this change.
    const rigConstBlock = manifestBlock('const TRIPO_BIPED_FULL_RIG: ClipMap = {', '};');
    expect(rigConstBlock).toContain("attack: ['Attack']");

    // Every other VisualDef still pointing at the shared constant is untouched: exactly 1
    // remaining direct `clips: TRIPO_BIPED_FULL_RIG,` usage (mob_wildheart_beastmaster; 5
    // originally, minus the one migrated to WILDHEART_STALKER above, minus
    // mob_wildheart_hexcaller's, mob_wildheart_ravager's, and mob_wildheart_high_priest's
    // parallel migrations to WILDHEART_HEXCALLER, WILDHEART_RAVAGER, and
    // WILDHEART_HIGH_PRIEST, issue #2889 round 2).
    const remaining = [...MANIFEST_SRC.matchAll(/clips: TRIPO_BIPED_FULL_RIG,/g)].length;
    expect(remaining).toBe(1);
  });
});
