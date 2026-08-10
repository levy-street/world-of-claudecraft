// Reliquary page name locale table for zh_CN (data-as-code, size-exempt).
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
  conquerors_sunken_bastion: { name: '沉没堡垒' },
  conquerors_sunken_bastion_heroic: { name: '英雄：沉没堡垒' },
  conquerors_drowned_temple: { name: '溺亡神殿' },
  conquerors_drowned_temple_heroic: { name: '英雄：溺亡神殿' },
  conquerors_gravewyrm_sanctum: { name: '墓龙圣所' },
  conquerors_gravewyrm_sanctum_heroic: { name: '英雄：墓龙圣所' },
  conquerors_wildheart_basin: { name: '荒野之心盆地' },
  conquerors_wildheart_basin_heroic: { name: '英雄：荒野之心盆地' },
  // The arena entity reads 尼思拉克西斯团队竞技场; the page collects the raid's
  // spoils rather than naming the room, so the arena noun gives way to the
  // shipped raid noun 团队副本 (guide.glossary.raidTerm) with the boss
  // transliteration kept byte-identical to that entity name.
  conquerors_nythraxis: { name: '尼思拉克西斯团队副本' },
  conquerors_nythraxis_heroic: { name: '英雄：尼思拉克西斯团队副本' },
  conquerors_thunzharr: { name: '桑扎尔，觉醒之峰' },
  conquerors_collapsed_reliquary: { name: '坍塌的圣物库' },
  conquerors_drowned_litany: { name: '溺亡连祷' },
  // Set pages: entities.itemSets.* names verbatim.
  conquerors_set_deathlord: { name: '冢主战甲' },
  conquerors_set_wyrmshadow: { name: '夜牙法衣' },
  conquerors_set_necromancers: { name: '哀织法衣' },
  conquerors_set_crownforged: { name: '骨铸战装' },
  conquerors_set_nighttalon: { name: '恐牙皮甲' },
  conquerors_set_soulflame: { name: '魂焰法衣' },
  conquerors_set_stormcallers: { name: '唤风法衣' },
  // Professions pages: 杰作 is the Reliquary's own masterwork noun (the markFind
  // labels these pages hold), 稀有发现 the guide's rare-finds heading, 标本 the
  // perfect-specimen mark's noun; 展厅 shares the 展 of 策展人 (Curator).
  professions_masterwork: { name: '杰作展厅' },
  professions_field_notes: { name: '稀有发现手记' },
  professions_specimens: { name: '关键标本' },
  // Horizons pages: the shipped HUD labels for the same three collections.
  horizons_mounts: { name: '坐骑' },
  horizons_weapon_skins: { name: '武器外观' },
  horizons_titles: { name: '头衔' },
  // The Rift page (Phase 21): the shipped rift noun (deed dgn_rift and the
  // sourceRift line both say 裂隙), used bare as the proper name.
  conquerors_the_rift: { name: '裂隙' },
  // Rares of the Realm pages (Phase 21): composed in the chronicle rare
  // deeds' register (chr_vale_rares zh_CN reads 溪谷群凶, chr_marsh_rares
  // 雾中恶名); no mob names inside page names.
  conquerors_rares_of_the_realm: { name: '天下恶名' },
  conquerors_spoils_of_the_realm: { name: '恶名者的战利品' },
  // Warfare pages (Phase 21): the shipped WARFARE brand noun (statInfo and
  // the itemSets.warfare_* bonus lines both say 战争) plus the gallery noun
  // the masterwork page uses (展厅) and the shipped armory noun
  // (wocStore.armoryTitle 兵器库).
  conquerors_warfare_gallery: { name: '战争展厅' },
  conquerors_warfare_armory: { name: '战争兵器库' },
  // Vault of Ages (Phase 21): composed from the shipped vault noun (the
  // col_reliquary_complete title reads 宝库策展人).
  horizons_vault_of_ages: { name: '岁月宝库' },
  // Riftbound (Phase 21): the shipped band noun (entities.items.
  // riftbound_band_of_*.name read 裂隙之戒), which carries the same rift noun
  // the Rift page uses.
  horizons_riftbound: { name: '裂隙之戒' },
};
