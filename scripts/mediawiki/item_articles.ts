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
import { isDeveloperMount, MOUNTS } from '../../src/sim/content/mounts';
import { MOBILE_CRAFTING_STATION_DURATION_TICKS } from '../../src/sim/content/professions';
import { RELIQUARY_PAGES, reliquaryRelicSource } from '../../src/sim/content/reliquary';
import { MECH_CHROMAS, SKIN_RANK_ROLL_WEIGHTS, SKIN_RANKS } from '../../src/sim/content/skins';
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
import { RETIRED_ZONE1_ITEM_IDS } from '../../src/sim/removed_zone1_content';
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
import { itemSlotLabel } from '../../src/ui/item_slot_labels';
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
import { itemAcquisitionArticle, itemAcquisitionIndex } from './item_acquisition';
import { type DropSource, dropSourceTable } from './loot_table';
import { indexSpecialItemSources } from './special_item_sources';
import { vendorOfferText } from './vendor_offer';
import { wikiItemKind } from './wiki_item_kind';

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
        ' yd. Each jump does ' +
        pct(e.falloff) +
        ' of the damage of the hit before it.'
      );

    case 'attackSlow':
      return (
        e.name +
        ' makes the time between the target’s swings ' +
        e.mult +
        ' times as long for ' +
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
      'Sit down to get back ' +
        [item.foodHp && item.foodHp + ' health', item.drinkMana && item.drinkMana + ' mana']
          .filter(Boolean)
          .join(' and ') +
        ' over ' +
        CONSUME_DURATION +
        ' sec, in ' +
        CONSUME_TICKS +
        ' small amounts. Moving or fighting stops it.',
    );

  if (item.potionHp || item.potionMana || item.potionHpPctMax)
    out.push(
      'Use it in or out of combat to get ' +
        [
          item.potionHp && item.potionHp + ' health',
          item.potionHpPctMax && pct(item.potionHpPctMax) + ' of maximum health',
          item.potionMana && item.potionMana + ' mana',
        ]
          .filter(Boolean)
          .join(' plus ') +
        '. All potions share one cooldown of ' +
        POTION_COOLDOWN +
        ' sec.' +
        (item.potionHp || item.potionHpPctMax
          ? ' Effects that change the healing you receive also change this healing. It cannot heal more than the health you are missing.'
          : ''),
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
          ? 'It replaces any Well Fed buff you already have.'
          : item.kind === 'flask'
            ? 'You can only have one flask at a time. It stays on when you die.'
            : 'It replaces any other consumable buff for the same kind of stat.'),
    );

  if (item.kind === 'bag' && item.bagSlots)
    out.push(
      'Equip it to get ' +
        item.bagSlots +
        ' more bag slots' +
        (item.materialsOnly ? ' that only hold materials.' : ' that hold any item.'),
    );

  if (item.kind === 'mount')
    out.push(
      'Keep these reins to own ' +
        MOUNTS[item.mount].name +
        '. Use them to call this mount. How fast it goes depends on your riding training.',
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
          ' chance ' +
          {
            weaponHit: 'each time your weapon hits',
            heal: 'each time you heal',
            spellDamage: 'each time you deal spell damage',
          }[p.trigger] +
          '. ' +
          p.effects.map(procEffect).join(' '),
      );

  if ('feast' in item && item.feast)
    out.push(
      'Set out a feast that lasts ' +
        item.feast.durationTicks / TICK_RATE +
        ' sec. It has up to ' +
        item.feast.charges +
        ' servings of ' +
        ref(w, 'item', item.feast.dishItemId) +
        '.',
    );

  if (item.teachesRiding) out.push('Teaches the next riding rank.');

  if (item.questId) out.push('Linked quest: ' + ref(w, 'quest', item.questId) + '.');

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
            ' tool. To use it, you need ' +
            wieldRequirementFor(use.professionId, use.tier) +
            ' ' +
            words(use.professionId) +
            ' proficiency (your skill level in it). ' +
            (use.professionId === 'fishing'
              ? 'Cast into water you can fish in, and reel in when a fish bites.'
              : 'Use it on a matching node close to you to gather from it.'),
        );
        break;

      case 'toolEffect':
        out.push(...tooltipText(toolEffectTooltipLines(item)));
        break;

      case 'throw':
        out.push(
          'During the purge quest, throw it at a nearby murloc hut to burn it. You can use it again.',
        );
        break;

      case 'summon':
        out.push(
          'During the quest, use the Briny Lure at the Proving Shore tide pool to summon Mister Crabs. You can use it again.',
        );
        break;

      case 'passingStone':
        out.push(
          'Use during the death lesson to die on the spot. Release your spirit and return to your body.',
        );
        break;

      case 'clueScroll':
        out.push(
          'If you are not on a hunt, use up the scroll to start one. During a dig step, use a scroll on the marked spot to move to the next step.',
        );
        break;

      case 'clueCasket':
        out.push(
          'Open it to get ' +
            w.money(CASKET_COPPER_BASE) +
            ', plus ' +
            w.money(CASKET_COPPER_PER_LEVEL) +
            ' for each of your character levels. You also get ' +
            CASKET_MATERIAL_COUNT +
            ' of one material, picked at random from: ' +
            CASKET_MATERIAL_POOL.map((id) => ref(w, 'item', id)).join(', ') +
            '. Then each of these extras is rolled on its own: ' +
            pct(CASKET_GEAR_CHANCE) +
            ' chance of a low-tier delve gear piece, ' +
            pct(CASKET_HEROIC_MARK_CHANCE) +
            ' chance of ' +
            CASKET_HEROIC_MARKS +
            ' Heroic Marks, and ' +
            pct(CASKET_MOUNT_CHANCE) +
            ' chance of ' +
            ref(w, 'item', CASKET_MOUNT_REINS_ITEM_ID) +
            ' if you do not have it yet.',
        );
        break;

      case 'treasureMap':
        out.push(
          'Read this ' +
            use.rarity +
            ' treasure map. Then go within ' +
            TREASURE_DIG_RADIUS +
            ' yd of the X and dig. You must be level ' +
            HOARD_MIN_LEVEL +
            ' or higher for the hoard.',
        );
        break;

      case 'cartographersInk':
        out.push(
          'Use ink to redraw a map one rarity higher. A common map costs ' +
            TREASURE_MAP_UPGRADE_INKS.common +
            ' ink, a rare costs ' +
            TREASURE_MAP_UPGRADE_INKS.rare +
            ' and an epic costs ' +
            TREASURE_MAP_UPGRADE_INKS.epic +
            '. Legendary maps are already the highest rarity.',
        );
        break;

      case 'forgebreakerEmber':
        out.push(
          'Starts the hammer quest, which you can only do once. Crafting uses up the Ember.',
        );
        break;

      case 'mechChroma': {
        out.push('Use to unlock the ' + words(use.chromaId) + ' mech color on your account.');
        const chroma = MECH_CHROMAS.find((c) => c.id === use.chromaId);
        if (chroma)
          out.push(
            'You can also unlock the look another way: use ' +
              ref(w, 'item', 'alien_armor_plate') +
              ', roll rank ' +
              chroma.rank +
              ' or higher, and pick this color. That unlocks the look straight away, but you do not get a plate item.',
          );
        break;
      }

      case 'skinSelect':
        out.push(
          'Use it to roll a reward rank, then pick a skin of that rank or lower. Chance of each rank: ' +
            SKIN_RANKS.map(
              (rank) =>
                rank +
                ' ' +
                pct(
                  SKIN_RANK_ROLL_WEIGHTS[rank] /
                    Object.values(SKIN_RANK_ROLL_WEIGHTS).reduce((a, b) => a + b, 0),
                ),
            ).join(', ') +
            '. The token is used up when you claim your pick.',
        );
        break;

      case 'harvestPreference':
        out.push('Opens the harvest preference picker. You can use it again.');
        break;

      case 'placeMobileStation':
        out.push(
          'Set down a ' +
            words(use.stationCraftId) +
            ' workstation where you stand, for ' +
            MOBILE_CRAFTING_STATION_DURATION_TICKS / TICK_RATE / 60 +
            ' minutes. Your party can use it too. You can use this item again.',
        );
        break;

      case 'container':
        if (use.container === 'emissary_cache') {
          out.push(
            'Open it to get ' +
              EMISSARY_CACHE_MARKS +
              ' Heroic Marks and one piece of epic gear from a Normal raid. Every piece your class can get from it is equally likely.',
          );
          break;
        }
        if (!seasonal) out.push('Open it to get what is inside. This uses up one container.');
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
      'The trinket numbers below are for a character with 100 attack power, 100 ranged power, 100 spell power, 100 healing power and 1,000 maximum health.',
      ...trinket.map((t) => t.text),
    );

  const lock = trinketEquipLockoutText(item.id);
  if (lock) out.push(lock);

  return out;
}

export function addItemArticles(
  w: ArticleTools,
  sources: Map<string, Set<string>>,
  drops: Map<string, DropSource[]> = new Map(),
) {
  const acquisition = itemAcquisitionIndex(w);
  const vendorStock = new Set(
    Object.values(NPCS)
      .filter((n) => !n.devVendor)
      .flatMap((n) => n.vendorItems ?? []),
  );
  const uses = new Map<string, Set<string>>();
  indexActivityItems(w, sources, uses);
  indexSpecialItemSources(w, sources);

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
      'Trade in ' +
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
        'When a ' +
          ref(w, 'class', cls) +
          ' opens ' +
          ref(w, 'item', EMISSARY_CACHE_ITEM_ID) +
          ', there is a 1 in ' +
          pool.length +
          ' chance of getting this.',
      );
  }
  for (const q of Object.values(QUESTS))
    for (const o of q.objectives)
      if (o.type === 'collect')
        append(uses, o.itemId, ref(w, 'quest', q.id) + ' needs ' + o.count + '.');

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
        ' (needs skill ' +
        r.skillReq +
        ')' +
        '. Ingredients, before any discounts: ' +
        r.reagents.map((a) => a.count + ' ' + ref(w, 'item', a.itemId)).join(', ') +
        '.' +
        (r.stationType ? ' Station: ' + words(r.stationType) + '.' : ''),
    );

    for (const a of r.reagents)
      append(uses, a.itemId, a.count + ' for each craft of ' + recipe + ', before any discounts.');
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
      kind = wikiItemKind(item);

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
      facts.push(
        ['Slot', itemSlotLabel(item.slot)],
        ['Required level', String(requiredLevelFor(item))],
      );

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
        [
          'Weapon hand',
          { onehand: 'One-handed', twohand: 'Two-handed', mainhand: 'Main hand only' }[
            weaponHand(item) ?? 'onehand'
          ],
        ],
        ['Dagger', item.weapon.dagger ? 'Yes' : 'No'],
      );

    if (vendorStock.has(item.id) && (item.buyValue ?? 0) > 0 && !item.teachesRiding)
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

    const availability = RETIRED_HEROIC_ITEMS[item.id]
      ? "'''Retired gear.''' This used to drop on Heroic, but it no longer drops. Copies people already have still work."
      : RETIRED_ZONE1_ITEM_IDS.some((id) => id === item.id)
        ? "'''Retired drop.''' This no longer drops. Copies people already have still work, and their owners can trade them."
        : item.id === 'chunk_of_ore'
          ? "'''Retired tutorial item.''' Older characters who already have copies keep them in their bags."
          : item.kind === 'mount' && isDeveloperMount(item.mount)
            ? "'''Developer grant.''' Only developers can give out these reins. There is no ordinary way to get them in the game."
            : '';

    if (item.heroicOf || item.relicOf)
      facts.push(['Base item', ref(w, 'item', (item.heroicOf ?? item.relicOf)!)]);

    const ways = Array.from(sources.get(item.id) ?? []);

    for (const h of gatheringSupplyHintsForItem(item.id))
      ways.push(
        h.corpsePreferenceItemId
          ? 'Harvest the bodies of defeated creatures. Set your harvest preference to ' +
              ref(w, 'item', h.corpsePreferenceItemId) +
              '.'
          : 'Gather it with ' + words(h.familyId) + '.',
      );

    const season = seasonalItemSourceText(item);
    if (season) ways.push(season);

    w.add(
      w.titleBy.item.get(item.id)!,
      (availability ? availability + '\n\n' : '') +
        w.section(
          'Overview',
          item.name +
            ' is ' +
            (/^[aeiou]/i.test(quality) ? 'an ' : 'a ') +
            quality +
            '-quality ' +
            kind.toLowerCase() +
            '.',
        ) +
        w.section('Facts', w.table(facts)) +
        itemAcquisitionArticle(w, item, acquisition.get(item.id) ?? [], ways) +
        (drops.get(item.id)?.length
          ? w.section(
              'Dropped by',
              'Every creature that can drop this item, most likely first. The chance is for each kill.\n\n' +
                dropSourceTable(drops.get(item.id)!),
            )
          : '') +
        lines(w, 'Equipment and use', effects(w, item)) +
        lines(w, 'Sources', ways) +
        lines(w, 'Used for', Array.from(uses.get(item.id) ?? [])),
      ['Items', kind, quality],
    );
  }
}
