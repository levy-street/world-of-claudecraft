// KayKit hit-reaction stagger (issue #2889 round 2, Area C): Hit_B_Stagger,
// authored by pose-sample-and-blend (scripts/build_kaykit_hit_variety_anims.mjs)
// off each rig's own Idle/Running_Strafe_Right donor poses. Follows the
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
  'public/models/chars/players/knight_hit_variety_anims.glb',
  'public/models/chars/players/paladin_hit_variety_anims.glb',
  'public/models/chars/players/ranger_hit_variety_anims.glb',
  'public/models/chars/players/rogue_hit_variety_anims.glb',
  'public/models/chars/players/mage_hit_variety_anims.glb',
  'public/models/chars/players/barbarian_hit_variety_anims.glb',
  'public/models/chars/players/druid_hit_variety_anims.glb',
  'public/models/chars/players/mage_classic_hit_variety_anims.glb',
  'public/models/chars/players/rogue_hooded_hit_variety_anims.glb',
  'public/models/chars/players/Mech/characters/CombatMech_hit_variety_anims.glb',
  'public/models/chars/enemies/skeleton_minion_hit_variety_anims.glb',
  'public/models/chars/enemies/skeleton_rogue_hit_variety_anims.glb',
  'public/models/chars/enemies/skeleton_warrior_hit_variety_anims.glb',
  'public/models/chars/enemies/skeleton_mage_hit_variety_anims.glb',
  'public/models/chars/enemies/necromancer_hit_variety_anims.glb',
];

describe('KayKit hit-reaction stagger (issue #2889 round 2)', () => {
  it.each(DONOR_GLBS)('%s ships exactly Hit_B_Stagger in a mesh-free donor GLB', (glbPath) => {
    expect(clipNamesOf(glbPath)).toEqual(['Hit_B_Stagger']);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it("adds Hit_B_Stagger to kaykit()'s hit array without touching its other fields", () => {
    const block = manifestBlock(
      "const kaykit = (attack: string[], idle = 'Idle'): ClipMap => ({",
      '});',
    );
    expect(block).toContain("hit: ['Hit_A', 'Hit_B_Stagger']");
    // Every other field stays exactly as before.
    expect(block).toContain("walk: 'Walking_A'");
    expect(block).toContain("run: 'Running_A'");
    expect(block).toContain("walkBack: 'Walking_Backwards'");
    expect(block).toContain("death: 'Death_A'");
    expect(block).toContain("cast: 'Spellcasting'");
    expect(block).toContain("sitDown: 'Sit_Floor_Down'");
    expect(block).toContain("sitIdle: 'Sit_Floor_Idle'");
    expect(block).toContain("swim: 'Lie_Idle'");
    expect(block).toContain("jump: 'Jump_Idle'");
    expect(block).toContain("stow: '1H_Melee_Attack_Chop'");
    expect(block).toContain('emote: KAYKIT_EMOTES');

    // skeletonLargeClips is a DIFFERENT factory sharing the visually similar
    // `hit: ['Hit_A'],` line; this task must not have touched it.
    const largeBlock = manifestBlock(
      'const skeletonLargeClips = (attack: string[]): ClipMap => ({',
      '});',
    );
    expect(largeBlock).toContain("hit: ['Hit_A'],");
    expect(largeBlock).not.toContain('Hit_B_Stagger');
  });

  it('wires a matching animUrls entry onto every kaykit()/skeletonClips() consumer', () => {
    // Count textual occurrences of exactly these 15 KayKit donor basenames
    // (a few, e.g. mage.glb, back multiple VisualDef entries, so this is not
    // the same as DONOR_GLBS.length). Scoped to the KayKit family's own donor
    // filenames rather than every `_hit_variety_anims.glb` in the manifest:
    // other families (BIPED14/YETI_BIPED14/TROLL_BIPED14, ENEMY_BITE/
    // CRAB_ENEMY_BITE, etc, issue #2889) independently wire their own
    // hit-variety donors in the same batch and would otherwise inflate an
    // unscoped count every time one of them lands.
    const donorPattern = new RegExp(DONOR_GLBS.map((p) => p.split('/').pop()).join('|'), 'g');
    const occurrences = [...MANIFEST_SRC.matchAll(donorPattern)].length;
    expect(occurrences).toBe(36);

    // Spot-check the two entries that already had an animUrls array before
    // this task (must be APPENDED to, not overwritten).
    const hunterBlock = manifestBlock('player_hunter: swims({', 'player_rogue: swims({');
    expect(hunterBlock).toContain('bow_anims.glb');
    expect(hunterBlock).toContain('ranger_hit_variety_anims.glb');

    const mageBlock = manifestBlock('player_mage: swims({', 'player_warlock: swims({');
    expect(mageBlock).toContain('mage_ability_anims.glb');
    expect(mageBlock).toContain('mage_hit_variety_anims.glb');

    // Spot-check one skeleton-family entry.
    const bossBlock = manifestBlock('skel_boss: {', 'skel_necromancer: {');
    expect(bossBlock).toContain('skeleton_mage_hit_variety_anims.glb');
  });
});
