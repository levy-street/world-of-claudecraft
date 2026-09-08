import { isFormToggleAbility, willAutoUnshift } from '../sim/combat/form_auto_unshift';
import { isActionLockingFormAuraKind } from '../sim/combat/forms';
import { activeUnleashWeaponEnchant } from '../sim/combat/shaman_unleash_weapon';
import { ABILITIES, MOBS } from '../sim/data';
import { resetCombatForDev } from '../sim/dev_commands';
import { createMob } from '../sim/entity';
import type { Sim } from '../sim/sim';
import { studioAbilityLibrary } from './ability_library';
import { prepareStudioAura, prepareStudioPrerequisites } from './stage_prerequisites';

/** Training-scene setup, recorded as part of the preview command. The cast
 * itself still runs through the real simulation, including travel and hits. */
export function stageStudioCast(sim: Sim, abilityId: string, targetId: number): number {
  const resolved = sim.resolvedAbility(abilityId);
  const ability =
    resolved?.def.id === abilityId
      ? { ...resolved.def, effects: resolved.effects }
      : ABILITIES[abilityId];
  if (!ability || ability.passive) return targetId;
  const player = sim.player;
  for (const id of sim.partyOf(player.id)?.members ?? []) {
    const ally = sim.entities.get(id);
    if (ally && ally.id !== player.id && ally.dead) sim.revivePlayerAt(ally.id, ally.pos);
  }
  for (const entity of [...sim.entities.values()])
    if (entity.devSpawnOwnerId === player.id && entity.ownerId !== player.id)
      sim.ctx.dropEntity(entity.id);
  resetCombatForDev(sim.ctx, player.id);
  sim.ctx.cancelCast(player);
  for (const aura of [...player.auras])
    if (aura.kind === 'stasis' || aura.id === 'shellskin') sim.cancelAura(aura.id);
  player.queuedCastAbility = null;
  player.queuedCastAim = null;
  player.queuedOnSwing = null;
  player.swingTimer = 0;
  let target = sim.entities.get(targetId) ?? player;
  if (abilityId === 'tame_beast') {
    const pet = sim.petOf(player.id, true);
    if (pet) sim.ctx.despawnPet(pet);
    // An ordinary overworld beast brought onto the stage retains its origin.
    const beast = createMob(sim.ctx.nextId++, MOBS.forest_wolf, player.level, sim.groundPos(0, 0));
    beast.devSpawnOwnerId = player.id;
    beast.pos = sim.groundPos(player.pos.x, player.pos.z + 7);
    beast.prevPos = { ...beast.pos };
    beast.wanderTarget = null;
    sim.ctx.addEntity(beast);
    target = beast;
  }
  if (
    !ability.requiresTarget &&
    ability.targetMode !== 'position' &&
    !ability.effects.some((e) => e.type === 'aoeDamage' || e.type === 'frostjawTrap') &&
    !ability.onNextSwing &&
    !['coven', 'litany_of_guilt', 'hour_of_judgment'].includes(abilityId)
  )
    target = player;
  const enchant = activeUnleashWeaponEnchant(player);
  const friendly =
    ability.targetType === 'friendly' ||
    (abilityId === 'unleash_weapon' &&
      (enchant === 'lifespring' ||
        (!enchant && sim.players.get(player.id)?.talents.spec === 'restoration')));
  if (friendly && target.kind !== 'player') {
    target =
      (sim.partyOf(player.id)?.members ?? [])
        .map((id) => sim.entities.get(id))
        .find(
          (e) =>
            e &&
            e.kind === 'player' &&
            e.id !== player.id &&
            Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z) < 20,
        ) ?? player;
  }
  player.cooldowns.clear();
  player.gcdRemaining = 0;
  player.inCombat = false;
  player.combatTimer = 99;
  player.comboPoints = ability.spendsCombo ? 5 : player.comboPoints;
  player.comboUntil = sim.time + 60;
  player.overpowerUntil = sim.time + 20;
  const rule = studioAbilityLibrary(sim).get(abilityId)?.rule;
  const requiredForm =
    ability.requiresForm === 'bear'
      ? 'form_bear'
      : ability.requiresForm === 'cat'
        ? 'form_cat'
        : rule?.actorAuraKind?.startsWith('form_')
          ? rule.actorAuraKind
          : ability.requiresAuraKind?.startsWith('form_')
            ? ability.requiresAuraKind
            : !isFormToggleAbility(ability) && !willAutoUnshift(player.auras, ability)
              ? (player.auras.find(
                  (a) =>
                    a.kind.startsWith('form_') &&
                    (!isActionLockingFormAuraKind(a.kind) || ability.usableInForm),
                )?.kind ?? null)
              : null;
  for (const aura of [...player.auras]) {
    if (aura.kind.startsWith('form_') && aura.kind !== requiredForm) sim.cancelAura(aura.id);
  }
  if (requiredForm && !player.auras.some((a) => a.kind === requiredForm))
    sim.castAbility(
      requiredForm === 'form_bear'
        ? 'bear_form'
        : requiredForm === 'form_moonkin'
          ? 'moonkin_form'
          : 'cat_form',
    );
  if (ability.requiresAuraKind && !ability.requiresAuraKind.startsWith('form_'))
    prepareStudioAura(sim, ability.requiresAuraKind, ability.requiresAuraStacks ?? 1);
  player.gcdRemaining = 0;
  player.resource = player.maxResource;
  if (ability.requiresStealth) {
    prepareStudioAura(sim, 'stealth');
    player.stealthed = true;
  }
  if (target.id !== player.id) {
    const range = ability.range > 0 ? ability.range : 3;
    const distance =
      abilityId === 'skull_bash'
        ? 1.65
        : Math.max((ability.minRange ?? 0) + 0.5, Math.min(7, range * 0.7));
    let angle = Math.atan2(player.pos.x - target.pos.x, player.pos.z - target.pos.z);
    if (ability.effects.some((e) => e.type === 'weaponStrike' && e.requiresBehind)) {
      angle = target.facing + Math.PI;
    }
    const currentDistance = Math.hypot(player.pos.x - target.pos.x, player.pos.z - target.pos.z);
    if (
      currentDistance > (abilityId === 'skull_bash' ? 2 : range * 0.9) ||
      currentDistance < (ability.minRange ?? 0) + 0.2 ||
      ability.effects.some((e) => e.type === 'weaponStrike' && e.requiresBehind)
    ) {
      player.pos = sim.groundPos(
        target.pos.x + Math.sin(angle) * distance,
        target.pos.z + Math.cos(angle) * distance,
      );
      player.prevPos = { ...player.pos };
      sim.rebucket(player);
    }
    const threshold = ability.executeThreshold ?? ability.requiresTargetHpBelow;
    if (threshold !== undefined) target.hp = Math.max(1, target.maxHp * threshold * 0.65);
    if (ability.targetType === 'friendly') target.hp = Math.min(target.hp, target.maxHp * 0.35);
    if (ability.targetsDead) {
      target.hp = 0;
      target.dead = true;
    }
  }
  if (ability.targetType === 'friendly') target.hp = Math.min(target.hp, target.maxHp * 0.35);
  if (ability.effects.some((e) => e.type === 'massResurrectGroup')) {
    for (const id of sim.partyOf(player.id)?.members ?? []) {
      const ally = sim.entities.get(id);
      if (!ally || ally.id === player.id) continue;
      ally.hp = 0;
      ally.dead = true;
      ally.corpseTimer = Infinity;
    }
  }
  if (['coven', 'litany_of_guilt'].includes(abilityId)) {
    for (const side of [-1, 1]) {
      const extra = createMob(
        sim.ctx.nextId++,
        MOBS.training_dummy,
        player.level,
        sim.groundPos(target.pos.x + side * 2.4, target.pos.z + 1.8),
      );
      extra.devSpawnOwnerId = player.id;
      extra.hostile = true;
      sim.ctx.addEntity(extra);
    }
  }
  prepareStudioPrerequisites(sim, ability, target);
  player.gcdRemaining = 0;
  player.resource = player.maxResource;
  player.comboPoints = ability.spendsCombo ? 5 : player.comboPoints;
  // Setup is state preparation; only the following reviewed cast is presented.
  sim.drainEvents();
  return target.id;
}
