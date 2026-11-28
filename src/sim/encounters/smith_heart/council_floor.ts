// The Hammer Council's floor gap wired to the fight (the rule, its list, its
// order and its rhythm: council_floor_gap.ts). The coordinator calls
// startFloorMechanics once a tick, where the Wrath, Wake the Stone, Mountain's
// Rush and the Falling Rock start, and carryWrathHold when a Wrath lands.
//
// The Wrath guard (normal only, `floorAvoidsWrath`): Wake the Stone and
// Mountain's Rush are not due while what they put on the floor (the marks
// and the pillars they raise, the Rush's mark and dash) would still be running
// when the Wrath's bar begins, nor while that bar runs: they wait until it has
// landed. Heroic and mythic let them overlap.
//
// The rock guard (every tier): Falling Rock never LANDS inside a Wrath's bar.
// The bar is when the raid must stand at its cover, so a soak landing then
// either breaks that cover (every pillar within its reach) or, soaked away,
// leaves its soakers in the open and the raid under the tremor: the floor
// gap's own rule (council_floor_gap.ts) that two floor mechanics never land
// at once. A rock that would land within the Wrath guard's pad of the bar
// waits until the Wrath has landed (the live playtest of 2026-11-24: the
// survivor's rock kept landing two seconds before its Wrath).
//
// The cover guard (every tier, council_cover.ts): a full Wrath after the
// first waits for a Wake to land (or be kicked) and its pillars to rise, and
// for one more when no shelter stands; that Wake is due at once. Zero rng.

import { DT } from '../../types';
import { noteCoverHold, wakeForcedByCover, wrathWaitsForCover } from './council_cover';
import {
  type FloorCandidate,
  type FloorMechanic,
  nextAfterHold,
  runFloorGate,
} from './council_floor_gap';
import { COUNCIL_CASTS, councilFillSeconds, COUNCIL_TUNING as T } from './council_ids';
import { rushDue, startRush } from './council_rush';
import { type CouncilScope, councilHaste, jobHolder } from './council_scope';
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
 * Wrath? Always on a tier that lets them overlap (unless `everyTier`, the
 * rock's guard); else no Wrath bar in flight and the next Wrath's bar at
 * least `seconds` plus the guard's pad away.
 */
export function clearOfWrath(s: CouncilScope, seconds: number, everyTier = false): boolean {
  if (!everyTier && !s.rules.floorAvoidsWrath) return true;
  const holder = jobHolder(s, 'wrath');
  const left = Math.max(0, T.energyMax - s.st.energy);
  if (!holder) {
    // The Guardian's soul still in flight: the Singer takes his energy where
    // he left it when it lands, and her Wrath may come straight after.
    const fury = s.st.fury;
    if (!fury || fury.arrived || fury.fallen !== 'guardian') return true;
    const haste = 1 + s.rules.furyHaste;
    const fill = councilFillSeconds(s.st.wraths, s.rules.enrageAfterWraths, haste);
    const toBar = fury.arriveIn + (left * fill) / T.energyMax;
    return seconds + T.wrathGuardPad <= toBar + 1e-9;
  }
  if (s.st.bars[holder.role]?.castId === COUNCIL_CASTS.wrath) return false;
  const per =
    T.energyMax / councilFillSeconds(s.st.wraths, s.rules.enrageAfterWraths, councilHaste(s));
  const toBar = left / per;
  return seconds + T.wrathGuardPad <= toBar + 1e-9;
}

/** Seconds a Wake puts on the floor before its pillars stand (its bar runs
 *  faster under Grieving Fury; the marks keep their seconds). */
export function wakeSeconds(s: CouncilScope): number {
  return T.wakeCast / councilHaste(s) + T.wakeMarkSeconds;
}

/** Seconds a Falling Rock takes from its bar's start to its landing (its bar
 *  runs faster under Grieving Fury; the mark keeps its seconds). */
export function rockSeconds(s: CouncilScope): number {
  return T.rockCast / councilHaste(s) + T.rockMarkSeconds;
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
  const wrathFull = wrathHolder !== null && st.energy >= T.energyMax - 1e-6;
  // The cover guard (council_cover.ts): a full Wrath waits for its Wake, and
  // that Wake comes due at once, past its clock and the Wrath guard.
  const waits = wrathFull && wrathWaitsForCover(s);
  if (waits) noteCoverHold(st);
  const forceWake = wakeForcedByCover(s, wrathFull);
  const candidates: FloorCandidate[] = [
    {
      key: 'wrath',
      due:
        wrathHolder !== null &&
        wrathFull &&
        !waits &&
        st.bars[wrathHolder.role] === undefined &&
        !(wrathHolder.role === 'guardian' && st.rush !== null),
      start: () => startWrath(s),
    },
    { key: 'echo', due: guardianSoulReady(s), start: () => startEcho(s) },
    {
      key: 'wake',
      due: forceWake || (st.wakeTimer <= 0 && clearOfWrath(s, wakeSeconds(s))),
      start: () => startWake(s),
    },
    {
      key: 'rush',
      due: rushDue(s) && clearOfWrath(s, RUSH_FLOOR_SECONDS),
      start: () => startRush(s),
    },
    {
      key: 'rock',
      due: st.rockTimer <= 0 && clearOfWrath(s, rockSeconds(s), true),
      start: () => startRock(s),
    },
  ];
  const started = runFloorGate(st, T.floorGap, DT, candidates);
  for (const key of started) {
    if (key === 'wake') {
      st.wakeTimer = nextAfterHold(T.wakeEvery, heldOf(st, key), T.floorGap);
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
export function carryWrathHold(st: CouncilFightState, enrageAfter?: number, haste = 1): void {
  const held = heldOf(st, 'wrath');
  if (held <= 0) return;
  const fill = councilFillSeconds(st.wraths, enrageAfter, haste);
  const next = nextAfterHold(fill, held, T.floorGap);
  st.energy = Math.max(0, Math.min(T.energyMax, T.energyMax * (1 - next / fill)));
}
