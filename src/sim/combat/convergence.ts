// Elemental Convergence (mage choice row, owner tree 2026-07-11): alternating
// a Fire and a Frost cast opens an 8 sec surge of power (+15% damage done),
// once per 30 sec. The "last school cast" memory and the internal cooldown
// both ride AURAS (a 'convergence_mark' whose school field remembers the last
// element, and a 'convergence_cd' timer), so no new entity field enters the
// parity state hash. Called from onCastCompleted, which every completed cast
// funnels through (instants, finished hard casts, and channel starts).
// Draws no rng.
//
// `src/sim`-pure: sibling sim modules + the SimContext seam only.

import { ABILITIES } from '../data';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

export const CONVERGENCE_DMG_PCT = 0.15;
export const CONVERGENCE_DURATION = 8;
export const CONVERGENCE_ICD = 30;
// How long an element is remembered while waiting for its opposite.
export const CONVERGENCE_MARK_WINDOW = 10;

export function convergenceOnCast(ctx: SimContext, p: Entity, abilityId: string): void {
  if (p.kind !== 'player') return;
  const school = ABILITIES[abilityId]?.school;
  if (school !== 'fire' && school !== 'frost') return;
  const meta = ctx.players.get(p.id);
  if (!meta || ctx.playerMods(meta).global.convergence <= 0) return;
  const mark = p.auras.find((a) => a.id === 'convergence_mark');
  const onCd = p.auras.some((a) => a.id === 'convergence_cd');
  if (mark && mark.school !== school && !onCd) {
    // The opposite element answered: consume the mark and open the surge.
    p.auras.splice(p.auras.indexOf(mark), 1);
    ctx.applyAura(p, {
      id: 'elemental_convergence',
      name: 'Elemental Convergence',
      kind: 'buff_dmg_done',
      value: CONVERGENCE_DMG_PCT,
      remaining: CONVERGENCE_DURATION,
      duration: CONVERGENCE_DURATION,
      sourceId: p.id,
      school,
    });
    ctx.applyAura(p, {
      id: 'convergence_cd',
      name: 'Elemental Convergence',
      kind: 'internal_cd',
      value: 0,
      remaining: CONVERGENCE_ICD,
      duration: CONVERGENCE_ICD,
      sourceId: p.id,
      school,
    });
    return;
  }
  // Same element (or the surge is cooling down): remember THIS school and
  // keep waiting for its opposite.
  if (mark) {
    mark.school = school;
    mark.remaining = CONVERGENCE_MARK_WINDOW;
    mark.duration = CONVERGENCE_MARK_WINDOW;
  } else {
    ctx.applyAura(p, {
      id: 'convergence_mark',
      name: 'Elemental Convergence',
      kind: 'internal_cd',
      value: 0,
      remaining: CONVERGENCE_MARK_WINDOW,
      duration: CONVERGENCE_MARK_WINDOW,
      sourceId: p.id,
      school,
    });
  }
}
