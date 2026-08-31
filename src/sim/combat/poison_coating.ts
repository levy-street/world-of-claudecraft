// Weapon-coat riders: the player-side twin of the mob on-hit DoT/debuff seam.
//
// A coating ability (the rogue poisons) applies an `imbue` aura to the player.
// Beyond the flat per-swing damage every imbue already adds (auto_attack.ts),
// an imbue may author a `coat` rider: an aura the STRUCK target picks up on
// every landed melee swing. That is what makes Festering Venom a real poison
// (a ramping DoT) rather than a bigger Adder's Bite, and what makes Melting
// Acid and Nightshade Coating coatings rather than 40-energy nukes.
//
// The rider borrows the imbue aura's id and display name, so a coat needs no
// second identity: the debuff on the target is the coating ability, and its
// icon, tooltip and localized name all resolve exactly as the ability's do.
import { ABILITIES } from '../data';
import type { SimContext } from '../sim_context';
import type { Aura, Entity, PoisonCoat } from '../types';

// Ability id -> its coat rider (null when the ability carries none). ABILITIES
// is a frozen content table, so this is a pure memo of a pure lookup; it exists
// only to keep the per-swing path off a repeated effects scan.
const COAT_BY_ABILITY = new Map<string, PoisonCoat | null>();

/** The weapon-coat rider an ability authors on its `imbue` effect, or null. */
export function poisonCoatFor(abilityId: string): PoisonCoat | null {
  const memo = COAT_BY_ABILITY.get(abilityId);
  if (memo !== undefined) return memo;
  let coat: PoisonCoat | null = null;
  for (const eff of ABILITIES[abilityId]?.effects ?? []) {
    if (eff.type === 'imbue' && eff.coat !== undefined) {
      coat = eff.coat;
      break;
    }
  }
  COAT_BY_ABILITY.set(abilityId, coat);
  return coat;
}

/** One more application of a stacking coat, clamped to its cap. Pure. */
export function nextCoatStacks(current: number | undefined, maxStacks: number): number {
  return Math.min(Math.max(1, maxStacks), (current ?? 0) + 1);
}

/** The per-tick damage a stacking coat deals at `stacks` stacks. Pure: the dot
 *  tick reads the aura `value` directly, so storing perTick x stacks is what
 *  makes the poison ramp. */
export function coatTickValue(perTick: number, stacks: number): number {
  return Math.max(1, Math.round(perTick * stacks));
}

function applyStackDotCoat(
  ctx: SimContext,
  attacker: Entity,
  target: Entity,
  coating: Aura,
  coat: Extract<PoisonCoat, { rider: 'stackDot' }>,
): void {
  // One shared dot slot per (coating, applier): two rogues running the same
  // poison each ramp their own stack, exactly as applyAura's (id, sourceId)
  // replacement rule already treats every other aura.
  const existing = target.auras.find(
    (a) => a.id === coating.id && a.kind === 'dot' && a.sourceId === attacker.id,
  );
  if (existing !== undefined) {
    // Refresh in place rather than through applyAura: a coat re-applies on
    // EVERY landed swing, so routing the steady state through the splice-and-
    // push replacement path would churn the aura array and broadcast an aura
    // event several times a second per coated attacker for no new information.
    // Clients read the refreshed `remaining` off the next snapshot. The event
    // fires only when the stack count actually MOVED, which is the part a
    // player reacts to and which stops for good at the cap.
    const before = existing.stacks ?? 1;
    existing.stacks = nextCoatStacks(existing.stacks, coat.maxStacks);
    existing.value = coatTickValue(coat.perTick, existing.stacks);
    existing.remaining = existing.duration;
    if (existing.stacks !== before) {
      ctx.emit({ type: 'aura', targetId: target.id, name: coating.name, gained: true });
    }
    return;
  }
  ctx.applyAura(target, {
    id: coating.id,
    name: coating.name,
    kind: 'dot',
    remaining: coat.duration,
    duration: coat.duration,
    value: coatTickValue(coat.perTick, 1),
    tickInterval: coat.interval,
    tickTimer: coat.interval,
    stacks: 1,
    sourceId: attacker.id,
    school: coat.school ?? 'nature',
  });
}

function applyDebuffCoat(
  ctx: SimContext,
  attacker: Entity,
  target: Entity,
  coating: Aura,
  coat: Extract<PoisonCoat, { rider: 'debuff' }>,
): void {
  // Same steady-state rule as the stacking rider: the first swing applies the
  // debuff through the normal gate, every later swing just resets its timer in
  // place. No stack count moves here, so a refresh is silent by construction.
  const existing = target.auras.find(
    (a) => a.id === coating.id && a.kind === coat.kind && a.sourceId === attacker.id,
  );
  if (existing !== undefined) {
    existing.value = coat.value;
    existing.remaining = existing.duration;
    return;
  }
  ctx.applyAura(target, {
    id: coating.id,
    name: coating.name,
    kind: coat.kind,
    remaining: coat.duration,
    duration: coat.duration,
    value: coat.value,
    sourceId: attacker.id,
    school: coat.school ?? 'nature',
  });
}

/** The coat the WEARER's talents actually grant, falling back to the authored
 *  one. Knifework's Redhanded raises poison damage, and that has to reach the
 *  rider, or the passive silently pays nothing on the poison whose damage IS
 *  the rider. Gated behind the cheap `poisonCoatFor` map lookup at the call
 *  site, so the resolve runs only for someone actually wearing a coat. */
function resolvedCoat(ctx: SimContext, wearer: Entity, abilityId: string): PoisonCoat | null {
  if (wearer.kind !== 'player') return poisonCoatFor(abilityId);
  for (const eff of ctx.resolvedAbility(abilityId, wearer.id)?.effects ?? []) {
    if (eff.type === 'imbue' && eff.coat !== undefined) return eff.coat;
  }
  return poisonCoatFor(abilityId);
}

/** Land every worn weapon coat on the struck target. Called from the LANDED
 *  arm of the shared melee swing (auto attacks and weapon-strike abilities
 *  alike), so a miss, dodge or parry carries no poison. Draws no rng: a coat
 *  applies on every swing that connects. */
export function applyPoisonCoats(ctx: SimContext, attacker: Entity, target: Entity): void {
  if (target.dead) return;
  for (const aura of attacker.auras) {
    if (aura.kind !== 'imbue') continue;
    if (poisonCoatFor(aura.id) === null) continue;
    const coat = resolvedCoat(ctx, attacker, aura.id);
    if (coat === null) continue;
    if (coat.rider === 'stackDot') applyStackDotCoat(ctx, attacker, target, aura, coat);
    else applyDebuffCoat(ctx, attacker, target, aura, coat);
  }
}
