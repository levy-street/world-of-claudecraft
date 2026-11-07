// The Hammer Council's floor gap wired to the fight (the rule, its list, its
// order and its rhythm: council_floor_gap.ts). The coordinator calls
// startFloorMechanics once a tick, where the Wrath, Wake the Stone, Mountain's
// Rush and the Falling Rock start, and carryWrathHold when a Wrath lands.
//
// The Wrath guard (normal only, `floorAvoidsWrath`): Wake the Stone and
// Mountain's Rush are not due while what they put on the floor (the marks
// and the pillars they raise, the Rush's mark and dash) would still be running
// when the Wrath's bar begins, nor while that bar runs: they wait until it has
// landed. Heroic and mythic let them overlap. Zero rng.

import { DT } from '../../types';
import {
  type FloorCandidate,
  type FloorMechanic,
  nextAfterHold,
  runFloorGate,
} from './council_floor_gap';
import { COUNCIL_CASTS, councilFillSeconds, COUNCIL_TUNING as T } from './council_ids';
import { rushDue, startRush } from './council_rush';
import { type CouncilScope, jobHolder } from './council_scope';
import { guardianSoulReady, startEcho } from './council_soul';
import type { CouncilFightState } from './council_state';
import { startRock, startWake } from './council_stone';
import { startWrath } from './council_wrath';

function heldOf(st: CouncilFightState, key: FloorMechanic): number {
  const h = st.floorHeld[key] ?? 0;
  st.floorHeld[key] = 0;
  return h;
}

/**
 * May a floor mechanic that runs `seconds` start now without running into a
 * Wrath? Always on a tier that lets them overlap; else no Wrath bar in flight
 * and the next Wrath's bar at least `seconds` plus the guard's pad away.
 */
export function clearOfWrath(s: CouncilScope, seconds: number): boolean {
  if (!s.rules.floorAvoidsWrath) return true;
  const holder = jobHolder(s, 'wrath');
  if (!holder) return true;
  if (s.st.bars[holder.role]?.castId === COUNCIL_CASTS.wrath) return false;
  const per =
    T.energyMax /
    councilFillSeconds(
      holder.heir,
      s.st.wraths,
      s.rules.heirFillSeconds,
      s.rules.enrageAfterWraths,
    );
  const toBar = Math.max(0, T.energyMax - s.st.energy) / per;
  return seconds + T.wrathGuardPad <= toBar + 1e-9;
}

/** Seconds a Wake puts on the floor before its pillars stand. */
export function wakeSeconds(s: CouncilScope): number {
  const holder = jobHolder(s, 'pillars');
  return holder?.heir ? s.rules.heirRiseWarn : T.wakeCast + T.wakeMarkSeconds;
}

/** Seconds a Rush puts on the floor: its mark, the wind-up and a typical
 *  dash (about 44 yd at the run; a full-width one runs longer, and the
 *  Wrath waits on a Rush in flight anyway). */
export const RUSH_FLOOR_SECONDS = T.rushCast + T.rushWindup + 2;

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
        st.bars[wrathHolder.role] === undefined &&
        !(wrathHolder.role === 'guardian' && st.rush !== null),
      start: () => startWrath(s),
    },
    { key: 'echo', due: guardianSoulReady(s), start: () => startEcho(s) },
    {
      key: 'wake',
      due: st.wakeTimer <= 0 && clearOfWrath(s, wakeSeconds(s)),
      start: () => startWake(s),
    },
    {
      key: 'rush',
      due: rushDue(s) && clearOfWrath(s, RUSH_FLOOR_SECONDS),
      start: () => startRush(s),
    },
    { key: 'rock', due: st.rockTimer <= 0, start: () => startRock(s) },
  ];
  const started = runFloorGate(st, T.floorGap, DT, candidates);
  for (const key of started) {
    if (key === 'wake') {
      const every = jobHolder(s, 'pillars')?.heir ? T.heirWakeEvery : T.wakeEvery;
      st.wakeTimer = nextAfterHold(every, heldOf(st, key), T.floorGap);
    } else if (key === 'rush')
      st.rushTimer = nextAfterHold(T.rushEvery, heldOf(st, key), T.floorGap);
    else if (key === 'rock') st.rockTimer = nextAfterHold(T.rockEvery, heldOf(st, key), T.floorGap);
    else if (key === 'echo') {
      const soul = st.souls.find((q) => q.role === 'guardian');
      const held = heldOf(st, key);
      if (soul) soul.timer = nextAfterHold(T.echoEvery, held, T.floorGap);
    }
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
  enrageAfter?: number,
): void {
  const held = heldOf(st, 'wrath');
  if (held <= 0) return;
  const fill = councilFillSeconds(heir, st.wraths, heirFillSeconds, enrageAfter);
  const next = nextAfterHold(fill, held, T.floorGap);
  st.energy = Math.max(0, Math.min(T.energyMax, T.energyMax * (1 - next / fill)));
}
