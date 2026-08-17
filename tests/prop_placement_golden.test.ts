// GOLDEN PIN: the placement the GAME resolves for every attachment in the manifest.
//
// The game on main is the source of truth. This table was generated from the resolver
// immediately after the grip logic was extracted out of `assets.ts`, and the three grip
// tables were separately verified byte-identical to their pre-extraction text, so these
// rows are the placements the game already produced.
//
// It exists so no later change (a precedence tweak, a new table row, a "harmless"
// refactor, another surface joining the resolver) can move a weapon in the live game
// without saying so out loud. If a row changes, that is a real visual change to a real
// character: justify it or revert it. Regenerating this table to make a test pass is the
// one thing you must not do.
//
// Heights are pinned at 1.0 and node lookups at "rig has none", which is true of every
// shipped body today, so the rows isolate the LOGIC from the geometry.
//
// NONE means no derived placement at all: the prop lands at the bone origin at its native
// scale and is entirely at the mercy of how its own GLB was authored. Eight rows are NONE
// and none of them is new: the four KayKit Skeletons weapons have no accessory-table row,
// and both `gripRef: 'Spellbook_open'` sites name a node `mage.glb` does not carry.
//
// The player_*_modular rows were appended when the resolver landed on a base that had
// grown the modular player bodies: every pre-existing row stayed byte-identical (verified
// old-vs-live before the merge), and each modular class pins the same placement as its
// fixed-rig twin, which is exactly what the shared tables promise.
import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { resolvePropPlacement } from '../src/render/characters/prop_placement_core';

const GOLDEN: Record<string, string> = {
  'delve_mob_acolyte#0': 'p:-0.0427,0.1769,0 q:0,1,0,0 s:1.0773',
  'delve_mob_acolyte#0+stow': 'p:0.12,0,-0.3 q:0.01693,-0.047024,0.939705,0.338315 s:1.0773',
  'delve_skel_effigy#0': 'NONE',
  'delve_skel_effigy#0+stow': 'p:0.16,0.14,-0.27 q:0.02128,-0.045223,0.903696,0.425247',
  'delve_skel_effigy#1': 'NONE',
  'delve_skel_effigy#1+stow': 'p:-0.16,0.14,-0.27 q:0.02128,0.045223,-0.903696,0.425247',
  'delve_skel_ringer#0': 'NONE',
  'delve_skel_ringer#0+stow': 'p:0.16,0.14,-0.27 q:0.02128,-0.045223,0.903696,0.425247',
  'delve_skel_varric#0': 'NONE',
  'delve_skel_varric#0+stow': 'p:0.16,0.14,-0.27 q:0.02128,-0.045223,0.903696,0.425247',
  'mob_bandit#0': 'p:-0.0095,0.378,0 q:0,1,0,0 s:0.6029',
  'mob_bandit#0+stow': 'p:0.5,-0.38,-0.08 q:0.078391,0.009339,0.902799,0.422755 s:0.6029',
  'mob_bandit#1': 'p:0.0095,0.378,0 q:0,0,0,1 s:0.6029',
  'mob_bandit#1+stow': 'p:-0.5,-0.38,-0.08 q:0.078391,-0.009339,-0.902799,0.422755 s:0.6029',
  'mob_bruiser#0': 'p:0,0.4626,0 q:0,1,0,0 s:0.8623',
  'mob_bruiser#0+stow': 'p:0.14,0.1,-0.3 q:0.019126,-0.046175,0.922725,0.382205 s:0.8623',
  'mob_dark_caster#0': 'p:-0.0427,0.1769,0 q:0,1,0,0 s:1.0773',
  'mob_dark_caster#0+stow': 'p:0.12,0,-0.3 q:0.01693,-0.047024,0.939705,0.338315 s:1.0773',
  'npc_chronicler#0': 'p:-0.0427,0.1769,0 q:0,1,0,0 s:1.0773',
  'npc_chronicler#0+stow': 'p:0.12,0,-0.3 q:0.01693,-0.047024,0.939705,0.338315 s:1.0773',
  'npc_chronicler#1': 'NONE',
  'npc_chronicler#1+stow': 'p:-0.16,0.14,-0.27 q:0.02128,0.045223,-0.903696,0.425247',
  'npc_edda_reedhand#0': 'p:-0.0427,0.1769,0 q:0,1,0,0 s:1.0773',
  'npc_edda_reedhand#0+stow': 'p:0.12,0,-0.3 q:0.01693,-0.047024,0.939705,0.338315 s:1.0773',
  'npc_knight#0': 'p:0,0.555174,0 q:0,1,0,0 s:0.8876',
  'npc_knight#0+stow': 'p:0.16,0.14,-0.27 q:0.02128,-0.045223,0.903696,0.425247 s:0.8876',
  'npc_mage#0': 'p:-0.0427,0.1769,0 q:0,1,0,0 s:1.0773',
  'npc_mage#0+stow': 'p:0.12,0,-0.3 q:0.01693,-0.047024,0.939705,0.338315 s:1.0773',
  'npc_scout#0': 'p:0.2286,0.0213,-0.0012 q:0,0.707107,0,0.707107 s:0.6109',
  'npc_scout#0+stow': 'p:0,0.1,-0.3 q:0.707107,0,0.707107,0 s:0.6109',
  'npc_smith#0': 'p:0.231697,0.382471,0 q:0,1,0,0 s:0.622211',
  'npc_smith#0+stow': 'p:0.16,0.14,-0.27 q:0.02128,-0.045223,0.903696,0.425247 s:0.622211',
  'player_druid#0': 'p:-0.0427,0.1769,0 q:0,1,0,0 s:1.0773',
  'player_druid#0+stow': 'p:0.12,0,-0.3 q:0.01693,-0.047024,0.939705,0.338315 s:1.0773',
  'player_druid_modular#0': 'p:-0.0427,0.1769,0 q:0,1,0,0 s:1.0773',
  'player_druid_modular#0+stow': 'p:0.12,0,-0.3 q:0.01693,-0.047024,0.939705,0.338315 s:1.0773',
  'player_hunter#0': 'p:0.2286,0.0213,-0.0012 q:0,0.707107,0,0.707107 s:0.6109',
  'player_hunter#0+stow': 'p:0,0.1,-0.3 q:0.707107,0,0.707107,0 s:0.6109',
  'player_hunter_modular#0': 'p:0.2286,0.0213,-0.0012 q:0,0.707107,0,0.707107 s:0.6109',
  'player_hunter_modular#0+stow': 'p:0,0.1,-0.3 q:0.707107,0,0.707107,0 s:0.6109',
  'player_mage#0': 'p:-0.0427,0.1769,0 q:0,1,0,0 s:1.0773',
  'player_mage#0+stow': 'p:0.12,0,-0.3 q:0.01693,-0.047024,0.939705,0.338315 s:1.0773',
  'player_mage_modular#0': 'p:-0.0427,0.1769,0 q:0,1,0,0 s:1.0773',
  'player_mage_modular#0+stow': 'p:0.12,0,-0.3 q:0.01693,-0.047024,0.939705,0.338315 s:1.0773',
  'player_mech#0': 'p:0,0.555174,0 q:0,1,0,0 s:0.8876',
  'player_mech#0+stow': 'p:0.16,0.14,-0.27 q:0.02128,-0.045223,0.903696,0.425247 s:0.8876',
  'player_paladin#0': 'p:0.231697,0.382471,0 q:0,1,0,0 s:0.622211',
  'player_paladin#0+stow': 'p:0.16,0.14,-0.27 q:0.02128,-0.045223,0.903696,0.425247 s:0.622211',
  'player_paladin#1': 'p:0,0.017,0.1617 q:0,0,0,1 s:0.5964',
  'player_paladin#1+stow': 'p:0,0.2,-0.32 q:0,-1,0,0 s:0.5964',
  'player_paladin_modular#0': 'p:0.231697,0.382471,0 q:0,1,0,0 s:0.622211',
  'player_paladin_modular#0+stow': 'p:0.16,0.14,-0.27 q:0.02128,-0.045223,0.903696,0.425247 s:0.622211',
  'player_paladin_modular#1': 'p:0,0.017,0.1617 q:0,0,0,1 s:0.5964',
  'player_paladin_modular#1+stow': 'p:0,0.2,-0.32 q:0,-1,0,0 s:0.5964',
  'player_priest#0': 'p:-0.0427,0.1769,0 q:0,1,0,0 s:1.0773',
  'player_priest#0+stow': 'p:0.12,0,-0.3 q:0.01693,-0.047024,0.939705,0.338315 s:1.0773',
  'player_priest_modular#0': 'p:-0.0427,0.1769,0 q:0,1,0,0 s:1.0773',
  'player_priest_modular#0+stow': 'p:0.12,0,-0.3 q:0.01693,-0.047024,0.939705,0.338315 s:1.0773',
  'player_rogue#0': 'p:-0.0095,0.378,0 q:0,1,0,0 s:0.6029',
  'player_rogue#0+stow': 'p:0.5,-0.38,-0.08 q:0.078391,0.009339,0.902799,0.422755 s:0.6029',
  'player_rogue#1': 'p:0.0095,0.378,0 q:0,0,0,1 s:0.6029',
  'player_rogue#1+stow': 'p:-0.5,-0.38,-0.08 q:0.078391,-0.009339,-0.902799,0.422755 s:0.6029',
  'player_rogue_modular#0': 'p:-0.0095,0.378,0 q:0,1,0,0 s:0.6029',
  'player_rogue_modular#0+stow': 'p:0.5,-0.38,-0.08 q:0.078391,0.009339,0.902799,0.422755 s:0.6029',
  'player_rogue_modular#1': 'p:0.0095,0.378,0 q:0,0,0,1 s:0.6029',
  'player_rogue_modular#1+stow': 'p:-0.5,-0.38,-0.08 q:0.078391,-0.009339,-0.902799,0.422755 s:0.6029',
  'player_shaman#0': 'p:0.231697,0.382471,0 q:0,1,0,0 s:0.622211',
  'player_shaman#0+stow': 'p:0.16,0.14,-0.27 q:0.02128,-0.045223,0.903696,0.425247 s:0.622211',
  'player_shaman#1': 'p:0,0.017,0.1771 q:0,0,0,1 s:0.4413',
  'player_shaman#1+stow': 'p:0,0.24,-0.32 q:0,-1,0,0 s:0.4413',
  'player_shaman_modular#0': 'p:0.231697,0.382471,0 q:0,1,0,0 s:0.622211',
  'player_shaman_modular#0+stow': 'p:0.16,0.14,-0.27 q:0.02128,-0.045223,0.903696,0.425247 s:0.622211',
  'player_shaman_modular#1': 'p:0,0.017,0.1771 q:0,0,0,1 s:0.4413',
  'player_shaman_modular#1+stow': 'p:0,0.24,-0.32 q:0,-1,0,0 s:0.4413',
  'player_warlock#0': 'p:0,0.2174,0 q:0,1,0,0 s:0.4831',
  'player_warlock#0+stow': 'p:0.5,-0.38,-0.08 q:0.078391,0.009339,0.902799,0.422755 s:0.4831',
  'player_warlock#1': 'NONE',
  'player_warlock#1+stow': 'p:-0.16,0.14,-0.27 q:0.02128,0.045223,-0.903696,0.425247',
  'player_warlock_modular#0': 'p:0,0.2174,0 q:0,1,0,0 s:0.4831',
  'player_warlock_modular#0+stow': 'p:0.5,-0.38,-0.08 q:0.078391,0.009339,0.902799,0.422755 s:0.4831',
  'player_warlock_modular#1': 'NONE',
  'player_warlock_modular#1+stow': 'p:-0.16,0.14,-0.27 q:0.02128,0.045223,-0.903696,0.425247',
  'player_warrior#0': 'p:0,0.555174,0 q:0,1,0,0 s:0.8876',
  'player_warrior#0+stow': 'p:0.16,0.14,-0.27 q:0.02128,-0.045223,0.903696,0.425247 s:0.8876',
  'player_warrior#1': 'p:0,0.017,0.1771 q:0,0,0,1 s:0.4413',
  'player_warrior#1+stow': 'p:0,0.24,-0.32 q:0,-1,0,0 s:0.4413',
  'player_warrior_modular#0': 'p:0,0.555174,0 q:0,1,0,0 s:0.8876',
  'player_warrior_modular#0+stow': 'p:0.16,0.14,-0.27 q:0.02128,-0.045223,0.903696,0.425247 s:0.8876',
  'player_warrior_modular#1': 'p:0,0.017,0.1771 q:0,0,0,1 s:0.4413',
  'player_warrior_modular#1+stow': 'p:0,0.24,-0.32 q:0,-1,0,0 s:0.4413',
  'skel_boss#0': 'NONE',
  'skel_boss#0+stow': 'p:0.16,0.14,-0.27 q:0.02128,-0.045223,0.903696,0.425247',
  'skel_mage#0': 'NONE',
  'skel_mage#0+stow': 'p:0.16,0.14,-0.27 q:0.02128,-0.045223,0.903696,0.425247',
};

/** Same serialization the pin was generated with. */
function serialize(key: string, slot: number, stowed: boolean): string {
  const att = VISUALS[key].attach?.[slot];
  if (!att) return 'MISSING';
  const p = resolvePropPlacement({
    url: att.url,
    bone: att.bone,
    position: att.position,
    rotationY: att.rotationY,
    gripRef: att.gripRef,
    lookupNode: () => null,
    measureNativeHeight: () => 1,
    stowed,
  });
  const f = (n: number) => Number(n.toFixed(6));
  const parts: string[] = [];
  if (p.position) parts.push(`p:${p.position.map(f).join(',')}`);
  if (p.quaternion) parts.push(`q:${p.quaternion.map(f).join(',')}`);
  if (p.rotationY !== undefined) parts.push(`ry:${f(p.rotationY)}`);
  if (typeof p.scale === 'number') parts.push(`s:${f(p.scale)}`);
  else if (p.scale) parts.push(`s:${p.scale.map(f).join(',')}`);
  return parts.join(' ') || 'NONE';
}

describe('every held prop in the game keeps the placement it had', () => {
  it('covers every attachment the manifest declares, both hands and sheathed', () => {
    // Reverse completeness: a NEW attachment must be added to the pin, so it cannot land
    // unreviewed, and a DELETED one cannot leave a stale row behind.
    const live: string[] = [];
    for (const key of Object.keys(VISUALS).sort()) {
      (VISUALS[key].attach ?? []).forEach((_att, i) => {
        live.push(`${key}#${i}`, `${key}#${i}+stow`);
      });
    }
    expect(
      live.length,
      'vacuity floor: the manifest really does declare attachments',
    ).toBeGreaterThan(60);
    expect(Object.keys(GOLDEN).sort()).toEqual([...live].sort());
  });

  it.each(Object.keys(GOLDEN))('%s', (row) => {
    const [key, slot] = row.replace('+stow', '').split('#');
    expect(serialize(key, Number(slot), row.endsWith('+stow'))).toBe(GOLDEN[row]);
  });
});
