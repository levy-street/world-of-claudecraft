// The Masterless Strength's own elements' state (final_elements_ids.ts):
// FinalFightState.elements, on the boss. Server-local sim authority; the
// client reads the auras, the bar and the objects. Type-only.

import type { SmithHeartVein } from '../../content/smith_heart_layout';
import type { FusionCombo, Polarity } from './final_elements_ids';

/** A drifting steam cloud. */
export interface SteamCloud {
  objectId: number;
  x: number;
  z: number;
  warn: number;
  life: number;
  heading: number;
  turn: number;
  tick: number;
}

/** A Magma Rift mark riding its player, then the pool it leaves. */
export interface MagmaMark {
  pid: number;
  left: number;
}
export interface LavaPool {
  objectId: number;
  x: number;
  z: number;
  r: number;
  life: number;
  element: 'fire' | 'frost' | 'storm' | 'stone';
  /** A residue (Mythic) rather than a Magma Rift's pool. */
  residue: boolean;
}

/** A lane (Firestorm, Avalanche): from its start along `facing`. */
export interface ElementLane {
  objectId: number;
  kind: 'fire' | 'avalanche';
  x: number;
  z: number;
  facing: number;
  length: number;
  half: number;
  /** Seconds of warning left (then it runs). */
  warn: number;
  /** The run's progress, yards from its start (the front). */
  front: number;
  /** Seconds it runs in all. */
  run: number;
  struck: number[];
}

/** A Storm Spire group. */
export interface SpireGroup {
  ids: number[];
  pts: { x: number; z: number }[];
  charge: number;
  /** Discharges still to come and the clock to the next. */
  left: number;
  gap: number;
  group: number;
}

/** A hailstone falling. */
export interface Hailstone {
  objectId: number;
  x: number;
  z: number;
  left: number;
}

/** A player's polarity mark. */
export interface PolarityMark {
  pid: number;
  polarity: Polarity;
}

export interface FinalElementsState {
  // -- Elemental Strike --
  strikeClock: number;
  strikes: number;
  /** Static Charge's arc clock (per tank id). */
  arcClock: Record<number, number>;
  // -- Elemental Fusion --
  /** A fusion waiting for the boss to be free: the quarter it left and the
   *  one it entered. */
  pending: { from: SmithHeartVein; to: SmithHeartVein } | null;
  /** The fusion's bar in flight. */
  casting: { from: SmithHeartVein; to: SmithHeartVein } | null;
  fusions: number;
  /** The last combo fired (the readout and the tests). */
  lastCombo: FusionCombo | null;
  /** The quarter the running combo lives in. */
  comboQuarter: SmithHeartVein | null;
  steam: SteamCloud[];
  magma: MagmaMark[];
  pools: LavaPool[];
  poolTick: number;
  lanes: ElementLane[];
  hail: Hailstone[];
  /** Hailstorm's waves still to fall and the clock to the next. */
  hailWaves: number;
  hailClock: number;
  /** Mythic's second Avalanche: its lanes wait this long. */
  avalancheLater: { left: number; offset: number } | null;
  spires: SpireGroup[];
  // -- Opposing Elements --
  polarityClock: number;
  polarityLeft: number;
  marks: PolarityMark[];
  rounds: number;
  /** Counters the tests and the readout read. */
  balanced: number;
  clashes: number;
  unbalanced: number;
}
