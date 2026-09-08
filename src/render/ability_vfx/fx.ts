import * as THREE from 'three';
import type { MeleeAudioId } from '../../fury_audio_core';
import type { SimEvent } from '../../sim/types';
import {
  type AbilityVfxBuffSpec,
  type AbilityVfxFullSpec,
  abilityHexColor,
  CC_BAND_SPECS,
  type CcBandSpec,
  type CcBandType,
  ccBandRankKey,
  insertCcBandPick,
  MAX_CC_BANDS,
} from '../ability_vfx_core';
import type { AbilityAudioKind, AbilityAudioOpts } from '../audio_sink';
import type { ControlSubject } from '../combat_status_core';
import { CombatStatusSignals } from '../combat_status_signals';
import { drawRestorativeStream } from '../restorative_water';
import type { WarriorFuryStateAura, WarriorFuryStateKind } from '../warrior_fury_state_core';
import type { WarriorPowerAnchor } from '../warrior_power_anchor';
import type { WarriorPowerIntent, WarriorPowerKind } from '../warrior_power_core';
import type { WeaponAnchorSampler } from '../weapon_trail_anchor';
import { cancelActiveAbilityKit } from './active_kit_prewarm';
import { BakedImpactLayers } from './baked_impact_layers';
import { drawClassCast, hasClassCast } from './cast_language';
import { isContactSheet } from './contact_assets';
import type { CrestPrewarmHost } from './crest_prewarm';
import { type DecalStyle, GroundDecals } from './decals';
import { ElementalForms } from './elemental_forms';
import { ElementalContactMemory, elementalPerformance } from './elemental_performance_core';
import { asFlipbookStyle, ImpactFlipbooks } from './flipbooks';
import { FuryAudioQueue } from './fury_audio';
import { abilityVfxTextures, OVERLAY_CELL } from './fx_textures';
import { GroundAuras } from './ground_auras';
import { HeldConduction } from './held_conduction';
import { HeldWarriorStorm } from './held_warrior_storm';
import { OverlaySprites } from './overlay_sprites';
import { LightPillars } from './pillars';
import type { BakedKind, FragmentKind } from './production_assets';
import {
  AbilityVfxRibbons,
  type BoltTrailStyle,
  type PathMotion,
  type RibbonAnchor,
} from './ribbons';
import { ShockRings } from './rings';
import { ArchetypeSequencer, type SeqPoint, type SequencerHost } from './sequencer';
import { BuffShells } from './shells';
import { chargeEnvelope, SIGNATURE_CONTACT_TIME, type Substance } from './signature_core';
import { SignatureCrests } from './signature_crests';
import { SignatureDetails } from './signature_details';
import type { CrestKind } from './signature_shapes';
import { solarExecution } from './solar_execution';
import { SolidImpactFragments } from './solid_impact_fragments';
import { SPECTACLE, usesCrescendoScale } from './spectacle';
import {
  asSpiritPath,
  SpiritApparitions,
  type SpiritAtKind,
  type SpiritBuildScheduler,
  type SpiritCompileGate,
} from './spirits';
import type { SteelSweepRange } from './steel_sweep';
import { WarriorAttention } from './warrior_attention';
import { drawBloodlettingRecovery } from './warrior_fury_feedback';
import { WarriorFuryStates } from './warrior_fury_states';
import {
  type WarriorGuardAura,
  type WarriorGuardKind,
  WarriorGuardPlates,
} from './warrior_guard_plates';
import { WarriorPowerForms } from './warrior_power_forms';
import { drawWarriorWornMark } from './warrior_worn_marks';
import { RestorativeWaterVolumes } from './water_volumes';

export type { DecalStyle } from './decals';

// Particle bursts delegate to the pooled Vfx cloud through this seam (the
// painter wires deps.vfx.burst in); kind picks the sprite family.
export type ParticleBurstKind = 'sparks' | 'embers' | 'debris' | 'smoke' | 'blood';
export type ParticleBurst = (
  x: number,
  y: number,
  z: number,
  colorHex: number,
  count: number,
  power: number,
  kind: ParticleBurstKind,
  duration?: number,
) => void;

const camPosScratch = new THREE.Vector3();
const camRightScratch = new THREE.Vector3();
const camFwdScratch = new THREE.Vector3();
// Per-frame anchor scratch (see ../vfx_anchor.ts). Three separate ones because
// the per-frame draws below hold up to two readings at once (a windup's feet
// AND head), and the sequencer host delegate must not clobber a reading its
// caller is still holding.
const anchorScratchA = new THREE.Vector3();
const anchorScratchB = new THREE.Vector3();
const hostAnchorScratch = new THREE.Vector3();

// The Three-side engine of the per-ability VFX system: owns the pooled
// primitive families ported from the Ability VFX Gallery (ribbon trails, shock
// rings, ground decals, overlay sprites) plus the per-frame windup-orb and
// buff-orbit state. The AbilityVfx painter decides WHAT to draw from the spec
// table; this class only knows HOW. Every pool has a hard cap and allocates
// nothing in steady state; per-entity windup/orbit entries allocate once on
// gain and are swept by frame stamp when the entity stops casting or the aura
// drops.

export type OrbitStyle =
  | 'wardCharges'
  | 'halo'
  | 'sparks'
  | 'runes'
  | 'plates'
  | 'wings'
  | 'heartbeat'
  | 'speedlines'
  | 'conduction'
  | 'weaponGlow'
  | 'bladeCharges'
  | 'breachMark'
  | 'quakeBurden'
  | 'leaves';

const ORBIT_STYLE_SET = new Set<string>([
  'wardCharges',
  'halo',
  'sparks',
  'runes',
  'plates',
  'wings',
  'heartbeat',
  'speedlines',
  'conduction',
  'weaponGlow',
  'leaves',
]);

// Resolve an authored buff-orbit name ('none', unknown, or absent ? null).
export function asOrbitStyle(v: string | null | undefined): OrbitStyle | null {
  return v != null && ORBIT_STYLE_SET.has(v) ? (v as OrbitStyle) : null;
}

// The full spec's per-buff orbit DNA (buff.o): count/size/tex/rate/weave/
// radius/incline for the circular bands, bpm/ringR for heartbeat, ribs/span/
// flapRate for wings, density/spread/up for leaves.
export type OrbitDna = NonNullable<AbilityVfxBuffSpec['o']>;
// Private identity marker: shares the existing held-band budget, but draws only
// at the real weapon tip. It never enters the decorative orbit path.
const QUEUED_WEAPON_DNA: OrbitDna = Object.freeze({ radius: 0, size: 0.16 });
const BLADE_CHARGE_DNA: readonly OrbitDna[] = [Object.freeze({ n: 1 }), Object.freeze({ n: 2 })];

const MAX_ORBITS_PER_ENTITY = 3;
const MAX_ORBIT_BANDS = 24;
const MAX_ORBIT_SPRITES = 8;
// The buff-swirl decoration motes vanish below this governed vfx level. Every
// tier's vfx floor must stay ABOVE it (tests/vfx_mote_floor.test.ts): a floor
// at or under the gate would silently extinguish the motes at full degradation.
export const MOTE_QUALITY_GATE = 0.5;
// Windup ceremonies are a few overlay sprites each; a busy hub full of casters
// should keep them all. The local player is additionally guaranteed a slot
// (windup's priority flag evicts the oldest other entry when saturated).
const MAX_WINDUPS = 24;

// The gallery windup lean magnitude (updateBodyFeel: -0.085 rad at full charge).
const WINDUP_LEAN_RAD = 0.085;

// Cap on the one-shot buff-application glow pulse (fx.glowPulse): applied rig
// emissive peaks at min(0.85, 0.9 * 0.38) ? 0.34 and fast-decays to nothing in
// ~0.4s. Sustained body tint is reserved for cast windups and the morph/
// ultimate rims the painter grants explicitly.
const BUFF_APPLICATION_PULSE_MAX = 0.9;

// Honor spec.screenFx the gallery way: authored false opts out, authored true
// forces it, and by default the crescendo impacts (the gallery ripples+flashes
// EVERY landed hit), finishers, and big novas touch the screen. Tier 0 only
// (budget tiers degrade spam first), the post pass pools 4 ripples and clamps
// the flash at 0.4, and screenFxAt applies camera-distance falloff - so a
// crowded fight still never strobes.
function wantsScreenFx(spec: AbilityVfxFullSpec, tier: number): boolean {
  if (tier !== 0 || spec.screenFx === false) return false;
  if (spec.screenFx === true) return true;
  return (
    usesCrescendoScale(spec) ||
    spec.finisher === true ||
    (spec.archetype === 'nova' && (spec.nova?.radius ?? 5) >= 7)
  );
}

// Ripple+flash strength for a sequence's landing: crescendo impacts ride the
// spectacle constants (gallery-scale), everything else keeps the gentle ask.
function screenFxStrengthOf(spec: AbilityVfxFullSpec): number {
  if (!usesCrescendoScale(spec)) return spec.finisher ? 1 : 0.8;
  return spec.finisher ? SPECTACLE.screenFxFinisher : SPECTACLE.screenFx;
}

interface OrbitBand {
  style: OrbitStyle;
  colorHex: number;
  // authored DNA overrides (a stable reference into the spec table; never
  // mutated, never allocated per frame)
  o: OrbitDna | undefined;
  // degrade tier refreshed by the painter each frame: >= 1 halves sprite count
  tier: number;
  phase: number;
  age: number;
  // heartbeat only: the band age of the next chest pulse
  beat: number;
  stamp: number;
  weaponSample: ((out: THREE.Vector3) => boolean) | null;
  weaponRetryAt: number;
}

export type WindupStyle =
  | 'spring'
  | 'psionic'
  | 'lunar'
  | 'quiver'
  | 'scripture'
  | 'conduction'
  | 'bough'
  | 'solar'
  | 'occult'
  | 'none'
  | 'orb'
  | 'runes'
  | 'vortex'
  | 'compression'
  | 'ascend'
  | 'stance'
  | 'weapon';

const WINDUP_STYLE_SET = new Set<string>([
  'spring',
  'psionic',
  'lunar',
  'quiver',
  'scripture',
  'conduction',
  'bough',
  'solar',
  'occult',
  'none',
  'orb',
  'runes',
  'vortex',
  'compression',
  'ascend',
  'stance',
  'weapon',
]);

interface WindupState {
  colorHex: number;
  accentHex: number;
  progress: number;
  style: WindupStyle;
  streams: number;
  stamp: number;
}

// Per-style orbit DNA defaults (gallery band discipline: halo crowns the
// HEAD, sparks orbit the SHOULDERS, plates ring the WAIST, runes circle the
// ANKLES, speedlines blur the LEGS, wings fan from the BACK, weaponGlow rides
// the HAND, leaves rise as a COLUMN, heartbeat thumps off the CHEST - every
// band stacks without collision). buff.o overrides these per ability. For the
// bespoke styles the generic fields are reinterpreted: wings rate=flapRate
// radius=span n=ribs; heartbeat radius=ringR; leaves rate=riseSpeed
// radius=spread; speedlines radius=streakLength.
const ORBIT_DNA: Record<
  OrbitStyle,
  {
    n: number;
    rate: number;
    radius: number;
    weave: number;
    frac: number;
    size: number;
    cell: number;
  }
> = {
  halo: {
    n: 3,
    rate: 0.8,
    radius: 0.42,
    weave: 0.08,
    frac: 1.02,
    size: 0.26,
    cell: OVERLAY_CELL.star,
  },
  sparks: {
    n: 3,
    rate: 2.6,
    radius: 0.72,
    weave: 0.16,
    frac: 0.62,
    size: 0.3,
    cell: OVERLAY_CELL.spark,
  },
  runes: {
    n: 4,
    rate: 1.1,
    radius: 0.95,
    weave: 0.08,
    frac: 0.08,
    size: 0.32,
    cell: OVERLAY_CELL.rune,
  },
  plates: {
    n: 4,
    rate: 0.9,
    radius: 0.9,
    weave: 0.1,
    frac: 0.45,
    size: 0.5,
    cell: OVERLAY_CELL.glow,
  },
  wings: {
    n: 5,
    rate: 1.3,
    radius: 1,
    weave: 0.3,
    frac: 0.72,
    size: 0.24,
    cell: OVERLAY_CELL.glow,
  },
  heartbeat: {
    n: 1,
    rate: 1,
    radius: 1.5,
    weave: 0,
    frac: 0.58,
    size: 0.22,
    cell: OVERLAY_CELL.glow,
  },
  speedlines: {
    n: 3,
    rate: 1,
    radius: 0.9,
    weave: 0,
    frac: 0.3,
    size: 0.13,
    cell: OVERLAY_CELL.glow,
  },
  conduction: {
    n: 4,
    rate: 2,
    radius: 0.55,
    weave: 0,
    frac: 0.65,
    size: 0.2,
    cell: OVERLAY_CELL.spark,
  },
  wardCharges: {
    n: 3,
    rate: 2,
    radius: 0.7,
    weave: 0,
    frac: 0.65,
    size: 0.3,
    cell: OVERLAY_CELL.spark,
  },
  weaponGlow: {
    n: 1,
    rate: 1,
    radius: 0,
    weave: 0,
    frac: 0.46,
    size: 0.24,
    cell: OVERLAY_CELL.star,
  },
  bladeCharges: {
    n: 2,
    rate: 0,
    radius: 0,
    weave: 0,
    frac: 0.46,
    size: 0.2,
    cell: OVERLAY_CELL.star,
  },
  breachMark: {
    n: 8,
    rate: 0,
    radius: 0,
    weave: 0,
    frac: 0.36,
    size: 0.16,
    cell: OVERLAY_CELL.spark,
  },
  quakeBurden: {
    n: 8,
    rate: 0,
    radius: 0,
    weave: 0,
    frac: 0.36,
    size: 0.16,
    cell: OVERLAY_CELL.spark,
  },
  leaves: {
    n: 6,
    rate: 0.4,
    radius: 0.9,
    weave: 0,
    frac: 0.04,
    size: 0.17,
    cell: OVERLAY_CELL.glow,
  },
};

// Gallery ORBIT_TEX names mapped onto the overlay atlas's four cells (chip ?
// spark is the closest fragment read; rays ? star; paw ? rune glyph).
const ORBIT_TEX_CELL: Record<string, number | undefined> = {
  star: OVERLAY_CELL.star,
  glow: OVERLAY_CELL.glow,
  chip: OVERLAY_CELL.spark,
  rays: OVERLAY_CELL.star,
  paw: OVERLAY_CELL.rune,
};

// Tier 1 keeps the orbit read but halves the sprite count.
function orbitCount(n: number, halve: boolean): number {
  return halve ? Math.max(1, Math.ceil(n / 2)) : n;
}

// The gallery's palette-default projectile silhouette (PROJ_DEFAULT): specs
// that author no bolt style still read as their school's shape.
const PROJ_STYLE_BY_PALETTE: Record<string, BoltTrailStyle> = {
  fire: 'rock',
  blood: 'rock',
  frost: 'shard',
  moon: 'shard',
  shadow: 'wisp',
  venom: 'wisp',
};

export class AbilityVfxFx implements SequencerHost {
  private ribbons: AbilityVfxRibbons;
  private water: RestorativeWaterVolumes;
  private details: SignatureDetails;
  private forms: ElementalForms;
  private readonly contacts = new ElementalContactMemory();
  private worldLightCb:
    | ((
        at: THREE.Vector3,
        school: string,
        intensity: number,
        duration: number,
        range: number,
      ) => void)
    | null = null;
  private readonly lightPoint = new THREE.Vector3();
  private crests: SignatureCrests;
  private guards: WarriorGuardPlates;
  private powerForms: WarriorPowerForms;
  private furyStates: WarriorFuryStates;
  private guardDt = 0;
  private guardFacing = (id: number) => this.facingAt(id) ?? null;
  private rings: ShockRings;
  private decals: GroundDecals;
  private overlay: OverlaySprites;
  private pillars: LightPillars;
  private shells: BuffShells;
  private controlSignals: CombatStatusSignals;
  private groundAuras: GroundAuras;
  private flipbooks: ImpactFlipbooks;
  private spirits: SpiritApparitions;
  private windups = new Map<number, WindupState>();
  private orbits = new Map<number, OrbitBand[]>();
  private orbitBandCount = 0;
  // Persistent crowd-control bands (holdCcBand), one entry per controlled
  // entity, frame-stamp swept exactly like windups/orbits. Drawn for at most
  // the MAX_CC_BANDS best-ranked entities per frame across ALL band types (the
  // fixed pick arrays are the selection scratch, reused every frame). hx/hy/hz
  // cache the frame's resolved body anchor so the draw never re-resolves it
  // (the renderer's anchor delegate allocates a Vector3 per call); which end of
  // the body that anchor is comes from the band spec's anchorFrac, so the root
  // band rides the ankles while the stun and fear bands ride the head.
  private ccBands = new Map<
    number,
    { type: CcBandType; remaining: number; stamp: number; hx: number; hy: number; hz: number }
  >();
  private ccPickIds: number[] = new Array(MAX_CC_BANDS).fill(0);
  private ccPickKeys: number[] = new Array(MAX_CC_BANDS).fill(0);
  private ccPickCount = 0;
  private time = 0;
  private reducedMotionActive = false;
  private frame = 0;
  private qualityLevel = 1;
  // Camera-right on the ground plane, refreshed once per update: entities
  // expose no facing through the anchor seam, so wings fan and speedlines
  // streak across the SCREEN - the silhouette always reads.
  private camRightX = 1;
  private camRightZ = 0;
  private particleBurst: ParticleBurst | null = null;
  private lightPulseCb:
    | ((
        entityId: number,
        palette: string,
        intensity: number,
        duration: number,
        range?: number,
      ) => void)
    | null = null;
  private statSink: ((abilityId: string, n: number) => void) | null = null;
  private applyGlow: ((entityId: number, colorHex: number, intensity: number) => void) | null =
    null;
  private shakeCb: ((amount: number, x?: number, y?: number, z?: number) => void) | null = null;
  private bodyLeanCb: ((entityId: number, amount: number) => void) | null = null;
  private screenImpactCb: ((x: number, y: number, z: number, strength: number) => void) | null =
    null;
  private abilityAudioCb:
    | ((
        kind: AbilityAudioKind,
        palette: string,
        power: number,
        x: number,
        y: number,
        z: number,
        opts?: AbilityAudioOpts,
      ) => void)
    | null = null;
  // Deferred screen-fx beats for instant sequences (impact = release + 0.15s):
  // fixed slots, world- or entity-anchored, resolved when they fire. The cap
  // doubles as the anti-strobe guard - saturated beats simply drop.
  private screenFxQueue = Array.from({ length: 4 }, () => ({
    t: 0,
    entityId: -1,
    x: 0,
    y: 0,
    z: 0,
    strength: 0,
    active: false,
  }));
  // Rolling shake budget: recent trauma adds decay over time, and shakeAt only
  // grants what remains under the cap, so a spam fight can never stack the
  // camera into a constant rumble.
  private shakeRecent = 0;
  private baked: BakedImpactLayers;
  private fragments: SolidImpactFragments;
  private sequencer = new ArchetypeSequencer();
  // Body-glow envelopes (the gallery casterGlowV): attack fast while fed each
  // frame, decay 0.9/s for held-shell buffs else 2.2/s once the source drops.
  private glows = new Map<
    number,
    { color: number; target: number; level: number; slow: boolean; stamp: number }
  >();
  // Stable sink for the styled bolt heads (ribbons.drawHeads pushes through
  // it into the frame's overlay batch); one closure for the object's lifetime.
  private readonly furyAudio = new FuryAudioQueue();
  private disposed = false;
  private heldConduction = new HeldConduction();
  private heldWarriorStorm = new HeldWarriorStorm();
  private readonly warriorAttention = new WarriorAttention();
  private warriorStorms = new Map<
    number,
    { stamp: number; elapsed: number; nextDust: number; surface: boolean }
  >();
  private drawPriorityStorms = (): void => {
    for (const [id, storm] of this.warriorStorms) {
      if (storm.surface) continue;
      const at = this.anchor(id, 0, anchorScratchA);
      if (at)
        this.heldWarriorStorm.drawPrimary(
          this.ribbons,
          at,
          storm.elapsed,
          this.reducedMotionActive,
        );
    }
    this.guards.draw(
      this.frame,
      this.guardDt,
      this.reducedMotionActive,
      this.anchor,
      this.guardFacing,
      this.weaponAnchor,
      this.ribbons,
    );
    this.powerForms.draw(
      this.frame,
      this.guardDt,
      this.reducedMotionActive,
      this.anchor,
      this.guardFacing,
      this.ribbons,
      this.powerDetail,
      this.bodyAnchor,
    );
  };
  private powerDetail = (kind: number, x: number, y: number, z: number): void => {
    this.burstAt(
      x,
      y,
      z,
      kind === 0 ? 0xbcb69b : 0xee2748,
      kind === 0 ? 2 : 4,
      kind === 0 ? 0.25 : 0.38,
      kind === 0 ? 'debris' : 'embers',
      0.3,
    );
  };
  private drawHeldConduction = (): void => {
    for (const [id, storm] of this.warriorStorms) {
      const at = this.anchor(id, 0, anchorScratchA);
      if (at)
        this.heldWarriorStorm.draw(
          this.ribbons,
          this.overlay,
          at,
          storm.elapsed,
          this.reducedMotionActive,
        );
    }
    for (const [id, bands] of this.orbits) {
      for (const band of bands) {
        if (
          band.stamp !== this.frame ||
          (band.style !== 'wardCharges' && band.style !== 'conduction')
        )
          continue;
        const at = this.anchor(id, ORBIT_DNA[band.style].frac, anchorScratchA);
        if (!at) continue;
        this.heldConduction.draw(
          this.ribbons,
          band.style,
          at,
          this.facingAt(id) ?? 0,
          this.reducedMotionActive ? 0 : this.time,
          band.o?.n ?? 3,
          band.colorHex,
          Math.min(1, band.age / 0.25),
          band.tier === 0,
        );
      }
    }
  };
  private headSink = (
    x: number,
    y: number,
    z: number,
    colorHex: number,
    size: number,
    cell: number,
    alpha: number,
    brightness: number,
  ): void => {
    this.overlay.push(
      x,
      y,
      z,
      colorHex,
      size * (0.8 + 0.2 * this.qualityLevel),
      cell,
      alpha,
      brightness,
      1,
    );
  };

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    private anchor: RibbonAnchor,
    private groundY: (x: number, z: number) => number,
    /** Caster's world facing (radians), for the STATIONARY spirit path only:
     *  the anchor seam carries no facing, so everything else here works in
     *  screen space. Optional so a host that cannot supply it keeps the old
     *  camera-relative behaviour. */
    private facingOf?: (id: number) => number | null,
    private weaponAnchor?: (id: number, hand: 0 | 1) => WeaponAnchorSampler | null,
    private handSample?: (
      id: number,
      hand: 0 | 1,
      out: { x: number; y: number; z: number },
    ) => boolean,
    textureReady?: (texture: THREE.Texture) => boolean,
    private bodyAnchor?: WarriorPowerAnchor,
  ) {
    const tex = abilityVfxTextures();
    this.ribbons = new AbilityVfxRibbons(scene, anchor, tex);
    this.water = new RestorativeWaterVolumes(scene);
    this.details = new SignatureDetails(scene);
    this.forms = new ElementalForms(scene);
    this.crests = new SignatureCrests(scene, this.groundY);
    this.guards = new WarriorGuardPlates(scene);
    this.powerForms = new WarriorPowerForms(scene);
    this.furyStates = new WarriorFuryStates(scene, anchor, tex);
    this.baked = new BakedImpactLayers(scene, textureReady);
    this.fragments = new SolidImpactFragments(scene);
    this.rings = new ShockRings(scene, tex, groundY);
    this.decals = new GroundDecals(scene, tex, groundY);
    this.overlay = new OverlaySprites(scene, tex);
    this.controlSignals = new CombatStatusSignals(scene);
    this.pillars = new LightPillars(scene);
    this.shells = new BuffShells(scene);
    this.groundAuras = new GroundAuras(scene, tex);
    this.flipbooks = new ImpactFlipbooks(scene);
    this.spirits = new SpiritApparitions(scene, groundY);
  }

  // Kick the async GLB loads for every spirit model a sighted player's class
  // can conjure (painter.syncEntity calls this on first sighting), so the
  // model is warm before its first cast - an unwarmed cast skips its spirit.
  warmSpiritsForClass(cls: string): void {
    this.spirits.warmForClass(cls);
  }

  // Hand the spirit puppets a host scheduler so their construction rides idle
  // slots instead of the GLB resolve's own (live, in-combat) frame.
  setSpiritBuildScheduler(schedule: SpiritBuildScheduler | null): void {
    this.spirits.setBuildScheduler(schedule);
  }

  // Hand the spirit puppets the host's live compile gate, so a freshly built
  // puppet links its ghost program off-thread on a hidden root instead of
  // riding one VISIBLE frame (a synchronous link in a live frame).
  setSpiritCompileGate(gate: SpiritCompileGate | null): void {
    this.spirits.setCompileGate(gate);
  }

  // Wired once by the painter: particle bursts ride the pooled Vfx cloud,
  // impact light rides the renderer's pooled point-light flashes, every
  // sequencer spawn is counted into the painter's probe stats, and camera
  // trauma rides the renderer's existing addShake accumulator.
  setDelegates(
    burst: ParticleBurst,
    lightPulse: (
      entityId: number,
      palette: string,
      intensity: number,
      duration: number,
      range?: number,
    ) => void,
    statSink: (abilityId: string, n: number) => void,
    applyGlow?: (entityId: number, colorHex: number, intensity: number) => void,
    addShake?: (amount: number, x?: number, y?: number, z?: number) => void,
    bodyLean?: (entityId: number, amount: number) => void,
    screenImpact?: (x: number, y: number, z: number, strength: number) => void,
    abilityAudio?: (
      kind: AbilityAudioKind,
      palette: string,
      power: number,
      x: number,
      y: number,
      z: number,
      opts?: AbilityAudioOpts,
    ) => void,
  ): void {
    this.particleBurst = burst;
    this.lightPulseCb = lightPulse;
    this.statSink = statSink;
    this.applyGlow = applyGlow ?? null;
    this.shakeCb = addShake ?? null;
    this.bodyLeanCb = bodyLean ?? null;
    this.screenImpactCb = screenImpact ?? null;
    this.abilityAudioCb = abilityAudio ?? null;
  }

  // SequencerHost audio surface: forwards the sequence's release/impact/
  // spirit/motif moments to the wired spatial audio sink (silent when none
  // is wired).
  onPresentationMoment:
    | ((id: string, phase: 'release' | 'impact', sourceId: number) => void)
    | null = null;
  presentationMoment(id: string, phase: 'release' | 'impact', sourceId: number): void {
    this.onPresentationMoment?.(id, phase, sourceId);
  }
  onContact:
    | ((
        sourceId: number,
        targetId: number,
        school: string,
        weight: number,
        abilityId?: string,
        beat?: number,
      ) => void)
    | null = null;
  handPoint(id: number, hand: 0 | 1, out: { x: number; y: number; z: number }): typeof out | null {
    return this.handSample?.(id, hand, out) ? out : null;
  }
  contact(
    sourceId: number,
    targetId: number,
    school: string,
    weight: number,
    abilityId?: string,
    beat?: number,
  ): void {
    if (!this.disposed) this.onContact?.(sourceId, targetId, school, weight, abilityId, beat);
  }
  solarExecution(sourceId: number, targetId: number): void {
    if (!this.disposed) solarExecution(this, sourceId, targetId);
  }
  abilityAudio(
    kind: AbilityAudioKind,
    palette: string,
    power: number,
    x: number,
    y: number,
    z: number,
    opts?: AbilityAudioOpts,
  ): void {
    this.abilityAudioCb?.(kind, palette, power, x, y, z, opts);
  }

  // Feed the body glow for one entity this frame (spec'd cast or live buff
  // aura). The envelope owns attack/decay; the delegate writes the rig
  // emissive. Returns the current glow intensity for the dev probe.
  bodyGlow(entityId: number, colorHex: number, strength: number, slowDecay: boolean): void {
    if (this.disposed) return;
    let g = this.glows.get(entityId);
    if (!g) {
      if (this.glows.size >= 16) return;
      g = { color: colorHex, target: strength, level: 0, slow: slowDecay, stamp: this.frame };
      this.glows.set(entityId, g);
    }
    // one held call per entity per frame (the painter pre-selects the
    // strongest aura); a fresh frame RESETS the target so a dropped strong
    // buff stops holding the level up forever
    g.target = g.stamp === this.frame ? Math.max(g.target, strength) : strength;
    // a stronger transient pulse keeps its color until the envelope decays
    // back to the held level
    if (strength >= g.level) {
      g.color = colorHex;
      g.slow = slowDecay;
    }
    g.stamp = this.frame;
  }

  // One-shot glow pop (instant buffs with no aura to hold, e.g. Blood Toll):
  // the level jumps to strength now and decays on the envelope.
  bodyGlowPulse(entityId: number, colorHex: number, strength: number, slowDecay: boolean): void {
    if (this.disposed) return;
    let g = this.glows.get(entityId);
    if (!g) {
      if (this.glows.size >= 16) return;
      g = { color: colorHex, target: 0, level: 0, slow: slowDecay, stamp: -1 };
      this.glows.set(entityId, g);
    }
    if (strength >= g.level) {
      g.level = strength;
      g.color = colorHex;
      g.slow = slowDecay;
    }
  }

  glowIntensityOf(entityId: number): number {
    const g = this.glows.get(entityId);
    return g ? Math.min(0.85, g.level * 0.38) : 0;
  }

  // Dev probe: the entity's held ground-aura band count.
  groundAuraCountOf(entityId: number): number {
    return this.groundAuras.countOf(entityId);
  }

  reserveFuryAudio(
    event: object,
    id: MeleeAudioId,
    caster: number,
    target: number,
    outcome: 0 | 1 | 2,
    ready: (key: string) => boolean,
  ): boolean {
    return (
      !this.disposed && this.furyAudio.reserve(this, event, id, caster, target, outcome, ready)
    );
  }

  hasRetainedAreaAudio(id: MeleeAudioId, caster: number): boolean {
    return this.furyAudio.ownsCast(id, caster);
  }

  // ---- archetype sequences (the gallery phase anatomy; see sequencer.ts) --

  // Instant cast: release now (or after a synthetic windup phase of
  // windupDelay seconds), impact 0.15s later at the archetype's anchor.
  sequenceInstant(
    abilityId: string,
    spec: AbilityVfxFullSpec,
    casterId: number,
    targetId: number,
    colorHex: number,
    tier: number,
    windupDelay = 0,
    componentOutcome?: 0 | 1 | 2,
  ): void {
    if (this.disposed) return;
    this.sequencer.start(
      this,
      abilityId,
      spec,
      casterId,
      targetId,
      colorHex,
      tier,
      false,
      windupDelay,
      undefined,
      componentOutcome,
    );
    if (wantsScreenFx(spec, tier)) {
      // fire with the sequence's compressed impact; self-centered archetypes
      // land on the caster (mirrors the sequencer's impactAnchor rule)
      const anchorId =
        spec.self === true || spec.archetype === 'nova' || spec.archetype === 'shout'
          ? casterId
          : targetId;
      this.scheduleScreenFx(
        windupDelay + SIGNATURE_CONTACT_TIME,
        anchorId,
        0,
        0,
        0,
        screenFxStrengthOf(spec),
      );
    }
  }

  sequenceWarriorAreaContact(
    spec: AbilityVfxFullSpec,
    casterId: number,
    targetId: number,
    tier: number,
    outcome: 0 | 1 | 2,
    abilityId = 'cleave',
  ): boolean {
    if (this.disposed) return false;
    this.sequencer.start(
      this,
      abilityId,
      spec,
      casterId,
      targetId,
      0xeac6a4,
      Math.min(1, tier),
      false,
      0,
      undefined,
      outcome,
      true,
    );
    // Saturation may shed this recipient, but must not play an early generic hit.
    return true;
  }

  cancelSequence(casterId: number, abilityId: string): void {
    this.sequencer.cancelOwned(casterId, abilityId);
  }

  // Ground-aimed instant: the whole sequence anchors at the WORLD POINT (the
  // slot travels with targetId -1 and a pre-seeded impact anchor), so release
  // reads on the caster while motifs, decals, and lingers land where the cast
  // was aimed.
  sequenceInstantAt(
    abilityId: string,
    spec: AbilityVfxFullSpec,
    casterId: number,
    x: number,
    z: number,
    colorHex: number,
    tier: number,
    windupDelay = 0,
  ): void {
    if (this.disposed) return;
    const y = this.groundY(x, z) + 0.4;
    this.sequencer.start(this, abilityId, spec, casterId, -1, colorHex, tier, false, windupDelay, {
      x,
      y,
      z,
    });
    if (wantsScreenFx(spec, tier))
      this.scheduleScreenFx(
        windupDelay + SIGNATURE_CONTACT_TIME,
        -1,
        x,
        y,
        z,
        screenFxStrengthOf(spec),
      );
  }

  // Traveling bolt carrying the full spec's bolt DNA. Without a bolt block
  // the trail rides the pooled Vfx comet at its speed (the legacy read); WITH
  // one, the styled trail IS the projectile - per-style head sprite and trail,
  // authored speed, and at full tier the garnish: twin counter-rotating coils,
  // the flickering jagged tail, periodic ground forks, the tracer etch. The
  // lightning family's leader/return double flash answers on arrival, and
  // volley > 1 staggers followers behind the lead bolt with a spread aim.
  // The FULL impact stack lands where and when the lead trail arrives.
  sequenceBolt(
    abilityId: string,
    spec: AbilityVfxFullSpec,
    casterId: number,
    targetId: number,
    colorHex: number,
    width: number,
    tier: number,
    volley = 1,
    headScale = 1,
  ): void {
    if (this.disposed) return;
    // spectacle calibration: the measured crescendo gap was widest on bolts
    // (trail + head sparse inside a gallery-sized bbox), so the travel read
    // scales up at the one spawn seam every tier shares
    width *= SPECTACLE.boltWidth;
    headScale *= SPECTACLE.boltHead;
    const slot = this.sequencer.start(
      this,
      abilityId,
      spec,
      casterId,
      targetId,
      colorHex,
      tier,
      true,
    );
    const screen = wantsScreenFx(spec, tier);
    const onTerminate = slot
      ? (x: number, y: number, z: number) => {
          this.sequencer.cancel(slot);
          if (tier < 2) {
            this.particleBurst?.(x, y, z, colorHex, tier === 0 ? 6 : 3, 0.35, 'smoke');
            if (tier === 0)
              this.particleBurst?.(
                x,
                y,
                z,
                abilityHexColor(spec.rim ?? '#d8ff58'),
                4,
                0.3,
                'embers',
              );
          }
        }
      : null;
    const b = spec.bolt;
    if (!b) {
      this.ribbons.spawnTrail(
        casterId,
        targetId,
        colorHex,
        width,
        slot
          ? (x, y, z) => {
              this.sequencer.triggerImpact(this, slot, x, y, z);
              if (screen) this.screenFxAt(x, y, z, screenFxStrengthOf(spec));
            }
          : null,
        onTerminate,
      );
      return;
    }
    const style: BoltTrailStyle = b.style ?? PROJ_STYLE_BY_PALETTE[spec.palette] ?? 'comet';
    const speed = b.speed ?? 26;
    const fullTier = tier === 0;
    // gallery head factors: arrows nearly vanish, shaped heads run leaner
    const hs = headScale * (style === 'arrow' ? 0.35 : style !== 'comet' ? 0.7 : 1);
    const leader = b.leader === true && tier < 2;
    this.ribbons.spawnTrailStyled(
      casterId,
      targetId,
      colorHex,
      width,
      {
        speed,
        style,
        headSize: hs,
        coreHex: b.core ? abilityHexColor(b.core) : undefined,
        accentHex: b.accent ? abilityHexColor(b.accent) : undefined,
        coils: fullTier && b.coils === true,
        jagTrail: fullTier && b.jagged === true,
        forkEvery: fullTier ? (b.forkEvery ?? 0) : 0,
        tracer: fullTier && b.tracer === true,
        delay: 0,
        aimX: 0,
        aimY: 0,
        aimZ: 0,
        groundY: this.groundY,
      },
      (x, y, z) => {
        if (leader) this.leaderStrike(casterId, x, y, z, colorHex);
        if (slot) this.sequencer.triggerImpact(this, slot, x, y, z);
        if (screen) this.screenFxAt(x, y, z, screenFxStrengthOf(spec));
      },
      onTerminate,
    );
    // staggered barrage riding behind the lead projectile (gallery volley):
    // followers keep the style head and trail, shed the garnish, land with a
    // small spark accent instead of a second impact stack
    const n = Math.min(4, Math.max(1, Math.round(volley)));
    for (let i = 1; i < n; i++) {
      this.ribbons.spawnTrailStyled(
        casterId,
        targetId,
        colorHex,
        width * 0.75,
        {
          speed,
          style,
          headSize: hs * 0.75,
          coreHex: b.core ? abilityHexColor(b.core) : undefined,
          accentHex: b.accent ? abilityHexColor(b.accent) : undefined,
          coils: false,
          jagTrail: false,
          forkEvery: 0,
          tracer: false,
          delay: i * 0.12,
          aimX: (Math.random() - 0.5) * 1.6,
          aimY: (Math.random() - 0.5) * 0.7,
          aimZ: (Math.random() - 0.5) * 1.6,
          groundY: null,
        },
        (x, y, z) => this.particleBurst?.(x, y, z, colorHex, 6, 0.5, 'sparks'),
      );
    }
  }

  // Ground-aimed bolt volley (Splitshot): the styled trails FLY from the
  // caster to the aimed WORLD POINT - the sequence rides targetId -1 with the
  // point pre-seeded, release reads on the caster, and the FULL impact stack
  // lands when the LEAD trail arrives there. Followers stagger behind with a
  // spread aim fanned around the landing and pop small spark accents; they
  // keep the style head and trail at tier 1 (the volley itself is the read)
  // and shed only the garnish. Tier 2 never sequences, so no volley either.
  sequenceBoltAt(
    abilityId: string,
    spec: AbilityVfxFullSpec,
    casterId: number,
    x: number,
    z: number,
    colorHex: number,
    width: number,
    tier: number,
    volley = 1,
    headScale = 1,
  ): void {
    if (this.disposed) return;
    width *= SPECTACLE.boltWidth;
    headScale *= SPECTACLE.boltHead;
    const y = this.groundY(x, z) + 0.4;
    const slot = this.sequencer.start(
      this,
      abilityId,
      spec,
      casterId,
      -1,
      colorHex,
      tier,
      true,
      0,
      {
        x,
        y,
        z,
      },
    );
    const screen = wantsScreenFx(spec, tier);
    const onTerminate = slot
      ? (ax: number, ay: number, az: number) => {
          this.sequencer.cancel(slot);
          if (tier < 2) {
            this.particleBurst?.(ax, ay, az, colorHex, tier === 0 ? 6 : 3, 0.35, 'smoke');
            if (tier === 0)
              this.particleBurst?.(
                ax,
                ay,
                az,
                abilityHexColor(spec.rim ?? '#d8ff58'),
                4,
                0.3,
                'embers',
              );
          }
        }
      : null;
    const b = spec.bolt;
    const style: BoltTrailStyle = b?.style ?? PROJ_STYLE_BY_PALETTE[spec.palette] ?? 'comet';
    const speed = b?.speed ?? 26;
    const fullTier = tier === 0;
    const hs = headScale * (style === 'arrow' ? 0.35 : style !== 'comet' ? 0.7 : 1);
    const leader = b?.leader === true && tier < 2;
    this.ribbons.spawnTrailStyledTo(
      casterId,
      x,
      y,
      z,
      colorHex,
      width,
      {
        speed,
        style,
        headSize: hs,
        coils: fullTier && b?.coils === true,
        jagTrail: fullTier && b?.jagged === true,
        forkEvery: fullTier ? (b?.forkEvery ?? 0) : 0,
        tracer: fullTier && b?.tracer === true,
        delay: 0,
        aimX: 0,
        aimY: 0,
        aimZ: 0,
        groundY: this.groundY,
      },
      (ax, ay, az) => {
        if (leader) this.leaderStrike(casterId, ax, ay, az, colorHex);
        if (slot) this.sequencer.triggerImpact(this, slot, ax, ay, az);
        if (screen) this.screenFxAt(ax, ay, az, screenFxStrengthOf(spec));
      },
      onTerminate,
    );
    // the fan: followers aim at spread points around the landing so the
    // volley reads as a scatter of shots blanketing the aimed area
    const n = Math.min(4, Math.max(1, Math.round(volley)));
    for (let i = 1; i < n; i++) {
      this.ribbons.spawnTrailStyledTo(
        casterId,
        x,
        y,
        z,
        colorHex,
        width * 0.75,
        {
          speed,
          style,
          headSize: hs * 0.75,
          coils: false,
          jagTrail: false,
          forkEvery: 0,
          tracer: false,
          delay: i * 0.12,
          aimX: (Math.random() - 0.5) * 2.4,
          aimY: (Math.random() - 0.5) * 0.5,
          aimZ: (Math.random() - 0.5) * 2.4,
          groundY: null,
        },
        (ax, ay, az) => this.particleBurst?.(ax, ay, az, colorHex, 6, 0.5, 'sparks'),
      );
    }
  }

  // Real lightning answers itself: a dim leader stroke finds the path from
  // the caster to the strike point, then the fat return stroke ANSWERS along
  // it 80ms later (a delayed bolt slot; endpoints frozen at arrival).
  private leaderStrike(casterId: number, x: number, y: number, z: number, colorHex: number): void {
    const from = this.anchor(casterId, 0.62);
    if (!from) return;
    this.ribbons.spawnBoltPoints(from.x, from.y, from.z, x, y, z, colorHex, 0.07, 0.04, 1.3);
    this.ribbons.spawnBoltPoints(from.x, from.y, from.z, x, y, z, colorHex, 0.16, 0.22, 1, 0.08);
  }

  // Boot-only warm-up (the renderer's 'vfx.ability-primitives' prewarm entry):
  // spawn one of every pooled primitive so their meshes - visible=false until
  // first use, hence invisible to the prewarm's compile passes - render during
  // the boot prewarm frames instead of linking their shaders on the first
  // spec'd cast. Each decal style binds its texture so the whole set uploads
  // now, and the flipbook prewarm does the same for the six impact sheets.
  // The prewarm's finally-block clear() hides everything again.
  authoredPrewarmUnits(host: CrestPrewarmHost, kinds?: readonly CrestKind[]) {
    return [
      ...this.crests.preparation.units(host, kinds),
      ...this.guards.units(host),
      ...this.powerForms.units(host),
      ...this.furyStates.units(host),
    ];
  }

  prewarmSpawn(x: number, y: number, z: number, entityId: number): void {
    this.forms.spawn('glacier', x, y, z, 1, 1, 0xffffff, 0xffffff, 0, true);
    this.forms.update(0.08, false);
    if (this.disposed) return;
    const gy = this.groundY(x, z);
    this.details.spawn(x, y, z, 1, 0xffffff, 0xffffff, 'fire');
    this.details.update(0.05, this.camera.quaternion, false);
    for (const kind of [
      'ice',
      'water',
      'fire',
      'shadow',
      'light',
      'nature',
      'arcane',
      'hook',
      'chain',
    ] as const)
      this.crests.spawn(x, gy, z, 1, 1, 0xffffff, 0xffffff, kind);
    this.crests.update(0.05, false);
    this.bakedAt('smoke', x, y, z, 1, 0xffffff, 0xffffff, 1, 0, 0);
    this.bakedAt('shockwave', x, gy + 0.08, z, 1, 0xffffff, 0xffffff, 1, 0, 0);
    for (const kind of [
      'pyroblast',
      'frost_nova',
      'chain_heal',
      'shout_dust',
      'warrior_power',
    ] as const)
      this.bakedAt(kind, x, gy + 0.08, z, 1, 0xffffff, 0xffffff, 1, 0, 0);
    for (const kind of ['ice_shard', 'stone_chip', 'metal_splinter'] as const)
      this.fragmentsAt(kind, x, y, z, 0xffffff, 1, 1, 0, 1);
    this.baked.update(0.1, this.camera.quaternion, false);
    this.fragments.update(0.1, false);
    this.water.spawn({ x, y: gy + 0.3, z }, { x: x + 1, y: gy + 1, z }, 0x319cac, 0xbbeee8, 0.15);
    this.water.update(0.05, false);
    this.rings.spawn(x, gy + 0.15, z, 2, 0.7, 0xffffff, 1, false);
    this.rings.spawn(x, gy + 1.2, z, 1.6, 0.7, 0xffffff, 1, true);
    this.decals.spawn(x, gy, z, 1.5, 0xffffff, 'ember', 1.2);
    this.decals.spawn(x, gy, z, 1.5, 0xffffff, 'rime', 1.2);
    this.decals.spawn(x, gy, z, 1.5, 0xffffff, 'rune', 1.2);
    this.decals.spawn(x, gy, z, 1.5, 0xffffff, 'crack', 1.2);
    this.decals.spawn(x, gy, z, 1.5, 0xffffff, 'char', 1.2);
    // builds all six flipbook sheets and binds one per slot for the texture walk
    this.flipbooks.prewarm(x, y + 1.1, z);
    this.pillars.spawn(x, gy, z, 1, 6, 0xffffff, 0.7);
    this.shells.flash(entityId, 0xffffff, 0.7);
    // held for one frame, then auto-releases as its fade - enough to compile
    this.groundAuras.hold(entityId, 0, 0xffffff, true, this.frame);
    this.ribbons.spawnSlashStyled({ x, y: y + 1.1, z }, 0xffffff, 'horizontal');
    this.overlay.push(x, y + 1.1, z, 0xffffff, 0.3, OVERLAY_CELL.glow, 0.6, 1.5);
    this.overlay.commit();
  }

  setQuality(q: number): void {
    this.qualityLevel = Math.min(1, Math.max(0, Number.isFinite(q) ? q : 1));
  }

  setViewportScale(heightPx: number, fovDeg: number, cssHeight = heightPx): void {
    this.controlSignals.setViewportHeight(cssHeight);
    this.overlay.setViewportScale(heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360)));
  }

  // ---- SequencerHost surface (sequencer.ts drives these) ------------------

  anchorOf(id: number, frac: number, out?: SeqPoint): SeqPoint | null {
    // No destination: keep the historical contract exactly (a fresh vector the
    // caller may retain). With one, resolve through this engine's scratch and
    // copy the three floats out, so the sequencer stays Three-free.
    if (!out) return this.anchor(id, frac);
    const at = this.anchor(id, frac, hostAnchorScratch);
    if (!at) return null;
    out.x = at.x;
    out.y = at.y;
    out.z = at.z;
    return out;
  }

  // True when an aura-driven CC band of ANY type actually WON a draw slot in
  // the latest frame, which is what the sequencer's cast-moment ccStars stand
  // down for. Any type, not just stun: the 'cc' archetype flashes the same
  // yellow stars for a root or a fear cast, so a victim now wearing its own
  // green ankle shards or violet wisps must claim the read away from a burst
  // that would name the wrong control. Membership in the pick set,
  // deliberately not "was fed": the band count is capped, and answering on
  // fed-ness suppressed the cast-moment band for a capped-out victim whose
  // held band was never drawn, leaving it with no overhead read at all (worse
  // than before this feature existed). The pick set is rebuilt at the top of
  // every update(), before sequencer.update() consults it, so the sequencer
  // always reads the set for the frame it is drawing.
  heldCcBand(targetId: number): boolean {
    if (this.controlSignals.hasDrawn(targetId)) return true;
    for (let i = 0; i < this.ccPickCount; i++) {
      if (this.ccPickIds[i] === targetId) return true;
    }
    return false;
  }

  groundYAt(x: number, z: number): number {
    return this.groundY(x, z);
  }

  ringAt(
    x: number,
    y: number,
    z: number,
    maxR: number,
    dur: number,
    colorHex: number,
    intensity: number,
    vertical: boolean,
  ): void {
    if (this.disposed) return;
    this.rings.spawn(x, y, z, maxR, dur, colorHex, intensity * this.intensity(), vertical);
  }

  decalXZ(
    x: number,
    z: number,
    radius: number,
    colorHex: number,
    style: string,
    dur: number,
  ): void {
    if (this.disposed) return;
    const s: DecalStyle =
      style === 'ember' ||
      style === 'rime' ||
      style === 'crack' ||
      style === 'char' ||
      style === 'leap_fracture'
        ? style
        : 'rune';
    this.decals.spawn(x, this.groundY(x, z), z, radius, colorHex, s, dur);
  }

  flipbookAt(
    x: number,
    y: number,
    z: number,
    size: number,
    colorHex: number,
    sheet: string,
    hdr: number,
    duration?: number,
    rotation?: number,
    aspect?: number,
  ): void {
    if (this.disposed) return;
    this.flipbooks.spawn(
      x,
      y,
      z,
      size,
      colorHex,
      hdr * this.intensity(),
      isContactSheet(sheet) ? sheet : asFlipbookStyle(sheet),
      duration,
      rotation,
      aspect,
    );
  }

  pillarAt(
    x: number,
    y: number,
    z: number,
    radius: number,
    height: number,
    colorHex: number,
    dur: number,
  ): void {
    if (this.disposed) return;
    this.pillars.spawn(x, y, z, radius, height, colorHex, dur);
  }

  shellFlash(entityId: number, colorHex: number, dur: number): void {
    if (this.disposed) return;
    this.shells.flash(entityId, colorHex, dur);
  }

  // Held barrier shell, refreshed per frame while the barrier aura lives.
  holdShell(entityId: number, colorHex: number): void {
    if (this.disposed) return;
    this.shells.hold(entityId, colorHex, this.frame);
  }

  // Held under-character ground aura (the default buff read), refreshed per
  // frame while the buff aura lives; band stacks concentric rings for
  // concurrent buffs. Returns true when this call created the band (the
  // aura-gain moment).
  holdGroundAura(entityId: number, band: number, colorHex: number, spin: boolean): boolean {
    if (this.disposed) return false;
    return this.groundAuras.hold(entityId, band, colorHex, spin, this.frame);
  }

  // Presentation-culling transition for one entity. Semantic held state lives
  // in the painter, while scarce render pools are released immediately so an
  // offscreen actor consumes no overlay, shell, ground-aura, or glow work.
  sleepEntity(entityId: number): void {
    if (this.disposed) return;
    this.controlSignals.sleep(entityId);
    this.guards.sleep(entityId);
    this.powerForms.sleep(entityId);
    this.furyStates.sleep(entityId);
    this.warriorAttention.sleep(entityId);
    this.warriorStorms.delete(entityId);
    this.crests.releaseHeld(entityId);
    this.ccBands.delete(entityId);
    this.windups.delete(entityId);
    const bands = this.orbits.get(entityId);
    if (bands) {
      this.orbitBandCount -= bands.length;
      this.orbits.delete(entityId);
    }
    this.shells.sleepEntity(entityId);
    this.groundAuras.sleepEntity(entityId);
    const glow = this.glows.get(entityId);
    if (glow) {
      this.applyGlow?.(entityId, glow.color, 0);
      this.glows.delete(entityId);
    }
  }

  burstAt(
    x: number,
    y: number,
    z: number,
    colorHex: number,
    count: number,
    power: number,
    kind: ParticleBurstKind,
    duration?: number,
  ): void {
    if (this.disposed) return;
    this.particleBurst?.(x, y, z, colorHex, count, power, kind, duration);
  }

  pulseLight(
    entityId: number,
    palette: string,
    intensity: number,
    duration: number,
    range?: number,
  ): void {
    if (this.disposed) return;
    this.lightPulseCb?.(entityId, palette, intensity, duration, range);
  }

  glowPulse(entityId: number, colorHex: number, strength: number, _slowDecay: boolean): void {
    // Buff application flash only: the sustained buff read is the ground aura
    // (holdGroundAura), never a held body tint - so the sequencer's buff-impact
    // pulse is capped low and always decays fast (~0.4s at the envelope's
    // 2.2/s), the brief 'it landed' read.
    this.bodyGlowPulse(entityId, colorHex, Math.min(strength, BUFF_APPLICATION_PULSE_MAX), false);
  }

  boltBetween(
    sourceId: number,
    targetId: number,
    colorHex: number,
    life: number,
    width: number,
    jag: number,
  ): void {
    if (this.disposed) return;
    this.ribbons.spawnBolt(sourceId, targetId, colorHex, life, width, jag);
  }

  boltPoints(
    fx: number,
    fy: number,
    fz: number,
    tx: number,
    ty: number,
    tz: number,
    colorHex: number,
    life: number,
    width: number,
    jag: number,
  ): void {
    if (this.disposed) return;
    this.ribbons.spawnBoltPoints(fx, fy, fz, tx, ty, tz, colorHex, life, width, jag);
  }

  slashStyled(
    at: { x: number; y: number; z: number },
    colorHex: number,
    style: string,
    scale = 1,
  ): void {
    if (this.disposed) return;
    this.ribbons.spawnSlashStyled(at, colorHex, style, scale);
  }

  pathRibbon(
    colorHex: number,
    width: number,
    life: number,
    fill: (pts: { set(x: number, y: number, z: number): unknown }[]) => number,
    brushed = false,
    motion: PathMotion | null = null,
    preserveActive = false,
    priority: 0 | 1 = 0,
    sweep: SteelSweepRange | null = null,
  ): boolean {
    if (this.disposed) return false;
    return this.ribbons.spawnPath(
      colorHex,
      width,
      life,
      fill,
      brushed,
      motion,
      preserveActive,
      false,
      priority,
      sweep,
    );
  }

  tetherRibbon(
    color: number,
    width: number,
    life: number,
    fill: (pts: { set(x: number, y: number, z: number): unknown }[]) => number,
  ): void {
    if (!this.disposed) this.ribbons.spawnPath(color, width, life, fill, false, null, false, true);
  }

  facingAt(id: number): number | null {
    return this.facingOf?.(id) ?? null;
  }

  weaponTrail(id: number, hand: 0 | 1, color: number, width: number, duration: number): void {
    if (this.disposed) return;
    const sample = this.weaponAnchor?.(id, hand);
    if (sample) this.ribbons.spawnTrackedPath(color, width, duration, sample);
  }

  waterVolume(
    from: SeqPoint,
    to: SeqPoint,
    tint: number,
    accent: number,
    width: number,
    duration = 0.8,
  ): void {
    if (!this.disposed) this.water.spawn(from, to, tint, accent, width, duration);
  }

  bakedAt(
    kind: BakedKind,
    x: number,
    y: number,
    z: number,
    size: number,
    tint: number,
    hot: number,
    duration: number,
    delay: number,
    heat: number,
    angle = 0,
    reverse = false,
    roll = 0,
    aspect = 1,
  ): boolean {
    return this.baked.spawn(
      kind,
      x,
      y,
      z,
      size,
      tint,
      hot,
      duration,
      delay,
      heat,
      this.groundY(x, z),
      angle,
      this.groundY,
      reverse,
      roll,
      aspect,
    );
  }
  elementalImpact(
    id: string,
    spec: AbilityVfxFullSpec,
    at: SeqPoint,
    tier: number,
    colour: number,
    accent: number,
    dx: number,
    dz: number,
  ): number {
    if (this.disposed) return 0;
    const plan = elementalPerformance(id, spec, tier);
    if (!plan.enabled) return 0;
    const floor = this.groundY(at.x, at.z) + 0.085;
    if (!Number.isFinite(floor)) return 0;
    let count = this.forms.spawn(
      plan.form,
      at.x,
      floor,
      at.z,
      plan.size,
      plan.duration,
      colour,
      accent,
      Math.atan2(dx, dz),
      plan.detail,
    )
      ? 1
      : 0;
    if (tier !== 0) return count;
    const reaction = this.contacts.touch(at.x, at.z, plan.element);
    if (reaction === 'steam') {
      this.bakedAt('smoke', at.x, floor + 1, at.z, 2.8, 0xaaaeb3, 0xcadce3, 1.9, 0.06, 0);
      this.crestAt(at.x, floor, at.z, 0.7, 0.35, 0x638e9a, 0xbddeea, 'water');
      count += 2;
    } else if (reaction === 'conduction') {
      for (let k = 0; k < 5; k++) {
        const a = k * 2.399963;
        this.boltPoints(
          at.x,
          floor + 0.08,
          at.z,
          at.x + Math.cos(a) * 1.8,
          floor + 0.08,
          at.z + Math.sin(a) * 1.8,
          0xa4ecff,
          0.35,
          0.025,
          0.45,
        );
      }
      this.residueAt(at.x, at.z, 1.3, 0x397d9c, 'water');
      count += 6;
    } else if (reaction === 'confluence') {
      this.forms.spawn(
        'rift',
        at.x,
        floor,
        at.z,
        0.8,
        1.5,
        0x321548,
        0xb982e0,
        Math.atan2(dx, dz) + 0.7,
        true,
      );
      this.bakedAt('smoke', at.x, floor + 0.9, at.z, 2.4, 0x342638, 0x795491, 1.6, 0, 0.02);
      count += 2;
    }
    return count;
  }
  fragmentsAt(
    kind: FragmentKind,
    x: number,
    y: number,
    z: number,
    tint: number,
    count: number,
    power: number,
    dx: number,
    dz: number,
    duration?: number,
  ): void {
    this.fragments.burst(kind, x, y, z, tint, count, power, dx, dz, this.groundY, duration);
  }
  detailAt(
    x: number,
    y: number,
    z: number,
    size: number,
    tint: number,
    accent: number,
    substance: Substance,
    delay = 0,
    duration = 1.3,
  ): void {
    this.details.spawn(x, y, z, size, tint, accent, substance, delay, duration);
  }
  residueAt(x: number, z: number, radius: number, tint: number, substance: Substance): void {
    this.details.residue(x, z, radius, tint, substance, this.groundY);
  }
  setWorldLightDelegate(
    callback:
      | ((
          at: THREE.Vector3,
          school: string,
          intensity: number,
          duration: number,
          range: number,
        ) => void)
      | null,
  ): void {
    this.worldLightCb = callback;
  }
  worldLightAt(
    x: number,
    y: number,
    z: number,
    palette: string,
    intensity: number,
    duration: number,
  ): void {
    if (this.disposed || ![x, y, z, intensity, duration].every(Number.isFinite)) return;
    const school =
      palette === 'storm'
        ? 'nature'
        : palette === 'moon'
          ? 'arcane'
          : palette === 'gold'
            ? 'holy'
            : palette;
    this.lightPoint.set(x, y, z);
    this.worldLightCb?.(
      this.lightPoint,
      school,
      Math.min(6, intensity),
      Math.min(1.2, duration),
      8,
    );
  }
  crestAt(
    x: number,
    y: number,
    z: number,
    radius: number,
    height: number,
    tint: number,
    accent: number,
    substance: CrestKind,
    angle = 0,
    duration = 1.15,
    pitch = 0,
  ): boolean {
    return this.crests.spawn(
      x,
      y,
      z,
      radius,
      height,
      tint,
      accent,
      substance,
      angle,
      duration,
      pitch,
    );
  }

  healStream(sourceId: number, targetId: number): void {
    if (this.disposed) return;
    const from = this.anchor(sourceId, 0.62),
      to = this.anchor(targetId, 0.55);
    if (from && to) drawRestorativeStream(this, from, to);
  }

  pushOverlay(
    x: number,
    y: number,
    z: number,
    colorHex: number,
    size: number,
    cell: number,
    alpha: number,
    brightness: number,
  ): void {
    if (this.disposed) return;
    this.overlay.push(x, y, z, colorHex, size, cell, alpha, brightness);
  }

  overlayCells(): { glow: number; star: number; rune: number; spark: number } {
    return OVERLAY_CELL;
  }

  // Sequencer-driven windup ceremony (the synthetic pre-release phase for
  // instants). Safe to call from sequencer.update: it runs between the
  // overlay's beginFrame and commit, so the pushes land in this frame's batch.
  windupDraw(entityId: number, colorHex: number, progress: number, style: string): void {
    if (this.disposed) return;
    const s: WindupStyle = WINDUP_STYLE_SET.has(style) ? (style as WindupStyle) : 'orb';
    if (s === 'none') return;
    // caster anticipation: the body eases back through the ceremony (gallery
    // easeInOutSine ramp); the visual's spring recoils it forward on release
    const p = Math.min(1, Math.max(0, progress));
    if (!this.reducedMotionActive) this.bodyLeanCb?.(entityId, WINDUP_LEAN_RAD * chargeEnvelope(p));
    this.drawWindup(
      entityId,
      s,
      colorHex,
      chargeEnvelope(progress),
      1,
      colorHex,
      this.reducedMotionActive,
    );
  }

  quality(): number {
    return this.qualityLevel;
  }

  timeNow(): number {
    return this.time;
  }

  countPrimitive(abilityId: string, n: number): void {
    this.statSink?.(abilityId, n);
  }

  // Camera trauma from a world point: distance falloff (full inside 18 yd,
  // gone by 50) plus the rolling budget, so only nearby heavy moments kick
  // and a spam fight can never hold the camera shaking.
  shakeAt(x: number, y: number, z: number, amount: number): void {
    if (
      !this.shakeCb ||
      this.reducedMotionActive ||
      ![x, y, z, amount].every(Number.isFinite) ||
      amount <= 0
    )
      return;
    const d = Math.hypot(x - camPosScratch.x, y - camPosScratch.y, z - camPosScratch.z);
    const falloff = d <= 18 ? 1 : Math.max(0, 1 - (d - 18) / 32);
    const granted = Math.min(amount * falloff, Math.max(0, 0.55 - this.shakeRecent));
    if (granted <= 0.01) return;
    this.shakeRecent += granted;
    this.shakeCb(granted, x, y, z);
  }

  // Screen-space impact feedback (the gallery distortion ripple + flash),
  // honored only for NEARBY heavy moments: full inside 20 yd of the camera,
  // gone by 42. The post pass caps concurrency at 4 and pools its uniforms.
  private screenFxAt(x: number, y: number, z: number, strength: number): void {
    if (!this.screenImpactCb || strength <= 0) return;
    const d = Math.hypot(x - camPosScratch.x, y - camPosScratch.y, z - camPosScratch.z);
    const falloff = d <= 20 ? 1 : Math.max(0, 1 - (d - 20) / 22);
    if (falloff <= 0.05) return;
    this.screenImpactCb(x, y, z, strength * falloff);
  }

  // Queue a screen-fx beat for a sequence whose impact fires later (instants:
  // release + 0.15s). entityId >= 0 resolves the anchor at fire time; -1 uses
  // the seeded world point.
  private scheduleScreenFx(
    delay: number,
    entityId: number,
    x: number,
    y: number,
    z: number,
    strength: number,
  ): void {
    const slot = this.screenFxQueue.find((s) => !s.active);
    if (!slot) return;
    slot.active = true;
    slot.t = delay;
    slot.entityId = entityId;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.strength = strength;
  }

  // Spirit apparition trigger (the sequencer fires it once per impact when a
  // spec authors a spirit block, tier 0 only). Resolves the choreography
  // anchor from the authored at-kind, gates on local relevance (apparitions
  // are a NEARBY-fight spectacle: within ~40 yd of the camera) and on model
  // readiness (still-loading GLBs skip silently, never pop in late), then
  // announces a successful spawn with the gallery's entrance dust + ring.
  spiritAt(
    spirit: NonNullable<AbilityVfxFullSpec['spirit']>,
    casterId: number,
    targetId: number,
    x: number,
    _y: number,
    z: number,
    colorHex: number,
    palette: string,
  ): boolean {
    const model = spirit.model;
    if (!model) return false;
    const atKind: SpiritAtKind =
      spirit.at === 'target' || spirit.at === 'portal' ? spirit.at : 'caster';
    const anchorId = atKind === 'target' ? targetId : casterId;
    // 'portal' plays at the sequence's impact point (the summon rune); the
    // entity kinds ride their live anchors, falling back to the impact point
    const at = atKind === 'portal' ? null : this.anchor(anchorId, 0);
    const ax = at ? at.x : x;
    const az = at ? at.z : z;
    const dcx = ax - camPosScratch.x;
    const dcz = az - camPosScratch.z;
    if (dcx * dcx + dcz * dcz > 40 * 40) return false;
    // choreography direction: caster toward target, camera-right fallback so
    // a self-cast lunge still crosses the screen instead of collapsing
    let dirX = this.camRightX;
    let dirZ = this.camRightZ;
    const from = this.anchor(casterId, 0);
    const to = targetId >= 0 && targetId !== casterId ? this.anchor(targetId, 0) : null;
    if (from) {
      const ddx = (to ? to.x : x) - from.x;
      const ddz = (to ? to.z : z) - from.z;
      const len = Math.hypot(ddx, ddz);
      if (len > 0.3) {
        dirX = ddx / len;
        dirZ = ddz / len;
      }
    }
    const scale = spirit.scale ?? 1;
    const path = asSpiritPath(spirit.path);
    // 'rise' is the stationary ceremonial apparition (a shapeshift, a summon):
    // nothing travels, so there is no caster->target direction and the fallback
    // above leaves it broadside to the camera. That reads as the spirit standing
    // sideways next to a caster it is supposed to mirror, so point it the way the
    // caster is actually facing. The moving paths keep the camera-relative
    // fallback: a self-cast lunge still has to cross the screen to read at all.
    if (path === 'rise') {
      const facing = this.facingOf?.(casterId);
      if (facing != null && Number.isFinite(facing)) {
        dirX = Math.sin(facing);
        dirZ = Math.cos(facing);
      }
    }
    const tint = spirit.tint ? abilityHexColor(spirit.tint) : colorHex;
    const gy = this.groundY(ax, az);
    const ok = this.spirits.spawn({
      model,
      path,
      atKind,
      x: ax,
      y: gy,
      z: az,
      dirX,
      dirZ,
      scale,
      dur: spirit.dur ?? 1.5,
      colorHex: tint,
      dim: spirit.dim ?? 1,
    });
    if (!ok) return false;
    // grand entrance: apparitions announce themselves
    if (path === 'rise') {
      this.particleBurst?.(ax, gy + 0.6, az, 0xd8dde6, model === 'sheep' ? 6 : 4, 0.5, 'smoke');
      this.rings.spawn(ax, gy + 0.15, az, 1.7 * scale, 0.5, tint, 1.2 * this.intensity(), false);
    } else if (path === 'lunge' || path === 'pounce') {
      this.rings.spawn(ax, gy + 0.15, az, 1.3 * scale, 0.4, tint, 1.0 * this.intensity(), false);
      this.particleBurst?.(ax, gy + 0.15, az, tint, 8, 1.2, 'embers'); // kicked-up dust
    }
    this.lightPulseCb?.(anchorId, palette, 3, 0.5);
    if (scale >= 1.05) this.shakeAt(ax, gy, az, 0.22); // big spirits shake the earth
    return true;
  }

  // ---- fire-and-forget primitives (painter dispatch) ----------------------

  jaggedBolt(sourceId: number, targetId: number, colorHex: number): void {
    this.ribbons.spawnBolt(sourceId, targetId, colorHex);
  }

  // A wavering channel beam (drains, mind rays): the bolt slot at near-zero
  // jag, a touch wider and longer-lived than the lightning crack. Energy flows
  // along the strip TOWARD the last point, so callers reverse the argument
  // order to reverse the flow (drains run target -> caster). width and life
  // let a channel crescendo - the cord swelling tick over tick, its life
  // spanning the tick gap so the beam reads continuous.
  beamRibbon(
    sourceId: number,
    targetId: number,
    colorHex: number,
    width = 0.11,
    life = 0.32,
  ): void {
    this.ribbons.spawnBolt(sourceId, targetId, colorHex, life, width, 0.18);
  }

  // Comet trail chasing the pooled Vfx projectile; lands a small vertical
  // shock halo at the impact point when asked (the bolt archetype's read).
  cometTrail(
    sourceId: number,
    targetId: number,
    colorHex: number,
    width: number,
    ring: boolean,
  ): void {
    this.ribbons.spawnTrail(
      sourceId,
      targetId,
      colorHex,
      width,
      ring
        ? (x, y, z) => this.rings.spawn(x, y, z, 1.5, 0.4, colorHex, 1.4 * this.intensity(), true)
        : null,
    );
  }

  slashArc(targetId: number, colorHex: number, span = 1.15, life = 0.22): void {
    const at = this.anchor(targetId, 0.55);
    if (at) this.ribbons.spawnSlash(at, colorHex, span, life);
  }

  // Vertical camera-facing halo at an entity (impacts, crits, shout chests).
  // The big (crit) halo also kicks a small camera shake - accent-gated by the
  // painter and budget-clamped here, so crit chains never stack trauma.
  impactRing(entityId: number, colorHex: number, big = false): void {
    const at = this.anchor(entityId, 0.55);
    if (!at) return;
    this.rings.spawn(
      at.x,
      at.y,
      at.z,
      big ? 2.6 : 1.6,
      big ? 0.55 : 0.4,
      colorHex,
      (big ? 1.8 : 1.4) * this.intensity(),
      true,
    );
    if (big) this.shakeAt(at.x, at.y, at.z, 0.08);
  }

  // The nova/shout ground read: two staggered expanding rings draped at the
  // entity's feet (the second, slower ring sells the double-pulse).
  doubleGroundRing(entityId: number, radius: number, colorHex: number, intensity: number): void {
    const at = this.anchor(entityId, 0);
    if (!at) return;
    const y = this.groundY(at.x, at.z) + 0.15;
    const k = intensity * this.intensity();
    this.rings.spawn(at.x, y, at.z, radius, 0.55, colorHex, 1.9 * k, false);
    this.rings.spawn(at.x, y, at.z, radius * 1.18, 0.85, colorHex, 1.1 * k, false);
  }

  decalAt(
    entityId: number,
    radius: number,
    colorHex: number,
    style: DecalStyle,
    dur: number,
  ): void {
    if (this.disposed) return;
    const at = this.anchor(entityId, 0);
    if (!at) return;
    this.decals.spawn(at.x, this.groundY(at.x, at.z), at.z, radius, colorHex, style, dur);
  }

  // ---- per-frame state (refreshed every frame by painter.syncEntity) ------

  holdWarriorAttention(
    entityId: number,
    sourceId: number,
    remaining: number,
    priority: boolean,
  ): void {
    if (!this.disposed)
      this.warriorAttention.hold(entityId, sourceId, remaining, this.frame, priority);
  }

  warriorRecovery(event: Extract<SimEvent, { type: 'heal2' }>, maxHp: number): boolean {
    return !this.disposed && drawBloodlettingRecovery(this, event, maxHp);
  }

  holdWarriorFuryState(
    entityId: number,
    kind: WarriorFuryStateKind,
    aura: WarriorFuryStateAura,
    priority: boolean,
  ): void {
    this.furyStates.hold(entityId, kind, aura, this.frame, priority);
  }

  holdWarriorPower(
    entityId: number,
    kind: WarriorPowerKind,
    aura: { remaining?: number; duration?: number },
    intent: WarriorPowerIntent,
    priority: boolean,
  ): void {
    this.powerForms.hold(entityId, kind, aura, intent, this.frame, priority);
  }

  holdWarriorGuard(
    entityId: number,
    kind: WarriorGuardKind,
    aura: WarriorGuardAura,
    priority: boolean,
  ): void {
    this.guards.hold(entityId, kind, aura, this.frame, priority);
  }

  // Returns true when this call STARTED the windup (first frame of the cast),
  // so the painter can count and accent the moment.
  windup(
    entityId: number,
    colorHex: number,
    progress: number,
    style: WindupStyle = 'orb',
    priority = false,
    streams = 1,
    accentHex = colorHex,
  ): boolean {
    if (this.disposed) return false;
    if (style === 'none') return false;
    let w = this.windups.get(entityId);
    let started = false;
    if (!w) {
      if (this.windups.size >= MAX_WINDUPS) {
        if (!priority) return false;
        // the local player always gets a windup slot: evict the oldest entry
        const oldest = this.windups.keys().next();
        if (oldest.done) return false;
        this.windups.delete(oldest.value);
      }
      w = { colorHex, accentHex, progress, style, streams, stamp: this.frame };
      this.windups.set(entityId, w);
      started = true;
    }
    w.colorHex = colorHex;
    w.accentHex = accentHex;
    w.progress = progress;
    w.style = style;
    w.streams = Math.min(3, Math.max(1, Math.round(streams)));
    w.stamp = this.frame;
    return started;
  }

  // Returns true when this call CREATED the band (the aura-gain moment), so
  // the painter can pop a swirl without any event carrying the ability id.
  // o is the spec's buff.o DNA (per-buff count/size/rate/radius/... overrides);
  // tier >= 1 halves the band's sprite count while keeping the read.
  orbit(entityId: number, style: OrbitStyle, colorHex: number, o?: OrbitDna, tier = 0): boolean {
    if (this.disposed) return false;
    let bands = this.orbits.get(entityId);
    if (!bands) {
      bands = [];
      this.orbits.set(entityId, bands);
    }
    for (const band of bands) {
      if (band.style === style) {
        band.colorHex = colorHex;
        band.o = o;
        band.tier = tier;
        band.stamp = this.frame;
        return false;
      }
    }
    if (bands.length >= MAX_ORBITS_PER_ENTITY || this.orbitBandCount >= MAX_ORBIT_BANDS)
      return false;
    bands.push({
      style,
      colorHex,
      o,
      tier,
      phase: ((entityId * 2654435761) % 628) / 100,
      age: 0,
      beat: 0,
      stamp: this.frame,
      weaponSample: null,
      weaponRetryAt: 0,
    });
    this.orbitBandCount++;
    return true;
  }

  /** Held readiness cue, sharing the original 24-slot pool and frame cleanup. */
  holdQueuedWeapon(entityId: number, colorHex: number, tier = 0): boolean {
    return this.orbit(entityId, 'weaponGlow', colorHex, QUEUED_WEAPON_DNA, tier);
  }
  holdWarriorStorm(entityId: number, elapsed: number): void {
    if (this.disposed || !Number.isFinite(elapsed)) return;
    const current = this.warriorStorms.get(entityId);
    if (current) {
      current.stamp = this.frame;
      current.elapsed = elapsed;
    } else if (this.warriorStorms.size < 8)
      this.warriorStorms.set(entityId, {
        stamp: this.frame,
        elapsed,
        nextDust: elapsed,
        surface: false,
      });
  }

  /** Redhand's live empowerment count, separate from an armed next-swing cue. */
  holdBladeCharges(entityId: number, stacks: number): boolean {
    if (!(stacks > 0)) return false;
    return this.orbit(entityId, 'bladeCharges', 0xe6b17d, BLADE_CHARGE_DNA[stacks >= 2 ? 1 : 0], 0);
  }

  // Holds the persistent CC band on the entity while a worn hard-CC aura
  // lives: the painter re-feeds it every frame from its aura scan, and the
  // update sweep drops it the frame the feed stops (aura faded, entity left
  // interest), so there is no teardown bookkeeping. remaining drives the fade
  // toward the alpha floor over the aura's final second; `type` picks the
  // whole visual (color, cell, geometry, which end of the body it rides) from
  // CC_BAND_SPECS, so a victim whose control changes kind mid-life (a stun
  // landing on a rooted target) swaps to the more severe band in place.
  holdCcBand(entityId: number, type: CcBandType, remaining: number): void {
    if (this.disposed) return;
    let s = this.ccBands.get(entityId);
    if (!s) {
      s = { type, remaining, stamp: this.frame, hx: 0, hy: 0, hz: 0 };
      this.ccBands.set(entityId, s);
      return;
    }
    s.type = type;
    s.remaining = remaining;
    s.stamp = this.frame;
  }

  holdControlSignals(subject: ControlSubject): void {
    if (!this.disposed) this.controlSignals.hold(subject);
  }

  // One held band (the drawOrbit sibling): the spec's sprite count riding a
  // ring around the anchor the pick loop already resolved. Alpha reads the
  // aura's remaining time but never falls below the spec's floor while it
  // lives: the fade above the floor is the duration read, the floor is the
  // fairness rule (an active CC tell must stay readable to the last tick).
  // A spec with a wobble bobs each sprite on its own phase, which is the
  // fear band's motion signature (see CC_BAND_SPECS: color alone must not be
  // the only thing separating the three).
  private drawCcBand(s: {
    type: CcBandType;
    remaining: number;
    hx: number;
    hy: number;
    hz: number;
  }): void {
    const spec: CcBandSpec = CC_BAND_SPECS[s.type];
    const alpha = Math.max(spec.alphaFloor, Math.min(1, s.remaining));
    const cell = OVERLAY_CELL[spec.cell];
    for (let k = 0; k < spec.count; k++) {
      const phase = (k / spec.count) * Math.PI * 2;
      const a = this.time * spec.rate + phase;
      const bob =
        spec.wobble === 0 ? 0 : Math.sin(this.time * spec.rate * 1.7 + phase) * spec.wobble;
      this.overlay.push(
        s.hx + Math.cos(a) * spec.radius,
        s.hy + spec.lift + bob,
        s.hz + Math.sin(a) * spec.radius,
        spec.color,
        spec.size,
        cell,
        alpha,
        spec.brightness,
      );
    }
  }

  // ---- frame advance ------------------------------------------------------

  update(dt: number, reducedMotion = false): void {
    if (this.disposed) return;
    this.guardDt = dt;
    this.time += dt;
    this.reducedMotionActive = reducedMotion;
    this.shakeRecent = Math.max(0, this.shakeRecent - dt * 0.8);
    this.camera.getWorldPosition(camPosScratch);
    camRightScratch.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    // camera forward, for the stun-band in-front-of-camera ranking below
    camFwdScratch.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const rightLen = Math.hypot(camRightScratch.x, camRightScratch.z);
    if (rightLen > 1e-4) {
      this.camRightX = camRightScratch.x / rightLen;
      this.camRightZ = camRightScratch.z / rightLen;
    }
    // deferred screen-fx beats (instant sequences): resolve anchors and fire
    for (const s of this.screenFxQueue) {
      if (!s.active) continue;
      s.t -= dt;
      if (s.t > 0) continue;
      s.active = false;
      const at = s.entityId >= 0 ? this.anchor(s.entityId, 0.5, anchorScratchA) : s;
      if (at) this.screenFxAt(at.x, at.y, at.z, s.strength);
    }
    // The small ground discs thin their terrain drape with camera distance
    // (../drape_lod_core), so the decal pool needs this frame's camera before
    // anything spawns into it. The shock rings deliberately do NOT thin: their
    // footprints are too wide for an interpolated drape to stay honest.
    this.decals.setCameraPosition(camPosScratch.x, camPosScratch.z);
    for (const [id, storm] of this.warriorStorms) {
      const at = storm.stamp === this.frame ? this.anchor(id, 0, anchorScratchA) : null;
      if (!at) {
        this.warriorStorms.delete(id);
        this.crests.releaseHeld(id);
        continue;
      }
      storm.surface = this.crests.holdStorm(id, at.x, at.y, at.z, storm.elapsed);
      if (!reducedMotion && this.qualityLevel > 0.55 && storm.elapsed >= storm.nextDust) {
        storm.nextDust = storm.elapsed + 0.14;
        const angle = storm.elapsed * 14,
          x = at.x + Math.sin(angle) * 3.2,
          z = at.z + Math.cos(angle) * 3.2;
        this.bakedAt(
          'smoke',
          x,
          this.groundY(x, z) + 0.25,
          z,
          1.8,
          0x7d8b94,
          0xa9b4ba,
          0.4,
          0,
          0,
          angle,
        );
      }
    }
    this.crests.update(dt, reducedMotion);
    this.overlay.beginFrame();
    this.controlSignals.update(dt, this.anchor);
    // The CC bands draw FIRST in the frame's overlay batch: a hard-CC tell is
    // actionable information, so capacity contention with the decorative
    // sprites that follow must never be able to drop it. The band count is
    // itself bounded (MAX_CC_BANDS, ONE budget across all three types), so a
    // raid-wide mass CC cannot starve the windup telegraphs and worn-debuff
    // bands drawn after it. Slots go by severity first and then to bands IN
    // FRONT of the camera before any behind it (ccBandRankKey owns why both
    // are fairness rules, not polish). The sequencer's cast-moment ccStars
    // stand down only for the bands that actually win a slot here, so the two
    // are one continuous read for a drawn band, and a band the cap drops still
    // reads through the burst.
    let ccPicks = 0;
    for (const [id, s] of this.ccBands) {
      if (s.stamp !== this.frame) {
        this.ccBands.delete(id);
        continue;
      }
      const spec = CC_BAND_SPECS[s.type];
      const at = this.anchorOf(id, spec.anchorFrac, anchorScratchA);
      if (!at) continue;
      s.hx = at.x;
      s.hy = at.y;
      s.hz = at.z;
      const dx = at.x - camPosScratch.x;
      const dy = at.y - camPosScratch.y;
      const dz = at.z - camPosScratch.z;
      const inFront = dx * camFwdScratch.x + dy * camFwdScratch.y + dz * camFwdScratch.z > 0;
      const key = ccBandRankKey(spec.severity, dx * dx + dy * dy + dz * dz, inFront);
      ccPicks = insertCcBandPick(this.ccPickIds, this.ccPickKeys, ccPicks, id, key, MAX_CC_BANDS);
    }
    // Published BEFORE sequencer.update below, which asks heldCcBand.
    this.ccPickCount = ccPicks;
    for (let i = 0; i < ccPicks; i++) {
      const s = this.ccBands.get(this.ccPickIds[i]);
      if (s) this.drawCcBand(s);
    }
    this.overlay.protectPrefix();
    for (const [id, w] of this.windups) {
      if (w.stamp !== this.frame) {
        this.windups.delete(id);
        continue;
      }
      const charge = chargeEnvelope(w.progress);
      if (!reducedMotion) this.bodyLeanCb?.(id, WINDUP_LEAN_RAD * charge);
      this.drawWindup(id, w.style, w.colorHex, charge, w.streams, w.accentHex, reducedMotion);
    }
    anchorScratchB.copy(camFwdScratch).negate();
    this.warriorAttention.draw(
      this.frame,
      reducedMotion,
      this.anchor,
      anchorScratchB,
      this.overlay,
    );
    for (const [id, bands] of this.orbits) {
      for (let i = bands.length - 1; i >= 0; i--) {
        if (bands[i].stamp !== this.frame) {
          bands.splice(i, 1);
          this.orbitBandCount--;
        }
      }
      if (bands.length === 0) {
        this.orbits.delete(id);
        continue;
      }
      for (const band of bands) {
        band.age += dt;
        this.drawOrbit(id, band);
      }
    }
    // the archetype sequences advance here so their transient draws (release
    // flash, gavel descent, stun stars) land inside this frame's overlay batch
    this.sequencer.update(this, dt);
    this.furyAudio.update(this, dt);
    // Pack after the sequence emits this frame's contacts, so the visible
    // wound and native weapon contact share one frame. Advance each pool once.
    this.ribbons.update(
      dt,
      camPosScratch,
      reducedMotion,
      this.drawHeldConduction,
      this.drawPriorityStorms,
    );
    this.furyStates.draw(
      this.frame,
      dt,
      reducedMotion,
      this.anchor,
      this.weaponAnchor,
      this.bodyAnchor,
      this.camera,
      camPosScratch,
    );
    this.water.update(dt, reducedMotion);
    this.details.update(dt, this.camera.quaternion, reducedMotion);
    this.forms.update(dt, reducedMotion);
    this.contacts.advance(dt);
    this.baked.update(dt, this.camera.quaternion, reducedMotion);
    this.fragments.update(dt, reducedMotion);
    this.rings.update(dt, this.camera.quaternion);
    this.flipbooks.update(dt, this.camera.quaternion);
    this.decals.update(dt);
    this.pillars.update(dt);
    this.shells.update(dt, this.time, this.frame, this.anchor);
    this.groundAuras.update(
      dt,
      this.time,
      this.frame,
      this.anchor,
      this.groundY,
      camPosScratch.x,
      camPosScratch.z,
    );
    this.spirits.update(dt);
    this.ribbons.drawHeads(this.time, this.headSink, reducedMotion);
    this.overlay.commit();
    for (const [id, g] of this.glows) {
      if (g.stamp === this.frame) {
        // held: rise toward the target, or decay DOWN to it after a pulse
        g.level =
          g.level < g.target
            ? Math.min(g.target, g.level + dt * 10)
            : Math.max(g.target, g.level - dt * (g.slow ? 0.9 : 2.2));
      } else {
        g.level -= dt * (g.slow ? 0.9 : 2.2);
        g.target = 0;
      }
      if (g.level <= 0.03 && g.stamp !== this.frame) {
        this.applyGlow?.(id, g.color, 0);
        this.glows.delete(id);
        continue;
      }
      this.applyGlow?.(id, g.color, Math.min(0.85, g.level * 0.38));
    }
    this.frame++;
  }

  clear(): void {
    this.guards.clear();
    this.powerForms.clear();
    this.furyStates.clear();
    this.warriorAttention.clear();
    this.warriorStorms.clear();
    this.furyAudio.clear();
    this.ribbons.clear();
    this.water.clear();
    this.baked.clear();
    this.fragments.clear();
    this.details.clear();
    this.forms.clear();
    this.contacts.clear();
    this.crests.clear();
    this.rings.clear();
    this.flipbooks.clear();
    this.decals.clear();
    this.pillars.clear();
    this.shells.clear();
    this.groundAuras.clear();
    this.spirits.clear();
    this.sequencer.clear();
    for (const [id, g] of this.glows) this.applyGlow?.(id, g.color, 0);
    this.glows.clear();
    this.windups.clear();
    this.orbits.clear();
    this.orbitBandCount = 0;
    this.ccBands.clear();
    this.controlSignals.clear();
    this.ccPickCount = 0;
    for (const s of this.screenFxQueue) s.active = false;
  }

  /** Terminal cleanup for all pooled Three primitives owned by this engine.
   * The ability texture cache remains shared and is intentionally not disposed
   * here. Child pools own their slot materials and geometries, while Spirit
   * puppets release only their per-renderer ghost materials and never GLB
   * cache geometry. */
  dispose(): void {
    if (this.disposed) return;
    cancelActiveAbilityKit(this.scene);
    this.disposed = true;
    const errors: unknown[] = [];
    const release = (work: () => void) => {
      try {
        work();
      } catch (error) {
        errors.push(error);
      }
    };
    release(() => this.clear());
    this.worldLightCb = null;
    release(() => this.ribbons.dispose());
    release(() => this.water.dispose());
    release(() => this.baked.dispose());
    release(() => this.fragments.dispose());
    release(() => this.details.dispose());
    release(() => this.forms.dispose());
    release(() => this.crests.dispose());
    release(() => this.guards.dispose());
    release(() => this.powerForms.dispose());
    release(() => this.furyStates.dispose());
    release(() => this.rings.dispose());
    release(() => this.flipbooks.dispose());
    release(() => this.decals.dispose());
    release(() => this.pillars.dispose());
    release(() => this.shells.dispose());
    release(() => this.groundAuras.dispose());
    release(() => this.spirits.dispose());
    release(() => this.overlay.dispose());
    release(() => this.controlSignals.dispose());
    this.particleBurst = null;
    this.lightPulseCb = null;
    this.statSink = null;
    this.applyGlow = null;
    this.shakeCb = null;
    this.bodyLeanCb = null;
    this.screenImpactCb = null;
    this.abilityAudioCb = null;
    this.onPresentationMoment = null;
    if (errors.length) throw new AggregateError(errors, 'Ability VFX cleanup failed');
  }

  private intensity(): number {
    return 0.55 + 0.45 * this.qualityLevel;
  }

  // Windup ceremonies (gallery windupStyle set), all immediate-mode overlay
  // sprites recomputed per frame from the live cast progress:
  //   orb     a glow converging and swelling between the hands (the default)
  //   runes   a rotating rune circle at the feet, tightening as the cast fills
  //   vortex  wide sparks pulled inward, the drain-cast read
  //   compression compact paired wisps collapsing into a sharp hand point
  //   ascend  a rising mote column crowned by a star near completion
  //   stance  low dust drifting at the feet (warrior stances)
  //   weapon  a hand-height star building along the weapon
  private drawWindup(
    entityId: number,
    style: WindupStyle,
    colorHex: number,
    progress: number,
    streams = 1,
    accentHex = colorHex,
    reducedMotion = false,
  ): void {
    const p = Math.min(1, Math.max(0, progress));
    const q = 0.75 + 0.25 * this.qualityLevel;
    const pulse = reducedMotion ? 1 : 1 + 0.07 * Math.sin(this.time * 14);
    if (hasClassCast(style)) {
      const at = this.anchor(entityId, 0, anchorScratchA);
      if (at)
        drawClassCast(
          this.overlay,
          style,
          at,
          this.facingAt(entityId) ?? 0,
          colorHex,
          accentHex,
          p,
          q,
        );
      return;
    }
    if (style === 'runes') {
      const feet = this.anchor(entityId, 0.04, anchorScratchA);
      if (!feet) return;
      const n = 4;
      const r = 1.25 - 0.35 * p;
      for (let k = 0; k < n; k++) {
        const a = this.time * 1.4 + (k / n) * Math.PI * 2;
        this.overlay.push(
          feet.x + Math.cos(a) * r,
          feet.y + 0.14,
          feet.z + Math.sin(a) * r,
          colorHex,
          0.3 * q,
          OVERLAY_CELL.rune,
          0.55 + 0.45 * p,
          2.1,
        );
      }
      const chest = this.anchor(entityId, 0.58, anchorScratchB);
      if (chest)
        this.overlay.push(
          chest.x,
          chest.y,
          chest.z,
          colorHex,
          0.24 * (0.5 + p) * pulse * q,
          OVERLAY_CELL.glow,
          0.7,
          1.8,
        );
      return;
    }
    if (style === 'stance') {
      const feet = this.anchor(entityId, 0.06, anchorScratchA);
      if (!feet) return;
      for (let k = 0; k < 3; k++) {
        const a = this.time * 1.1 + k * 2.1 + entityId;
        const r = 0.5 + 0.35 * Math.sin(this.time * 2.4 + k);
        this.overlay.push(
          feet.x + Math.cos(a) * r,
          feet.y + 0.12 + 0.1 * Math.sin(this.time * 3 + k),
          feet.z + Math.sin(a) * r,
          colorHex,
          0.22 * q,
          OVERLAY_CELL.glow,
          0.4 + 0.3 * p,
          1.2,
        );
      }
      return;
    }
    if (style === 'weapon') {
      const hand = this.anchor(entityId, 0.46, anchorScratchA);
      if (!hand) return;
      this.overlay.push(
        hand.x,
        hand.y,
        hand.z,
        colorHex,
        (0.16 + 0.3 * p) * pulse * q,
        OVERLAY_CELL.star,
        0.55 + 0.45 * p,
        2.5,
      );
      this.overlay.push(
        hand.x,
        hand.y,
        hand.z,
        colorHex,
        (0.3 + 0.35 * p) * q,
        OVERLAY_CELL.glow,
        0.5,
        1.6,
      );
      return;
    }
    if (style === 'ascend') {
      const feet = this.anchor(entityId, 0.04, anchorScratchA);
      const head = this.anchor(entityId, 1.0, anchorScratchB);
      if (!feet || !head) return;
      const span = head.y - feet.y + 0.8;
      for (let k = 0; k < 4; k++) {
        const f = (this.time * 0.45 + k / 4) % 1;
        const a = this.time * 2 + k * 1.7;
        this.overlay.push(
          feet.x + Math.cos(a) * 0.35,
          feet.y + f * span,
          feet.z + Math.sin(a) * 0.35,
          colorHex,
          0.2 * q,
          OVERLAY_CELL.glow,
          (1 - f) * (0.4 + 0.6 * p),
          1.9,
        );
      }
      this.overlay.push(
        head.x,
        head.y + 0.5,
        head.z,
        colorHex,
        0.3 * p * pulse * q,
        OVERLAY_CELL.star,
        p,
        2.6,
      );
      return;
    }
    if (style === 'compression') {
      const at = this.anchor(entityId, 0.58);
      if (!at) return;
      const reach = 0.18 + 1.05 * (1 - p);
      const coreSize = (0.14 + 0.22 * p) * pulse * q;
      for (let stream = 0; stream < streams; stream++) {
        const baseAngle =
          (reducedMotion ? 0 : this.time * (3.6 + stream * 0.25)) +
          (stream * Math.PI * 2) / streams +
          entityId * 0.37;
        const streamColor = stream % 2 === 0 ? colorHex : accentHex;
        for (let node = 0; node < 3; node++) {
          const along = (node + 1) / 3;
          const radius = reach * along;
          const angle = baseAngle - along * (1.8 + 0.65 * p);
          this.overlay.push(
            at.x + Math.cos(angle) * radius,
            at.y + 0.1 + (stream - (streams - 1) * 0.5) * 0.08 * (1 - p),
            at.z + Math.sin(angle) * radius,
            streamColor,
            (0.065 + 0.025 * along) * q,
            OVERLAY_CELL.spark,
            0.5 + 0.38 * p,
            1.8 + 0.45 * p,
          );
        }
      }
      this.overlay.push(at.x, at.y + 0.1, at.z, colorHex, coreSize, OVERLAY_CELL.glow, 0.75, 1.25);
      this.overlay.push(
        at.x,
        at.y + 0.1,
        at.z,
        accentHex,
        coreSize * 0.42,
        OVERLAY_CELL.spark,
        0.55 + 0.4 * p,
        2.8,
      );
      return;
    }
    // orb (default) and vortex share the hand orb; vortex pulls from wider out
    const at = this.anchor(entityId, 0.58, anchorScratchA);
    if (!at) return;
    const size = (0.28 + 0.5 * p) * pulse * q;
    this.overlay.push(at.x, at.y + 0.12, at.z, colorHex, size, OVERLAY_CELL.glow, 0.85, 1.9);
    this.overlay.push(
      at.x,
      at.y + 0.12,
      at.z,
      colorHex,
      size * 0.45,
      OVERLAY_CELL.star,
      0.5 + 0.5 * p,
      2.6,
    );
    if (style === 'vortex' && streams > 1) {
      const streamReach = 0.22 + 1.85 * (1 - p);
      for (let stream = 0; stream < streams; stream++) {
        const baseAngle =
          (reducedMotion ? 0 : this.time * (2.8 + stream * 0.2)) +
          (stream * Math.PI * 2) / streams +
          entityId * 0.37;
        const streamColor = stream % 2 === 0 ? colorHex : accentHex;
        for (let node = 0; node < 3; node++) {
          const along = (node + 1) / 3;
          const radius = streamReach * along;
          const angle = baseAngle - along * (1.4 + 0.8 * p);
          this.overlay.push(
            at.x + Math.cos(angle) * radius,
            at.y +
              0.12 +
              (stream - (streams - 1) * 0.5) * 0.16 * (1 - p) +
              (reducedMotion ? 0 : Math.sin(this.time * 6 + stream + node) * 0.05),
            at.z + Math.sin(angle) * radius,
            streamColor,
            (0.12 + 0.055 * along) * q,
            node === 2 ? OVERLAY_CELL.star : OVERLAY_CELL.spark,
            0.62 + 0.3 * p,
            2.2 + 0.45 * p,
          );
        }
      }
    } else if (this.qualityLevel >= MOTE_QUALITY_GATE) {
      const motes = style === 'vortex' ? 4 : 2;
      const reach = style === 'vortex' ? 1.9 : 0.9;
      for (let k = 0; k < motes; k++) {
        const a = this.time * 5 + (k * Math.PI * 2) / motes + entityId;
        const r = 0.25 + reach * (1 - p);
        this.overlay.push(
          at.x + Math.cos(a) * r,
          at.y + 0.12 + Math.sin(this.time * 3 + k * 2) * 0.14,
          at.z + Math.sin(a) * r,
          colorHex,
          0.16,
          OVERLAY_CELL.spark,
          0.7,
          2.2,
        );
      }
    }
  }

  // The nine buff-orbit body bands (gallery updateOneOrbit), all immediate-
  // mode overlay sprites recomputed per frame - except heartbeat's chest
  // pulse, which rides the pooled shock rings at its authored bpm. buff.o
  // overrides the style DNA so same-band buffs still read as different spells.
  private drawOrbit(entityId: number, band: OrbitBand): void {
    if (band.o === QUEUED_WEAPON_DNA || band.style === 'bladeCharges') {
      if (!band.weaponSample && this.time >= band.weaponRetryAt) {
        band.weaponSample = this.weaponAnchor?.(entityId, 0) ?? null;
        band.weaponRetryAt = this.time + 0.25;
      }
      if (!band.weaponSample) return;
      if (!band.weaponSample(anchorScratchA)) {
        band.weaponSample = null;
        band.weaponRetryAt = this.time + 0.25;
        return;
      }
      const { x, y, z } = anchorScratchA;
      const alpha = Math.min(1, band.age / 0.12);
      if (band.style === 'bladeCharges') {
        const charges = band.o?.n ?? 1;
        // Fixed camera-right separation preserves an honest count from every
        // view without orbiting the character. Both marks follow the real blade.
        for (let i = 0; i < charges; i++) {
          const spread = (i - (charges - 1) * 0.5) * 0.32;
          const px = x + this.camRightX * spread,
            pz = z + this.camRightZ * spread;
          this.overlay.push(px, y + 0.13, pz, 0x966142, 0.34, OVERLAY_CELL.glow, alpha * 0.65, 1.1);
          this.overlay.push(px, y + 0.13, pz, band.colorHex, 0.2, OVERLAY_CELL.star, alpha, 2);
        }
        return;
      }
      this.overlay.push(x, y, z, band.colorHex, 0.25, OVERLAY_CELL.glow, alpha * 0.55, 1.3);
      this.overlay.push(x, y, z, band.colorHex, 0.16, OVERLAY_CELL.star, alpha * 0.9, 1.8);
      return;
    }
    // Only the final frame winner invalidates the sampler: an aura may feed
    // this same slot before the queued cue overwrites it later in syncEntity.
    band.weaponSample = null;
    band.weaponRetryAt = 0;
    const dna = ORBIT_DNA[band.style];
    const at = this.anchor(entityId, dna.frac, anchorScratchA);
    if (!at) return;
    const o = band.o;
    const fade = Math.min(1, band.age / 0.25) * (0.55 + 0.45 * this.qualityLevel);
    const halve = band.tier >= 1;
    const color = band.colorHex;
    const t = this.time;
    if (band.style === 'breachMark' || band.style === 'quakeBurden') {
      drawWarriorWornMark(
        this.overlay,
        band.style === 'breachMark',
        at,
        this.camRightX,
        this.camRightZ,
        band.style === 'breachMark' ? OVERLAY_CELL.breachMark : OVERLAY_CELL.quakeBurden,
        Math.min(1, band.age / 0.12),
        -camFwdScratch.x,
        -camFwdScratch.y,
        -camFwdScratch.z,
      );
      return;
    }
    if (band.style === 'heartbeat') {
      // pounding pulse rings off the chest: frenzy buffs race (Recklessness
      // bpm 170), fortitude thumps slow
      const period = 60 / Math.min(240, Math.max(30, o?.bpm ?? 83));
      if (band.age >= band.beat) {
        band.beat = band.age + period;
        // the beat is the ring + chest glimmer alone: orbits never feed a
        // body tint (the rig emissive is reserved for casts and morph rims)
        this.rings.spawn(
          at.x,
          at.y,
          at.z,
          o?.ringR ?? dna.radius,
          0.5,
          color,
          1.5 * this.intensity() * Math.min(1, fade * 2),
          true,
        );
      }
      if (!halve) {
        // chest glimmer swelling right after each beat
        const since = Math.min(1, Math.max(0, 1 - (band.beat - band.age) / period));
        const swell = Math.exp(-since * 5);
        this.overlay.push(
          at.x,
          at.y,
          at.z,
          color,
          dna.size * (1 + swell),
          dna.cell,
          fade * (0.35 + 0.45 * swell),
          1.9,
        );
      }
      return;
    }
    if (band.style === 'conduction' || band.style === 'wardCharges') {
      const facing = this.facingAt(entityId) ?? 0;
      const rx = Math.cos(facing),
        rz = -Math.sin(facing);
      const stormTime = this.reducedMotionActive ? 0 : t;
      const pulse = 0.7 + 0.3 * Math.sin(stormTime * 7);
      if (band.style === 'wardCharges' && o?.n !== undefined) {
        for (let node = 0; node < o.n; node++) {
          const d = node === 0 ? -0.7 : node === 1 ? 0.7 : 0;
          const forward = node === 2 ? 0.72 : 0;
          const px = at.x + rx * d + Math.sin(facing) * forward;
          const pz = at.z + rz * d + Math.cos(facing) * forward;
          const py = at.y + (node === 2 ? -0.15 : 0.32);
          this.overlay.push(px, py, pz, color, 0.52, OVERLAY_CELL.glow, fade * 0.8, 2.2);
          for (let j = 0; j < 2; j++) {
            const a = stormTime * 8 + node * 2.1 + j * 3.1;
            this.overlay.push(
              px + Math.cos(a) * 0.13,
              py + Math.sin(a * 1.7) * 0.11,
              pz + Math.sin(a) * 0.13,
              color,
              0.17,
              OVERLAY_CELL.spark,
              fade * pulse,
              2.8,
            );
          }
        }
        return;
      }
      for (let side = -1; side <= 1; side += 2)
        for (let j = 0; j < 4; j++) {
          const d = side * (0.28 + j * 0.13);
          const lift = Math.sin(j * 2.1 + stormTime * 5) * 0.06;
          this.overlay.push(
            at.x + rx * d,
            at.y + 0.22 - j * 0.12 + lift,
            at.z + rz * d,
            color,
            j === 3 ? 0.26 : 0.17,
            OVERLAY_CELL.spark,
            fade * pulse,
            1.9,
          );
        }
      return;
    }
    if (band.style === 'speedlines') {
      // wind-blur streaks at the LEG band, under everything else; per-frame
      // flicker and jitter IS the gallery read. o overrides: n streak count,
      // radius streak length, size sprite size (defaults = the classic DNA, so
      // Onrush/Blade Ward keep their exact look). Streaks never dip below the
      // terrain: on a low quadruped (a hamstrung boar) the +-0.45 jitter used
      // to bury half the band, which only ever hid sprites.
      const streaks = orbitCount(Math.min(4, o?.n ?? dna.n), halve);
      const rate = o?.rate ?? 1;
      const len0 = o?.radius ?? dna.radius;
      const size0 = o?.size ?? dna.size;
      const gy = this.groundY(at.x, at.z) + 0.07;
      const rx = this.camRightX;
      const rz = this.camRightZ;
      for (let s = 0; s < streaks; s++) {
        if (Math.random() > 0.6) continue;
        const y = Math.max(gy, at.y + (Math.random() - 0.5) * 0.9);
        const off = (Math.random() - 0.5) * 0.7;
        const ox = -rz * off;
        const oz = rx * off;
        const len = len0 * (0.8 + 0.4 * Math.random()) * (0.8 + 0.2 * rate);
        for (let j = 0; j < 3; j++) {
          const d = len * (1 - j);
          this.overlay.push(
            at.x + rx * d + ox,
            y,
            at.z + rz * d + oz,
            color,
            size0 * (1 - 0.15 * j),
            dna.cell,
            fade * (0.7 - 0.18 * j),
            1.6,
          );
        }
      }
      return;
    }
    if (band.style === 'wings') {
      // spectral rib fan off the back (Rallying Cry's war banner): a glow per
      // rib per side plus a shoulder root, flapping on flapRate
      const ribs = Math.max(2, Math.min(5, o?.ribs ?? dna.n));
      const nRibs = halve ? Math.max(2, Math.ceil(ribs / 2)) : ribs;
      const span = o?.span ?? dna.radius;
      const flap = Math.sin(t * (o?.flapRate ?? dna.rate)) * dna.weave;
      const rx = this.camRightX;
      const rz = this.camRightZ;
      for (let side = -1; side <= 1; side += 2) {
        this.overlay.push(
          at.x + rx * side * 0.2,
          at.y + 0.15,
          at.z + rz * side * 0.2,
          color,
          0.3 * span,
          OVERLAY_CELL.glow,
          fade * 0.5,
          1.6,
        );
        for (let f = 0; f < nRibs; f++) {
          const u = nRibs > 1 ? f / (nRibs - 1) : 0;
          const lat = (0.55 + u * 0.95) * span;
          this.overlay.push(
            at.x + rx * side * lat,
            at.y + (0.6 - u * 1.05) * span + flap * (0.4 + u * 0.65),
            at.z + rz * side * lat,
            color,
            dna.size * span * (1 - u * 0.3),
            dna.cell,
            fade * (0.85 - u * 0.3),
            1.8,
          );
        }
      }
      return;
    }
    if (band.style === 'weaponGlow') {
      // enchanted weapon shimmer at the hand: soft glow, pulsing star, and a
      // flickering spark shed off the blade. An authored o.radius circles the
      // accent slowly around the hand band: center-pinned sprites depth-test
      // behind the rig from the chase camera, so a tell that must read from
      // ANY angle (Reaver Strike's queued ember) orbits just outside the
      // silhouette. radius 0 (the DNA default) keeps the classic pinned
      // shimmer exactly.
      const orbitR = o?.radius ?? dna.radius;
      const oa = band.phase + t * 1.7 * (o?.rate ?? 1);
      const wx = at.x + Math.cos(oa) * orbitR;
      const wz = at.z + Math.sin(oa) * orbitR;
      const pulse = 1 + 0.15 * Math.sin(t * 6 * (o?.rate ?? 1));
      this.overlay.push(wx, at.y, wz, color, 0.4 * pulse, OVERLAY_CELL.glow, fade * 0.55, 1.6);
      this.overlay.push(
        wx,
        at.y,
        wz,
        color,
        (o?.size ?? dna.size) * pulse,
        dna.cell,
        fade * 0.85,
        2.4,
      );
      if (!halve && Math.random() < 0.4) {
        this.overlay.push(
          wx + (Math.random() - 0.5) * 0.25,
          at.y + (Math.random() - 0.3) * 0.4,
          wz + (Math.random() - 0.5) * 0.25,
          color,
          0.14,
          OVERLAY_CELL.spark,
          fade * 0.8,
          2.2,
        );
      }
      return;
    }
    if (band.style === 'leaves') {
      // rising mote column (heals, regrowth): motes cycle feet to crown,
      // fading in and out over the climb. A NEGATIVE o.up runs the cycle
      // backwards - falling motes (Bleed Out's dripping blood) - so the
      // phase is wrapped into [0,1) instead of relying on JS % keeping sign.
      const n = orbitCount(Math.max(3, Math.min(7, Math.round((o?.density ?? 12) * 0.5))), halve);
      const spread = o?.spread ?? dna.radius;
      const up = o?.up ?? 1;
      for (let k = 0; k < n; k++) {
        const f = (((t * dna.rate * up + k / n) % 1) + 1) % 1;
        const a = band.phase + k * 2.4 + t * 0.3;
        const r = 0.35 + spread * 0.55 * ((k * 0.618) % 1);
        this.overlay.push(
          at.x + Math.cos(a) * r,
          at.y + 0.15 + f * (o?.span ?? 2.1),
          at.z + Math.sin(a) * r,
          color,
          o?.size ?? dna.size,
          dna.cell,
          fade * Math.sin(f * Math.PI) * 0.9,
          1.7,
        );
      }
      return;
    }
    // circular orbit family: halo (head) / sparks (shoulders) / plates
    // (waist) / runes (ankles). o.rate MULTIPLIES the style's base speed;
    // radius/weave/incline/size/tex override outright. Plates run dimmer and
    // larger so they read as translucent facets, not hot points.
    const plates = band.style === 'plates';
    const n = orbitCount(Math.min(MAX_ORBIT_SPRITES, o?.n ?? dna.n), halve);
    const rate = dna.rate * (o?.rate ?? 1);
    const radius = o?.radius ?? dna.radius;
    const weave = o?.weave ?? dna.weave;
    const incline = o?.incline ?? 0;
    const size = plates ? dna.size * (o?.size ?? 1) : (o?.size ?? dna.size);
    const cell = (o?.tex !== undefined ? ORBIT_TEX_CELL[o.tex] : undefined) ?? dna.cell;
    for (let k = 0; k < n; k++) {
      const a = band.phase + t * rate + (k / n) * Math.PI * 2;
      const y = at.y + Math.sin(t * 2 + k * 2) * weave + Math.sin(a) * incline;
      this.overlay.push(
        at.x + Math.cos(a) * radius,
        y,
        at.z + Math.sin(a) * radius,
        color,
        size,
        cell,
        plates ? 0.7 * fade : fade,
        plates ? 1.3 : 2.1,
      );
    }
  }
}
