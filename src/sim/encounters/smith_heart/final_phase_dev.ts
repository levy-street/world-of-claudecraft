// The Masterless Strength's part-2 dev verbs (`/dev heart final <verb>`,
// routed by final.ts finalDevMechanic; dev-gated like every /dev heart
// branch) and the part-2 half of its readout.
//
//   inter70 | inter40     an intermission now (its health set to the line)
//   splinter <vein>       one Splinter rises out of that quarter now
//   killadds              every Splinter dies now
//   endcall               the call ends now (the living Splinters pour in)
//   last                  its health to 15 percent: the final phase's stride
//   enrage                Masterless Fury now (the final phase begun first)
//   coal | toll | ring | pounce | circles | shear
//                         a living Splinter's signature now

import type { SmithHeartVein } from '../../content/smith_heart_layout';
import { HEART_QUARTER_ORDER } from '../../content/smith_heart_quarters';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';
import {
  addBody,
  dropAdd,
  markCoals,
  raiseCircles,
  raiseRing,
  raiseSplinter,
  startPounce,
  startShear,
  startToll,
} from './final_adds';
import { beginFinalStride, beginIntermission, endCall, shareHp } from './final_intermission';
import { furyPulse } from './final_last';
import { FINAL_PHASES as P } from './final_phase_ids';
import type { FinalScope } from './final_scope';
import type { FinalAdd, FinalFightState } from './final_state';

/** The first living Splinter of `vein`, or the first living one. */
function splinterOf(s: FinalScope, vein?: SmithHeartVein): { a: FinalAdd; e: Entity } | null {
  for (const a of s.st.phase.adds) {
    if (vein && a.vein !== vein) continue;
    const e = addBody(s, a);
    if (e && a.rise <= 0) return { a, e };
  }
  return null;
}

/** A part-2 verb: the reply, or null when the verb is not one. */
export function finalPhaseDev(
  s: FinalScope,
  verb: string | undefined,
  arg: string | undefined,
  me: Entity | null,
): string | null {
  const st = s.st;
  const ph = st.phase;
  const b = s.boss;
  const need = (v: SmithHeartVein) => splinterOf(s, v);
  switch (verb) {
    case 'inter70':
    case 'inter40': {
      const n = verb === 'inter70' ? 1 : 2;
      if (ph.stage !== 'fight') return `It is not in the quarter fight (${ph.stage}).`;
      ph.intermissions = n - 1;
      b.hp = Math.min(b.hp, shareHp(b.maxHp, P.intermissionAt[n - 1]));
      beginIntermission(s, n);
      return `Intermission ${n}: it strides into the centre.`;
    }
    case 'splinter': {
      const v = arg as SmithHeartVein;
      if (!HEART_QUARTER_ORDER.includes(v)) return null;
      return raiseSplinter(s, v) ? `A Splinter of the ${v} rises.` : null;
    }
    case 'killadds': {
      let n = 0;
      for (const a of ph.adds) {
        const e = addBody(s, a);
        if (!e) continue;
        e.damageImmune = false;
        e.hostile = true;
        s.ctx.dealDamage(me ?? b, e, e.hp + 1, false, 'physical', 'Dev Strike', 'hit', true);
        n++;
      }
      return `${n} Splinters slain.`;
    }
    case 'endcall': {
      if (ph.stage !== 'call') return 'No call runs.';
      const poured = endCall(s);
      return poured.length > 0
        ? `The call ends: ${poured.join(', ')} poured in.`
        : 'The call ends: nothing poured.';
    }
    case 'last': {
      if (ph.stage === 'final' || ph.stage === 'finalLeap') return 'Already in its final phase.';
      for (const a of ph.adds) dropAdd(s, a);
      ph.adds = [];
      b.hp = Math.min(b.hp, shareHp(b.maxHp, P.finalAt));
      beginFinalStride(s);
      return 'Its final phase: it strides into the centre.';
    }
    case 'enrage': {
      if (ph.stage !== 'final') return 'Not in its final phase (use last first).';
      ph.finalClock = Math.max(ph.finalClock, P.enrageAfter);
      ph.furyWarned = true;
      furyPulse(s);
      return 'Masterless Fury.';
    }
    case 'coal': {
      const h = need('heat');
      return h ? `Bursting Coal on ${markCoals(s, h.e).length}.` : 'No Splinter of the Heat.';
    }
    case 'toll': {
      const h = need('quench');
      return h && startToll(s, h.a, h.e)
        ? 'Rime Toll: kick it.'
        : 'No free Splinter of the Quench.';
    }
    case 'ring': {
      const h = need('quench');
      if (!h) return 'No Splinter of the Quench.';
      raiseRing(s, h.e);
      return 'A Quenching Ring.';
    }
    case 'pounce': {
      const h = need('breath');
      const v = h ? startPounce(s, h.a, h.e) : null;
      return v ? `Gale Pounce on ${v.name}.` : 'No free Splinter of the Breath.';
    }
    case 'circles': {
      const h = need('breath');
      return h ? `${raiseCircles(s, h.a, h.e)} Storm Orbs round it.` : 'No Splinter of the Breath.';
    }
    case 'shear': {
      const h = splinterOf(s);
      return h && startShear(s, h.a, h.e) ? 'Shearing Blow.' : 'No Splinter with a target.';
    }
    default:
      return null;
  }
}

/** The part-2 half of the readout: the stage, the Splinters, the poured. */
export function finalPhaseReadout(ctx: SimContext, st: FinalFightState): string {
  const ph = st.phase;
  const adds = ph.adds
    .filter((a) => {
      const e = ctx.entities.get(a.id);
      return !!e && !e.dead;
    })
    .map((a) => {
      const e = ctx.entities.get(a.id) as Entity;
      return `${a.vein} ${Math.round((e.hp / e.maxHp) * 100)}%`;
    });
  const poured = HEART_QUARTER_ORDER.filter((v) => ph.poured[v] > 0).map(
    (v) => `${v}${ph.poured[v] > 1 ? ` x${ph.poured[v]}` : ''}`,
  );
  const extra =
    ph.stage === 'call'
      ? `, call ${Math.ceil(ph.callLeft)} s`
      : ph.stage === 'final'
        ? `, final ${Math.floor(ph.finalClock)} s, fury ${ph.fury}`
        : '';
  return `phase ${ph.stage} (intermissions ${ph.intermissions}${extra}), Splinters ${adds.length > 0 ? adds.join(', ') : 'none'}, poured ${poured.length > 0 ? poured.join(', ') : 'none'}`;
}
