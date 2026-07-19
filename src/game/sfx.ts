// Spatial sound-effect engine. Plays the generated ElevenLabs clips
// (public/audio/sfx, see scripts/gen_sfx.mjs + docs/design/sound_effects.md) as
// positioned 3D audio so other players' / creatures' footsteps and combat
// attenuate with distance and pan with direction relative to the camera.
//
// Decoupled, like audio/music/voice: its own AudioContext + AudioListener,
// driven by the `sfxVolume` setting. Efficient by construction: one decoded
// AudioBuffer per clip shared across every source, startup-only preloading with
// lazy context loads, a hard concurrency cap, a per-key cooldown, and a tiny
// pool of persistent looping sources for ambience and sustained spell casts.

import { apiUrl } from '../client_origin';
import type { BiomeId } from '../sim/types';
import {
  SFX_CATALOG_HASH,
  SFX_CLIPS,
  SFX_RUNTIME_PACK_URL,
  type SfxEntry,
} from './sfx_manifest.generated';
import { loadRuntimeSfxPack } from './sfx_runtime_pack';
import { type WaterElementalCue, waterElementalSamples } from './water_elemental_audio';

const SAMPLE_GAIN = 0.85; // base level for sampled clips; sfxVolume multiplies this
const MAX_VOICES = 24; // concurrent one-shot sources (frame-budget guard)
const REF_DISTANCE = 5; // world units at which a sound is at full volume
const MAX_DISTANCE = 46; // hard cutoff: beyond this, sources are silent/skipped
const MAX_DISTANCE_SQ = MAX_DISTANCE * MAX_DISTANCE;
const POINT_AMBIENCE_GAIN = 0.18;
const FOOTSTEP_CUES: Partial<Record<string, string>> = {
  grass: 'foot_grass',
  dirt: 'foot_dirt',
  stone: 'foot_stone',
  wood: 'foot_wood',
  snow: 'foot_snow',
  water: 'foot_water',
};

function assetCacheKey(key: string, variantIndex: number): string {
  return variantIndex === 0 ? key : `${key}:${variantIndex}`;
}

function retainDecodedBuffer(
  ctx: AudioContext,
  decoded: AudioBuffer,
  spatial: boolean,
): AudioBuffer {
  if (!spatial || !(decoded.numberOfChannels > 1)) return decoded;
  const mono = ctx.createBuffer(1, decoded.length, decoded.sampleRate);
  const output = mono.getChannelData(0);
  const scale = 1 / decoded.numberOfChannels;
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const input = decoded.getChannelData(channel);
    for (let frame = 0; frame < decoded.length; frame++) output[frame] += input[frame] * scale;
  }
  return mono;
}

export interface PlayOpts {
  gain?: number; // 0..1 multiplier (default 1)
  rate?: number; // playback-rate multiplier (default 1); ±6% jitter added
  cooldown?: number; // min seconds between plays of this key (default 0.03)
  jitter?: boolean; // randomize rate/gain slightly (default true)
  // Percussive amplitude envelope. `release` truncates the clip to a crisp
  // transient that fully decays within `attack + release` seconds, used by fast
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
  target: number; // last commanded gain; skip re-arming the ramp when unchanged
  x?: number;
  y?: number;
  z?: number;
}

interface PendingLoop {
  key: string;
  target: number;
  x?: number;
  y?: number;
  z?: number;
}

interface AmbientPointSource {
  readonly id: string;
  readonly kind: 'campfire' | 'forge';
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private clips: Record<string, SfxEntry> = SFX_CLIPS;
  private clipsReady: Promise<void> | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private failedLoads = new Set<string>();
  private pendingOneShots = new Set<string>();
  private lastVariant = new Map<string, number>(); // last played index per key (no-repeat-biased random)
  private pendingLoops = new Map<string, PendingLoop>();
  private pendingLoopLoads = new Map<string, string>();
  private pendingLoopVariants = new Map<string, number>();
  private vol = 0.8;
  private active = 0;
  private lastPlay = new Map<string, number>();
  private loops = new Map<string, LoopSlot>();
  private footstepsOn = false; // off by default; driven by the footstepSfx setting
  private lx = 0;
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

  /** Create the context + listener and decode the small startup working set.
   *  Context-specific clips load once on first use. Gated on a user gesture
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
      this.installProceduralBuffers();
      if (typeof window !== 'undefined') {
        this.clipsReady = loadRuntimeSfxPack(
          apiUrl(SFX_RUNTIME_PACK_URL),
          SFX_CATALOG_HASH,
          SFX_CLIPS,
        ).then((clips) => {
          this.clips = clips;
        });
      }
      void this.preloadStartup();
    } catch {
      this.ctx = null;
    }
  }

  private entry(key: string): SfxEntry | undefined {
    return this.clips[key];
  }

  private authoredPlaybackRate(key: string): number {
    return this.entry(key)?.playbackRate ?? 1;
  }

  // Weighted so the immediately previous variant is heavily deprioritized, not
  // outright excluded. A hard exclusion on a 2-take pool degenerates into rigid
  // A-B-A-B alternation, which reads as just as metronomic as the round-robin
  // it replaces; a low but nonzero weight keeps a small pool sounding genuinely
  // random while still making an audible back-to-back repeat rare.
  private static readonly REPEAT_VARIANT_WEIGHT = 0.15;

  /** No-repeat-biased random variant selection. Picks a weighted-random usable
   *  variant each play; the immediately previous one is downweighted (not
   *  excluded) so it can still recur occasionally, just rarely, instead of
   *  double-hitting on a predictable cadence. A variant that failed to load is
   *  skipped entirely, same as the old round-robin scan. */
  private nextVariantIndex(key: string): number {
    const count = Math.max(1, this.entry(key)?.variants.length ?? 1);
    const usable: number[] = [];
    for (let index = 0; index < count; index++) {
      if (!this.failedLoads.has(assetCacheKey(key, index))) usable.push(index);
    }
    if (usable.length === 0) return 0;
    if (usable.length === 1) return usable[0];
    const last = this.lastVariant.get(key);
    const weights = usable.map((index) => (index === last ? Sfx.REPEAT_VARIANT_WEIGHT : 1));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < usable.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return usable[i];
    }
    return usable[usable.length - 1];
  }

  private commitVariant(key: string, variantIndex: number): void {
    this.lastVariant.set(key, variantIndex);
  }

  private loadBuffer(key: string, variantIndex = 0): Promise<AudioBuffer | null> {
    const ctx = this.ctx;
    const cacheKey = assetCacheKey(key, variantIndex);
    const cached = this.buffers.get(cacheKey);
    if (cached) return Promise.resolve(cached);
    if (this.failedLoads.has(cacheKey)) return Promise.resolve(null);
    const inFlight = this.loading.get(cacheKey);
    if (inFlight) return inFlight;
    if (!ctx) return Promise.resolve(null);
    const request = (async () => {
      try {
        if (this.clipsReady) await this.clipsReady;
        const entry = this.entry(key);
        const variant = entry?.variants[variantIndex];
        if (!entry || !variant) {
          this.failedLoads.add(cacheKey);
          return null;
        }
        const res = await fetch(variant.url);
        if (!res.ok) {
          this.failedLoads.add(cacheKey);
          return null;
        }
        const decoded = await ctx.decodeAudioData(await res.arrayBuffer());
        // Positional cues are intentional point sources. Fold them to mono so
        // PannerNode builds the spatial stereo image from one retained channel,
        // without another lossy asset transcode.
        const buf = retainDecodedBuffer(ctx, decoded, entry.spatial);
        this.buffers.set(cacheKey, buf);
        return buf;
      } catch {
        this.failedLoads.add(cacheKey);
        return null;
      } finally {
        this.loading.delete(cacheKey);
      }
    })();
    this.loading.set(cacheKey, request);
    return request;
  }

  private async preloadStartup(): Promise<void> {
    if (this.clipsReady) await this.clipsReady;
    await Promise.all(
      Object.keys(this.clips).flatMap((key) =>
        this.entry(key)?.preload === 'startup'
          ? (this.entry(key)?.variants ?? []).map((_variant, index) => this.loadBuffer(key, index))
          : [],
      ),
    );
  }

  private installProceduralBuffers(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      this.buffers.set('amb_crowd', this.makeCrowdBuffer(ctx, 6, false));
      this.buffers.set('vcup_crowd_roar', this.makeCrowdBuffer(ctx, 2.6, true));
      for (const cue of [
        'aggro',
        'attack',
        'death',
      ] as const satisfies readonly WaterElementalCue[]) {
        const samples = waterElementalSamples(cue, ctx.sampleRate);
        const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
        buffer.getChannelData(0).set(samples);
        this.buffers.set(`mob_water_elemental_${cue}`, buffer);
      }
    } catch {
      /* minimal AudioContext stubs may not implement buffer synthesis */
    }
  }

  /** Procedural crowd noise. Bed mode is a seamless 6s murmur loop (filtered
   *  noise under slow integer-cycle swells, so the wrap point is silent-clean);
   *  roar mode bakes a crescendo-decay envelope for a goal-roar one-shot. */
  private makeCrowdBuffer(ctx: AudioContext, seconds: number, roar: boolean): AudioBuffer {
    const sr = ctx.sampleRate;
    const len = Math.floor(seconds * sr);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let lpDeep = 0;
      let lpMid = 0;
      const phase = ch * 1.9;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        lpDeep += 0.026 * (w - lpDeep);
        lpMid += 0.11 * (w - lpMid);
        const t = i / len;
        const swell =
          0.62 +
          0.22 * Math.sin(2 * Math.PI * 3 * t + phase) +
          0.16 * Math.sin(2 * Math.PI * 7 * t + phase * 1.31);
        const voiceBand = (lpMid - lpDeep) * 0.9;
        let sample = (lpDeep * 2.2 + voiceBand) * swell;
        if (roar) {
          const envelope = t < 0.18 ? t / 0.18 : t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
          sample = (lpDeep * 1.6 + voiceBand * 2.4 + w * 0.06) * envelope * 1.5;
        }
        data[i] = Math.max(-1, Math.min(1, sample));
      }
      if (!roar) {
        const fade = Math.floor(0.25 * sr);
        for (let i = 0; i < fade; i++) {
          const amount = i / fade;
          data[len - fade + i] =
            data[len - fade + i] * Math.sqrt(1 - amount) + data[i] * Math.sqrt(amount);
        }
      }
    }
    return buf;
  }

  /** Position + forward vector of the listener (camera), once per frame. */
  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.lx = x;
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
    const ctx = this.ctx;
    if (!ctx) throw new Error('audio context is unavailable');
    const p = ctx.createPanner();
    p.panningModel = 'equalpower'; // cheap; HRTF is overkill for an MMO crowd
    p.distanceModel = 'linear';
    p.refDistance = REF_DISTANCE;
    p.maxDistance = MAX_DISTANCE;
    p.rolloffFactor = 1;
    this.setPannerPos(p, x, y, z);
    return p;
  }

  /** True when a compiled/runtime entry or procedural buffer exists. HUD uses
   *  this to prefer disk-discovered mob subfamily cues over family fallbacks. */
  hasVariants(key: string): boolean {
    if (this.buffers.has(key)) return true;
    const entry = this.entry(key);
    return !!entry?.variants.some(
      (_variant, index) => !this.failedLoads.has(assetCacheKey(key, index)),
    );
  }

  /** True when EVERY variant of a key is already decoded and resident, so a
   *  caller expecting playback THIS event (not a lazy-loaded 0.12s race) can
   *  check before playing, e.g. a rare crit-only cue that a warm-but-similar
   *  cue can fall back to on a cold cache. Checking only variant 0 would miss
   *  that playAt's round-robin cursor can land on a still-cold later variant. */
  isBuffered(key: string): boolean {
    const count = Math.max(1, this.entry(key)?.variants.length ?? 1);
    for (let index = 0; index < count; index++) {
      if (!this.buffers.has(assetCacheKey(key, index))) return false;
    }
    return true;
  }

  /** Fire-and-forget warm of EVERY variant of a key. Safe to call repeatedly;
   *  loadBuffer is idempotent once cached, in flight, or failed. Lets a
   *  frequently-triggered cue (e.g. a mob's attack bark) also warm a rare
   *  sibling cue (its hurt reaction) that would otherwise race a cold fetch
   *  the first time it is actually needed. */
  preload(key: string): void {
    const count = Math.max(1, this.entry(key)?.variants.length ?? 1);
    for (let index = 0; index < count; index++) void this.loadBuffer(key, index);
  }

  /** Squared distance from the listener. Callers can pre-cull, but playAt also
   *  guards internally so a far event is a cheap no-op. */
  private tooFar(x: number, z: number): boolean {
    const dx = x - this.lx,
      dz = z - this.lz;
    return dx * dx + dz * dz > MAX_DISTANCE_SQ;
  }

  /** Positional one-shot at world (x,y,z). Returns whether this call actually
   *  scheduled a sound: false if the audio context is not yet initialized,
   *  out of range, an unbuffered clip still loading, the voice cap, or a
   *  per-key cooldown block. A caller that only wants to know "did MY
   *  attempt make a sound, not some other source that beat me to this key's
   *  cooldown" (e.g. the mob idle-bark sweep's per-entity cooldown stamping,
   *  see src/ui/mob_idle_sfx.ts) needs this instead of firing blind. */
  playAt(key: string, x: number, y: number, z: number, opts?: PlayOpts): boolean {
    const ctx = this.ctx,
      master = this.master;
    if (!ctx || !master) return false;
    if (this.tooFar(x, z)) return false;
    const variantIndex = this.nextVariantIndex(key);
    const cacheKey = assetCacheKey(key, variantIndex);
    const buf = this.buffers.get(cacheKey);
    if (!buf) {
      if (!this.pendingOneShots.has(cacheKey)) {
        this.pendingOneShots.add(cacheKey);
        const requestedAt = ctx.currentTime;
        void this.loadBuffer(key, variantIndex).then((loaded) => {
          this.pendingOneShots.delete(cacheKey);
          if (loaded && this.ctx && this.ctx.currentTime - requestedAt < 0.12) {
            this.playAt(key, x, y, z, opts);
          }
        });
      }
      return false;
    }
    if (this.active >= MAX_VOICES) return false;
    const now = ctx.currentTime;
    const cd = opts?.cooldown ?? 0.03;
    // -Infinity, not -1: a fresh key (never played) must never be blocked, at
    // any cooldown length. A -1 sentinel worked by accident while every
    // cooldown here stayed under 1s (now - -1 was always >= cooldown); a
    // longer cooldown (e.g. audio.error()'s 1.5s) can make now - -1 itself
    // read as "still on cooldown" moments after AudioContext starts, wrongly
    // swallowing the very first play of that key.
    if (now - (this.lastPlay.get(key) ?? Number.NEGATIVE_INFINITY) < cd) return false;
    this.lastPlay.set(key, now);
    this.commitVariant(key, variantIndex);

    const jitter = opts?.jitter !== false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value =
      (opts?.rate ?? 1) *
      this.authoredPlaybackRate(key) *
      (jitter ? 1 + (Math.random() * 2 - 1) * 0.06 : 1);
    const g = ctx.createGain();
    const peak =
      (opts?.gain ?? 1) *
      (this.entry(key)?.gain ?? 1) *
      (jitter ? 1 + (Math.random() * 2 - 1) * 0.1 : 1);
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
    return true;
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
    const variantIndex = this.nextVariantIndex(key);
    const cacheKey = assetCacheKey(key, variantIndex);
    const buf = this.buffers.get(cacheKey);
    if (!buf) {
      if (!this.pendingOneShots.has(cacheKey)) {
        this.pendingOneShots.add(cacheKey);
        const requestedAt = ctx.currentTime;
        void this.loadBuffer(key, variantIndex).then((loaded) => {
          this.pendingOneShots.delete(cacheKey);
          if (loaded && this.ctx && this.ctx.currentTime - requestedAt < 0.25) {
            this.playUi(key, opts);
          }
        });
      }
      return;
    }
    if (this.active >= MAX_VOICES) return;
    const now = ctx.currentTime;
    const cd = opts?.cooldown ?? 0;
    // -Infinity sentinel: see the matching comment on playAt's cooldown check.
    if (cd > 0 && now - (this.lastPlay.get(key) ?? Number.NEGATIVE_INFINITY) < cd) return;
    // Unlike playAt (which always stamps lastPlay, since it defaults cd to
    // 0.03), playUi only stamps it when a cooldown was actually requested:
    // playUi's cooldown defaults to 0 (opt-in only, see the line above), so an
    // uncooled key has nothing to stamp against and no reason to pay the map
    // write. This is a deliberate difference in bookkeeping semantics for the
    // same shared map, not a bug.
    if (cd > 0) this.lastPlay.set(key, now);
    this.commitVariant(key, variantIndex);
    const jitter = opts?.jitter !== false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value =
      (opts?.rate ?? 1) *
      this.authoredPlaybackRate(key) *
      (jitter ? 1 + (Math.random() * 2 - 1) * 0.05 : 1);
    const g = ctx.createGain();
    g.gain.value = (opts?.gain ?? 1) * (this.entry(key)?.gain ?? 1);
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
    const positional = x !== undefined && y !== undefined && z !== undefined;
    let slot = this.loops.get(id);
    if (slot && slot.key !== key) {
      this.unloop(id, 0);
      slot = undefined;
    }
    if (!slot) {
      const pending = this.pendingLoops.get(id);
      const pendingVariant = pending?.key === key ? this.pendingLoopVariants.get(id) : undefined;
      const variantIndex = pendingVariant ?? this.nextVariantIndex(key);
      const cacheKey = assetCacheKey(key, variantIndex);
      const buf = this.buffers.get(cacheKey);
      if (!buf) {
        if (this.failedLoads.has(cacheKey)) {
          this.pendingLoops.delete(id);
          this.pendingLoopLoads.delete(id);
          this.pendingLoopVariants.delete(id);
          return;
        }
        this.pendingLoops.set(id, { key, target, x, y, z });
        this.pendingLoopVariants.set(id, variantIndex);
        if (this.pendingLoopLoads.get(id) !== key) {
          this.pendingLoopLoads.set(id, key);
          void this.loadBuffer(key, variantIndex).then((loaded) => {
            if (this.pendingLoopLoads.get(id) !== key) return;
            this.pendingLoopLoads.delete(id);
            const pending = this.pendingLoops.get(id);
            if (!loaded) {
              if (pending?.key === key) {
                this.pendingLoops.delete(id);
                this.pendingLoopVariants.delete(id);
              }
              return;
            }
            if (!pending || pending.key !== key) return;
            this.pendingLoops.delete(id);
            this.loop(id, key, pending.target, pending.x, pending.y, pending.z);
          });
        }
        return;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = this.authoredPlaybackRate(key);
      const g = ctx.createGain();
      g.gain.value = 0;
      const panner = positional ? this.makePanner(x, y, z) : null;
      if (panner) src.connect(g).connect(panner).connect(master);
      else src.connect(g).connect(master);
      src.start();
      this.commitVariant(key, variantIndex);
      this.pendingLoopVariants.delete(id);
      slot = { key, src, gain: g, panner, target: -1, x, y, z };
      this.loops.set(id, slot);
    } else if (positional && slot.panner && (slot.x !== x || slot.y !== y || slot.z !== z)) {
      this.setPannerPos(slot.panner, x, y, z);
      slot.x = x;
      slot.y = y;
      slot.z = z;
    }
    // Only (re)arm the ramp when the target actually changes. loop() is called
    // every frame for active ambience, so this keeps the hot path allocation-free.
    const mixedTarget = target * (this.entry(key)?.gain ?? 1);
    if (slot.target !== mixedTarget) {
      slot.target = mixedTarget;
      slot.gain.gain.setTargetAtTime(mixedTarget, ctx.currentTime, 0.25);
    }
  }

  /** Fade a loop out and free it. */
  unloop(id: string, fade = 0.4): void {
    this.pendingLoops.delete(id);
    this.pendingLoopLoads.delete(id);
    this.pendingLoopVariants.delete(id);
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
    const key = FOOTSTEP_CUES[surface];
    if (!key) return;
    this.playAt(key, x, y, z, {
      gain: running ? 0.5 : 0.35,
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
    else this.unloop(key, 0.7);
  }

  private pointAmbient(source: AmbientPointSource): void {
    if (this.tooFar(source.x, source.z)) {
      if (this.loops.has(source.id) || this.pendingLoops.has(source.id)) {
        this.unloop(source.id, 0.7);
      }
      return;
    }
    const key = source.kind === 'campfire' ? 'amb_campfire' : 'amb_forge';
    this.loop(source.id, key, POINT_AMBIENCE_GAIN, source.x, source.y, source.z);
  }

  /** Cross-fade the global ambience loops to match the player's surroundings.
   *  These are continuous background beds, kept well under the foreground
   *  footstep/jump/combat one-shots so movement always reads clearly over them. */
  ambience(
    biome: BiomeId,
    inDungeon: boolean,
    precip: 'snow' | 'rain' | null,
    nearWater: boolean,
    crowd = 0,
    points: readonly AmbientPointSource[] = [],
  ): void {
    this.ambient('amb_dungeon', inDungeon ? 0.3 : 0);
    // Sowfield crowd murmur (procedural bed): quiet chatter on the grounds,
    // swelling while a match is live (the renderer passes 0 / ~0.4 / 1).
    this.ambient('amb_crowd', crowd > 0 ? 0.08 + 0.18 * Math.min(1, crowd) : 0);
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
    this.ambient('amb_rain', precip === 'rain' ? 0.11 : 0); // sharp clip, kept very low
    this.ambient('amb_snow', precip === 'snow' ? 0.13 : 0);
    this.ambient('amb_water', nearWater ? 0.18 : 0);
    for (let i = 0; i < points.length; i++) this.pointAmbient(points[i]);
  }

  // --- Vale Cup one-shots (HUD-armed on vcupGoal/vcupEnd events) -----------

  /** GOAL! Two rising open fifths on stacked saws, the festival air horn.
   *  Fully synthesized (no clip file); non-positional so the whole stadium
   *  moment lands regardless of camera direction. */
  goalHorn(): void {
    const ctx = this.ctx,
      master = this.master;
    if (!ctx || !master) return;
    const t0 = ctx.currentTime;
    const blast = (freq: number, at: number, dur: number): void => {
      for (const [mult, level] of [
        [1, 0.16],
        [1.5, 0.12],
        [2.02, 0.05],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq * mult, t0 + at);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0 + at);
        g.gain.linearRampToValueAtTime(level, t0 + at + 0.05);
        g.gain.setValueAtTime(level, t0 + at + dur * 0.7);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + at + dur);
        osc.connect(g).connect(master);
        osc.start(t0 + at);
        osc.stop(t0 + at + dur + 0.05);
      }
    };
    blast(196, 0, 0.5);
    blast(261.6, 0.42, 0.9);
  }

  /** The stands erupt: the baked crescendo-decay crowd roar (procedural). */
  crowdRoar(gain = 0.9): void {
    this.playUi('vcup_crowd_roar', { gain, cooldown: 0.4 });
  }
}

export const sfx = new Sfx();
