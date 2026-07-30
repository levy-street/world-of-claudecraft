// Tank crit immunity: creatures cannot critically strike a committed tank.
// A mob melee crit is 2x and lands inside the healer's cast time, so a crit
// that kills is damage nobody had a chance to answer; the classic-era design
// arc ended in the same place (defense checkpoints eventually became a flat
// "tank specs cannot be crit by creatures" property), and so does ours.
//
// Committed means the SPEC for warriors and paladins (Protection), and the
// spec PLUS the form for druids: a Feral druid is only crit-immune while in
// Sloth Form. PvP is untouched: this guards the one mob crit roll in
// Sim.mobSwing, and that roll is still DRAWN for an immune tank so every
// downstream rng draw keeps its stream position (the parity contract).
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

export function isCritImmuneTank(target: Entity, meta: TankCritImmunityMeta | undefined): boolean {
  if (target.kind !== 'player' || !meta) return false;
  const spec = meta.talentMods?.spec ?? null;
  if (spec === null) return false;
  if (TANK_SPEC_BY_CLASS[meta.cls] === spec) return true;
  if (meta.cls === 'druid' && spec === 'feral') {
    return target.auras.some((a) => a.kind === 'form_bear');
  }
  return false;
}
