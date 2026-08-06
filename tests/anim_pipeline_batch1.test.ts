// Batch 1 of the large-scale animation authoring initiative (issue #2889):
// mage ability-specific spellcasts + the elemental family's bespoke attack.
// Both clips are authored by pose-sample-and-blend (scripts/anim/pose_blend.mjs,
// scripts/build_mage_ability_anims.mjs, scripts/build_elemental_anims.mjs), the
// same technique documented in .claude/skills/blender-anim-pipeline/SKILL.md.
// Follows the shipped-GLB-plus-manifest-source contract test pattern
// (tests/weapon_skins.test.ts's "bow skin attack animation" describe block).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/data';

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

describe('mage ability-specific spellcasts (issue #2889 batch 1)', () => {
  const MAGE_CAST_CLIPS = ['Cast_Fire', 'Cast_Frost', 'Cast_Arcane', 'Cast_Nova', 'Cast_Polymorph'];

  it('ships all 5 cast clips in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/chars/players/mage_ability_anims.glb';
    expect(clipNamesOf(glbPath).sort()).toEqual([...MAGE_CAST_CLIPS].sort());
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('wires the donor GLB and an attackByAbility override for every mapped ability', () => {
    const block = manifestBlock('player_mage: {', 'player_warlock: {');
    expect(block).toContain('mage_ability_anims.glb');
    expect(block).toContain('attackByAbility');
    for (const clip of MAGE_CAST_CLIPS) expect(block).toContain(`'${clip}'`);
  });

  it('every mapped ability id is a real mage ability, and every referenced clip is shipped', () => {
    const mageBlock = manifestBlock('player_mage: {', 'player_warlock: {');
    const abilityStart = mageBlock.indexOf('attackByAbility: {');
    expect(abilityStart).toBeGreaterThanOrEqual(0);
    const abilityEnd = mageBlock.indexOf('\n      },', abilityStart);
    expect(abilityEnd).toBeGreaterThan(abilityStart);
    const block = mageBlock.slice(abilityStart, abilityEnd);
    const rows = [...block.matchAll(/^\s*([a-z_]+): '([A-Za-z_]+)',$/gm)];
    expect(rows.length).toBeGreaterThan(15); // catches a wholesale accidental deletion
    for (const [, abilityId, clip] of rows) {
      expect(
        ABILITIES[abilityId],
        `attackByAbility key '${abilityId}' is not a real ability id`,
      ).toBeTruthy();
      expect(
        MAGE_CAST_CLIPS,
        `attackByAbility value '${clip}' for '${abilityId}' is not a shipped clip`,
      ).toContain(clip);
    }
    // Polymorph names its own clip; the three point-blank AoE bursts share Cast_Nova.
    const map = Object.fromEntries(rows.map(([, id, clip]) => [id, clip]));
    expect(map.polymorph).toBe('Cast_Polymorph');
    expect(map.frost_nova).toBe('Cast_Nova');
    expect(map.arcane_explosion).toBe('Cast_Nova');
    expect(map.dragons_breath).toBe('Cast_Nova');
  });
});

describe('elemental family bespoke attack (issue #2889 batch 1)', () => {
  it('ships Elemental_Attack in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/creatures/elemental_ability_anims.glb';
    expect(clipNamesOf(glbPath)).toEqual(['Elemental_Attack']);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('gives mob_elemental its own ClipMap instead of mutating the shared FLOATING constant', () => {
    const elementalBlock = manifestBlock('mob_elemental: {', 'mob_water_elemental: {');
    expect(elementalBlock).toContain('elemental_ability_anims.glb');
    expect(elementalBlock).toContain('clips: ELEMENTAL_FLOATING');
    expect(elementalBlock).not.toContain('clips: FLOATING,');

    // FLOATING itself (the constant definition, not a VisualDef using it) must
    // still read the original shared attack: the other 8 families sharing it
    // by reference must be untouched by this change.
    const floatingConstBlock = manifestBlock('const FLOATING: ClipMap = {', '};');
    expect(floatingConstBlock).toContain("attack: ['Headbutt', 'Punch']");

    // Every other VisualDef still pointing at the shared constant is untouched:
    // exactly 8 remaining direct `clips: FLOATING,` usages (9 originally, minus
    // the one migrated to ELEMENTAL_FLOATING above).
    const remaining = [...MANIFEST_SRC.matchAll(/clips: FLOATING,/g)].length;
    expect(remaining).toBe(8);
  });
});
