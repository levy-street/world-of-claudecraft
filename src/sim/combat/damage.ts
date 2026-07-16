// Post-mitigation damage core, extracted from the Sim monolith (C1).
//
// This module owns the post-mitigation damage pipeline: dealDamage's amp/absorb/
// duel/fiesta/arena routing + death handoff, the two reactive hooks it drives
// (maybeFrenzyOnHit, reflectSpellWard), the death teardown (handleDeath), and the
// XP-grant chain (grantXp -> accrueLifetimeXp, whose tail marks the player dirty
// for the Book of Deeds tick-tail evaluator). It is the widest-coupled slice in
// the refactor, so it consumes a large slice of the SimContext seam.
//
// PRIME DIRECTIVE: this is a MOVE, not a rewrite. Every function below is the former
// `Sim` method verbatim, with `this.X` rewritten to `ctx.X` (the SimContext seam) or
// to a sibling function in this module. Statement order, branch order, and the
// in-place mutation (the refactor's immutability waiver) are preserved exactly so the
// parity gate's full-state trace AND rng draw-order log stay byte-identical. The ONLY
// rng draw in this slice is `ctx.rng.chance(fr.chance)` in maybeFrenzyOnHit, guarded
// by a non-carrier early bail BEFORE any rng touch; its global stream position must
// not move.
//
// Crit/dodge/miss/armor are resolved UPSTREAM (meleeSwing/rangedSwing, C5): dealDamage
// receives an already-mitigated integer. There is no parry and no separate overkill
// calc (overkill is implicit via Math.max(0, hp - amount)).
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now
// (enforced by tests/architecture.test.ts).

import { computeTalentModifiers } from '../content/talents';
import { DELVES, GROUP_XP_BONUS, MOBS } from '../data';
import * as deedsMod from '../deeds';
import { recalcPlayerStats } from '../entity';
import { DAMAGE_IDLE_DESPAWN_MOB_IDS, DAMAGE_IDLE_DESPAWN_SECONDS } from '../entity_roster';
import { pvpDamageMultiplier } from '../pvp';
import { aurasSurvivingDeath } from '../resurrection';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { vcupBothSeated } from '../social/vale_cup';
import { addThreat, clearThreat } from '../threat';
import type { Entity } from '../types';
import {
  dist2d,
  FISHING_CAST_ID,
  isConsuming,
  MAX_LEVEL,
  mobXpValue,
  NYTHRAXIS_BOSS_ID,
  PARTY_XP_RANGE,
  rageFromDealing,
  rageFromTaking,
  virtualLevel,
  xpForLevel,
} from '../types';
import { WORLD_BOSS_CORPSE_SECONDS, worldBossLootContributors } from '../world_boss';

// How long a slain mob's corpse persists (seconds) before it is cleared. Sole user
// is handleDeath, so the constant lives here with the death-domain code.
const CORPSE_DURATION = 60;
// Self attack-speed buff a wounded frenzyOnHit mob gains; sole user maybeFrenzyOnHit.
const BLOOD_FRENZY_AURA_ID = 'blood_frenzy';

// A handful of casts ignore classic-era spell pushback (e.g. ghost_wolf). Sole user is
// the dealDamage pushback branch, so the predicate lives here with it.
function ignoresDamagePushback(abilityId: string): boolean {
  return abilityId === 'ghost_wolf';
}

export function dealDamage(
  ctx: SimContext,
  source: Entity | null,
  target: Entity,
  amount: number,
  crit: boolean,
  school: string,
  ability: string | null,
  kind: 'hit' | 'miss' | 'dodge',
  noRage = false,
  threatOpts?: { flat?: number; mult?: number },
  // Whether this is a DIRECT attack (auto-attack swing or a direct-hit spell) as
  // opposed to incidental damage (Lightning Shield/Thorns/spiked-hide reflect, DoT
  // ticks). Only direct damage may walk a mob's leash anchor; passive damage must
  // let the mob leash (evade home) so it can't be kited an unlimited distance.
  direct = true,
  attackAnimationStarted = false,
  // The amount is ALREADY fully source-modified (e.g. a Fiendlore share of damage the
  // owner already took): skip the source-output mods (Defensive Stance's own-damage cut,
  // Weakening Hex) so they are not applied a second time. Target-side amps, absorb, death,
  // and events still run so the redirected hit lands normally on the pet.
  alreadyFinal = false,
): void {
  if (target.dead) return;
  if (target.gm || target.devGod) return; // GMs and /dev god are invulnerable (every damage path funnels here)
  // A wild mob that broke leash is in 'evade': it has dropped its hate table
  // and walks home without fighting back, healing to full only on arrival.
  // Classic mechanics make it immune while it retreats, so it can't be chipped
  // down or killed outright for a risk-free kill. Owned pets use pet AI, not
  // wild-mob leash recovery, and must not inherit this immunity from stale state.
  if (target.kind === 'mob' && target.aiState === 'evade' && target.ownerId === null) return;
  amount = Math.max(0, amount);
  const attackAnimation = attackAnimationStarted ? { attackAnimationStarted: true as const } : {};
  // [dev] A god-mode player (/dev god) hits for 100x so a solo tester can chew
  // through raid bosses to inspect drops without one-shotting them past their phase
  // transitions. Gated on devCommands so it can NEVER apply in production (where gm
  // marks real, non-fighting game masters). Draws no rng.
  if (source?.devGod && source.kind === 'player' && ctx.devCommands)
    amount = Math.round(amount * 100);

  // Defensive Stance, classic: deal 10% less, take 10% less (and +30% threat below)
  if (
    !alreadyFinal &&
    source &&
    source.id !== target.id &&
    source.auras.some((a) => a.kind === 'defensive_stance')
  ) {
    amount = Math.round(amount * 0.9);
  }
  if (
    source &&
    source.id !== target.id &&
    target.auras.some((a) => a.kind === 'defensive_stance')
  ) {
    amount = Math.round(amount * 0.9);
  }

  // Ironhold (Shield Wall): a big defensive cooldown, fraction less damage from any
  // source, any school, DoT ticks included. Non-stacking: the strongest ward wins.
  if (amount > 0) {
    let ward = 0;
    for (const a of target.auras) if (a.kind === 'shield_wall') ward = Math.max(ward, a.value);
    if (ward > 0) amount = Math.round(amount * (1 - ward));
  }

  // Expose: a cracked-guard debuff amplifies the physical damage the victim
  // takes (from any attacker) until it expires. Armor is already applied at the
  // swing site, so this rides on top of the post-mitigation amount.
  if (school === 'physical' && amount > 0) {
    let exposeMult = 1;
    for (const a of target.auras) if (a.kind === 'expose') exposeMult += a.value;
    if (exposeMult !== 1) amount = Math.round(amount * exposeMult);
  }

  // Spell Vulnerability: a `spellvuln` debuff amplifies all NON-physical (magic)
  // damage the victim takes from every attacker. Holy is excluded so healing-
  // school spells are untouched. Stacks additively across active debuffs and
  // lands before absorb shields, so a soaked hit still soaks the amplified total.
  if (amount > 0 && school !== 'physical' && school !== 'holy') {
    let amp = 0;
    for (const a of target.auras) {
      if (a.kind === 'spellvuln') amp += a.value;
    }
    if (amp > 0) amount = Math.round(amount * (1 + amp));
  }

  // Curse of frailty: a cursed victim takes more damage from every source. The
  // offensive mirror of Defensive Stance's cut above. Multiple curses stack
  // additively (sum of amps) so layered curses can't multiply out of control.
  if (amount > 0) {
    let vuln = 0;
    for (const a of target.auras) if (a.kind === 'vulnerability') vuln += a.value;
    if (vuln > 0) amount = Math.round(amount * (1 + vuln));
  }

  // Weakening Hex: a hexed source deals less damage (mirrors the healing cut in
  // applyHeal). Self-damage paths (source === target) are left untouched.
  if (!alreadyFinal && source && source.id !== target.id) {
    const hexMult = ctx.hexOutputMult(source);
    if (hexMult !== 1) amount = Math.round(amount * hexMult);
  }

  // Gloamveil Form (Shadowform): while in the form, the caster's SHADOW-school damage
  // is amplified (classic +15%). School-scoped so only shadow spells benefit, and a
  // source-output mod (skipped when the amount is already final, e.g. a redirect share).
  // Every shadow damage path (direct nuke, DoT tick, Mind Flay channel, AoE) funnels
  // here, so this one site covers them all; the boost is dynamic (it follows the form).
  if (!alreadyFinal && source && school === 'shadow' && amount > 0) {
    const form = source.auras.find((a) => a.kind === 'form_shadow');
    if (form) amount = Math.round(amount * (1 + form.value / 100));
  }

  // "Find Weakness": a critvuln debuff makes the target's exposed flesh take
  // extra damage from CRITICAL hits only (any attacker, any school). Applied
  // after the defensive-stance reduction, before absorb shields soak it.
  if (crit && amount > 0 && source && source.id !== target.id) {
    const bonus = ctx.critVulnBonus(target);
    if (bonus > 0) amount = Math.round(amount * (1 + bonus));
  }

  const sourcePlayer = ctx.pvpController(source);

  // WARFARE is a hostile player-vs-player modifier only. Pets, self-damage,
  // friendly effects, player-vs-mob, and mob-vs-player damage stay byte-identical.
  // dealDamage receives post-mitigation damage, so this deterministic step sits
  // after the upstream armor/resist roll and before absorb shields.
  if (
    amount > 0 &&
    source?.kind === 'player' &&
    target.kind === 'player' &&
    source.id !== target.id &&
    ctx.isHostileTo(source, target)
  ) {
    amount = Math.max(0, Math.round(amount * pvpDamageMultiplier(source, target)));
  }

  // The Vale Cup: nobody bleeds at the Sowfield. Any damage between two seated
  // cup fighters is floored to 0 BEFORE absorb shields soak it, belt and
  // braces: the sport kit has no damage abilities, but a stray consumable,
  // proc, or reflect must neither hurt a fighter nor eat their shield.
  if (amount > 0 && sourcePlayer && target.kind === 'player') {
    const cupMatch = ctx.vcup.match;
    if (cupMatch && vcupBothSeated(cupMatch, sourcePlayer.id, target.id)) amount = 0;
  }

  // absorb shields soak damage first
  if (amount > 0) {
    for (let i = target.auras.length - 1; i >= 0 && amount > 0; i--) {
      const a = target.auras[i];
      if (a.kind !== 'absorb') continue;
      const soaked = Math.min(a.value, amount);
      a.value -= soaked;
      amount -= soaked;
      if (a.value <= 0) {
        target.auras.splice(i, 1);
        ctx.emit({ type: 'aura', targetId: target.id, name: a.name, gained: false });
      }
    }
  }

  if (target.kind === 'player' && amount > 0) {
    const meta = ctx.players.get(target.id);
    const share = meta ? ctx.playerMods(meta).global.petDmgSharePct : 0;
    const pet = share > 0 ? ctx.petOf(target.id) : null;
    if (pet && !pet.dead) {
      const redirected = Math.min(amount, Math.round(amount * share));
      if (redirected > 0) {
        amount -= redirected;
        ctx.dealDamage(
          source,
          pet,
          redirected,
          crit,
          school,
          ability,
          kind,
          noRage,
          threatOpts,
          direct,
          attackAnimationStarted,
          // The share is already fully source-modified: don't re-apply the source's
          // Defensive Stance cut / Weakening Hex to the pet's portion.
          true,
        );
      }
    }
  }

  // Sacred Bulwark (Guardian Ward): an enemy lethal hit spends the ward, clamps
  // overkill to the health actually lost, and restores the wearer from the aura's
  // data value. The damage still falls through the shared tail below so combat,
  // counters, CC/stealth breaks, consumption, pushback, rage, and deeds all run.
  // Sourceless and self damage do not spend this enemy-hit defensive.
  let guardianWardRestore = 0;
  const guardianWardEnemyHit =
    source?.kind === 'mob' && source.ownerId === null
      ? source.hostile
      : !!source && ctx.isHostileTo(source, target);
  if (
    amount > 0 &&
    target.kind === 'player' &&
    source &&
    source.id !== target.id &&
    guardianWardEnemyHit &&
    target.hp - amount <= 0
  ) {
    const wardIdx = target.auras.findIndex((a) => a.kind === 'guardian_ward');
    if (wardIdx >= 0) {
      const ward = target.auras[wardIdx];
      target.auras.splice(wardIdx, 1);
      ctx.emit({ type: 'aura', targetId: target.id, name: ward.name, gained: false });
      amount = Math.max(0, target.hp);
      guardianWardRestore = Math.max(1, Math.round(target.maxHp * ward.value));
    }
  }

  // duels end at 1 hp, nobody dies
  const duel = target.kind === 'player' ? ctx.duels.get(target.id) : undefined;
  if (
    guardianWardRestore === 0 &&
    duel &&
    duel.state === 'active' &&
    sourcePlayer &&
    (sourcePlayer.id === duel.a || sourcePlayer.id === duel.b)
  ) {
    if (target.hp - amount < 1) {
      amount = Math.max(0, target.hp - 1);
      target.hp = 1;
      ctx.emit({
        type: 'damage',
        sourceId: source?.id ?? -1,
        targetId: target.id,
        amount,
        crit,
        school,
        ability,
        kind,
        ...attackAnimation,
      });
      // Book of Deeds: the clamped terminal hit counts (zero rng; the early
      // return skips the shared deed site and the session RewardCounters).
      if (source) deedsMod.onDamageDealtForDeeds(ctx, source, target, amount, crit, kind);
      ctx.endDuel(duel, sourcePlayer.id);
      return;
    }
  }

  // Fiesta takedowns score a point and put the victim on a (growing) respawn
  // timer instead of permanently eliminating them — the party never stops.
  const match = target.kind === 'player' ? ctx.arenaMatches.get(target.id) : undefined;
  // Fiesta lifesteal augment: heal the attacker for a slice of damage dealt.
  if (
    match?.fiesta &&
    match.state === 'active' &&
    sourcePlayer &&
    amount > 0 &&
    ctx.isArenaCrossTeam(match, sourcePlayer.id, target.id)
  ) {
    const ls = ctx.players.get(sourcePlayer.id)?.fiestaSpecial.lifestealPct ?? 0;
    if (ls > 0 && !sourcePlayer.dead && sourcePlayer.hp < sourcePlayer.maxHp) {
      const heal = Math.max(1, Math.round(amount * ls));
      sourcePlayer.hp = Math.min(sourcePlayer.maxHp, sourcePlayer.hp + heal);
      ctx.emit({ type: 'heal', targetId: sourcePlayer.id, amount: heal });
    }
  }
  if (
    guardianWardRestore === 0 &&
    match?.fiesta &&
    match.state === 'active' &&
    sourcePlayer &&
    ctx.isArenaCrossTeam(match, sourcePlayer.id, target.id)
  ) {
    if (target.hp - amount <= 0) {
      amount = Math.max(0, target.hp);
      target.hp = 0;
      ctx.emit({
        type: 'damage',
        sourceId: source?.id ?? -1,
        targetId: target.id,
        amount,
        crit,
        school,
        ability,
        kind,
        ...attackAnimation,
      });
      // Book of Deeds: the clamped terminal hit counts (zero rng).
      if (source) deedsMod.onDamageDealtForDeeds(ctx, source, target, amount, crit, kind);
      ctx.fiestaTakedown(match, sourcePlayer.id, target);
      return;
    }
  }

  // Protect Yumi downs bench the victim on a flat respawn timer, like Fiesta:
  // never the permanent ranked elimination below. MUST stay above that arm.
  if (
    guardianWardRestore === 0 &&
    match?.yumi &&
    match.state === 'active' &&
    sourcePlayer &&
    ctx.isArenaCrossTeam(match, sourcePlayer.id, target.id)
  ) {
    if (target.hp - amount <= 0) {
      amount = Math.max(0, target.hp);
      target.hp = 0;
      ctx.emit({
        type: 'damage',
        sourceId: source?.id ?? -1,
        targetId: target.id,
        amount,
        crit,
        school,
        ability,
        kind,
        ...attackAnimation,
      });
      // Book of Deeds: the clamped terminal hit counts (zero rng).
      if (source) deedsMod.onDamageDealtForDeeds(ctx, source, target, amount, crit, kind);
      ctx.yumiPlayerDown(match, target, sourcePlayer.id);
      return;
    }
  }

  // Ranked arena eliminations use normal death state so clients and combat
  // logic see a real 0 HP defeat. The return timer revives everyone after.
  if (
    guardianWardRestore === 0 &&
    match &&
    !match.fiesta &&
    !match.yumi &&
    match.state === 'active' &&
    sourcePlayer &&
    ctx.isArenaCrossTeam(match, sourcePlayer.id, target.id)
  ) {
    if (match.defeated.has(target.id)) return;
    if (target.hp - amount <= 0) {
      amount = Math.max(0, target.hp);
      target.hp = 0;
      match.defeated.add(target.id);
      ctx.emit({
        type: 'damage',
        sourceId: source?.id ?? -1,
        targetId: target.id,
        amount,
        crit,
        school,
        ability,
        kind,
        ...attackAnimation,
      });
      // Book of Deeds: the clamped terminal hit counts (zero rng).
      if (source) deedsMod.onDamageDealtForDeeds(ctx, source, target, amount, crit, kind);
      handleDeath(ctx, target, source);
      const loserTeam = ctx.arenaTeamOf(match, target.id);
      if (loserTeam && ctx.isArenaTeamWiped(match, loserTeam)) {
        ctx.endArenaMatch(match, loserTeam === 'A' ? 'B' : 'A', 'defeat');
      }
      return;
    }
  }

  // A Protect Yumi cat: the yumi module owns the clamp, the sudden-death
  // taken-multiplier, tiebreak bookkeeping, and win detection. Amps and
  // absorb shields already resolved above, so a shielded cat soaks first.
  if (target.kind === 'mob') {
    const ymatch = ctx.yumiCatMatches.get(target.id);
    if (ymatch) {
      ctx.yumiCatDamaged(
        ymatch,
        source,
        target,
        amount,
        crit,
        school,
        ability,
        kind,
        attackAnimationStarted,
      );
      return;
    }
  }

  target.hp = guardianWardRestore || Math.max(0, target.hp - amount);
  ctx.emit({
    type: 'damage',
    sourceId: source?.id ?? -1,
    targetId: target.id,
    amount,
    crit,
    school,
    ability,
    kind,
    ...attackAnimation,
  });
  if (guardianWardRestore > 0) {
    ctx.emit({ type: 'heal', targetId: target.id, amount: guardianWardRestore });
  }

  if (amount > 0) {
    if (target.kind === 'mob' && DAMAGE_IDLE_DESPAWN_MOB_IDS.has(target.templateId)) {
      target.damageIdleDespawnTimer = DAMAGE_IDLE_DESPAWN_SECONDS;
    }
    for (let i = target.auras.length - 1; i >= 0; i--) {
      if (target.auras[i].breaksOnDamage) {
        ctx.emit({
          type: 'aura',
          targetId: target.id,
          name: target.auras[i].name,
          gained: false,
        });
        target.auras.splice(i, 1);
      }
    }
  }

  // taking or dealing real damage breaks stealth
  if (amount > 0) {
    ctx.breakStealth(target);
    if (source && source.id !== target.id) {
      ctx.breakStealth(source);
    }
  }

  if (source && source.id !== target.id) ctx.enterCombat(source, target);
  if (direct) ctx.refreshMobLeashFromAction(source, target);

  // classic threat: damage (and the ability's flat bonus) lands on the mob's
  // hate table, scaled by the attacker's stance/form modifiers
  if (
    source &&
    source.id !== target.id &&
    target.kind === 'mob' &&
    target.hostile &&
    (source.kind === 'player' || source.ownerId !== null)
  ) {
    const threat =
      (amount * (threatOpts?.mult ?? 1) + (threatOpts?.flat ?? 0)) * ctx.threatMod(source, school);
    addThreat(target, source.id, threat);
  }

  // Tap rights: the first player (or their pet) to damage a mob owns it. Classic-era
  // behavior for every mob, including rares: pet damage taps. A camper who
  // monopolizes a rare's tap through their pet alone does not deny anyone the kill
  // reward, because rares also track PERSONAL loot contribution (below, mirroring
  // world bosses): every player who lands a hit gets their own credit toward a
  // guaranteed quest drop regardless of who holds the tap, so tap rights only gate
  // who owns the corpse/party-loot roll, never who is credited for a personal
  // quest item.
  if (
    source &&
    target.kind === 'mob' &&
    target.hostile &&
    target.tappedById === null &&
    amount > 0
  ) {
    const sourcePid = source.kind === 'player' ? source.id : source.ownerId;
    const sourceMeta = sourcePid !== null ? ctx.players.get(sourcePid) : null;
    if (sourceMeta && !sourceMeta.leaving) target.tappedById = sourcePid;
  }

  // Personal-drop contributor roster: every player (or pet owner) who lands a hit on
  // a world boss OR a rare becomes a permanent loot contributor. Unlike the hate
  // table above, this set is NEVER pruned when they die, release their spirit, or
  // drop off threat, so a contributor who died still gets credit. Read at death by
  // worldBossLootContributors. Rares reuse this contributor tracking (not the
  // world-boss PERSONAL LOOT TABLE roll, just the roster) so a guaranteed personal
  // quest drop (a rare's `chance: 1` quest item, e.g. greyjaw_fang) can be credited
  // to every quest-needing contributor, not just whoever holds the tap. A rare has a
  // single camp spawn shared by the whole zone: without this, a camper's aggressive
  // pet re-tapping it the instant it respawns (petPickTarget's anti-AFK window,
  // pet/pet_ai.ts) would monopolize the guaranteed drop forever, and a passerby who
  // lands one hit to steal the tap back would also steal it from the player who
  // actually farmed the kill. Tracking contribution, not tap, closes both holes
  // without changing the classic pet-tap rule itself.
  if (
    source &&
    amount > 0 &&
    (MOBS[target.templateId]?.worldBoss || MOBS[target.templateId]?.rare)
  ) {
    const contributorId = source.kind === 'player' ? source.id : source.ownerId;
    if (contributorId !== null) target.bossDamagers.add(contributorId);
  }

  // Book of Deeds bookkeeping (pure state transitions, zero rng): the
  // persisted lifetime damage counters beside the session RewardCounters
  // below, plus encounter participant tracking for the roster tasks.
  if (source) deedsMod.onDamageDealtForDeeds(ctx, source, target, amount, crit, kind);

  if (source && source.kind === 'player' && source.id !== target.id) {
    const meta = ctx.players.get(source.id);
    if (meta) meta.counters.damageDealt += amount;
    if (source.resourceType === 'rage' && !noRage && school === 'physical' && !ability) {
      source.resource = Math.min(
        source.maxResource,
        source.resource + rageFromDealing(amount, source.level),
      );
    }
  }
  if (target.kind === 'player') {
    const meta = ctx.players.get(target.id);
    if (meta) meta.counters.damageTaken += amount;
    if (target.resourceType === 'rage' && source && source.id !== target.id) {
      target.resource = Math.min(
        target.maxResource,
        target.resource + rageFromTaking(amount, source.level),
      );
    }
    if (isConsuming(target)) {
      target.eating = null;
      target.drinking = null;
    }
    if (target.sitting) target.sitting = false;
    // classic-era spell pushback: a landed hit delays the cast rather than
    // cancelling it (misses and fully absorbed hits don't push back)
    if (
      target.castingAbility &&
      source &&
      source.id !== target.id &&
      amount > 0 &&
      kind === 'hit'
    ) {
      if (target.castingAbility === FISHING_CAST_ID) ctx.cancelCast(target);
      else if (!ignoresDamagePushback(target.castingAbility)) ctx.pushbackCast(target);
    }
  }

  // Reactive "Frenzy": a wounded mob carrying frenzyOnHit may lash out faster.
  // Rolls only for mobs that actually carry the trait (the helper bails before
  // touching rng otherwise), so existing fixed-seed combat stays byte-identical.
  if (kind === 'hit' && amount > 0 && !target.dead && target.hp > 0) {
    maybeFrenzyOnHit(ctx, target, source);
  }
  reflectSpellWard(ctx, source, target, amount, kind, school);

  if (target.hp <= 0) {
    // A fiesta fighter who somehow bottoms out via a non-takedown path (a
    // friendly DoT tail, self-damage) is benched, not killed — never let the
    // party-mode hp hit a permanent death + graveyard flow.
    const fmatch = target.kind === 'player' ? ctx.arenaMatches.get(target.id) : undefined;
    if (fmatch?.fiesta && fmatch.state === 'active' && !ctx.arenaIsDown(fmatch, target.id)) {
      ctx.fiestaDown(fmatch, target, null);
    } else if (fmatch?.yumi && fmatch.state === 'active' && !ctx.arenaIsDown(fmatch, target.id)) {
      // Same non-takedown bottom-out safety for Protect Yumi: bench, never
      // the permanent death + graveyard flow.
      ctx.yumiPlayerDown(fmatch, target, null);
    } else {
      handleDeath(ctx, target, source);
    }
  }
}

// Reactive beast "Frenzy": when a mob with the frenzyOnHit trait is struck by a
// player (or their pet), it has a chance to fly into a blood frenzy and swing
// faster for a few seconds. Modelled as a refreshable buff_haste self-aura — the
// same primitive packFrenzy uses — so it rides the normal aura tick and snapshot
// wire with no new Entity field. The struck mob buffs ITSELF, so there is no
// recursion risk (the buff is not damage) and no player-facing debuff string.
function maybeFrenzyOnHit(ctx: SimContext, target: Entity, source: Entity | null): void {
  const fr = MOBS[target.templateId]?.frenzyOnHit;
  if (!fr) return; // non-carriers never reach rng — keeps determinism neutral
  if (target.kind !== 'mob' || !target.hostile || target.ownerId !== null) return;
  if (!source || source.id === target.id) return;
  const fromPlayer = source.kind === 'player' || source.ownerId !== null;
  if (!fromPlayer) return;
  if (!ctx.rng.chance(fr.chance)) return;
  const name = fr.name ?? 'Blood Frenzy';
  const existing = target.auras.find((a) => a.id === BLOOD_FRENZY_AURA_ID);
  if (existing) {
    existing.remaining = fr.duration; // refresh on each further wound; don't stack
    return;
  }
  target.auras.push({
    id: BLOOD_FRENZY_AURA_ID,
    name,
    kind: 'buff_haste',
    remaining: fr.duration,
    duration: fr.duration,
    value: fr.hasteMult,
    sourceId: target.id,
    school: 'physical',
  });
  ctx.emit({ type: 'aura', targetId: target.id, name, gained: true });
  ctx.emit({
    type: 'log',
    text: `${target.name} flies into a frenzy!`,
    color: '#ff8c00',
    entityId: target.id,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: target.id,
    targetId: target.id,
    school: 'physical',
    fx: 'nova',
  });
}

/**
 * Innate "warded" mobs reflect flat damage onto a caster whose SPELL connects
 * — the magic-school twin of melee thorns (which only punishes melee swings).
 * Fires for any non-physical hit the mob survives; the reflected blow is
 * mob-sourced, so it can never re-trigger a reflect (players carry no template).
 */
function reflectSpellWard(
  ctx: SimContext,
  source: Entity | null,
  target: Entity,
  amount: number,
  kind: 'hit' | 'miss' | 'dodge',
  school: string,
): void {
  if (source?.kind !== 'player' || source.id === target.id) return;
  if (
    target.kind !== 'mob' ||
    target.hp <= 0 ||
    kind !== 'hit' ||
    amount <= 0 ||
    school === 'physical'
  )
    return;
  const ward = MOBS[target.templateId]?.spellReflect;
  if (!ward) return;
  dealDamage(
    ctx,
    target,
    source,
    ward.value,
    false,
    ward.school ?? 'shadow',
    ward.name ?? 'Spell Reflection',
    'hit',
    true,
  );
}

export function handleDeath(ctx: SimContext, e: Entity, killer: Entity | null): void {
  e.dead = true;
  e.hp = 0;
  ctx.clearNonPlayerStatAuras(e);
  // The Keeper's Toll (Resurrection Sickness) is the one debuff that survives death: it
  // must not be sheddable by dying and releasing the spirit. Only a player ever carries
  // it, so mobs still clear fully.
  e.auras = aurasSurvivingDeath(e.auras);
  e.ccDr.clear();
  e.castingAbility = null;
  e.castTargetId = null;
  ctx.emit({ type: 'death', entityId: e.id, killerId: killer?.id ?? -1 });

  // a dead mob keeps no raid marker — respawnMob reuses the same entity id,
  // so a stale mark would otherwise reappear on the respawn
  if (e.kind === 'mob') ctx.clearEntityMarker(e.id);

  // Book of Deeds death bookkeeping runs BEFORE the hate tables are cleared just
  // below, so its world-boss survival taint and the engaged-room folds observe
  // the dying player's own pre-death threat: a heal-only contributor leaves no
  // damage trace, so their live threat entry is the only proof they were engaged,
  // and the clear loop would erase it out from under the hook. (The player-block
  // counters and side effects stay below; only this pure read-of-threat moves up.)
  if (e.kind === 'player') deedsMod.onPlayerDeathForDeeds(ctx, e);

  // the dead drop off every hate table (and any taunt lock on them)
  for (const m of ctx.entities.values()) {
    if (m.kind !== 'mob' || m.id === e.id) continue;
    m.threat.delete(e.id);
    if (m.forcedTargetId === e.id) {
      m.forcedTargetId = null;
      m.forcedTargetTimer = 0;
    }
  }

  if (e.kind === 'player') {
    const meta = ctx.players.get(e.id);
    if (meta) meta.counters.deaths++;
    // The Book of Deeds death hook (lifetime deaths counter, the Keeper's Toll
    // delight, perfection-window taints, the world-boss survival record) already
    // ran above, before the hate tables were cleared.
    e.autoAttack = false;
    e.queuedOnSwing = null;
    delete e.queuedOnSwingFree;
    e.queuedCastAbility = null;
    e.queuedCastAim = null;
    e.comboPoints = 0;
    e.eating = null;
    e.drinking = null;
    e.sitting = false;
    e.chargeTargetId = null;
    e.chargePath = [];
    e.followTargetId = null;
    ctx.emit({ type: 'playerDeath', pid: e.id });
    for (const m of ctx.entities.values()) {
      if (m.kind === 'mob' && !m.dead && m.aggroTargetId === e.id && m.aiState !== 'dead') {
        // turn on the next nearby attacker; go home only if nobody is left
        ctx.retargetMob(m);
      }
    }
    // The owner's pet does not outlive them: without this the pet was orphaned
    // (still owned, owner present-but-dead) so updatePet's despawn guard never
    // fired and petPickTarget's `!owner.dead` gate left it idle and unkillable.
    // Route it through handleDeath so the owned-mob branch below applies: warlock
    // demons unravel, a hunter's beast leaves a revivable corpse (Revive Pet).
    const pet = ctx.petOf(e.id);
    if (pet) handleDeath(ctx, pet, killer);
    return;
  }

  if (e.kind === 'mob') {
    const template = MOBS[e.templateId];
    const run = ctx.delveRunForMob(e.id);
    if (
      run &&
      template &&
      DELVES[run.delveId]?.bosses.includes(template.id) &&
      !run.completed &&
      !run.objective.complete
    ) {
      run.objective.complete = true;
      ctx.onDelveBossDefeated(run);
    }
    if (
      run?.affixes.includes('restless_graves') &&
      template &&
      !template.boss &&
      !template.elite &&
      !e.affixSpawned
    ) {
      run.restlessPending.push({
        at: ctx.time + 3,
        x: e.pos.x,
        z: e.pos.z,
        mobId: 'reliquary_bonewalker',
      });
    }
    e.aiState = 'dead';
    e.corpseTimer = CORPSE_DURATION;
    e.respawnTimer =
      template?.respawnSeconds ??
      ctx.cfg.respawnSeconds * (template?.respawnMult ?? (template?.rare ? 4 : 1));
    // A fixed respawn also caps corpse decay so the mob returns on schedule whether
    // or not its loot was looted (training dummy: 10s).
    if (template?.respawnSeconds !== undefined) {
      e.corpseTimer = Math.min(e.corpseTimer, template.respawnSeconds);
    }
    // World bosses: snapshot the contributor set from the hate table BEFORE it is
    // cleared below, keep a long lootable-corpse window so every contributor can
    // loot, and never auto-respawn in place: the world-boss scheduler is the sole
    // respawner (it drops the corpse once the window elapses). Summoned adds
    // collapse with the boss: leaving them alive would harass looters for the
    // whole window, and a slain add's in-place respawn timer would revive it
    // mid-window (only fires for worldBoss templates, so no parity rng change).
    const worldBossContribs = template?.worldBoss ? worldBossLootContributors(ctx, e) : null;
    // Rares: same contributor roster as a world boss, but used only to widen who is
    // eligible for a guaranteed personal quest drop (rollLoot's questId branch below),
    // never to run the world-boss PERSONAL LOOT TABLE roll. Snapshot BEFORE
    // clearThreat below, exactly like worldBossContribs.
    const rareContribs =
      !template?.worldBoss && template?.rare ? worldBossLootContributors(ctx, e) : null;
    if (template?.worldBoss) {
      e.corpseTimer = WORLD_BOSS_CORPSE_SECONDS;
      e.respawnTimer = Infinity;
      ctx.despawnSummonedAdds(e);
    }
    e.aggroTargetId = null;
    clearThreat(e);
    if (e.ownerId !== null) {
      e.corpseTimer = Infinity;
      e.respawnTimer = Infinity;
      e.hostile = false;
      e.inCombat = false;
      ctx.emit({ type: 'log', text: `${e.name} dies.`, color: '#f66', pid: e.ownerId });
      // a slain summoned demon lingers only briefly, then unravels (updateMob)
      if (MOBS[e.templateId]?.family === 'demon') e.corpseTimer = 3;
      return; // owned pets drop no loot/credit; demons unravel, hunters revive or abandon
    }
    ctx.frenzyPackmates(e); // wild packmates fly into a frenzy when one falls
    ctx.armDeathThroes(e); // volatile corpses begin to destabilize, then burst

    // Credit goes to the tapping player, unless authoritative leave teardown
    // already froze that character before its persistence await. Immediate
    // removal would clear the tap, so mirror that result and fall back to the
    // live killing player instead of dropping the whole party's reward.
    const tapperMeta = e.tappedById !== null ? ctx.players.get(e.tappedById) : null;
    const killerPid = killer?.kind === 'player' ? killer.id : (killer?.ownerId ?? null);
    const killerMeta = killerPid !== null ? ctx.players.get(killerPid) : null;
    const creditId =
      e.tappedById !== null && tapperMeta && !tapperMeta.leaving
        ? e.tappedById
        : killerPid !== null && killerMeta && !killerMeta.leaving
          ? killerPid
          : null;
    const meta = creditId !== null ? ctx.players.get(creditId) : null;
    const creditEntity = creditId !== null ? ctx.entities.get(creditId) : null;
    const rewardInstance = ctx.instances.find(
      (inst) => inst.partyKey !== null && inst.mobIds.includes(e.id),
    );
    let heroicRewardRecipients: PlayerMeta[] = [];
    if (meta && creditEntity && !meta.leaving) {
      const tmpl = MOBS[e.templateId];
      // xpMult 0 marks a puzzle-object mob (the 1 HP spider egg-sac): killable
      // in one hit by design, so it must not pay full kill XP.
      const eliteMult = (tmpl?.elite ? 2 : 1) * (tmpl?.xpMult ?? 1);
      // party play: kill credit, xp split and quest progress shared with
      // members nearby (classic group rules + group bonus). A member downed
      // during the fight still counts while their corpse is in range: classic
      // groups credit fallen members (and their loot rights), they are not
      // erased for dying or for releasing to the graveyard after the kill.
      const party = ctx.partyOf(creditEntity.id);
      const eligible: PlayerMeta[] = [];
      if (party) {
        for (const mPid of party.members) {
          const mMeta = ctx.players.get(mPid);
          const mE = ctx.entities.get(mPid);
          // A released player entity stands at the graveyard, but their body is
          // still where they fell. Use that corpse position for the kill-time
          // participation snapshot so releasing during the final seconds does
          // not erase XP, loot-roll, or Heroic Mark rights.
          const matchingInstanceCorpse =
            mE?.ghost &&
            mE.corpsePos &&
            (!rewardInstance || mE.corpseInstanceId === rewardInstance.exitId)
              ? mE.corpsePos
              : null;
          const participationPos = matchingInstanceCorpse ?? mE?.pos;
          if (
            mMeta &&
            !mMeta.leaving &&
            participationPos &&
            dist2d(participationPos, e.pos) <= PARTY_XP_RANGE
          )
            eligible.push(mMeta);
        }
      }
      if (eligible.length === 0) eligible.push(meta);
      heroicRewardRecipients = eligible;
      e.lootRecipientIds = eligible.map((member) => member.entityId);
      const bonus = GROUP_XP_BONUS[Math.min(eligible.length, GROUP_XP_BONUS.length) - 1];

      meta.counters.kills++;
      if (creditEntity.targetId === e.id) creditEntity.autoAttack = false;
      // combo points are character-bound: unspent points survive the kill and
      // carry to the next target (they fade on their own via updateComboExpiry)
      for (const member of eligible) {
        const mE = ctx.entities.get(member.entityId);
        if (!mE) continue;
        // mobXpValue keeps the level-diff (anti-farm) scaling; grantXp now
        // routes the award to lifetimeXp even at the cap, so the party gate no
        // longer blocks max-level members — it just forwards every positive award.
        const xpGain = Math.round(
          (mobXpValue(e.level, mE.level) * eliteMult * bonus) / eligible.length,
        );
        if (xpGain > 0) grantXp(ctx, xpGain, member, { fromKill: true });
        ctx.onMobKilledForQuests(e, member);
      }
      // World bosses use PERSONAL loot for every contributor (rolled below from the
      // hate-table snapshot), not the tapper/party shared-corpse roll. Rares pass
      // their own damage-contributor snapshot (rareContribs) so rollLoot's guaranteed
      // personal quest-item entries (questId, chance:1) can credit every contributing
      // quest-needer, not just the tap-credited party.
      if (!template?.worldBoss) ctx.rollLoot(e, meta, eligible, rareContribs ?? undefined);
      // Book of Deeds kill credit: lifetime counters, slain marks, dungeon
      // clears, and the encounter skill tasks that resolve at this death.
      deedsMod.onMobKillCreditForDeeds(ctx, e, killer, meta, eligible);
    }
    // Settle the heroic reward and its realm-reset lockout together. This runs
    // even without player credit so the owning group cannot dodge the lockout;
    // only the participation snapshot above receives marks.
    ctx.awardHeroicMarks(e, heroicRewardRecipients);
    // Nythraxis normal and heroic raid lockouts use a wider room sweep than
    // generic dungeon claims. Run it after heroic settlement so its lock stamp
    // cannot make first-clear participants look previously rewarded.
    if (e.templateId === NYTHRAXIS_BOSS_ID) ctx.grantNythraxisLockout(e);
    // Personal loot is independent of tap/party kill credit: it goes to everyone who
    // damaged the boss, so it rolls outside the credited-player block above.
    if (worldBossContribs) {
      ctx.rollWorldBossLoot(e, worldBossContribs);
      // World-boss deeds ride the same never-pruned contributor roster.
      deedsMod.onWorldBossKilledForDeeds(ctx, e, worldBossContribs);
    }
  }
}

export function grantXp(
  ctx: SimContext,
  amount: number,
  meta: PlayerMeta,
  opts?: { fromKill?: boolean },
): void {
  const p = ctx.entities.get(meta.entityId);
  if (!p || amount <= 0) return;
  // Rested XP bonus: the classic-era rule only doubles KILL xp (not quests), and
  // never past the cap (no level bar to advance). The bonus equals the rested
  // amount drawn down, so the effective award is up to 2x while the pool lasts.
  let restedBonus = 0;
  if (opts?.fromKill && p.level < MAX_LEVEL && meta.restedXp > 0) {
    restedBonus = Math.min(Math.floor(meta.restedXp), amount);
    meta.restedXp -= restedBonus;
    amount += restedBonus;
  }
  // Lifetime XP accrues for EVERY award, including at the cap — this is what
  // makes post-cap progression work. It feeds the virtual level, the
  // leaderboard, and cosmetic milestones. The level bar below only advances
  // while under the cap; once capped the remainder lives on in lifetimeXp
  // rather than being discarded to gold/zero (FR-1.4).
  accrueLifetimeXp(ctx, amount, meta, p);
  meta.counters.xpGained += amount;
  ctx.emit({
    type: 'xp',
    amount,
    pid: p.id,
    ...(restedBonus > 0 ? { rested: restedBonus } : {}),
  });

  if (p.level >= MAX_LEVEL) return; // bar frozen at cap; lifetimeXp already credited

  meta.xp += amount;
  while (p.level < MAX_LEVEL && meta.xp >= xpForLevel(p.level)) {
    meta.xp -= xpForLevel(p.level);
    p.level++;
    meta.counters.levelUps++;
    // Re-bake the flat talent mods at the new level BEFORE the stat pass: spec mastery
    // magnitudes scale with level (min(1, level/20) in accumulate), so a ding must
    // strengthen the mastery without waiting for a respec/spec-pick/relog re-bake.
    meta.talentMods = computeTalentModifiers(meta.cls, meta.talents, p.level);
    recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
    p.hp = p.maxHp;
    if (p.resourceType === 'mana') p.resource = p.maxResource;
    ctx.emit({ type: 'levelup', level: p.level, pid: p.id });
    ctx.refreshKnownAbilities(meta, true);
    ctx.syncPetLevel(p);
  }
  // Dinged to cap mid-grant: clear the leftover from the BAR. It is not lost —
  // the full award was already added to lifetimeXp above (FR-1.4).
  if (p.level >= MAX_LEVEL) meta.xp = 0;
}

// Add to the monotonic lifetime counter, emitting cosmetic virtual-level-up
// events past the cap. Cheap: one add plus an O(log n) table lookup, never
// touched on the per-tick hot path. The legacy milestone check unified into
// the Book of Deeds: the dirty mark at the tail hands the lifetime-XP (and
// level) predicates to the tick-tail evaluator, whose grant path dual-writes
// unlockedMilestones and emits deedUnlocked as the single grant event.
function accrueLifetimeXp(ctx: SimContext, amount: number, meta: PlayerMeta, p: Entity): void {
  const atCap = p.level >= MAX_LEVEL;
  const beforeVL = atCap ? virtualLevel(meta.lifetimeXp) : 0;
  meta.lifetimeXp += amount;
  // 64-bit-safe invariant: JS numbers are exact to 2^53. A single character
  // reaching this is effectively impossible, but clamp + log if it ever does.
  if (meta.lifetimeXp >= Number.MAX_SAFE_INTEGER) {
    meta.lifetimeXp = Number.MAX_SAFE_INTEGER;
    console.warn(`lifetimeXp for ${meta.name} hit the 2^53 ceiling and was clamped`);
  }
  if (atCap) {
    const afterVL = virtualLevel(meta.lifetimeXp);
    for (let v = beforeVL + 1; v <= afterVL; v++) {
      ctx.emit({ type: 'virtualLevelUp', level: v, pid: p.id });
    }
  }
  ctx.markDeedsDirty(meta.entityId);
}
