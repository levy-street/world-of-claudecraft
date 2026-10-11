// Nature's Boon, the Wildfang autoattack passive (v0.43 feral pass), and its
// Groveheart twin (Groveheart rework pass 2).
//
// Wildfang: every LANDED melee auto-attack a committed feral druid makes can
// arm one free spell for 10 seconds, at about 4 procs per minute in every
// form: the per-swing chance scales with the swing's base interval (the
// classic procs-per-minute shape), so Cat Form's fixed 1.0 sec swing and
// Bruin Form's faster-than-weapon swing land the same rate. The armed window
// covers BOTH members at once and the player chooses which to spend it on:
// whichever of Wildbloom or Oakhide is cast first consumes it, and the other
// reverts. Every proc also clears Oakhide's cooldown, so a window that lands
// while Oakhide is cooling down can still be spent on it.
//
// Groveheart: every tick of a heal-over-time effect a committed restoration
// druid owns has a 10% chance (behind a 10 sec internal cooldown, so the rate
// holds near 2 per minute however many HoTs are out) to arm Wildmend alone:
// instant (combat/ability_resolution.ts reads naturesBoonArmedFor), free, and
// 25% stronger, castable in any form.
// Every LANDED melee auto-attack a committed feral druid makes has a 1-in-15
// chance to arm one free spell for 10 seconds, which at Cat Form's fixed 1.0
// sec swing reads as about one proc every 15 seconds. The armed window covers
// BOTH members at once and the player chooses which to spend it on: whichever
// of Sporemending or Oakhide is cast first consumes it, and the other reverts.
//
// Two things make the window worth having in a form, and both are deliberate:
//
//   free   The window is an ordinary `next_cast_free` aura scoped by
//          `empowerAbilities`, so the existing cost tail (combat/
//          empower_next.ts) zeroes the cost and the action bar already lights
//          the slot. Nothing new rides the wire.
//   in form  A shapeshifted druid normally cannot cast either spell: the cast
//          gate refuses it, or the auto-unshift rule drops the form to let it
//          through. While the window is armed BOTH of those stand down
//          (casting_lifecycle.ts and form_auto_unshift.ts each ask
//          naturesBoonArmedFor), so the free cast goes off from Cat, Bruin,
//          Fleet, Moonwing, or caster form and the druid keeps the form it is
//          standing in. That is the whole point of the passive.
//
// MELEE auto-attacks only. A wand (or a hunter's Auto Shot) resolves through
// rangedSwing's own projectile callback in combat/auto_attack.ts and never
// reaches the meleeSwing shell this hook hangs off, so a caster-form druid
// plinking with a wand can never arm the window. That is a property of where
// the hook sits rather than a check inside it, so it is pinned by a test
// rather than restated here as a guard that could never fire.
//
// Determinism: the 1-in-15 roll is drawn ONLY after the feral-druid gate has
// passed, so a non-feral player's rng stream stays byte-identical (the
// Cinderbark 2pc precedent in druid_engines.ts). It is one draw per landed
// MELEE auto-attack, never per ability swing and never per wand bolt.
import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';
import { baseSwingSpeed, CAT_FORM_SWING_SPEED } from './form_swing';

export const NATURES_BOON_ID = 'natures_boon';
/** The English aura name. Localized at the client through the sim_i18n
 *  matcher, like every other sim-emitted aura name. */
export const NATURES_BOON_NAME = "Nature's Boon";
/** Wildfang procs per minute of landed auto-attacks, in every form. */
export const NATURES_BOON_PPM = 4;
/** The per-swing chance at a given base swing interval: PPM times the swing's
 *  seconds over 60, so a slower swing rolls a bigger chance and the per-minute
 *  rate holds (combat/form_swing.ts baseSwingSpeed: Cat Form's fixed 1.0 sec,
 *  Bruin Form's half-weapon interval, the weapon's own speed otherwise). */
export function naturesBoonChanceAt(swingSeconds: number): number {
  return (NATURES_BOON_PPM * swingSeconds) / 60;
}
/** The Cat Form per-swing chance (1 in 15 at the fixed 1.0 sec swing), the
 *  number the Wildfang spec text advertises as "about every 15 sec". */
export const NATURES_BOON_CHANCE = naturesBoonChanceAt(CAT_FORM_SWING_SPEED);
/** Groveheart: per tick of an owned heal-over-time effect. */
export const GROVEHEART_BOON_TICK_CHANCE = 0.1;
/** Groveheart: no second proc for this long after one lands. */
export const GROVEHEART_BOON_ICD = 10;
/** procState.icds key for the Groveheart internal cooldown. */
export const GROVEHEART_BOON_ICD_KEY = 'dru_grove_natures_boon';
/** The ability whose cooldown every Wildfang proc clears. */
export const OAKHIDE_ID = 'barkskin';
/** An armed window also makes its spell 25% stronger. */
export const NATURES_BOON_POWER = 1.25;
/** The Wildbloom arm of the window is 50% stronger (a heal payoff tuned above
 *  the Oakhide arm), read through naturesBoonPowerFor like the base power. */
export const NATURES_BOON_WILDBLOOM_POWER = 1.5;
/** How long the armed window lasts, in seconds. */
export const NATURES_BOON_DURATION = 10;

/** The spells the window pays for: Sporemending (`rejuvenation`) in any form, and
 *  Oakhide (`barkskin`) in Bruin Form only. Both are armed together and the
 *  first one cast wins, so the window is a choice between a heal and a
 *  mitigation cooldown rather than a free nuke. Both are authored instant, so
 *  only the Groveheart window (Wildmend) touches cast time. */
// Aura.empowerAbilities is a MUTABLE string[] that applyAura stores by
// reference, so every armed window gets its own copy. Handing out this module
// constant instead would share one array across every player and every Sim in
// the process, which is exactly the module-holds-state trap src/sim/CLAUDE.md
// warns about.
export const NATURES_BOON_ABILITIES: readonly string[] = ['rejuvenation', 'barkskin'];
/** The spell a Groveheart window pays for: Wildmend (`healing_touch`), made
 *  instant as well as free. */
export const GROVEHEART_BOON_ABILITIES: readonly string[] = ['healing_touch'];
const ANY_BOON_ABILITY: ReadonlySet<string> = new Set([
  ...NATURES_BOON_ABILITIES,
  ...GROVEHEART_BOON_ABILITIES,
]);

/** Members the window only pays for while the druid is a bear. Oakhide is a
 *  Bruin mitigation cooldown, so a free one out of Bruin Form would be a free
 *  caster-form armor buff instead of the tank payoff it is meant to be. The
 *  action bar asks the same predicate on BOTH of its highlights, so the golden
 *  rim and the empowered treatment on Oakhide appear in Bruin Form and nowhere
 *  else. */
const NATURES_BOON_BEAR_ONLY: ReadonlySet<string> = new Set(['barkskin']);
const BEAR_FORM_KIND = 'form_bear';

/** Structural, so both a sim Aura and the action bar's mirrored aura fit. */
interface BoonAura {
  id?: string;
  kind: string;
  empowerAbilities?: readonly string[];
}

/** Does the druid's current form allow the window to pay for this ability?
 *  True for every member but the bear-only ones, which need Bruin Form.
 *  FOUR consumers ask it, and every one of them has to: the cast gate, the
 *  free-cost tail, the action bar's golden rim, and the bar's generic
 *  `empowered` highlight (that fourth one was missed once, and a Cat Form bar
 *  advertised a free Oakhide the cast gate then refused). Any new surface that
 *  reads the window asks this too, or it promises a cast the sim will not
 *  honour. */
export function naturesBoonFormAllows(
  auras: readonly { kind: string }[],
  abilityId: string,
): boolean {
  if (!NATURES_BOON_BEAR_ONLY.has(abilityId)) return true;
  return auras.some((aura) => aura.kind === BEAR_FORM_KIND);
}

/** The multiplier an armed window puts on its spell's magnitudes, applied to a
 *  COPY of the resolved ability before its effects resolve (the consumeOverload
 *  shape in combat/casting_lifecycle.ts). 1 when no window covers this cast, so
 *  an ordinary Sporemending or Oakhide is untouched. Sporemending takes its own
 *  stronger multiplier; every other member takes the base power. */
export function naturesBoonPowerFor(auras: readonly BoonAura[], abilityId: string): number {
  if (!naturesBoonArmedFor(auras, abilityId)) return 1;
  return abilityId === 'rejuvenation' ? NATURES_BOON_WILDBLOOM_POWER : NATURES_BOON_POWER;
}

/** Is a Nature's Boon window armed for this exact ability right now? The one
 *  question the cast gate and the auto-unshift rule ask, so neither can
 *  disagree with what the consume funnel will actually accept. */
export function naturesBoonArmedFor(
  auras: readonly BoonAura[],
  abilityId: string | undefined,
): boolean {
  if (abilityId === undefined || !ANY_BOON_ABILITY.has(abilityId)) return false;
  if (!naturesBoonFormAllows(auras, abilityId)) return false;
  return auras.some(
    (aura) =>
      aura.id === NATURES_BOON_ID &&
      aura.kind === 'next_cast_free' &&
      aura.empowerAbilities !== undefined &&
      aura.empowerAbilities.includes(abilityId),
  );
}

/** The cast time an armed Groveheart window leaves on its spell: instant for
 *  Wildmend while the window is up, the given cast time otherwise. Read by the
 *  shared resolution chain (combat/ability_resolution.ts), so the tooltip, the
 *  action bar, and the server's cast start agree, and the cast then takes the
 *  instant path where the free window is spent. */
export function naturesBoonCastTime(
  auras: readonly BoonAura[],
  abilityId: string,
  castTime: number,
): number {
  if (castTime <= 0 || !GROVEHEART_BOON_ABILITIES.includes(abilityId)) return castTime;
  return naturesBoonArmedFor(auras, abilityId) ? 0 : castTime;
}

/** Is this player a committed druid of the given spec? The gate that must
 *  pass BEFORE the roll, so nobody else's rng stream moves. */
function isDruidOfSpec(ctx: SimContext, player: Entity, spec: string): boolean {
  if (player.kind !== 'player') return false;
  const meta = ctx.players.get(player.id);
  if (!meta || meta.cls !== 'druid') return false;
  return ctx.playerMods(meta).spec === spec;
}

/** Arm the window, replacing any window already running (a fresh proc refreshes
 *  the 10 sec rather than stacking). Both arms emit the proc flash: a refresh
 *  is a proc the player can see and act on (a fresh 10 sec), so a silent one
 *  would read as the window quietly outliving its timer. */
function armNaturesBoon(ctx: SimContext, player: Entity, abilities: readonly string[]): void {
  const existing = player.auras.find(
    (aura) => aura.id === NATURES_BOON_ID && aura.sourceId === player.id,
  );
  if (existing) {
    existing.kind = 'next_cast_free';
    existing.remaining = NATURES_BOON_DURATION;
    existing.duration = NATURES_BOON_DURATION;
    existing.empowerAbilities = [...abilities];
  } else {
    ctx.applyAura(player, {
      id: NATURES_BOON_ID,
      name: NATURES_BOON_NAME,
      kind: 'next_cast_free',
      remaining: NATURES_BOON_DURATION,
      duration: NATURES_BOON_DURATION,
      value: 0,
      sourceId: player.id,
      school: 'nature',
      empowerAbilities: [...abilities],
    });
  }
  ctx.emit({
    type: 'spellfx',
    sourceId: player.id,
    targetId: player.id,
    school: 'nature',
    fx: 'procSurge',
  });
}

/** The landed-auto-attack hook (combat/auto_attack.ts). Rolls the
 *  swing-scaled chance only for a committed feral druid; everybody else
 *  returns before touching the rng. A proc also clears Oakhide's cooldown. */
export function naturesBoonOnAutoAttack(ctx: SimContext, player: Entity): void {
  if (!isDruidOfSpec(ctx, player, 'feral')) return;
  if (!ctx.rng.chance(naturesBoonChanceAt(baseSwingSpeed(player)))) return;
  armNaturesBoon(ctx, player, NATURES_BOON_ABILITIES);
  player.cooldowns.delete(OAKHIDE_ID);
}

/** The heal-over-time tick hook (combat/auras.ts). A committed restoration
 *  druid's own HoT tick rolls the Groveheart chance when the internal cooldown
 *  is clear; the gate and the cooldown check both pass BEFORE the roll, so no
 *  other player's stream moves and a druid inside the cooldown draws nothing. */
export function naturesBoonOnHotTick(ctx: SimContext, source: Entity | null, aura: Aura): void {
  if (!source || source.dead || aura.kind !== 'hot' || aura.sourceId !== source.id) return;
  if (!isDruidOfSpec(ctx, source, 'restoration')) return;
  if (source.procState?.icds[GROVEHEART_BOON_ICD_KEY] !== undefined) return;
  if (!ctx.rng.chance(GROVEHEART_BOON_TICK_CHANCE)) return;
  if (!source.procState) source.procState = { counters: {}, icds: {} };
  source.procState.icds[GROVEHEART_BOON_ICD_KEY] = GROVEHEART_BOON_ICD;
  armNaturesBoon(ctx, source, GROVEHEART_BOON_ABILITIES);
}
