// Faction rewards, utility items, and toys logic.
// Pure simulation module: zero RNG, zero wall-clock, zero DOM/Three.js imports.

import { DUNGEON_X_THRESHOLD, isArenaPos, isDelvePos, isRiftPos, MOBS } from '../data';
import { displacePlayer } from '../displacement';
import { createGroundObject, createMob } from '../entity';
import type { FactionId } from '../factions';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { ALLIED_HEARTHSTONE_CAST_ID, dist2d, type Entity, type Vec3 } from '../types';
import { FACTION_HUB_LANDINGS } from './faction_vendors';

export const DAWN_STANDARD_RADIUS = 15;

/** Start the 10s cast to return the player to their attuned faction hub landing. */
export function useAlliedHearthstone(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  if (p.dead || p.ghost) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  if (p.inCombat) {
    ctx.error(meta.entityId, "You can't do that while in combat.");
    return;
  }
  const readyAt = meta.alliedHearthstoneReadyAt ?? 0;
  if (ctx.time < readyAt) {
    const remMins = Math.ceil((readyAt - ctx.time) / 60);
    ctx.error(meta.entityId, `That item is not ready yet (${remMins} min remaining).`);
    return;
  }
  if (p.castingAbility) {
    ctx.error(meta.entityId, 'You are busy.');
    return;
  }

  // Check attunement or auto-attune if currently near an allied hub landing
  let attunement: FactionId | undefined = meta.alliedHearthstoneAttunement;
  if (!attunement) {
    for (const [fid, hub] of Object.entries(FACTION_HUB_LANDINGS) as [
      FactionId,
      (typeof FACTION_HUB_LANDINGS)[FactionId],
    ][]) {
      if (dist2d(p.pos, hub) <= 35) {
        attunement = fid;
        meta.alliedHearthstoneAttunement = fid;
        ctx.emit({
          type: 'log',
          text: `Your Allied Hearthstone is now attuned to ${hub.name}.`,
          color: '#b9f',
          pid: meta.entityId,
        });
        break;
      }
    }
  }

  if (!attunement) {
    ctx.error(
      meta.entityId,
      'Your Allied Hearthstone is not attuned. Speak with an allied quartermaster or use it in an allied hub.',
    );
    return;
  }

  p.castingAbility = ALLIED_HEARTHSTONE_CAST_ID;
  p.castRemaining = 10;
  p.castTotal = 10;
  p.channeling = false;
  ctx.emit({
    type: 'castStart',
    entityId: p.id,
    ability: ALLIED_HEARTHSTONE_CAST_ID,
    time: 10,
  });
}

/** Complete the Allied Hearthstone cast upon timer expiration. */
export function completeAlliedHearthstoneCast(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  const attunement = meta.alliedHearthstoneAttunement;
  if (!attunement) return;
  const landing = FACTION_HUB_LANDINGS[attunement];
  if (!landing) return;

  displacePlayer(ctx, p, landing, `The hearthstone transports you to ${landing.name}.`);
  meta.alliedHearthstoneReadyAt = ctx.time + 900; // 15 min cooldown
  p.cooldowns.set('allied_hearthstone', 900);
}

/** Attune the Allied Hearthstone to the given faction hub. */
export function attuneAlliedHearthstone(
  ctx: SimContext,
  _p: Entity,
  meta: PlayerMeta,
  factionId: FactionId,
): boolean {
  if (ctx.countItem('allied_hearthstone', meta.entityId) <= 0) {
    ctx.error(meta.entityId, "You don't have that item.");
    return false;
  }
  const hub = FACTION_HUB_LANDINGS[factionId];
  if (!hub) return false;
  meta.alliedHearthstoneAttunement = factionId;
  ctx.emit({
    type: 'log',
    text: `Your Allied Hearthstone is now attuned to ${hub.name}.`,
    color: '#b9f',
    pid: meta.entityId,
  });
  return true;
}

/** Deploy the Rift Feather Glider to slow fall gracefully. */
export function useRiftFeatherGlider(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  if (p.dead || p.ghost) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  if (p.inCombat) {
    ctx.error(meta.entityId, "You can't do that while in combat.");
    return;
  }
  const readyAt = meta.riftGliderReadyAt ?? 0;
  if (ctx.time < readyAt) {
    ctx.error(meta.entityId, 'That item is not ready yet.');
    return;
  }

  ctx.applyAura(p, {
    id: 'rift_feather_glider',
    name: 'Rift Feather Glider',
    kind: 'slow_fall',
    duration: 30,
    remaining: 30,
    value: 1,
    sourceId: p.id,
    school: 'physical',
    breaksOnDamage: true,
  });

  meta.riftGliderReadyAt = ctx.time + 120; // 2 min cooldown
  p.cooldowns.set('rift_feather_glider', 120);
  ctx.emit({
    type: 'log',
    text: 'You unfold the Rift Feather Glider and glide forward.',
    color: '#4a7a9a',
    pid: meta.entityId,
  });
}

/** Deploy a mechanical target dummy in the open world for 2 minutes. */
export function useClockworkTargetDummy(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  if (p.dead || p.ghost) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  if (p.inCombat) {
    ctx.error(meta.entityId, "You can't do that while in combat.");
    return;
  }
  if (
    p.pos.x > DUNGEON_X_THRESHOLD ||
    isDelvePos(p.pos.x) ||
    isRiftPos(p.pos.x) ||
    isArenaPos(p.pos.x)
  ) {
    ctx.error(meta.entityId, 'Can only be deployed in the open world.');
    return;
  }
  const readyAt = meta.targetDummyReadyAt ?? 0;
  if (ctx.time < readyAt) {
    ctx.error(meta.entityId, 'That item is not ready yet.');
    return;
  }

  const forwardX = p.pos.x + Math.sin(p.facing) * 2;
  const forwardZ = p.pos.z + Math.cos(p.facing) * 2;
  const dummyPos = ctx.groundPos(forwardX, forwardZ);
  const dummy = createMob(ctx.nextId++, MOBS.training_dummy, 20, dummyPos);
  dummy.name = 'Clockwork Target Dummy';
  dummy.color = 0xb87333; // Automaton copper/bronze tint
  dummy.hardDespawnTimer = 120; // 2 minutes lifetime
  dummy.tappedById = meta.entityId;
  dummy.runScoped = true;
  dummy.summonedAdd = true;
  ctx.addEntity(dummy);

  meta.targetDummyReadyAt = ctx.time + 300; // 5 min cooldown
  p.cooldowns.set('clockwork_target_dummy', 300);
  ctx.emit({
    type: 'log',
    text: 'You deploy a Clockwork Target Dummy.',
    color: '#b87333',
    pid: meta.entityId,
  });
}

/** Plant the Consecrated Dawn Battle Standard for 5 minutes. */
export function useDawnBattleStandard(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  if (p.dead || p.ghost) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  if (p.inCombat) {
    ctx.error(meta.entityId, "You can't do that while in combat.");
    return;
  }
  const readyAt = meta.dawnStandardReadyAt ?? 0;
  if (ctx.time < readyAt) {
    ctx.error(meta.entityId, 'That item is not ready yet.');
    return;
  }

  // Remove any existing active standard placed by this player
  for (const entity of [...ctx.entities.values()]) {
    if (
      entity.kind === 'object' &&
      entity.templateId === 'dawn_battle_standard' &&
      entity.tappedById === meta.entityId
    ) {
      ctx.dropEntity(entity.id);
    }
  }

  const standardPos = ctx.groundPos(p.pos.x, p.pos.z);
  const standard = createGroundObject(ctx.nextId++, '', 'Dawn Battle Standard', standardPos);
  standard.templateId = 'dawn_battle_standard';
  standard.objectItemId = null;
  standard.lootable = false;
  standard.respawnTimer = Infinity;
  standard.hardDespawnTimer = 300; // 5 minutes duration
  standard.color = 0xffd700; // Consecrated Dawn gold
  standard.tappedById = meta.entityId;
  ctx.addEntity(standard);

  meta.dawnStandardReadyAt = ctx.time + 300; // 5 min cooldown
  p.cooldowns.set('dawn_battle_standard', 300);
  ctx.emit({
    type: 'log',
    text: 'You plant the Consecrated Dawn Battle Standard.',
    color: '#ecd57a',
    pid: meta.entityId,
  });
}

/** Periodic out-of-combat update for active Dawn Battle Standards. */
export function updateDawnBattleStandards(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  if (p.dead || p.inCombat) {
    meta.dawnStandardSeconds = 0;
    return;
  }

  let inRadius = false;
  for (const entity of ctx.entities.values()) {
    if (
      entity.kind === 'object' &&
      entity.templateId === 'dawn_battle_standard' &&
      dist2d(p.pos, entity.pos) <= DAWN_STANDARD_RADIUS
    ) {
      inRadius = true;
      break;
    }
  }

  if (!inRadius) {
    meta.dawnStandardSeconds = 0;
    return;
  }

  // Under the standard out of combat: +10% hp & mana regen pulse
  const bonusHp = Math.max(1, Math.round((p.stats.sta * 0.3 + 2) * 0.1));
  if (p.hp < p.maxHp) {
    p.hp = Math.min(p.maxHp, p.hp + bonusHp);
  }
  if (p.resourceType === 'mana' && p.resource < p.maxResource) {
    const bonusMana = Math.max(1, Math.round(p.stats.spi * 0.05));
    p.resource = Math.min(p.maxResource, p.resource + bonusMana);
  }

  meta.dawnStandardSeconds = (meta.dawnStandardSeconds ?? 0) + 2;
  if (meta.dawnStandardSeconds >= 10) {
    applyBlessingOfTheDawn(ctx, p);
  }
}

/** Apply the 15-minute Blessing of the Dawn buff (+5 Stamina). */
export function applyBlessingOfTheDawn(ctx: SimContext, p: Entity): void {
  ctx.applyAura(p, {
    id: 'blessing_of_the_dawn',
    name: 'Blessing of the Dawn',
    kind: 'buff_sta',
    duration: 900,
    remaining: 900,
    value: 5,
    sourceId: p.id,
    school: 'holy',
  });
  ctx.emit({
    type: 'log',
    text: 'You are bathed in the sacred light: Blessing of the Dawn (+5 Stamina).',
    color: '#ecd57a',
    pid: p.id,
  });
}

/** Potion of Invisibility: 6 seconds of stealth/invisibility. */
export function usePotionOfInvisibility(
  ctx: SimContext,
  p: Entity,
  meta: PlayerMeta,
  consumeUnit: () => void,
): void {
  if (ctx.time < p.potionCooldownUntil) {
    ctx.error(meta.entityId, 'That potion is not ready yet.');
    return;
  }
  consumeUnit();
  p.potionCooldownUntil = ctx.time + 120;
  ctx.applyAura(p, {
    id: 'invisibility',
    name: 'Invisibility',
    kind: 'stealth',
    duration: 6,
    remaining: 6,
    value: 1,
    sourceId: p.id,
    school: 'arcane',
  });
  ctx.emit({
    type: 'log',
    text: 'You fade from sight for 6 sec.',
    color: '#8af',
    pid: meta.entityId,
  });
}

/** Dense Sharpening Stone: +6 Attack Power for 30 minutes on equipped weapon. */
export function useDenseSharpeningStone(
  ctx: SimContext,
  p: Entity,
  meta: PlayerMeta,
  consumeUnit: () => void,
): void {
  if (!meta.equipment.mainhand) {
    ctx.error(meta.entityId, 'You must have a main hand weapon equipped.');
    return;
  }
  consumeUnit();
  ctx.applyAura(p, {
    id: 'dense_sharpening_stone',
    name: 'Sharpened Blade',
    kind: 'buff_ap',
    duration: 1800,
    remaining: 1800,
    value: 6,
    sourceId: p.id,
    school: 'physical',
  });
  ctx.emit({
    type: 'log',
    text: 'You sharpen your weapon (+6 Attack Power for 30 min).',
    color: '#ddd',
    pid: meta.entityId,
  });
}

/** Clockwork Shock Bomb: detonates dealing nature damage to enemies within 5 yards. */
export function useClockworkShockBomb(
  ctx: SimContext,
  p: Entity,
  meta: PlayerMeta,
  consumeUnit: () => void,
  aimPoint?: { x: number; z: number },
): void {
  const readyAt = meta.shockBombReadyAt ?? 0;
  if (ctx.time < readyAt) {
    ctx.error(meta.entityId, 'That item is not ready yet.');
    return;
  }
  consumeUnit();
  meta.shockBombReadyAt = ctx.time + 60; // 1 min cooldown
  p.cooldowns.set('clockwork_shock_bomb', 60);

  let bombPos: Vec3;
  if (aimPoint) {
    const dx = aimPoint.x - p.pos.x;
    const dz = aimPoint.z - p.pos.z;
    const dist = Math.hypot(dx, dz);
    const maxRange = 30;
    if (dist > maxRange) {
      const scale = maxRange / dist;
      bombPos = ctx.groundPos(p.pos.x + dx * scale, p.pos.z + dz * scale);
    } else {
      bombPos = ctx.groundPos(aimPoint.x, aimPoint.z);
    }
  } else {
    const forwardX = p.pos.x + Math.sin(p.facing) * 8;
    const forwardZ = p.pos.z + Math.cos(p.facing) * 8;
    bombPos = ctx.groundPos(forwardX, forwardZ);
  }

  let hitCount = 0;
  for (const entity of ctx.entities.values()) {
    if (entity.kind === 'mob' && !entity.dead && dist2d(entity.pos, bombPos) <= 5) {
      const dmg = 120 + Math.floor(Math.abs(Math.sin(ctx.time * 100)) * 40);
      ctx.dealDamage(p, entity, dmg, false, 'nature', 'Clockwork Shock Bomb', 'hit', false);
      hitCount++;
    }
  }

  ctx.emit({
    type: 'spellfxAt',
    x: bombPos.x,
    z: bombPos.z,
    radius: 5,
    ability: 'clockwork_shock_bomb',
    school: 'nature',
    fx: 'burst',
  });

  ctx.emit({
    type: 'log',
    text:
      hitCount > 0
        ? `The Clockwork Shock Bomb detonates with an electric blast, striking ${hitCount} enemies!`
        : 'The Clockwork Shock Bomb detonates with an electric blast!',
    color: '#ffd700',
    pid: meta.entityId,
  });
}

/** Reinforced Armor Kit: permanently reinforces armor for 1 hour. */
export function useReinforcedArmorKit(
  ctx: SimContext,
  p: Entity,
  meta: PlayerMeta,
  consumeUnit: () => void,
): void {
  consumeUnit();
  ctx.applyAura(p, {
    id: 'reinforced_armor_patch',
    name: 'Reinforced Armor',
    kind: 'buff_armor',
    duration: 3600,
    remaining: 3600,
    value: 12,
    sourceId: p.id,
    school: 'physical',
  });
  ctx.emit({
    type: 'log',
    text: 'You reinforce your armor with leather plating (+12 Armor for 1 hour).',
    color: '#c89',
    pid: meta.entityId,
  });
}

/** Elixir of Greater Mana: +6 Spirit for 1 hour. */
export function useManaRegenerationElixir(
  ctx: SimContext,
  p: Entity,
  meta: PlayerMeta,
  consumeUnit: () => void,
): void {
  consumeUnit();
  ctx.applyAura(p, {
    id: 'elixir_mana_regeneration',
    name: 'Elixir of Mana Regeneration',
    kind: 'buff_spi',
    duration: 3600,
    remaining: 3600,
    value: 6,
    sourceId: p.id,
    school: 'holy',
  });
  ctx.emit({
    type: 'log',
    text: 'You drink the Elixir of Mana Regeneration (+6 Spirit for 1 hour).',
    color: '#8af',
    pid: meta.entityId,
  });
}
