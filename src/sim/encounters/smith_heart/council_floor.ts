// The Hammer Council's floor gap wired to the fight (the rule, its list, its
// order and its rhythm: council_floor_gap.ts). The coordinator calls
// startFloorMechanics once a tick, where the Wrath, Wake the Stone and the
// Falling Rock used to start on their own clocks, and carryWrathHold when a
// Wrath lands. Zero rng.

import { DT } from '../../types';
import {
  type FloorCandidate,
  type FloorMechanic,
  nextAfterHold,
  runFloorGate,
} from './council_floor_gap';
import { councilFillSeconds, COUNCIL_TUNING as T } from './council_ids';
import { type CouncilScope, jobHolder } from './council_scope';
import { guardianSoulReady, startEcho, startSlab, walkingSlabWaiting } from './council_soul';
import type { CouncilFightState } from './council_state';
import { startRock, startWake } from './council_stone';
import { startWrath } from './council_wrath';

function heldOf(st: CouncilFightState, key: FloorMechanic): number {
  const h = st.floorHeld[key] ?? 0;
  st.floorHeld[key] = 0;
  return h;
}

/** Start whatever floor mechanic is due and the gap allows, in order, and
 *  put each started one's next interval back on its cadence. */
export function startFloorMechanics(s: CouncilScope): FloorMechanic[] {
  const st = s.st;
  const wrathHolder = jobHolder(s, 'wrath');
  const candidates: FloorCandidate[] = [
    {
      key: 'wrath',
      due:
        wrathHolder !== null &&
        st.energy >= T.energyMax - 1e-6 &&
        st.bars[wrathHolder.role] === undefined,
      start: () => startWrath(s),
    },
    { key: 'echo', due: guardianSoulReady(s), start: () => startEcho(s) },
    { key: 'wake', due: st.wakeTimer <= 0, start: () => startWake(s) },
    { key: 'rock', due: st.rockTimer <= 0, start: () => startRock(s) },
    { key: 'slab', due: walkingSlabWaiting(s), start: () => startSlab(s) },
  ];
  const started = runFloorGate(st, T.floorGap, DT, candidates);
  for (const key of started) {
    if (key === 'wake') st.wakeTimer = nextAfterHold(T.wakeEvery, heldOf(st, key), T.floorGap);
    else if (key === 'rock') st.rockTimer = nextAfterHold(T.rockEvery, heldOf(st, key), T.floorGap);
    else if (key === 'echo') {
      const soul = st.souls.find((q) => q.role === 'guardian');
      const held = heldOf(st, key);
      if (soul) soul.timer = nextAfterHold(T.echoEvery, held, T.floorGap);
    } else if (key === 'slab') heldOf(st, key);
    // The Wrath keeps its wait until it lands (carryWrathHold).
  }
  return started;
}

/** A Wrath landed (its energy emptied): the seconds it waited on the gap come
 *  back as energy, so the next one starts on the cadence it had. */
export function carryWrathHold(
  st: CouncilFightState,
  heir: boolean,
  heirFillSeconds: number,
): void {
  const held = heldOf(st, 'wrath');
  if (held <= 0) return;
  const fill = councilFillSeconds(heir, st.wraths, heirFillSeconds);
  const next = nextAfterHold(fill, held, T.floorGap);
  st.energy = Math.max(0, Math.min(T.energyMax, T.energyMax * (1 - next / fill)));
}
