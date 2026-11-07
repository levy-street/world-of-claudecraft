// Bond of the Stone, the Hammer Council's separation rule (docs/design/raid/
// smith_heart.md section 7.1): while the Guardian and the Seam Singer stand
// within 20 yd of each other (body to body) both take 80 percent less damage
// (the shared `shield_wall` ward) and every 3 s the bond pulses on the whole
// raid, each pulse 25 percent of the first louder (capped at six times it).
// Apart, the ward lifts and the pulse count starts again from the first.
//
// Two ways through, both viable: one tank drags the Singer far off alone while
// the raid kills the Guardian (the safe one: no bond, the raid stacked for
// the Wrath), or the raid splits in two and kills both at once (faster: no
// Memory of Stone wait, but the Singer's half fights away from the Wrath's
// pillars and her Wake marks must walk back to the cover).
//
// Zero rng but the damage rolls, in claim-player order.

import { DT, type Entity } from '../../types';
import { dropAuraById } from '../sunken_bastion/claim';
import {
  bondPulseMult,
  COUNCIL_AURAS,
  COUNCIL_CUES,
  COUNCIL_NAMES,
  COUNCIL_TUNING as T,
} from './council_ids';
import { type CouncilScope, living, roll } from './council_scope';

/** Do the two stand bonded (both alive, within reach)? Pure over the bodies. */
export function bonded(g: Entity | null, c: Entity | null): boolean {
  if (!living(g) || !living(c)) return false;
  return Math.hypot(g.pos.x - c.pos.x, g.pos.z - c.pos.z) <= T.bondReach + 1e-9;
}

function wear(s: CouncilScope, b: Entity, pulses: number): void {
  const have = b.auras.find((a) => a.id === COUNCIL_AURAS.bond);
  const next = Math.round(bondPulseMult(pulses) * 10);
  if (have) {
    have.stacks = Math.max(1, pulses);
    have.value2 = next;
    return;
  }
  s.ctx.applyAura(b, {
    id: COUNCIL_AURAS.bond,
    name: COUNCIL_NAMES.bond,
    kind: 'shield_wall',
    remaining: 3600,
    duration: 3600,
    permanent: true,
    value: T.bondWard,
    value2: next,
    stacks: Math.max(1, pulses),
    sourceId: b.id,
    school: 'physical',
    undispellable: true,
  });
}

/** Lift the bond off both (apart, a reset, a fall). */
export function clearBond(s: Pick<CouncilScope, 'bodies' | 'st'>): void {
  for (const b of [s.bodies.guardian, s.bodies.singer]) if (b) dropAuraById(b, COUNCIL_AURAS.bond);
  s.st.bond.pulses = 0;
  s.st.bond.timer = T.bondPulseEvery;
}

/** One tick of the bond. Returns the blows dealt this tick (the tests read it). */
export function stepBond(s: CouncilScope): number {
  const g = s.bodies.guardian;
  const c = s.bodies.singer;
  const bond = s.st.bond;
  if (!bonded(g, c) || !g || !c) {
    const worn = (b: Entity | null) => b?.auras.some((a) => a.id === COUNCIL_AURAS.bond) ?? false;
    if (bond.pulses > 0 || worn(g) || worn(c)) clearBond(s);
    return 0;
  }
  wear(s, g, bond.pulses);
  wear(s, c, bond.pulses);
  bond.timer -= DT;
  if (bond.timer > 1e-9) return 0;
  bond.timer += T.bondPulseEvery;
  const mult = bondPulseMult(bond.pulses);
  bond.pulses++;
  s.ctx.emit({
    type: 'spellfx',
    sourceId: g.id,
    targetId: c.id,
    school: 'physical',
    fx: 'beam',
    ability: COUNCIL_CUES.bondPulse,
  });
  let blows = 0;
  for (const p of s.players) {
    if (p.dead) continue;
    const amount = roll(s, g, T.bondPulseMin * mult, T.bondPulseMax * mult);
    s.ctx.dealDamage(g, p, amount, false, 'physical', COUNCIL_NAMES.bond, 'hit', true);
    blows++;
  }
  wear(s, g, bond.pulses);
  wear(s, c, bond.pulses);
  return blows;
}
