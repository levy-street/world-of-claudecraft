// The Hammer Council's floor gap, the pure rule (docs/design/raid/smith_heart.md section 7.1):
// every mechanic that paints the Quarry floor with something the raid must
// react to (a FLOOR mechanic) keeps its start at least `floorGap` seconds after
// the last floor start, so the rock, the rising stone, the Wrath's sight field,
// the Echo and the Rush's lane never land on the floor at once.
//
//   The list      Mountain's Wrath (its sight field), the Echo of Wrath (its
//                 ring), Wake the Stone (its circles; an heir's rise spots),
//                 Mountain's Rush (its lane and mark) and Falling Rock (its
//                 soak circle). Seam Bolt, the song and Hammer's Weight paint
//                 no floor and keep their own clocks untouched.
//   The order     due together, they go in FLOOR_PRIORITY (the Wrath first,
//                 the cover before the Rush that spends it, the rock last),
//                 one per gap; each still fires: a start
//                 resets its own clock to 20 s or more, so a waiting mechanic
//                 waits at most one gap per other floor mechanic.
//   The rhythm    the seconds a mechanic waited on the gap (`floorHeld`) come
//                 off its NEXT interval (never below one gap), so its later
//                 starts stay on the cadence they had: delays never pile up.
//                 The Wrath's carry is energy: it lands with the waited
//                 seconds' worth already filled.
//   Dev           `/dev heart council wrath|wake|rush|rock` call the start
//                 functions directly: they bypass the gate but
//                 still stamp it, so the fight's own floor starts space after.
//
// This leaf holds the pure rule (the tests and every start function import
// it); council_floor.ts wires it to the council. Imports nothing. Zero rng:
// the order is a fixed list, the clock is the fight's own.

export type FloorMechanic = 'wrath' | 'echo' | 'wake' | 'rush' | 'rock';

/** The stable order floor mechanics due on one tick take the floor in. */
export const FLOOR_PRIORITY: readonly FloorMechanic[] = ['wrath', 'echo', 'wake', 'rush', 'rock'];

/** The fight-state slice the gate reads and writes. */
export interface FloorGapState {
  clock: number;
  /** The fight clock of the last floor start, or null before the first. */
  lastFloorAt: number | null;
  /** Seconds each mechanic has waited on the gap since its last start. */
  floorHeld: Partial<Record<FloorMechanic, number>>;
}

/** May a floor mechanic start now? (pure) */
export function floorOpen(lastFloorAt: number | null, clock: number, gap: number): boolean {
  return lastFloorAt === null || clock - lastFloorAt >= gap - 1e-9;
}

/** The next interval of a mechanic that waited `held` seconds on the gap: its
 *  own cadence less the wait, never shorter than one gap. (pure) */
export function nextAfterHold(every: number, held: number, gap: number): number {
  return Math.max(gap, every - Math.max(0, held));
}

/** The most a mechanic can legitimately wait (one gap per other floor
 *  mechanic); a wait past it is a mechanic that could not start anyway. */
export function maxFloorHold(gap: number): number {
  return gap * FLOOR_PRIORITY.length;
}

/** Stamp a floor start (the gate's own starts and the dev triggers'). */
export function stampFloor(st: Pick<FloorGapState, 'clock' | 'lastFloorAt'>): void {
  st.lastFloorAt = st.clock;
}

/** One floor mechanic's turn this tick: due now, and how to start it. */
export interface FloorCandidate {
  key: FloorMechanic;
  due: boolean;
  /** Starts it; false when it could not (its caster busy, nobody to mark). */
  start: () => boolean;
}

/**
 * One tick of the gate (pure over the state slice): walk the due candidates
 * in FLOOR_PRIORITY; while the floor is open the first that starts takes it
 * (and closes it for the rest), every due one the gap holds back counts the
 * tick as waited. Returns the keys started, in order.
 */
export function runFloorGate(
  st: FloorGapState,
  gap: number,
  dt: number,
  candidates: readonly FloorCandidate[],
): FloorMechanic[] {
  const started: FloorMechanic[] = [];
  const sorted = [...candidates].sort(
    (a, b) => FLOOR_PRIORITY.indexOf(a.key) - FLOOR_PRIORITY.indexOf(b.key),
  );
  for (const c of sorted) {
    if (!c.due) continue;
    if (floorOpen(st.lastFloorAt, st.clock, gap)) {
      if (!c.start()) continue;
      stampFloor(st);
      started.push(c.key);
      continue;
    }
    st.floorHeld[c.key] = Math.min(maxFloorHold(gap), (st.floorHeld[c.key] ?? 0) + dt);
  }
  return started;
}
