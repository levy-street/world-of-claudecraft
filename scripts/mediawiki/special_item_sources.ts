import { HOARD_BOSS_LOOT_TABLES, HOARD_LOOT_CLASS_BIAS, hoardLootTierForMap, hoardLootVariantId } from '../../src/sim/content/hoard_loot';
import { TREASURE_MAP_RARITIES, TREASURE_MAP_ITEM_IDS,VAULT_PAYOUTS,VAULT_GUEST_GEAR_CHANCE } from '../../src/sim/content/treasure_maps';
import { DUNGEON_LIST, ITEMS } from '../../src/sim/data';
import { MARKET_HOUSE_STOCK } from '../../src/sim/market';
import { isMembershipArmour, isReferralArmour } from '../../src/sim/membership_armour';
import { RETIRED_ZONE1_ITEM_IDS } from '../../src/sim/removed_zone1_content';
import { RETIRED_HEROIC_ITEMS } from '../../src/sim/content/heroic_loot';
import { FISHING_TABLES_BY_BAND } from '../../src/sim/content/items';
import { HEROIC_MARK_CURRENCY_ID } from '../../src/sim/content/dungeon_difficulty';
import { LANTERN_HALL_DESTRIER_REINS_ID,LANTERN_HALL_DESTRIER_SEALS,LANTERN_SEAL_ITEM_ID,GUILD_CONTRACT_SEALS } from '../../src/sim/content/guild_contracts';
import { REFERRAL_BAG,REFERRAL_HOLLOW_TRINKET,REFERRAL_FOG_TRINKET,REFERRAL_RAPTOR_REINS,REFERRAL_SLIME_REINS } from '../../src/sim/content/referral_rewards';
import { GOURDLIGHT_POUCH_SWEETS,GOURDLIGHT_SWEET_ID,GOURDLIGHT_TREAT_POUCH_ID } from '../../src/sim/content/gourdlight_eve';
import { CURSED_CANDLE_ID,PATCH_PUMPKIN_ID } from '../../src/sim/content/gourdlight_eve_dailies';
import { FARM_WITHERED_HUSK_ITEM_ID } from '../../src/sim/content/farm_crops';
import { MUSTER_RACK } from '../../src/sim/content/mirefen_muster';
import { MUSTER_SHARDPIKE_ID } from '../../src/sim/lance_balance_core';
import { DEVELOPER_MOUNTS } from '../../src/sim/content/mounts';
import { materialHintKey } from '../../src/ui/hud/professions/material_hint_view';
import { t } from '../../src/ui/i18n';
import { type ArticleTools, append, pct, ref, words } from './entity_format';

export function indexSpecialItemSources(w:ArticleTools,sources:Map<string,Set<string>>) {
  const add=(id:string,s:string)=>append(sources,id,s);
  for(const [boss,items] of Object.entries(HOARD_BOSS_LOOT_TABLES))for(const rarity of TREASURE_MAP_RARITIES){
    const tier=hoardLootTierForMap(rarity);
    for(const base of items) {
      const item=hoardLootVariantId(base,tier);
      add(item,'Defeat '+ref(w,'mob',boss)+' in a '+ref(w,'item',TREASURE_MAP_ITEM_IDS[rarity])+' hoard. The owner has a '+pct(VAULT_PAYOUTS[rarity].gearChance)+' chance to receive gear, an eligible guest '+pct(VAULT_GUEST_GEAR_CHANCE[rarity])+'. When a piece drops, '+pct(HOARD_LOOT_CLASS_BIAS)+' of rolls select uniformly among this boss’s class-targeted pieces if any qualify. Other rolls select uniformly from all '+items.length+'.');
    }
  }
  for(const row of MARKET_HOUSE_STOCK)add(row.itemId,'The Merchant stocks '+row.count+' for '+w.money(row.price)+' on the built-in world market.');
  for(const d of DUNGEON_LIST)for(const o of d.objects ?? [])add(o.itemId,'Find '+o.name+' inside '+ref(w,'dungeon',d.id)+' at room coordinates ('+o.x+', '+o.z+').');
  for(const item of Object.values(ITEMS)){
    if(isMembershipArmour(item.id)) add(item.id,'Claim scaling armor with an active membership.');
    if(isReferralArmour(item.id)) add(item.id,'Claim scaling armor on a character with a verified referral armor entitlement.');
    if(item.kind==='mount' && DEVELOPER_MOUNTS.includes(item.mount))add(item.id,'Developer mount. Granted by a developer.'); 
    const key=materialHintKey(item.id);if(key)add(item.id,t(key));
  }
  for(const id of [...RETIRED_ZONE1_ITEM_IDS,...Object.keys(RETIRED_HEROIC_ITEMS)]) add(id,'Retired. Existing copies remain valid.');
  for(const [id,stage] of [[REFERRAL_BAG,'tutorial'],[REFERRAL_HOLLOW_TRINKET,'Hollow Crypt'],[REFERRAL_FOG_TRINKET,'Fogbinder (upgrades the Hollow charm)'],[REFERRAL_SLIME_REINS,'raid']])add(id,'Redeem the '+stage+' milestone on the recruited character’s referral card.');
  add(REFERRAL_RAPTOR_REINS,'Inviter reward for the first friend who completes their referral card.');
  add(FARM_WITHERED_HUSK_ITEM_ID,'Harvest a failed crop from your farm bed.');
  add(LANTERN_SEAL_ITEM_ID,'Claim guild contract rewards. Seals per contract type: '+Object.entries(GUILD_CONTRACT_SEALS).map(([kind,count])=>words(kind)+' '+count).join(', ')+'.');
  add(LANTERN_HALL_DESTRIER_REINS_ID,'Spend '+LANTERN_HALL_DESTRIER_SEALS+' '+ref(w,'item',LANTERN_SEAL_ITEM_ID)+' at the guild hall quartermaster.');
  add(HEROIC_MARK_CURRENCY_ID,'Awarded by heroic dungeon clears and as a currency reward in '+ref(w,'item','emissary_cache')+'. Credited to your currency balance.');
  add(GOURDLIGHT_SWEET_ID,'Open '+ref(w,'item',GOURDLIGHT_TREAT_POUCH_ID)+' to receive '+GOURDLIGHT_POUCH_SWEETS+'.');
  add(CURSED_CANDLE_ID,'Snuff the marked candles on Hester’s Gourdlight daily: '+ref(w,'quest','q_gourdlight_daily_wicks')+'.');
  add(PATCH_PUMPKIN_ID,'Pick up pumpkins on Hester’s Gourdlight daily: '+ref(w,'quest','q_gourdlight_daily_patch')+'.');
  add(MUSTER_SHARDPIKE_ID,'Borrow from the muster weapon rack at ('+MUSTER_RACK.x+', '+MUSTER_RACK.z+') during the drill. This is loaned gear.');
  add('the_codfather','Land a catch at Deepfen Shallows during '+ref(w,'quest','q_the_codfather')+' when you are not carrying the quest fish.');
  add('soul_stone','Take a Soul Stone from a warlock’s conjured Soulwell.');
  for (const [band,zones] of FISHING_TABLES_BY_BAND.entries()) for(const [zone,entries] of Object.entries(zones)){
    const weight=entries.reduce((n,e)=>n+e.weight,0);
    for(const e of entries)if(e.itemId)add(e.itemId,'Fishing band '+band+' in '+ref(w,'zone',zone)+': '+pct(e.weight/weight)+' of results on the base catch table.');
  }
}
