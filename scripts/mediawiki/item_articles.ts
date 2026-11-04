import {indexSpecialItemSources} from './special_item_sources';
import { stackSizeOf } from '../../src/sim/bags';
import {
  CASKET_COPPER_BASE,
  CASKET_COPPER_PER_LEVEL,
  CASKET_GEAR_CHANCE,
  CASKET_HEROIC_MARK_CHANCE,
  CASKET_HEROIC_MARKS,
  CASKET_MATERIAL_COUNT,
  CASKET_MATERIAL_POOL,
  CASKET_MOUNT_CHANCE,
  CASKET_MOUNT_REINS_ITEM_ID,
} from '../../src/sim/clue_casket';
import { BUDDIES } from '../../src/sim/content/buddies';
import { FACTION_VENDOR_GATES } from '../../src/sim/content/faction_vendors';
import { RETIRED_HEROIC_ITEMS } from '../../src/sim/content/heroic_loot';
import { HEROIC_VENDOR_NPC_ID, HEROIC_VENDOR_STOCK } from '../../src/sim/content/heroic_vendor';
import { CRUCIBLE_VENDOR_NPC_ID, CRUCIBLE_VENDOR_STOCK } from '../../src/sim/content/ignivar_loot';
import { ITEM_SETS } from '../../src/sim/content/item_sets';
import { MOUNTS } from '../../src/sim/content/mounts';
import { MOBILE_CRAFTING_STATION_DURATION_TICKS } from '../../src/sim/content/professions';
import { RELIQUARY_PAGES, reliquaryRelicSource } from '../../src/sim/content/reliquary';
import {
  HOARD_MIN_LEVEL,
  TREASURE_DIG_RADIUS,
  TREASURE_MAP_UPGRADE_INKS,
} from '../../src/sim/content/treasure_maps';
import {
  ALL_RECIPES,
  CLASSES,
  getActiveWorldContent,
  ITEMS,
  NPCS,
  QUESTS,
  zoneContaining,
} from '../../src/sim/data';
import {
  EMISSARY_CACHE_ITEM_ID,
  EMISSARY_CACHE_MARKS,
  emissaryCachePoolForClass,
} from '../../src/sim/emissary_cache';
import {
  canEquipItem,
  isUniqueEquipped,
  MASTERWROUGHT_EQUIP_CAP,
  MASTERWROUGHT_LEGENDARY_CAP,
  weaponHand,
} from '../../src/sim/equipment_rules';
import { itemLevel } from '../../src/sim/item_level';
import { requiredLevelFor } from '../../src/sim/item_level_req';
import { gatheringSupplyHintsForItem } from '../../src/sim/professions/gathering_supply';
import { wieldRequirementFor } from '../../src/sim/professions/wield_gate';
import {
  CONSUME_DURATION,
  CONSUME_TICKS,
  type ItemDef,
  type PlayerClass,
  POTION_COOLDOWN,
  TICK_RATE,
  type WeaponProcEffect,
} from '../../src/sim/types';
import { factionRewardTooltipLines } from '../../src/ui/hud/faction_reward_tooltip_view';
import { itemCombatTooltipLines } from '../../src/ui/item_combat_tooltip_view';
import {
  seasonalItemSourceText,
  seasonalItemTooltipText,
} from '../../src/ui/seasonal_item_tooltip';
import { toolEffectTooltipLines } from '../../src/ui/tool_effect_tooltip';
import {
  trinketEquipLockoutText,
  trinketTooltipLineTexts,
} from '../../src/ui/trinket_tooltip_view';
import { indexActivityItems } from './activity_item_sources';
import { type ArticleTools, append, lines, pct, recipeLabel, ref, words } from './entity_format';
import { vendorOfferText } from './vendor_offer';

// Each reused HUD builder emits escaped single-line divs. Keep their player-facing

// values but drop their HUD styling in wikitext.

function tooltipText(html: string): string[] {
  return html
    .split('</div>')
    .map((x) =>
      x
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&#x27;/g, "'")
        .trim(),
    )
    .filter(Boolean);
}

function procEffect(e: WeaponProcEffect) {
  switch (e.kind) {
    case 'chainArc':
      return (
        'Deals ' +
        e.damage +
        ' ' +
        e.school +
        ' damage, then jumps to up to ' +
        e.jumps +
        ' more targets within ' +
        e.radius +
        ' yd. Each jump retains ' +
        pct(e.falloff) +
        ' of the previous hit.'
      );

    case 'attackSlow':
      return (
        e.name +
        ' multiplies the time between the target’s swings by ' +
        e.mult +
        ' for ' +
        e.duration +
        ' sec.'
      );

    case 'hot':
    case 'dot':
      return (
        e.name +
        ' ' +
        (e.kind === 'hot' ? 'heals for ' : 'deals ') +
        e.perTick +
        (e.kind === 'dot' ? ' ' + e.school + ' damage' : ' health') +
        ' every ' +
        e.interval +
        ' sec for ' +
        e.duration +
        ' sec.'
      );
  }
}

const statNames: Record<string, string> = {
  str: 'Strength',
  agi: 'Agility',
  spi: 'Spirit',
  int: 'Intellect',
  sta: 'Stamina',
  ap: 'Attack Power',
};

function effects(w: ArticleTools, item: ItemDef): string[] {
  const out = tooltipText(itemCombatTooltipLines(item));

  if (item.foodHp || item.drinkMana)
    out.push(
      'Sit to recover ' +
        [item.foodHp && item.foodHp + ' health', item.drinkMana && item.drinkMana + ' mana']
          .filter(Boolean)
          .join(' and ') +
        ' over ' +
        CONSUME_DURATION +
        ' sec in ' +
        CONSUME_TICKS +
        ' ticks. Movement or combat interrupts recovery.',
    );

  if (item.potionHp || item.potionMana || item.potionHpPctMax)
    out.push(
      'Use in or out of combat for ' +
        [
          item.potionHp && item.potionHp + ' health',
          item.potionHpPctMax && pct(item.potionHpPctMax) + ' of maximum health',
          item.potionMana && item.potionMana + ' mana',
        ]
          .filter(Boolean)
          .join(' plus ') +
        '. Shared potion cooldown: ' +
        POTION_COOLDOWN +
        ' sec. Healing is modified by healing received and capped at missing health.',
    );

  const buff = item.kind === 'food' ? item.wellFed : item.elixir;

  if (buff)
    out.push(
      (item.kind === 'food' ? 'Finish the meal to gain ' : 'Gain ') +
        buff.value +
        ' ' +
        (statNames[buff.kind.replace('buff_', '')] ?? words(buff.kind)) +
        ' for ' +
        buff.duration +
        ' sec. ' +
        (item.kind === 'food'
          ? 'Replaces the previous Well Fed buff.'
          : item.kind === 'flask'
            ? 'Only one flask at a time. It survives death.'
            : 'Replaces other consumable buffs of the same stat family.'),
    );

  if (item.kind === 'bag' && item.bagSlots)
    out.push(
      'Equip for ' +
        item.bagSlots +
        (item.materialsOnly ? ' material-only' : ' general') +
        ' bag slots.',
    );

  if (item.kind === 'mount')
    out.push(
      'Keep these reins to own ' +
        MOUNTS[item.mount].name +
        '. Use them to summon this mount. Riding training determines speed.',
    );

  if (item.kind === 'buddy') out.push('Unlocks the companion ' + BUDDIES[item.buddy].name + '.');

  if (item.kind === 'buddy_cosmetic') out.push('Companion cosmetic: ' + words(item.cosmetic) + '.');

  if (item.kind === 'recipe')
    out.push(
      'Use this pattern to learn ' +
        (item.teachesEnchantId
          ? recipeLabel(w, item.teachesEnchantId)
          : (item.teachesRecipeIds ?? [item.teachesRecipeId])
              .map((id) => recipeLabel(w, id))
              .join(', ')) +
        '.',
    );

  if (item.kind === 'weapon')
    for (const p of item.weaponProcs ?? [])
      out.push(
        p.name +
          '. ' +
          pct(p.chance) +
          ' chance per ' +
          { weaponHit: 'landed weapon hit', heal: 'heal', spellDamage: 'damaging spell' }[
            p.trigger
          ] +
          '. ' +
          p.effects.map(procEffect).join(' '),
      );

  if ('feast' in item && item.feast)
    out.push(
      'Place a feast for ' +
        item.feast.durationTicks / TICK_RATE +
        ' sec. Up to ' +
        item.feast.charges +
        ' servings of ' +
        ref(w, 'item', item.feast.dishItemId) +
        '.',
    );

  if (item.teachesRiding) out.push('Teaches the next riding rank.');

  if (item.questId) out.push('Associated quest: ' + ref(w, 'quest', item.questId) + '.');

  if (item.set && ITEM_SETS[item.set])
    for (const b of ITEM_SETS[item.set].bonuses)
      out.push(ITEM_SETS[item.set].name + ' (' + b.pieces + ' pieces): ' + b.text);

  const seasonal = seasonalItemTooltipText(item);
  if (seasonal) out.push(seasonal);

  const use = item.use;

  if (use)
    switch (use.type) {
      case 'fishing':
        out.push('Face fishable water and use the pole to cast. Use it again when the fish bites.');
        break;

      case 'gatherTool':
        out.push(
          'Tier ' +
            use.tier +
            ' ' +
            words(use.professionId) +
            ' tool. Requires ' +
            wieldRequirementFor(use.professionId, use.tier) +
            ' ' +
            words(use.professionId) +
            ' proficiency to wield. ' +
            (use.professionId === 'fishing'
              ? 'Cast in fishable water and reel on a bite.'
              : 'Use to gather a matching node within reach.'),
        );
        break;

      case 'toolEffect':
        out.push(...tooltipText(toolEffectTooltipLines(item)));
        break;

      case 'throw':
        out.push('Throw at a nearby murloc hut on the purge quest to burn it. Reusable.');
        break;

      case 'summon':
        out.push(
          'Use the Briny Lure at the Proving Shore tide pool to summon Mister Crabs during the quest. Reusable.',
        );
        break;

      case 'passingStone':
        out.push(
          'Use during the death lesson to die on the spot. Release your spirit and return to your body.',
        );
        break;

      case 'clueScroll':
        out.push(
          'With no hunt active, consume the scroll to start one. During a dig step, use a scroll on the marked spot to advance.',
        );
        break;

      case 'clueCasket':
        out.push(
          'Open for ' +
            w.money(CASKET_COPPER_BASE) +
            ' plus ' +
            w.money(CASKET_COPPER_PER_LEVEL) +
            ' per character level, and ' +
            CASKET_MATERIAL_COUNT +
            ' of one randomly chosen material: ' +
            CASKET_MATERIAL_POOL.map((id) => ref(w, 'item', id)).join(', ') +
            '. Separate rolls give a ' +
            pct(CASKET_GEAR_CHANCE) +
            ' chance of a low-tier delve gear piece, ' +
            pct(CASKET_HEROIC_MARK_CHANCE) +
            ' for ' +
            CASKET_HEROIC_MARKS +
            ' Heroic Marks, and ' +
            pct(CASKET_MOUNT_CHANCE) +
            ' for ' +
            ref(w, 'item', CASKET_MOUNT_REINS_ITEM_ID) +
            ' if unowned.',
        );
        break;

      case 'treasureMap':
        out.push(
          'Read this ' +
            use.rarity +
            ' treasure map, then travel within ' +
            TREASURE_DIG_RADIUS +
            ' yd of the X and dig. The hoard requires level ' +
            HOARD_MIN_LEVEL +
            '.',
        );
        break;

      case 'cartographersInk':
        out.push(
          'Redraw a map one rarity higher. A common map costs ' +
            TREASURE_MAP_UPGRADE_INKS.common +
            ' ink, a rare costs ' +
            TREASURE_MAP_UPGRADE_INKS.rare +
            ' and an epic costs ' +
            TREASURE_MAP_UPGRADE_INKS.epic +
            '. Legendary maps are already at the top.',
        );
        break;

      case 'forgebreakerEmber':
        out.push('Starts the one-time hammer quest. Crafting consumes the Ember.');
        break;

      case 'mechChroma':
        out.push('Unlocks the ' + words(use.chromaId) + ' mech color.');
        break;

      case 'skinSelect':
        out.push('Roll a reward rank and choose a skin of that rank or lower.');
        break;

      case 'harvestPreference':
        out.push('Opens the harvest preference picker. Reusable.');
        break;

      case 'placeMobileStation':
        out.push(
          'Place a party-shared ' +
            words(use.stationCraftId) +
            ' workstation at your position for ' +
            MOBILE_CRAFTING_STATION_DURATION_TICKS / TICK_RATE / 60 +
            ' minutes. Reusable.',
        );
        break;

      case 'container':
        if (use.container === 'emissary_cache') {
          out.push(
            'Open for ' +
              EMISSARY_CACHE_MARKS +
              ' Heroic Marks and one epic Normal raid gear piece. Every eligible piece in your class pool is equally likely.',
          );
          break;
        }
        if (!seasonal)
          out.push('Open the container to receive its contents. One container is consumed.');
        break;

      case 'seasonal':
        break;

      default:
        out.push(
          ...tooltipText(factionRewardTooltipLines(item)).filter((t) => !t.startsWith('Attuned')),
        );
    }

  const trinket = trinketTooltipLineTexts(item.id, {
    attackPower: 100,
    rangedPower: 100,
    spellPower: 100,
    healPower: 100,
    maxHp: 1000,
  });

  if (trinket.length)
    out.push(
      'Trinket examples use 100 attack, ranged, spell and healing power and 1,000 maximum health.',
      ...trinket.map((t) => t.text),
    );

  const lock = trinketEquipLockoutText(item.id);
  if (lock) out.push(lock);

  return out;
}

export function addItemArticles(w: ArticleTools, sources: Map<string, Set<string>>) {
  const uses = new Map<string, Set<string>>();
  indexActivityItems(w, sources, uses);
  indexSpecialItemSources(w,sources);

  for (const n of Object.values(NPCS))
    for (const id of n.vendorItems ?? []) {
      if (n.devVendor) continue;

      append(
        sources,
        id,
        'Sold by ' + ref(w, 'npc', n.id) + '. ' + vendorOfferText(w, n, ITEMS[id]),
      );
    }
  for (const row of HEROIC_VENDOR_STOCK)
    append(
      sources,
      row.itemId,
      'Buy from ' + ref(w, 'npc', HEROIC_VENDOR_NPC_ID) + ' for ' + row.marks + ' Heroic Marks.',
    );
  for (const row of CRUCIBLE_VENDOR_STOCK)
    append(
      sources,
      row.itemId,
      'Exchange ' +
        ref(w, 'item', row.sigilId) +
        ' at ' +
        ref(w, 'npc', CRUCIBLE_VENDOR_NPC_ID) +
        '.',
    );
  for (const cls of Object.keys(CLASSES) as PlayerClass[]) {
    const pool = emissaryCachePoolForClass(cls);
    for (const id of pool)
      append(
        sources,
        id,
        ref(w, 'item', EMISSARY_CACHE_ITEM_ID) +
          ' opened by ' +
          ref(w, 'class', cls) +
          ' gives a 1 in ' +
          pool.length +
          ' chance.',
      );
  }
  for (const q of Object.values(QUESTS))
    for (const o of q.objectives)
      if (o.type === 'collect')
        append(uses, o.itemId, ref(w, 'quest', q.id) + ' requires ' + o.count + '.');

  for (const obj of getActiveWorldContent().groundObjects)
    for (const p of obj.positions) {
      const z = zoneContaining(p.x, p.z);

      append(
        sources,
        obj.itemId,
        'Find ' +
          obj.name +
          ' at (' +
          Number(p.x.toFixed(2)) +
          ', ' +
          Number(p.z.toFixed(2)) +
          ')' +
          (z ? ' in ' + ref(w, 'zone', z.id) : '') +
          '.',
      );
    }

  for (const r of ALL_RECIPES) {
    const recipe = recipeLabel(w, r.id);

    append(
      sources,
      r.resultItemId,
      'Craft ' +
        r.resultCount +
        ' with ' +
        words(r.professionId) +
        ' at skill ' +
        r.skillReq +
        '. Base ingredients: ' +
        r.reagents.map((a) => a.count + ' ' + ref(w, 'item', a.itemId)).join(', ') +
        '.' +
        (r.stationType ? ' Station: ' + words(r.stationType) + '.' : ''),
    );

    for (const a of r.reagents)
      append(uses, a.itemId, a.count + ' per craft of ' + recipe + ' before discounts.');
  }

  for (const p of RELIQUARY_PAGES)
    for (const r of p.relics)
      if (r.kind === 'item')
        for (const hint of reliquaryRelicSource(p, r)) {
          const kind = ({ boss: 'mob', zone: 'zone', quest: 'quest', vendor: 'npc' } as const)[
            hint.sourceKind as 'boss' | 'zone' | 'quest' | 'vendor'
          ];

          append(
            sources,
            r.itemId,
            'Reliquary source: ' +
              (kind
                ? ref(w, kind, hint.sourceId)
                : words(hint.sourceKind) + ' / ' + words(hint.sourceId)) +
              '.',
          );
        }

  for (const [cls, c] of Object.entries(CLASSES))
    append(sources, c.startWeapon, 'Starting weapon for ' + ref(w, 'class', cls) + '.');

  for (const item of Object.values(ITEMS)) {
    const quality = item.quality ?? 'common',
      kind = w.kindWording(item.kind);

    const facts: [string, string][] = [
      ['Type', kind],
      ['Quality', quality],
      ['Stack limit', String(stackSizeOf(item))],
      [
        'Sell value',
        item.soulbound || item.kind === 'quest' || item.noVendorSell || item.sellValue === 0
          ? 'Cannot be sold for copper'
          : w.money(item.sellValue),
      ],
    ];

    const ilvl = itemLevel(item);
    if (ilvl !== undefined) facts.push(['Base item level', String(ilvl)]);

    if (item.slot) {
      facts.push(['Slot', words(item.slot)], ['Required level', String(requiredLevelFor(item))]);

      const cs = (Object.keys(CLASSES) as PlayerClass[]).filter((c) => canEquipItem(c, item));

      facts.push([
        'Can equip',
        cs.length === Object.keys(CLASSES).length
          ? 'All classes'
          : cs.map((c) => ref(w, 'class', c)).join(', '),
      ]);
    } else if (item.requiredLevel) facts.push(['Required level', String(item.requiredLevel)]);

    if (item.kind === 'armor' && item.armorType) facts.push(['Armor type', words(item.armorType)]);

    if (item.kind === 'weapon')
      facts.push(
        ['Weapon hand', words(weaponHand(item) ?? 'onehand')],
        ['Dagger', item.weapon.dagger ? 'Yes' : 'No'],
      );

    if ((item.buyValue ?? 0) > 0 && !item.teachesRiding)
      facts.push(['Vendor copper price per unit', w.money(item.buyValue)]);

    if (item.priceHonor) facts.push(['Honor cost', String(item.priceHonor)]);

    if (item.priceItem)
      facts.push(['Item cost', item.priceItem.count + ' ' + ref(w, 'item', item.priceItem.itemId)]);

    const g = FACTION_VENDOR_GATES[item.id];

    if (g)
      facts.push([
        'Faction vendor requirement',
        g.standingTier +
          ' (' +
          g.requiredStanding +
          ' standing)' +
          (g.factionId ? ' with ' + words(g.factionId) : '') +
          ', ' +
          g.currencyCost +
          ' marks.',
      ]);

    const rules = [
      item.soulbound && 'Soulbound',
      item.unique && 'One copy may be carried or equipped',
      isUniqueEquipped(item) && 'Unique-equipped within this item family',
      item.noDiscard && 'Cannot discard',
      item.noSalvage && 'Cannot salvage or disenchant',
      item.noMarketList && 'Cannot list on the market',
      item.lentGear && 'Loaned for the encounter',
      item.masterwrought &&
        'Masterwrought: equip at most ' +
          MASTERWROUGHT_EQUIP_CAP +
          ' Masterwrought pieces, of which at most ' +
          MASTERWROUGHT_LEGENDARY_CAP +
          ' may be legendary',
    ].filter(Boolean);

    if (rules.length) facts.push(['Restrictions', rules.join('. ') + '.']);

    if (item.seasonalEvent) facts.push(['Event', words(item.seasonalEvent)]);

    if (RETIRED_HEROIC_ITEMS[item.id])
      facts.push(['Availability', 'Retired gear retained for existing owners.']);

    if (item.heroicOf || item.relicOf)
      facts.push(['Base item', ref(w, 'item', (item.heroicOf ?? item.relicOf)!)]);

    const ways = Array.from(sources.get(item.id) ?? []);

    for (const h of gatheringSupplyHintsForItem(item.id))
      ways.push(
        h.corpsePreferenceItemId
          ? 'Harvest creature corpses. Set harvest preference to ' +