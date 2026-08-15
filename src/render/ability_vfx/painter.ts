// Thin painter for the per-ability spell VFX system: resolves an event's
// ability id against the authored spec table (ability_vfx_specs.ts), asks the
// pure core (ability_vfx_core.ts) for a plan, and drives the pooled Vfx
// particle primitives plus the gallery-ported primitive engine (fx.ts: ribbon
// trails, shock rings, ground decals, windup orbs, buff orbits) with the
// spec's color, scale, and archetype. Unknown ability or fx kind: it declines
// and the renderer's generic school-colored arm runs unchanged.

import { ABILITIES } from '../../sim/data';
import {
  AbilityVfxBudget,
  type AbilityVfxFullSpec,
  type AbilityVfxPlan,
  type AbilityVfxSpec,
  abilityHexColor,
  abilityVfxChargeStreams,
  abilityVfxColor,
  localCasterTier,
  planCast,
  planImpact,
  wornCcBand,
} from '../ability_vfx_core';
import { holdsBuffVfxWhileWorn } from '../ability_vfx_longbuff_core';
import { abilityVfxFullSpec, abilityVfxSpec } from '../ability_vfx_registry';
import { isVisuallyDead } from '../anim_state';
import type { AbilityAudioKind, AbilityAudioOpts } from '../audio_sink';
import { attackAbilityId } from '../characters/weapon_attack_style_core';
import { type AbilityVfxFx, asOrbitStyle, type ParticleBurstKind } from './fx';

interface VfxPoint {
  x: number;
  y: number;
  z: number;
}

// The few Vfx methods this painter drives (structurally satisfied by Vfx).
export interface AbilityVfxPrimitives {
  projectile(
    sourceId: number,
    targetId: number,
    school: string,
    scale?: number,
    color?: number,
  ): void;
  lightningProjectile(sourceId: number, targetId: number, color?: number): void;
  burst(at: VfxPoint, school: string, count?: number, power?: number, color?: number): void;
  nova(centerId: number, school: string, color?: number): void;
  tick(targetId: number, school: string, color?: number): void;
  shoutwave(centerId: number, colorHex: number): void;
  buffSwirl(targetId: number, color?: number): void;
  beam(sourceId: number, targetId: number, school: string, colorOverride?: number): void;
}

// Dev probe counters (scripts/ability_vfx_probe.mjs): how often each ability's
// events were claimed and how many primitives that spawned. Always-on because
// the cost is two integer bumps per CAST, but only exposed on the dev-only
// window.__game surface.
export interface AbilityVfxStat {
  claimed: number;
  primitives: number;
}

export interface AbilityVfxDeps {
  vfx: AbilityVfxPrimitives;
  // The gallery-ported primitive engine (rings, ribbons, decals, overlays).
  fx: AbilityVfxFx;
  // The renderer's entity anchor (same closure Vfx homes on): world position at
  // a height fraction, or null when the entity has no view yet.
  anchor: (id: number, heightFrac: number) => VfxPoint | null;
  spawnAoeRing: (x: number, z: number, radius: number, school: string, colorHex?: number) => void;
  triggerAttack: (entityId: number, abilityId?: string) => void;
  // The renderer's pooled talent-moment point light (pulseAt); optional so
  // tests can omit it.
  lightPulse?: (
    entityId: number,
    school: string,
    intensity: number,
    duration: number,
    range?: number,
  ) => void;
  // Writes the rig body glow (CharacterVisual.setAuraGlow); optional for tests.
  setAuraGlow?: (entityId: number, colorHex: number, intensity: number) => void;
  // Plays the caster's roar/cheer one-shot for shout casts; optional for tests.
  playShoutAnim?: (entityId: number) => void;
  // Entity lookups mirroring the renderer's generic-arm checks (all optional
  // for tests): mob-kind, live cast state, and whether the rig is already
  // playing a one-shot - the painter replicates the mob-throw fallback the
  // generic arm applies when it does NOT claim.
  isMob?: (entityId: number) => boolean;
  castingAbilityOf?: (entityId: number) => string | null;
  isMidOneShot?: (entityId: number) => boolean;
  // The local player's entity id (cast-acknowledgment gestures).
  localPlayerId?: () => number;
  // True when the entity's rig authors a per-ability one-shot clip
  // (manifest attackByAbility with a live action). Gates the ceremonial cast
  // gesture below: without an authored clip, triggerAttack would fall back to
  // a weapon swing, which a blessing must never read as. Optional for tests.
  hasGestureClip?: (entityId: number, abilityId: string) => boolean;
  // True when the ability resolves with no cast bar (no cast time, channel, or
  // empower hold). Only these get the synthetic pre-release windup phase: a
  // real cast already performed its ceremony through the live castingAbility
  // path in syncEntity. Unknown ids should return true.
  isInstantAbility?: (abilityId: string) => boolean;
  // Adds camera trauma (the renderer's Fiesta addShake accumulator); the fx
  // engine applies distance falloff and a rolling budget before it. Optional
  // so tests can omit it.
  addShake?: (amount: number) => void;
  // Contact-frame hitstop on ONE rig (CharacterVisual.holdFrame): briefly hold
  // that character's animation clock at `scale` for `dur` seconds. The visual
  // guards stacking; the world clock is never touched. Optional for tests.
  animHold?: (entityId: number, scale: number, dur: number) => void;
  // Per-frame windup lean feed on a caster's rig (CharacterVisual.
  // setWindupLean); the fx engine drives it from the staged windup ceremony.
  // Optional for tests.
  bodyLean?: (entityId: number, amount: number) => void;
  // One-frame white screen flash (local-player crit pop); the renderer gates
  // on composer + reduced motion. Optional for tests.
  screenFlash?: (strength: number) => void;
  // World-anchored screen distortion ripple + faint flash (spec.screenFx
  // moments); the renderer projects onto the post chain, composer-gated like
  // bloom. The fx engine applies distance falloff first. Optional for tests.
  screenImpact?: (x: number, y: number, z: number, strength: number) => void;
  // Per-ability audio (src/game/sfx.ts: sampled pack + procedural recipes via
  // the renderer's spatial audio sink): release/impact/spirit/motif ride the
  // sequencer's exact moments, this painter fires zone pulses and crit stings
  // directly. Optional for tests and hosts without an audio engine.
  abilityAudio?: (
    kind: AbilityAudioKind,
    palette: string,
    power: number,
    x: number,
    y: number,
    z: number,
    opts?: AbilityAudioOpts,
  ) => void;
}

// Structural slices of the SimEvent members this painter consumes.
export interface AbilityVfxSpellfxEvent {
  sourceId: number;
  targetId: number;
  school: string;
  fx: string;
  ability?: string;
  attackAnimation?: 'ranged-shot';
}

// Structural slice of the point-anchored SimEvent member ('spellfxAt').
export interface AbilityVfxSpellfxAtEvent {
  x: number;
  z: number;
  school: string;
  fx: string;
  ability?: string;
  radius?: number;
  sourceId?: number;
}

export interface AbilityVfxDamageEvent {
  sourceId: number;
  targetId: number;
  school: string;
  ability: string | null;
  kind: string;
  crit: boolean;
  amount: number;
}

export interface AbilityVfxAuraEvent {
  targetId: number;
  gained: boolean;
  ability?: string;
}

// The per-frame entity slice syncEntity consumes (Entity satisfies it).
// kind/templateId are optional so tests can omit them; for players templateId
// IS the class id, which warms that class's spirit models on first sighting.
export interface AbilityVfxEntityState {
  id: number;
  castingAbility: string | null;
  castRemaining: number;
  castTotal: number;
  // breakThreshold rides along for the Lingering Dread fear alias (present on
  // the offline sim's live Aura objects; mirrored online as a presence-only 1
  // via the aura wire's bt flag). kind/remaining feed the stunned-star tell
  // (both live on the offline Aura and on the online mirror via the aura
  // wire's kind/rem), and dead gates it off a corpse; optional so tests can
  // omit them.
  auras: readonly { id: string; kind?: string; remaining?: number; breakThreshold?: number }[];
  // dead + hp gate the stun tell off a corpse through isVisuallyDead; both
  // optional so tests can omit them (an absent hp reads as alive).
  dead?: boolean;
  hp?: number;
  kind?: string;
  templateId?: string;
  // On-next-swing queue (heroic-strike style ability id while armed). Present
  // on every offline entity; the online mirror carries it for the local
  // player (the self wire's `queued`), others stay null - which is where the
  // tell matters: it is your own armed strike.
  queuedOnSwing?: string | null;
}

interface AbilityVfxHeldSemanticState {
  castingAbility: string | null;
  queuedOnSwing: string | null;
  auraStamps: Map<string, number>;
  serial: number;
  frameSeen: number;
}

// The cast-moment fx kinds this painter claims; everything else stays generic.
const CAST_FX = new Set([
  'projectile',
  'heavyBolt',
  'lightning',
  'windup',
  'shout',
  'nova',
  'tick',
  'beam',
  'selfCast',
]);
// spawnAoeRing radius in yards per spec ringScale unit (rg 2 = the classic
// 8 yd warrior shout ring).
const RING_RADIUS_PER_SCALE = 4;

// Palette to school mapping for the pooled point-light flashes (the renderer's
// pulseAt is school-colored).
const SCHOOL_BY_PALETTE: Record<string, string> = {
  fire: 'fire',
  blood: 'fire',
  frost: 'frost',
  storm: 'frost',
  arcane: 'arcane',
  moon: 'arcane',
  shadow: 'shadow',
  venom: 'nature',
  nature: 'nature',
  gold: 'holy',
  holy: 'holy',
  physical: 'physical',
};

// The gallery rim rule: spec.rim outlines the body when authored, else the
// ability's main color carries the glow.
function rimColorOf(full: AbilityVfxFullSpec | undefined, spec: AbilityVfxSpec): number {
  if (full?.rim) return abilityHexColor(full.rim);
  return abilityVfxColor(spec);
}

// Maintenance passives are completely SILENT - no body glow, no orbit band,
// no ground aura. The tell is the sim ability def, not the vfx spec: the
// warrior stances (perpetually re-applied toggles, exclusiveGroup
// 'warrior_stance') and spellbook-only passive traits. A default level-1
// passive must not paint the character at all; the stance-swap cast ceremony
// still plays through the normal cast path.
function isPassiveAura(auraId: string): boolean {
  const def = ABILITIES[auraId];
  if (def === undefined) return false;
  return def.passive === true || def.exclusiveGroup?.endsWith('_stance') === true;
}

// Transformative buffs are the ONE exception that keeps a sustained body rim,
// restrained to a fraction of the old held-buff strength. Derived from spec
// DNA: shapeshift/aspect forms author buff style 'morph', and the
// ultimate-cooldown moments (Avatar, Metamorphosis, Bloodlust,
// Elemental Mastery...) are exactly the buff-archetype specs authored at
// power >= 1.1 - every default buff sits at 1.0 or below.
const TRANSFORMATIVE_BUFF_POWER = 1.1;
const TRANSFORMATIVE_RIM_SCALE = 0.25;
function isTransformativeBuff(full: AbilityVfxFullSpec): boolean {
  if (full.buff?.style === 'morph') return true;
  return full.archetype === 'buff' && (full.power ?? 1) >= TRANSFORMATIVE_BUFF_POWER;
}

// Effect-granted auras can suffix the authoring ability's id (the sim's
// aoeAlly buffs: rallying_cry_hp / rallying_cry_dr, `${abilityId}_ap`, and
// movement snares: `${abilityId}_slow`), which would miss the spec table and
// silently drop the ability's authored look. On a miss, retry with the known
// suffixes stripped. `_slow`/`_root` let a spec author a VICTIM-worn band
// (Hobbling Cut's dragging ankle speedlines, Crushing Charge's ground-grit
// shackle - each lives exactly as long as its aura).
// Memoized so the per-frame aura scan stays allocation-free in steady state;
// only ids that RESOLVE are re-keyed, so an unrelated ability that happens to
// end in a suffix is safe.
const AURA_ID_SUFFIXES = ['_hp', '_dr', '_ap', '_slow', '_root'];
// _slow/_root are the HOSTILE suffixes: the sim only ever applies them to a
// caster's victim, so resolving through one marks the aura victim-worn and
// routes it down the wornDebuff path in syncEntity (band only - never the
// ground disc, transformative rim, or gain swirl a buff block grants).
const HOSTILE_AURA_SUFFIXES = new Set(['_slow', '_root']);
const auraSpecIdMemo = new Map<string, string | null>();
const auraHostileWornMemo = new Set<string>();
function auraSpecId(auraId: string): string | null {
  if (abilityVfxSpec(auraId) !== undefined) return auraId;
  let base = auraSpecIdMemo.get(auraId);
  if (base === undefined) {
    base = null;
    let hostile = false;
    for (const s of AURA_ID_SUFFIXES) {
      if (auraId.endsWith(s)) {
        const stripped = auraId.slice(0, -s.length);
        if (abilityVfxSpec(stripped) !== undefined) {
          base = stripped;
          hostile = HOSTILE_AURA_SUFFIXES.has(s);
        }
        break;
      }
    }
    if (auraSpecIdMemo.size < 512) {
      auraSpecIdMemo.set(auraId, base);
      if (hostile) auraHostileWornMemo.add(auraId);
    }
  }
  return base;
}
// True when auraSpecId(auraId) resolved through a hostile suffix. The memo is
// warm for any id auraSpecId already resolved this frame (the scan always
// calls it first); exact-id matches never enter it, which is correct - an
// unsuffixed aura is the caster's own.
function auraIsHostileWorn(auraId: string): boolean {
  return auraHostileWornMemo.has(auraId);
}

// Lingering Dread: the shared fear aura keeps one fixed id (fear_incap - mob
// fears and player Fear reuse it), so it can never suffix-resolve. When the
// warrior talent armed it (breakThreshold present; the ONLY writer is
// intimidating_shout's aoeFear reading the fearBreakPct global), alias it to
// the shout's spec so its authored debuff block is worn - the lingering dread
// made visible for the fear's whole extended life. An untalented fear stays
// unresolved and wears nothing new.
const FEAR_BREAK_AURA_ID = 'fear_incap';
const FEAR_BREAK_SPEC_ID = 'intimidating_shout';

// Particle sprite family per burst kind, mapped onto Vfx.burst's school hint.
const BURST_SCHOOL_BY_KIND: Record<ParticleBurstKind, string> = {
  sparks: 'arcane',
  embers: 'fire',
  debris: 'physical',
  smoke: 'shadow',
  blood: 'physical',
};

// One FULL point-anchored sequence per (caster, ability) inside this window:
// recurring emits of the same aimed nova (Frozen Orb's flight pulses, a
// re-triggered trap) degrade to the cheap zone re-hit instead of replaying
// the whole release + impact anatomy every second.
const POINT_SEQ_REFRACTORY_SEC = 3;

// One cast-budget charge per (caster, ability) inside this window: a cast
// event plus its own point-anchored landing (or a strike's contact hit) are
// ONE cast to the spam guard, never two. Matches the budget's rolling second.
const CAST_CHARGE_WINDOW_SEC = 1;

// Zone-pulse debris family per spec palette (the per-pulse re-hit accent).
const PULSE_BURST_BY_PALETTE: Record<string, ParticleBurstKind> = {
  fire: 'embers',
  blood: 'blood',
  physical: 'debris',
  shadow: 'smoke',
  venom: 'smoke',
};

// The pet signature abilities whose creature rigs author an attackByAbility
// clip (manifest: mob_emberkin, mob_gloomshade). Only these carry the ability
// id through the mob throw fallback. Pinned against the sim pet roster and
// the manifest by tests/pet_signature_attack_ids.test.ts, so a new pet rig
// authoring a signature clip cannot silently miss this list.
export const PET_SIGNATURE_ATTACK_IDS = new Set(['emberkin_felbolt', 'gloomshade_abyssal_chain']);

export class AbilityVfx {
  private quality = 1;
  private budget = new AbilityVfxBudget();
  private now: () => number;
  private stats = new Map<string, AbilityVfxStat>();
  // last full point-sequence time per `${casterId}:${abilityId}` (see
  // POINT_SEQ_REFRACTORY_SEC); stale entries pruned in place once it grows
  private pointSeqAt = new Map<string, number>();
  // last cast-budget charge per `${casterId}:${abilityId}` (see
  // CAST_CHARGE_WINDOW_SEC); stale entries pruned in place once it grows
  private castChargeAt = new Map<string, number>();
  // live beam channels by caster id: every tick of a beam-archetype channel
  // (mind rays, drains) arrives as its own cast-fx event, so the tracker turns
  // the series into ONE cast - a crescendoing cord across the ticks and the
  // full impact stack once, on the last tick. Interrupted channels expire in
  // update() without an impact.
  private beamChannels = new Map<
    number,
    {
      abilityId: string;
      targetId: number;
      ticks: number;
      expected: number;
      every: number;
      lastAt: number;
      tier: 0 | 1 | 2;
      color: number;
    }
  >();
  private spawned = 0; // primitives spawned by the CURRENT event (probe counter)
  // player classes whose spirit models were already warmed (first sighting)
  private warmedSpiritClasses = new Set<string>();
  // Held casts and auras survive presentation culling independently of the
  // pooled render primitives. This prevents a persistent offscreen aura from
  // looking newly acquired when its actor re-enters the camera.
  private heldSemantic = new Map<number, AbilityVfxHeldSemanticState>();
  private semanticFrame = 0;

  constructor(
    private deps: AbilityVfxDeps,
    now?: () => number,
  ) {
    this.now = now ?? (() => performance.now() / 1000);
    // Particle bursts ride the pooled Vfx cloud; sequencer light pulses ride
    // the renderer's pooled point lights; sequencer spawns feed the probe stats.
    deps.fx.setDelegates(
      (x, y, z, colorHex, count, power, kind) =>
        deps.vfx.burst(
          { x, y, z },
          BURST_SCHOOL_BY_KIND[kind],
          count,
          power,
          kind === 'blood' ? 0xa01222 : colorHex,
        ),
      (entityId, palette, intensity, duration, range) =>
        deps.lightPulse?.(
          entityId,
          SCHOOL_BY_PALETTE[palette] ?? 'arcane',
          intensity,
          duration,
          range,
        ),
      (abilityId, n) => {
        this.spawned = n;
        this.recordStat(abilityId, false);
      },
      (entityId, colorHex, intensity) => deps.setAuraGlow?.(entityId, colorHex, intensity),
      deps.addShake ? (amount) => deps.addShake?.(amount) : undefined,
      deps.bodyLean ? (entityId, amount) => deps.bodyLean?.(entityId, amount) : undefined,
      deps.screenImpact ? (x, y, z, s) => deps.screenImpact?.(x, y, z, s) : undefined,
      deps.abilityAudio
        ? (kind, palette, power, x, y, z, opts) =>
            deps.abilityAudio?.(kind, palette, power, x, y, z, opts)
        : undefined,
    );
  }

  setQuality(q: number): void {
    this.quality = Math.min(1, Math.max(0, Number.isFinite(q) ? q : 1));
    this.deps.fx.setQuality(this.quality);
  }

  // Dev probe surface: per-ability claim/primitive counters (copied out).
  statsSnapshot(): Record<string, AbilityVfxStat> {
    const out: Record<string, AbilityVfxStat> = {};
    for (const [id, s] of this.stats) out[id] = { claimed: s.claimed, primitives: s.primitives };
    return out;
  }

  // Degrade tier for a cast-claiming event: charges the cast budget once per
  // (caster, ability) window - a cast plus its own follow-through (aimed
  // landing, a strike's contact hit) never double-charges - and biases the
  // local player one tier up (their own rotation degrades last).
  private castTier(casterId: number, abilityId: string): 0 | 1 | 2 {
    const nowSec = this.now();
    const key = `${casterId}:${abilityId}`;
    const last = this.castChargeAt.get(key);
    let tier: 0 | 1 | 2;
    if (last !== undefined && nowSec - last < CAST_CHARGE_WINDOW_SEC) {
      tier = this.budget.peek(casterId, nowSec);
    } else {
      if (this.castChargeAt.size > 64) {
        for (const [k, at] of this.castChargeAt) {
          if (nowSec - at >= CAST_CHARGE_WINDOW_SEC) this.castChargeAt.delete(k);
        }
      }
      this.castChargeAt.set(key, nowSec);
      tier = this.budget.admit(casterId, nowSec);
    }
    return this.biasFor(casterId, tier);
  }

  private biasFor(casterId: number, tier: 0 | 1 | 2): 0 | 1 | 2 {
    return this.deps.localPlayerId?.() === casterId ? localCasterTier(tier) : tier;
  }

  private recordStat(abilityId: string, claimed: boolean): void {
    let s = this.stats.get(abilityId);
    if (!s) {
      s = { claimed: 0, primitives: 0 };
      this.stats.set(abilityId, s);
    }
    if (claimed) s.claimed++;
    s.primitives += this.spawned;
    this.spawned = 0;
  }

  // Returns true when this painter fully handled the event (the renderer skips
  // its generic school-colored arm), false to fall through unchanged.
  handleSpellfx(ev: AbilityVfxSpellfxEvent): boolean {
    if (!ev.ability || !CAST_FX.has(ev.fx)) return false;
    const spec = abilityVfxSpec(ev.ability);
    if (!spec) return false;
    const full = abilityVfxFullSpec(ev.ability);
    // Beam-archetype channels (mind rays, drains) never fly a projectile:
    // every tick's cast-fx event feeds the channel tracker, which draws the
    // crescendoing cord and lands the full impact stack once, on the last tick.
    if (full?.archetype === 'beam' && ev.fx !== 'windup' && ev.fx !== 'shout')
      return this.beamChannelTick(ev, ev.ability, spec, full);
    // selfCast is the ONLY completion cue a cast with no castFx and no damage
    // emits. Untargeted/self ceremonies (forms, summon rites, aspects) are
    // claimed by ceremony archetypes; a cue carrying a VICTIM (sunder,
    // interrupts, taunts, stuns - the sim only emits it when the resolved
    // effects announce nothing themselves) is claimed by the contact and shout
    // archetypes and anchors the read at the target. Heal ceremonies are
    // claimed too: the heal2 events that follow only feed FCT numbers and the
    // tiny legacy glow (no spec-driven read arrives any other way), so this
    // cue IS the ceremony for self heals and ally-cast heals alike. Damaging
    // strikes still fall through unclaimed (their read arrives via the damage
    // claim) so nothing double-stages. Checked before castTier so an
    // unclaimed selfCast never charges the budget.
    if (ev.fx === 'selfCast') {
      const arch = full?.archetype ?? spec.a;
      const targeted = ev.targetId !== ev.sourceId;
      const ceremonial =
        arch === 'buff' || arch === 'summon' || arch === 'cc' || arch === 'heal' || !!full?.spirit;
      const utility =
        (targeted &&
          (arch === 'strike' || arch === 'cc' || arch === 'burst' || arch === 'shout')) ||
        // Untargeted shout/dash carry no victim to anchor a contact claim and
        // no castFx of their own (heroic_leap, piercing_howl): selfCast is
        // their only completion cue, same as the ceremonies above.
        (!targeted && (arch === 'shout' || arch === 'dash'));
      if (!full || !(utility || ceremonial)) return false;
    }
    const tier = this.castTier(ev.sourceId, ev.ability);
    const plan = planCast(spec, this.quality, tier);
    const fx = this.deps.fx;
    this.spawned = 0;
    // Spin specs whirl the rig (Bladestorm); the one-shot is cheap, so it
    // survives every degrade tier.
    if (plan.whirl) this.deps.triggerAttack(ev.sourceId, ev.ability);
    switch (ev.fx) {
      case 'projectile':
      case 'heavyBolt': {
        // A player ranged shot's draw animation rides the projectile launch
        // cue; keep it when this painter claims the event.
        if (ev.attackAnimation === 'ranged-shot' && !plan.whirl)
          this.deps.triggerAttack(ev.sourceId);
        const scale = ev.fx === 'heavyBolt' ? Math.max(plan.projScale, 2) : plan.projScale;
        if (tier < 2 && full?.bolt) {
          // The full spec's bolt DNA (style silhouette, authored speed, coils,
          // forks, tracer, leader, volley) drives the styled trail system,
          // whose head sprite IS the projectile - the generic Vfx comet would
          // shadow it at the wrong speed, so it stays off entirely.
          fx.sequenceBolt(
            ev.ability,
            full,
            ev.sourceId,
            ev.targetId,
            plan.color,
            0.16 * scale,
            tier,
            plan.volley,
            scale,
          );
          this.spawned += plan.volley;
        } else if (plan.jagged) {
          this.deps.vfx.lightningProjectile(ev.sourceId, ev.targetId, plan.color);
          this.spawned++;
          if (tier < 2) {
            fx.jaggedBolt(ev.sourceId, ev.targetId, plan.color);
            this.spawned++;
            // the crack lands instantly: run the archetype sequence compressed
            if (full)
              fx.sequenceInstant(ev.ability, full, ev.sourceId, ev.targetId, plan.color, tier);
          }
        } else {
          for (let i = 0; i < plan.volley; i++) {
            this.deps.vfx.projectile(ev.sourceId, ev.targetId, ev.school, scale, plan.color);
            this.spawned++;
          }
          // The gallery bolt read: release flash + a flowing comet trail
          // chasing the head, and the FULL impact stack where it arrives.
          if (tier < 2) {
            if (full) {
              fx.sequenceBolt(
                ev.ability,
                full,
                ev.sourceId,
                ev.targetId,
                plan.color,
                0.16 * scale,
                tier,
              );
            } else {
              fx.cometTrail(ev.sourceId, ev.targetId, plan.color, 0.16 * scale, tier === 0);
            }
            this.spawned++;
          }
        }
        if (!plan.whirl && ev.attackAnimation !== 'ranged-shot') {
          this.mobThrowFallback(ev.sourceId, ev.ability);
          this.playerGestureRelease(ev.sourceId, ev.ability);
        }
        break;
      }
      case 'lightning':
        this.deps.vfx.lightningProjectile(ev.sourceId, ev.targetId, plan.color);
        this.spawned++;
        if (tier < 2) {
          fx.jaggedBolt(ev.sourceId, ev.targetId, plan.color);
          this.spawned++;
          if (full)
            fx.sequenceInstant(ev.ability, full, ev.sourceId, ev.targetId, plan.color, tier);
        }
        if (!plan.whirl) {
          this.mobThrowFallback(ev.sourceId, ev.ability);
          this.playerGestureRelease(ev.sourceId, ev.ability);
        }
        break;
      case 'beam':
        // Channel rays (drains, mind flay): the school beam recolored plus a
        // wavering ribbon so the cord reads as flowing energy, not dots.
        this.deps.vfx.beam(ev.sourceId, ev.targetId, ev.school, plan.color);
        this.spawned++;
        if (tier < 2) {
          fx.beamRibbon(ev.sourceId, ev.targetId, plan.color);
          this.spawned++;
        }
        if (!plan.whirl) this.mobThrowFallback(ev.sourceId, ev.ability);
        break;
      case 'windup':
        // The generic windup arm's whole job is the throw animation: keep it.
        if (!plan.whirl) this.deps.triggerAttack(ev.sourceId, ev.ability);
        this.spawned++;
        break;
      case 'shout': {
        // The roar starts now even when the sequence stages a short windup:
        // the caster bellowing THROUGH the ceremony is the natural read.
        this.deps.vfx.shoutwave(ev.sourceId, plan.color);
        this.spawned++;
        this.spawnRing(ev.sourceId, plan, ev.school);
        this.deps.playShoutAnim?.(ev.sourceId);
        if (tier < 2 && full)
          fx.sequenceInstant(
            ev.ability,
            full,
            ev.sourceId,
            ev.targetId,
            plan.color,
            tier,
            this.windupDelayFor(ev.ability, full, ev.sourceId),
          );
        break;
      }
      case 'nova': {
        if (tier < 2 && full) {
          const delay = this.windupDelayFor(ev.ability, full, ev.sourceId);
          // a staged release carries the boom itself: firing the pooled nova
          // now would double the read half a windup early
          if (delay <= 0) {
            this.deps.vfx.nova(ev.targetId, ev.school, plan.color);
            this.spawned++;
          }
          fx.sequenceInstant(ev.ability, full, ev.sourceId, ev.targetId, plan.color, tier, delay);
        } else {
          this.deps.vfx.nova(ev.targetId, ev.school, plan.color);
          this.spawned++;
        }
        this.spawnRing(ev.targetId, plan, ev.school);
        if (!plan.whirl) this.playerGestureRelease(ev.sourceId, ev.ability);
        break;
      }
      case 'tick':
        // Instants run their FULL archetype sequence, compressed (0.15s
        // release to impact) after any authored windup phase, never just the
        // small tick accent.
        this.deps.vfx.tick(ev.targetId, ev.school, plan.color);
        this.spawned++;
        if (tier < 2 && full)
          fx.sequenceInstant(
            ev.ability,
            full,
            ev.sourceId,
            ev.targetId,
            plan.color,
            tier,
            this.windupDelayFor(ev.ability, full, ev.sourceId),
          );
        break;
      case 'selfCast': {
        // The pre-switch gate guarantees a full ceremonial or utility spec.
        // A self cue runs the ceremony on the caster (spirits, shells, orbits
        // ride the sequence). A cue carrying a victim runs the utility read
        // there instead: contact archetypes swing the caster's rig and land
        // the authored impact at the target; a shout-archetype taunt barks
        // from the caster with its wave while the sequence carries the victim
        // so motifAt 'target' snaps at the goaded enemy. A cue carrying an
        // ALLY (the sim's friendly-path completion: heals, blessings,
        // dispels) anchors the sequence landing on that ally instead - the
        // ability def is the signal, since only friendly/'any'-target defs
        // resolve through that path (a hostile 'any' cast flies a projectile
        // and never cues selfCast). The windup ceremony still draws on the
        // caster inside the sequencer, so Last Rite's light spirals off the
        // paladin before pouring into the target. No swing, no shoutwave.
        const arch = full?.archetype ?? spec.a;
        const targeted = ev.targetId !== ev.sourceId;
        const defTargetType = ABILITIES[ev.ability]?.targetType;
        const friendly = targeted && (defTargetType === 'friendly' || defTargetType === 'any');
        const contact = targeted && !friendly && (arch === 'strike' || arch === 'cc');
        // The physical hit reads on the body first: the caster visibly swings
        // (attackByAbility picks the authored clip - Jawcrack's bare-fist
        // punch), on every client that sees the cue. Burst zaps and shouts
        // carry no swing.
        if (contact && !plan.whirl) this.deps.triggerAttack(ev.sourceId, ev.ability);
        // Ceremonial cast gesture (Lingering Grace's one-hand blessing): a
        // non-contact cue whose rig authors a per-ability clip plays it on the
        // caster - on every client that sees the cue, so the gesture reads for
        // spectators too. The authored-clip gate keeps this data-driven and
        // means an un-authored ceremony changes nothing.
        if (!contact && !plan.whirl && this.deps.hasGestureClip?.(ev.sourceId, ev.ability)) {
          this.deps.triggerAttack(ev.sourceId, ev.ability);
        }
        // A shout barks from the caster whether it is a targeted taunt (Menace)
        // or a self-centered untargeted AoE roar (Craven Roar): the wave, ring
        // and roar animation always originate at the bellowing caster. Craven
        // Roar carries targetId===sourceId (requiresTarget:false), so gating the
        // roar behind `targeted` left it silent with no visual - mirror the
        // unconditional castFx 'shout' arm instead.
        if (!friendly && arch === 'shout') {
          this.deps.vfx.shoutwave(ev.sourceId, plan.color);
          this.spawned++;
          this.spawnRing(ev.sourceId, plan, ev.school);
          this.deps.playShoutAnim?.(ev.sourceId);
        }
        const seqTarget =
          targeted && (contact || friendly || arch === 'burst' || arch === 'shout')
            ? ev.targetId
            : ev.sourceId;
        if (tier < 2 && full) {
          fx.sequenceInstant(
            ev.ability,
            full,
            ev.sourceId,
            seqTarget,
            plan.color,
            tier,
            this.windupDelayFor(ev.ability, full, ev.sourceId),
          );
        } else {
          this.deps.vfx.tick(seqTarget, ev.school, plan.color);
          this.spawned++;
        }
        break;
      }
    }
    // Local-player cast acknowledgment: a claimed physical instant plays the
    // ability's one-shot so the button press reads on the rig (spell instants
    // get their read from the windup ceremony; no new clips are invented).
    // selfCast owns its swing in the case above (it fires for EVERY client,
    // not just the local caster), so it is excluded here.
    if (
      ev.fx !== 'windup' &&
      ev.fx !== 'selfCast' &&
      !plan.whirl &&
      ev.attackAnimation !== 'ranged-shot' &&
      this.deps.localPlayerId?.() === ev.sourceId
    ) {
      const arch = full?.archetype ?? spec.a;
      if (arch === 'strike' || arch === 'dash') this.deps.triggerAttack(ev.sourceId, ev.ability);
    }
    this.recordStat(ev.ability, true);
    return true;
  }

  // One tick of a beam-archetype channel. The whole channel is ONE cast to
  // the spam budget (charged on its first tick); across the ticks the cord
  // crescendos - the ribbon swells and outlives the tick gap so it reads
  // continuous, the receiving end accents harder each tick - and the LAST
  // tick lands the authored impact stack through the normal sequence
  // machinery. Drains reverse the ribbon's point order, which reverses its
  // flow: energy visibly runs target -> caster.
  private beamChannelTick(
    ev: AbilityVfxSpellfxEvent,
    abilityId: string,
    spec: AbilityVfxSpec,
    full: AbilityVfxFullSpec,
  ): boolean {
    const nowSec = this.now();
    const drain = full.beam?.drain === true;
    const expected = Math.max(1, full.beam?.ticks ?? 3);
    const every = Math.max(0.4, (full.beam?.dur ?? 3) / expected);
    let ch = this.beamChannels.get(ev.sourceId);
    if (!ch || ch.abilityId !== abilityId || nowSec - ch.lastAt > every * 1.9 + 0.25) {
      const tier = this.castTier(ev.sourceId, abilityId);
      ch = {
        abilityId,
        targetId: ev.targetId,
        ticks: 0,
        expected,
        every,
        lastAt: nowSec,
        tier,
        color: planCast(spec, this.quality, tier).color,
      };
      this.beamChannels.set(ev.sourceId, ch);
      this.mobThrowFallback(ev.sourceId, ev.ability);
    }
    ch.lastAt = nowSec;
    ch.targetId = ev.targetId;
    ch.ticks++;
    const tier = ch.tier;
    const color = ch.color;
    const fx = this.deps.fx;
    this.spawned = 0;
    // the cord: the recolored school beam under the flowing ribbon
    this.deps.vfx.beam(ev.sourceId, ev.targetId, ev.school, color);
    this.spawned++;
    if (tier < 2) {
      const grow = ch.expected > 1 ? Math.min(1, (ch.ticks - 1) / (ch.expected - 1)) : 1;
      const src = drain ? ev.targetId : ev.sourceId;
      const dst = drain ? ev.sourceId : ev.targetId;
      fx.beamRibbon(src, dst, color, 0.1 * (1 + 0.8 * grow), every + 0.2);
      this.spawned++;
      // per-tick mini-accents, louder each tick: the receiving end sparks (a
      // drain's caster drinks embers) and the drained victim sheds flecks
      if (tier === 0) {
        const recv = this.deps.anchor(drain ? ev.sourceId : ev.targetId, 0.55);
        if (recv) {
          fx.burstAt(
            recv.x,
            recv.y,
            recv.z,
            color,
            4 + 2 * ch.ticks,
            0.6 + 0.15 * ch.ticks,
            drain ? 'embers' : 'sparks',
          );
          this.spawned++;
        }
        if (drain) {
          const victim = this.deps.anchor(ev.targetId, 0.5);
          if (victim) {
            fx.burstAt(victim.x, victim.y, victim.z, 0xa01222, 4, 0.5, 'blood');
            this.spawned++;
          }
        }
      }
      this.deps.lightPulse?.(
        drain ? ev.sourceId : ev.targetId,
        ev.school,
        1.5 + 0.5 * ch.ticks,
        0.25,
      );
    }
    // channel end: the last tick IS the payoff - the full authored impact
    // stack (already budget-charged at channel start, so no second charge)
    if (ch.ticks >= ch.expected) {
      this.beamChannels.delete(ev.sourceId);
      if (tier < 2) fx.sequenceInstant(abilityId, full, ev.sourceId, ev.targetId, color, tier);
    }
    this.recordStat(abilityId, true);
    return true;
  }

  // Point-anchored claims: an aimed ground cast's landing ('nova'/'burst' at
  // the aim point) runs the full archetype sequence anchored at the WORLD
  // POINT - windup ceremony and release flash on the caster, motifs, decal,
  // and linger at the point - and a zone pulse ('tick') draws a cheap
  // per-pulse re-hit, never a full sequence. The four bespoke lifetime kinds
  // (meteorFall/snowZone/runeCircle/orb) are deliberately never claimed:
  // their legacy visuals animate duration-long state (a ball timed to its
  // landing, snowfall over the zone's whole life, a persistent inscription,
  // the roaming orb) that a one-shot sequence would read worse than.
  handleSpellfxAt(ev: AbilityVfxSpellfxAtEvent): boolean {
    if (!ev.ability) return false;
    if (ev.fx !== 'nova' && ev.fx !== 'burst' && ev.fx !== 'tick') return false;
    const spec = abilityVfxSpec(ev.ability);
    if (!spec) return false;
    const casterId = ev.sourceId ?? -1;
    const fx = this.deps.fx;
    const gy = fx.groundYAt(ev.x, ev.z);
    const nowSec = this.now();
    this.spawned = 0;
    if (ev.fx === 'tick') {
      // Zone-pulse re-hits ride the accent window, never the cast budget: a
      // 6s earthquake must not starve its caster's next cast.
      if (this.budget.admitAccent(nowSec)) {
        const tier = this.biasFor(casterId, this.budget.peek(casterId, nowSec));
        this.zoneRehit(
          ev.x,
          gy,
          ev.z,
          ev.radius,
          spec,
          planCast(spec, this.quality, tier),
          tier,
          ev.ability,
        );
      }
      this.recordStat(ev.ability, true);
      return true;
    }
    const full = abilityVfxFullSpec(ev.ability);
    // recurring emits of the same aimed nova replay only the cheap re-hit
    const seqKey = `${casterId}:${ev.ability}`;
    const lastSeq = this.pointSeqAt.get(seqKey);
    const repeat = lastSeq !== undefined && nowSec - lastSeq < POINT_SEQ_REFRACTORY_SEC;
    if (this.pointSeqAt.size > 64) {
      for (const [key, at] of this.pointSeqAt) {
        if (nowSec - at >= POINT_SEQ_REFRACTORY_SEC) this.pointSeqAt.delete(key);
      }
    }
    this.pointSeqAt.set(seqKey, nowSec);
    // a fresh landing is the cast (charged once, deduped against its own cast
    // event); repeats are follow-through on the accent window
    const tier = repeat
      ? this.biasFor(casterId, this.budget.peek(casterId, nowSec))
      : this.castTier(casterId, ev.ability);
    const plan = planCast(spec, this.quality, tier);
    // the terrain-draped area ring is an actionable telegraph: always instant
    if (ev.radius) {
      this.deps.spawnAoeRing(ev.x, ev.z, ev.radius, ev.school, plan.color);
      this.spawned++;
    }
    if (repeat) {
      if (this.budget.admitAccent(nowSec)) {
        this.zoneRehit(ev.x, gy, ev.z, ev.radius, spec, plan, tier, ev.ability);
      }
    } else if (tier < 2 && full) {
      // A bolt-archetype aimed cast FLIES its authored volley: Splitshot's fan
      // of arrows visibly crosses the air from the caster to the aimed point,
      // and the point-anchored impact stack lands when the lead arrow arrives.
      // Needs a live caster anchor (the event's sourceId, in interest range);
      // without one the instant point sequence below stays the read.
      if (full.bolt && casterId >= 0 && this.deps.anchor(casterId, 0.62)) {
        fx.sequenceBoltAt(
          ev.ability,
          full,
          casterId,
          ev.x,
          ev.z,
          plan.color,
          0.16 * plan.projScale,
          tier,
          plan.volley,
          plan.projScale,
        );
        this.spawned += plan.volley;
        // the shot reads on the rig for every client that sees the cue: the
        // caster draws and looses toward the point (the hunter's ranged clip)
        this.deps.triggerAttack(casterId, ev.ability);
      } else {
        fx.sequenceInstantAt(
          ev.ability,
          full,
          casterId,
          ev.x,
          ev.z,
          plan.color,
          tier,
          this.windupDelayFor(ev.ability, full, casterId),
        );
        // An authored ground-nova/AoE clip (Earthquake's Cast_Quake) reads on
        // every client that sees the cue, same gate as selfCast's ceremony
        // arm. Without one, a strike/dash-archetype slam still echoes on the
        // local player only (the pre-existing minimal read).
        if (this.deps.hasGestureClip?.(casterId, ev.ability)) {
          this.playerGestureRelease(casterId, ev.ability);
        } else if (this.deps.localPlayerId?.() === casterId) {
          const arch = full.archetype;
          if (arch === 'strike' || arch === 'dash') this.deps.triggerAttack(casterId, ev.ability);
        }
      }
    } else {
      // minimal fallback read: the spec-colored burst at the landing point
      this.deps.vfx.burst(
        { x: ev.x, y: gy + 0.4, z: ev.z },
        ev.school,
        plan.burstCount,
        plan.burstPower,
        plan.color,
      );
      this.spawned++;
    }
    this.recordStat(ev.ability, true);
    return true;
  }

  // The cheap per-pulse zone re-hit (ground-zone ticks, repeated aimed novas):
  // a small expanding ring, a pinch of palette debris, and at full tier a
  // vertical accent halo - never a full sequence. Tier 2 draws nothing.
  private zoneRehit(
    x: number,
    gy: number,
    z: number,
    radius: number | undefined,
    spec: AbilityVfxSpec,
    plan: AbilityVfxPlan,
    tier: number,
    abilityId: string,
  ): void {
    if (tier >= 2) return;
    const fx = this.deps.fx;
    const r = Math.min(6, Math.max(1.6, (radius ?? 4) * 0.85));
    // soft per-pulse thud AT the zone (never the full impact identity); the
    // abilityId lets isAbilityMomentRecorded silence this for Meteor, whose
    // one delayed hit now has a dedicated recording (combat_sfx.ts's
    // GROUND_TICK_ABILITY_CUES).
    this.deps.abilityAudio?.('pulse', spec.p ?? 'arcane', spec.pw ?? 1, x, gy, z, { abilityId });
    fx.ringAt(x, gy + 0.15, z, r, 0.5, plan.color, 1.1, false);
    fx.burstAt(
      x,
      gy + 0.3,
      z,
      plan.swirlColor,
      tier === 0 ? 8 : 5,
      0.8,
      PULSE_BURST_BY_PALETTE[spec.p ?? ''] ?? 'sparks',
    );
    this.spawned += 2;
    if (tier === 0) {
      fx.ringAt(x, gy + 0.9, z, Math.min(2.4, r * 0.5), 0.4, plan.swirlColor, 1.2, true);
      this.spawned++;
    }
  }

  // A landed ability hit gets one reduced-count accent burst in the spec color
  // plus its archetype read: strikes slash a ribbon arc across the victim and
  // crits pop a vertical halo. Damage events carry player-facing ability
  // NAMES; normalize back to the stable id first. Accents ride the flat accent
  // window and only peek the cast tier - a rotation's own landed hits (and
  // plain autos) never consume its cast slots. The one exception: a physical
  // special whose ONLY event is its hit - that contact IS its cast, so it
  // charges the cast budget (deduped) and runs the full sequence.
  onDamage(ev: AbilityVfxDamageEvent): void {
    if (ev.kind !== 'hit' || ev.amount <= 0) return;
    const nowSec = this.now();
    const local = this.deps.localPlayerId?.() === ev.sourceId;
    if (!ev.ability) {
      // Plain melee crit from the local player: the tiny contact bite on both
      // bodies, no screen flash (autos land too often to strobe the screen).
      if (local && ev.crit && ev.school === 'physical') {
        this.deps.animHold?.(ev.sourceId, 0.1, 0.12);
        this.deps.animHold?.(ev.targetId, 0.1, 0.12);
      }
      // Auto-attack polish: a subtle steel slash ribbon on plain melee swings
      // (the meleeSpark already popped). Accent-gated so crowds stay calm.
      if (
        ev.school === 'physical' &&
        this.biasFor(ev.sourceId, this.budget.peek(ev.sourceId, nowSec)) === 0 &&
        this.budget.admitAccent(nowSec)
      ) {
        this.deps.fx.slashArc(ev.targetId, 0xffd9a8, 0.85, 0.16);
      }
      return;
    }
    const abilityId = attackAbilityId(ev.ability);
    const spec = abilityId ? abilityVfxSpec(abilityId) : undefined;
    if (!spec || !abilityId) return;
    const full = abilityVfxFullSpec(abilityId);
    const arch = full?.archetype ?? spec.a ?? 'strike';
    const isCastMoment = !!full && (arch === 'strike' || arch === 'dash' || arch === 'buff');
    // Local-player crit hitstop + screen pop (gallery critHit feel): body and
    // screen feedback, not a particle spawn, so it rides OUTSIDE the accent
    // window - your own crit reads even in a saturated fight. The visual's
    // refractory, the flash clamp, and the shake budget keep chains calm.
    if (local && ev.crit) {
      this.deps.animHold?.(ev.targetId, 0.1, 0.14);
      this.deps.screenFlash?.(0.25);
      const kickAt = this.deps.anchor(ev.targetId, 0.55);
      if (kickAt) this.deps.fx.shakeAt(kickAt.x, kickAt.y, kickAt.z, 0.12);
    }
    // The melee contact frame bites (gallery hold: timeScale ~0.07 for
    // ~0.11s): the local player's strike/dash contact briefly holds both rigs.
    if (local && isCastMoment && (arch === 'strike' || arch === 'dash')) {
      const dur = ev.crit ? 0.16 : 0.1;
      this.deps.animHold?.(ev.sourceId, 0.1, dur);
      this.deps.animHold?.(ev.targetId, 0.1, dur);
    }
    let tier: 0 | 1 | 2;
    if (isCastMoment) {
      tier = this.castTier(ev.sourceId, abilityId);
    } else {
      tier = this.biasFor(ev.sourceId, this.budget.peek(ev.sourceId, nowSec));
      if (tier >= 1) return; // degraded accents vanish first; casts keep priority
      if (!this.budget.admitAccent(nowSec)) return;
    }
    const plan = planImpact(spec, ev.crit, this.quality, tier);
    const at = this.deps.anchor(ev.targetId, 0.55);
    if (!at) return;
    // crit sting layered over the impact: the sequencer's impact recipe plays
    // the palette identity; the sting is the crit's own extra layer (the
    // damage event is the only place crit is known)
    if (ev.crit) {
      this.deps.abilityAudio?.(
        'crit',
        full?.palette ?? spec.p ?? 'physical',
        full?.power ?? spec.pw ?? 1,
        at.x,
        at.y,
        at.z,
        { lite: full?.impact?.liteAudio === true || tier >= 1 },
      );
    }
    this.spawned = 0;
    this.deps.vfx.burst(at, ev.school, plan.burstCount, plan.burstPower, plan.color);
    this.spawned++;
    if (isCastMoment && full && tier < 2) {
      // The contact moment runs the full archetype sequence (authored slash
      // arc, impact stack, motifs). Buff-archetype self-hits (Blood Toll's
      // health price) run the buff sequence too: shell pop plus the red
      // body-glow pulse.
      this.deps.fx.sequenceInstant(abilityId, full, ev.sourceId, ev.targetId, plan.color, tier);
    } else if (!isCastMoment && (ev.crit || spec.fin === 1)) {
      this.deps.fx.impactRing(ev.targetId, plan.color, ev.crit);
      this.spawned++;
    }
    this.recordStat(abilityId, false);
  }

  // Spec-colored buff swirl for an aura gain. Only an exact ability id (from
  // the event when it carries one, else the caller's guess) is trusted; aura
  // display names are never fuzzy-matched. The persistent orbit band comes
  // from syncEntity's aura scan, not from this one-shot.
  onAuraGained(ev: AbilityVfxAuraEvent, abilityIdGuess?: string): void {
    if (!ev.gained) return;
    const abilityId = ev.ability ?? abilityIdGuess;
    if (!abilityId) return;
    const spec = abilityVfxSpec(abilityId);
    if (!spec) return;
    this.deps.vfx.buffSwirl(ev.targetId, planCast(spec, this.quality, 0).swirlColor);
  }

  // Spec color for the per-frame cast sparkle of a casting ability, or
  // undefined to keep the generic school color. Cached parse, zero allocation:
  // safe to call every frame from the renderer's entity sync.
  sparkleColorFor(abilityId: string | null | undefined): number | undefined {
    const spec = abilityId ? abilityVfxSpec(abilityId) : undefined;
    return spec ? abilityVfxColor(spec) : undefined;
  }

  // Per-frame entity feed from the renderer's view sync: keeps the windup orb
  // alive while a spec'd ability is casting (scaled by cast progress) and the
  // buff-orbit bands alive while their aura ids persist. The fx engine sweeps
  // anything not refreshed this frame, so there is no teardown bookkeeping.
  // Allocation-free per call.
  syncEntity(e: AbilityVfxEntityState, renderEffects = true): void {
    const fx = this.deps.fx;
    let held = this.heldSemantic.get(e.id);
    if (!held) {
      held = {
        castingAbility: null,
        queuedOnSwing: null,
        auraStamps: new Map(),
        serial: 0,
        frameSeen: this.semanticFrame,
      };
      this.heldSemantic.set(e.id, held);
    }
    const castingWasHeld = e.castingAbility !== null && held.castingAbility === e.castingAbility;
    const queuedWasHeld = e.queuedOnSwing != null && held.queuedOnSwing === e.queuedOnSwing;
    if (!renderEffects) {
      fx.sleepEntity(e.id);
      this.latchHeldState(held, e);
      return;
    }
    // First sighting of a player of a class kicks the async loads for that
    // class's spirit-apparition GLBs, so the models are warm before a cast
    // needs them (a still-loading model's cast skips its spirit silently).
    if (e.kind === 'player' && e.templateId && !this.warmedSpiritClasses.has(e.templateId)) {
      this.warmedSpiritClasses.add(e.templateId);
      fx.warmSpiritsForClass(e.templateId);
    }
    // Body glow (the gallery rim read) is RESERVED: an in-flight cast windup,
    // or a held transformative buff's restrained rim (see the aura loop)  -
    // strongest live source wins. Default buffs never tint the rig.
    let glowColor = 0;
    let glowStrength = 0;
    let glowSlow = false;
    if (e.castingAbility) {
      const spec = abilityVfxSpec(e.castingAbility);
      if (spec) {
        const progress =
          e.castTotal > 0 ? Math.min(1, Math.max(0, 1 - e.castRemaining / e.castTotal)) : 0;
        const full = abilityVfxFullSpec(e.castingAbility);
        const style = full?.windupStyle ?? 'orb';
        glowColor = rimColorOf(full, spec);
        glowStrength = 1.2 * (full?.power ?? 1);
        // the local player is priority: guaranteed a windup slot even when
        // a crowded hub saturates the pool
        const windupStarted = fx.windup(
          e.id,
          abilityVfxColor(spec),
          progress,
          style,
          this.deps.localPlayerId?.() === e.id,
          abilityVfxChargeStreams(full),
          rimColorOf(full, spec),
        );
        if (windupStarted && !castingWasHeld) {
          this.spawned = 1;
          this.recordStat(e.castingAbility, false);
          // Charge bed on the FIRST frame of the cast: a nature/moon cast
          // leads with its own rising tell instead of leaving the ear's first
          // catch to be the palette impact (which read as a fire charge). Only
          // these two palettes synthesize a windup bed; every other class's
          // cast is left exactly as reviewed. Audio-only - the visual windup
          // ceremony above is untouched.
          const pal = full?.palette;
          if ((pal === 'nature' || pal === 'moon') && this.deps.abilityAudio) {
            const at = this.deps.anchor(e.id, 0.9);
            if (at) {
              this.deps.abilityAudio('windup', pal, full?.power ?? 1, at.x, at.y, at.z, {
                archetype: full?.archetype,
              });
            }
          }
        }
      }
    }
    let bands = 0;
    let discs = 0;
    // Peeked (never charged) degrade tier for this entity's orbit bands,
    // computed lazily on the first orbit-carrying aura: tier >= 1 halves each
    // band's sprite count in the fx engine while the read survives.
    let orbitTier = -1;
    for (let i = 0; i < e.auras.length; i++) {
      const aura = e.auras[i];
      const auraWasHeld = held.auraStamps.has(aura.id);
      let auraId = auraSpecId(aura.id);
      // Victim-worn resolution: a hostile suffix (_slow/_root), or the fixed
      // fear id armed by Lingering Dread. A wornDebuff aura reads ONLY through
      // the spec's authored debuff block - never the ground disc,
      // transformative rim, shell, or gain swirl its buff block grants the
      // caster's own aura (Onrush authors both: the caster's dash speedlines
      // AND Crushing Charge's victim shackle).
      let hostileWorn = auraId !== null && auraIsHostileWorn(aura.id);
      if (auraId === null) {
        if (aura.id !== FEAR_BREAK_AURA_ID || aura.breakThreshold === undefined) continue;
        auraId = FEAR_BREAK_SPEC_ID;
        hostileWorn = true;
      }
      const spec = abilityVfxSpec(auraId);
      if (spec === undefined) continue;
      // maintenance passives (stances, spellbook traits): no read at all
      if (isPassiveAura(auraId)) continue;
      const full = abilityVfxFullSpec(auraId);
      const wornDebuff = hostileWorn && full?.debuff !== undefined;
      // Long-worn buffs are SILENT while held (the long-buff policy,
      // ability_vfx_longbuff_core.ts): no orbit band, ground disc, shell, or
      // sustained transformative rim (Wildfang Rally, the one power >= 1.1
      // buff past the threshold, goes silent too; morph forms are exempt in
      // the policy itself). Only the gain moment survives, as a one-shot
      // swirl on the aura's first held sighting (the same held-semantic
      // stamps the band swirl below rides, so it reads online, replays after
      // a drop, and never replays on camera re-entry), and the aura stops
      // consuming band and disc slots.
      if (!wornDebuff && !holdsBuffVfxWhileWorn(auraId, full)) {
        const buffish = full?.buff !== undefined || (full?.archetype ?? spec.a) === 'buff';
        if (buffish && !auraWasHeld) {
          this.deps.vfx.buffSwirl(e.id, planCast(spec, this.quality, 0).swirlColor);
          this.spawned = 1;
          this.recordStat(auraId, false);
        }
        continue;
      }
      // barrier specs wear the translucent fresnel shell while the aura lives
      if (full?.barrier && !wornDebuff) fx.holdShell(e.id, abilityVfxColor(spec));
      // Held buffs: the sustained whole-rig tint is RESERVED. Morph forms and
      // ultimate cooldowns keep a restrained rim; every other buff wears the
      // subtle under-character ground aura instead (band 0 the soft disc,
      // further concurrent buffs thin concentric rings, a 4th+ blends its hue
      // into the outermost). Veil styles (stealth, vanish) opt out - a
      // disappearing act must not glow the ground it stands on.
      let discStarted = false;
      if (
        !wornDebuff &&
        full !== undefined &&
        (full.buff !== undefined || full.archetype === 'buff' || full.barrier === true)
      ) {
        if (isTransformativeBuff(full)) {
          const strength =
            TRANSFORMATIVE_RIM_SCALE * (full.buff?.shellDur ? 2 : 1.3) * (full.power ?? 1);
          if (strength > glowStrength) {
            glowStrength = strength;
            glowColor = rimColorOf(full, spec);
            glowSlow = false;
          }
        } else if (full.buff?.style !== 'veil') {
          const spin = full.palette !== 'physical' && full.palette !== 'blood';
          discStarted = fx.holdGroundAura(e.id, discs, rimColorOf(full, spec), spin);
          discs++;
          if (discStarted && !auraWasHeld) {
            this.spawned = 1;
            this.recordStat(auraId, false);
          }
        }
      }
      // The full spec's authored orbit wins (its 'none' suppresses too);
      // compact-spec bo carries the same nine style names as fallback. A
      // victim-worn aura reads its debuff DNA exclusively (Hobbling Cut's
      // dragging ankle speedlines, Crushing Charge's shackle grit); a spec
      // with a debuff block but no buff block keeps the old debuff-first
      // fallback for its unsuffixed auras, which do not exist today.
      const style = asOrbitStyle(
        wornDebuff ? full?.debuff?.orbit : (full?.debuff?.orbit ?? full?.buff?.orbit ?? spec.bo),
      );
      if (style === null) {
        // orbit-less buffs still get their gain moment off the disc's first frame
        if (discStarted && !auraWasHeld) {
          this.deps.vfx.buffSwirl(e.id, planCast(spec, this.quality, 0).swirlColor);
        }
        continue;
      }
      if (bands >= 3) continue;
      if (orbitTier < 0) orbitTier = this.biasFor(e.id, this.budget.peek(e.id, this.now()));
      const bandO = wornDebuff ? full?.debuff?.o : (full?.debuff?.o ?? full?.buff?.o);
      if (fx.orbit(e.id, style, abilityVfxColor(spec), bandO, orbitTier)) {
        if (auraWasHeld) {
          bands++;
          continue;
        }
        // The band just appeared (aura gained): pop the swirl here instead of
        // the aura event, which carries no ability id. Works online too, since
        // this reads the mirrored entity's auras, not sim events. Only for
        // buff-block specs: a hostile-worn band (a debuff resolved via the
        // aura suffix map, e.g. hamstring_slow's ankle speedlines) must not
        // bless its victim with rising buff sparkles.
        const buffish =
          !wornDebuff && (full?.buff !== undefined || (full?.archetype ?? spec.a) === 'buff');
        if (buffish) this.deps.vfx.buffSwirl(e.id, planCast(spec, this.quality, 0).swirlColor);
        this.spawned = buffish ? 2 : 1;
        this.recordStat(auraId, false);
        // A debuff band that starts while its ability's _root aura is ON the
        // wearer marks the moment the ground seized them (Crushing Charge's
        // upgraded arrival - base Onrush applies no root): crash it once with
        // a heavy ground ring, kicked debris, dust, a cracked-earth scuff and
        // a light pop. Aura-driven exactly like the band, so it reads online
        // for any victim in interest range and stays honest for spectators.
        if (wornDebuff && orbitTier === 0) {
          let rooted = false;
          for (let j = 0; j < e.auras.length; j++) {
            if (e.auras[j].id === `${auraId}_root`) {
              rooted = true;
              break;
            }
          }
          const at = rooted ? this.deps.anchor(e.id, 0.12) : null;
          if (at) {
            const gy = fx.groundYAt(at.x, at.z);
            const c = abilityVfxColor(spec);
            fx.ringAt(at.x, gy, at.z, 3.6, 0.6, c, 1.6, false);
            fx.burstAt(at.x, gy + 0.2, at.z, c, 14, 1.1, 'debris');
            fx.burstAt(at.x, gy + 0.25, at.z, c, 8, 0.9, 'smoke');
            fx.decalXZ(at.x, at.z, 2.2, c, 'crack', 4);
            fx.pulseLight(e.id, full?.palette ?? 'physical', 3.5, 0.3);
            fx.shakeAt(at.x, gy, at.z, 0.18);
            this.spawned += 5;
          }
        }
      }
      bands++;
    }
    // The hard-CC tell: a worn stun, fear, or root aura wears its band for the
    // aura's whole life. Matched by what the SIM says the victim is suffering
    // (aura kind, plus the sim's own fear rule for the fear family), never the
    // spec table, so every source reads (mob stomps, ensnare affixes and traps
    // included) and it works online for any victim in interest range, exactly
    // like the bands above. Actionable information: it rides outside the cast
    // budget, every quality tier keeps it, and the fx engine sweeps it the
    // frame the aura fades. One band per victim, the most severe the victim
    // wears, which is also what keeps a stunned target (always isRooted() in
    // the sim) from wearing two. A dead body sheds it (an unbreakable stun can
    // survive death by design, e.g. the Nythraxis transition ghosts; a corpse
    // must not wear a frozen band). Deadness is the renderer's own
    // isVisuallyDead rule, not a bare `dead` flag: a mob at 0 hp whose flag
    // has not landed yet would otherwise keep the band for that window.
    // CC_BAND_SPECS in the core owns each band's look and why.
    if (!isVisuallyDead({ dead: e.dead === true, hp: e.hp ?? 1 })) {
      const band = wornCcBand(e.auras);
      if (band) fx.holdCcBand(e.id, band.type, band.remaining);
    }
    // On-next-swing queue (heroic-strike style): while the sim's queuedOnSwing
    // flag is armed, the queued ability's authored orbit rides the caster as
    // the empowerment tell - Reaver Strike's hot amber weaponGlow ember that
    // releases with the swing. Same pooled band system as the aura loop (the
    // fx engine sweeps it the frame the sim clears the flag on swing/untoggle,
    // so there is no teardown bookkeeping), tier-gated the same way, and fed
    // AFTER the aura loop so a style collision (Iron Bellow's red weaponGlow)
    // shows the armed strike's color while queued and reverts on release. No
    // gain swirl: arming a level-1 filler is a tell, not a ceremony.
    if (e.queuedOnSwing && bands < 3) {
      const qspec = abilityVfxSpec(e.queuedOnSwing);
      const qfull = abilityVfxFullSpec(e.queuedOnSwing);
      const qstyle = qspec ? asOrbitStyle(qfull?.buff?.orbit ?? qspec.bo) : null;
      if (qspec !== undefined && qstyle !== null) {
        if (orbitTier < 0) orbitTier = this.biasFor(e.id, this.budget.peek(e.id, this.now()));
        if (
          fx.orbit(e.id, qstyle, abilityVfxColor(qspec), qfull?.buff?.o, orbitTier) &&
          !queuedWasHeld
        ) {
          this.spawned = 1;
          this.recordStat(e.queuedOnSwing, false);
        }
      }
    }
    if (glowStrength > 0) fx.bodyGlow(e.id, glowColor, glowStrength, glowSlow);
    this.latchHeldState(held, e);
  }

  // Dev probe surface: the entity's current body-glow intensity.
  glowIntensityOf(entityId: number): number {
    return this.deps.fx.glowIntensityOf(entityId);
  }

  // Dev probe surface: the entity's held ground-aura band count.
  groundAuraCountOf(entityId: number): number {
    return this.deps.fx.groundAuraCountOf(entityId);
  }

  // Advances the primitive engine (ribbons, rings, decals, orbit/windup draw).
  update(dt: number, reducedMotion = false): void {
    this.deps.fx.update(dt, reducedMotion);
    for (const [entityId, held] of this.heldSemantic) {
      if (held.frameSeen !== this.semanticFrame) this.heldSemantic.delete(entityId);
    }
    this.semanticFrame++;
    // a broken beam channel (interrupt, death, retarget mid-cord) simply
    // expires: the cord stops being fed and no final impact ever lands
    if (this.beamChannels.size > 0) {
      const nowSec = this.now();
      for (const [id, ch] of this.beamChannels) {
        if (nowSec - ch.lastAt > ch.every * 1.9 + 0.25) this.beamChannels.delete(id);
      }
    }
  }

  private latchHeldState(held: AbilityVfxHeldSemanticState, e: AbilityVfxEntityState): void {
    held.castingAbility = e.castingAbility;
    held.queuedOnSwing = e.queuedOnSwing ?? null;
    held.frameSeen = this.semanticFrame;
    held.serial++;
    for (let i = 0; i < e.auras.length; i++) held.auraStamps.set(e.auras[i].id, held.serial);
    for (const [auraId, stamp] of held.auraStamps) {
      if (stamp !== held.serial) held.auraStamps.delete(auraId);
    }
  }

  // The synthetic pre-release windup for an INSTANT cast (part of the gallery
  // anatomy the 0.15s compression dropped): min(authored windup, 0.5s), with
  // gentler caps so nothing reads sluggish. Zero for real casts (their
  // ceremony already ran via the live castingAbility path), finisher-flagged
  // reactions, and unstyled windups. The visual release is what shifts late;
  // the sim's damage timing is untouched.
  private windupDelayFor(
    abilityId: string,
    full: AbilityVfxFullSpec | undefined,
    sourceId: number,
  ): number {
    if (!full?.windup || full.windup <= 0) return 0;
    if ((full.windupStyle ?? 'orb') === 'none') return 0;
    if (full.finisher) return 0;
    // dashes: the movement itself is the windup, and a leap's landing crater
    // must never arrive late
    if (full.archetype === 'dash') return 0;
    const d = this.deps;
    if (d.isInstantAbility && !d.isInstantAbility(abilityId)) return 0;
    if (d.castingAbilityOf?.(sourceId)) return 0;
    const arch = full.archetype;
    const cap = arch === 'heal' || arch === 'buff' || arch === 'shout' ? 0.25 : 0.5;
    return Math.min(full.windup, cap);
  }

  // Mirror of the renderer's generic-arm mob rule (its spellfx tail): a mob
  // hurling an instant bolt/ray with NO cast state has nothing else animating
  // the throw, so play its attack one-shot at launch. Claiming an event must
  // not lose that read.
  // In THIS fallback a plain mob's throw stays ID-LESS: the base #2961
  // invariant pins that the ability-carrying triggerAttack read on the throw
  // paths is the player gesture tell. The ONE exception here is the pet
  // signature set above, whose creature rigs author an attackByAbility clip
  // the id routes to. (The 'windup' arm is a different, deliberate channel:
  // it forwards the id for every caster because boss mechanic clips ride
  // attackByAbility off windup cues, e.g. the broodlord's Cleave/Stun.)
  private mobThrowFallback(sourceId: number, abilityId?: string): void {
    const d = this.deps;
    if (!d.isMob?.(sourceId)) return;
    if (d.castingAbilityOf?.(sourceId)) return;
    if (d.isMidOneShot?.(sourceId)) return;
    d.triggerAttack(
      sourceId,
      abilityId !== undefined && PET_SIGNATURE_ATTACK_IDS.has(abilityId) ? abilityId : undefined,
    );
  }

  // Player projectile/lightning/nova release had no rig read at all: only
  // mobs got mobThrowFallback's generic swing, and selfCast was the only cue
  // that consulted hasGestureClip for its ceremony gesture (review #2961). A
  // player caster whose ability authors a bespoke clip (Cast_Bolt, Cast_Shock,
  // Cast_Quake, ...) now plays it here too, on every client that sees the
  // cue, the same authored-clip gate selfCast already uses.
  private playerGestureRelease(sourceId: number, abilityId: string): void {
    const d = this.deps;
    if (d.isMob?.(sourceId)) return;
    if (!d.hasGestureClip?.(sourceId, abilityId)) return;
    d.triggerAttack(sourceId, abilityId);
  }

  private spawnRing(entityId: number, plan: AbilityVfxPlan, school: string): void {
    if (plan.ringScale <= 0) return;
    const at = this.deps.anchor(entityId, 0);
    if (!at) return;
    this.deps.spawnAoeRing(at.x, at.z, RING_RADIUS_PER_SCALE * plan.ringScale, school, plan.color);
  }
}
