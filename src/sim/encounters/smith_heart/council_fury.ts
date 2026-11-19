// Grieving Fury, the Hammer Council's answer to "kill one, then cruise" (the
// team's feedback of 2026-11-17, the owner's option B of 2026-11-18;
// docs/design/raid/smith_heart.md section 7.1): when one member falls and the
// other lives,
//
//   The soul flies   the fallen one's soul streams to the survivor (the
//                    COUNCIL_CUES.inherit beam) and lands COUNCIL_TUNING
//                    .furyArrive (3 s) later. Nothing changes before it lands.
//   It lands         the survivor wakes in Grieving Fury (COUNCIL_CUES.furyWake):
//                    Memory of Stone (the tier's `furyDamage` more damage
//                    dealt) and the Grieving Fury aura (a buff_haste: its
//                    swings, its bars, the council's clocks and the Wrath's
//                    fill all run the tier's `furyHaste` faster,
//                    council_scope.ts councilHaste), and it takes up the
//                    fallen one's jobs at FULL strength (council_scope.ts
//                    jobHolder: the Wrath, or the Wake and the song; on
//                    Heroic and Mythic the Weight or the bolt too).
//   It mends         from the landing the survivor mends the tier's
//                    `furyHealPct` of its maximum health over
//                    `furyHealSeconds`, one beat a second
//                    (COUNCIL_CUES.furyMend), never past full.
//
// So the second kill inside the soul's flight costs the raid nothing, one
// inside the mend only part of the health, and a raid that kills one and
// strolls to the other fights a healed, enraged boss with both kits: the two
// must fall together. Normal's numbers are gentle, Heroic's hard (each tier's
// COUNCIL_DIFFICULTY row). The fury lasts until the fight ends (the kill or
// the wipe lifts it, council.ts). Zero rng: no draw at all.

import { DT, type Entity } from '../../types';
import { dropAuraById } from '../sunken_bastion/claim';
import {
  COUNCIL_AURAS,
  COUNCIL_CUES,
  COUNCIL_NAMES,
  COUNCIL_ROLES,
  type CouncilRole,
  furyRoleCode,
  COUNCIL_TUNING as T,
} from './council_ids';
import { type CouncilScope, living } from './council_scope';
import type { CouncilFury } from './council_state';
import { councilSay } from './council_voice';

/** A member fell while the other lives: its soul sets out. Called once, at
 *  the first fall of a pull. */
export function beginFury(s: CouncilScope, fallen: CouncilRole, dead: Entity): CouncilFury | null {
  if (s.st.fury) return null;
  const survivor = COUNCIL_ROLES.find((r) => r !== fallen && living(s.bodies[r]));
  const body = survivor ? s.bodies[survivor] : null;
  if (!survivor || !body) return null;
  const healTotal = Math.round(body.maxHp * s.rules.furyHealPct);
  const beats = Math.max(1, Math.round(s.rules.furyHealSeconds / T.furyMendEvery));
  s.st.fury = {
    survivor,
    fallen,
    arriveIn: T.furyArrive,
    arrived: false,
    healLeft: healTotal,
    healEach: Math.ceil(healTotal / beats),
    mendTimer: 0,
  };
  s.ctx.emit({
    type: 'spellfx',
    sourceId: dead.id,
    targetId: body.id,
    school: 'physical',
    fx: 'beam',
    ability: COUNCIL_CUES.inherit,
  });
  return s.st.fury;
}

/** Put the fury's two auras on the survivor (the landing, and again should a
 *  dev line or a reset have lifted them). */
function wearFury(s: CouncilScope, body: Entity, fury: CouncilFury): void {
  if (!body.auras.some((a) => a.id === COUNCIL_AURAS.memory))
    s.ctx.applyAura(body, {
      id: COUNCIL_AURAS.memory,
      name: COUNCIL_NAMES.memory,
      kind: 'buff_dmg_done',
      remaining: 3600,
      duration: 3600,
      permanent: true,
      value: s.rules.furyDamage,
      stacks: 1,
      sourceId: body.id,
      school: 'physical',
      undispellable: true,
    });
  if (!body.auras.some((a) => a.id === COUNCIL_AURAS.fury))
    s.ctx.applyAura(body, {
      id: COUNCIL_AURAS.fury,
      name: COUNCIL_NAMES.fury,
      kind: 'buff_haste',
      remaining: 3600,
      duration: 3600,
      permanent: true,
      value: 1 + s.rules.furyHaste,
      value2: furyRoleCode(fury.fallen),
      stacks: 1,
      sourceId: body.id,
      school: 'physical',
      undispellable: true,
    });
}

/** One tick of the fury: the soul's flight, its landing, the mend. Returns
 *  the health mended this tick (the tests read it). */
export function stepFury(s: CouncilScope): number {
  const fury = s.st.fury;
  if (!fury) return 0;
  const body = s.bodies[fury.survivor];
  if (!living(body)) return 0;
  if (!fury.arrived) {
    fury.arriveIn = Math.max(0, fury.arriveIn - DT);
    if (fury.arriveIn > 1e-9) return 0;
    fury.arrived = true;
    wearFury(s, body, fury);
    s.ctx.emit({
      type: 'spellfx',
      sourceId: body.id,
      targetId: body.id,
      school: 'physical',
      fx: 'nova',
      ability: COUNCIL_CUES.furyWake,
    });
    // The survivor's recorded line: what was theirs is mine.
    councilSay(s, fury.survivor, 'remember');
  }
  if (fury.healLeft <= 0) return 0;
  fury.mendTimer -= DT;
  if (fury.mendTimer > 1e-9) return 0;
  fury.mendTimer += T.furyMendEvery;
  const amount = Math.min(fury.healLeft, fury.healEach, body.maxHp - body.hp);
  fury.healLeft -= fury.healEach;
  if (amount <= 0) return 0;
  body.hp += amount;
  s.ctx.emit({
    type: 'spellfx',
    sourceId: body.id,
    targetId: body.id,
    school: 'physical',
    fx: 'nova',
    ability: COUNCIL_CUES.furyMend,
  });
  return amount;
}

/** Lift the fury off both members (the wipe; the kill leaves the dead as
 *  they lie). */
export function clearFury(s: Pick<CouncilScope, 'bodies' | 'st'>): void {
  for (const r of COUNCIL_ROLES) {
    const b = s.bodies[r];
    if (!b) continue;
    dropAuraById(b, COUNCIL_AURAS.memory);
    dropAuraById(b, COUNCIL_AURAS.fury);
  }
  s.st.fury = null;
}
