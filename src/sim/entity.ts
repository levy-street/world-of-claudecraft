import { CLASSES, ITEMS, MOBS, NpcDef } from './data';
import type { Entity, EquipSlot, MobTemplate, PlayerClass, Stats, Vec3 } from './types';

function baseEntity(id: number, pos: Vec3): Entity {
  return {
    id, kind: 'mob', templateId: '', name: '', level: 1,
    pos: { ...pos }, prevPos: { ...pos }, facing: 0, prevFacing: 0,
    vy: 0, onGround: true, fallStartY: pos.y,
    hp: 1, maxHp: 1, resource: 0, maxResource: 0, resourceType: null,
    stats: { str: 0, agi: 0, sta: 0, int: 0, spi: 0, armor: 0 },
    weapon: { min: 1, max: 2, speed: 2 },
    attackPower: 0, rangedPower: 0, critChance: 0.05, dodgeChance: 0.05, moveSpeed: 7, hostile: false,
    targetId: null, autoAttack: false, swingTimer: 0,
    inCombat: false, combatTimer: 99,
    auras: [], ccDr: new Map(), castingAbility: null, castRemaining: 0, castTotal: 0,
    channeling: false, channelTickTimer: 0, channelTickEvery: 0,
    gcdRemaining: 0, cooldowns: new Map(), queuedOnSwing: null, fiveSecondRule: 99,
    comboPoints: 0, comboTargetId: null, overpowerUntil: -1, potionCooldownUntil: -1, savedMana: 0,
    chargeTargetId: null, chargeTimeLeft: 0, chargePath: [],
    sitting: false, eating: null, drinking: null,
    aiState: 'idle', tappedById: null, pulseTimer: 0, firedSummons: 0, summonedIds: [], enraged: false, healedThisPull: false,
    threat: new Map(), forcedTargetId: null, forcedTargetTimer: 0, ownerId: null, petTauntTimer: 0,
    spawnPos: { ...pos }, leashAnchor: null, evadeStall: 0, wanderTarget: null, wanderTimer: 0,
    aggroTargetId: null, respawnTimer: 0, corpseTimer: 0, lootable: false, loot: null,
    xpValue: 0, questIds: [], vendorItems: [], objectItemId: null, dungeonId: null,
    dead: false, scale: 1, color: 0xffffff,
  };
}

export function createPlayer(id: number, cls: PlayerClass, pos: Vec3, name: string): Entity {
  const def = CLASSES[cls];
  const e = baseEntity(id, pos);
  e.kind = 'player';
  e.templateId = cls;
  e.name = name;
  e.level = 1;
  e.resourceType = def.resourceType;
  e.color = def.color;
  return e;
}

export type PlayerEquipment = Partial<Record<EquipSlot, string>>;

// Vanilla rules: first 20 stamina gives 1 hp each, the rest 10 hp each.
// First 20 intellect gives 1 mana each, the rest 15 mana each.
function hpFromStamina(sta: number): number {
  return Math.min(sta, 20) + Math.max(0, sta - 20) * 10;
}
function manaFromIntellect(int: number): number {
  return Math.min(int, 20) + Math.max(0, int - 20) * 15;
}

// Recompute all derived stats for the player from class, level, gear and buffs.
export function recalcPlayerStats(e: Entity, cls: PlayerClass, equipment: PlayerEquipment): void {
  const def = CLASSES[cls];
  const lvl = e.level;
  const s: Stats = {
    str: def.baseStats.str + def.statsPerLevel.str * (lvl - 1),
    agi: def.baseStats.agi + def.statsPerLevel.agi * (lvl - 1),
    sta: def.baseStats.sta + def.statsPerLevel.sta * (lvl - 1),
    int: def.baseStats.int + def.statsPerLevel.int * (lvl - 1),
    spi: def.baseStats.spi + def.statsPerLevel.spi * (lvl - 1),
    armor: def.baseStats.armor + def.statsPerLevel.armor * (lvl - 1),
  };
  for (const slot of ['mainhand', 'chest', 'legs', 'feet'] as EquipSlot[]) {
    const itemId = equipment[slot];
    if (!itemId) continue;
    const item = ITEMS[itemId];
    if (!item?.stats) continue;
    s.str += item.stats.str ?? 0;
    s.agi += item.stats.agi ?? 0;
    s.sta += item.stats.sta ?? 0;
    s.int += item.stats.int ?? 0;
    s.spi += item.stats.spi ?? 0;
    s.armor += item.stats.armor ?? 0;
  }
  // Buff auras
  let bonusAp = 0;
  let bonusDodge = 0;
  let bearForm = false;
  let catForm = false;
  for (const a of e.auras) {
    if (a.kind === 'buff_ap') bonusAp += a.value;
    else if (a.kind === 'buff_armor') s.armor += a.value;
    else if (a.kind === 'buff_int') s.int += a.value;
    else if (a.kind === 'buff_sta') s.sta += a.value;
    else if (a.kind === 'buff_allstats') {
      s.str += a.value; s.agi += a.value; s.sta += a.value; s.int += a.value; s.spi += a.value;
    } else if (a.kind === 'buff_dodge') bonusDodge += a.value;
    else if (a.kind === 'form_bear') bearForm = true;
    else if (a.kind === 'form_cat') catForm = true;
  }
  s.armor += s.agi * 2;
  if (bearForm) {
    s.armor = Math.round(s.armor * 1.65);
    bonusAp += 15;
  }
  if (catForm) {
    bonusAp += 10 + lvl * 2;
  }

  e.stats = s;
  const weapon = (equipment.mainhand && ITEMS[equipment.mainhand]?.weapon) || { min: 1, max: 2, speed: 2 };
  e.weapon = weapon;
  // Melee AP by class (vanilla-ish): warriors/paladins/shamans/druids 2/str,
  // rogues str+agi, hunters str+agi, pure casters str.
  const apFromStats =
    cls === 'warrior' || cls === 'paladin' || cls === 'shaman' || cls === 'druid' ? s.str * 2
      : cls === 'rogue' || cls === 'hunter' ? s.str + s.agi
        : s.str;
  e.attackPower = apFromStats + bonusAp;
  // Hunters: ranged AP = 2/agi (vanilla)
  e.rangedPower = cls === 'hunter' ? s.agi * 2 + bonusAp : 0;
  // Crit: ~1% per 20 agi at low level
  e.critChance = 0.05 + s.agi * 0.0005;
  e.dodgeChance = 0.05 + s.agi * 0.0005 + bonusDodge;

  const hpFrac = e.maxHp > 0 ? e.hp / e.maxHp : 1;
  e.maxHp = def.baseHp + def.hpPerLevel * (lvl - 1) + hpFromStamina(s.sta);
  e.hp = Math.max(1, Math.round(e.maxHp * hpFrac));
  if (e.dead) e.hp = 0;

  // Druid forms swap the resource bar, classic-style: bear runs on rage
  // (starts empty, fills from combat), cat on energy (starts full — friendlier
  // than vanilla's 0). Mana is parked in savedMana and restored on shift-out.
  const formResource: 'rage' | 'energy' | null = bearForm ? 'rage' : catForm ? 'energy' : null;
  if (formResource) {
    if (e.resourceType === 'mana') e.savedMana = e.resource;
    if (e.resourceType !== formResource) e.resource = formResource === 'energy' ? 100 : 0;
    e.resourceType = formResource;
    e.maxResource = 100;
  } else if (def.resourceType === 'mana') {
    const cameFromForm = e.resourceType !== 'mana';
    const manaFrac = e.maxResource > 0 ? e.resource / e.maxResource : 1;
    e.resourceType = 'mana';
    e.maxResource = def.baseMana + def.manaPerLevel * (lvl - 1) + manaFromIntellect(s.int);
    e.resource = cameFromForm
      ? Math.min(e.savedMana, e.maxResource)
      : Math.round(e.maxResource * manaFrac);
  } else {
    e.resourceType = def.resourceType;
    e.maxResource = 100; // rage and energy both cap at 100
    e.resource = Math.min(e.resource, 100);
  }
}

export function createMob(id: number, template: MobTemplate, level: number, pos: Vec3): Entity {
  const e = baseEntity(id, pos);
  e.kind = 'mob';
  e.templateId = template.id;
  e.name = template.name;
  e.level = level;
  e.hostile = true;
  // Elite scaling, vanilla-style: ~2.3x health, ~1.5x damage.
  const hpMult = template.elite ? 2.3 : 1;
  const dmgMult = template.elite ? 1.5 : 1;
  e.maxHp = Math.round((template.hpBase + template.hpPerLevel * (level - 1)) * hpMult);
  e.hp = e.maxHp;
  const dmg = (template.dmgBase + template.dmgPerLevel * (level - 1)) * dmgMult;
  e.weapon = { min: Math.round(dmg * 0.8), max: Math.round(dmg * 1.25), speed: template.attackSpeed };
  e.stats.armor = Math.round(template.armorPerLevel * level);
  e.moveSpeed = template.moveSpeed;
  e.scale = template.scale;
  e.color = template.color;
  e.swingTimer = 0;
  return e;
}

export function createNpc(id: number, def: NpcDef, pos: Vec3): Entity {
  const e = baseEntity(id, pos);
  e.kind = 'npc';
  e.templateId = def.id;
  e.name = def.name;
  e.level = 10;
  e.hostile = false;
  e.maxHp = 500;
  e.hp = 500;
  e.facing = def.facing;
  e.prevFacing = def.facing;
  e.color = def.color;
  e.questIds = [...def.questIds];
  e.vendorItems = [...(def.vendorItems ?? [])];
  return e;
}

export function createGroundObject(id: number, itemId: string, name: string, pos: Vec3): Entity {
  const e = baseEntity(id, pos);
  e.kind = 'object';
  e.templateId = 'ground_' + itemId;
  e.name = name;
  e.level = 1;
  e.hostile = false;
  e.maxHp = 1;
  e.hp = 1;
  e.objectItemId = itemId;
  e.lootable = true;
  return e;
}

export { MOBS };
