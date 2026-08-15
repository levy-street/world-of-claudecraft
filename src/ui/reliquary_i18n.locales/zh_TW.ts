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
  conquerors_hollow_crypt: {
    name: '空洞墓穴',
    desc: '從喚墓者莫森與空洞墓穴手中奪來的標誌性戰利品。',
  },
  conquerors_hollow_crypt_heroic: {
    name: '英雄：空洞墓穴',
    desc: '喚墓者莫森身上僅限英雄難度掉落的史詩物品。',
  },
  conquerors_sunken_bastion: {
    name: '沉沒堡壘',
    desc: '來自奧倫與縛霧者維爾的稀有與史詩戰利品。',
  },
  conquerors_sunken_bastion_heroic: {
    name: '英雄：沉沒堡壘',
    desc: '縛霧者維爾身上僅限英雄難度掉落的史詩物品。',
  },
  conquerors_drowned_temple: {
    name: '溺亡神殿',
    desc: '來自唱詩之母瑟爾瑟與伊索蕾，溺月化身的稀有戰利品。',
  },
  conquerors_drowned_temple_heroic: {
    name: '英雄：溺亡神殿',
    desc: '伊索蕾身上僅限英雄難度掉落的史詩物品。',
  },
  conquerors_gravewyrm_sanctum: {
    name: '墓龍聖所',
    desc: '來自聖所各首領與墓龍科祖爾的稀有與史詩戰利品。',
  },
  conquerors_gravewyrm_sanctum_heroic: {
    name: '英雄：墓龍聖所',
    desc: '墓龍科祖爾身上僅限英雄難度掉落的史詩物品。',
  },
  conquerors_wildheart_basin: {
    name: '荒野之心盆地',
    desc: '來自祖爾加與獠牙領主馴獸師的標誌性武器。',
  },
  conquerors_wildheart_basin_heroic: {
    name: '英雄：荒野之心盆地',
    desc: '盆地之聲祖爾加身上僅限英雄難度掉落的史詩物品。',
  },
  // The arena entity reads 尼思拉克西斯團隊競技場; the page collects the raid's
  // spoils rather than naming the room, so the arena noun gives way to the
  // shipped raid noun 團隊副本 (guide.glossary.raidTerm) with the boss
  // transliteration kept byte-identical to that entity name.
  conquerors_nythraxis: {
    name: '尼思拉克西斯團隊副本',
    desc: '來自尼思拉克西斯，荊峰之災的史詩與傳說戰利品。',
  },
  conquerors_nythraxis_heroic: {
    name: '英雄：尼思拉克西斯團隊副本',
    desc: '尼思拉克西斯身上僅限英雄難度掉落的團隊副本武器。',
  },
  conquerors_thunzharr: {
    name: '桑扎爾，覺醒之峰',
    desc: '來自覺醒之峰世界首領的個人史詩戰利品。',
  },
  conquerors_collapsed_reliquary: {
    name: '崩塌的聖物庫',
    desc: '來自坍塌的聖物庫中需開鎖寶箱的標誌性稀有物品。',
  },
  conquerors_drowned_litany: {
    name: '溺亡連禱',
    desc: '來自溺亡連禱的稀有與史詩戰利品。',
  },
  // Set pages: entities.itemSets.* names verbatim.
  conquerors_set_deathlord: {
    name: '塚陵領主戰鬥護甲',
    desc: '完整的塚主板甲系列。',
  },
  conquerors_set_wyrmshadow: {
    name: '夜牙法衣',
    desc: '完整的龍影皮甲系列。',
  },
  conquerors_set_necromancers: {
    name: '哀織法衣',
    desc: '完整的死靈法師布甲系列。',
  },
  conquerors_set_crownforged: {
    name: '骨鑄戰裝',
    desc: '完整的冠鑄板甲系列。',
  },
  conquerors_set_nighttalon: {
    name: '厲牙皮甲',
    desc: '完整的夜爪皮甲系列。',
  },
  conquerors_set_soulflame: {
    name: '怨焰法衣',
    desc: '完整的魂焰布甲系列。',
  },
  conquerors_set_stormcallers: {
    name: '喚風法衣',
    desc: '完整的喚暴者布甲系列。',
  },
  // Professions pages: 傑作 is the Reliquary's own masterwork noun (the markFind
  // labels these pages hold), 稀有發現 the guide's rare-finds heading, 標本 the
  // perfect-specimen mark's noun; 展廳 shares the 展 of 策展人 (Curator).
  professions_masterwork: {
    name: '傑作展廳',
    desc: '首件傑作的終身紀念。若老玩家早於本展廳存在，則會一直空著，直到下一次傑作觸發（絕不虛構製作歷史）。',
  },
  professions_field_notes: {
    name: '稀有發現手記',
    desc: '來自荒野的標誌性稀有發現：礦脈、心材、月下之花與完美標本。',
  },
  professions_specimens: {
    name: '關鍵標本',
    desc: '無瑕的屍體標本、頂級的精緻野外材料，以及垂釣者夢寐以求的收穫：一座微縮的工匠博物館。',
  },
  // Horizons pages: the shipped HUD labels for the same three collections.
  horizons_mounts: {
    name: '坐騎',
    desc: '馬廄中的可騎坐騎、英雄難度韁繩、裂隙史詩與更稀有的鞍具。歸屬跟隨實際的韁繩物品（背包與銀行）。',
  },
  horizons_weapon_skins: {
    name: '武器外觀',
    desc: '軍械庫中通行全帳號的武器外觀。離線或沒有帳號飾品時為空；絕不會是角色掉落物。',
  },
  horizons_titles: {
    name: '頭銜',
    desc: '從功績之書中獲得的頭銜。純屬裝飾：絕不提供強度、掉落率或保底。',
  },
  // The Rift page (Phase 21): the shipped rift noun (deed dgn_rift and the
  // sourceRift line both say 裂隙), used bare as the proper name.
  conquerors_the_rift: {
    name: '裂隙',
    desc: '變幻不定的裂隙的標誌性戰利品，從遊蕩其中的恐怖造物，到S級追逐的兩件珍寶。',
  },
  // Rares of the Realm pages (Phase 21): composed in the chronicle rare
  // deeds' register (chr_vale_rares zh_TW reads 溪谷惡煞, chr_marsh_rares
  // 霧中之名); no mob names inside page names.
  conquerors_rares_of_the_realm: {
    name: '天下惡煞',
    desc: '在這片天下擊倒每一隻有名稀有怪的憑證。',
  },
  conquerors_spoils_of_the_realm: {
    name: '惡煞的戰利品',
    desc: '天下各路有名稀有怪隨身攜帶的標誌性珍寶。',
  },
  // Warfare pages (Phase 21): the shipped WARFARE brand noun (statInfo and
  // the itemSets.warfare_* bonus lines both say 戰爭) plus the gallery noun
  // the masterwork page uses (展廳) and the shipped armory noun
  // (wocStore.armoryTitle 兵器庫).
  conquerors_warfare_gallery: {
    name: '戰爭展廳',
    desc: '五套戰爭戰鬥裝備，以榮譽一件件掙得。',
  },
  conquerors_warfare_armory: {
    name: '戰爭兵器庫',
    desc: '以來之不易的榮譽購得的戰爭飾品與武器。',
  },
  // Vault of Ages (Phase 21): composed from the shipped vault noun (the
  // col_reliquary_complete title reads 寶庫策展人).
  horizons_vault_of_ages: {
    name: '歲月寶庫',
    desc: '屬於過往年代的絕版珍寶。這些聖物已無法再獲得；寶庫以此致敬仍保有它們的老玩家。',
  },
  // Riftbound (Phase 21): the shipped band noun (entities.items.
  // riftbound_band_of_*.name read 裂隙之戒), which carries the same rift noun
  // the Rift page uses.
  horizons_riftbound: {
    name: '裂隙之戒',
    desc: '個人專屬的裂隙之戒，為率先通關分級裂隙的隊伍中每位勇士鑄造。每個角色只能擁有自己的那一枚。',
  },
};
