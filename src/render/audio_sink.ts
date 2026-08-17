// The seam between the renderer (which knows entity movement, surface, and the
// camera) and the spatial sound engine (src/game/sfx.ts). The renderer depends
// only on this interface; main.ts injects the real `sfx` singleton. This keeps
// src/render/ free of any src/game/ import (see src/CLAUDE.md dependency rules).

import type { BiomeId } from '../sim/types';

export type Surface = 'grass' | 'dirt' | 'stone' | 'wood' | 'snow' | 'water';

export interface AmbientPointSource {
  readonly id: string;
  // 'rift_portal'/'rift_roller'/'rift_ice_glide' are dynamic (spawn/move/
  // despawn during play, or track a gliding player), unlike the static
  // world-built campfire/forge set; see src/render/rift_ambience.ts.
  readonly kind: 'campfire' | 'forge' | 'rift_portal' | 'rift_roller' | 'rift_ice_glide';
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
  /** Windup/loop/winddown engine audio for a mount with a dedicated take set
   *  (see src/game/mount_engine_state.ts); call every frame a rider is
   *  mounted and grounded. Returns true when `mountKey` actually has an
   *  engine take set, so the caller can skip mountRun's gait beat for it;
   *  false means fall back to the ordinary per-stride mountRun cue instead. */
  mountEngine(
    x: number,
    y: number,
    z: number,
    mountKey: string,
    moving: boolean,
    entityId: number,
  ): boolean;
  /** Drop an entity's mountEngine state and silence its loop (dismount,
   *  interest culled, disconnect). */
  mountEngineReset(entityId: number): void;
  /** Warm a mount's engine clips (windup/loop/winddown) ahead of first use,
   *  e.g. on the mountKey transition that also calls mountEngineReset. A
   *  no-op for a mount with no engine take set. */
  preloadMountEngine(mountKey: string): void;
  /** A discrete movement event (jump / land / water entry / swim stroke). */
  movement(
    kind: 'jump' | 'land' | 'splash' | 'swim',
    x: number,
    y: number,
    z: number,
    self: boolean,
  ): void;
  /** Lich Form entry, ambient pulse, and a sacrificed soul reaching its owner. */
  necromancy(
    kind: 'lichTransform' | 'lichHeartbeat' | 'soulConsume',
    x: number,
    y: number,
    z: number,
    self: boolean,
    sourceId?: number,
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
  /** A fixed-duration ground zone loop (Blizzard's storm): starts `key`
   *  looping at (x,y,z) and auto-stops after `duration` seconds. `id`
   *  discriminates concurrent zones (e.g. two mages both casting Blizzard);
   *  a fresh call with the same id restarts the timer at the new position,
   *  matching a zone that just landed again. No-op for a key with no clip. */
  timedGroundLoop(id: string, key: string, x: number, y: number, z: number, duration: number): void;
}
