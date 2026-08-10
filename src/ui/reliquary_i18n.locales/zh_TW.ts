// Reliquary page name locale table for zh_TW (data-as-code, size-exempt).
// One per-base-locale chunk behind RELIQUARY_LOCALE_LOADERS in
// reliquary_i18n.ts, so a visitor downloads only their own locale's page names.
// Every value reuses an already-shipped string wherever one exists (dungeon,
// delve, world-boss and item-set entity names verbatim; the deed table's
// heroic-prefix form for the heroic pages), so a page never disagrees with the
// content it collects. Page descs are release fill and stay absent here, which
// renders the authored English. Values carry no em or en dashes (repo copy
// rule). English (en / en_CA) resolves to the authored source before this table
// is consulted.
import type { ReliquaryLocaleTable } from '../reliquary_i18n';

export const table: ReliquaryLocaleTable = {
  // Dungeon, delve and world-boss pages: entities.* names verbatim.
  conquerors_hollow_crypt: { name: '空洞墓穴' },
  conquerors_hollow_crypt_heroic: { name: '英雄：空洞墓穴' },
  conquerors_sunken_bastion: { name: '沉沒堡壘' },
  conquerors_sunken_bastion_heroic: { name: '英雄：沉沒堡壘' },
  conquerors_drowned_temple: { name: '溺亡神殿' },
  conquerors_drowned_temple_heroic: { name: '英雄：溺亡神殿' },
  conquerors_gravewyrm_sanctum: { name: '墓龍聖所' },
  conquerors_gravewyrm_sanctum_heroic: { name: '英雄：墓龍聖所' },
  conquerors_wildheart_basin: { name: '荒野之心盆地' },
  conquerors_wildheart_basin_heroic: { name: '英雄：荒野之心盆地' },
  // The arena entity reads 尼思拉克西斯團隊競技場; the page collects the raid's
  // spoils rather than naming the room, so the arena noun gives way to the
  // shipped raid noun 團隊副本 (guide.glossary.raidTerm) with the boss
  // transliteration kept byte-identical to that entity name.
  conquerors_nythraxis: { name: '尼思拉克西斯團隊副本' },
  conquerors_nythraxis_heroic: { name: '英雄：尼思拉克西斯團隊副本' },
  conquerors_thunzharr: { name: '桑扎爾，覺醒之峰' },
  conquerors_collapsed_reliquary: { name: '崩塌的聖物庫' },
  conquerors_drowned_litany: { name: '溺亡連禱' },
  // Set pages: entities.itemSets.* names verbatim.
  conquerors_set_deathlord: { name: '塚陵領主戰鬥護甲' },
  conquerors_set_wyrmshadow: { name: '夜牙法衣' },
  conquerors_set_necromancers: { name: '哀織法衣' },
  conquerors_set_crownforged: { name: '骨鑄戰裝' },
  conquerors_set_nighttalon: { name: '厲牙皮甲' },
  conquerors_set_soulflame: { name: '怨焰法衣' },
  conquerors_set_stormcallers: { name: '喚風法衣' },
  // Professions pages: 傑作 is the Reliquary's own masterwork noun (the markFind
  // labels these pages hold), 稀有發現 the guide's rare-finds heading, 標本 the
  // perfect-specimen mark's noun; 展廳 shares the 展 of 策展人 (Curator).
  professions_masterwork: { name: '傑作展廳' },
  professions_field_notes: { name: '稀有發現手記' },
  professions_specimens: { name: '關鍵標本' },
  // Horizons pages: the shipped HUD labels for the same three collections.
  horizons_mounts: { name: '坐騎' },
  horizons_weapon_skins: { name: '武器外觀' },
  horizons_titles: { name: '頭銜' },
  // The Rift page (Phase 21): the shipped rift noun (deed dgn_rift and the
  // sourceRift line both say 裂隙), used bare as the proper name.
  conquerors_the_rift: { name: '裂隙' },
  // Rares of the Realm pages (Phase 21): composed in the chronicle rare
  // deeds' register (chr_vale_rares zh_TW reads 溪谷惡煞, chr_marsh_rares
  // 霧中之名); no mob names inside page names.
  conquerors_rares_of_the_realm: { name: '天下惡煞' },
  conquerors_spoils_of_the_realm: { name: '惡煞的戰利品' },
  // Warfare pages (Phase 21): the shipped WARFARE brand noun (statInfo and
  // the itemSets.warfare_* bonus lines both say 戰爭) plus the gallery noun
  // the masterwork page uses (展廳) and the shipped armory noun
  // (wocStore.armoryTitle 兵器庫).
  conquerors_warfare_gallery: { name: '戰爭展廳' },
  conquerors_warfare_armory: { name: '戰爭兵器庫' },
  // Vault of Ages (Phase 21): composed from the shipped vault noun (the
  // col_reliquary_complete title reads 寶庫策展人).
  horizons_vault_of_ages: { name: '歲月寶庫' },
  // Riftbound (Phase 21): the shipped band noun (entities.items.
  // riftbound_band_of_*.name read 裂隙之戒), which carries the same rift noun
  // the Rift page uses.
  horizons_riftbound: { name: '裂隙之戒' },
};
