import { HOARD_TIDE_WAVE_LEAD_SEC, hoardTideWaveCenter } from '../sim/rift/hoard_boss_kits';
import type { HoardBossCueView } from '../world_api/dungeons';

export interface HoardTideAudioSink {
  playAt(
    key: string,
    x: number,
    y: number,
    z: number,
    opts?: { gain?: number; cooldown?: number; rate?: number },
  ): boolean;
  loop(
    id: string,
    key: string,
    target: number,
    x?: number,
    y?: number,
    z?: number,
    maxDistance?: number,
    immediate?: boolean,
  ): void;
  unloop(id: string, fade?: number): void;
}

interface Voice {
  instanceId: number;
  cueId: number;
  loopId: string;
  seen: boolean;
  moving: boolean;
  x: number;
  z: number;
  endX: number;
  endZ: number;
  expiresAtMs: number;
}

/** Cue-owned spatial audio, with bounded voices and no timers or per-frame allocations. */
export class HoardTideAudio {
  private readonly voices: Voice[] = [];
  constructor(
    private readonly sink: HoardTideAudioSink,
    private readonly nowMs: () => number = () => performance.now(),
  ) {}

  sync(cues: readonly HoardBossCueView[], groundY = 0): void {
    const now = this.nowMs();
    for (const voice of this.voices) voice.seen = false;
    for (const cue of cues) {
      if (cue.variant !== 'tide-wave' || cue.kind !== 'sweep') continue;
      let voice: Voice | undefined;
      for (const candidate of this.voices) {
        if (candidate.instanceId === cue.instanceId && candidate.cueId === cue.cueId) {
          voice = candidate;
          break;
        }
      }
      const lead = cue.waveLead ?? HOARD_TIDE_WAVE_LEAD_SEC;
      const elapsed = Math.max(0, cue.total - cue.remaining);
      const moving = elapsed >= lead;
      const facing = cue.facing ?? 0;
      const dx = Math.sin(facing);
      const dz = Math.cos(facing);
      if (!voice) {
        if (this.voices.length >= 8) continue;
        voice = {
          instanceId: cue.instanceId,
          cueId: cue.cueId,
          loopId: `hoard-tide:${cue.instanceId}:${cue.cueId}`,
          seen: true,
          moving,
          x: cue.x,
          z: cue.z,
          endX: cue.x + dx * cue.radius * 0.5,
          endZ: cue.z + dz * cue.radius * 0.5,
          expiresAtMs: now + cue.remaining * 1000,
        };
        this.voices.push(voice);
        // Joining an already moving wave never replays the warning roar.
        if (!moving)
          this.sink.playAt(
            'hoard_tide_build',
            cue.x - dx * cue.radius * 0.5,
            groundY,
            cue.z - dz * cue.radius * 0.5,
            { gain: 0.65, cooldown: 0, rate: 2.4 / Math.max(0.1, lead) },
          );
      }
      voice.seen = true;
      voice.moving = moving;
      voice.expiresAtMs = now + cue.remaining * 1000;
      const center = hoardTideWaveCenter(cue.radius, cue.remaining, cue.total, lead);
      voice.x = cue.x + dx * center;
      voice.z = cue.z + dz * center;
      if (moving)
        this.sink.loop(
          voice.loopId,
          'hoard_tide_rush',
          0.48,
          voice.x,
          groundY + 1,
          voice.z,
          55,
          true,
        );
    }
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const voice = this.voices[i];
      if (voice.seen) continue;
      this.sink.unloop(voice.loopId, 0.12);
      // One simulation tick of tolerance covers snapshot rounding. A slow render
      // frame must still crash at expiry; an early encounter cancellation stays silent.
      if (voice.moving && now + 50 >= voice.expiresAtMs)
        this.sink.playAt('hoard_tide_crash', voice.endX, groundY, voice.endZ, {
          gain: 0.8,
          cooldown: 0,
        });
      this.voices.splice(i, 1);
    }
  }

  hit(x: number, y: number, z: number): void {
    this.sink.playAt('hoard_tide_hit', x, y, z, { gain: 0.72, cooldown: 0.08 });
  }

  dispose(): void {
    for (const voice of this.voices) this.sink.unloop(voice.loopId, 0.1);
    this.voices.length = 0;
  }
}
