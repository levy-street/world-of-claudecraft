// Themed swirl colors for set-proc auras, resolved to the buff display NAME
// (the aura SimEvent carries only the name), so a re-coined proc name keeps
// its effect wired. Extracted from renderer.ts (the monolith ratchet): the
// table and both resolution walks are pure data derivation with no scene
// state, so the renderer consumes the finished map.
//
// TWO proc homes feed the map:
//  - The incumbent stat sets' procs live on ITEM_SETS bonuses (SetBonusEffect
//    proc shape). The bleeds land on the TARGET (a mob), so the renderer's
//    aura case must not gate these on the player kind.
//  - The Crucible tier sets' engine procs live in SET_ENGINE_BONUSES
//    (TalentEffect proc shape); only a proc that LANDS a named aura needs a
//    row (the cooldown-refund procs fire no aura event and get none).

import { SET_ENGINE_BONUSES } from '../sim/content/ignivar_set_bonuses';
import { ITEM_SETS } from '../sim/content/item_sets';

const SET_PROC_FX_BY_ID: Record<string, number> = {
  set_clearcasting: 0x8ed2ff, // icy arcane blue: a free cast
  set_gravemight: 0xffb04d, // burnished gold: attack power
  set_fangrush: 0xbfff5a, // feral green-yellow: attack speed
  set_bonesplinter: 0xc22a2a, // blood red: the plate bleed landing
  set_ragged_gash: 0xc22a2a, // blood red: the leather bleed landing
  set_soulblaze: 0xff6a9e, // ember pink: spell power
  // Crucible engine procs (Phase B). Only the aura-landing arm gets a row:
  // the Creed 4pc's instant Scouring Hymn empower.
  set_emberscreed_4pc: 0xffc46b, // ember-gold: the hymn arming
};

export const SET_PROC_FX_BY_NAME = new Map<string, number>();
for (const set of Object.values(ITEM_SETS)) {
  for (const tier of set.bonuses) {
    const proc = tier.effect.proc;
    if (proc && SET_PROC_FX_BY_ID[proc.id] !== undefined) {
      SET_PROC_FX_BY_NAME.set(proc.name, SET_PROC_FX_BY_ID[proc.id]);
    }
  }
}
for (const tiers of Object.values(SET_ENGINE_BONUSES)) {
  for (const tier of tiers) {
    const proc = tier.effect.proc;
    if (proc && SET_PROC_FX_BY_ID[proc.id] !== undefined) {
      SET_PROC_FX_BY_NAME.set(proc.name, SET_PROC_FX_BY_ID[proc.id]);
    }
  }
}
