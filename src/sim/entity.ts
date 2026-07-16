import type { TalentModifiers } from './content/talents';
import { resolveActiveWeaponSkin } from './content/weapon_skin_rules';
import { aggregateSetBonuses, CLASSES, ITEMS, MOBS, type NpcDef } from './data';
import { meetsLevelRequirement } from './item_level_req';
import { pvpFractionsFromRatings } from './pvp';
import type {
  Entity,
  EquipSlot,
  ItemInstancePayload,
  MobTemplate,
  PlayerClass,
  Stats,
  Vec3,
} from './types';
import {
  cloneItemInstancePayload,
  critFractionFromRating,
  EQUIP_SLOTS,
  hasteFractionFromRating,
  hitFractionFromRating,
  SPELL_POWER_PER_INT,
} from './types';

function baseEntity(id: number, pos: Vec3): Entity {
  return {
    id,
    kind: 'mob',
    templateId: '',
    name: '',
    level: 1,
    pos: { ...pos },
    prevPos: { ...pos },
    facing: 0,
    prevFacing: 0,
    vx: 0,
    vz: 0,
    vy: 0,
    onGround: true,
    jumping: false,
    fallStartY: pos.y,
    hp: 1,
    maxHp: 1,
    resource: 0,
    maxResource: 0,
    resourceType: null,
    overheadEmoteId: null,
    overheadEmoteUntil: 0,
    overheadEmoteSeq: 0,
    stats: {
      str: 0,
      agi: 0,
      sta: 0,
      int: 0,
      spi: 0,
      armor: 0,
      pvpOffense: 0,
      pvpDefense: 0,
    },
    weapon: { min: 1, max: 2, speed: 2 },
    attackPower: 0,
    rangedPower: 0,
    spellPower: 0,
    meleeHaste: 0,
    rangedHaste: 0,
    spellHaste: 0,
    setProcs: [],
    procReadyAt: undefined as unknown as Record<string, number>,
    critChance: 0.05,
    critRating: 0,
    hasteRating: 0,
    hitRating: 0,
    hitBonus: 0,
    critDmgSpellBonus: 0,
    critDmgPhysBonus: 0,
    critDmgHealBonus: 0,
    dodgeChance: 0.05,
    castPushbackReduction: 0,
    knockbackResistance: 0,
    moveSpeed: 7,
    hostile: false,
    targetId: null,
    autoAttack: false,
    swingTimer: 0,
    inCombat: false,
    combatTimer: 99,
    auras: [],
    stealthed: false,
    ccDr: new Map(),
    castingAbility: null,
    castRemaining: 0,
    castTotal: 0,
    castTargetId: null,
    castAim: null,
    channeling: false,
    channelTickTimer: 0,
    channelTickEvery: 0,
    gcdRemaining: 0,
    cooldowns: new Map(),
    queuedOnSwing: null,
    queuedCastAbility: null,
    queuedCastAim: null,
    fiveSecondRule: 99,
    comboPoints: 0,
    comboUntil: -1,
    overpowerUntil: -1,
    potionCooldownUntil: -1,
    potionCdRemaining: 0,
    savedMana: 0,
    chargeTargetId: null,
    chargeTimeLeft: 0,
    chargePath: [],
    followTargetId: null,
    sitting: false,
    eating: null,
    drinking: null,
    weaponStowed: false,
    aiState: 'idle',
    tappedById: null,
    pulseTimer: 0,
    stompTimer: 0,
    bigCastTimer: 0,
    yelledEngage: false,
    stoneskinTimer: 0,
    terrifyTimer: 0,
    aoeSlowTimer: 0,
    loudYellTimer: 0,
    loudYellIndex: 0,
    detonateTimer: Infinity,
    mendTimer: 0,
    wardTimer: 0,
    channelTimer: 0,
    channelRamp: 0,
    rallyTimer: 0,
    warcryTimer: 0,
    firedSummons: 0,
    summonedIds: [],
    enraged: false,
    healedThisPull: false,
    threat: new Map(),
    bossDamagers: new Set(),
    forcedTargetId: null,
    forcedTargetTimer: 0,
    ownerId: null,
    petMode: 'defensive',
    petTauntTimer: 0,
    petPath: [],
    petPathCooldown: 0,
    spawnPos: { ...pos },
    leashAnchor: null,
    evadeStall: 0,
    fleeTimer: 0,
    fleeReturnTimer: 0,
    hasFled: false,
    wanderTarget: null,
    wanderTimer: 0,
    aggroTargetId: null,
    respawnTimer: 0,
    corpseTimer: 0,
    lootFfaTimer: Infinity, // no FFA countdown until rollLoot starts it at death
    harvestClaimedBy: null,
    lootable: false,
    loot: null,
    xpValue: 0,
    questIds: [],
    vendorItems: [],
    objectItemId: null,
    dungeonId: null,
    dead: false,
    ghost: false,
    corpsePos: null,
    corpseInstanceId: null,
    scale: 1,
    color: 0xffffff,
    skinCatalog: 'class',
    skin: 0,
    mainhandItemId: null,
    weaponSkinLoadout: {},
    weaponSkinId: null,
    equippedItems: {},
    equippedInstances: {},
    guild: '',
    title: null,
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

// Classic-era rules: first 20 stamina gives 1 hp each, the rest 10 hp each.
// First 20 intellect gives 1 mana each, the rest 15 mana each.
function hpFromStamina(sta: number): number {
  // Floor at 0 so a Stamina-draining debuff (negative buff_sta) can never push
  // the HP pool below its level-based base into negative territory.
  const s = Math.max(0, sta);
  return Math.min(s, 20) + Math.max(0, s - 20) * 10;
}
function manaFromIntellect(int: number): number {
  // Floor at 0 so an Intellect-draining debuff (negative buff_int) can never push
  // the mana pool below its level-based base into negative territory.
  const i = Math.max(0, int);
  return Math.min(i, 20) + Math.max(0, i - 20) * 15;
}

// Recompute all derived stats for the player from class, level, gear, buffs, and
// precomputed talent modifiers. `mods` is the flat struct resolved at
// allocation/respec time (computeTalentModifiers) — this never walks the tree.
export function recalcPlayerStats(
  e: Entity,
  cls: PlayerClass,
  equipment: PlayerEquipment,
  mods: TalentModifiers | undefined,
  equipmentInstance: Partial<Record<EquipSlot, ItemInstancePayload>>,
): void {
  const def = CLASSES[cls];
  const lvl = e.level;
  const s: Stats = {
    str: def.baseStats.str + def.statsPerLevel.str * (lvl - 1),
    agi: def.baseStats.agi + def.statsPerLevel.agi * (lvl - 1),
    sta: def.baseStats.sta + def.statsPerLevel.sta * (lvl - 1),
    int: def.baseStats.int + def.statsPerLevel.int * (lvl - 1),
    spi: def.baseStats.spi + def.statsPerLevel.spi * (lvl - 1),
    armor: def.baseStats.armor + def.statsPerLevel.armor * (lvl - 1),
    pvpOffense: 0,
    pvpDefense: 0,
  };
  const setCounts = new Map<string, number>();
  let bonusSp = 0; // flat Spell Power from gear affixes + buff_spellpower auras
  let bonusCritRating = 0;
  let bonusHasteRating = 0;
  let bonusHitRating = 0;
  let bonusPvpOffenseRating = 0;
  let bonusPvpDefenseRating = 0;
  for (const slot of EQUIP_SLOTS) {
    const itemId = equipment[slot];
    if (!itemId) continue;
    const item = ITEMS[itemId];
    if (!item) continue;
    // Gear above the wearer's level is inert: it stays equipped (still rendered
    // and occupying the slot, see the render mirrors below) but grants no stats,
    // armor, spell power, or set pieces until the character reaches its required
    // level. This only arises for a character loaded wearing gear equipped before
    // the level gate existed; the equip path blocks equipping over-level gear.
    if (!meetsLevelRequirement(lvl, item)) continue;
    if (item.set) setCounts.set(item.set, (setCounts.get(item.set) ?? 0) + 1);
    bonusSp += item.spellPower ?? 0;
    bonusCritRating += item.critRating ?? 0;
    bonusHasteRating += item.hasteRating ?? 0;
    bonusHitRating += item.hitRating ?? 0;
    bonusPvpOffenseRating += item.pvpOffenseRating ?? 0;
    bonusPvpDefenseRating += item.pvpDefenseRating ?? 0;
    if (item.stats) {
      s.str += item.stats.str ?? 0;
      s.agi += item.stats.agi ?? 0;
      s.sta += item.stats.sta ?? 0;
      s.int += item.stats.int ?? 0;
      s.spi += item.stats.spi ?? 0;
      s.armor += item.stats.armor ?? 0;
    }
    // Enchant bonus (Enchanting profession): additive on top of the item's own
    // base stats, from this specific instance's rolled.stats (see
    // src/sim/professions/enchanting.ts applyEnchant). A plain, unenchanted
    // piece has no entry here, so this is a no-op for the common case.
    const enchantStats = equipmentInstance?.[slot]?.rolled?.stats;
    if (enchantStats) {
      s.str += enchantStats.str ?? 0;
      s.agi += enchantStats.agi ?? 0;
      s.sta += enchantStats.sta ?? 0;
      s.int += enchantStats.int ?? 0;
      s.spi += enchantStats.spi ?? 0;
      s.armor += enchantStats.armor ?? 0;
    }
  }
  // Item-set bonuses from equipped pieces. Flat primary stats join the gear
  // totals so they feed every derivation below; AP/crit/pushback fold in at
  // their own steps (bonusAp, critChance, castPushbackReduction, knockbackResistance).
  const setEff = aggregateSetBonuses(setCounts);
  s.str += setEff.str;
  s.agi += setEff.agi;
  s.sta += setEff.sta;
  s.int += setEff.int;
  s.spi += setEff.spi;
  bonusSp += setEff.sp; // caster set 2-piece spell power (mirrors setEff.ap for melee)
  // Buff auras
  let bonusAp = setEff.ap;
  let bonusDodge = 0;
  let bearForm = false;
  let catForm = false;
  let moonkinForm = false;
  let scaleMul = 1; // Fiesta buff_scale: body-size multiplier (>1 also adds hp)
  // Percent raid buffs (Mark of the Wild / Arcane Intellect / Power Word: Fortitude /
  // Devotion Aura / Battle Shout / Blessing of Might). Accumulated as fractions here,
  // then folded multiplicatively at the relevant derivation step below.
  let allStatsPct = 0;
  let intPct = 0;
  let staPct = 0;
  let buffArmorPct = 0;
  let buffApPct = 0;
  for (const a of e.auras) {
    if (a.kind === 'buff_ap') bonusAp += a.value;
    // Attack-power debuff (Demoralizing Shout/Roar). Mobs fold this live in
    // effectiveAttackPower; players bake it here, so without this arm the debuff
    // was a no-op versus enemy players (PvP).
    else if (a.kind === 'debuff_ap') bonusAp -= a.value;
    else if (a.kind === 'buff_armor') s.armor += a.value;
    else if (a.kind === 'buff_int') s.int += a.value;
    else if (a.kind === 'buff_agi') s.agi += a.value;
    else if (a.kind === 'buff_spi') s.spi += a.value;
    else if (a.kind === 'buff_sta') s.sta += a.value;
    else if (a.kind === 'buff_allstats') {
      s.str += a.value;
      s.agi += a.value;
      s.sta += a.value;
      s.int += a.value;
      s.spi += a.value;
    } else if (a.kind === 'buff_spellpower') bonusSp += a.value;
    else if (a.kind === 'buff_allstats_pct') {
      // Percentage drain on the whole stat block (Resurrection Sickness: value
      // -0.75 leaves stats at 25%). Applied to the base + gear total gathered so
      // far; the only aura that ever carries this kind is player-only, so it never
      // stacks with another pct drain in practice.
      const m = 1 + a.value;
      s.str = Math.round(s.str * m);
      s.agi = Math.round(s.agi * m);
      s.sta = Math.round(s.sta * m);
      s.int = Math.round(s.int * m);
      s.spi = Math.round(s.spi * m);
    } else if (a.kind === 'buff_dodge') bonusDodge += a.value;
    else if (a.kind === 'buff_scale') scaleMul *= a.value;
    // Metamorphosis: a temporary demon transform that also makes the caster larger.
    else if (a.kind === 'form_metamorph') scaleMul *= 1.35;
    // Percent raid buffs store integer percent POINTS (5 = +5%) so they survive the
    // integer-rounding talent value multiplier; converted to a fraction here.
    else if (a.kind === 'buff_stats_pct') allStatsPct += a.value / 100;
    else if (a.kind === 'buff_int_pct') intPct += a.value / 100;
    else if (a.kind === 'buff_sta_pct') staPct += a.value / 100;
    else if (a.kind === 'buff_armor_pct') buffArmorPct += a.value / 100;
    else if (a.kind === 'buff_ap_pct') buffApPct += a.value / 100;
    else if (a.kind === 'form_bear') bearForm = true;
    else if (a.kind === 'form_cat') catForm = true;
    // Moonkin Form carries its Spell Power bonus in the form aura's value, so it lives and
    // dies with the one toggle (a Balance druid's whole kit is arcane/nature, so a generic
    // Spell Power bonus is correct). Gloamveil Form (form_shadow) is NOT a Spell Power
    // buff: it amplifies the priest's Shadow-school DAMAGE by a percent, applied in
    // combat/damage.ts, so it contributes nothing to the stat pass here.
    else if (a.kind === 'form_moonkin') {
      bonusSp += a.value;
      moonkinForm = true;
    }
  }
  // Talent passive stat modifiers (flat additions + a stamina percent before the
  // HP derivation below). AP/armor/maxHp percents are applied at their own steps.
  if (mods) {
    const m = mods.stats;
    s.str += m.str;
    s.agi += m.agi;
    s.sta += m.sta;
    s.int += m.int;
    s.spi += m.spi;
    s.armor += m.armor;
    bonusAp += m.ap;
    bonusDodge += m.dodge;
    if (m.staPct) s.sta = Math.round(s.sta * (1 + m.staPct));
    // Primary-attribute multipliers, applied to the fully-summed attribute. agiPct lands
    // before the agi-derived armor/dodge below so the percentage flows into them.
    if (m.strPct) s.str = Math.round(s.str * (1 + m.strPct));
    if (m.agiPct) s.agi = Math.round(s.agi * (1 + m.agiPct));
    if (m.intPct) s.int = Math.round(s.int * (1 + m.intPct));
    if (m.spiPct) s.spi = Math.round(s.spi * (1 + m.spiPct));
  }
  // Percent stat raid buffs, folded multiplicatively on the computed (base + gear +
  // flat + talent) primary stats so they feed every downstream derivation (AP from
  // str/agi, Spell Power from int, HP from sta, crit/dodge from agi).
  if (allStatsPct || intPct || staPct) {
    s.str = Math.round(s.str * (1 + allStatsPct));
    s.agi = Math.round(s.agi * (1 + allStatsPct));
    s.sta = Math.round(s.sta * (1 + allStatsPct + staPct));
    s.int = Math.round(s.int * (1 + allStatsPct + intPct));
    s.spi = Math.round(s.spi * (1 + allStatsPct));
  }
  // Floor Agility at 0 so a draining debuff (negative buff_agi) can never push the
  // derived armor/dodge below what zero Agility would give.
  s.agi = Math.max(0, s.agi);
  s.armor += s.agi * 2;
  if (bearForm) {
    s.armor = Math.round(s.armor * 1.9);
    bonusAp += 15 + Math.round(s.agi * 1.5);
  }
  if (catForm) {
    bonusAp += 8 + lvl * 2;
    s.agi += Math.max(2, Math.floor(lvl / 2));
  }
  // Moonkin Form: a hardy caster form that adds 50% armor (its +20% spell damage rides a
  // separate buff_spelldmg aura the form applies).
  if (moonkinForm) s.armor = Math.round(s.armor * 1.5);
  if (mods?.stats.armorPct) s.armor = Math.round(s.armor * (1 + mods.stats.armorPct));
  if (buffArmorPct) s.armor = Math.round(s.armor * (1 + buffArmorPct)); // Devotion Aura
  // Floor Spirit at 0 so a Spirit-siphoning debuff (negative buff_spi) can never
  // drive out-of-combat regen (updateRegen reads stats.spi) below zero.
  s.spi = Math.max(0, s.spi);

  e.stats = s;
  const warfare = pvpFractionsFromRatings(bonusPvpOffenseRating, bonusPvpDefenseRating);
  e.stats.pvpOffense = warfare.offense;
  e.stats.pvpDefense = warfare.defense;
  // An over-level mainhand is inert like any other gear: fall back to unarmed
  // damage (and drop the weapon-type flags, e.g. dagger, that gate abilities)
  // until the wearer is high enough level. The mainhand still stays worn (see
  // e.mainhandItemId below) so the weapon model keeps rendering.
  const mainhand = equipment.mainhand ? ITEMS[equipment.mainhand] : undefined;
  const weapon =
    mainhand?.weapon && meetsLevelRequirement(lvl, mainhand)
      ? mainhand.weapon
      : { min: 1, max: 2, speed: 2 };
  e.weapon = weapon;
  // The equipped mainhand item id: drives the held weapon model on the client
  // (mapped via ITEM_WEAPON_VARIANTS) AND legendary weapon procs in combat
  // (combat/equip_procs.ts, which re-applies the level gate above so an inert
  // over-level weapon's procs are inert too). Gated on the item actually being
  // a weapon, mirroring the e.weapon derivation above (so a non-weapon mainhand,
  // were one ever stored, never resolves to a held model).
  e.mainhandItemId =
    equipment.mainhand && ITEMS[equipment.mainhand]?.weapon ? equipment.mainhand : null;
  // Resolve the active weapon-skin cosmetic against the (possibly changed)
  // mainhand: swapping to a different weapon type drops a non-matching skin and
  // re-shows the matching one automatically. Cosmetic only; never feeds stats.
  e.weaponSkinId = resolveActiveWeaponSkin(cls, e.mainhandItemId, e.weaponSkinLoadout);
  // Render-only mirror of the full worn set, copied so a later mutation of the
  // owning PlayerMeta.equipment never aliases into the entity. Synced in the
  // identity wire (terse `eq`) for the inspect-another-player window.
  e.equippedItems = { ...equipment };
  // Render-only mirror of PlayerMeta.equipmentInstance, same copy-not-alias
  // reasoning as equippedItems above. Deep-cloned via cloneItemInstancePayload
  // (not a shallow spread) since a payload's own rolled.stats map must not be
  // aliased into the mirror.
  e.equippedInstances = equipmentInstance
    ? Object.fromEntries(
        Object.entries(equipmentInstance).map(([slot, inst]) => [
          slot,
          cloneItemInstancePayload(inst),
        ]),
      )
    : {};
  // Melee AP by class (classic-era-ish): warriors/paladins/shamans/druids 2/str,
  // rogues str+agi, hunters str+agi, pure casters str.
  const apFromStats =
    cls === 'warrior' || cls === 'paladin' || cls === 'shaman' || cls === 'druid'
      ? s.str * 2
      : cls === 'rogue' || cls === 'hunter'
        ? s.str + s.agi
        : s.str;
  // Floor at 0 so a heavy debuff_ap stack can never bake a negative attack power
  // (mirrors effectiveAttackPower's mob floor and the agi/spi floors above).
  // buffApPct (Battle Shout / Blessing of Might) folds into the same AP multiplier.
  e.attackPower = Math.max(
    0,
    Math.round((apFromStats + bonusAp) * (1 + (mods?.stats.apPct ?? 0) + buffApPct)),
  );
  // Hunters: ranged AP = 2/agi (classic-era value)
  e.rangedPower =
    cls === 'hunter'
      ? Math.max(0, Math.round((s.agi * 2 + bonusAp) * (1 + (mods?.stats.apPct ?? 0) + buffApPct)))
      : 0;
  // Spell Power: Intellect converted via SPELL_POWER_PER_INT plus flat Spell Power
  // from gear/buffs. Floored at 0 so an Intellect-draining debuff can't go negative.
  e.spellPower = Math.max(0, Math.round(s.int * SPELL_POWER_PER_INT + bonusSp));
  e.critRating = bonusCritRating + setEff.critRating;
  e.hasteRating = bonusHasteRating + setEff.hasteRating;
  // Hit rating (gear + set bonuses) folds into a hit fraction that combat subtracts
  // from miss (swingMissChance) and spell resist (spell_resist.ts). It answers the
  // Heroic +3 above-level penalty; unlike crit it has no higher-level suppression.
  e.hitRating = bonusHitRating + setEff.hitRating;
  e.hitBonus = hitFractionFromRating(e.hitRating);
  const hasteFrac = setEff.haste + hasteFractionFromRating(e.hasteRating);
  // Haste drives all three channels: faster melee and ranged auto-attack swings
  // AND shorter spell casts/channels.
  // Union of the rating system (#1471) and the spec masteries (#1543): ratings and
  // set haste feed hasteFrac; a spec mastery's passive haste adds on its channel.
  e.meleeHaste = hasteFrac + (mods?.global.meleeHastePct ?? 0);
  e.rangedHaste = hasteFrac;
  // Spell haste also folds in a spec mastery's passive haste (spellHastePct), so a
  // caster spec can shorten every cast; the cast-time tooltips read the same total.
  e.spellHaste = hasteFrac + (mods?.global.spellHastePct ?? 0);
  e.setProcs = setEff.procs;
  if (e.setProcs.length > 0 && !e.procReadyAt) e.procReadyAt = {};
  // Crit: ~1% per 20 agi at low level
  e.critChance =
    0.05 +
    s.agi * 0.0005 +
    (mods?.stats.crit ?? 0) +
    setEff.crit +
    critFractionFromRating(e.critRating);
  // Extra crit damage from a spec mastery, per output channel (e.g. Fire mage: SPELL
  // crits deal more; Holy paladin: HEAL crits; Subtlety/Arms: PHYSICAL crits).
  e.critDmgSpellBonus = mods?.global.critDmgSpellPct ?? 0;
  e.critDmgPhysBonus = mods?.global.critDmgPhysPct ?? 0;
  e.critDmgHealBonus = mods?.global.critDmgHealPct ?? 0;
  e.castPushbackReduction = setEff.castPushbackReduction;
  e.knockbackResistance = setEff.knockbackResistance;
  // Floored at 0: an off-balance debuff (negative buff_dodge) can drive dodge to nothing.
  e.dodgeChance = Math.max(0, 0.05 + s.agi * 0.0005 + bonusDodge);

  const hpFrac = e.maxHp > 0 ? e.hp / e.maxHp : 1;
  e.maxHp = def.baseHp + def.hpPerLevel * (lvl - 1) + hpFromStamina(s.sta);
  if (bearForm) e.maxHp = Math.round(e.maxHp * 1.15);
  if (mods?.stats.maxHpPct) e.maxHp = Math.round(e.maxHp * (1 + mods.stats.maxHpPct));
  // Fiesta "Colossus"-style buffs: growing bigger also makes you tankier.
  if (scaleMul > 1) e.maxHp = Math.round(e.maxHp * scaleMul);
  e.hp = Math.max(1, Math.round(e.maxHp * hpFrac));
  if (e.dead) e.hp = 0;
  // Body size: players default to 1; a buff_scale aura grows/shrinks them live.
  if (e.kind === 'player') e.scale = scaleMul;

  // Druid forms swap the resource bar, classic-style: bear runs on rage
  // (starts empty, fills from combat), cat on energy (starts full — friendlier
  // than the classic-era 0). Mana is parked in savedMana and restored on shift-out.
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

// Derived stats + max vitals for an OFFLINE character (a stored CharacterState),
// computed by reusing recalcPlayerStats on a throwaway entity rather than
// re-deriving the numbers. With no auras and no active form, recalcPlayerStats
// yields exactly the class/level/gear/talent stat block — the same numbers a
// live player shows — so the character sheet stays in lockstep with the engine.
// Resource max is the full pool for the class (mana from intellect, or 100 for
// rage/energy); the sheet pairs it with the stored current value.
export interface DerivedCharacterStats {
  stats: Stats;
  maxHp: number;
  maxResource: number;
  resourceType: Entity['resourceType'];
}

export function characterDerivedStats(
  cls: PlayerClass,
  level: number,
  equipment: PlayerEquipment,
  mods?: TalentModifiers,
  equipmentInstance?: Partial<Record<EquipSlot, ItemInstancePayload>>,
): DerivedCharacterStats {
  const e = createPlayer(0, cls, { x: 0, y: 0, z: 0 }, '');
  e.level = Math.max(1, Math.floor(level));
  recalcPlayerStats(e, cls, equipment, mods, equipmentInstance ?? {});
  return {
    stats: e.stats,
    maxHp: e.maxHp,
    maxResource: e.maxResource,
    resourceType: e.resourceType,
  };
}

export function createMob(id: number, template: MobTemplate, level: number, pos: Vec3): Entity {
  const e = baseEntity(id, pos);
  e.kind = 'mob';
  e.templateId = template.id;
  e.name = template.name;
  e.level = level;
  e.hostile = true;
  // Elite scaling, classic-style: ~2.3x health, ~1.5x damage.
  const hpMult = template.elite ? 2.3 : 1;
  const dmgMult = template.elite ? 1.5 : 1;
  e.maxHp = Math.round((template.hpBase + template.hpPerLevel * (level - 1)) * hpMult);
  e.hp = e.maxHp;
  const dmg = (template.dmgBase + template.dmgPerLevel * (level - 1)) * dmgMult;
  e.weapon = {
    min: Math.round(dmg * 0.8),
    max: Math.round(dmg * 1.25),
    speed: template.attackSpeed,
  };
  // Armor scales from level 1 like hp/dmg above: a template has no armorBase,
  // so a level-1 mob gets 0 and each level adds armorPerLevel.
  e.stats.armor = Math.round(template.armorPerLevel * (level - 1));
  e.moveSpeed = template.moveSpeed;
  e.scale = template.scale;
  e.color = template.color;
  e.swingTimer = 0;
  // Telegraph the first War Stomp: delay it one full interval after engage.
  if (template.stomp) e.stompTimer = template.stomp.every;
  // Telegraph the first Banshee's Wail the same way: one full interval after engage.
  if (template.terrify) e.terrifyTimer = template.terrify.every;
  // Telegraph the first Howling Gale the same way: one full interval after engage.
  if (template.aoeSlow) e.aoeSlowTimer = template.aoeSlow.every;
  // First battle cry one interval in, so a loud boss's engage yell lands alone on the pull.
  if (template.battleYells) e.loudYellTimer = template.battleYells.every;
  // Telegraph the first Mend the same way: one full interval after engage.
  if (template.mendAlly) e.mendTimer = template.mendAlly.every;
  // Telegraph the first Ward the same way: one full interval after engage.
  if (template.wardAllies) e.wardTimer = template.wardAllies.every;
  // Telegraph the first channeled heal tick: one full interval after engage.
  if (template.channelHeal) e.channelTimer = template.channelHeal.every;
  // Telegraph the first Stoneskin: one full interval after engage.
  if (template.stoneskin) e.stoneskinTimer = template.stoneskin.every;
  // Telegraph the first hardcast (bigCast) the same way: one full interval after engage.
  if (template.bigCast) e.bigCastTimer = template.bigCast.every;
  // Telegraph the first Rally the same way: one full interval after engage.
  if (template.rally) e.rallyTimer = template.rally.every;
  // Telegraph the first War Cadence the same way: one full interval after engage.
  if (template.warcry) e.warcryTimer = template.warcry.every;
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
  e.templateId = `ground_${itemId}`;
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
