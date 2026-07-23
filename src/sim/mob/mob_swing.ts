// Mob on-hit affix cascade (M3), extracted from the Sim monolith.
//
// This module owns the long tail of per-template on-hit procs that fire AFTER a
// mob's base hit-table roll and base weapon damage land in `Sim.mobSwing`. The base
// miss/dodge roll and the base weapon-damage calc STAY inline on Sim; only this
// affix subsystem moved out. `runMobSwingAffixes` is invoked from inside the base
// `mobSwing` shell with the base hit result (dealt/crit/rawDmg) it consumes; it does
// not recompute damage or re-roll crit (doing so would inject phantom rng draws).
//
// Move-not-rewrite: every statement, branch, guard, and rng draw is byte-identical
// to the pre-extraction cascade, in the same order. The ~42 fixed-order
// `ctx.rng.chance(...)` proc rolls fire at the same global stream positions, and the
// `mob.hostile` / `target.kind === 'player'` guards short-circuit BEFORE their proc's
// rng draw, so a friendly pet or delve companion (mobSwing's other callers) swinging
// through here draws no cascade rng and applies no debuff to its owner's party.
// In-place mutation is preserved (the immutability waiver).
//
// `src/sim`-pure: no DOM/Three/Math.random; it reaches Sim only through SimContext
// (applyAura/dealDamage/effectiveArmor/recalcPlayer + the rng/emit/players/entities
// primitives), all of which still resolve on Sim.

import { isDisarmed } from '../combat/cc';
import { applyThornsReaction } from '../combat/thorns_charge';
import { MOBS } from '../data';
import * as deedsMod from '../deeds';
import type { SimContext } from '../sim_context';
import { type Aura, armorReduction, dist2d, type Entity, type MobTemplate } from '../types';

// A "Devour Magic"-strippable beneficial enhancement: a positive buff_* stat
// buff, a heal-over-time, an absorb shield, or a weapon imbue. Stances, forms,
// stealth, righteous fury, thorns and every debuff (incl. negative buff_* drains
// like enfeeble/wither) are deliberately left alone — only an active "magic"
// enhancement is eaten. Mirrors the inverse of the HUD's debuff test.
function isDevourableAura(a: Aura): boolean {
  return (
    (a.kind.startsWith('buff_') && a.value > 0) ||
    a.kind === 'hot' ||
    a.kind === 'absorb' ||
    a.kind === 'imbue' ||
    // Lifesap's regen surge is a rich beneficial aura: purgeable counterplay
    // (the adversarial finding that it had none).
    a.kind === 'resource_sap'
  );
}

// Run the mob on-hit affix cascade after the base hit-table roll + base weapon
// damage resolved in the `mobSwing` shell on Sim. `dealt`/`crit`/`rawDmg` are the
// base hit result the cascade consumes (lifesteal heal basis, cleave splash basis,
// cleave crit flag); they are passed in, never recomputed here.
export function runMobSwingAffixes(
  ctx: SimContext,
  mob: Entity,
  target: Entity,
  { dealt, crit, rawDmg }: { dealt: number; crit: boolean; rawDmg: number },
): void {
  // Lifesteal: a landed swing heals the mob for a fraction of the damage it
  // just dealt. Hostile mobs only, so a friendly pet (mobSwing's other caller)
  // never drains for its owner; skip if the mob is already topped off or died
  // to the defender's thorns/reflect earlier this swing.
  const leech = MOBS[mob.templateId]?.lifeleech;
  if (
    leech &&
    mob.hostile &&
    !mob.dead &&
    mob.hp < mob.maxHp &&
    ctx.rng.chance(leech.chance ?? 1)
  ) {
    const heal = Math.min(mob.maxHp - mob.hp, Math.max(1, Math.round(dealt * leech.healFrac)));
    if (heal > 0) {
      mob.hp += heal;
      ctx.emit({ type: 'heal', targetId: mob.id, amount: heal });
    }
  }
  // Battle Fury (Rampage): a landed swing whips this attacker into an escalating
  // frenzy — a self-applied, stacking buff_ap aura (up to `maxStacks`) that grows
  // its attack power, and thus its melee damage, the longer the fight drags on.
  // Rides the existing buff_ap aura that effectiveAttackPower already folds into
  // mob swing damage, so there is no new combat math. Hostile mobs only, so a
  // friendly pet (mobSwing's other caller) never self-buffs off the party's kills;
  // skip if the mob died to the defender's thorns/reflect earlier this swing. The
  // single shared aura slot is bumped and refreshed each hit; left alone it falls
  // off after `duration`s, so burning the mob down or kiting it out of melee both
  // reset the ramp.
  const rampage = MOBS[mob.templateId]?.rampage;
  if (rampage && mob.hostile && !mob.dead) {
    const existing = mob.auras.find(
      (a) => a.id === `rampage_${mob.templateId}` && a.sourceId === mob.id,
    );
    const stacks = Math.min(rampage.maxStacks, (existing?.stacks ?? 0) + 1);
    ctx.applyAura(mob, {
      id: `rampage_${mob.templateId}`,
      name: rampage.name,
      kind: 'buff_ap',
      remaining: rampage.duration,
      duration: rampage.duration,
      value: rampage.ap * stacks,
      stacks,
      sourceId: mob.id,
      school: rampage.school ?? 'physical',
    });
  }
  // Cleave: the swing splashes onto other players standing near the primary
  // target, each taking the hit reduced by their own armor. Hostile mobs only,
  // so a friendly pet swinging through mobSwing never cleaves its owner's party.
  const cleave = MOBS[mob.templateId]?.cleave;
  if (cleave && mob.hostile && !mob.dead) {
    for (const meta of ctx.players.values()) {
      const pe = ctx.entities.get(meta.entityId);
      if (!pe || pe.dead || pe.id === target.id) continue;
      if (dist2d(pe.pos, target.pos) > cleave.radius) continue;
      let sd = rawDmg * cleave.mult;
      sd *= 1 - armorReduction(ctx.effectiveArmor(pe), mob.level);
      ctx.dealDamage(
        mob,
        pe,
        Math.max(1, Math.round(sd)),
        crit,
        'physical',
        cleave.name ?? 'Cleave',
        'hit',
        true,
      );
      // No-ops unless the mob is a tracked splash carrier, so the generic
      // cleave path stays cheap.
      deedsMod.onBossSplashHitForDeeds(ctx, mob);
    }
  }
  // venom: a landed swing may inflict a refreshing poison DoT (hostile mobs only,
  // never a friendly pet — mobSwing is also the pet attack path).
  const venom = MOBS[mob.templateId]?.venom;
  if (venom && mob.hostile && !target.dead && ctx.rng.chance(venom.chance)) {
    ctx.applyAura(target, {
      id: `venom_${mob.templateId}`,
      name: venom.name,
      kind: 'dot',
      remaining: venom.duration,
      duration: venom.duration,
      value: Math.max(1, Math.round(venom.perTick)),
      tickInterval: venom.interval,
      tickTimer: venom.interval,
      sourceId: mob.id,
      school: (venom.school as Aura['school']) ?? 'nature',
    });
  }
  // soulrot ("Soulrot"): a landed swing may fester a refreshing SHADOW DoT.
  // Same on-hit DoT seam as venom, but shadow-school — the undead/necrotic
  // flavour. Hostile mobs only (mobSwing is also the pet attack path, so a
  // friendly pet must never rot the party).
  const soulrot = MOBS[mob.templateId]?.soulrot;
  if (soulrot && mob.hostile && !target.dead && ctx.rng.chance(soulrot.chance)) {
    ctx.applyAura(target, {
      id: `soulrot_${mob.templateId}`,
      name: soulrot.name,
      kind: 'dot',
      remaining: soulrot.duration,
      duration: soulrot.duration,
      value: Math.max(1, Math.round(soulrot.perTick)),
      tickInterval: soulrot.interval,
      tickTimer: soulrot.interval,
      sourceId: mob.id,
      school: (soulrot.school as Aura['school']) ?? 'shadow',
    });
  }
  // bleed ("Rend"): a landed swing may open a refreshing PHYSICAL DoT wound.
  // Same on-hit DoT seam as venom, but physical-school — the predator/beast
  // flavour (raking claws, gore). Hostile mobs only (mobSwing is also the pet
  // attack path, so a friendly pet must never bleed the party).
  const bleed = MOBS[mob.templateId]?.bleed;
  if (bleed && mob.hostile && !target.dead && ctx.rng.chance(bleed.chance)) {
    ctx.applyAura(target, {
      id: `bleed_${mob.templateId}`,
      name: bleed.name,
      kind: 'dot',
      remaining: bleed.duration,
      duration: bleed.duration,
      value: Math.max(1, Math.round(bleed.perTick)),
      tickInterval: bleed.interval,
      tickTimer: bleed.interval,
      sourceId: mob.id,
      school: (bleed.school as Aura['school']) ?? 'physical',
    });
  }

  // frostbite: a landed swing may sear the victim with a refreshing frost DoT
  // (the frost twin of venom — chilling elementals). Hostile mobs only, never a
  // friendly pet (mobSwing is also the pet attack path).
  const frostbite = MOBS[mob.templateId]?.frostbite;
  if (frostbite && mob.hostile && !target.dead && ctx.rng.chance(frostbite.chance)) {
    ctx.applyAura(target, {
      id: `frostbite_${mob.templateId}`,
      name: frostbite.name,
      kind: 'dot',
      remaining: frostbite.duration,
      duration: frostbite.duration,
      value: Math.max(1, Math.round(frostbite.perTick)),
      tickInterval: frostbite.interval,
      tickTimer: frostbite.interval,
      sourceId: mob.id,
      school: (frostbite.school as Aura['school']) ?? 'frost',
    });
  }

  // smoldering fuse: a landed swing may ignite a refreshing fire DoT — the
  // fire-school sibling of venom (same guards: hostile mobs only, never a pet).
  const smolder = MOBS[mob.templateId]?.smolder;
  if (smolder && mob.hostile && !target.dead && ctx.rng.chance(smolder.chance)) {
    ctx.applyAura(target, {
      id: `smolder_${mob.templateId}`,
      name: smolder.name,
      kind: 'dot',
      remaining: smolder.duration,
      duration: smolder.duration,
      value: Math.max(1, Math.round(smolder.perTick)),
      tickInterval: smolder.interval,
      tickTimer: smolder.interval,
      sourceId: mob.id,
      school: (smolder.school as Aura['school']) ?? 'fire',
    });
  }

  // cinder: the fire-school twin of venom — a landed swing may set a refreshing
  // burning DoT (hostile mobs only, never a friendly pet — mobSwing is also the
  // pet attack path). Reuses the same dot aura seam; school defaults 'fire'.
  const cinder = MOBS[mob.templateId]?.cinder;
  if (cinder && mob.hostile && !target.dead && ctx.rng.chance(cinder.chance)) {
    ctx.applyAura(target, {
      id: `cinder_${mob.templateId}`,
      name: cinder.name,
      kind: 'dot',
      remaining: cinder.duration,
      duration: cinder.duration,
      value: Math.max(1, Math.round(cinder.perTick)),
      tickInterval: cinder.interval,
      tickTimer: cinder.interval,
      sourceId: mob.id,
      school: (cinder.school as Aura['school']) ?? 'fire',
    });
  }
  // arcane rot: a landed swing may brand the victim with a searing arcane rune
  // that festers as a refreshing DoT. The arcane-school twin of venom; reuses
  // the `dot` aura. Guarded on hostile + alive so a friendly pet (the other
  // mobSwing caller) never debuffs an ally.
  const arcaneRot = MOBS[mob.templateId]?.arcaneRot;
  if (arcaneRot && mob.hostile && !target.dead && ctx.rng.chance(arcaneRot.chance)) {
    ctx.applyAura(target, {
      id: `arcaneRot_${mob.templateId}`,
      name: arcaneRot.name,
      kind: 'dot',
      remaining: arcaneRot.duration,
      duration: arcaneRot.duration,
      value: Math.max(1, Math.round(arcaneRot.perTick)),
      tickInterval: arcaneRot.interval,
      tickTimer: arcaneRot.interval,
      sourceId: mob.id,
      school: (arcaneRot.school as Aura['school']) ?? 'arcane',
    });
  }

  // deadly poison: a landed swing may apply (or add a stack to) a ramping DoT.
  // Guarded on hostile so a friendly pet (the other mobSwing caller) never
  // poisons an ally. Per-tick damage scales with the stack count.
  const stackPoison = MOBS[mob.templateId]?.stackPoison;
  if (stackPoison && mob.hostile && !target.dead && ctx.rng.chance(stackPoison.chance)) {
    applyStackPoison(ctx, mob, target, stackPoison);
  }
  // corrosive bite: a landed hit may shred the victim's armor (stacking sunder).
  // Guarded on hostile so a friendly pet (the other mobSwing caller) never debuffs an ally.
  const corrode = MOBS[mob.templateId]?.corrode;
  if (corrode && mob.hostile && !target.dead && ctx.rng.chance(corrode.chance)) {
    applyCorrosion(ctx, mob, target, corrode);
  }
  // silencing shriek: anti-caster mobs can lock the victim's spells on a hit.
  // Guard on hostile + alive so a friendly pet (the other mobSwing caller)
  // never silences the party. updateCasting interrupts any live spell next tick.
  const silence = MOBS[mob.templateId]?.silence;
  if (silence && mob.hostile && !target.dead && ctx.rng.chance(silence.chance)) {
    ctx.applyAura(target, {
      id: `silence_${mob.templateId}`,
      name: silence.name,
      kind: 'silence',
      remaining: silence.duration,
      duration: silence.duration,
      value: 0,
      sourceId: mob.id,
      school: (silence.school ?? 'shadow') as Aura['school'],
    });
  }
  // blinding powder: a thrown handful of grit can leave the victim's own
  // weapon swings whiffing. Guarded on hostile + alive so a friendly pet
  // (mobSwing's other caller) never blinds the party. Carries the added miss
  // chance in the aura value, read back in melee/ranged swings via blindMissBonus.
  const blind = MOBS[mob.templateId]?.blind;
  if (blind && mob.hostile && !target.dead && ctx.rng.chance(blind.chance)) {
    ctx.applyAura(target, {
      id: `blind_${mob.templateId}`,
      name: blind.name,
      kind: 'blind',
      remaining: blind.duration,
      duration: blind.duration,
      value: blind.miss,
      sourceId: mob.id,
      school: (blind.school ?? 'physical') as Aura['school'],
    });
  }
  // disarm: a brutal swing can knock the weapon from a player's grip, suppressing
  // their auto-attack for a duration. Players only (only they run the primary-target
  // auto-attack path) and hostile only, so a friendly pet (mobSwing's other caller)
  // never disarms the party. Never stacks, and never refreshes while already active:
  // a landed hit is only able to seed a FRESH disarm window, so a run of procs (one
  // brute swinging faster than its own duration, or several in the same pack each
  // rolling their own chance) cannot chain-extend the lockout past its stated
  // duration. The already-disarmed check sits AFTER the rng roll so a swing at an
  // already-disarmed target still draws its proc roll, keeping every downstream draw
  // at its documented stream position.
  const disarm = MOBS[mob.templateId]?.disarm;
  if (
    disarm &&
    mob.hostile &&
    target.kind === 'player' &&
    !target.dead &&
    ctx.rng.chance(disarm.chance) &&
    !isDisarmed(target)
  ) {
    ctx.applyAura(target, {
      id: `disarm_${mob.templateId}`,
      name: disarm.name,
      kind: 'disarm',
      remaining: disarm.duration,
      duration: disarm.duration,
      value: 0,
      sourceId: mob.id,
      school: (disarm.school ?? 'physical') as Aura['school'],
    });
  }

  // school lockout: a counterspell-on-hit that seals a single spell school. Same
  // hostile + alive guard as silence so a friendly pet never locks out the party.
  const lockout = MOBS[mob.templateId]?.lockout;
  if (lockout && mob.hostile && !target.dead && ctx.rng.chance(lockout.chance)) {
    ctx.applyAura(target, {
      id: `lockout_${mob.templateId}`,
      name: lockout.name,
      kind: 'lockout',
      remaining: lockout.duration,
      duration: lockout.duration,
      value: 0,
      sourceId: mob.id,
      school: lockout.school,
    });
  }
  // draining curse: a landed hit can leave a cost-tax debuff that inflates the
  // victim's ability costs. Guarded on hostile + alive so a friendly pet (the
  // other mobSwing caller) never debuffs the party.
  const costTax = MOBS[mob.templateId]?.costTax;
  if (costTax && mob.hostile && !target.dead && ctx.rng.chance(costTax.chance)) {
    ctx.applyAura(target, {
      id: `cost_tax_${mob.templateId}`,
      name: costTax.name,
      kind: 'cost_tax',
      remaining: costTax.duration,
      duration: costTax.duration,
      value: costTax.pct,
      sourceId: mob.id,
      school: (costTax.school ?? 'shadow') as Aura['school'],
    });
  }

  // Find Weakness: a landed hit can leave the victim's flesh exposed, so the
  // next critical hits against them bite deeper. Hostile + player-only, like the
  // other on-hit debuffs, so a friendly pet (mobSwing's other caller) never marks
  // the party.
  const cv = MOBS[mob.templateId]?.critVuln;
  if (cv && mob.hostile && target.kind === 'player' && !target.dead && ctx.rng.chance(cv.chance)) {
    ctx.applyAura(target, {
      id: `critvuln_${mob.templateId}`,
      name: cv.name,
      kind: 'critvuln',
      remaining: cv.duration,
      duration: cv.duration,
      value: cv.critDamage,
      sourceId: mob.id,
      school: (cv.school ?? 'physical') as Aura['school'],
    });
  }
  // thorns / lightning shield on the defender (charge-limited reflects gate on
  // their charge count and internal cooldown; ungated thorns reflect every hit)
  if (!mob.dead) {
    applyThornsReaction(ctx, target, mob);
  }
  // Mortal Strike: a landed hit can leave a healing-reduction debuff. Guarded on
  // `hostile` so a friendly pet (mobSwing's other caller) never debuffs the party.
  const ms = MOBS[mob.templateId]?.mortalStrike;
  if (ms && mob.hostile && !target.dead && ctx.rng.chance(ms.chance)) {
    ctx.applyAura(target, {
      id: `mortal_wound_${mob.templateId}`,
      name: ms.name,
      kind: 'mortal_wound',
      remaining: ms.duration,
      duration: ms.duration,
      value: ms.healReduction,
      sourceId: mob.id,
      school: (ms.school as Aura['school']) ?? 'physical',
    });
  }
  // Spell Vulnerability: a landed hit may curse the victim so they take more
  // magic damage from everyone (the arcane twin of corrode's armor shred).
  // Hostile mobs only, so a friendly pet (mobSwing's other caller) never curses
  // the party. A single refreshing slot keyed by template, like mortal_wound.
  const sv = MOBS[mob.templateId]?.spellVuln;
  if (sv && mob.hostile && !target.dead && ctx.rng.chance(sv.chance)) {
    ctx.applyAura(target, {
      id: `spellvuln_${mob.templateId}`,
      name: sv.name,
      kind: 'spellvuln',
      remaining: sv.duration,
      duration: sv.duration,
      value: sv.amp,
      sourceId: mob.id,
      school: (sv.school as Aura['school']) ?? 'arcane',
    });
  }

  // Staggering blow: a landed hit may knock the victim off-balance, cutting their
  // dodge for a short while so attacks land more reliably. Hostile mobs only (a
  // friendly pet shares this swing path) and only players have a meaningful dodge
  // chance. Rides buff_dodge with a NEGATIVE value — recalcPlayerStats already
  // folds buff_dodge into e.dodgeChance and it recalcs on expiry (buff* kind), so
  // no new aura kind is needed.
  const stagger = MOBS[mob.templateId]?.staggerHit;
  if (
    stagger &&
    mob.hostile &&
    target.kind === 'player' &&
    !target.dead &&
    ctx.rng.chance(stagger.chance)
  ) {
    ctx.applyAura(target, {
      id: `stagger_${mob.templateId}`,
      name: stagger.name,
      kind: 'buff_dodge',
      remaining: stagger.duration,
      duration: stagger.duration,
      value: -stagger.dodgeReduction,
      sourceId: mob.id,
      school: 'physical',
    });
  }

  // Heal-Absorb: a landed hit can brand the victim with a necrotic blight that
  // devours the next chunk of incoming healing. The sibling of Mortal Strike —
  // where Mortal Strike scales every heal down, this eats a fixed pool then
  // fades. Guarded on `hostile` so a friendly pet (mobSwing's other caller)
  // never blights an ally.
  const ha = MOBS[mob.templateId]?.healAbsorb;
  if (ha && mob.hostile && !target.dead && ctx.rng.chance(ha.chance)) {
    ctx.applyAura(target, {
      id: `heal_absorb_${mob.templateId}`,
      name: ha.name,
      kind: 'heal_absorb',
      remaining: ha.duration,
      duration: ha.duration,
      value: ha.amount,
      sourceId: mob.id,
      school: (ha.school as Aura['school']) ?? 'shadow',
    });
  }
  // Ensnare: a landed hit may web the victim in place (root). Hostile mobs only
  // (a friendly pet shares this swing path) and only roots players — `applyRootAura`
  // applies crowd-control DR so repeated webs from the same mob shrink and break.
  const ensnare = MOBS[mob.templateId]?.ensnare;
  if (
    ensnare &&
    mob.hostile &&
    target.kind === 'player' &&
    !target.dead &&
    ctx.rng.chance(ensnare.chance)
  ) {
    ctx.applyRootAura(
      mob,
      target,
      ensnare.name,
      `ensnare_${mob.templateId}`,
      ensnare.duration,
      ensnare.school ?? 'nature',
    );
  }
  // stunOnHit: a landed crushing blow may briefly stun the victim. Hostile mobs
  // only (a friendly pet shares this swing path) and only stuns players. Reuses
  // the `stun` aura the AoE stomp already applies, so isStunned()/the HUD handle
  // it with no new wiring. Kept low-chance/short so it threatens without locking.
  const stunOnHit = MOBS[mob.templateId]?.stunOnHit;
  if (
    stunOnHit &&
    mob.hostile &&
    target.kind === 'player' &&
    !target.dead &&
    ctx.rng.chance(stunOnHit.chance)
  ) {
    ctx.applyAura(target, {
      id: `stun_${mob.templateId}`,
      name: stunOnHit.name,
      kind: 'stun',
      remaining: stunOnHit.duration,
      duration: stunOnHit.duration,
      value: 0,
      sourceId: mob.id,
      school: stunOnHit.school ?? 'physical',
    });
  }
  // Knockback: a landed hit can physically hurl the player victim straight back.
  // Hostile mobs only (a friendly pet shares this swing path) and players only,
  // shoving a fellow mob is meaningless. Pure positional displacement (no aura),
  // terrain-clamped so it never strands the victim off the world; surfaced via a
  // spellfx nova + the same "unleashes" log line War Stomp uses.
  const knockback = MOBS[mob.templateId]?.knockback;
  if (
    knockback &&
    mob.hostile &&
    target.kind === 'player' &&
    !target.dead &&
    ctx.rng.chance(knockback.chance)
  ) {
    // Keep the chance draw unconditional for parity draw-order stability.
    // applyKnockback applies target.knockbackResistance itself, so pass raw distance.
    if (ctx.applyKnockback(mob, target, knockback.distance) > 0) {
      const school = (knockback.school ?? 'physical') as Aura['school'];
      ctx.emit({ type: 'spellfx', sourceId: mob.id, targetId: target.id, school, fx: 'nova' });
      if (!MOBS[mob.templateId]?.quietMechanics)
        ctx.emit({
          type: 'log',
          text: `${mob.name} unleashes ${knockback.name}!`,
          color: '#ff9933',
          entityId: mob.id,
        });
    }
  }
  // slowStrike: a landed hit may mire the victim, slowing their attack speed.
  // Rides the existing `attackspeed` aura (swingIntervalMult: value > 1 = slower);
  // refreshes by id and never stacks. Guarded on `hostile` so a friendly pet
  // (mobSwing's other caller) never debuffs the party.
  const slowStrike = MOBS[mob.templateId]?.slowStrike;
  if (slowStrike && mob.hostile && !target.dead && ctx.rng.chance(slowStrike.chance)) {
    ctx.applyAura(target, {
      id: `slowstrike_${mob.templateId}`,
      name: slowStrike.name,
      kind: 'attackspeed',
      remaining: slowStrike.duration,
      duration: slowStrike.duration,
      value: slowStrike.mult,
      sourceId: mob.id,
      school: (slowStrike.school as Aura['school']) ?? 'physical',
    });
  }
  // Curse of Tongues: a landed hit may garble the victim's incantations, stretching
  // their spell cast times (`tonguesMult` reads this at cast-start). Refreshes by id
  // and never stacks. Guarded on `hostile` so a friendly pet (mobSwing's other
  // caller) never curses an ally; players only, since only players hard-cast here.
  const tongues = MOBS[mob.templateId]?.tongues;
  if (
    tongues &&
    mob.hostile &&
    target.kind === 'player' &&
    !target.dead &&
    ctx.rng.chance(tongues.chance)
  ) {
    ctx.applyAura(target, {
      id: `tongues_${mob.templateId}`,
      name: tongues.name,
      kind: 'tongues',
      remaining: tongues.duration,
      duration: tongues.duration,
      value: tongues.mult,
      sourceId: mob.id,
      school: (tongues.school as Aura['school']) ?? 'shadow',
    });
  }
  // Mana Burn: a landed hit may sap a flat amount of mana from a mana-using
  // victim (casters). No effect on rage/energy users. Guarded on `hostile` so
  // a friendly pet (mobSwing's other caller) never drains an ally's mana. The
  // mana bar visibly drops and the affix is surfaced via an `aura` log line.
  const burn = MOBS[mob.templateId]?.manaBurn;
  if (
    burn &&
    mob.hostile &&
    !target.dead &&
    target.resourceType === 'mana' &&
    target.resource > 0 &&
    ctx.rng.chance(burn.chance)
  ) {
    target.resource = Math.max(0, target.resource - burn.amount);
    ctx.emit({ type: 'aura', targetId: target.id, name: burn.name, gained: true });
  }
  // Sap Vigor: the melee-resource twin of manaBurn. A landed hit can drain a
  // flat amount of rage or energy from a melee victim, starving their ability
  // use. Mana users are unaffected (it does nothing to casters); hostile mobs
  // only, so a friendly pet (mobSwing's other caller) never saps an ally. The
  // resource bar visibly drops and the affix is surfaced via an `aura` log line.
  const sap = MOBS[mob.templateId]?.sapVigor;
  if (
    sap &&
    mob.hostile &&
    !target.dead &&
    (target.resourceType === 'rage' || target.resourceType === 'energy') &&
    target.resource > 0 &&
    ctx.rng.chance(sap.chance)
  ) {
    target.resource = Math.max(0, target.resource - sap.amount);
    ctx.emit({ type: 'aura', targetId: target.id, name: sap.name, gained: true });
  }
  // Maddening curse: a landed hit can fog a caster's mind, draining Intellect
  // and thus shrinking their mana pool. Mana users only (it does nothing to
  // rage/energy users); hostile mobs only, so a friendly pet (mobSwing's other
  // caller) never debuffs the party. Rides buff_int with a negative value, so
  // recalcPlayerStats folds it through to maxResource with no new math.
  const enfeeble = MOBS[mob.templateId]?.enfeeble;
  if (
    enfeeble &&
    mob.hostile &&
    !target.dead &&
    target.resourceType === 'mana' &&
    ctx.rng.chance(enfeeble.chance)
  ) {
    ctx.applyAura(target, {
      id: `enfeeble_${mob.templateId}`,
      name: enfeeble.name,
      kind: 'buff_int',
      remaining: enfeeble.duration,
      duration: enfeeble.duration,
      value: -Math.abs(enfeeble.int),
      sourceId: mob.id,
      school: enfeeble.school ?? 'shadow',
    });
  }
  // Vitality drain: a landed hit can siphon the victim's Stamina, shrinking
  // their maximum-HP pool. Hits every class (all players have Stamina), unlike
  // the mana-only enfeeble. Hostile mobs only, so a friendly pet (mobSwing's
  // other caller) never drains the party. Rides buff_sta with a negative value,
  // so recalcPlayerStats folds it through to maxHp with no new HP math.
  const enervate = MOBS[mob.templateId]?.enervate;
  if (
    enervate &&
    mob.hostile &&
    target.kind === 'player' &&
    !target.dead &&
    ctx.rng.chance(enervate.chance)
  ) {
    ctx.applyAura(target, {
      id: `enervate_${mob.templateId}`,
      name: enervate.name,
      kind: 'buff_sta',
      remaining: enervate.duration,
      duration: enervate.duration,
      value: -Math.abs(enervate.sta),
      sourceId: mob.id,
      school: enervate.school ?? 'shadow',
    });
  }

  // Plague: a landed hit can rot the victim's vitality, draining Stamina and
  // thus shrinking their health pool (recalcPlayerStats folds the smaller
  // Stamina through to a smaller maxHp; current HP scales down with it).
  // Players only; hostile mobs only, so a friendly pet (mobSwing's other
  // caller) never debuffs the party. Rides buff_sta with a negative value, so
  // there is no new HP math. Refreshes by id and never stacks.
  const plague = MOBS[mob.templateId]?.plague;
  if (
    plague &&
    mob.hostile &&
    target.kind === 'player' &&
    !target.dead &&
    ctx.rng.chance(plague.chance)
  ) {
    ctx.applyAura(target, {
      id: `plague_${mob.templateId}`,
      name: plague.name,
      kind: 'buff_sta',
      remaining: plague.duration,
      duration: plague.duration,
      value: -Math.abs(plague.sta),
      sourceId: mob.id,
      school: plague.school ?? 'nature',
    });
  }

  // Withering curse: a landed hit can rot the victim's sinews, draining Agility
  // and so thinning their armor (agi*2) and dodge at once. Hostile mobs only, so a
  // friendly pet (mobSwing's other caller) never debuffs the party; player targets
  // only (mobs derive no stats from auras). Rides buff_agi with a negative value, so
  // recalcPlayerStats folds it through with no new stat math.
  const wither = MOBS[mob.templateId]?.wither;
  if (
    wither &&
    mob.hostile &&
    target.kind === 'player' &&
    !target.dead &&
    ctx.rng.chance(wither.chance)
  ) {
    ctx.applyAura(target, {
      id: `wither_${mob.templateId}`,
      name: wither.name,
      kind: 'buff_agi',
      remaining: wither.duration,
      duration: wither.duration,
      value: -Math.abs(wither.agi),
      sourceId: mob.id,
      school: wither.school ?? 'nature',
    });
  }

  // Spirit Siphon: a landed hit can drain a caster's Spirit, slowing their
  // out-of-combat mana/health regen (updateRegen reads stats.spi). Mana users
  // only (it does nothing to rage/energy users); hostile mobs only, so a
  // friendly pet (mobSwing's other caller) never debuffs the party. Rides
  // buff_spi with a negative value, so recalcPlayerStats folds it through with
  // no new regen math; it expires like any buff* aura.
  const siphon = MOBS[mob.templateId]?.siphonSpirit;
  if (
    siphon &&
    mob.hostile &&
    !target.dead &&
    target.resourceType === 'mana' &&
    ctx.rng.chance(siphon.chance)
  ) {
    ctx.applyAura(target, {
      id: `siphon_spirit_${mob.templateId}`,
      name: siphon.name,
      kind: 'buff_spi',
      remaining: siphon.duration,
      duration: siphon.duration,
      value: -Math.abs(siphon.spi),
      sourceId: mob.id,
      school: siphon.school ?? 'shadow',
    });
  }
  // On-hit chill: frost-touched mobs numb the victim, slowing their movement.
  const chill = MOBS[mob.templateId]?.chillOnHit;
  if (chill && !mob.dead && !target.dead && ctx.rng.chance(chill.chance)) {
    ctx.applyAura(target, {
      id: `${mob.templateId}_chill`,
      name: chill.name,
      kind: 'slow',
      remaining: chill.duration,
      duration: chill.duration,
      value: chill.mult,
      sourceId: mob.id,
      school: 'frost',
    });
  }
  // Demoralizing affix: a successful hit saps the player victim's attack
  // power for a few seconds, weakening the damage they deal back.
  const demo = MOBS[mob.templateId]?.demoralize;
  if (demo && !mob.dead && target.kind === 'player' && ctx.rng.chance(demo.chance ?? 1)) {
    ctx.applyAura(target, {
      id: 'mob_demoralize',
      name: demo.name ?? 'Demoralized',
      kind: 'buff_ap',
      remaining: demo.duration,
      duration: demo.duration,
      value: -Math.abs(demo.ap),
      sourceId: mob.id,
      school: 'physical',
    });
  }
  // Dread: a landed hit can terrify the victim into fleeing. Reuses the exact
  // `fear_incap` incapacitate aura the player-cast Fear applies, so
  // `updateFearMovement` drives the panicked run — no new aura kind or hook.
  // Guarded on `hostile` (a friendly pet never fears the party) and on a player
  // target (mobs can't flee via this path). `diminishedCrowdControlDuration`
  // returns the full duration for a mob source (DR is PvP-only), so the victim
  // gets the authored fear length.
  const dread = MOBS[mob.templateId]?.dread;
  if (
    dread &&
    mob.hostile &&
    target.kind === 'player' &&
    !target.dead &&
    ctx.rng.chance(dread.chance)
  ) {
    const remaining = ctx.diminishedCrowdControlDuration(mob, target, 'fear', dread.duration);
    if (remaining !== null) {
      ctx.applyAura(target, {
        id: 'fear_incap',
        name: dread.name,
        kind: 'incapacitate',
        remaining,
        duration: remaining,
        value: ctx.rng.range(-Math.PI, Math.PI),
        sourceId: mob.id,
        school: dread.school ?? 'shadow',
        breaksOnDamage: true,
      });
    }
  }
  // Polymorph hex: a landed hit can briefly turn the victim into a critter,
  // applying the same `polymorph` aura the mage's Polymorph uses — `isStunned`
  // locks out every action and the aura is stripped the instant the victim
  // takes damage (the caster's own next hit ends it), so it's a brief flavor
  // incap, not a hard lock. Unlike the player-cast version we deliberately do
  // NOT heal the victim to full on apply (a monster shouldn't restore its prey),
  // but keep the aura's inherent regen tick. Guarded on `hostile` + a player
  // target; `diminishedCrowdControlDuration` returns the full duration for a
  // mob source (DR is PvP-only).
  const hex = MOBS[mob.templateId]?.polymorphHex;
  if (
    hex &&
    mob.hostile &&
    target.kind === 'player' &&
    !target.dead &&
    ctx.rng.chance(hex.chance)
  ) {
    const remaining = ctx.diminishedCrowdControlDuration(mob, target, 'polymorph', hex.duration);
    if (remaining !== null) {
      ctx.applyAura(target, {
        id: `hex_${mob.templateId}`,
        name: hex.name,
        kind: 'polymorph',
        remaining,
        duration: remaining,
        value: 0,
        tickInterval: 1,
        tickTimer: 1,
        sourceId: mob.id,
        school: hex.school ?? 'nature',
        breaksOnDamage: true,
      });
    }
  }
  // Concussive Blow: a landed hit can briefly STUN the victim (single-target,
  // distinct from War Stomp's AoE slam). Hostile mobs only so a friendly pet
  // never stuns an ally; CC DR is PvP-only so a mob source always lands full.
  const concuss = MOBS[mob.templateId]?.concuss;
  if (
    concuss &&
    mob.hostile &&
    target.kind === 'player' &&
    !target.dead &&
    ctx.rng.chance(concuss.chance)
  ) {
    ctx.applyAura(target, {
      id: `concuss_${mob.templateId}`,
      name: concuss.name,
      kind: 'stun',
      remaining: concuss.duration,
      duration: concuss.duration,
      value: 0,
      sourceId: mob.id,
      school: concuss.school ?? 'physical',
    });
  }

  // Expose: a landed hit can crack the victim's guard, raising the physical
  // damage they take for a duration. Guarded on `hostile` so a friendly pet
  // (mobSwing's other caller) never debuffs the party.
  const expose = MOBS[mob.templateId]?.expose;
  if (expose && mob.hostile && !target.dead && ctx.rng.chance(expose.chance)) {
    ctx.applyAura(target, {
      id: `expose_${mob.templateId}`,
      name: expose.name,
      kind: 'expose',
      remaining: expose.duration,
      duration: expose.duration,
      value: expose.dmgIncrease,
      sourceId: mob.id,
      school: (expose.school as Aura['school']) ?? 'physical',
    });
  }

  // Curse of frailty: a landed hit may curse the victim so they take more
  // damage from every source (a `vulnerability` aura read in dealDamage).
  // Players only, hostile mobs only, so a friendly pet (mobSwing's other
  // caller) never softens an ally. Refreshes by id, never stacks past one.
  const vuln = MOBS[mob.templateId]?.vulnerability;
  if (
    vuln &&
    mob.hostile &&
    target.kind === 'player' &&
    !target.dead &&
    ctx.rng.chance(vuln.chance)
  ) {
    ctx.applyAura(target, {
      id: `vulnerability_${mob.templateId}`,
      name: vuln.name,
      kind: 'vulnerability',
      remaining: vuln.duration,
      duration: vuln.duration,
      value: vuln.amp,
      sourceId: mob.id,
      school: vuln.school ?? 'shadow',
    });
  }

  // Weakening Hex: a landed hit can curse the player victim, scaling the damage
  // AND healing they deal by (1 - reductionPct) for a while. Guarded on
  // `hostile` so a friendly pet (mobSwing's other caller) never hexes the party,
  // and on a player target. Rides a dedicated `hex` aura read by hexOutputMult.
  const weakHex = MOBS[mob.templateId]?.hex;
  if (
    weakHex &&
    mob.hostile &&
    target.kind === 'player' &&
    !target.dead &&
    ctx.rng.chance(weakHex.chance)
  ) {
    ctx.applyAura(target, {
      id: `hex_${mob.templateId}`,
      name: weakHex.name,
      kind: 'hex',
      remaining: weakHex.duration,
      duration: weakHex.duration,
      value: weakHex.reductionPct,
      sourceId: mob.id,
      school: weakHex.school ?? 'shadow',
    });
  }
  // Devour Magic: a landed hit can strip one beneficial enhancement buff off
  // the player victim (classic warlock/demon Devour Magic). Hostile mobs only
  // (a friendly pet — mobSwing's other caller — must never purge its owner's
  // party) and players only. No-op when the victim carries no devourable buff.
  const purge = MOBS[mob.templateId]?.purgeOnHit;
  if (
    purge &&
    mob.hostile &&
    target.kind === 'player' &&
    !target.dead &&
    ctx.rng.chance(purge.chance)
  ) {
    devourBeneficialAura(ctx, target, purge.name);
  }
}

// Strip one beneficial enhancement aura from a player victim. Removes the
// first devourable buff (auras are in application order, so this is
// deterministic), recalcs the player's derived stats so a stripped
// buff_armor/buff_ap/buff_int actually un-folds, and surfaces the proc via the
// standard `aura` event (the full aura array on the next snapshot reflects the
// removal to online clients). Returns whether anything was devoured.
export function devourBeneficialAura(ctx: SimContext, target: Entity, name: string): boolean {
  const idx = target.auras.findIndex(isDevourableAura);
  if (idx < 0) return false;
  target.auras.splice(idx, 1);
  ctx.recalcPlayer(target);
  ctx.emit({ type: 'aura', targetId: target.id, name, gained: true });
  return true;
}

// Apply (or add a stack to) a ramping poison DoT on the victim. One shared
// `dot` slot found by id, its per-tick `value` recomputed as perTick*stacks
// (bumped up to `maxStacks`) and its timer fully refreshed each application —
// so the per-tick damage climbs the longer the creature keeps biting. The dot
// tick reads `value` directly, so storing perTick*stacks is what makes it ramp.
function applyStackPoison(
  ctx: SimContext,
  mob: Entity,
  target: Entity,
  sp: NonNullable<MobTemplate['stackPoison']>,
): void {
  const id = `stackpoison_${mob.templateId}`;
  const existing = target.auras.find((a) => a.id === id && a.kind === 'dot');
  if (existing) {
    existing.stacks = Math.min(sp.maxStacks, (existing.stacks ?? 1) + 1);
    existing.value = Math.max(1, Math.round(sp.perTick * existing.stacks));
    existing.remaining = existing.duration;
    ctx.emit({ type: 'aura', targetId: target.id, name: sp.name, gained: true });
  } else {
    ctx.applyAura(target, {
      id,
      name: sp.name,
      kind: 'dot',
      remaining: sp.duration,
      duration: sp.duration,
      value: Math.max(1, Math.round(sp.perTick)),
      tickInterval: sp.interval,
      tickTimer: sp.interval,
      stacks: 1,
      sourceId: mob.id,
      school: (sp.school as Aura['school']) ?? 'nature',
    });
  }
}

// Apply (or refresh + stack) a corrosive armor-shred debuff on the victim.
// Mirrors the warrior Sunder Armor stacking: one shared `sunder` slot found by
// kind, bumped up to `maxStacks`, with its timer fully refreshed each application.
// effectiveArmor() already subtracts value*stacks, so the victim takes more
// physical damage from every attacker until it expires.
function applyCorrosion(
  ctx: SimContext,
  mob: Entity,
  target: Entity,
  corrode: NonNullable<MobTemplate['corrode']>,
): void {
  // Mob corrosion is a FLAT, stacking armor shred on its own `corrode` kind, kept
  // separate from the warrior/rogue percent `sunder` so effectiveArmor subtracts it
  // flat (before the percent debuffs) and the two mechanics never collide.
  const existing = target.auras.find((a) => a.kind === 'corrode');
  if (existing) {
    existing.stacks = Math.min(corrode.maxStacks, (existing.stacks ?? 1) + 1);
    existing.value = corrode.armor;
    existing.remaining = existing.duration;
    ctx.emit({ type: 'aura', targetId: target.id, name: corrode.name, gained: true });
  } else {
    ctx.applyAura(target, {
      id: `corrode_${mob.templateId}`,
      name: corrode.name,
      kind: 'corrode',
      remaining: corrode.duration,
      duration: corrode.duration,
      value: corrode.armor,
      stacks: 1,
      sourceId: mob.id,
      school: corrode.school ?? 'nature',
    });
  }
}
