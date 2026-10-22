// The spatial-audio half of the renderer's per-frame camera update: seat the
// listener at the camera facing the eye point, then feed the ambience state
// (biome, dungeon, precipitation, water, point sources) from that eye.
// Extracted from renderer.ts updateCamera unchanged so the camera code could
// take the first-person hook without growing the coordinator.

import type * as THREE from 'three';
import type { Entity } from '../sim/types';
import { type createAmbienceState, sampleAmbienceInto } from './ambience_state_core';
import type { AmbientPointSource, SpatialAudioSink } from './audio_sink';
import type { DynamicEntityAmbienceSources } from './dynamic_entity_ambience';

/** The renderer members this reads. They are private on Renderer, so the call
 *  site passes `this` untyped (the vehicle_camera_core.ts host shape). */
interface CameraAudioHost {
  audioSink: SpatialAudioSink | null;
  camera: THREE.Camera;
  ambience: ReturnType<typeof createAmbienceState>;
  weatherOn: boolean;
  sim: {
    cfg: { seed: number };
    player: { pos: { x: number } };
    entities: ReadonlyMap<number, Entity>;
    entityRosterVersion: number;
  };
  riftAmbience: DynamicEntityAmbienceSources;
  riftAmbienceScratch: AmbientPointSource[];
  ambientPointSources: readonly AmbientPointSource[];
  ambientPointsMergedScratch: AmbientPointSource[];
}

/** Listener at the camera, facing `eye` (the avatar eye), plus ambience. */
export function updateCameraAudioListener(host: object, eye: THREE.Vector3): void {
  const h = host as CameraAudioHost;
  const sink = h.audioSink;
  if (!sink) return;
  const cpx = h.camera.position.x,
    cpy = h.camera.position.y,
    cpz = h.camera.position.z;
  const fx = eye.x - cpx,
    fy = eye.y - cpy,
    fz = eye.z - cpz;
  const fl = Math.hypot(fx, fy, fz) || 1;
  sink.setListener(cpx, cpy, cpz, fx / fl, fy / fl, fz / fl);
  const amb = sampleAmbienceInto(h.ambience, eye.x, eye.z, h.sim.cfg.seed, h.weatherOn);
  h.riftAmbience.collect(h.sim, h.sim.player.pos.x, h.riftAmbienceScratch);
  // Early-out: no live rift ambience this frame, so skip building the
  // merged array entirely and hand the static set straight through.
  let points: readonly AmbientPointSource[] = h.ambientPointSources;
  if (h.riftAmbienceScratch.length > 0) {
    h.ambientPointsMergedScratch.length = 0;
    for (const p of h.ambientPointSources) h.ambientPointsMergedScratch.push(p);
    for (const p of h.riftAmbienceScratch) h.ambientPointsMergedScratch.push(p);
    points = h.ambientPointsMergedScratch;
  }
  sink.ambience(amb.biome, amb.inDungeon, amb.precip, amb.nearWater, 0, points, eye);
}
