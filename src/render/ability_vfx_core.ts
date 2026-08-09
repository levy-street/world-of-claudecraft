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

import { isFearAura } from '../sim/combat/cc';
import { ABILITIES } from '../sim/data';

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
// The persistent crowd-control tells: a worn hard-CC aura wears a held band
// for the aura's whole life. Three types today (stun, fear, root), each keyed
// off what the SIM says the victim is suffering, never the spec table, so
// every source (player abilities, mob stomps, ensnare affixes, traps) reads
// without authoring a spec. The sequencer's cast-moment ccStars band shares
// the stun geometry and the same time base and STANDS DOWN for any victim
// whose band actually WINS a draw slot this frame (heldCcBand on the
// SequencerHost seam): never a double draw, never a dip where the cast band's
// fade-out tail hides the held band's full alpha, and never a capped-out
// victim left with no overhead read at all. That stand-down is also what
// resolves the cast-moment COLOR collision: the 'cc' archetype flashes yellow
// stars for every control ability including roots and fears, so once a root or
// fear victim wears its own band, the misleading yellow burst yields to it
// within a frame instead of claiming the read.
//
// Hard CC is actionable information (the "why can't I act" read), so the
// painter feeds these outside the cast budget, no quality tier sheds them, and
// the alpha floor keeps them readable for the aura's whole life (the fade
// above the floor stays as the duration read).
//
// Scope note: these three are a scope choice, NOT a claim the remaining
// cannot-act kinds are uncovered. 'polymorph' genuinely is covered (the sheep
// rig keys off the kind, so both its sources read) and both 'stasis' ids carry
// a read (ice_block's shell, temporal_hourglass's own visual). The
// NON-fear incapacitates still wear nothing persistent: Gouge, Sap, Blind,
// Hibernate, Wyvern Sting, Startle Shot, Dragon's Breath and the staged-cone
// daze hold a victim in place and break on the first damage, which is a
// different read again ("hit me and this ends"), and giving that its own tell
// stays a separate design call.
export type CcBandType = 'stun' | 'fear' | 'root';

// Which atlas cell the band's sprites draw from, as the CELL NAME rather than
// the resolved index: the atlas lives in fx_textures.ts, which imports Three,
// and this core stays Three-free. The fx engine maps the name once.
export type CcBandCell = 'star' | 'glow' | 'spark';

export interface CcBandSpec {
  readonly type: CcBandType;
  // Draw priority when slots are scarce, lowest first. Ordered by how total
  // the lockout is: a stun means nothing you do matters, a fear means you are
  // being run around and cannot act (but damage may end it), a root still
  // leaves you casting and swinging. When one victim wears several, the most
  // severe is the one band drawn, which also settles the fact that a stunned
  // entity is ALWAYS also isRooted() in the sim.
  readonly severity: number;
  readonly count: number;
  readonly radius: number;
  // Height along the victim's own body: the fraction handed to the anchor
  // (1 = head, 0 = feet) plus a small world-space offset on top of it.
  readonly anchorFrac: number;
  readonly lift: number;
  readonly rate: number;
  readonly size: number;
  readonly brightness: number;
  readonly color: number;
  readonly alphaFloor: number;
  readonly cell: CcBandCell;
  // Vertical panic bob, in world units (0 = a flat ring). Driven off the
  // shared fx clock, so it stays deterministic.
  readonly wobble: number;
}

// Every band color is chosen for what it looks like AFTER the overbright
// additive draw clamps it, not on the swatch: a channel at or above
// 1 / brightness saturates to white. So the dominant channel is pushed up to
// clamp and the others held low, which is what keeps yellow from washing to
// white, violet from washing to pink, and green from washing to mint.
// The three read apart on TWO axes at once, color and motion signature, so the
// tell survives for a colorblind player: yellow stars ringing the head, violet
// wisps bobbing above it, green shards turning slowly at the ankles.
export const CC_BAND_SPECS: Readonly<Record<CcBandType, CcBandSpec>> = {
  // The classic dizzy-stars yellow, identical for every stun source: a tell
  // reads fastest when it looks the same no matter what applied it.
  stun: {
    type: 'stun',
    severity: 0,
    count: 4,
    radius: 0.45,
    anchorFrac: 1,
    lift: 0.55,
    rate: 2.4,
    size: 0.2,
    brightness: 2.2,
    color: 0xffd700,
    alphaFloor: 0.35,
    cell: 'star',
    wobble: 0,
  },
  // Fleeing dread: fewer, larger, faster wisps that bob rather than ride a
  // flat ring, because the victim is being run around and the silhouette
  // should say so from behind at distance.
  fear: {
    type: 'fear',
    severity: 1,
    count: 3,
    radius: 0.5,
    anchorFrac: 1,
    lift: 0.62,
    rate: 3.4,
    size: 0.26,
    brightness: 2,
    color: 0x6a1bff,
    alphaFloor: 0.35,
    cell: 'glow',
    wobble: 0.09,
  },
  // At the ANKLES, not overhead: a root says "my feet are stuck", which is a
  // different sentence from the head-space tells, and putting it at the base
  // keeps the two legible on the same screen without competing.
  //
  // The ring is WIDER than the head-space bands even though it reads smaller
  // on screen, and that is the whole difficulty of drawing at the base: an
  // overhead band orbits empty air, while a ground band orbits the widest
  // part of the victim. A first pass at radius 0.38 was fed, ranked, and
  // drawn every frame, and was still invisible in a capture, because the
  // sprites sat INSIDE a boar's body and the depth test buried them. The
  // ring has to clear the footprint of a broad quadruped, not just a
  // humanoid's ankles, and the extra lift keeps it off a sloping surface.
  root: {
    type: 'root',
    severity: 2,
    count: 4,
    radius: 0.85,
    anchorFrac: 0,
    lift: 0.12,
    rate: 1.1,
    size: 0.22,
    brightness: 2,
    color: 0x28e63c,
    alphaFloor: 0.35,
    cell: 'spark',
    wobble: 0,
  },
} as const;

// Back-compat aliases for the stun geometry the sequencer's cast-moment band
// shares. They are the stun spec's own fields, so the two bands cannot drift.
export const STUN_STAR_COUNT = CC_BAND_SPECS.stun.count;
export const STUN_STAR_RADIUS = CC_BAND_SPECS.stun.radius;
export const STUN_STAR_LIFT = CC_BAND_SPECS.stun.lift;
export const STUN_STAR_RATE = CC_BAND_SPECS.stun.rate;
export const STUN_STAR_SIZE = CC_BAND_SPECS.stun.size;
export const STUN_STAR_BRIGHTNESS = CC_BAND_SPECS.stun.brightness;
export const STUN_STAR_COLOR = CC_BAND_SPECS.stun.color;

// The overlay point cloud is one shared hard-capped batch (128 sprites for
// EVERY windup orb, orbit band, bolt head, and sequencer transient in the
// scene), so the held bands are bounded too: the fx engine draws the N
// best-ranked victims and no more. This is ONE budget across all three types,
// deliberately not one each: three separate caps of 8 would reach 96 of the
// 128 sprites and starve the other actionable reads (enemy windup telegraphs,
// worn-debuff bands) that draw after them. 8 bands at 3 to 4 sprites is at
// most 32, a quarter of the batch, so even a raid-wide mass CC cannot.
// A band that loses its slot is not silently dark: the sequencer's cast-moment
// ccStars stand down only for entities that actually WON a slot this frame, so
// a dropped band still reads through the cast-moment burst while one is
// running.
export const MAX_CC_BANDS = 8;

// Bands behind the camera sort after every band in front of it, so an
// on-screen victim can never lose its slot to one nobody can see. This
// matters for fairness, not just polish: character self-culling is only
// enabled on the tier that casts no sun shadow (GFX.dynamicShadows ->
// cullCharacters), so on medium and above EVERY controlled entity in interest
// range is fed, behind-camera ones included, while on low the offscreen
// non-actionable ones are slept before they ever compete. Ranking purely by
// camera distance would therefore let a medium-tier player lose an on-screen
// CC read that a low-tier player would keep, which is a preset conferring a
// disadvantage. The penalty exceeds any squared distance the world can
// produce (interest radius is ~120 yd, so dist2 tops out near 1.4e4).
export const CC_BAND_BEHIND_CAMERA_PENALTY = 1e9;
// Severity outranks distance outright: when slots are scarce a distant stun
// beats a nearby root, because the two tells do not carry equal weight to the
// player reading them. The stride clears the largest key severity 0 can
// produce (penalty + max dist2, about 1e9) by three orders of magnitude.
export const CC_BAND_SEVERITY_STRIDE = 1e12;
export function ccBandRankKey(severity: number, dist2: number, inFront: boolean): number {
  const within = inFront ? dist2 : dist2 + CC_BAND_BEHIND_CAMERA_PENALTY;
  return severity * CC_BAND_SEVERITY_STRIDE + within;
}

// Insert one candidate into a caller-owned fixed-capacity buffer kept
// ascending by rank key, dropping the worst entry once full. Returns the new
// count. Allocation-free and Three-free so the per-frame selection is a plain
// unit test; `ids` and `keys` are parallel and both at least `max` long.
export function insertCcBandPick(
  ids: number[],
  keys: number[],
  count: number,
  id: number,
  key: number,
  max: number,
): number {
  if (max <= 0) return 0;
  if (count >= max && key >= keys[max - 1]) return count;
  let i = Math.min(count, max - 1);
  while (i > 0 && keys[i - 1] > key) {
    ids[i] = ids[i - 1];
    keys[i] = keys[i - 1];
    i--;
  }
  ids[i] = id;
  keys[i] = key;
  return count < max ? count + 1 : count;
}

const abilityUsesFearDr = (abilityId: string): boolean => ABILITIES[abilityId]?.fearDr === true;

// The one band a victim wears this frame, or null when it wears no hard CC.
// One scan over the aura list, resolving BOTH which type wins (most severe,
// see CcBandSpec.severity) and how long that type has left (longest-remaining
// aura of the winning type, so a refresh or a second application extends the
// read rather than cutting it short).
//
// `remaining` is optional on the slice (mirrored auras always carry it): an
// aura without one counts as 1s so it still reads, and one at exactly 0 is
// already expiring and never picked. The fear arm resolves through the sim's
// own isFearAura rule, so the renderer never re-derives which incapacitates
// are fears; the ABILITIES lookup it needs runs only for incapacitate-kind
// auras, which are at most one or two per victim and rare, so the scan stays
// cheap enough to leave unmemoized.
export function wornCcBand(
  auras: readonly { id?: string; kind?: string; remaining?: number }[],
): { type: CcBandType; remaining: number } | null {
  let bestType: CcBandType | null = null;
  let bestSeverity = Number.POSITIVE_INFINITY;
  let bestRemaining = 0;
  for (let i = 0; i < auras.length; i++) {
    const a = auras[i];
    const rem = a.remaining ?? 1;
    if (rem <= 0) continue;
    let type: CcBandType | null = null;
    if (a.kind === 'stun') type = 'stun';
    else if (a.kind === 'root') type = 'root';
    else if (
      a.kind === 'incapacitate' &&
      isFearAura({ id: a.id ?? '', kind: a.kind }, abilityUsesFearDr)
    )
      type = 'fear';
    if (type === null) continue;
    const severity = CC_BAND_SPECS[type].severity;
    if (severity < bestSeverity || (severity === bestSeverity && rem > bestRemaining)) {
      bestType = type;
      bestSeverity = severity;
      bestRemaining = rem;
    }
  }
  return bestType === null ? null : { type: bestType, remaining: bestRemaining };
}

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
