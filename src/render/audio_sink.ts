// The seam between the renderer (which knows entity movement, surface, and the
// camera) and the spatial sound engine (src/game/sfx.ts). The renderer depends
// only on this interface; main.ts injects the real `sfx` singleton. This keeps
// src/render/ free of any src/game/ import (see src/CLAUDE.md dependency rules).

import type { BiomeId } from '../sim/types';

export type Surface = 'grass' | 'dirt' | 'stone' | 'wood' | 'snow' | 'water';

export interface AmbientPointSource {
  readonly id: string;
  readonly kind: 'campfire' | 'forge';
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Per-ability audio moments fired by the ability-VFX engine: windup (the
 *  charge bed while a cast is winding up, at the caster), release (cast lets
 *  go, at the caster), impact (at the impact point), pulse (one soft zone
 *  re-hit), crit (the sting layered over a critical impact), spirit (a
 *  creature apparition calls as it spawns), motif (set-piece foley at the
 *  motif anchor). */
export type AbilityAudioKind =
  | 'windup'
  | 'release'
  | 'impact'
  | 'pulse'
  | 'crit'
  | 'spirit'
  | 'motif';

export interface AbilityAudioOpts {
  /** Quieter, sub-less version (spec liteAudio or a degraded visual tier). */
  lite?: boolean;
  finisher?: boolean;
  /** Spec archetype: heal/buff/cc chime gently instead of booming. */
  archetype?: string;
  /** Authored buff apply style ('raise' | 'morph' | 'veil'). Inert while the
   *  buff landing is carried by the recorded buff_apply cue; kept so a future
   *  conformed sample pack can style it again without re-plumbing the seam. */
  buffStyle?: string;
  /** Spec-authored bespoke sample id (impact.sample). Inert for the same
   *  reason as buffStyle: no sampled ability pack ships today. */
  sample?: string;
  /** The spirit creature model ('spirit') or motif name ('motif'). */
  name?: string;
  /** The casting ability id, so the audio engine can resolve the ability's
   *  school and projectile flag and skip any moment a hand-recorded cue
   *  already sounds (src/game/ability_sfx_coverage.ts). */
  abilityId?: string;
}

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
  /** One custom running stride for a mounted entity. */
  mountRun(x: number, y: number, z: number, mountKey: string, self: boolean): void;
  /** A discrete movement event (jump / land / water entry / swim stroke). */
  movement(
    kind: 'jump' | 'land' | 'splash' | 'swim',
    x: number,
    y: number,
    z: number,
    self: boolean,
  ): void;
  /** Per-frame ambience state around the player; the engine cross-fades loops.
   *  `biome` is the full `BiomeId` union (covers both the grid-world biomes and
   *  the beach/desert/volcano/cave set). `crowd` is the Sowfield crowd-murmur
   *  level (0 away from the stadium, about 0.4 on the grounds, 1 while a Vale
   *  Cup match is live). */
  ambience(
    biome: BiomeId,
    inDungeon: boolean,
    precip: 'snow' | 'rain' | null,
    nearWater: boolean,
    crowd: number,
    points?: readonly AmbientPointSource[],
  ): void;
  /** One per-ability procedural audio moment at a world position (the 12
   *  palette identities live in src/game/sfx.ts). Optional: an engine without
   *  the synth layer simply stays silent for ability moments. */
  abilityAudio?(
    kind: AbilityAudioKind,
    palette: string,
    power: number,
    x: number,
    y: number,
    z: number,
    opts?: AbilityAudioOpts,
  ): void;
}
