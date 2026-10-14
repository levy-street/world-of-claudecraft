// World cues drawn through the pooled particle cloud that are NOT spell
// effects: a quest hut catching fire, and the Drowned Reliquary Rite's shrine
// sequence and its right/wrong answer. They draw through the shared emitters
// (`burst`, `nova`, `healGlow`), never the spell twins, so the Spell Effects
// option (spell_effects_switch.ts) cannot hide them: the rite's pulses are the
// only read of the sequence the player has to repeat.
//
// Lifted out of the renderer's event switch, which stays the dispatcher.

import * as THREE from 'three';
import type { SimEvent } from '../sim/types';
import { groundHeight } from '../sim/world';
import type { Vfx } from './vfx';

export type WorldCueEvent = Extract<
  SimEvent,
  { type: 'worldObjectBurning' | 'delveRitePulse' | 'delveRiteFeedback' }
>;

/** The shrine kind's accent school, so the sequence reads by colour. */
export function riteShrineSchool(shrineKind: string | undefined): string {
  if (shrineKind === 'rite_shrine_candle') return 'fire';
  if (shrineKind === 'rite_shrine_reed') return 'nature';
  if (shrineKind === 'rite_shrine_skull') return 'shadow';
  return 'holy';
}

export function playWorldCueFx(
  vfx: Pick<Vfx, 'burst' | 'nova' | 'healGlow'>,
  ev: WorldCueEvent,
  seed: number,
): void {
  switch (ev.type) {
    case 'worldObjectBurning': {
      // A torched murloc hut (q_deepfen_purge) bursts into flame. First-pass
      // fire cue: a strong low burst plus a taller follow-up so it reads as
      // catching, not a single puff. The lingering blaze is iterated in playtest.
      const gy = groundHeight(ev.x, ev.z, seed);
      vfx.burst(new THREE.Vector3(ev.x, gy + 0.6, ev.z), 'fire', 48, 2.2);
      vfx.burst(new THREE.Vector3(ev.x, gy + 1.4, ev.z), 'fire', 30, 1.6);
      return;
    }
    case 'delveRitePulse':
      // The Rite plays its sequence by pulsing each shrine in turn; a
      // school-coloured nova on the shrine entity shows which one.
      vfx.nova(ev.entityId, riteShrineSchool(ev.shrineKind));
      return;
    case 'delveRiteFeedback':
      // A correct touch answers with a green up-glow; a wrong one with a dark
      // shadow burst on the shrine the player pressed.
      if (ev.correct) vfx.healGlow(ev.shrineId);
      else vfx.nova(ev.shrineId, 'shadow');
      return;
  }
}
