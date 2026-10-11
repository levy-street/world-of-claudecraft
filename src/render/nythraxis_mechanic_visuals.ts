// Thin lifecycle facade for Nythraxis's authoritative floor mechanics. The
// renderer keeps one field and one call at each frame and teardown site, while
// each painter remains independently testable and owns its row resources.

import type * as THREE from 'three';
import { DUNGEON_X_THRESHOLD } from '../sim/data';
import {
  type ActiveNythraxisBindingSigil,
  NYTHRAXIS_SIGIL_RADIUS_NORMAL,
} from '../sim/nythraxis_binding_sigil';
import type { ActiveNythraxisGraveFlame } from '../sim/nythraxis_grave_eruption';
import type { ActiveNythraxisGravefire } from '../sim/nythraxis_gravefire';
import { groundCueY } from './dais_lift';
import type { NythraxisCageBossLike } from './nythraxis_bound_cage_core';
import { NythraxisBoundCageVisuals } from './nythraxis_bound_cage_visual';
import { NythraxisGraveFlameVisuals } from './nythraxis_grave_flame_visual';
import { NythraxisGravefireVisuals } from './nythraxis_gravefire_visual';
import type { HazardPaletteMode } from './nythraxis_hazard_palette_core';
import { NythraxisBindingSigilVisuals } from './nythraxis_sigil_visual';
import { NythraxisSoulRendMarkers } from './nythraxis_soul_rend_marker';
import type { NythraxisSoulRendEntityLike } from './nythraxis_soul_rend_marker_core';

export interface NythraxisMechanicWorld {
  activeNythraxisGraveFlames: readonly ActiveNythraxisGraveFlame[];
  activeNythraxisGravefires: readonly ActiveNythraxisGravefire[];
  activeNythraxisBindingSigils: readonly ActiveNythraxisBindingSigil[];
  /**
   * The roster, for the aura-driven painters: the Bound cage follows the boss's
   * stun and the Soul Rend markers follow the raiders' marks, so neither needs
   * a row of its own. Walked only while the viewer stands inside the instance
   * band (`player`): the encounter cannot run anywhere else, and an open-field
   * roster is thousands of entities per frame for nothing.
   */
  entities: ReadonlyMap<number, NythraxisCageBossLike & NythraxisSoulRendEntityLike>;
  player: { pos: { x: number } };
}

const EMPTY_ROSTER: ReadonlyMap<number, NythraxisCageBossLike & NythraxisSoulRendEntityLike> =
  new Map();

/** The roster the aura-driven painters see: the real one inside the instance
 *  band, an empty one outside (so a cage or marker carried out drops at once). */
export function nythraxisPainterRoster(
  world: NythraxisMechanicWorld,
): NythraxisMechanicWorld['entities'] {
  return world.player.pos.x > DUNGEON_X_THRESHOLD ? world.entities : EMPTY_ROSTER;
}

/** The widest one-sample Nythraxis ground cue (the Normal sigil): flat cues
 *  probe this footprint for a platform rim (dais_lift.ts groundCueY). */
export const NYTHRAXIS_GROUND_CUE_RADIUS = NYTHRAXIS_SIGIL_RADIUS_NORMAL;

export class NythraxisMechanicVisuals {
  private flames: NythraxisGraveFlameVisuals;
  private gravefires: NythraxisGravefireVisuals;
  private readonly sigils: NythraxisBindingSigilVisuals;
  private readonly cages: NythraxisBoundCageVisuals;
  private soulRendMarkers: NythraxisSoulRendMarkers;
  private readonly painterRoster = { entities: EMPTY_ROSTER };
  private readonly cueY: (x: number, z: number) => number;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    /** The player's hazard palette (Options > Interface > Colorblind Mode);
     *  materials are tinted once per row, so a flip rebuilds the hazard painters. */
    private paletteMode: HazardPaletteMode = 'classic',
  ) {
    // Flat one-sample decals (the flame patch, the sigil, the cage) read the
    // tallest plateau under their footprint so a flanking-platform rim
    // (v0.42.2) never hides part of them; the per-vertex visuals (the
    // gravefire strips, the Soul Rend markers) drape themselves.
    this.cueY = (x, z) => groundCueY(groundY, x, z, NYTHRAXIS_GROUND_CUE_RADIUS);
    this.flames = new NythraxisGraveFlameVisuals(scene, this.cueY, paletteMode);
    this.gravefires = new NythraxisGravefireVisuals(scene, groundY, paletteMode);
    this.sigils = new NythraxisBindingSigilVisuals(scene, this.cueY);
    this.cages = new NythraxisBoundCageVisuals(scene, this.cueY);
    this.soulRendMarkers = new NythraxisSoulRendMarkers(scene, groundY, paletteMode);
  }

  /** The palette family in force (Colorblind Mode on or off). */
  get hazardPaletteMode(): HazardPaletteMode {
    return this.paletteMode;
  }

  /** Colorblind Mode flip: the three hazard painters tint their materials at
   *  build, so they are disposed and rebuilt; the next syncWorld repaints every
   *  live row from its authoritative state (same radius, same countdown) in the
   *  new family. The friendly sigil and the cage keep their one palette. */
  setPaletteMode(mode: HazardPaletteMode): void {
    if (mode === this.paletteMode) return;
    this.paletteMode = mode;
    this.flames.dispose();
    this.gravefires.dispose();
    this.soulRendMarkers.dispose();
    this.flames = new NythraxisGraveFlameVisuals(this.scene, this.cueY, mode);
    this.gravefires = new NythraxisGravefireVisuals(this.scene, this.groundY, mode);
    this.soulRendMarkers = new NythraxisSoulRendMarkers(this.scene, this.groundY, mode);
  }

  syncWorld(world: NythraxisMechanicWorld): void {
    this.flames.syncWorld(world);
    this.gravefires.syncWorld(world);
    this.sigils.syncWorld(world);
    const roster = this.painterRoster;
    roster.entities = nythraxisPainterRoster(world);
    this.cages.syncWorld(roster);
    this.soulRendMarkers.syncWorld(roster);
  }

  update(dt: number, reducedMotion: boolean): void {
    this.flames.update(dt, reducedMotion);
    this.gravefires.update(dt, reducedMotion);
    this.sigils.update(dt, reducedMotion);
    this.cages.update(dt, reducedMotion);
    this.soulRendMarkers.update(dt, reducedMotion);
  }

  dispose(): void {
    this.flames.dispose();
    this.gravefires.dispose();
    this.sigils.dispose();
    this.cages.dispose();
    this.soulRendMarkers.dispose();
  }
}
