// Closed-form motion for parkour-course features: the one clock and the pure
// phase functions every dynamic element resolves against.
//
// The contract, inherited from the Blackspan Galleries' pit course (the
// physics-branch dungeon this kernel generalizes): every moving or timed
// feature is a CLOSED FORM in (its authored constants, the course clock).
// No integration, no per-feature state, no rng. The sim's floor query and the
// renderer's animation evaluate the SAME function at the same clock value, so
// a deck stands exactly where its collision stands, frame for frame, on every
// host. That is the entire fairness story of a platforming course, and it is
// why nothing in this file may read anything but its arguments.
//
// The clock is module-global and host-synchronised: the sim sets it at the top
// of every tick, the online client sets it from each snapshot's time, and the
// renderer reads it per frame. One authority per process; all Sims in a
// process advance in lockstep from the same host loop.

/** Vertical rider: y offset above base, cosine-eased between 0 and amp.
 *  At t = 0 the deck rests at BASE height, so static audits and generation
 *  probes see the resting course. */
export interface CourseMotion {
  amp: number;
  period: number;
  phase: number;
}

/** Horizontal rider: the deck slides from its authored (x, z) to (x2, z2)
 *  and back, cosine-eased so riders are never jerked at the turnaround. */
export interface CourseTrack {
  x2: number;
  z2: number;
  period: number;
  phase: number;
}

/** Duty-cycle window: active while frac(t / period + phase) < duty.
 *  Shared by jets, geysers, blink tiles, and the timed hazards. */
export interface CourseDuty {
  period: number;
  duty: number;
  phase: number;
}

let courseClock = 0;

/** Set the course clock (sim time, seconds). Called by every host per tick. */
export function setCourseClock(t: number): void {
  courseClock = t;
}

/** The current course clock (floor queries and the renderer's animation). */
export function courseClockNow(): number {
  return courseClock;
}

/** Piston deck height offset above its base y at clock time t. */
export function pistonLift(m: CourseMotion, t: number): number {
  return m.amp * 0.5 * (1 - Math.cos(2 * Math.PI * (t / m.period + m.phase)));
}

/** Where a ferry deck's centre sits at clock time t. Cosine ping-pong along
 *  its track: u = 0 is the authored end, u = 1 the far end, and the ease
 *  means the turnarounds have zero velocity, so a rider is set down gently
 *  rather than thrown. At t = 0 (phase 0) the ferry rests at its authored
 *  end, matching the piston's resting-course convention. */
export function ferryPos(
  x: number,
  z: number,
  track: CourseTrack,
  t: number,
): { x: number; z: number } {
  const u = 0.5 * (1 - Math.cos(2 * Math.PI * (t / track.period + track.phase)));
  return { x: x + (track.x2 - x) * u, z: z + (track.z2 - z) * u };
}

/** Is a duty-cycle window (jet, geyser, blink tile, spike bed, dart lane)
 *  active at clock time t? */
export function dutyActive(d: CourseDuty, t: number): boolean {
  const cycle = t / d.period + d.phase;
  return cycle - Math.floor(cycle) < d.duty;
}

/** A blink tile is SOLID in its duty window and absent outside it. Named
 *  separately from dutyActive so call sites read as the question they ask,
 *  and so a future easing (a grace margin on the trailing edge) has one home. */
export function blinkSolid(d: CourseDuty, t: number): boolean {
  return dutyActive(d, t);
}

/** Seconds until this duty window next changes state, for telegraphs: the
 *  renderer fades a blink tile's ghost in as the flip approaches, and the
 *  sim never needs it (the floor query asks only "solid now"). */
export function dutyTimeToFlip(d: CourseDuty, t: number): number {
  const cycle = t / d.period + d.phase;
  const frac = cycle - Math.floor(cycle);
  const edge = frac < d.duty ? d.duty : 1;
  return (edge - frac) * d.period;
}

// ---------------------------------------------------------------------------
// Hazards. A hazard is an authored, purely clock-driven danger: the telegraph
// the renderer draws and the volume the sim damages in are the same function
// evaluated twice.
//
//   spikes   a floor patch that erupts on its duty window (box hw/hd)
//   darts    a wall-fired lane, short duty and higher damage (box hw/hd)
//   blade    a pendulum sweeping its path both ways (cosine ease)
//   boulder  a rolling mass running its path one way, then a fresh one
//   sweeper  a beam orbiting a pivot at constant angular speed; the danger
//            volume is the beam's line, from the pivot out to its length
// ---------------------------------------------------------------------------

export type CourseHazardKind = 'spikes' | 'darts' | 'blade' | 'boulder' | 'sweeper';

export interface CourseHazard {
  kind: CourseHazardKind;
  x: number;
  z: number;
  /** Standing height of the deck the hazard rides on (course-local). */
  y: number;
  /** Box half-extents (spikes, darts). */
  hw?: number;
  hd?: number;
  /** Path end (blade, boulder). */
  x2?: number;
  z2?: number;
  /** Body radius (blade, boulder) or beam half-width (sweeper). */
  r?: number;
  /** Beam length from the pivot (sweeper). */
  len?: number;
  period: number;
  /** Fraction of the period the hazard is live (1 for the always-on kinds). */
  duty: number;
  phase: number;
  damage: number;
  /** Horizontal knockback speed on contact (blade, boulder, sweeper). */
  shove?: number;
}

/** Is a hazard live at clock time t? Movers are always live; the timed
 *  kinds follow their duty window. */
export function hazardActive(h: CourseHazard, t: number): boolean {
  if (h.kind === 'blade' || h.kind === 'boulder' || h.kind === 'sweeper') return true;
  return dutyActive(h, t);
}

/** Where a path hazard (blade, boulder) sits at clock time t. A blade swings
 *  both ways on a cosine ease; a boulder runs one way and resets, so it reads
 *  as a fresh mass every period. */
export function hazardPos(h: CourseHazard, t: number): { x: number; z: number } {
  const x2 = h.x2 ?? h.x;
  const z2 = h.z2 ?? h.z;
  const cycle = t / h.period + h.phase;
  const frac = cycle - Math.floor(cycle);
  const u = h.kind === 'blade' ? 0.5 * (1 - Math.cos(2 * Math.PI * cycle)) : frac;
  return { x: h.x + (x2 - h.x) * u, z: h.z + (z2 - h.z) * u };
}

/** A sweeper beam's angle at clock time t (radians; one turn per period). */
export function sweeperAngle(h: CourseHazard, t: number): number {
  return 2 * Math.PI * (t / h.period + h.phase);
}

/** Signed distances of a point from a sweeper's beam at clock time t:
 *  `along` from the pivot down the beam (0..len is on the beam), `perp`
 *  across it. The contact test and the renderer's beam pose share this. */
export function sweeperFrame(
  h: CourseHazard,
  t: number,
  px: number,
  pz: number,
): { along: number; perp: number } {
  const a = sweeperAngle(h, t);
  const ux = Math.sin(a);
  const uz = Math.cos(a);
  const dx = px - h.x;
  const dz = pz - h.z;
  return { along: dx * ux + dz * uz, perp: dx * uz - dz * ux };
}
