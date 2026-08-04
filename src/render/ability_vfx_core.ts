// Pure planning core for the per-ability spell VFX system: turns an authored
// AbilityVfxSpec (src/render/ability_vfx_specs.ts) plus the render-budget vfx
// quality dial into a concrete draw plan the thin painter (ability_vfx.ts)
// feeds to the pooled Vfx primitives. Three/DOM-free and deterministic (same
// inputs, same plan), so tests/ability_vfx_core.test.ts drives it directly.
//
// Documented plan bounds (pinned by the test):
//   projScale in [0.5, 2] (heavy bolts reach the 2x cap)
//   volley in [1, 4]
//   burstCount in [4, 60] after the (0.4 + 0.6 * quality) scale; tier 2 <= 6
//   burstPower in (0, 1.6]
//   ringScale >= 0 (0 = no ring); NO tier drops the ring, the area telegraph
//   is actionable, not decoration

// Compact per-ability visual spec (key legend in ability_vfx_specs.ts header):
// c=color p=palette pw=power sp=sparks rg=ringScale vr=vRing db=debris
// sm=smoke bl=blood li=lightScale b=bolt{v:speed,h:headScale,j:jagged,
// co:coils,vl:volley} bo=buffOrbit lg=linger wu=windup spin fin a=archetype.
export interface AbilityVfxSpec {
  c: string;
  p?: string;
  pw?: number;
  sp?: number;
  rg?: number;
  vr?: 1;
  db?: 1;
  sm?: 1;
  bl?: 1;
  li?: number;
  b?: { v?: number; h?: number; j?: 1; co?: 1; vl?: number };
  bo?: string;
  lg?: number;
  wu?: number;
  spin?: 1;
  fin?: 1;
  a?: string;
}

// The COMPLETE per-ability spec, mirrored 1:1 from the gallery source of truth
// (feature/ability-vfx-gallery ability_specs.js). The compact AbilityVfxSpec
// above stays the planning/budget projection; this full shape drives the
// archetype sequencer (src/render/ability_vfx/sequencer.ts). Data lives in
// src/render/ability_vfx_full_specs.ts (generated, one line per ability).
export type AbilityVfxArchetype =
  | 'bolt'
  | 'burst'
  | 'strike'
  | 'nova'
  | 'beam'
  | 'dot'
  | 'heal'
  | 'buff'
  | 'shout'
  | 'summon'
  | 'cc'
  | 'dash';

export type AbilityVfxWindupStyle =
  | 'none'
  | 'stance'
  | 'vortex'
  | 'weapon'
  | 'orb'
  | 'runes'
  | 'ascend';

export type AbilityVfxMotif =
  | 'fissure'
  | 'pillars'
  | 'chains'
  | 'bladestorm'
  | 'barrier'
  | 'swarm'
  | 'implosion'
  | 'claws'
  | 'crescents'
  | 'fountain'
  | 'gavel'
  | 'orbitals'
  | 'vines'
  | 'cross';

export interface AbilityVfxImpactSpec {
  trail?: 'arc' | 'sweep' | 'low' | 'riposte' | 'x' | 'overhead';
  sparks?: number;
  light?: number;
  flipbook?: boolean;
  ring?: number | boolean;
  vRing?: boolean | number;
  debris?: boolean;
  smoke?: boolean;
  // blood spray at contact: true = the standard burst, a number multiplies
  // its particle count (Bleed Out's louder application read)
  blood?: boolean | number;
  liteAudio?: boolean;
  sample?: string;
}

export interface AbilityVfxBuffSpec {
  style?: 'raise' | 'morph' | 'veil';
  orbit?: string;
  // While the buff aura (aura id == ability id) is worn, the held mainhand
  // weapon itself wears a translucent additive overlay in this '#rrggbb'
  // color for the aura's FULL duration - the imbued-blade read (Sanguine
  // Blade's blood soak, the shaman weapon imbues). Resolved per frame by
  // characterWeaponAura (src/render/character_effects.ts) and rendered by
  // the visual's rebuildWeaponAura clone-mesh overlay.
  weaponAura?: string;
  // 'tip' scopes the overlay to the far end of the blade (a vertex-alpha
  // ramp toward the point): Adder's Bite's green-tipped dagger against
  // Festering Venom's full-blade soak. Absent = the whole weapon.
  weaponAuraScope?: 'tip';
  // Authored opt-out of the long-buff policy: a buff worn for
  // LONG_BUFF_VFX_SECONDS or more holds no orbit band, ground disc, or shell
  // unless it morphs/veils or sets persist (ability_vfx_longbuff_core.ts owns
  // the rule; the policy test pins the silenced set).
  persist?: boolean;
  shellDur?: number;
  o?: {
    rate?: number;
    tickEvery?: number;
    bpm?: number;
    ringR?: number;
    density?: number;
    spread?: number;
    up?: number;
    n?: number;
    size?: number;
    tex?: string;
    weave?: number;
    radius?: number;
    incline?: number;
    ribs?: number;
    span?: number;
    flapRate?: number;
  };
}

export interface AbilityVfxFullSpec {
  archetype: AbilityVfxArchetype;
  palette: string;
  power?: number;
  windup?: number;
  windupStyle?: AbilityVfxWindupStyle;
  motifs?: AbilityVfxMotif[];
  motifAt?: 'target' | 'caster';
  motifEvery?: number;
  motifR?: number;
  impact?: AbilityVfxImpactSpec;
  bolt?: {
    speed?: number;
    headScale?: number;
    style?: 'rock' | 'shard' | 'comet' | 'arrow' | 'wisp';
    coils?: boolean;
    jagged?: boolean;
    forkEvery?: number;
    volley?: number;
    tracer?: boolean;
    leader?: boolean;
  };
  strike?: {
    swings?: number;
    // 'wire' is the strangle read (Throat Wire): a taut silver filament at
    // the CASTER's raised hands plus a throat-height constriction beat on the
    // victim - never the sword-sweep ribbon the other arcs draw.
    arc?:
      | 'horizontal'
      | 'thrust'
      | 'uppercut'
      | 'vertical'
      | 'claws'
      | 'bite'
      | 'low'
      | 'sweep'
      | 'wire';
    bleed?: boolean;
    groundSlam?: boolean;
    stars?: boolean;
  };
  nova?: { radius?: number };
  beam?: { dur?: number; ticks?: number; drain?: boolean };
  dot?: { drip?: 'rise' | 'fall' };
  // 'dust' is the flung-dirt read (Dirt Toss): a khaki grit cone thrown from
  // the caster's hand into the victim's face, plus the stunned-star band.
  cc?: { style?: 'poof' | 'stars' | 'tendrils' | 'dust' };
  shout?: { radius?: number; target?: boolean };
  burst?: { style?: 'skybeam' | 'link' | 'ground' };
  buff?: AbilityVfxBuffSpec;
  // Worn by the VICTIM while the ability's hostile aura lives (resolved
  // through the painter's aura suffix map, e.g. hamstring_slow): only orbit +
  // o are read - a debuff band never grants the buff ground-disc, caster
  // glow, gain swirl, or shell that a buff block implies.
  debuff?: Pick<AbilityVfxBuffSpec, 'orbit' | 'o'>;
  spin?: { rate?: number; clip?: string; timeScale?: number };
  spirit?: {
    model?: string;
    path?: string;
    at?: string;
    scale?: number;
    dur?: number;
    tint?: string;
    dim?: number;
  } | null;
  barrier?: boolean;
  shaft?: number | boolean;
  screenFx?: boolean;
  linger?: number;
  rim?: string;
  tint?: string;
  accent?: string | number;
  hot?: number;
  decal?: 'crack' | 'scorch' | 'rune' | 'portal';
  finisher?: boolean;
  self?: boolean;
}

// What the painter needs to drive one cast or impact through the pooled Vfx.
export interface AbilityVfxPlan {
  color: number;
  projScale: number;
  jagged: boolean;
  volley: number;
  burstCount: number;
  burstPower: number;
  ringScale: number;
  light: number;
  swirlColor: number;
  sparkleColor: number;
  whirl: boolean;
}

export const PROJ_SCALE_MIN = 0.5;
export const PROJ_SCALE_MAX = 2;
export const VOLLEY_MAX = 4;
export const BURST_COUNT_MIN = 4;
export const BURST_COUNT_MAX = 60;
export const BURST_POWER_MAX = 1.6;
export const TIER2_BURST_COUNT_MAX = 6;

const colorCache = new Map<string, number>();
const HEX_COLOR_RE = /^#([0-9a-fA-F]{6})$/;

// Parse any '#rrggbb' spec color string to an int, cached (white on a
// malformed value so a bad row degrades visibly instead of throwing at frame
// rate). Shared by the compact c color and the full spec's rim/tint/accent.
export function abilityHexColor(value: string): number {
  const cached = colorCache.get(value);
  if (cached !== undefined) return cached;
  const match = HEX_COLOR_RE.exec(value);
  const parsed = match ? Number.parseInt(match[1], 16) : 0xffffff;
  colorCache.set(value, parsed);
  return parsed;
}

// The compact spec's main color.
export function abilityVfxColor(spec: AbilityVfxSpec): number {
  return abilityHexColor(spec.c);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 1;
}

// Mix a channel toward white: the swirl reads brighter than the raw spec color.
function lighten(color: number, amount: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const lr = Math.min(255, Math.round(r + (255 - r) * amount));
  const lg = Math.min(255, Math.round(g + (255 - g) * amount));
  const lb = Math.min(255, Math.round(b + (255 - b) * amount));
  return (lr << 16) | (lg << 8) | lb;
}

function scaledBurstCount(base: number, quality: number, tier: number): number {
  let count = base * (0.4 + 0.6 * quality);
  if (tier === 1) count *= 0.5;
  count = Math.round(clamp(count, BURST_COUNT_MIN, BURST_COUNT_MAX));
  return tier >= 2 ? Math.min(count, TIER2_BURST_COUNT_MAX) : count;
}

function buildPlan(
  spec: AbilityVfxSpec,
  quality: number,
  tier: number,
  burstCount: number,
  burstPower: number,
): AbilityVfxPlan {
  const color = abilityVfxColor(spec);
  const pw = spec.pw ?? 1;
  return {
    color,
    projScale: clamp((spec.b?.h ?? 1) * (0.7 + 0.3 * pw), PROJ_SCALE_MIN, PROJ_SCALE_MAX),
    jagged: spec.b?.j === 1,
    volley: tier >= 2 ? 1 : Math.round(clamp(spec.b?.vl ?? 1, 1, VOLLEY_MAX)),
    burstCount,
    burstPower,
    // The area ring is the ground-effect TELEGRAPH: a player reads it and moves
    // out of it, so it survives every degrade tier. Tier 2 sheds decoration
    // (bursts, volleys, light) and keeps the actionable read, which is the
    // graphics-fairness rule applied to the spam guard: two players in the same
    // fight must have the same information to act on, whatever their preset or
    // however busy the second is (docs/design/graphics-settings-fairness.md).
    ringScale: spec.rg ?? 0,
    light: tier >= 2 ? 0 : (spec.li ?? 0) * (0.4 + 0.6 * quality),
    swirlColor: lighten(color, 0.25),
    sparkleColor: color,
    whirl: spec.spin === 1,
  };
}

// Plan the cast-moment visual (projectile launch, shout wave, nova, tick).
// quality is the render-budget vfx dial in [0, 1]; tier is the spam-guard
// degrade level from AbilityVfxBudget.admit (0 full, 1 reduced counts but the
// ring survives, 2 color-only minimal).
export function planCast(spec: AbilityVfxSpec, quality: number, tier = 0): AbilityVfxPlan {
  const q = clamp01(quality);
  const pw = spec.pw ?? 1;
  const burstPower = tier >= 2 ? 1 : clamp(pw, 0.1, BURST_POWER_MAX);
  return buildPlan(spec, q, tier, scaledBurstCount(spec.sp ?? 14, q, tier), burstPower);
}

// Plan the impact accent (a landed hit): a reduced-count burst so impacts read
// distinctly from the cast without doubling its particle cost.
export function planImpact(
  spec: AbilityVfxSpec,
  crit: boolean,
  quality: number,
  tier = 0,
): AbilityVfxPlan {
  const q = clamp01(quality);
  const pw = spec.pw ?? 1;
  const base = (spec.sp ?? 14) * 0.35 * (crit ? 1.6 : 1);
  const burstPower = tier >= 2 ? 1 : clamp(pw * (crit ? 1.25 : 0.85), 0.1, BURST_POWER_MAX);
  const plan = buildPlan(spec, q, tier, scaledBurstCount(base, q, tier), burstPower);
  plan.ringScale = 0; // impacts never flash the area ring; that is the cast's job
  return plan;
}

// Rolling-second spam guard. Pure math with injected time (nowSec in seconds).
// It exists to keep raid crowds sane, never to strip a solo player's rotation,
// so it holds two independent windows:
//   Cast window, at most GLOBAL_CAP planned casts per rolling second across
//   all casters and CASTER_CAP per caster run at full fidelity; the next band
//   runs reduced (tier 1) and past double either cap everything is color-only
//   (tier 2). Only a cast-claiming event charges it (via admit); follow-through
//   visuals of the same cast read the tier with peek, which never records.
//   Accent window, landed-hit accents, auto-attack polish, and zone-pulse
//   re-hits share a flat ACCENT_CAP per rolling second (admitAccent) and never
//   consume a cast slot, so a normal rotation of casts + its own hits + autos
//   stays tier 0 indefinitely.
// Fixed-size ring buffers of timestamps: zero allocation in steady state (one
// small window object is allocated the first time a caster is seen, then
// reused; stale casters are pruned in place once the map grows).
export const ABILITY_VFX_GLOBAL_CAP = 20;
// Casts only (hits and autos ride the accent window): a fast solo rotation is
// ~1-2 casts/s, so 6 leaves room for proc bursts without ever degrading.
export const ABILITY_VFX_CASTER_CAP = 6;
export const ABILITY_VFX_ACCENT_CAP = 8;
const WINDOW_SEC = 1;
const GLOBAL_RING = ABILITY_VFX_GLOBAL_CAP * 2;
const CASTER_RING = ABILITY_VFX_CASTER_CAP * 2;
const PRUNE_ABOVE = 64;

// The local player's own casts are the LAST thing degraded: under spam they
// read one tier better (still bounded by the same global window, tier 2 spam
// leaves them reduced, never exempt).
export function localCasterTier(tier: 0 | 1 | 2): 0 | 1 | 2 {
  return tier > 0 ? ((tier - 1) as 0 | 1) : 0;
}

interface CasterWindow {
  times: Float64Array;
  head: number;
}

export class AbilityVfxBudget {
  private globalTimes = new Float64Array(GLOBAL_RING).fill(Number.NEGATIVE_INFINITY);
  private globalHead = 0;
  private casters = new Map<number, CasterWindow>();
  private accentTimes = new Float64Array(ABILITY_VFX_ACCENT_CAP).fill(Number.NEGATIVE_INFINITY);
  private accentHead = 0;

  // Returns the degrade tier for one planned cast and records it (tier 2 casts
  // draw next to nothing, so they are not recorded and cannot pin the window).
  admit(casterId: number, nowSec: number): 0 | 1 | 2 {
    const cutoff = nowSec - WINDOW_SEC;
    const global = liveCount(this.globalTimes, cutoff);
    let caster = this.casters.get(casterId);
    if (!caster) {
      if (this.casters.size >= PRUNE_ABOVE) this.prune(cutoff);
      caster = { times: new Float64Array(CASTER_RING).fill(Number.NEGATIVE_INFINITY), head: 0 };
      this.casters.set(casterId, caster);
    }
    const own = liveCount(caster.times, cutoff);
    if (global >= GLOBAL_RING || own >= CASTER_RING) return 2;
    this.globalTimes[this.globalHead] = nowSec;
    this.globalHead = (this.globalHead + 1) % GLOBAL_RING;
    caster.times[caster.head] = nowSec;
    caster.head = (caster.head + 1) % CASTER_RING;
    return global >= ABILITY_VFX_GLOBAL_CAP || own >= ABILITY_VFX_CASTER_CAP ? 1 : 0;
  }

  // The tier admit WOULD return, recording nothing: follow-through visuals of
  // an already-charged cast (its landing, its contact hit, its zone pulses)
  // match the cast's degrade level without charging the window again.
  peek(casterId: number, nowSec: number): 0 | 1 | 2 {
    const cutoff = nowSec - WINDOW_SEC;
    const global = liveCount(this.globalTimes, cutoff);
    const caster = this.casters.get(casterId);
    const own = caster ? liveCount(caster.times, cutoff) : 0;
    if (global >= GLOBAL_RING || own >= CASTER_RING) return 2;
    return global >= ABILITY_VFX_GLOBAL_CAP || own >= ABILITY_VFX_CASTER_CAP ? 1 : 0;
  }

  // One slot of the flat accent window (landed-hit accents, auto-attack
  // polish, zone-pulse re-hits). True = draw it; false = this second is
  // already saturated with accents. Never touches the cast window.
  admitAccent(nowSec: number): boolean {
    const cutoff = nowSec - WINDOW_SEC;
    if (liveCount(this.accentTimes, cutoff) >= ABILITY_VFX_ACCENT_CAP) return false;
    this.accentTimes[this.accentHead] = nowSec;
    this.accentHead = (this.accentHead + 1) % ABILITY_VFX_ACCENT_CAP;
    return true;
  }

  private prune(cutoff: number): void {
    for (const [id, slot] of this.casters) {
      if (liveCount(slot.times, cutoff) === 0) this.casters.delete(id);
    }
  }
}

function liveCount(times: Float64Array, cutoff: number): number {
  let n = 0;
  for (let i = 0; i < times.length; i++) {
    if (times[i] > cutoff) n++;
  }
  return n;
}
