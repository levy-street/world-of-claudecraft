// Nature's Boon, the Wildfang autoattack passive (v0.43 feral pass).
//
// Every LANDED melee auto-attack a committed feral druid makes has a 1-in-15
// chance to arm one free spell for 10 seconds, which at Cat Form's fixed 1.0
// sec swing reads as about one proc every 15 seconds. The armed window covers
// BOTH members at once and the player chooses which to spend it on: whichever
// of Wildbloom or Oakhide is cast first consumes it, and the other reverts.
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
import type { Entity } from '../types';

export const NATURES_BOON_ID = 'natures_boon';
/** The English aura name. Localized at the client through the sim_i18n
 *  matcher, like every other sim-emitted aura name. */
export const NATURES_BOON_NAME = "Nature's Boon";
/** Per landed auto-attack. */
// Tuned to land a proc roughly every 15 sec. Cat Form swings at a fixed 1.0 sec
// (combat/form_swing.ts CAT_FORM_SWING_SPEED), so one landed auto-attack per
// second makes 1-in-15 the rate that reads as "about every 15 seconds". Bruin
// Form swings on the equipped weapon's slower speed, so a bear procs it
// correspondingly less often; the chance is per SWING, not per second.
export const NATURES_BOON_CHANCE = 1 / 15;
/** An armed window also makes its spell 25% stronger. */
export const NATURES_BOON_POWER = 1.25;
/** How long the armed window lasts, in seconds. */
export const NATURES_BOON_DURATION = 10;

/** The spells the window pays for: Wildbloom (`rejuvenation`) in any form, and
 *  Oakhide (`barkskin`) in Bruin Form only. Both are armed together and the
 *  first one cast wins, so the window is a choice between a heal and a
 *  mitigation cooldown rather than a free nuke. Both are authored instant, so
 *  nothing here has to touch cast time. */
// Aura.empowerAbilities is a MUTABLE string[] that applyAura stores by
// reference, so every armed window gets its own copy. Handing out this module
// constant instead would share one array across every player and every Sim in
// the process, which is exactly the module-holds-state trap src/sim/CLAUDE.md
// warns about.
export const NATURES_BOON_ABILITIES: readonly string[] = ['rejuvenation', 'barkskin'];

/** Members the window only pays for while the druid is a bear. Oakhide is a
 *  Bruin mitigation cooldown, so a free one out of Bruin Form would be a free
 *  caster-form armor buff instead of the tank payoff it is meant to be. The
 *  action bar asks the same predicate on BOTH of its highlights, so the golden
 *  rim and the empowered treatment on Oakhide appear in Bruin Form and nowhere
 *  else. */
const NATURES_BOON_BEAR_ONLY: ReadonlySet<string> = new Set(['barkskin']);
const BEAR_FORM_KIND = 'form_bear';
function boonAbilityList(): string[] {
  return [...NATURES_BOON_ABILITIES];
}

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
 *  an ordinary Wildbloom or Oakhide is untouched. */
export function naturesBoonPowerFor(auras: readonly BoonAura[], abilityId: string): number {
  return naturesBoonArmedFor(auras, abilityId) ? NATURES_BOON_POWER : 1;
}

/** Is a Nature's Boon window armed for this exact ability right now? The one
 *  question the cast gate and the auto-unshift rule ask, so neither can
 *  disagree with what the consume funnel will actually accept. */
export function naturesBoonArmedFor(
  auras: readonly BoonAura[],
  abilityId: string | undefined,
): boolean {
  if (abilityId === undefined || !NATURES_BOON_ABILITIES.includes(abilityId)) return false;
  if (!naturesBoonFormAllows(auras, abilityId)) return false;
  return auras.some(
    (aura) =>
      aura.id === NATURES_BOON_ID &&
      aura.kind === 'next_cast_free' &&
      aura.empowerAbilities !== undefined &&
      aura.empowerAbilities.includes(abilityId),
  );
}

/** Is this player a committed feral druid? The gate that must pass BEFORE the
 *  roll, so nobody else's rng stream moves. */
function isWildfangDruid(ctx: SimContext, player: Entity): boolean {
  if (player.kind !== 'player') return false;
  const meta = ctx.players.get(player.id);
  if (!meta || meta.cls !== 'druid') return false;
  return ctx.playerMods(meta).spec === 'feral';
}

/** Arm the window, replacing any window already running (a fresh proc refreshes
 *  the 10 sec rather than stacking). */
function armNaturesBoon(ctx: SimContext, player: Entity): void {
  const existing = player.auras.find(
    (aura) => aura.id === NATURES_BOON_ID && aura.sourceId === player.id,
  );
  if (existing) {
    existing.kind = 'next_cast_free';
    existing.remaining = NATURES_BOON_DURATION;
    existing.duration = NATURES_BOON_DURATION;
    existing.empowerAbilities = boonAbilityList();
    return;
  }
  ctx.applyAura(player, {
    id: NATURES_BOON_ID,
    name: NATURES_BOON_NAME,
    kind: 'next_cast_free',
    remaining: NATURES_BOON_DURATION,
    duration: NATURES_BOON_DURATION,
    value: 0,
    sourceId: player.id,
    school: 'nature',
    empowerAbilities: boonAbilityList(),
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: player.id,
    targetId: player.id,
    school: 'nature',
    fx: 'procSurge',
  });
}

/** The landed-auto-attack hook (combat/auto_attack.ts). Rolls the 1-in-15 only
 *  for a committed feral druid; everybody else returns before touching the
 *  rng. */
export function naturesBoonOnAutoAttack(ctx: SimContext, player: Entity): void {
  if (!isWildfangDruid(ctx, player)) return;
  if (!ctx.rng.chance(NATURES_BOON_CHANCE)) return;
  armNaturesBoon(ctx, player);
}
