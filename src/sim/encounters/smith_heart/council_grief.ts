// Grief of the Stone (the owner's ask of 2026-11-19, docs/design/raid/smith_heart.md
// section 7.1): the Hammer Council fights as two, and killing one leaves the other
// stronger. When the first member falls (the second fall ends the fight), the
// fallen one's strength streams across the Quarry into the survivor: the
// inheritance's river of light (COUNCIL_CUES.inherit), which takes
// COUNCIL_TUNING.griefFlow to arrive. If the survivor still stands when it lands:
//
//   the heal     it is healed at once for its tier's `griefHeal` share of its
//                maximum health, so the two are best brought down together (kill
//                the survivor before the stream lands and nothing is healed);
//   Enraged      for the rest of the pull it attacks faster (its tier's
//                `enrageHaste`, a `buff_haste` aura the swing timer reads) and its
//                blows and stone strike harder (`enrageDamage`: its weapon, so
//                Hammerfall and Hammer's Weight ride it, and the ordinary
//                mechanics through council_scope.ts damageMult). The lethal
//                punishments (Mountain's Wrath and its heir's, Falling Rock and
//                its tremor) keep their calibrated numbers (punishMult);
//   a new move   beside the signature it already inherits (council_scope.ts
//                jobHolder) it takes up one more piece of the fallen one's kit:
//                the enraged Guardian hurls the Singer's Falling Rock
//                (council_stone.ts rockCaster), the enraged Singer brings down
//                Hammer's Weight on her tank (council_wrath.ts weightCaster);
//   its voice    the survivor's "the stone remembers" line as it lands, and the
//                combat log's "<name> becomes enraged!".
//
// Every tier has it, each with its own row's numbers. A wipe gives everything
// back (clearGrief); the kill puts the weapon back too. Zero rng: the heal is a
// share, the swing a scale, and the enrage is visible state (an aura and a cue).

import { DT, type Entity } from '../../types';
import { dropAuraById } from '../sunken_bastion/claim';
import {
  COUNCIL_AURAS,
  COUNCIL_CUES,
  COUNCIL_NAMES,
  COUNCIL_ROLES,
  type CouncilRole,
  COUNCIL_TUNING as T,
} from './council_ids';
import { type CouncilScope, living } from './council_scope';
import type { CouncilFightState, CouncilGrief } from './council_state';
import { councilSay } from './council_voice';
import type { TierSwingBase } from './tier_swing';

/** The member a grief lands on: the one that did not fall. */
export function griefSurvivor(grief: Pick<CouncilGrief, 'fallen'>): CouncilRole {
  return grief.fallen === 'guardian' ? 'singer' : 'guardian';
}

/** The heal a grief brings (pure): `share` of the pool, never past it. */
export function griefHealAmount(maxHp: number, hp: number, share: number): number {
  return Math.max(0, Math.min(maxHp - hp, Math.round(maxHp * share)));
}

/** An enraged swing (pure): the weapon before it, `bonus` harder. */
export function enragedSwing(base: TierSwingBase, bonus: number): TierSwingBase {
  return { min: Math.round(base.min * (1 + bonus)), max: Math.round(base.max * (1 + bonus)) };
}

/** A member fell (council.ts noteFallen): its strength sets out for the
 *  survivor. Nothing when the other has fallen too (the same tick, or before:
 *  the fight ends) or a grief is already under way. */
export function beginGrief(s: CouncilScope, fallen: CouncilRole): void {
  if (s.st.grief) return;
  const grief: CouncilGrief = { fallen, flow: T.griefFlow, landed: false };
  if (!living(s.bodies[griefSurvivor(grief)])) return;
  s.st.grief = grief;
}

/** A pull that began with one member already down (a dev kill before it):
 *  its grief is owed at once, on the first tick. */
export function griefAtPull(
  st: CouncilFightState,
  bodies: Readonly<Record<CouncilRole, Entity | null>>,
): void {
  if (st.fallen.length !== 1) return;
  const grief: CouncilGrief = { fallen: st.fallen[0], flow: 0, landed: false };
  if (living(bodies[griefSurvivor(grief)])) st.grief = grief;
}

/** Wear the enrage (the aura at the tier's numbers, the weapon at its bonus):
 *  every tick once landed, so a dev tier switch mid-fight takes the new row. */
export function syncGrief(s: CouncilScope): void {
  const grief = s.st.grief;
  if (!grief?.landed) return;
  const role = griefSurvivor(grief);
  const b = s.bodies[role];
  if (!living(b)) return;
  const haste = 1 + s.rules.enrageHaste;
  const have = b.auras.find((a) => a.id === COUNCIL_AURAS.enraged);
  if (!have || have.value !== haste || have.value2 !== s.rules.enrageDamage) {
    if (have) dropAuraById(b, COUNCIL_AURAS.enraged);
    s.ctx.applyAura(b, {
      id: COUNCIL_AURAS.enraged,
      name: COUNCIL_NAMES.enraged,
      kind: 'buff_haste',
      remaining: 3600,
      duration: 3600,
      permanent: true,
      value: haste,
      value2: s.rules.enrageDamage,
      sourceId: b.id,
      school: 'physical',
      undispellable: true,
    });
  }
  scaleSwing(grief, b, s.rules.enrageDamage);
}

function scaleSwing(grief: CouncilGrief, b: Entity, bonus: number): void {
  if (!b.weapon || grief.swingBonus === bonus) return;
  grief.baseSwing ??= { min: b.weapon.min, max: b.weapon.max };
  const swing = enragedSwing(grief.baseSwing, bonus);
  b.weapon.min = swing.min;
  b.weapon.max = swing.max;
  grief.swingBonus = bonus;
}

/** The strength reaches the survivor: the heal, the enrage, the new move's
 *  clock, the line. */
function landGrief(s: CouncilScope, grief: CouncilGrief): void {
  grief.flow = 0;
  grief.landed = true;
  const role = griefSurvivor(grief);
  const b = s.bodies[role];
  if (!living(b)) return;
  const heal = griefHealAmount(b.maxHp, b.hp, s.rules.griefHeal);
  if (heal > 0) {
    b.hp += heal;
    s.ctx.emit({ type: 'heal', targetId: b.id, amount: heal });
  }
  syncGrief(s);
  s.ctx.emit({
    type: 'spellfx',
    sourceId: b.id,
    targetId: b.id,
    school: 'physical',
    fx: 'nova',
    ability: COUNCIL_CUES.grief,
  });
  s.ctx.emit({ type: 'log', text: `${b.name} becomes enraged!`, color: '#ff6666', entityId: b.id });
  // The fallen one's second move comes a beat after the grief, on its own
  // cadence from there (its clock ran on, overdue, while nobody held it).
  if (role === 'guardian') {
    if (!s.rules.rockOutlivesSinger) {
      s.st.rockTimer = T.griefRockFirst;
      s.st.floorHeld.rock = 0;
    }
  } else s.st.weightTimer = T.griefWeightFirst;
  councilSay(s, role, 'remember');
}

/** One tick of the grief: the stream's flight, its landing, then the enrage
 *  kept on the tier's row. */
export function stepGrief(s: CouncilScope): void {
  const grief = s.st.grief;
  if (!grief) return;
  if (grief.landed) {
    syncGrief(s);
    return;
  }
  grief.flow = Math.max(0, grief.flow - DT);
  if (grief.flow <= 1e-9) landGrief(s, grief);
}

/** A wipe or the kill: the enrage lifts and the survivor's weapon is its own
 *  again (before tier_swing.ts gives back the tier's). */
export function clearGrief(s: Pick<CouncilScope, 'st' | 'bodies'>): void {
  const grief = s.st.grief;
  for (const r of COUNCIL_ROLES) {
    const b = s.bodies[r];
    if (b) dropAuraById(b, COUNCIL_AURAS.enraged);
  }
  if (grief?.baseSwing) {
    const b = s.bodies[griefSurvivor(grief)];
    if (b?.weapon) {
      b.weapon.min = grief.baseSwing.min;
      b.weapon.max = grief.baseSwing.max;
    }
  }
  s.st.grief = undefined;
}

/** The readout's half (`/dev heart council`). */
export function griefReadout(st: CouncilFightState): string {
  const grief = st.grief;
  if (!grief) return '';
  const survivor = griefSurvivor(grief);
  return grief.landed
    ? `, ${survivor} enraged`
    : `, grief reaches the ${survivor} in ${grief.flow.toFixed(1)} s`;
}
