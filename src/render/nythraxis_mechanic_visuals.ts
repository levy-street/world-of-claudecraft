// Thin lifecycle facade for Nythraxis's authoritative floor mechanics. The
// renderer keeps one field and one call at each frame and teardown site, while
// each painter remains independently testable and owns its row resources.

import type * as THREE from 'three';
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
   * a row of its own.
   */
  entities: ReadonlyMap<number, NythraxisCageBossLike & NythraxisSoulRendEntityLike>;
}

/** The widest one-sample Nythraxis ground cue (the Normal sigil): flat cues
 *  probe this footprint for a platform rim (dais_lift.ts groundCueY). */
export const NYTHRAXIS_GROUND_CUE_RADIUS = NYTHRAXIS_SIGIL_RADIUS_NORMAL;

export class NythraxisMechanicVisuals {
  private readonly flames: NythraxisGraveFlameVisuals;
  private readonly gravefires: NythraxisGravefireVisuals;
  private readonly sigils: NythraxisBindingSigilVisuals;
  private readonly cages: NythraxisBoundCageVisuals;
  private readonly soulRendMarkers: NythraxisSoulRendMarkers;

  constructor(scene: THREE.Scene, groundY: (x: number, z: number) => number) {
    // Flat one-sample decals (the flame patch, the sigil, the cage) read the
    // tallest plateau under their footprint so a flanking-platform rim
    // (v0.42.2) never hides part of them; the per-vertex visuals (the
    // gravefire strips, the Soul Rend markers) drape themselves.
    const cueY = (x: number, z: number) => groundCueY(groundY, x, z, NYTHRAXIS_GROUND_CUE_RADIUS);
    this.flames = new NythraxisGraveFlameVisuals(scene, cueY);
    this.gravefires = new NythraxisGravefireVisuals(scene, groundY);
    this.sigils = new NythraxisBindingSigilVisuals(scene, cueY);
    this.cages = new NythraxisBoundCageVisuals(scene, cueY);
    this.soulRendMarkers = new NythraxisSoulRendMarkers(scene, groundY);
  }

  syncWorld(world: NythraxisMechanicWorld): void {
    this.flames.syncWorld(world);
    this.gravefires.syncWorld(world);
    this.sigils.syncWorld(world);
    this.cages.syncWorld(world);
    this.soulRendMarkers.syncWorld(world);
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
