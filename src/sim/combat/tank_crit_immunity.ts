// Tank crit immunity: creatures cannot critically strike a committed tank.
// A mob melee crit is 2x and lands inside the healer's cast time, so a crit
// that kills is damage nobody had a chance to answer; the classic-era design
// arc ended in the same place (defense checkpoints eventually became a flat
// "tank specs cannot be crit by creatures" property), and so does ours.
//
// Committed means the SPEC for warriors and paladins (Protection), and the
// spec PLUS the form for druids: a Feral druid is only crit-immune while in
// Sloth Form. PvP is untouched: the rule is keyed on the ATTACKER as well as
// the target, because Sim.mobSwing is a shared swing shell (hostile mobs,
// player pets, delve companions): only a HOSTILE creature's swing is
// suppressed, so a player pet crits a committed tank like any player attack
// does. The crit roll is still DRAWN for an immune tank so every downstream
// rng draw keeps its stream position (the parity contract).
//
// Pure leaf module: no Sim import, structural meta parameter, so a Vitest
// imports it directly and the mobSwing shell stays a thin consumer.

import type { Entity, PlayerClass } from '../types';

const TANK_SPEC_BY_CLASS: Partial<Record<PlayerClass, string>> = {
  warrior: 'prot',
  paladin: 'protection',
};

export interface TankCritImmunityMeta {
  cls: PlayerClass;
  talentMods?: { spec: string | null } | null;
}

export function isCritImmuneTank(
  attacker: Entity,
  target: Entity,
  meta: TankCritImmunityMeta | undefined,
): boolean {
  // Creature rule only: a friendly creature sharing the mobSwing path (a player
  // pet, a delve companion) and any player attacker keep their crits against a
  // committed tank; only a hostile mob's swing is suppressed.
  if (!attacker.hostile) return false;
  if (target.kind !== 'player' || !meta) return false;
  const spec = meta.talentMods?.spec ?? null;
  if (spec === null) return false;
  if (TANK_SPEC_BY_CLASS[meta.cls] === spec) return true;
  if (meta.cls === 'druid' && spec === 'feral') {
    return target.auras.some((a) => a.kind === 'form_bear');
  }
  if (meta.cls === 'shaman' && spec === 'enhancement') {
    // The Warspirit commitment is the Stonebound POSTURE, not the spec: the
    // imbue that grants the armor, damage reduction, doubled threat and jolt
    // taunt (combat/shaman_warspirit.ts STONEBOUND_WEAPON_ID; the id literal
    // is cross-pinned by tests/tank_crit_immunity_shaman_pair.test.ts so this
    // leaf stays import-free). A Galeheart shaman remains crittable.
    return target.auras.some((a) => a.id === 'rockbiter_weapon');
  }
  return false;
}
