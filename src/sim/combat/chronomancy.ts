// Chronomancy (mage healer) Phase 2: Temporal Echo. docs/prd/mage-chronomancy.md
// section 13. The healer marks ONE ally with a per-caster echo aura; while it
// rides, a fraction of the mage's EFFECTIVE (post-mitigation, post-absorb,
// non-overkill) Arcane damage is siphoned back as healing onto the marked ally:
// 35% of single-target Arcane damage, 15% of area Arcane damage. Applying the
// mark also does a small direct heal (owned by the effect dispatcher, not this
// module). Re-casting MOVES the mark to the new ally (one own mark at a time).
// Two chronomancers keep independent marks on the same ally, filtered by
// aura.sourceId.
//
// Determinism: the conversion heal draws NO rng. The damage's crit was already
// resolved upstream, so the converted heal never rolls its own crit and never
// touches the global rng stream (a second draw here would shift every later
// roll and break the parity gate). All state lives in entity auras, never in
// module globals. A converted heal is applied through a dedicated non-crit path
// (never dealDamage), so it can never trigger another conversion (no recursion).
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/
// Date.now/performance.now (enforced by tests/architecture.test.ts).

import { isDebuffAura, isPartyFrameRelevantAura } from '../aura_classify';
import { ABILITIES } from '../data';
import { recordCascadeConversion, recordCascadeDamage } from '../dev/cascade_playtest';
import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';
import { consumeHealAbsorb, healingTakenMult, healingThreat } from './heal';

// The mark aura kind and ability id (they share one string so the buff bar and
// the tooltip resolve the icon/name straight from ABILITIES['temporal_echo']).
export const TEMPORAL_ECHO_ID = 'temporal_echo';
// The English ability name, emitted on conversion heals so the client heal-name
// matcher (sim_i18n) localizes them exactly like a Temporal Mend heal, never the
// raw id. Falls back to the id if the record is ever missing.
const TEMPORAL_ECHO_NAME = ABILITIES[TEMPORAL_ECHO_ID]?.name ?? 'Temporal Echo';
// Playtest-provisional (PRD section 13.1 / 13.14): 15s window, 35% single-target
// conversion, 15% area conversion. Not balance-locked.
export const TEMPORAL_ECHO_DURATION = 15;
export const ECHO_CONVERT_SINGLE = 0.35;
export const ECHO_CONVERT_AOE = 0.15;
// Cascada temporal (Phase 4 group echo, docs/prd/mage-chronomancy.md): the group
// version marks up to five allies with a REDUCED conversion, 13% single-target /
// 6% area Arcane. Each marked ally converts its OWN coefficient independently (no
// shared budget), so the aggregate across five marks is intentionally larger than a
// single 35% mark: that is the AoE-healing payoff, gated by cost/cooldown/window.
export const ECHO_GROUP_CONVERT_SINGLE = 0.13;
export const ECHO_GROUP_CONVERT_AOE = 0.06;

/** The conversion rate a Temporal Echo mark heals at, from its stored origin.
 *  Single-target (35% / 13%) reads the coefficient stored on the aura; the area
 *  rate (15% / 6%) is derived from echoGroup so an AoE hit keeps its reduction. */
function echoRateFor(a: Aura, aoe: boolean): number {
  if (aoe) return a.echoGroup ? ECHO_GROUP_CONVERT_AOE : ECHO_CONVERT_AOE;
  return a.echoConvertRate ?? (a.echoGroup ? ECHO_GROUP_CONVERT_SINGLE : ECHO_CONVERT_SINGLE);
}

/** UI visibility predicate (owner 2026-07-12): a Temporal Echo mark is shown only
 *  on the viewer's OWN marks (target/group/raid indicators). Every other aura is
 *  always visible. Other chronomancers' echoes still exist and heal in the sim;
 *  they are just hidden from this viewer's frames. Structural input so both the
 *  offline party strip, the server party wire, and the target strip can share it. */
export function echoVisibleTo(a: { kind: string; sourceId: number }, viewerId: number): boolean {
  if (a.kind !== 'temporal_echo') return true;
  return a.sourceId === viewerId;
}

/** Raid-frame aura order: harmful effects, own Echo, healer effects, then maintenance buffs. */
export function partyAuraPriority(aura: Aura): number {
  if (!isPartyFrameRelevantAura(aura)) return 3;
  if (isDebuffAura(aura.kind, aura.value)) return 0;
  if (aura.kind === 'temporal_echo') return 1;
  return 2;
}

/**
 * Remove every Temporal Echo mark THIS mage placed, wherever it currently sits.
 * Used to MOVE the mark on re-cast (strip then re-apply) and to clear it when the
 * mage leaves Chronomancy or dies. Filters strictly by `sourceId`, so a mark this
 * mage carries from ANOTHER chronomancer is left untouched. Emits the standard
 * aura fade event for each removed mark so both hosts drop the buff icon. Draws no
 * rng. Iterates `ctx.entities` in insertion order (deterministic).
 */
export function stripTemporalEchoes(ctx: SimContext, mageId: number): void {
  for (const e of ctx.entities.values()) {
    for (let i = e.auras.length - 1; i >= 0; i--) {
      const a = e.auras[i];
      if (a.kind === 'temporal_echo' && a.sourceId === mageId) {
        e.auras.splice(i, 1);
        ctx.emit({ type: 'aura', targetId: e.id, name: a.name, gained: false });
      }
    }
  }
}

/**
 * Strip only the caster's INDIVIDUAL (non-group) Temporal Echo mark, wherever it
 * sits. Used to MOVE the single-target echo on re-cast WITHOUT clearing the
 * caster's Cascada group echoes on other allies (those are a separate, wider
 * window). Group marks (echoGroup) are left untouched; the full stripTemporalEchoes
 * above still clears everything on death / leaving Chronomancy. Draws no rng.
 */
export function stripIndividualEcho(ctx: SimContext, mageId: number): void {
  for (const e of ctx.entities.values()) {
    for (let i = e.auras.length - 1; i >= 0; i--) {
      const a = e.auras[i];
      if (a.kind === 'temporal_echo' && a.sourceId === mageId && !a.echoGroup) {
        e.auras.splice(i, 1);
        ctx.emit({ type: 'aura', targetId: e.id, name: a.name, gained: false });
      }
    }
  }
}

/**
 * Apply (or MOVE) the caster's Temporal Echo mark onto `target`. Any existing mark
 * this caster owns is stripped first, so only one own mark is ever active. The
 * mark carries `sourceId` = caster so conversions and cleanup filter by caster,
 * and `school: 'arcane'`. A brief temporal glyph is shown directly over the target
 * (no projectile travels to the ally). The small initial heal is applied by the
 * `heal` effect that sits beside the `temporalEcho` effect on the ability, not
 * here.
 */
export function placeTemporalEcho(
  ctx: SimContext,
  caster: Entity,
  target: Entity,
  duration: number,
): void {
  stripIndividualEcho(ctx, caster.id); // one own individual mark -> re-cast moves it
  // applyAura replaces this caster's existing mark on `target` by (id, sourceId), so
  // casting the single echo onto an ally that carries this caster's GROUP echo UPGRADES
  // it to the 35% individual mark (owner rule: group -> individual). If that individual
  // later moves away, the ally is simply left bare (no group rebuild in v1).
  ctx.applyAura(target, {
    id: TEMPORAL_ECHO_ID,
    name: TEMPORAL_ECHO_NAME,
    kind: 'temporal_echo',
    remaining: duration,
    duration,
    value: 1,
    sourceId: caster.id,
    school: 'arcane',
    echoGroup: false,
    echoConvertRate: ECHO_CONVERT_SINGLE,
  });
  // The identity beat: a temporal glyph blooms directly on the ally. It is
  // target-anchored (no wave, no projectile) and flows to the online client
  // verbatim like every other spellfx.
  ctx.emit({
    type: 'spellfx',
    sourceId: caster.id,
    targetId: target.id,
    school: 'arcane',
    fx: 'temporalGlyph',
  });
}

/**
 * The damage-core seam. Called from dealDamage AFTER the truly-landed amount is
 * known (`dealt` = pre-hit hp minus post-hit hp, so absorbed / avoided / overkill
 * damage is already excluded). No-op unless the SOURCE is a player who currently
 * holds a Temporal Echo mark out and the damage school is Arcane. Heals the marked
 * ally by `dealt * rate` (single-target 35%, area 15%). Draws no rng; applies the
 * heal through applyEchoHeal (never dealDamage) so it can never recurse.
 */
export function chronomancyConvertArcaneDamage(
  ctx: SimContext,
  source: Entity | null,
  dealt: number,
  school: string,
  aoe: boolean,
): void {
  if (!source || source.kind !== 'player' || school !== 'arcane' || dealt <= 0) return;
  recordCascadeDamage(source, dealt); // DEV playtest tally (no-op without a session)
  // Heal EVERY ally this mage currently marks, each at its OWN stored coefficient
  // (single 35%/15%, group 13%/6%). With only the single-target echo this is exactly
  // one ally as before; the Cascada group version can ride up to five marks at once.
  // No shared budget: each mark converts independently. Stable Map iteration order
  // keeps the fan-out deterministic; a dead ally is skipped. Each ally holds at most
  // one mark from this source (applyAura dedupes by id+sourceId), so break after it.
  for (const e of ctx.entities.values()) {
    if (e.dead) continue;
    for (const a of e.auras) {
      if (a.kind === 'temporal_echo' && a.sourceId === source.id) {
        applyEchoHeal(ctx, source, e, dealt, echoRateFor(a, aoe));
        break;
      }
    }
  }
}

/**
 * Resolve and ORDER the full Cascada temporal target list before any heal or aura
 * is applied (owner rule). Eligible = the caster plus LIVING members of the caster's
 * group/raid (never external friendlies or NPCs). The `primary` (the ability's
 * friendly target) must be one of those and is ALWAYS included first; the remaining
 * slots go to the members nearest to the PRIMARY (not the mage) within `radius`,
 * ordered by (distance, then stable id), capped at `maxTargets` total. Never random.
 * Returns [] if the primary is not a valid living group/raid member (the cast is
 * refused upstream). Draws no rng.
 */
export function selectCascadeTargets(
  ctx: SimContext,
  caster: Entity,
  primary: Entity,
  radius: number,
  maxTargets: number,
): Entity[] {
  const party = ctx.partyOf(caster.id);
  const memberIds = party ? party.members : [caster.id];
  const memberSet = new Set(memberIds);
  // The primary must be the caster or a living member of the caster's group/raid.
  if (!memberSet.has(primary.id) || primary.dead) return [];
  const px = primary.pos.x;
  const pz = primary.pos.z;
  const r2 = radius * radius;
  const extras: { e: Entity; d2: number }[] = [];
  for (const pid of memberIds) {
    if (pid === primary.id) continue;
    const e = ctx.entities.get(pid);
    const meta = ctx.players.get(pid); // players only, no NPC party companions
    if (!e || !meta || e.dead) continue;
    const dx = e.pos.x - px;
    const dz = e.pos.z - pz;
    const d2 = dx * dx + dz * dz;
    if (d2 > r2) continue; // outside the radius from the primary
    extras.push({ e, d2 });
  }
  // Nearest to the primary first; ties broken by stable id, never randomly.
  extras.sort((a, b) => a.d2 - b.d2 || a.e.id - b.e.id);
  const chosen: Entity[] = [primary];
  for (const x of extras) {
    if (chosen.length >= maxTargets) break;
    chosen.push(x.e);
  }
  return chosen;
}

/**
 * Place (or refresh) THIS caster's Cascada group echo on one selected ally, honoring
 * the individual-overlap rule: if the ally already carries the caster's INDIVIDUAL
 * echo it keeps the 35% mark (never downgraded), and the group cast only EXTENDS it
 * up to `duration` when it has less left, never refreshing it back to its full 15s.
 * Otherwise a 13% group echo is applied (applyAura replaces this caster's prior group
 * mark on the ally by id+sourceId). The small initial heal is applied by the effect
 * dispatcher, not here. Draws no rng.
 */
export function placeGroupEcho(
  ctx: SimContext,
  caster: Entity,
  ally: Entity,
  duration: number,
): void {
  const existing = ally.auras.find((a) => a.kind === 'temporal_echo' && a.sourceId === caster.id);
  if (existing && !existing.echoGroup) {
    // Individual echo present: keep 35%, only extend UP TO `duration` (never to 15s).
    if (existing.remaining < duration) existing.remaining = duration;
    return;
  }
  ctx.applyAura(ally, {
    id: TEMPORAL_ECHO_ID,
    name: TEMPORAL_ECHO_NAME,
    kind: 'temporal_echo',
    remaining: duration,
    duration,
    value: 1,
    sourceId: caster.id,
    school: 'arcane',
    echoGroup: true,
    echoConvertRate: ECHO_GROUP_CONVERT_SINGLE,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: caster.id,
    targetId: ally.id,
    school: 'arcane',
    fx: 'temporalGlyph',
  });
}

/**
 * Apply a Temporal Echo conversion heal onto the marked ally. NON-crit by design
 * (the damage crit already fattened `dealt`). Rounds per hit so each Arcane impact
 * heals on its own (PRD: Arcane Missiles heals per missile). Honors the ally's
 * incoming-heal reduction and heal-absorb shields and clamps to missing health
 * exactly like the normal heal channel, then fans out effective-healing threat.
 * Emits a `heal2` (the number + heal-glow pulse over the ally on both hosts).
 */
function applyEchoHeal(
  ctx: SimContext,
  source: Entity,
  ally: Entity,
  dealt: number,
  rate: number,
): void {
  if (ally.dead) return;
  let healed = Math.round(dealt * rate * healingTakenMult(ctx, ally));
  if (healed <= 0) return;
  healed = consumeHealAbsorb(ctx, ally, healed);
  const preClamp = healed;
  healed = Math.min(healed, ally.maxHp - ally.hp);
  // DEV playtest tally (no-op without an active session): the applied heal plus the
  // portion lost to the missing-hp clamp (overheal). Never alters the healed value.
  recordCascadeConversion(source, healed, preClamp - healed);
  if (healed <= 0) return;
  ally.hp += healed;
  ctx.emit({
    type: 'heal2',
    sourceId: source.id,
    targetId: ally.id,
    amount: healed,
    crit: false,
    ability: TEMPORAL_ECHO_NAME,
  });
  healingThreat(ctx, source, ally, healed);
}

// ---- Chronomancy Phase 3: the Arcane rotation engine (Aether Surge charges),
// docs/prd/mage-chronomancy.md sections 13.4 / 14. Aether Surge (Oleada de éter)
// is the single-target Arcane spender that drives the offensive heal rotation.
// Each cast READS the caster's current Arcane Charge count to scale its damage
// (+30% per charge, moderate) and its mana cost (x1.9 per charge, steep and
// compounding), THEN banks one more charge (cap 4). The charges ride a caster
// aura that expires 10s after the last cast (refreshed each cast). Aether Darts
// (arcane_missiles) CONSUMES every charge on its FIRST landed missile and splits
// a flat Arcane bonus across its missiles. That bonus is plain Arcane damage, so
// Temporal Echo heals from it at the normal 35% (NO hidden heal bonus). The
// damage increase alone is what feeds more Echo healing.
//
// Determinism: every function here draws NO rng and keeps all state on the aura
// (charges) or two per-channel entity flags (the Darts dump). Aether Surge is
// `projectile: false`, so cost, damage and the +1 charge all resolve at cast
// completion in one controlled order (cost reads N, damage reads N, then banks
// N+1); a traveling bolt would let a back-to-back recast read stale charges.

export const ARCANE_SURGE_ID = 'arcane_surge';
const ARCANE_SURGE_NAME = ABILITIES[ARCANE_SURGE_ID]?.name ?? 'Aether Surge';
// PLAYTEST-provisional (PRD 13.4 / 14). The base cost lives on the ABILITIES
// record; it is DERIVED via tests/chronomancy_balance.test.ts to land the
// conservative rotation near 70-80s to OOM at the real level-20 pool.
export const AETHER_SURGE_MAX_CHARGES = 4;
export const AETHER_SURGE_DMG_PER_CHARGE = 0.3; // +30% damage per charge (linear, moderate)
export const AETHER_SURGE_COST_PER_CHARGE = 1.0; // x2 cost per charge (geometric: each charge DOUBLES the cost)
export const AETHER_SURGE_CHARGE_WINDOW = 10; // seconds, refreshed on each cast
// Aether Darts dump: a flat Arcane bonus of 9 per consumed charge, split evenly
// across the channel's missiles (36 total at 4 charges, +12 per missile over 3).
// Owner tuning 2026-07-12: the discharge should hit a bit harder.
export const AETHER_DARTS_BONUS_PER_CHARGE = 9;
// Full-charge barrage (owner 2026-07-12): at MAX Arcane Charges, Aether Darts fires
// this many missiles instead of the ability's default 3, in the same channel time
// (more base hits + more Echo conversion). Below max charges it stays the default.
export const AETHER_DARTS_FULL_CHARGE_MISSILES = 5;
// Free-cast proc (owner 2026-07-12): each Aether Surge has a chance to make the
// NEXT Aether Surge cost no mana. Softens the escalating mana wall and rewards
// staying on the spender. Provisional chance; the free window is generous so a
// proc landed mid-rotation is almost always spent by the next cast. Reuses the
// shared next_cast_free machinery (combat/empower_next.ts), scoped to Aether
// Surge, consumed at cast completion in casting_lifecycle. Draws rng ONLY on an
// Aether Surge cast (an arcane-spec ability absent from every parity golden), so
// the shared stream and the goldens are untouched for other specs.
export const AETHER_SURGE_FREE_PROC_CHANCE = 0.25;
export const AETHER_SURGE_FREE_WINDOW = 15; // seconds the armed free cast waits
const AETHER_SURGE_FREE_ID = 'aether_surge_free';
// Cast-speed ramp (owner 2026-07-12). Two stacking effects shorten ONLY the Aether
// Surge cast, so a Chronomancer visibly speeds up as they commit to the spender:
//  - Each held Arcane Charge trims 5% (max 4 charges => a 20% faster cast), a haste
//    ramp that pairs with the escalating cost.
//  - While the free-cast proc (Aether Rush) is armed, the cast is 2x faster (x0.5),
//    so the proc is felt in the cast bar, not just the mana bar. Stacks with the
//    charge ramp (4 charges + proc: 0.8 * 0.5 = 0.4x, a 2s cast in 0.8s).
// Draws no rng and touches no other ability, so parity goldens are unaffected.
export const AETHER_SURGE_CAST_HASTE_PER_CHARGE = 0.05;
export const AETHER_SURGE_PROC_CAST_MULT = 0.5;

function aetherSurgeAura(e: Entity): Aura | undefined {
  return e.auras.find((a) => a.id === ARCANE_SURGE_ID);
}

/** Arcane Charges the caster currently holds (0 if none). Draws no rng. */
export function aetherSurgeStacks(e: Entity): number {
  return aetherSurgeAura(e)?.value ?? 0;
}

/** Cost multiplier for the NEXT Aether Surge, from the charges held right now.
 *  Geometric (x2 per charge) so four charges cost 16x the base: the mana wall
 *  that makes holding a full stack a short emergency window, not a rotation. */
export function aetherSurgeCostMult(e: Entity): number {
  return (1 + AETHER_SURGE_COST_PER_CHARGE) ** aetherSurgeStacks(e);
}

/** Damage multiplier for THIS Aether Surge, from the charges held right now.
 *  Linear (+30% per charge): moderate, so the extra Echo healing it feeds grows
 *  gently while the cost climbs steeply. */
export function aetherSurgeDamageMult(e: Entity): number {
  return 1 + AETHER_SURGE_DMG_PER_CHARGE * aetherSurgeStacks(e);
}

/** Cast-time multiplier for the NEXT Aether Surge from the charges held and the
 *  free-cast proc (see the constants above): 1 at rest, down to 0.4x at 4 charges
 *  with Aether Rush armed. Applied ONLY to Aether Surge in casting_lifecycle, and
 *  draws no rng. */
export function aetherSurgeCastMult(e: Entity): number {
  const charges = Math.min(AETHER_SURGE_MAX_CHARGES, aetherSurgeStacks(e));
  let mult = 1 - AETHER_SURGE_CAST_HASTE_PER_CHARGE * charges;
  if (e.auras.some((a) => a.id === AETHER_SURGE_FREE_ID)) mult *= AETHER_SURGE_PROC_CAST_MULT;
  return mult;
}

/** Bank one Arcane Charge after an Aether Surge lands (cap 4) and refresh the
 *  10s window (applyAura replaces by id, so the timer resets on every cast), then
 *  roll the free-cast proc. Draws exactly one rng chance, AFTER the cast's own
 *  damage draws, only for Aether Surge. */
export function aetherSurgeAddStack(ctx: SimContext, caster: Entity): void {
  const next = Math.min(AETHER_SURGE_MAX_CHARGES, aetherSurgeStacks(caster) + 1);
  ctx.applyAura(caster, {
    id: ARCANE_SURGE_ID,
    name: ARCANE_SURGE_NAME,
    kind: 'arcane_charge',
    remaining: AETHER_SURGE_CHARGE_WINDOW,
    duration: AETHER_SURGE_CHARGE_WINDOW,
    value: next,
    stacks: next,
    sourceId: caster.id,
    school: 'arcane',
  });
  if (ctx.rng.chance(AETHER_SURGE_FREE_PROC_CHANCE)) armAetherSurgeFree(ctx, caster);
}

/** Arm the "next Aether Surge is free" proc: a next_cast_free aura scoped to
 *  Aether Surge (consumed at cast completion by casting_lifecycle via
 *  consumeFreeCostFor). applyAura replaces by id, so a re-proc just refreshes it. */
export function armAetherSurgeFree(ctx: SimContext, caster: Entity): void {
  ctx.applyAura(caster, {
    id: AETHER_SURGE_FREE_ID,
    name: 'Aether Rush',
    kind: 'next_cast_free',
    value: 0,
    remaining: AETHER_SURGE_FREE_WINDOW,
    duration: AETHER_SURGE_FREE_WINDOW,
    sourceId: caster.id,
    school: 'arcane',
    empowerAbilities: [ARCANE_SURGE_ID],
  });
}

// Perfect Moment (owner design 2026-07-14): the Chronomancer's offensive
// cooldown. Instantly slams the caster to FOUR Arcane Charges (the overlay bird
// lights whole) and, for its window, Aether Darts stops consuming them: ten
// seconds of chained full-charge barrages. Deterministic aura writes, no rng.
export const PERFECT_MOMENT_ID = 'perfect_moment';
export const PERFECT_MOMENT_DURATION = 10;

/** Whether the caster's Perfect Moment window is open (Darts keeps its charges). */
export function perfectMomentActive(e: Entity): boolean {
  return e.auras.some((a) => a.id === PERFECT_MOMENT_ID);
}

/** Open the window: the marker buff plus a FULL charge stack whose remaining
 *  matches the window, so the loaded bird can never decay inside it. Casting
 *  Aether Surge inside the window refreshes/extends the charges normally. */
export function applyPerfectMoment(ctx: SimContext, caster: Entity): void {
  ctx.applyAura(caster, {
    id: PERFECT_MOMENT_ID,
    name: 'Perfect Moment',
    kind: 'perfect_moment',
    value: 0,
    remaining: PERFECT_MOMENT_DURATION,
    duration: PERFECT_MOMENT_DURATION,
    sourceId: caster.id,
    school: 'arcane',
  });
  ctx.applyAura(caster, {
    id: ARCANE_SURGE_ID,
    name: ARCANE_SURGE_NAME,
    kind: 'arcane_charge',
    remaining: PERFECT_MOMENT_DURATION,
    duration: PERFECT_MOMENT_DURATION,
    value: AETHER_SURGE_MAX_CHARGES,
    stacks: AETHER_SURGE_MAX_CHARGES,
    sourceId: caster.id,
    school: 'arcane',
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: caster.id,
    targetId: caster.id,
    school: 'arcane',
    fx: 'procSurge',
  });
}

/** Channel-start hook (casting_lifecycle's channel block): arm the Aether Darts
 *  dump so the FIRST landed missile of THIS channel consumes the charges. Inert
 *  for every other channel. */
export function aetherDartsChannelStart(caster: Entity, abilityId: string): void {
  if (abilityId !== 'arcane_missiles') return;
  caster.aetherDartsConsumePending = true;
  caster.aetherDartsBonusPerBolt = 0;
  // Full-charge barrage: at MAX charges, fire AETHER_DARTS_FULL_CHARGE_MISSILES this
  // channel; 0 leaves casting_lifecycle on the ability's default tick count.
  caster.aetherDartsTicks =
    aetherSurgeStacks(caster) >= AETHER_SURGE_MAX_CHARGES ? AETHER_DARTS_FULL_CHARGE_MISSILES : 0;
}

/** Per-missile hook (the Aether Darts bolt callback): on the FIRST landed missile
 *  of the channel, consume every Arcane Charge and lock in the flat per-missile
 *  bonus (total 6 per charge split across the channel's `ticks`); later missiles
 *  reuse the locked value. Returns the flat Arcane damage to add to this missile.
 *  Consuming on the first LANDED missile (not at channel start) means an
 *  interrupt before any damage lands never wastes the charges. Draws no rng. */
export function aetherDartsBoltBonus(ctx: SimContext, caster: Entity, ticks: number): number {
  if (caster.aetherDartsConsumePending) {
    caster.aetherDartsConsumePending = false;
    const stacks = aetherSurgeStacks(caster);
    // Perfect Moment: the window's whole point is that the dump does NOT spend
    // the charges (the bonus below still reads them), so back-to-back
    // full-charge barrages chain for its duration.
    if (!perfectMomentActive(caster)) {
      const idx = caster.auras.findIndex((a) => a.id === ARCANE_SURGE_ID);
      if (idx >= 0) {
        const a = caster.auras[idx];
        caster.auras.splice(idx, 1);
        ctx.emit({ type: 'aura', targetId: caster.id, name: a.name, gained: false });
      }
    }
    const total = AETHER_DARTS_BONUS_PER_CHARGE * stacks;
    // Split across the ACTUAL missile count this channel (5 at full charge, else the
    // passed default), so the flat bonus total is unchanged regardless of barrage size.
    const bolts = caster.aetherDartsTicks || ticks;
    caster.aetherDartsBonusPerBolt = bolts > 0 ? Math.round(total / bolts) : 0;
  }
  return caster.aetherDartsBonusPerBolt ?? 0;
}
