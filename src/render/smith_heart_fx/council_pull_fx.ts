// The Hammer Council's pull beat (the plan: council_pull_fx_core.ts), a part
// of CouncilFx: on each member's pull cue (COUNCIL_CUES.pull) its one-shot
// through the gesture seam, then at the blow a shockwave over the floor, the
// hot ring, a wall of dust, thrown rock and the camera's thud near it, the
// beat's sounds on their moments. Fixed slots (two members), the host's own
// particles and debris (no GPU producer of its own), no allocation a frame.

import { councilRoleOf } from '../../sim/encounters/smith_heart/council_ids';
import { fxAnchor } from '../attached_fx_anchor';
import type { CouncilFxHost } from './council_pillars_fx';
import { COUNCIL_PULL_BEAT, PULL_BEAT_SECONDS, pullCrossed } from './council_pull_fx_core';

export interface PullSoundSink {
  playAt(
    key: string,
    x: number,
    y: number,
    z: number,
    opts?: { gain?: number; rate?: number; cooldown?: number; priority?: boolean },
  ): boolean;
  preload?(key: string): void;
}

interface BeatSlot {
  id: number;
  role: 'guardian' | 'singer';
  born: number;
  last: number;
}

const DUST = {
  speed: 7,
  up: 1.2,
  life: 1.8,
  size: [2.2, 5] as const,
  color: [0.62, 0.52, 0.4] as const,
  alpha: 0.42,
  drag: 2.2,
};
const MOTE = {
  speed: 1.2,
  up: 3.2,
  life: 1.4,
  size: [0.35, 0.1] as const,
  color: [1, 0.84, 0.5] as const,
  alpha: 0.9,
  pool: 'glow' as const,
};

export class CouncilPullFx {
  private readonly beats: BeatSlot[] = [];

  constructor(
    private readonly h: CouncilFxHost,
    private readonly sound: PullSoundSink,
    private readonly gesture?: (entityId: number, gesture: string) => void,
  ) {
    for (let i = 0; i < 2; i++) this.beats.push({ id: -1, role: 'guardian', born: 0, last: 0 });
  }

  /** A member's pull cue arrived. */
  cue(entityId: number): void {
    const e = this.h.entity(entityId);
    const role = e ? councilRoleOf(e.templateId) : null;
    if (!e || !role) return;
    const slot =
      this.beats.find((b) => b.id === entityId) ??
      this.beats.find((b) => b.id < 0) ??
      this.beats[0];
    slot.id = entityId;
    slot.role = role;
    slot.born = this.h.now();
    slot.last = -1e-6;
    // Its blow is a breath away: fetch its samples now (cached after).
    for (const s of COUNCIL_PULL_BEAT[role].sounds) this.sound.preload?.(s.key);
    this.gesture?.(entityId, COUNCIL_PULL_BEAT[role].gesture);
  }

  update(): void {
    const now = this.h.now();
    for (const b of this.beats) {
      if (b.id < 0) continue;
      const t = now - b.born;
      const e = this.h.entity(b.id);
      if (!e || e.dead || t > PULL_BEAT_SECONDS) {
        b.id = -1;
        continue;
      }
      const spec = COUNCIL_PULL_BEAT[b.role];
      const at = fxAnchor(e);
      const y = this.h.groundY(at.x, at.z);
      for (const s of spec.sounds) {
        if (!pullCrossed(b.last, t, s.at)) continue;
        this.sound.playAt(s.key, at.x, y + 1.5, at.z, {
          gain: s.gain,
          rate: s.rate,
          cooldown: 0.1,
          priority: true,
        });
      }
      if (pullCrossed(b.last, t, spec.impactAt)) this.blow(b.role, at.x, y, at.z);
      b.last = t;
    }
  }

  private blow(role: 'guardian' | 'singer', x: number, y: number, z: number): void {
    const spec = COUNCIL_PULL_BEAT[role];
    const h = this.h;
    const reduced = h.reducedMotion();
    h.particles.shockRing(x, z, spec.hotColor, spec.hot, 0.35);
    h.particles.shockRing(x, z, spec.waveColor, spec.wave, 1.15);
    if (role === 'singer') h.particles.shockRing(x, z, spec.hotColor, spec.wave * 0.62, 0.8);
    h.particles.puff(x, y + 0.5, z, Math.round(spec.dust * h.density), DUST);
    if (role === 'singer') h.particles.puff(x, y + 2, z, Math.round(24 * h.density), MOTE);
    const n = Math.round(spec.rock * h.density * (reduced ? 0.5 : 1));
    for (let i = 0; i < n; i++) {
      const a = h.rand() * Math.PI * 2;
      const sp = 5 + h.rand() * 11;
      h.debris.throw(
        x + Math.sin(a) * 1.5,
        y + 0.8,
        z + Math.cos(a) * 1.5,
        Math.sin(a) * sp,
        6 + h.rand() * 8,
        Math.cos(a) * sp,
        0.35 + h.rand() * 0.9,
      );
    }
    if (!reduced) h.shakeNear(x, z, spec.shake, spec.shakeReach);
  }

  /** Beats running (the tests read it). */
  running(): number {
    return this.beats.filter((b) => b.id >= 0).length;
  }
}
