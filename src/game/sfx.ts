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
import { ABILITIES } from '../sim/data';
import type { BiomeId } from '../sim/types';
import { isAbilityMomentRecorded } from './ability_sfx_coverage';
import { resumeWhenAllowed } from './audio_unlock';
import {
  advanceMountEngine,
  type MountEngineEntry,
  mountEngineLoopActive,
} from './mount_engine_state';
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
// Per-ability synth layer (abilityAudio): its own small voice pool, separate
// from MAX_VOICES so ability spam can never starve footsteps/UI one-shots,
// and a conservative layer gain that keeps every recipe under the sampled
// combat one-shots (the gallery tuned these against a 0.4 master + limiter;
// here they sit inside the 0.85 sample master, hence the extra headroom).
const ABILITY_VOICES = 8;
const ABILITY_GAIN = 0.34;
export const REF_DISTANCE = 5; // world units at which a sound is at full volume
export const MAX_DISTANCE = 46; // hard cutoff: beyond this, sources are silent/skipped
const POINT_AMBIENCE_GAIN = 0.18;
const COOLDOWN_ENTRY_TTL = 60;
const COOLDOWN_PRUNE_INTERVAL = 30;
// amb_forge's custom recording still reads quiet in-game even with the
// catalog's keyTrimDb ceiling (scripts/sfx/sfx_gain_map.json) applied at its
// full sanctioned +5dB, the maximum true-peak headroom under the shared
// -6dBFS conform ceiling (the recording's own peak sits at -6.0 dBTP after
// conform: a percussive hammer-strike signal has little room left under that
// engine-wide floor). This mix target REPLACES POINT_AMBIENCE_GAIN for forge
// only (campfire is unaffected), and stacks with the manifest's +5dB entry
// gain in loop()'s mixedTarget: 0.625 (this) * 1.778 (the +5dB trim,
// SFX_GAIN_LIMITS.amb_forge) = ~1.11, tuned by ear against the +5dB trim
// alone (~0.32 effective, still too quiet).
const FORGE_AMBIENCE_GAIN = 0.625;
// The forge is a small localized point source (a single station), not a
// zone-wide bed: it should NOT carry as far as the shared MAX_DISTANCE (46,
// tuned for things like footsteps/combat that want zone-scale audibility).
// refDistance stays at the shared default (full volume up close is fine
// unchanged); only the falloff cutoff narrows.
//
// Tuned in-game, live, against Eastbrook Vale's own Smith Haldren stall
// (9.5, 17.5): the audio listener is the CAMERA position (renderer.ts's
// sink.setListener call), not the player's own position, and the default
// camera trails 3 to 22 world units (camDist, input.ts) behind/above the
// player, so a narrow value (tried 6/7/8/10/20) went silent even standing
// right next to the forge once the camera's own offset was added in, a real
// gotcha worth remembering before retuning this. 38 lands it: silent at the
// PLAYER_START spawn point (2, -2), where the camera listener sits ~31.8
// units from the forge, audible by the time you reach Marshal Redbrook (4,
// 6) heading into town, and still 8 units narrower than the shared 46
// default.
export const FORGE_MAX_DISTANCE = 38;
// Fallback windup duration for mountEngine's very first call on a cold cache
// (the real decoded AudioBuffer.duration takes over once the clip loads);
// close to the tank mount's actual ~0.9s windup take so the first play still
// splices to the loop at roughly the right instant.
const MOUNT_ENGINE_START_FALLBACK_SEC = 0.9;

// Rift roller/portal loops (src/render/rift_ambience.ts): a moving hazard or
// an open portal should read as a clear nearby presence, not a wallpaper bed
// like campfire/forge, but must still sit under foreground one-shots.
const RIFT_AMBIENCE_GAIN = 0.4;
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
  cooldownKey?: string; // optional namespace when one asset serves unrelated cues
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
  maxDistance?: number;
  // Carries the caller's `immediate` request through the cold-buffer wait so
  // a resumed loop() call (once the buffer finishes loading) still snaps
  // straight to target gain instead of silently falling back to a fade-in.
  // See loop()'s doc comment: this matters for mountEngine's windup-to-loop
  // splice, which must never read as an audible swell.
  immediate?: boolean;
}

// 'kind' is the closed set of point-ambience station sources today (campfire,
// forge). makePanner/loop/tooFar all accept an optional refDistance/
// maxDistance override (see FORGE_MAX_DISTANCE, pointAmbient's 'forge'
// branch), so a future station ambience with its own audible-radius need
// (e.g. a Professions 2.0 station bed: kitchens/apothecary/tannery/loom/
// toolworks, see issue #2208) is a new 'kind' plus its own named constant,
// same pattern, no changes needed to the override mechanism itself.
interface AmbientPointSource {
  readonly id: string;
  readonly kind: 'campfire' | 'forge' | 'rift_portal' | 'rift_roller' | 'rift_ice_glide';
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
  private lastPlayPruneAt = 0;
  private loops = new Map<string, LoopSlot>();
  // Pending auto-stop timers for timedGroundLoop, keyed the same as `loops`.
  private groundLoopTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Per-entity windup/loop/winddown state for an engine mount (see mountEngine).
  private mountEngines = new Map<number, MountEngineEntry>();
  // Memoized per-mountKey engine clip key triple, or null once a mountKey is
  // known to have no engine take set. mountEngine() is called every frame for
  // every mounted entity in earshot, so this turns the per-frame cost for an
  // ordinary (non-engine) mount into a plain map lookup instead of 3 fresh
  // template-literal string allocations that are immediately thrown away.
  private engineClipKeysCache = new Map<
    string,
    { startKey: string; loopKey: string; stopKey: string } | null
  >();
  private footstepsOn = false; // off by default; driven by the footstepSfx setting
  private lx = 0;
  private lz = 0; // cached listener position
  // per-ability synth layer state (see the abilityAudio section)
  private synthNoise: AudioBuffer | null = null;
  private abilityVoiceEnds = new Float64Array(ABILITY_VOICES);
  private abilityEnd = 0; // max scheduled end of the recipe being built

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
      resumeWhenAllowed(this.ctx);
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
      // The ability layer is procedural only. An ElevenLabs-generated sample
      // pack briefly rode on top of it and was dropped (44b928819) for
      // bypassing the audio contract: scripts/sfx_conform.mjs only sees .mp3,
      // so its 118 takes shipped with no loudness, bitrate or true-peak check.
      // Any future sampled layer ships as conformed MP3s through scripts/sfx/
      // (docs/design/sound_effects.md), and must respect ability_sfx_coverage.ts
      // so it never doubles a hand-recorded cue the way that pack did.
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
      // shared white-noise bed for the per-ability synth recipes (abilityAudio)
      const noiseLen = Math.floor(ctx.sampleRate * 2);
      const noise = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
      const nd = noise.getChannelData(0);
      for (let i = 0; i < noiseLen; i++) nd[i] = Math.random() * 2 - 1;
      this.synthNoise = noise;
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

  // refDistance/maxDistance default to the shared constants so every existing
  // caller (footsteps, combat, mob voices, ambience loops) keeps its current
  // audible range unchanged. A caller with its own falloff (see pointAmbient's
  // 'forge' branch) passes an override; nothing else needs to.
  private makePanner(
    x: number,
    y: number,
    z: number,
    refDistance: number = REF_DISTANCE,
    maxDistance: number = MAX_DISTANCE,
  ): PannerNode {
    const ctx = this.ctx;
    if (!ctx) throw new Error('audio context is unavailable');
    const p = ctx.createPanner();
    p.panningModel = 'equalpower'; // cheap; HRTF is overkill for an MMO crowd
    p.distanceModel = 'linear';
    p.refDistance = refDistance;
    p.maxDistance = maxDistance;
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
   *  guards internally so a far event is a cheap no-op. maxDistance defaults to
   *  the shared MAX_DISTANCE; a caller with its own panner override (see
   *  makePanner/loop) passes the matching value so this cull threshold lines
   *  up with where that source actually falls silent. */
  private tooFar(x: number, z: number, maxDistance: number = MAX_DISTANCE): boolean {
    const dx = x - this.lx,
      dz = z - this.lz;
    return dx * dx + dz * dz > maxDistance * maxDistance;
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
    const now = ctx.currentTime;
    this.pruneLastPlay(now);
    if (this.active >= MAX_VOICES) return false;
    const cd = opts?.cooldown ?? 0.03;
    const cooldownKey = opts?.cooldownKey ?? key;
    // -Infinity, not -1: a fresh key (never played) must never be blocked, at
    // any cooldown length. A -1 sentinel worked by accident while every
    // cooldown here stayed under 1s (now - -1 was always >= cooldown); a
    // longer cooldown (e.g. audio.error()'s 1.5s) can make now - -1 itself
    // read as "still on cooldown" moments after AudioContext starts, wrongly
    // swallowing the very first play of that key.
    if (now - (this.lastPlay.get(cooldownKey) ?? Number.NEGATIVE_INFINITY) < cd) return false;
    this.lastPlay.set(cooldownKey, now);
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
    const now = ctx.currentTime;
    this.pruneLastPlay(now);
    if (this.active >= MAX_VOICES) return;
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
   *  positional. Ramps gain smoothly; creating from scratch fades in from 0,
   *  UNLESS `immediate` is set, which snaps straight to full target gain on
   *  creation instead (a hard splice from a preceding one-shot that was
   *  authored to already end at the loop's own level, e.g. mountEngine's
   *  windup-to-loop handoff: a fade-in there would read as an audible swell
   *  right where the two takes are meant to read as one continuous sound). */
  // maxDistance defaults to makePanner's own default (the shared MAX_DISTANCE),
  // so every existing caller keeps its current audible range; only a caller
  // that needs its own falloff (pointAmbient's 'forge' branch) passes an
  // override. refDistance has no caller that overrides it today; add it back
  // if a future station ambience needs its own near-field radius.
  loop(
    id: string,
    key: string,
    target: number,
    x?: number,
    y?: number,
    z?: number,
    maxDistance?: number,
    immediate = false,
  ): void {
    const ctx = this.ctx,
      master = this.master;
    if (!ctx || !master) return;
    const positional = x !== undefined && y !== undefined && z !== undefined;
    let slot = this.loops.get(id);
    if (slot && slot.key !== key) {
      this.unloop(id, 0);
      slot = undefined;
    }
    let justCreated = false;
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
        this.pendingLoops.set(id, { key, target, x, y, z, maxDistance, immediate });
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
            this.loop(
              id,
              key,
              pending.target,
              pending.x,
              pending.y,
              pending.z,
              pending.maxDistance,
              pending.immediate,
            );
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
      const panner = positional ? this.makePanner(x, y, z, undefined, maxDistance) : null;
      if (panner) src.connect(g).connect(panner).connect(master);
      else src.connect(g).connect(master);
      src.start();
      this.commitVariant(key, variantIndex);
      this.pendingLoopVariants.delete(id);
      slot = { key, src, gain: g, panner, target: -1, x, y, z };
      this.loops.set(id, slot);
      justCreated = true;
    } else if (positional && slot.panner) {
      if (slot.x !== x || slot.y !== y || slot.z !== z) {
        this.setPannerPos(slot.panner, x, y, z);
        slot.x = x;
        slot.y = y;
        slot.z = z;
      }
      // Keep an already-live loop's falloff current too, not just position:
      // ambience() calls loop() every frame for a nearby point source, so a
      // tuning change to a maxDistance override (e.g. FORGE_MAX_DISTANCE)
      // takes effect on the NEXT frame rather than only for a loop that
      // hasn't started yet.
      const resolvedMax = maxDistance ?? MAX_DISTANCE;
      if (slot.panner.refDistance !== REF_DISTANCE) slot.panner.refDistance = REF_DISTANCE;
      if (slot.panner.maxDistance !== resolvedMax) slot.panner.maxDistance = resolvedMax;
    }
    // Only (re)arm the ramp when the target actually changes. loop() is called
    // every frame for active ambience, so this keeps the hot path allocation-free.
    const mixedTarget = target * (this.entry(key)?.gain ?? 1);
    if (slot.target !== mixedTarget) {
      slot.target = mixedTarget;
      if (justCreated && immediate) slot.gain.gain.setValueAtTime(mixedTarget, ctx.currentTime);
      else slot.gain.gain.setTargetAtTime(mixedTarget, ctx.currentTime, 0.25);
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

  /** A fixed-duration ground zone loop (Blizzard's storm): starts `key`
   *  looping at (x,y,z) and schedules its own unloop after `duration`
   *  seconds. A fresh call with the same id (a new zone landing while the
   *  previous one's fade is still pending, or simply repositioning) cancels
   *  any pending stop and reschedules from the new call, matching a real
   *  zone's actual lifetime rather than the first one that ever fired. */
  timedGroundLoop(
    id: string,
    key: string,
    x: number,
    y: number,
    z: number,
    duration: number,
  ): void {
    if (!(key in SFX_CLIPS)) return;
    this.loop(id, key, 0.85, x, y, z);
    const pending = this.groundLoopTimers.get(id);
    if (pending) clearTimeout(pending);
    this.groundLoopTimers.set(
      id,
      setTimeout(() => {
        this.groundLoopTimers.delete(id);
        this.unloop(id);
      }, duration * 1000),
    );
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

  /** One custom stride for a running mount. This is part of the world SFX mix,
   *  independent of the optional on-foot footstep toggle. */
  mountRun(x: number, y: number, z: number, mountKey: string, _self: boolean): void {
    const key = `mount_run_${mountKey}`;
    if (!(key in SFX_CLIPS)) return;
    this.playAt(key, x, y, z, {
      gain: 0.85,
      rate: 1,
      cooldown: 0.05,
      release: 0.44,
    });
  }

  /** Windup/loop/winddown engine audio for a mount with a dedicated take set
   *  (currently just the tank mount): call every frame a rider is mounted,
   *  keyed per entity so multiple riders never share state. A mount with no
   *  `_start` take falls through silently, so ordinary mounts keep using
   *  mountRun's per-stride gait beat instead. See mount_engine_state.ts for
   *  the transition rules (a quick tap plays the windup and winddown back to
   *  back, no loop; sustained movement crossfades into the loop and back
   *  out). Returns whether this call drives an engine mount at all, so the
   *  caller (renderer.ts) knows whether to also skip the generic gait beat. */
  /** Resolve (and cache) the engine clip key triple for a mountKey, or null if
   *  this mount has no dedicated windup/loop/winddown take set. Memoized so
   *  the common case (an ordinary mount, checked every frame it is ridden)
   *  costs one map lookup instead of building and discarding 3 strings. */
  private engineClipKeys(
    mountKey: string,
  ): { startKey: string; loopKey: string; stopKey: string } | null {
    const cached = this.engineClipKeysCache.get(mountKey);
    if (cached !== undefined) return cached;
    const startKey = `mount_run_${mountKey}_start`;
    const resolved =
      startKey in SFX_CLIPS
        ? { startKey, loopKey: `mount_run_${mountKey}`, stopKey: `mount_run_${mountKey}_stop` }
        : null;
    this.engineClipKeysCache.set(mountKey, resolved);
    return resolved;
  }

  mountEngine(
    x: number,
    y: number,
    z: number,
    mountKey: string,
    moving: boolean,
    entityId: number,
  ): boolean {
    const keys = this.engineClipKeys(mountKey);
    if (!keys) return false;
    const { startKey, loopKey, stopKey } = keys;
    const ctx = this.ctx;
    if (!ctx) return true;
    const now = ctx.currentTime;
    const prior = this.mountEngines.get(entityId);
    // variant 0: the only take today (see mountRun/playAt's variant pool for
    // other cues). If a second windup variant ever lands, this needs to
    // resolve whichever variant playAt's round-robin actually picked for
    // THIS play, not always the first.
    const startBuf = this.buffers.get(assetCacheKey(startKey, 0));
    const startDuration = startBuf?.duration ?? MOUNT_ENGINE_START_FALLBACK_SEC;
    const { next, action } = advanceMountEngine(prior, moving, now, startDuration);
    this.mountEngines.set(entityId, next);
    // jitter: false on the windup: advanceMountEngine schedules the loop
    // splice off this clip's nominal buffer duration (startDuration above),
    // so the actual playback must match that duration exactly. playAt's
    // default rate jitter (+/-6%) would otherwise let the loop enter up to
    // ~54ms early or late, and cut the windup off before (or past) the
    // level it was authored to hand off to the loop at.
    if (action === 'playStart') {
      this.playAt(startKey, x, y, z, { gain: 0.85, cooldown: 0, jitter: false });
    } else if (action === 'playStop') this.playAt(stopKey, x, y, z, { gain: 0.85, cooldown: 0 });
    const loopActive = mountEngineLoopActive(next.state);
    const loopId = `mountEngine:${entityId}`;
    // immediate: true, the windup take is authored to already end at the
    // loop's own level, so a fade-in here would read as a swell right where
    // the two takes are meant to splice as one continuous sound.
    if (loopActive) this.loop(loopId, loopKey, 0.85, x, y, z, undefined, true);
    else if (prior && mountEngineLoopActive(prior.state)) this.unloop(loopId, 0.15);
    return true;
  }

  /** Drop an entity's engine-mount state and silence its loop, e.g. on
   *  dismount or when its view is removed (interest culled, disconnect). */
  mountEngineReset(entityId: number): void {
    if (!this.mountEngines.delete(entityId)) return;
    this.unloop(`mountEngine:${entityId}`, 0.1);
  }

  /** Warm the three engine clips (windup/loop/winddown) for a mountKey ahead
   *  of the first time they are actually needed. Called from the mountKey
   *  transition edge in renderer.ts (the same edge that calls
   *  mountEngineReset), so a fresh mount or a swap has its buffers already
   *  decoded, or at least in flight, by the time movement first calls
   *  mountEngine. Without this, a cold first ride can still hit playAt's/
   *  loop()'s cold paths (dropped one-shot, or a fallback fade-in) if the
   *  rider starts moving before the fetch+decode finishes; this preload just
   *  makes that window much smaller in practice. A no-op for a mount with no
   *  engine take set.*/
  preloadMountEngine(mountKey: string): void {
    const keys = this.engineClipKeys(mountKey);
    if (!keys) return;
    this.preload(keys.startKey);
    this.preload(keys.loopKey);
    this.preload(keys.stopKey);
  }

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

  necromancy(
    kind: 'lichTransform' | 'lichHeartbeat' | 'soulConsume',
    x: number,
    y: number,
    z: number,
    _self: boolean,
    sourceId?: number,
  ): void {
    const sourceKey =
      sourceId === undefined ? `${Math.round(x * 4)}:${Math.round(z * 4)}` : `${sourceId}`;
    if (kind === 'lichTransform') {
      this.playAt('impact_shadow', x, y, z, {
        gain: 0.95,
        rate: 0.68,
        cooldown: 0.5,
        cooldownKey: `necromancy:transform:${sourceKey}`,
        jitter: false,
        attack: 0.02,
        release: 0.65,
      });
      return;
    }
    if (kind === 'lichHeartbeat') {
      this.playAt('impact_bone', x, y, z, {
        gain: 0.2,
        rate: 0.55,
        cooldown: 2.8,
        cooldownKey: `necromancy:heartbeat:${sourceKey}`,
        jitter: false,
        attack: 0.025,
        release: 0.22,
      });
      return;
    }
    this.playAt('proj_shadow', x, y, z, {
      gain: 0.62,
      rate: 0.74,
      cooldown: 0.12,
      cooldownKey: `necromancy:soul:${sourceKey}`,
      jitter: false,
      attack: 0.015,
      release: 0.48,
    });
  }

  private pruneLastPlay(now: number): void {
    if (now < this.lastPlayPruneAt) return;
    const cutoff = now - COOLDOWN_ENTRY_TTL;
    for (const [key, playedAt] of this.lastPlay) {
      if (playedAt < cutoff) this.lastPlay.delete(key);
    }
    this.lastPlayPruneAt = now + COOLDOWN_PRUNE_INTERVAL;
  }

  private ambient(key: string, target: number): void {
    if (target > 0) this.loop(key, key, target);
    else this.unloop(key, 0.7);
  }

  private pointAmbient(source: AmbientPointSource): void {
    // The forge's own, narrower cull distance so it stops (unloops) exactly
    // where its own falloff (below) would already have gone silent, instead
    // of lingering as a silent loop out to the shared MAX_DISTANCE.
    const maxDistance = source.kind === 'forge' ? FORGE_MAX_DISTANCE : undefined;
    if (this.tooFar(source.x, source.z, maxDistance)) {
      if (this.loops.has(source.id) || this.pendingLoops.has(source.id)) {
        this.unloop(source.id, 0.7);
      }
      return;
    }
    let key: string;
    let gain: number;
    switch (source.kind) {
      case 'campfire':
        key = 'amb_campfire';
        gain = POINT_AMBIENCE_GAIN;
        break;
      case 'forge':
        key = 'amb_forge';
        gain = FORGE_AMBIENCE_GAIN;
        break;
      case 'rift_portal':
        key = 'rift_portal_drone';
        gain = RIFT_AMBIENCE_GAIN;
        break;
      case 'rift_roller':
        key = 'rift_boulder_roll';
        gain = RIFT_AMBIENCE_GAIN;
        break;
      case 'rift_ice_glide':
        key = 'rift_ice_glide';
        gain = RIFT_AMBIENCE_GAIN;
        break;
    }
    this.loop(source.id, key, gain, source.x, source.y, source.z, maxDistance);
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
    this.ambient(
      'amb_birds',
      !inDungeon &&
        (biome === 'vale' || biome === 'jungle' || biome === 'garden' || biome === 'gale')
        ? 0.12
        : 0,
    );
    // The dusk realm shares the marsh's low still-air bed, kept quieter: a
    // sheltered valley, no open-ridge wind. ...and the ember wastes a faint
    // dry-air version of the same bed. Cave (paint-only) borrows the marsh bed.
    const marshBed =
      biome === 'marsh' || biome === 'cave'
        ? 0.13
        : biome === 'dusk'
          ? 0.07
          : biome === 'ember'
            ? 0.05
            : biome === 'amber'
              ? 0.09
              : biome === 'fen'
                ? 0.11
                : biome === 'night'
                  ? 0.06 // hushed still night air
                  : biome === 'haunt'
                    ? 0.14 // the wood breathes: thick still air
                    : biome === 'jungle'
                      ? 0.1 // humid insect drone
                      : biome === 'garden'
                        ? 0.07 // bees in the beds
                        : 0;
    this.ambient('amb_wind_marsh', !inDungeon ? marshBed : 0);
    // the Frostveil shares the peaks' ridge wind, a touch stronger in the mist;
    // desert/volcano (paint-only) borrow the peaks ridge bed too. 0.12 matches
    // amb_wind_vale's mix target: peaks/vale/marsh are generated to the same
    // -14ish LUFS target, and the old 0.18 was a player-reported "too loud"
    // complaint at Thornpeak Heights traced to this constant alone.
    const peaksBed =
      biome === 'peaks' || biome === 'desert' || biome === 'volcano'
        ? 0.12
        : biome === 'frost'
          ? 0.2
          : biome === 'gale'
            ? 0.24
            : 0;
    this.ambient('amb_wind_peaks', !inDungeon ? peaksBed : 0);
    this.ambient('amb_rain', precip === 'rain' ? 0.11 : 0); // sharp clip, kept very low
    this.ambient('amb_snow', precip === 'snow' ? 0.13 : 0);
    this.ambient('amb_water', nearWater ? 0.18 : 0);
    const activeIds = new Set<string>();
    for (let i = 0; i < points.length; i++) {
      activeIds.add(points[i].id);
      this.pointAmbient(points[i]);
    }
    // Unlike the static campfire/forge set (the same fixed sources every frame,
    // culled only by distance), a rift portal/roller/gliding-player source can
    // disappear entirely between frames (instance ends, portal expires, the
    // glide stops) without ever crossing the tooFar threshold: sweep any such
    // loop no longer present.
    const isDynamicRiftId = (id: string): boolean =>
      id.startsWith('rift_portal:') ||
      id.startsWith('rift_roller:') ||
      id.startsWith('rift_ice_glide:');
    for (const id of this.loops.keys()) {
      if (isDynamicRiftId(id) && !activeIds.has(id)) this.unloop(id, 0.7);
    }
    for (const id of this.pendingLoops.keys()) {
      if (isDynamicRiftId(id) && !activeIds.has(id)) this.pendingLoops.delete(id);
    }
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

  // --- Per-ability procedural combat audio (src/render/ability_vfx) --------
  // Ported from the approved gallery's synth engine (arc_bolt_preview.js Sfx
  // class): the 12 palette impact identities, the release whoosh, a sub-weight
  // layer scaled by ability power, the crit sting, soft zone-pulse thuds, and
  // gentle heal/buff chimes. Synthesis recipes only, the gallery's recorded
  // sample pack is a separate licensing decision and is deliberately NOT here.
  // Each event is one voice: a gain -> panner chain into the master with every
  // oscillator/noise primitive scheduled inside it, drawn from its own small
  // ABILITY_VOICES pool so ability spam can never exhaust MAX_VOICES.
  // Windup beds and travel loops are a follow-up (they need loop lifecycle
  // tied to cast state); this layer is one-shots only.

  /** One per-ability audio moment at a world position. `kind`:
   *  release = the cast lets go (at the caster); impact = the hit lands (at
   *  the impact point, a ground zone booms AT the zone); pulse = one soft
   *  zone re-hit; crit = the sting layered over a critical impact; spirit =
   *  a creature apparition calls at spawn; motif = set-piece foley.
   *  Gentle archetypes (heal/buff/cc) chime instead of booming and skip the
   *  release whoosh entirely; opts.lite (spec liteAudio or a degraded visual
   *  tier) plays a quieter, sub-less version of the same identity.
   *  THIS LAYER DEFERS TO THE RECORDINGS: a moment already sounded by a
   *  hand-recorded cue from src/ui/combat_sfx.ts is skipped outright rather
   *  than doubled (ability_sfx_coverage.ts), so what remains here is only what
   *  no recording covers. */
  abilityAudio(
    kind: 'windup' | 'release' | 'impact' | 'pulse' | 'crit' | 'spirit' | 'motif',
    palette: string,
    power: number,
    x: number,
    y: number,
    z: number,
    opts?: {
      lite?: boolean;
      finisher?: boolean;
      archetype?: string;
      buffStyle?: string;
      sample?: string;
      name?: string;
      abilityId?: string;
    },
  ): void {
    const ctx = this.ctx,
      master = this.master;
    if (!ctx || !master) return;
    if (this.tooFar(x, z)) return;
    const arch = opts?.archetype ?? '';
    // A hand-recorded studio cue already sounds several of these moments from
    // src/ui/combat_sfx.ts: proj_<school> at the launch, impact_<school> or a
    // material impact where it lands, combat_crit on a crit, heal_impact,
    // buff_apply. Those fire at the same instant and position as this layer, so
    // playing here too masked the recordings under a synthetic double rather
    // than replacing them. Stay silent and let the recording be the read; the
    // moments no recording covers keep their procedural voice below.
    const def = opts?.abilityId ? ABILITIES[opts.abilityId] : undefined;
    if (
      isAbilityMomentRecorded(kind, {
        school: def?.school,
        archetype: arch,
        isProjectile: def?.projectile,
        abilityId: opts?.abilityId,
      })
    ) {
      return;
    }
    const gentle = arch === 'heal' || arch === 'buff' || arch === 'cc';
    if (kind === 'release' && gentle) return; // their impact chime is the read
    const now = ctx.currentTime;
    // per-(kind, palette) cooldown, spirit calls and motif foley key on
    // their own name instead: a volley or AoE multi-hit plays once, not
    // as a machine-gun of identical transients
    const cdKey =
      kind === 'spirit' || kind === 'motif'
        ? `abl:${kind}:${opts?.name ?? ''}`
        : `abl:${kind}:${palette}`;
    const cd =
      kind === 'crit'
        ? 0.25
        : kind === 'pulse'
          ? 0.12
          : kind === 'spirit'
            ? 0.5
            : kind === 'motif'
              ? 0.2
              : kind === 'windup'
                ? 0.4
                : 0.07;
    if (now - (this.lastPlay.get(cdKey) ?? Number.NEGATIVE_INFINITY) < cd) return;
    let slot = -1;
    for (let i = 0; i < ABILITY_VOICES; i++) {
      if (this.abilityVoiceEnds[i] <= now) {
        slot = i;
        break;
      }
    }
    if (slot < 0) return; // saturated: drop rather than crowd the mix
    const lite = opts?.lite === true;
    try {
      const out = ctx.createGain();
      out.gain.value = ABILITY_GAIN * (lite ? 0.6 : 1);
      const panner = this.makePanner(x, y, z);
      out.connect(panner);
      panner.connect(master);
      this.abilityEnd = now;
      switch (kind) {
        case 'windup':
          this.windupMoment(out, now, palette, power);
          break;
        case 'release':
          this.releaseMoment(out, now, power);
          break;
        case 'impact':
          this.impactMoment(out, now, palette, power, lite, arch, opts);
          break;
        case 'pulse':
          this.abilityPulse(out, now, palette, power);
          break;
        case 'crit':
          this.abilityCrit(out, now, lite);
          break;
        case 'spirit':
          this.spiritMoment(out, now, opts?.name ?? '');
          break;
      }
      if (this.abilityEnd <= now) {
        // recipe scheduled nothing (e.g. stubbed context): free the chain now
        out.disconnect();
        panner.disconnect();
        return;
      }
      this.lastPlay.set(cdKey, now);
      this.abilityVoiceEnds[slot] = this.abilityEnd;
      const src = out,
        pan = panner;
      setTimeout(
        () => {
          src.disconnect();
          pan.disconnect();
        },
        (this.abilityEnd - now + 0.2) * 1000,
      );
    } catch {
      /* minimal AudioContext stubs may lack synthesis nodes */
    }
  }

  /** The pre-release charge bed: a soft rising swell while a cast winds up, so
   *  a nature/moon cast leads with its OWN character instead of leaving the
   *  first thing the ear catches to be the palette impact (which read as a
   *  fire-spell charge to the owner). Gentle and non-percussive - it is the
   *  "spell is charging" tell, not a hit. Only the palettes that were flagged
   *  synthesize here; every other palette stays silent (no regression to the
   *  classes whose windups already read right). */
  private windupMoment(out: GainNode, t: number, palette: string, power: number): void {
    const I = 0.6 + 0.4 * Math.min(1.5, power);
    if (palette === 'nature') {
      // leaves gathering: a breathy band-passed wind rising under a soft green
      // triad that blooms in - airy and growing, never a crackle
      this.aNoise(out, t, {
        dur: 1.1,
        freq: 900,
        sweep: 700,
        gain: 0.14 * I,
        type: 'bandpass',
        q: 0.9,
        attack: 0.55,
      });
      this.aPartials(out, t, {
        freqs: [392, 588, 784],
        dur: 1.2,
        gain: 0.07 * I,
        stagger: 0.14,
      });
      return;
    }
    if (palette === 'moon') {
      // cold starlight winding up: a high airy shimmer swelling in, a soft
      // rising bell underneath - the stellar charge Starfire was missing
      this.aNoise(out, t, {
        dur: 1.2,
        freq: 5200,
        gain: 0.07 * I,
        type: 'highpass',
        attack: 0.7,
      });
      this.aTone(out, t, {
        freq: 660,
        slide: 990,
        dur: 1.1,
        gain: 0.08 * I,
        attack: 0.5,
      });
      return;
    }
    // any other palette: no windup bed (leave those casts exactly as reviewed)
  }

  /** Cast release at the caster. Only reaches abilities with no recorded
   *  launch: a physical strike or dash, or a spell that opts out of the
   *  projectile convention. Every magic-school projectile is carried by its
   *  proj_<school> recording instead (ability_sfx_coverage.ts). */
  private releaseMoment(out: GainNode, t: number, power: number): void {
    this.abilityRelease(out, t, power);
  }

  /** The impact moment. Only reaches the archetypes no recording covers:
   *  cc, shout, summon and dash. Every damage landing plays its recorded
   *  impact_<school> or material impact, and heal/buff land heal_impact /
   *  buff_apply, all from combat_sfx.ts (see ability_sfx_coverage.ts). */
  private impactMoment(
    out: GainNode,
    t: number,
    palette: string,
    power: number,
    lite: boolean,
    arch: string,
    opts?: { finisher?: boolean },
  ): void {
    // a crowd-control landing poofs; a shout, summon or dash lands on the
    // palette impact recipe (its sub weight and finisher toll included)
    if (arch === 'cc') {
      this.abilityPoof(out, t);
      return;
    }
    this.abilityImpact(out, t, palette, power, lite, opts?.finisher === true);
  }

  /** A creature apparition calls at spawn. The recorded spirit voices were an
   *  ElevenLabs pack take and went with it, so only the stag keeps a voice:
   *  its take read as a farm-animal moo, wrong for the ghostly deer of Mark of
   *  the Wild and the nature forms, and was already rerouted to a synthesized
   *  nature blessing in the owner druid review. The rest stay silent until
   *  real recordings land through scripts/sfx/. */
  private spiritMoment(out: GainNode, t: number, model: string): void {
    if (model === 'stag') this.abilityHeal(out, t, 'nature');
  }

  // ---- synth primitives (gallery tone2/noise2/partials/ticks/sub) ---------

  private aTone(
    out: GainNode,
    t: number,
    o: {
      freq: number;
      dur: number;
      gain: number;
      type?: OscillatorType;
      slide?: number;
      delay?: number;
      attack?: number;
      fmRatio?: number;
      fmDepth?: number;
    },
  ): void {
    const ctx = this.ctx;
    if (!ctx || o.gain <= 0.001) return;
    const at = t + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, at);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(18, o.slide), at + o.dur);
    if (o.fmRatio && o.fmDepth) {
      const mod = ctx.createOscillator();
      mod.frequency.value = o.freq * o.fmRatio;
      const mg = ctx.createGain();
      mg.gain.value = o.fmDepth;
      mod.connect(mg);
      mg.connect(osc.frequency);
      mod.start(at);
      mod.stop(at + o.dur + 0.1);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(o.gain, at + Math.max(0.003, o.attack ?? 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, at + o.dur);
    osc.connect(g);
    g.connect(out);
    osc.start(at);
    osc.stop(at + o.dur + 0.1);
    this.abilityEnd = Math.max(this.abilityEnd, at + o.dur + 0.1);
  }

  private aNoise(
    out: GainNode,
    t: number,
    o: {
      dur: number;
      freq: number;
      gain: number;
      type?: BiquadFilterType;
      q?: number;
      sweep?: number;
      delay?: number;
      attack?: number;
    },
  ): void {
    const ctx = this.ctx,
      buf = this.synthNoise;
    if (!ctx || !buf || o.gain <= 0.001) return;
    const at = t + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'lowpass';
    f.frequency.setValueAtTime(o.freq, at);
    f.Q.value = o.q ?? 1;
    if (o.sweep) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.sweep), at + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(o.gain, at + Math.max(0.002, o.attack ?? 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, at + o.dur);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(at, Math.random() * 1.5);
    src.stop(at + o.dur + 0.1);
    this.abilityEnd = Math.max(this.abilityEnd, at + o.dur + 0.1);
  }

  private aPartials(
    out: GainNode,
    t: number,
    o: {
      freqs: readonly number[];
      dur: number;
      gain: number;
      type?: OscillatorType;
      stagger?: number;
      delay?: number;
    },
  ): void {
    for (let i = 0; i < o.freqs.length; i++) {
      this.aTone(out, t, {
        freq: o.freqs[i],
        dur: o.dur * (1 - i * 0.08),
        gain: o.gain / (1 + i * 0.7),
        type: o.type,
        delay: (o.delay ?? 0) + i * (o.stagger ?? 0),
      });
    }
  }

  private aTicks(
    out: GainNode,
    t: number,
    o: { n: number; over: number; fLo?: number; fHi?: number; gain: number; tone?: boolean },
  ): void {
    const fLo = o.fLo ?? 3000,
      fHi = o.fHi ?? 6500;
    for (let i = 0; i < o.n; i++) {
      const delay = Math.random() * o.over;
      const freq = fLo + Math.random() * (fHi - fLo);
      if (o.tone) this.aTone(out, t, { freq, dur: 0.09, gain: o.gain, delay });
      else this.aNoise(out, t, { dur: 0.04, freq, gain: o.gain, type: 'highpass', delay });
    }
  }

  private aSub(
    out: GainNode,
    t: number,
    o: { from: number; to: number; dur: number; gain: number; delay?: number },
  ): void {
    this.aTone(out, t, {
      freq: o.from,
      slide: o.to,
      dur: o.dur,
      gain: o.gain,
      delay: o.delay,
      attack: 0.006,
    });
  }

  // ---- recipes -------------------------------------------------------------

  /** Cast lets go: whoosh + spectral snap (the gallery release, synth path). */
  private abilityRelease(out: GainNode, t: number, power: number): void {
    const s = 0.8 + 0.2 * Math.min(1.5, power);
    this.aNoise(out, t, {
      dur: 0.3,
      freq: 1400,
      sweep: 420,
      gain: 0.28 * s,
      type: 'bandpass',
      q: 1.2,
    });
    this.aNoise(out, t, { dur: 0.07, freq: 6800, gain: 0.3 * s, type: 'highpass' });
  }

  /** The 12 palette impact identities (gallery Sfx.impact, synth path). */
  private abilityImpact(
    out: GainNode,
    t: number,
    palette: string,
    power: number,
    lite: boolean,
    finisher: boolean,
  ): void {
    const I = Math.min(1.5, power) * (lite ? 0.6 : 1);
    const d = finisher ? 0.035 : 0; // pre-gap: silence, then the hit
    // lite drops the whole sub layer; a finisher's toll partly replaces it
    const sub = lite ? 0 : finisher ? 0.45 : 1;
    switch (palette) {
      case 'storm':
        this.aNoise(out, t, { dur: 0.1, freq: 7500, gain: 0.5 * I, type: 'highpass', delay: d });
        this.aNoise(out, t, { dur: 0.9, freq: 420, gain: 0.42 * I, delay: d });
        this.aSub(out, t, {
          from: 130,
          to: I >= 1.2 ? 26 : 32,
          dur: 0.55 * (0.7 + 0.3 * I),
          gain: 0.55 * I * sub,
          delay: d,
        });
        this.aTicks(out, t, { n: Math.round(6 * (0.6 + 0.5 * I)), over: 0.4, gain: 0.07 * I });
        break;
      case 'fire':
        this.aNoise(out, t, { dur: 0.5, freq: 520, sweep: 90, gain: 0.55 * I, delay: d });
        this.aSub(out, t, {
          from: 100,
          to: I >= 1.2 ? 32 : 40,
          dur: 0.45 * (0.7 + 0.3 * I),
          gain: 0.5 * I * sub,
          delay: d,
        });
        this.aTicks(out, t, {
          n: Math.round(9 * (0.6 + 0.5 * I)),
          over: 0.55,
          fLo: 2800,
          fHi: 6000,
          gain: 0.09 * I,
        });
        break;
      case 'blood': // wet squelch signature
        this.aNoise(out, t, {
          dur: 0.28,
          freq: 1200,
          sweep: 300,
          gain: 0.32 * I,
          type: 'bandpass',
          q: 3,
          delay: d,
        });
        this.aNoise(out, t, { dur: 0.22, freq: 180, sweep: 90, gain: 0.45 * I, delay: d });
        this.aSub(out, t, { from: 85, to: 45, dur: 0.3, gain: 0.5 * I * sub, delay: d });
        this.aSub(out, t, { from: 70, to: 40, dur: 0.26, gain: 0.4 * I * sub, delay: d + 0.26 });
        break;
      case 'frost':
        this.aTicks(out, t, {
          n: 11,
          over: 0.28,
          fLo: 1900,
          fHi: 5400,
          gain: 0.1 * I,
          tone: true,
        });
        this.aPartials(out, t, {
          freqs: [1780, 2350, 3160],
          dur: 0.85,
          gain: 0.16 * I,
          stagger: 0.015,
        });
        this.aNoise(out, t, { dur: 0.3, freq: 7000, gain: 0.28 * I, type: 'highpass', delay: d });
        break;
      case 'moon': // lunar glass: airy + falling cold partials, no FM zip
        this.aTone(out, t, { freq: 1320, dur: 0.6, gain: 0.2 * I, delay: d });
        this.aNoise(out, t, {
          dur: 0.7,
          freq: 4200,
          gain: 0.1 * I,
          type: 'highpass',
          attack: 0.15,
          delay: d,
        });
        this.aPartials(out, t, {
          freqs: [1174, 880, 587],
          dur: 1.3,
          gain: 0.12 * I,
          stagger: 0.06,
        });
        break;
      case 'arcane':
        this.aTone(out, t, {
          freq: 700,
          slide: 1500,
          dur: 0.28,
          gain: 0.28 * I,
          fmRatio: 1.6,
          fmDepth: 380,
          delay: d,
        });
        this.aPartials(out, t, { freqs: [1320, 1980], dur: 0.6, gain: 0.13 * I, stagger: 0.03 });
        break;
      case 'shadow':
        this.aSub(out, t, { from: 160, to: 26, dur: 0.7, gain: 0.55 * I * sub, delay: d });
        this.aNoise(out, t, { dur: 0.7, freq: 380, gain: 0.35 * I, attack: 0.1, delay: d });
        this.aNoise(out, t, {
          dur: 0.5,
          freq: 5200,
          gain: 0.1 * I,
          type: 'highpass',
          delay: d + 0.08,
        });
        break;
      case 'venom':
        for (let i = 0; i < 4; i++) {
          this.aTone(out, t, {
            freq: 300 - i * 40,
            slide: 140,
            dur: 0.12,
            gain: 0.16 * I,
            delay: d + i * 0.06,
          });
        }
        this.aNoise(out, t, { dur: 0.6, freq: 5200, gain: 0.14 * I, type: 'highpass', delay: d });
        break;
      case 'holy':
        this.aPartials(out, t, {
          freqs: [523, 785, 1046, 1568],
          dur: 1.2,
          gain: 0.26 * I,
          stagger: 0.025,
        });
        this.aNoise(out, t, { dur: 0.25, freq: 3000, gain: 0.12 * I, type: 'highpass', delay: d });
        break;
      case 'gold': // struck treasure, not a second choir
        this.aPartials(out, t, {
          freqs: [2140, 3420, 5580],
          dur: 0.42,
          gain: 0.2 * I,
          stagger: 0.02,
        });
        this.aPartials(out, t, { freqs: [523, 784], dur: 0.9, gain: 0.16 * I, stagger: 0.04 });
        this.aSub(out, t, { from: 110, to: 60, dur: 0.35, gain: 0.3 * I * sub, delay: d });
        break;
      case 'nature':
        this.aTone(out, t, { freq: 175, dur: 0.12, gain: 0.35 * I, type: 'triangle', delay: d });
        this.aNoise(out, t, {
          dur: 0.45,
          freq: 1150,
          gain: 0.24 * I,
          type: 'bandpass',
          q: 2,
          delay: d,
        });
        break;
      default: // physical: woody body knock leads
        this.aTone(out, t, {
          freq: 420,
          slide: 300,
          dur: 0.14,
          gain: 0.3 * I,
          type: 'triangle',
          delay: d,
        });
        this.aNoise(out, t, { dur: 0.16, freq: 260, gain: 0.5 * I, delay: d });
        this.aSub(out, t, { from: 82, to: 50, dur: 0.24, gain: 0.42 * I * sub, delay: d });
        this.aPartials(out, t, { freqs: [2870, 3350], dur: 0.15, gain: 0.13 * I });
        break;
    }
    // weight arrives with power, not loudness alone: big hits in sub-less
    // palettes earn a body thump
    if (
      I >= 1.15 &&
      !lite &&
      !['storm', 'fire', 'blood', 'shadow', 'physical', 'gold'].includes(palette)
    ) {
      this.aSub(out, t, { from: 92, to: 44, dur: 0.28 + 0.1 * I, gain: 0.22 * I, delay: d });
    }
    // finisher toll: the low bell under the verdict
    if (finisher) {
      this.aPartials(out, t, { freqs: [65, 98], dur: 1.2, gain: 0.3, type: 'triangle' });
    }
  }

  /** Heals chime, never boom (gallery heal, synth path). */
  private abilityHeal(out: GainNode, t: number, palette: string): void {
    const base =
      palette === 'nature' || palette === 'venom' ? [392, 494, 587, 784] : [523, 659, 784, 1046];
    this.aPartials(out, t, { freqs: base, dur: 1.4, gain: 0.2, stagger: 0.09 });
    this.aNoise(out, t, { dur: 0.8, freq: 2600, gain: 0.06, type: 'highpass', attack: 0.25 });
  }

  /** CC lands as a soft poof, not a hit (gallery poof, synth path). */
  private abilityPoof(out: GainNode, t: number): void {
    this.aNoise(out, t, { dur: 0.2, freq: 2600, gain: 0.24, type: 'highpass' });
    this.aTone(out, t, { freq: 880, slide: 1500, dur: 0.18, gain: 0.12, type: 'triangle' });
  }

  /** One soft zone re-hit at the zone (earthquake rumble beats, rain ticks). */
  private abilityPulse(out: GainNode, t: number, palette: string, power: number): void {
    const I = Math.min(1.2, power);
    this.aNoise(out, t, { dur: 0.22, freq: 320, sweep: 120, gain: 0.18 * I });
    const chime =
      palette === 'frost' ||
      palette === 'moon' ||
      palette === 'holy' ||
      palette === 'gold' ||
      palette === 'arcane';
    if (chime) this.aTone(out, t, { freq: 1180, dur: 0.14, gain: 0.05 * I });
    else this.aNoise(out, t, { dur: 0.08, freq: 3800, gain: 0.05 * I, type: 'highpass' });
  }

  /** Crit sting layered over the impact (gallery crit extras, synth path). */
  private abilityCrit(out: GainNode, t: number, lite: boolean): void {
    this.aNoise(out, t, { dur: 0.08, freq: 8200, gain: 0.3, type: 'highpass' });
    if (!lite) this.aSub(out, t, { from: 60, to: 24, dur: 0.7, gain: 0.42, delay: 0.02 });
  }
}

export const sfx = new Sfx();
