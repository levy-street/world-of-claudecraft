// Whether a completed cast should fire an auto-attack swing before its queued
// follow-up starts (a pure leaf of the spell queue).
//
// The tick runs updateCasting BEFORE updatePlayerAutoAttack, and the driver
// bails while castingAbility is set. A press queued inside the cast tail
// (CAST_QUEUE_WINDOW_SEC) fires the next cast in the same tick the previous
// one completes, so a caster who spams a casted spell never shows the driver
// a null castingAbility: the swing timer keeps decaying to zero and the ready
// wand bolt (or melee swing) starves for as long as the spam lasts. This
// predicate mirrors the driver's own timer gate (main hand, or a ready
// offhand while dual wielding) as the driver would see it THIS tick: the
// queue asks before the tick's decay has run, so "ready" means the timer is
// within one DT of zero, which is where the driver's decay-then-check lands.

import { DT } from '../types';

export interface SwingReadyView {
  autoAttack: boolean;
  swingTimer: number;
  offhandSwingTimer: number;
  dualWielding: boolean;
  offhandWeapon: unknown;
  targetId: number | null;
}

/** True when an armed auto-attack will have a spent swing timer after this tick's decay and holds a target. */
export function swingReadyForQueuedCast(p: SwingReadyView): boolean {
  if (!p.autoAttack || p.targetId === null) return false;
  if (p.swingTimer <= DT) return true;
  return p.dualWielding && !!p.offhandWeapon && p.offhandSwingTimer <= DT;
}
