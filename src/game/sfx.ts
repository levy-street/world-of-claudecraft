// Spatial sound-effect engine. Plays the generated ElevenLabs clips
// (public/audio/sfx, see scripts/gen_sfx.mjs + docs/design/sound_effects.md) as
// positioned 3D audio so other players' / creatures' footsteps and combat
// attenuate with distance and pan with direction relative to the camera.
//
// Decoupled, like audio/music/voice: its own AudioContext + AudioListener,
// driven by the `sfxVolume` setting. Efficient by construction — one decoded
// AudioBuffer per clip shared across every source, a hard concurrency cap, a
// per-key cooldown, and a tiny pool of persistent looping sources for ambience
// and sustained spell casts (cross-faded by gain, never restarted).

import type { BiomeId } from '../sim/types';
import { SFX_CLIPS } from './sfx_manifest.generated';

const SAMPLE_GAIN = 0.85; // base level for sampled clips; sfxVolume multiplies this
const MAX_VOICES = 24; // concurrent one-shot sources (frame-budget guard)
const REF_DISTANCE = 5; // world units at which a sound is at full volume
const MAX_DISTANCE = 46; // hard cutoff: beyond this, sources are silent/skipped
const MAX_DISTANCE_SQ = MAX_DISTANCE * MAX_DISTANCE;

export interface PlayOpts {
  gain?: number; // 0..1 multiplier (default 1)
  rate?: number; // playback-rate multiplier (default 1); ±6% jitter added
  cooldown?: number; // min seconds between plays of this key (default 0.03)
  jitter?: boolean; // randomize rate/gain slightly (default true)
  // Percussive amplitude envelope. `release` truncates the clip to a crisp
  // transient that fully decays within `attack + release` seconds — used by fast
  // retriggered sounds (footsteps) so successive plays of the same sample don't
  // pile up and comb-filter into a metallic ring. 0 (default) plays the clip flat.
  attack?: number; // fade-in seconds (default 0 = instant)
  release?: number; // fade-out seconds; the clip is stopped once it ends
}

interface LoopSlot {
  key: string;
  src: AudioBufferSourceNode;
  gain: GainNode;
  panner: PannerNode | null;
  target: number; // last commanded gain — skip re-arming the ramp when unchanged
}

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private vol = 0.8;
  private active = 0;
  private lastPlay = new Map<string, number>();
  private loops = new Map<string, LoopSlot>();
  private ready = false;
  private footstepsOn = false; // off by default; driven by the footstepSfx setting
  private lx = 0;
  private ly = 0;
  private lz = 0; // cached listener position

  /** Set SFX volume (0..1). Shares the `sfxVolume` slider with `audio`. */
  setVolume(v: number): void {
    this.vol = Math.min(1, Math.max(0, v));
    if (this.master) this.master.gain.value = SAMPLE_GAIN * this.vol;
  }

  /** Enable/disable per-footfall step clips. Off by default (the `footstepSfx`
   *  setting): while off, `footstep()` is a silent no-op for self and other
   *  entities alike. Jump/land/splash/swim and combat SFX are unaffected. */
  setFootstepsEnabled(on: boolean): void {
    this.footstepsOn = on;
  }

  /** Create the context + listener and decode every clip. Gated on a user gesture
   *  (called from enterWorld alongside audio.init()). Safe to call repeatedly. */
  init(): void {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = SAMPLE_GAIN * this.vol;
      this.master.connect(this.ctx.destination);
      void this.ctx.resume?.().catch(() => {
        /* resumes on the next gesture */
      });
      const l = this.ctx.listener;
      if (l.upX) {
        l.upX.value = 0;
        l.upY.value = 1;
        l.upZ.value = 0;
      } else if (l.setOrientation) l.setOrientation(0, 0, -1, 0, 1, 0);
      void this.preload();
    } catch {
      this.ctx = null;
    }
  }

  private async preload(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    await Promise.all(
      Object.entries(SFX_CLIPS).map(async ([key, entry]) => {
        try {
          const res = await fetch(entry.url);
          if (!res.ok) return;
          const buf = await ctx.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(key, buf);
        } catch {
          /* missing/corrupt clip: that key just stays silent */
        }
      }),
    );
    this.ready = this.buffers.size > 0;
  }

  /** Position + forward vector of the listener (camera), once per frame. */
  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.lx = x;
    this.ly = y;
    this.lz = z;
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = x;
      l.positionY.value = y;
      l.positionZ.value = z;
      l.forwardX.value = fx;
      l.forwardY.value = fy;
      l.forwardZ.value = fz;
    } else if (l.setPosition) {
      l.setPosition(x, y, z);
      if (l.setOrientation) l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  private setPannerPos(p: PannerNode, x: number, y: number, z: number): void {
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else if (p.setPosition) p.setPosition(x, y, z);
  }

  private makePanner(x: number, y: number, z: number): PannerNode {
    const p = this.ctx!.createPanner();
    p.panningModel = 'equalpower'; // cheap; HRTF is overkill for an MMO crowd
    p.distanceModel = 'linear';
    p.refDistance = REF_DISTANCE;
    p.maxDistance = MAX_DISTANCE;
    p.rolloffFactor = 1;
    this.setPannerPos(p, x, y, z);
    return p;
  }

  /** Squared distance from the listener — callers can pre-cull, but playAt also
   *  guards internally so a far event is a cheap no-op. */
  private tooFar(x: number, z: number): boolean {
    const dx = x - this.lx,
      dz = z - this.lz;
    return dx * dx + dz * dz > MAX_DISTANCE_SQ;
  }

  /** Positional one-shot at world (x,y,z). */
  playAt(key: string, x: number, y: number, z: number, opts?: PlayOpts): void {
    const ctx = this.ctx,
      master = this.master;
    if (!ctx || !master) return;
    if (this.tooFar(x, z)) return;
    const buf = this.buffers.get(key);
    if (!buf || this.active >= MAX_VOICES) return;
    const now = ctx.currentTime;
    const cd = opts?.cooldown ?? 0.03;
    if (now - (this.lastPlay.get(key) ?? -1) < cd) return;
    this.lastPlay.set(key, now);

    const jitter = opts?.jitter !== false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (opts?.rate ?? 1) * (jitter ? 1 + (Math.random() * 2 - 1) * 0.06 : 1);
    const g = ctx.createGain();
    const peak = (opts?.gain ?? 1) * (jitter ? 1 + (Math.random() * 2 - 1) * 0.1 : 1);
    const panner = this.makePanner(x, y, z);
    src.connect(g).connect(panner).connect(master);
    this.active++;
    src.onended = () => {
      this.active--;
      src.disconnect();
      g.disconnect();
      panner.disconnect();
    };
    this.applyEnvelope(src, g, peak, now, opts);
  }

  /** Set the gain envelope on a one-shot source and start it. With no
   *  attack/release this is a flat play at `peak`; with a `release` the source is
   *  shaped into a short transient and stopped early so rapid retriggers of the
   *  same clip can't overlap and comb-filter. */
  private applyEnvelope(
    src: AudioBufferSourceNode,
    g: GainNode,
    peak: number,
    now: number,
    opts?: PlayOpts,
  ): void {
    const attack = Math.max(0, opts?.attack ?? 0);
    const release = Math.max(0, opts?.release ?? 0);
    if (attack === 0 && release === 0) {
      g.gain.value = peak;
      src.start();
      return;
    }
    const a = Math.max(0.001, attack);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(peak, now + a);
    src.start();
    if (release > 0) {
      // Effective clip length at this playback rate; never schedule past it.
      const clip = src.buffer ? src.buffer.duration / (src.playbackRate.value || 1) : a + release;
      const end = Math.min(now + clip, now + a + release);
      g.gain.setTargetAtTime(0.0001, Math.max(now + a, end - release), release / 3);
      try {
        src.stop(end + 0.03);
      } catch {
        /* stop unsupported in stub */
      }
    }
  }

  /** Non-positional one-shot (personal/UI sounds that shouldn't pan). */
  playUi(key: string, opts?: PlayOpts): void {
    const ctx = this.ctx,
      master = this.master;
    if (!ctx || !master) return;
    const buf = this.buffers.get(key);
    if (!buf || this.active >= MAX_VOICES) return;
    const jitter = opts?.jitter !== false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (opts?.rate ?? 1) * (jitter ? 1 + (Math.random() * 2 - 1) * 0.05 : 1);
    const g = ctx.createGain();
    g.gain.value = opts?.gain ?? 1;
    src.connect(g).connect(master);
    this.active++;
    src.onended = () => {
      this.active--;
      src.disconnect();
      g.disconnect();
    };
    src.start();
  }

  // --- Looping sources (ambience + sustained casts) ------------------------
  // Keyed by a caller-chosen id so the same logical loop (e.g. a biome wind, or
  // one caster's channel) is reused and cross-faded rather than restarted.

  /** Ensure a loop `id` is playing `key` at `target` gain; (x,y,z) makes it
   *  positional. Ramps gain smoothly; creating from scratch fades in from 0. */
  loop(id: string, key: string, target: number, x?: number, y?: number, z?: number): void {
    const ctx = this.ctx,
      master = this.master;
    if (!ctx || !master) return;
    const positional = x !== undefined;
    let slot = this.loops.get(id);
    if (slot && slot.key !== key) {
      this.unloop(id, 0);
      slot = undefined;
    }
    if (!slot) {
      const buf = this.buffers.get(key);
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0;
      const panner = positional ? this.makePanner(x!, y!, z!) : null;
      if (panner) src.connect(g).connect(panner).connect(master);
      else src.connect(g).connect(master);
      src.start();
      slot = { key, src, gain: g, panner, target: -1 };
      this.loops.set(id, slot);
    } else if (positional && slot.panner) {
      this.setPannerPos(slot.panner, x!, y!, z!);
    }
    // Only (re)arm the ramp when the target actually changes — loop() is called
    // every frame for active ambience, so this keeps the hot path allocation-free.
    if (slot.target !== target) {
      slot.target = target;
      slot.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.25);
    }
  }

  /** Fade a loop out and free it. */
  unloop(id: string, fade = 0.4): void {
    const slot = this.loops.get(id);
    const ctx = this.ctx;
    if (!slot || !ctx) return;
    this.loops.delete(id);
    if (fade <= 0) {
      try {
        slot.src.stop();
      } catch {
        /* already stopped */
      }
      slot.src.disconnect();
      slot.gain.disconnect();
      slot.panner?.disconnect();
      return;
    }
    slot.gain.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
    const src = slot.src;
    setTimeout(
      () => {
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
        src.disconnect();
        slot.gain.disconnect();
        slot.panner?.disconnect();
      },
      fade * 1000 + 200,
    );
  }

  hasLoop(id: string): boolean {
    return this.loops.has(id);
  }

  // --- SpatialAudioSink surface (driven by the renderer) -------------------
  // Implemented here so the surface→clip and ambience→loop mappings live in one
  // place; the renderer depends only on the SpatialAudioSink interface.

  /** One footfall. `surface` ∈ grass|dirt|stone|wood|snow|water → foot_<surface>.
   *  Footsteps fire every ~0.22s at a run but the clips are ~0.48s, so a flat
   *  retrigger would overlap two pitch-jittered copies of one sample and
   *  comb-filter into a metallic "jingle". Two fixes: a short `release` shapes
   *  each footfall into a transient that decays before the next, and alternating
   *  the pitch per step reads as two distinct feet rather than one looping sample. */
  footstep(
    x: number,
    y: number,
    z: number,
    surface: string,
    running: boolean,
    _self: boolean,
  ): void {
    if (!this.footstepsOn) return; // silenced by default (footstepSfx setting)
    this.footTick = (this.footTick + 1) & 1;
    const foot = this.footTick === 0 ? 0.97 : 1.04; // left/right
    this.playAt(`foot_${surface}`, x, y, z, {
      gain: running ? 0.8 : 0.55,
      rate: (running ? 1.06 : 1) * foot,
      cooldown: 0.05,
      release: running ? 0.17 : 0.22, // < the tightest stride gap (~0.22s at run)
    });
  }
  private footTick = 0;

  /** Jump / land / water-entry / swim-stroke. */
  movement(
    kind: 'jump' | 'land' | 'splash' | 'swim',
    x: number,
    y: number,
    z: number,
    _self: boolean,
  ): void {
    const key =
      kind === 'jump'
        ? 'move_jump'
        : kind === 'land'
          ? 'move_land'
          : kind === 'splash'
            ? 'move_splash'
            : 'move_swim';
    this.playAt(key, x, y, z, { gain: kind === 'swim' ? 0.5 : 0.7, cooldown: 0.08 });
  }

  private ambient(key: string, target: number): void {
    if (target > 0) this.loop(key, key, target);
    else if (this.loops.has(key)) this.unloop(key, 0.7);
  }

  /** Cross-fade the global ambience loops to match the player's surroundings.
   *  These are continuous background beds, kept well under the foreground
   *  footstep/jump/combat one-shots so movement always reads clearly over them. */
  ambience(
    biome: BiomeId,
    inDungeon: boolean,
    precip: 'snow' | 'rain' | null,
    nearWater: boolean,
  ): void {
    this.ambient('amb_dungeon', inDungeon ? 0.3 : 0);
    this.ambient('amb_wind_vale', !inDungeon && (biome === 'vale' || biome === 'beach') ? 0.12 : 0);
    this.ambient('amb_birds', !inDungeon && biome === 'vale' ? 0.1 : 0);
    this.ambient(
      'amb_wind_marsh',
      !inDungeon && (biome === 'marsh' || biome === 'cave') ? 0.13 : 0,
    );
    this.ambient(
      'amb_wind_peaks',
      !inDungeon && (biome === 'peaks' || biome === 'desert' || biome === 'volcano') ? 0.18 : 0,
    );
    this.ambient('amb_rain', precip === 'rain' ? 0.11 : 0); // sharp clip — kept very low
    this.ambient('amb_snow', precip === 'snow' ? 0.13 : 0);
    this.ambient('amb_water', nearWater ? 0.18 : 0);
  }
}

export const sfx = new Sfx();
