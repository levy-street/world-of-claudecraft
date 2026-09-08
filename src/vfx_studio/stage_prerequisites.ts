import { completeNeedleOfFateCast, gainDoom, moveEvilEye } from '../sim/combat/affliction';
import { gainRuin, RUIN_MAX } from '../sim/combat/destruction';
import {
  addSoulFragments,
  despawnTemporaryNecromancyUndead,
  isTemporaryNecromancyUndead,
  ownedNecromancyUndead,
  SOUL_FRAGMENT_CAP,
  summonUndead,
} from '../sim/combat/necromancy';
import { addGloomtithe } from '../sim/combat/priest/vespers';
import { activeUnleashWeaponEnchant } from '../sim/combat/shaman_unleash_weapon';
import { ABILITIES } from '../sim/data';
import { grantDevotion, MAX_DEVOTION } from '../sim/paladin_devotion';
import { restorePet } from '../sim/pet/pet_commands';
import type { Sim } from '../sim/sim';
import type { AbilityDef, AuraKind, Entity } from '../sim/types';
import { studioAbilityLibrary } from './ability_library';

export function prepareStudioAura(sim: Sim, kind: AuraKind, stacks = 1): void {
  const p = sim.player;
  for (const aura of [...p.auras]) if (aura.kind === kind) sim.cancelAura(aura.id);
  sim.ctx.applyAura(p, {
    id: kind === 'hunter_ferocity' ? 'pack_ferocity' : kind,
    name: ABILITIES[kind]?.name ?? 'Preview preparation',
    kind,
    remaining: 60,
    duration: 60,
    value: 1,
    stacks,
    sourceId: p.id,
    school: ABILITIES[kind]?.school ?? 'physical',
  });
}

export function prepareStudioPrerequisites(sim: Sim, ability: AbilityDef, target: Entity): string {
  const p = sim.player,
    ctx = sim.ctx,
    meta = sim.players.get(p.id)!;
  const entry = studioAbilityLibrary(sim).get(ability.id);
  // An interrupt preview needs an interruptible victim, just as an execute
  // preview needs low health. The real effect still cancels and locks the cast.
  if (ability.effects.some((effect) => effect.type === 'interrupt') && ctx.isHostileTo(p, target)) {
    ctx.cancelCast(target);
    target.castingAbility = 'fireball';
    target.castTotal = ABILITIES.fireball.castTime;
    target.castRemaining = target.castTotal;
    target.castTargetId = p.id;
  }
  // Clear the prior payoff state so selecting a base action really shows it.
  for (const known of sim.known) {
    const raw = known.def.actionReplacement;
    for (const rule of raw ? (Array.isArray(raw) ? raw : [raw]) : [])
      for (const aura of [...p.auras]) if (aura.kind === rule.auraKind) sim.cancelAura(aura.id);
  }
  const plant = (id: string, recipient = target) => {
    const resolved = sim.resolvedAbility(id);
    if (resolved) ctx.runEffects(p, meta, recipient, resolved);
  };
  if (p.paladinDevotion) {
    if (ability.id === 'divine_ascension') {
      p.paladinDevotion.ascensionCharges = 0;
      p.paladinDevotion.ascensionRemaining = 0;
      sim.cancelAura('divine_ascension');
    }
    grantDevotion(p, MAX_DEVOTION);
  }
  if (ability.ruinCost) gainRuin(ctx, p, RUIN_MAX);
  if (ability.soulFragmentCost) addSoulFragments(ctx, p, SOUL_FRAGMENT_CAP);
  if (ability.id === 'conflagrate') plant('immolate');
  if (ability.id === 'swiftmend' || ability.id === 'overbloom') {
    const allies = sim.partyOf(p.id)?.members ?? [target.id];
    for (const id of ability.id === 'overbloom' ? allies : [target.id]) {
      const ally = sim.entities.get(id);
      if (!ally || ally.dead) continue;
      ally.hp = ally.maxHp * 0.4;
      plant('rejuvenation', ally);
      if (ability.id === 'overbloom') plant('regrowth', ally);
    }
  }
  if (ability.id === 'venomrend') plant('rupture');
  if (ability.id === 'redharvest') {
    plant('rake');
    plant('rip');
  }
  if (ability.id === 'summon_tithefiend') {
    const enemy = [...sim.entities.values()].find(
      (e) =>
        e.templateId === 'training_dummy' &&
        !e.dead &&
        Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) < 30,
    );
    if (enemy) plant('shadow_word_pain', enemy);
    addGloomtithe(ctx, p, 5);
  }
  if (ability.id === 'unleash_weapon') {
    if (!activeUnleashWeaponEnchant(p))
      plant(
        meta.talents.spec === 'restoration'
          ? 'lifespring_weapon'
          : meta.talents.spec === 'enhancement'
            ? 'galeheart_weapon'
            : meta.talents.spec === 'elemental'
              ? 'flametongue_weapon'
              : 'rockbiter_weapon',
        p,
      );
    // The unspecialized library still contains Unleash. Supply the ordinary
    // imbue prerequisite without inventing a specialization or its bonuses.
    if (!meta.talents.spec && !activeUnleashWeaponEnchant(p)) {
      const imbue = sim
        .resolvedAbility('rockbiter_weapon')
        ?.effects.find((e) => e.type === 'imbue');
      if (imbue?.type === 'imbue')
        ctx.applyAura(p, {
          id: 'rockbiter_weapon',
          name: ABILITIES.rockbiter_weapon.name,
          kind: 'imbue',
          value: imbue.bonus,
          remaining: imbue.duration,
          duration: imbue.duration,
          sourceId: p.id,
          school: 'nature',
        });
    }
    if (activeUnleashWeaponEnchant(p) === 'lifespring') {
      target.hp = target.maxHp * 0.35;
      plant('tidecall', target);
    }
  }
  if (
    ['sentence', 'coven', 'possess_evil_eye', 'hour_of_judgment', 'litany_of_guilt'].includes(
      ability.id,
    )
  ) {
    moveEvilEye(ctx, p, target);
    for (let i = 0; i < 3; i++) completeNeedleOfFateCast(ctx, p, target);
    if (ability.id === 'sentence') gainDoom(ctx, p, 100);
    if (ability.id === 'litany_of_guilt') {
      for (const a of p.auras) if (a.kind === 'affliction_doom') a.stacks = 0;
      ctx.enterCombat(p, target);
    }
  }
  if (
    [
      'pack_command',
      'unleash_beast',
      'howling_rage',
      'revive_pet',
      'mend_pet',
      'dismiss_pet',
    ].includes(ability.id)
  ) {
    for (const aura of [...p.auras]) if (aura.kind === 'hunter_frenzy') sim.cancelAura(aura.id);
    let pet = sim.petOf(p.id, true);
    if (!pet) {
      restorePet(ctx, p, {
        templateId: 'forest_wolf',
        name: 'Wolf',
        level: p.level,
        hp: 1,
        dead: false,
        mode: 'passive',
      });
      pet = sim.petOf(p.id, true);
    }
    if (pet) {
      if (pet.dead && ability.id !== 'revive_pet') sim.revivePet();
      if (!pet.dead)
        pet.hp =
          ability.id === 'revive_pet' || ability.id === 'mend_pet' ? pet.maxHp * 0.3 : pet.maxHp;
      pet.pos = sim.groundPos(target.pos.x + 1.6, target.pos.z - 1.6);
      pet.prevPos = { ...pet.pos };
      sim.rebucket(pet);
    }
  }
  if (ability.effects.some((effect) => effect.type === 'summonUndead' && effect.temporary))
    despawnTemporaryNecromancyUndead(ctx, p.id);
  if (
    ['corpse_explosion', 'sacrifice_undead', 'unholy_command', 'reaping_command'].includes(
      ability.id,
    ) &&
    !ownedNecromancyUndead(ctx, p.id).some((entity) =>
      ability.id === 'corpse_explosion' || ability.id === 'sacrifice_undead'
        ? isTemporaryNecromancyUndead(entity)
        : true,
    )
  )
    summonUndead(ctx, p, 'necromancy_skeletal_warrior', true, 60);
  if (entry?.rule) prepareStudioAura(sim, entry.rule.auraKind, entry.rule.minStacks ?? 1);
  if (ability.id === 'pack_rally') p.inCombat = true;
  return entry?.base ?? ability.id;
}
