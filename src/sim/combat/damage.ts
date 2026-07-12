// Post-mitigation damage core, extracted from the Sim monolith (C1).
//
// This module owns the post-mitigation damage pipeline: dealDamage's amp/absorb/
// duel/fiesta/arena routing + death handoff, the two reactive hooks it drives
// (maybeFrenzyOnHit, reflectSpellWard), the death teardown (handleDeath), and the
// XP-grant chain (grantXp -> accrueLifetimeXp -> checkMilestones). It is the widest-
// coupled slice in the refactor, so it consumes a large slice of the SimContext seam.
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

import { computeModifiersWithRows } from '../content/talent_rows';
import { ABILITIES, DELVES, GROUP_XP_BONUS, ITEMS, MOBS } from '../data';
import { recalcPlayerStats } from '../entity';
import { DAMAGE_IDLE_DESPAWN_MOB_IDS, DAMAGE_IDLE_DESPAWN_SECONDS } from '../entity_roster';
import { weaponHand } from '../equipment_rules';
import { aurasSurvivingDeath } from '../resurrection';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { vcupBothSeated } from '../social/vale_cup';
import { addThreat, clearThreat } from '../threat';
import type { Entity } from '../types';
import {
  berserkerCritDamage,
  DIE_BY_SWORD_CUT,
  DIE_BY_SWORD_LOW_CUT,
  DIE_BY_SWORD_LOW_HP,
  dist2d,
  FISHING_CAST_ID,
  isConsuming,
  MAX_LEVEL,
  MILESTONES,
  mobXpValue,
  NYTHRAXIS_BOSS_ID,
  PARTY_XP_RANGE,
  rageFromDealing,
  rageFromDealingClassic,
  rageFromTaking,
  rageFromTakingClassic,
  rageGenAuraMult,
  STANCE_MASTERY_BATTLE_CRIT_DMG,
  STANCE_MASTERY_GUARDED_CUT,
  STANCE_MASTERY_GUARDED_HP_PCT,
  VICTORY_RUSH_WINDOW,
  virtualLevel,
  xpForLevel,
} from '../types';
import { WORLD_BOSS_CORPSE_SECONDS, worldBossLootContributors } from '../world_boss';
import { onDamageTaken, onShieldConsumed, onSpellCrit, resetProcState } from './talent_procs';

// Choice-row on-kill talent tuning (owner design draft: Pursuit +30% speed for
// 6s; Bloodbath +5% crit and damage per stack, 8s, capped at 5 stacks).
const PURSUIT_SPEED_DURATION = 6;
const BLOODBATH_DURATION = 8;
const BLOODBATH_MAX_STACKS = 5;

// How long a slain mob's corpse persists (seconds) before it is cleared. Sole user
// is handleDeath, so the constant lives here with the death-domain code.
const CORPSE_DURATION = 60;
// Self attack-speed buff a wounded frenzyOnHit mob gains; sole user maybeFrenzyOnHit.
const BLOOD_FRENZY_AURA_ID = 'blood_frenzy';
const PURSUIT_AURA_ID = 'war_pursuit_speed';
const BLOODBATH_AURA_ID = 'war_bloodbath';

// A handful of casts ignore classic-era spell pushback: ghost_wolf, plus any
// def flagged `uninterruptible` (Bladestorm: the channel must run its full
// listed duration even while being hit). Sole user is the dealDamage pushback
// branch, so the predicate lives here with it.
function ignoresDamagePushback(abilityId: string): boolean {
  return abilityId === 'ghost_wolf' || ABILITIES[abilityId]?.uninterruptible === true;
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
  // Stable content id for talent-proc filters. `ability` above remains the
  // player-facing combat-log label and must never be used as an id.
  abilityId: string | null = null,
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
  // [dev] A god-mode player (/dev god) hits for 100x so a solo tester can chew
  // through raid bosses to inspect drops without one-shotting them past their phase
  // transitions. Gated on devCommands so it can NEVER apply in production (where gm
  // marks real, non-fighting game masters). Draws no rng.
  if (source?.devGod && source.kind === 'player' && ctx.devCommands)
    amount = Math.round(amount * 100);

  // Master Armorer (Arms mastery): extra physical damage you deal WHILE wielding a
  // two-handed weapon. The magnitude lives on the mastery's talent effect
  // (global.masteryTwoHandDmgPct, so the tooltip is effect-backed), but is applied
  // ONLY here so it keys off the LIVE equipped mainhand (equip-time state the
  // precomputed talent mods cannot see) and never folds into the generic
  // meleeDmgPct path. Short-circuits when the bonus is 0, so every non-arms spec's
  // damage is byte-identical.
  if (source && source.kind === 'player' && school === 'physical' && source.id !== target.id) {
    const srcMeta = ctx.players.get(source.id);
    const twoHandPct = srcMeta ? ctx.playerMods(srcMeta).global.masteryTwoHandDmgPct : 0;
    const mh = srcMeta?.equipment.mainhand ? ITEMS[srcMeta.equipment.mainhand] : undefined;
    if (twoHandPct > 0 && mh?.kind === 'weapon' && weaponHand(mh) === 'twohand') {
      amount = Math.round(amount * (1 + twoHandPct));
    }
  }

  // Defensive Stance, classic: deal 10% less, take 10% less (and +30% threat below)
  if (
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

  // Breachmaker: a SOURCE-SCOPED vulnerability. Unlike the raid-wide
  // 'vulnerability' above, only the attacker whose id matches the aura's
  // sourceId sees the amplification, so the debuff sharpens the caster's own
  // hits without buffing every other attacker on the target. Sums additively
  // across the caster's own vuln_source auras.
  if (source && amount > 0) {
    let vs = 0;
    for (const a of target.auras)
      if (a.kind === 'vuln_source' && a.sourceId === source.id) vs += a.value;
    if (vs > 0) amount = Math.round(amount * (1 + vs));
  }

  // Weakening Hex: a hexed source deals less damage (mirrors the healing cut in
  // applyHeal). Self-damage paths (source === target) are left untouched.
  if (source && source.id !== target.id) {
    const hexMult = ctx.hexOutputMult(source);
    if (hexMult !== 1) amount = Math.round(amount * hexMult);
  }

  // Damage-done buffs AND debuffs: an additive amp on the source's outgoing
  // damage, summed across auras. Positive values are the choice-row cooldowns
  // (Avatar / Bloodbath / Sanguine Aura / Battle Rhythm's blink; a bloodbath
  // aura's value already carries its stack total); a NEGATIVE buff_dmg_done is
  // a demoralize (Direhowl's pct form) cutting what the victim deals. The sum
  // is floored at a zero multiplier so stacked demoralizes can never heal.
  // Self-damage is untouched, mirroring the hex rule above.
  if (source && source.id !== target.id && amount > 0) {
    let dmgAmp = 0;
    for (const a of source.auras) {
      if (
        a.kind === 'buff_dmg_done' ||
        a.kind === 'bloodbath' ||
        a.kind === 'buff_avatar' ||
        a.kind === 'enrage' // Fury Enrage's +11% outgoing (value = ENRAGE_DMG_DONE)
      )
        dmgAmp += a.value;
      // Sanguine Aura's damage half rides value2 (value is its swing mult).
      if (a.kind === 'sanguine') dmgAmp += a.value2 ?? 0;
    }
    if (dmgAmp !== 0) amount = Math.round(amount * Math.max(0, 1 + dmgAmp));
  }

  // Die by the Sword (choice-row defensive cooldown): the wearer takes 10% less
  // damage, doubled to a 20% cut while below 30% health. A single self aura,
  // never stacked, checked target-side beside the Defensive Stance cut above.
  if (source && source.id !== target.id && amount > 0) {
    if (target.auras.some((a) => a.kind === 'die_by_sword')) {
      const cut =
        target.hp < target.maxHp * DIE_BY_SWORD_LOW_HP ? DIE_BY_SWORD_LOW_CUT : DIE_BY_SWORD_CUT;
      amount = Math.round(amount * cut);
    }
  }

  // Parameterized damage-reduction buffs (buff_dr): the wearer takes `value`
  // fraction less damage from any EXTERNAL source (Furious Mending's 20% cut).
  // Summed across auras and floored at a zero multiplier, checked target-side
  // beside the Die by the Sword cut above; self-damage is untouched.
  if (source && source.id !== target.id && amount > 0) {
    let drCut = 0;
    for (const a of target.auras) if (a.kind === 'buff_dr') drCut += a.value;
    if (drCut > 0) amount = Math.round(amount * Math.max(0, 1 - drCut));
  }

  // Physical-only damage-reduction buffs (buff_dr_phys): Raised Guard's 50%
  // cut applies only when the incoming school is physical; every other school
  // passes untouched. Same fold shape as buff_dr above (summed, floored at a
  // zero multiplier, external sources only), gated on the damage school.
  if (source && source.id !== target.id && amount > 0 && school === 'physical') {
    let physCut = 0;
    for (const a of target.auras) if (a.kind === 'buff_dr_phys') physCut += a.value;
    if (physCut > 0) amount = Math.round(amount * Math.max(0, 1 - physCut));
  }

  // "Find Weakness": a critvuln debuff makes the target's exposed flesh take
  // extra damage from CRITICAL hits only (any attacker, any school). Applied
  // after the defensive-stance reduction, before absorb shields soak it.
  if (crit && amount > 0 && source && source.id !== target.id) {
    const bonus = ctx.critVulnBonus(target);
    if (bonus > 0) amount = Math.round(amount * (1 + bonus));
  }

  const sourcePlayer = ctx.pvpController(source);

  // The Vale Cup: nobody bleeds at the Sowfield. Any damage between two seated
  // cup fighters is floored to 0 BEFORE absorb shields soak it, belt and
  // braces: the sport kit has no damage abilities, but a stray consumable,
  // proc, or reflect must neither hurt a fighter nor eat their shield.
  if (amount > 0 && sourcePlayer && target.kind === 'player') {
    const cupMatch = ctx.vcup.match;
    if (cupMatch && vcupBothSeated(cupMatch, sourcePlayer.id, target.id)) amount = 0;
  }

  // Berserker Stance (Fury): the source's critical hits deal an extra fraction.
  // Its crit-CHANCE half lives in recalcPlayerStats; this is the crit-DAMAGE half.
  if (crit && amount > 0 && source && source.id !== target.id) {
    const cd = berserkerCritDamage(source);
    if (cd > 0) amount = Math.round(amount * (1 + cd));
  }

  // Combat Mastery (choice-row talent), Battle Stance arm: the source's ABILITY
  // criticals deal an extra fraction while in Battle Stance. Gated on a named
  // ability so plain auto swings (ability null) never benefit. Draws no rng.
  if (
    crit &&
    amount > 0 &&
    ability !== null &&
    source &&
    source.id !== target.id &&
    source.auras.some((a) => a.kind === 'battle_stance')
  ) {
    const srcMeta = ctx.players.get(source.id);
    if (srcMeta && ctx.playerMods(srcMeta).global.stanceMastery > 0) {
      amount = Math.round(amount * (1 + STANCE_MASTERY_BATTLE_CRIT_DMG));
    }
  }

  // Combat Mastery, Guarded Stance arm: a heavy blow, one that would take at
  // least STANCE_MASTERY_GUARDED_HP_PCT of the wearer's maximum health BEFORE
  // this cut, deals STANCE_MASTERY_GUARDED_CUT less damage. Checked target-side
  // after every other amp and reduction (so the threshold reads the damage that
  // would actually land), before absorb shields soak. Draws no rng.
  if (
    source &&
    source.id !== target.id &&
    amount >= target.maxHp * STANCE_MASTERY_GUARDED_HP_PCT &&
    target.auras.some((a) => a.kind === 'defensive_stance')
  ) {
    const tgtMeta = ctx.players.get(target.id);
    if (tgtMeta && ctx.playerMods(tgtMeta).global.stanceMastery > 0) {
      amount = Math.round(amount * (1 - STANCE_MASTERY_GUARDED_CUT));
    }
  }

  // absorb shields soak damage first
  let totalAbsorbed = 0;
  if (amount > 0) {
    for (let i = target.auras.length - 1; i >= 0 && amount > 0; i--) {
      const a = target.auras[i];
      if (a.kind !== 'absorb') continue;
      const soaked = Math.min(a.value, amount);
      a.value -= soaked;
      amount -= soaked;
      totalAbsorbed += soaked;
      if (a.value <= 0) {
        target.auras.splice(i, 1);
        ctx.emit({ type: 'aura', targetId: target.id, name: a.name, gained: false });
        // Talent procs listening for a fully consumed shield (deterministic).
        const shielder = ctx.entities.get(a.sourceId);
        if (shielder && !shielder.dead && shielder.kind === 'player')
          onShieldConsumed(ctx, shielder, a.id, target);
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
        );
      }
    }
  }

  // duels end at 1 hp, nobody dies
  const duel = target.kind === 'player' ? ctx.duels.get(target.id) : undefined;
  if (
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
        absorbed: totalAbsorbed || undefined,
      });
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
        absorbed: totalAbsorbed || undefined,
      });
      ctx.fiestaTakedown(match, sourcePlayer.id, target);
      return;
    }
  }

  // Protect Yumi downs bench the victim on a flat respawn timer, like Fiesta:
  // never the permanent ranked elimination below. MUST stay above that arm.
  if (
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
      });
      ctx.yumiPlayerDown(match, target, sourcePlayer.id);
      return;
    }
  }

  // Ranked arena eliminations use normal death state so clients and combat
  // logic see a real 0 HP defeat. The return timer revives everyone after.
  if (
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
        absorbed: totalAbsorbed || undefined,
      });
      handleDeath(ctx, target, source);
      const loserTeam = ctx.arenaTeamOf(match, target.id);
      if (loserTeam && ctx.isArenaTeamWiped(match, loserTeam)) {
        ctx.endArenaMatch(match, loserTeam === 'A' ? 'B' : 'A', 'defeat');
      }
      return;
    }
  }

  // Cheat death (talent global): a killing blow leaves the player at 1 hp
  // instead, gated by a long internal cooldown on procState. No rng.
  if (target.kind === 'player' && amount >= target.hp && !target.dead) {
    const meta = ctx.players.get(target.id);
    const icd = meta ? ctx.playerMods(meta).global.cheatDeathIcd : 0;
    if (icd > 0) {
      if (!target.procState) target.procState = { counters: {}, icds: {} };
      if (target.procState.icds.cheat_death === undefined) {
        target.procState.icds.cheat_death = icd;
        amount = Math.max(0, target.hp - 1);
        // The save is a MOMENT: a golden ward bloom on the survivor.
        ctx.emit({
          type: 'spellfx',
          sourceId: target.id,
          targetId: target.id,
          school: 'holy',
          fx: 'wardBloom',
        });
        ctx.emit({
          type: 'log',
          pid: target.id,
          text: 'A deathward saves you!',
          color: '#ffd100',
        });
      }
    }
  }
  // A Protect Yumi cat: the yumi module owns the clamp, the sudden-death
  // taken-multiplier, tiebreak bookkeeping, and win detection. Amps and
  // absorb shields already resolved above, so a shielded cat soaks first.
  if (target.kind === 'mob') {
    const ymatch = ctx.yumiCatMatches.get(target.id);
    if (ymatch) {
      ctx.yumiCatDamaged(ymatch, source, target, amount, crit, school, ability, kind);
      return;
    }
  }

  target.hp = Math.max(0, target.hp - amount);
  ctx.emit({
    type: 'damage',
    sourceId: source?.id ?? -1,
    targetId: target.id,
    amount,
    crit,
    school,
    ability,
    kind,
    absorbed: totalAbsorbed || undefined,
  });

  if (amount > 0) {
    if (target.kind === 'mob' && DAMAGE_IDLE_DESPAWN_MOB_IDS.has(target.templateId)) {
      target.damageIdleDespawnTimer = DAMAGE_IDLE_DESPAWN_SECONDS;
    }
    for (let i = target.auras.length - 1; i >= 0; i--) {
      const breakable = target.auras[i];
      if (breakable.breaksOnDamage) {
        // Lingering Dread: a thresholded fear soaks damage before breaking.
        if (breakable.breakThreshold !== undefined && breakable.breakThreshold > amount) {
          breakable.breakThreshold -= amount;
          continue;
        }
        ctx.emit({
          type: 'aura',
          targetId: target.id,
          name: breakable.name,
          gained: false,
        });
        target.auras.splice(i, 1);
      }
    }
  }

  // A heal echo (talent proc watcher) fires when its carrier drops below the
  // stored health fraction: consume the aura and deliver the stored heal.
  if (amount > 0 && !target.dead && target.maxHp > 0) {
    for (let i = target.auras.length - 1; i >= 0; i--) {
      const a = target.auras[i];
      if (a.kind !== 'heal_echo') continue;
      if (target.hp >= target.maxHp * (a.value2 ?? 0)) continue;
      target.auras.splice(i, 1);
      ctx.emit({ type: 'aura', targetId: target.id, name: a.name, gained: false });
      const healer = ctx.entities.get(a.sourceId);
      if (healer && !healer.dead) {
        ctx.applyHeal(healer, target, a.value, a.name);
        ctx.emit({
          type: 'spellfx',
          sourceId: a.sourceId,
          targetId: target.id,
          school: a.school,
          fx: 'echoBurst',
        });
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

  // tap rights: the first player (or their pet) to damage a mob owns it
  if (
    source &&
    target.kind === 'mob' &&
    target.hostile &&
    target.tappedById === null &&
    amount > 0
  ) {
    if (source.kind === 'player') target.tappedById = source.id;
    else if (source.ownerId !== null) target.tappedById = source.ownerId;
  }

  // World-boss loot roster: every player (or pet owner) who lands a hit on a world
  // boss becomes a permanent loot contributor. Unlike the hate table above, this set
  // is NEVER pruned when they die, release their spirit, or drop off threat, so a
  // raider who died to the boss still gets their personal drop. Read at death by
  // worldBossLootContributors. Only world-boss templates ever populate it.
  if (source && amount > 0 && MOBS[target.templateId]?.worldBoss) {
    const contributorId = source.kind === 'player' ? source.id : source.ownerId;
    if (contributorId !== null) target.bossDamagers.add(contributorId);
  }

  if (source && source.kind === 'player' && source.id !== target.id) {
    const meta = ctx.players.get(source.id);
    if (meta) meta.counters.damageDealt += amount;
    // Talent procs listening for spell crits (deterministic, no rng draw).
    if (crit && school !== 'physical' && ability) onSpellCrit(ctx, source, abilityId, target);
    if (source.resourceType === 'rage' && !noRage && school === 'physical' && !ability) {
      // Auto-attack rage, scaled by the choice-row talent multiplier (Anger
      // Management's autoRagePct) and the aura-driven bonus (Recklessness).
      // Both are exactly 1 for everyone else, leaving the classic mint.
      // Seasoned Soldier (Arms passive): a CRIT auto mints 10% more rage. Gated on
      // the passive being known AND committed arms, so every non-arms mint is
      // byte-identical (mirrors Measured Fury's cost hook).
      const seasonedCrit =
        crit &&
        meta &&
        ctx.playerMods(meta).spec === 'arms' &&
        meta.known.some((k) => k.def.passive && k.def.id === 'seasoned_soldier')
          ? 1.1
          : 1;
      const autoMult =
        (1 + (meta ? ctx.playerMods(meta).global.autoRagePct : 0)) *
        rageGenAuraMult(source) *
        seasonedCrit;
      source.resource = Math.min(
        source.maxResource,
        source.resource +
          (meta?.cls === 'warrior_classic'
            ? rageFromDealingClassic(amount, source.level)
            : rageFromDealing(amount, source.level)) *
            autoMult,
      );
    }
  }
  if (target.kind === 'player') {
    const meta = ctx.players.get(target.id);
    if (meta) meta.counters.damageTaken += amount;
    // Talent procs listening for big single hits (deterministic, ICD-gated).
    if (amount > 0 && !target.dead) onDamageTaken(ctx, target, amount);
    if (target.resourceType === 'rage' && source && source.id !== target.id) {
      // Rage from taking damage honors the aura-driven bonus only (Recklessness
      // enrages ALL rage generation); the talent-static globals do not apply here.
      target.resource = Math.min(
        target.maxResource,
        target.resource +
          (ctx.resolve(target.id)?.meta.cls === 'warrior_classic'
            ? rageFromTakingClassic(amount, source.level)
            : rageFromTaking(amount, source.level)) *
            rageGenAuraMult(target),
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
  resetProcState(e);
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
    e.autoAttack = false;
    e.queuedOnSwing = null;
    delete e.queuedOnSwingFree;
    delete e.queuedOnSwingCostMultiplier;
    e.queuedCastAbility = null;
    e.queuedCastAim = null;
    e.comboPoints = 0;
    e.eating = null;
    e.drinking = null;
    e.sitting = false;
    e.chargeTargetId = null;
    e.chargePath = [];
    e.leap = null;
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
    if (e.templateId === NYTHRAXIS_BOSS_ID) ctx.grantNythraxisLockout(e);
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

    // credit goes to the tapping player (fall back to the killer)
    const creditId = e.tappedById ?? (killer?.kind === 'player' ? killer.id : null);
    const meta = creditId !== null ? ctx.players.get(creditId) : null;
    const creditEntity = creditId !== null ? ctx.entities.get(creditId) : null;
    if (meta && creditEntity) {
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
          if (mMeta && mE && dist2d(mE.pos, e.pos) <= PARTY_XP_RANGE) eligible.push(mMeta);
        }
      }
      if (eligible.length === 0) eligible.push(meta);
      e.lootRecipientIds = eligible.map((member) => member.entityId);
      const bonus = GROUP_XP_BONUS[Math.min(eligible.length, GROUP_XP_BONUS.length) - 1];

      meta.counters.kills++;
      if (creditEntity.targetId === e.id) creditEntity.autoAttack = false;
      // Choice-row on-kill talents for the credited player (draws no rng):
      // Pursuit's speed burst and Bloodbath's stacking crit + damage buff.
      if (!creditEntity.dead) {
        const killMods = ctx.playerMods(meta).global;
        if (killMods.onKillSpeedPct > 0) {
          ctx.applyAura(creditEntity, {
            id: 'pursuit',
            name: 'Pursuit',
            kind: 'buff_speed',
            value: 1 + killMods.onKillSpeedPct,
            remaining: PURSUIT_SPEED_DURATION,
            duration: PURSUIT_SPEED_DURATION,
            sourceId: creditEntity.id,
            school: 'physical',
          });
        }
        if (killMods.bloodbathPct > 0) {
          const existing = creditEntity.auras.find((a) => a.kind === 'bloodbath');
          if (existing) {
            existing.stacks = Math.min(BLOODBATH_MAX_STACKS, (existing.stacks ?? 1) + 1);
            existing.value = killMods.bloodbathPct * existing.stacks;
            existing.remaining = BLOODBATH_DURATION;
            existing.duration = BLOODBATH_DURATION;
          } else {
            ctx.applyAura(creditEntity, {
              id: 'bloodbath',
              name: 'Bloodbath',
              kind: 'bloodbath',
              value: killMods.bloodbathPct,
              remaining: BLOODBATH_DURATION,
              duration: BLOODBATH_DURATION,
              sourceId: creditEntity.id,
              school: 'physical',
              stacks: 1,
            });
          }
          // handleDeath sits outside runEffects, so nothing recalcs for us: fold
          // the new crit into the derived stats here (the expiry pass already
          // re-runs recalc when the aura fades, bloodbath being a buff* kind...
          // it is NOT: 'bloodbath' does not start with 'buff', so the expiry
          // pass must know it. See the expiry arm in combat/auras.ts.
          recalcPlayerStats(
            creditEntity,
            meta.cls,
            meta.equipment,
            ctx.playerMods(meta),
            meta.equipmentInstance,
          );
        }
        // Victory Rush (choice row): a credited kill opens the window in which
        // the granted strike is usable. A normal self aura (rides the aura
        // wire and the buff frame; the strike requires and consumes it).
        if (ctx.playerMods(meta).grants.some((g) => g.ability === 'victory_rush')) {
          ctx.applyAura(creditEntity, {
            id: 'victory_rush',
            name: 'Victory Rush',
            kind: 'victory_rush',
            value: 0,
            remaining: VICTORY_RUSH_WINDOW,
            duration: VICTORY_RUSH_WINDOW,
            sourceId: creditEntity.id,
            school: 'physical',
          });
        }
      }
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
      // hate-table snapshot), not the tapper/party shared-corpse roll.
      if (!template?.worldBoss) ctx.rollLoot(e, meta, eligible);
      // A heroic final boss additionally carries one personal Heroic Mark per
      // eligible participant (no-op outside a heroic instance; draws no rng).
      ctx.awardHeroicMarks(e, eligible);
    }
    // Personal loot is independent of tap/party kill credit: it goes to everyone who
    // damaged the boss, so it rolls outside the credited-player block above.
    if (worldBossContribs) ctx.rollWorldBossLoot(e, worldBossContribs);
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
    // computeModifiersWithRows also folds the choice-row picks, so those bonuses survive.
    meta.talentMods = computeModifiersWithRows(meta.cls, meta.talents, meta.rowPicks, p.level);
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
// events past the cap and unlocking any newly crossed milestones. Cheap: one
// add plus an O(log n) table lookup, never touched on the per-tick hot path.
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
  checkMilestones(ctx, meta, p);
}

// Unlock any cosmetic milestone whose lifetime-XP threshold was just crossed.
function checkMilestones(ctx: SimContext, meta: PlayerMeta, p: Entity): void {
  for (const m of MILESTONES) {
    if (meta.lifetimeXp >= m.lifetimeXp && !meta.unlockedMilestones.has(m.id)) {
      meta.unlockedMilestones.add(m.id);
      ctx.emit({ type: 'milestoneUnlocked', milestoneId: m.id, pid: p.id });
    }
  }
}
