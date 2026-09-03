// Thin lifecycle facade for Nythraxis's authoritative floor mechanics. The
// renderer keeps one field and one call at each frame and teardown site, while
// each painter remains independently testable and owns its row resources.

import type * as THREE from 'three';
import type { ActiveNythraxisBindingSigil } from '../sim/nythraxis_binding_sigil';
import type { ActiveNythraxisGraveFlame } from '../sim/nythraxis_grave_eruption';
import type { ActiveNythraxisGravefire } from '../sim/nythraxis_gravefire';
import { NythraxisGraveFlameVisuals } from './nythraxis_grave_flame_visual';
import { NythraxisGravefireVisuals } from './nythraxis_gravefire_visual';
import { NythraxisBindingSigilVisuals } from './nythraxis_sigil_visual';

export interface NythraxisMechanicWorld {
  activeNythraxisGraveFlames: readonly ActiveNythraxisGraveFlame[];
  activeNythraxisGravefires: readonly ActiveNythraxisGravefire[];
  activeNythraxisBindingSigils: readonly ActiveNythraxisBindingSigil[];
}

export class NythraxisMechanicVisuals {
  private readonly flames: NythraxisGraveFlameVisuals;
  private readonly gravefires: NythraxisGravefireVisuals;
  private readonly sigils: NythraxisBindingSigilVisuals;

  constructor(scene: THREE.Scene, groundY: (x: number, z: number) => number) {
    this.flames = new NythraxisGraveFlameVisuals(scene, groundY);
    this.gravefires = new NythraxisGravefireVisuals(scene, groundY);
    this.sigils = new NythraxisBindingSigilVisuals(scene, groundY);
  }

  syncWorld(world: NythraxisMechanicWorld): void {
    this.flames.syncWorld(world);
    this.gravefires.syncWorld(world);
    this.sigils.syncWorld(world);
  }

  update(dt: number, reducedMotion: boolean): void {
    this.flames.update(dt, reducedMotion);
    this.gravefires.update(dt, reducedMotion);
    this.sigils.update(dt, reducedMotion);
  }

  dispose(): void {
    this.flames.dispose();
    this.gravefires.dispose();
    this.sigils.dispose();
  }
}
