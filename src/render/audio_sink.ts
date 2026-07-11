// The seam between the renderer (which knows entity movement, surface, and the
// camera) and the spatial sound engine (src/game/sfx.ts). The renderer depends
// only on this interface; main.ts injects the real `sfx` singleton. This keeps
// src/render/ free of any src/game/ import (see src/CLAUDE.md dependency rules).

import type { BiomeId } from '../sim/types';

export type Surface = 'grass' | 'dirt' | 'stone' | 'wood' | 'snow' | 'water';

export interface SpatialAudioSink {
  /** Listener pose each frame: position + forward unit vector (camera). */
  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number): void;
  /** One footfall for an entity (self or other) at a world position. */
  footstep(
    x: number,
    y: number,
    z: number,
    surface: Surface,
    running: boolean,
    self: boolean,
  ): void;
  /** A discrete movement event (jump / land / water entry / swim stroke). */
  movement(
    kind: 'jump' | 'land' | 'splash' | 'swim',
    x: number,
    y: number,
    z: number,
    self: boolean,
  ): void;
  /** Per-frame ambience state around the player; the engine cross-fades loops.
   *  `crowd` is the Sowfield crowd-murmur level (0 away from the stadium,
   *  ~0.4 on the grounds, 1 while a Vale Cup match is live). */
  ambience(
    biome: BiomeId,
    inDungeon: boolean,
    precip: 'snow' | 'rain' | null,
    nearWater: boolean,
    crowd: number,
  ): void;
}
