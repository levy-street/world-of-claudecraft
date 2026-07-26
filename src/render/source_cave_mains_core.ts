// Pure per-frame state for The Open Source's mains lighting: the server hall
// runs lit until the reboot button is pressed, then drops to a torch-carried
// gloom, and STAYS wrecked once the raid has cleared the room. Three-free and
// deterministic, so the easing and the blend are testable without a renderer.
//
// Three eases, each answering a different question.
//   `mix`   is WHERE the viewer is: it rises while they stand in the cave band
//           and falls back outside, so a real delve keeps the plain shared
//           baseline.
//   `power` is WHAT the button did: it falls fast and recovers slowly, so the
//           cut reads as a breaker snapping rather than a dimmer.
//   `reach` is WHAT THE RAID did: after the clear the murk pulls back without
//           the lights coming back on. Clearing this dungeon is vandalism, not
//           a repair, so the aftermath is deliberately NOT a return to mains:
//           it keeps the outage's near-black ambience and only lets a light
//           source carry further, which is what makes the reward chest across
//           the room readable from the centre (see the beacon's own module).

/** What the room's power is doing, resolved from the seal state by the applier. */
export type SourceCaveMainsPhase =
  /** Before the press (and after a wipe reset): the hall is lit. */
  | 'mains'
  /** The encounter is running: the breaker is out. */
  | 'outage'
  /** The roster is dead: the breaker stays out, but the murk thins. */
  | 'aftermath';

export interface SourceCaveMainsState {
  mix: number;
  power: number;
  reach: number;
}

/** The shared delve ambience this blend departs from and returns to. */
export interface SourceCaveMainsAnchors {
  hemi: number;
  env: number;
  fogFar: number;
}

export interface SourceCaveMainsLevels {
  /** 0 outside the cave, 1 fully inside; also the fog-colour blend weight. */
  mix: number;
  /** 1 on mains, 0 on backup; also the lit-vs-dark fog-colour weight. */
  power: number;
  /** 0 mid-outage, 1 settled into the aftermath; also the dark fog-tint weight. */
  reach: number;
  hemi: number;
  env: number;
  fogFar: number;
}

const MAINS_HEMI = 0.85;
const BACKUP_HEMI = 0.1;
const MAINS_ENV = 0.35;
const BACKUP_ENV = 0.02;
const MAINS_FOG_FAR = 200;
const BACKUP_FOG_FAR = 58;
// The arena is 96u deep and the chest alcove sits 42u from the centre seal. At
// the outage's 58u the chest is ~64% eaten by an almost-black fog, so the reward
// is not readable from where the raid finishes the boss. 100u puts it at ~33%
// (clearly legible) while leaving it a faint far glow from the entrance, 82u
// out. Ambience stays at the BACKUP values throughout: the room is dark because
// nothing lights it, not because the fog is close.
const AFTERMATH_FOG_FAR = 100;

/** Fog tints the painter lerps between; hex here, THREE.Color at the call site. */
export const SOURCE_CAVE_MAINS_FOG_COLOR = 0x2a241c;
export const SOURCE_CAVE_BACKUP_FOG_COLOR = 0x070302;
/** Same near-black, tipped cold: the warm gold of the chest beacon reads against it. */
export const SOURCE_CAVE_AFTERMATH_FOG_COLOR = 0x05070e;

const POWER_FALL_RATE = 9;
const POWER_RISE_RATE = 2.2;
const MIX_RATE = 3;
// Slower than every other ease here on purpose: the murk thinning is an
// aftermath beat the player watches settle, not a state flip.
const REACH_RATE = 0.8;
/** Under this the blend is indistinguishable from the plain delve baseline. */
const MIX_EPSILON = 0.01;

export function createSourceCaveMainsState(): SourceCaveMainsState {
  return { mix: 0, power: 1, reach: 0 };
}

function ease(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-dt * rate));
}

// base is the shared ambience; the cave's own lit and dark ends are picked by
// `power`, then the whole departure is scaled by how far into the cave we are.
function blend(base: number, backup: number, mains: number, power: number, mix: number): number {
  return base + (backup + (mains - backup) * power - base) * mix;
}

/**
 * Advance one frame. Returns the levels to apply, or null once the viewer is
 * outside and the blend has faded out, meaning the frame writes nothing and the
 * shared ambience owns the scene again.
 */
export function stepSourceCaveMains(
  state: SourceCaveMainsState,
  input: { inCave: boolean; phase: SourceCaveMainsPhase; dt: number },
  anchors: SourceCaveMainsAnchors,
): SourceCaveMainsLevels | null {
  const { inCave, phase, dt } = input;
  if (!inCave && state.mix < MIX_EPSILON) {
    state.mix = 0;
    state.power = 1;
    state.reach = 0;
    return null;
  }
  // Power and reach only track while inside: outside, the last state is held so
  // walking back into a rebooted hall does not flash the lights on first.
  if (inCave) {
    const powered = phase === 'mains';
    const rate = powered ? POWER_RISE_RATE : POWER_FALL_RATE;
    state.power = ease(state.power, powered ? 1 : 0, rate, dt);
    state.reach = ease(state.reach, phase === 'aftermath' ? 1 : 0, REACH_RATE, dt);
  }
  state.mix = ease(state.mix, inCave ? 1 : 0, MIX_RATE, dt);

  const { mix, power, reach } = state;
  // The aftermath moves only the DARK end of the fog blend, so a room still on
  // mains is unaffected and the outage stays exactly as claustrophobic as before.
  const darkFogFar = BACKUP_FOG_FAR + (AFTERMATH_FOG_FAR - BACKUP_FOG_FAR) * reach;
  return {
    mix,
    power,
    reach,
    hemi: blend(anchors.hemi, BACKUP_HEMI, MAINS_HEMI, power, mix),
    env: blend(anchors.env, BACKUP_ENV, MAINS_ENV, power, mix),
    fogFar: blend(anchors.fogFar, darkFogFar, MAINS_FOG_FAR, power, mix),
  };
}
