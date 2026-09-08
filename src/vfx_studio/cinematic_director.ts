import type { SimEvent } from '../sim/types';
import { CINEMATIC_SCORES, type CinematicScore, cinematicEnvelope } from './cinematic_score_core';

interface Camera {
  camDist: number;
  camPitch: number;
  camYaw: number;
  punchFov(degrees: number): void;
}
/** Additive camera strokes keep user framing intact and use playback time,
 * including single-step. Gather follows real casts; contact follows the local player's visible impact. */
export class StudioCinematicDirector {
  private score: CinematicScore | null = null;
  private phase: 'gather' | 'release' | 'impact' = 'gather';
  private age = 0;
  private duration = 1;
  private distance = 0;
  private pitch = 0;
  private yaw = 0;
  private cooldown = 0;
  event(event: SimEvent, playerId: number, _camera: Camera): void {
    if (event.type === 'castStop' && event.entityId === playerId && !event.success) {
      this.phase = 'release';
      this.age = 0;
      this.duration = 0.2;
      return;
    }
    if (event.type !== 'castStart' || event.entityId !== playerId) return;
    const score = CINEMATIC_SCORES[event.ability];
    if (!score) return;
    this.score = score;
    this.phase = 'gather';
    this.age = 0;
    this.duration = Math.max(0.3, event.time);
  }
  moment(
    id: string,
    phase: 'release' | 'impact',
    sourceId: number,
    playerId: number,
    camera: Camera,
  ): void {
    const score = CINEMATIC_SCORES[id];
    if (sourceId !== playerId || !score) return;
    if (phase === 'impact' && this.cooldown > 0) return;
    if (phase === 'release' && this.phase === 'impact' && this.cooldown > 0) return;
    this.score = score;
    this.phase = phase;
    this.age = 0;
    this.duration = phase === 'release' ? 0.28 : score.settle;
    if (phase === 'impact') {
      this.cooldown = 0.35;
      camera.punchFov(score.lens);
    } else if (phase === 'release') camera.punchFov(-Math.abs(score.lens) * 0.24);
  }
  update(dt: number, camera: Camera, enabled: boolean): void {
    camera.camDist -= this.distance;
    camera.camPitch -= this.pitch;
    camera.camYaw -= this.yaw;
    this.distance = this.pitch = this.yaw = 0;
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.cooldown = Math.max(0, this.cooldown - step);
    if (!enabled) {
      this.score = null;
      this.cooldown = 0;
      return;
    }
    if (!this.score) return;
    this.age += step;
    if (this.age >= this.duration && this.phase !== 'gather') {
      this.score = null;
      return;
    }
    const envelope = cinematicEnvelope(this.phase, this.age, this.duration),
      score = this.score;
    this.distance = (this.phase === 'impact' ? score.recoil : score.gather) * envelope;
    this.pitch = score.lift * envelope * (this.phase === 'gather' ? 0.35 : 1);
    this.yaw = score.orbit * envelope;
    camera.camDist += this.distance;
    camera.camPitch += this.pitch;
    camera.camYaw += this.yaw;
  }
  clear(camera: Camera | null): void {
    if (camera) {
      camera.camDist -= this.distance;
      camera.camPitch -= this.pitch;
      camera.camYaw -= this.yaw;
    }
    this.distance = this.pitch = this.yaw = this.cooldown = 0;
    this.score = null;
  }
}
