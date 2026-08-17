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
  conquerors_hollow_crypt: {
    name: '空洞墓穴',
    desc: '从唤墓者莫森与空洞墓穴手中夺来的标志性战利品。',
  },
  conquerors_hollow_crypt_heroic: {
    name: '英雄：空洞墓穴',
    desc: '唤墓者莫森身上仅限英雄难度掉落的史诗物品。',
  },
  conquerors_sunken_bastion: {
    name: '沉没堡垒',
    desc: '来自奥伦与缚雾者维尔的稀有与史诗战利品。',
  },
  conquerors_sunken_bastion_heroic: {
    name: '英雄：沉没堡垒',
    desc: '缚雾者维尔身上仅限英雄难度掉落的史诗物品。',
  },
  conquerors_drowned_temple: {
    name: '溺亡神殿',
    desc: '来自唱诗母塞尔瑟与伊索蕾，溺月化身的稀有战利品。',
  },
  conquerors_drowned_temple_heroic: {
    name: '英雄：溺亡神殿',
    desc: '伊索蕾身上仅限英雄难度掉落的史诗物品。',
  },
  conquerors_gravewyrm_sanctum: {
    name: '墓龙圣所',
    desc: '来自圣所各首领与墓龙科祖尔的稀有与史诗战利品。',
  },
  conquerors_gravewyrm_sanctum_heroic: {
    name: '英雄：墓龙圣所',
    desc: '墓龙科祖尔身上仅限英雄难度掉落的史诗物品。',
  },
  conquerors_wildheart_basin: {
    name: '荒野之心盆地',
    desc: '来自祖尔加与獠牙领主驯兽师的标志性武器。',
  },
  conquerors_wildheart_basin_heroic: {
    name: '英雄：荒野之心盆地',
    desc: '盆地之声祖尔加身上仅限英雄难度掉落的史诗物品。',
  },
  // The arena entity reads 尼思拉克西斯团队竞技场; the page collects the raid's
  // spoils rather than naming the room, so the arena noun gives way to the
  // shipped raid noun 团队副本 (guide.glossary.raidTerm) with the boss
  // transliteration kept byte-identical to that entity name.
  conquerors_nythraxis: {
    name: '尼思拉克西斯团队副本',
    desc: '来自尼思拉克西斯，荆峰之灾的史诗与传说战利品。',
  },
  conquerors_nythraxis_heroic: {
    name: '英雄：尼思拉克西斯团队副本',
    desc: '尼思拉克西斯身上仅限英雄难度掉落的团队副本武器。',
  },
  conquerors_thunzharr: {
    name: '桑扎尔，觉醒之峰',
    desc: '来自觉醒之峰世界首领的个人史诗战利品。',
  },
  conquerors_collapsed_reliquary: {
    name: '坍塌的圣物库',
    desc: '来自坍塌的圣物库中需开锁宝箱的标志性稀有物品。',
  },
  conquerors_drowned_litany: {
    name: '溺亡连祷',
    desc: '来自溺亡连祷的稀有与史诗战利品。',
  },
  // Set pages: entities.itemSets.* names verbatim.
  conquerors_set_deathlord: {
    name: '冢主战甲',
    desc: '完整的冢主板甲系列。',
  },
  conquerors_set_wyrmshadow: {
    name: '夜牙法衣',
    desc: '完整的龙影皮甲系列。',
  },
  conquerors_set_necromancers: {
    name: '哀织法衣',
    desc: '完整的死灵法师布甲系列。',
  },
  conquerors_set_crownforged: {
    name: '骨铸战装',
    desc: '完整的冠铸板甲系列。',
  },
  conquerors_set_nighttalon: {
    name: '恐牙皮甲',
    desc: '完整的夜爪皮甲系列。',
  },
  conquerors_set_soulflame: {
    name: '魂焰法衣',
    desc: '完整的魂焰布甲系列。',
  },
  conquerors_set_stormcallers: {
    name: '唤风法衣',
    desc: '完整的唤暴者布甲系列。',
  },
  // Professions pages: 杰作 is the Reliquary's own masterwork noun (the markFind
  // labels these pages hold), 稀有发现 the guide's rare-finds heading, 标本 the
  // perfect-specimen mark's noun; 展厅 shares the 展 of 策展人 (Curator).
  professions_masterwork: {
    name: '杰作展厅',
    desc: '首件杰作的终身纪念。若老玩家早于本展厅存在，则会一直空着，直到下一次杰作触发（绝不虚构制作历史）。',
  },
  professions_field_notes: {
    name: '稀有发现手记',
    desc: '来自荒野的标志性稀有发现：矿脉、心材、月下之花与完美标本。',
  },
  professions_specimens: {
    name: '关键标本',
    desc: '无瑕的尸体标本、顶级的精致野外材料，以及垂钓者梦寐以求的收获：一座微缩的工匠博物馆。',
  },
  // Horizons pages: the shipped HUD labels for the same three collections.
  horizons_mounts: {
    name: '坐骑',
    desc: '马厩中的可骑坐骑、英雄难度缰绳、裂隙史诗与更稀有的鞍具。归属跟随实际的缰绳物品（背包与银行）。',
  },
  horizons_weapon_skins: {
    name: '武器外观',
    desc: '军械库中通行全账号的武器外观。离线或没有账号饰品时为空；绝不会是角色掉落物。',
  },
  horizons_titles: {
    name: '头衔',
    desc: '从功绩之书中获得的头衔。纯属装饰：绝不提供强度、掉落率或保底。',
  },
  // The Rift page (Phase 21): the shipped rift noun (deed dgn_rift and the
  // sourceRift line both say 裂隙), used bare as the proper name.
  conquerors_the_rift: {
    name: '裂隙',
    desc: '变幻不定的裂隙的标志性战利品，从游荡其中的恐怖造物，到S级追逐的两件珍宝。',
  },
  // Rares of the Realm pages (Phase 21): composed in the chronicle rare
  // deeds' register (chr_vale_rares zh_CN reads 溪谷群凶, chr_marsh_rares
  // 雾中恶名); no mob names inside page names.
  conquerors_rares_of_the_realm: {
    name: '天下恶名',
    desc: '在这片天下击倒每一只有名稀有怪的凭证。',
  },
  conquerors_spoils_of_the_realm: {
    name: '恶名者的战利品',
    desc: '天下各路有名稀有怪随身携带的标志性珍宝。',
  },
  // Warfare pages (Phase 21): the shipped WARFARE brand noun (statInfo and
  // the itemSets.warfare_* bonus lines both say 战争) plus the gallery noun
  // the masterwork page uses (展厅) and the shipped armory noun
  // (wocStore.armoryTitle 兵器库).
  conquerors_warfare_gallery: {
    name: '战争展厅',
    desc: '五套战争战斗装备，以荣誉一件件挣得。',
  },
  conquerors_warfare_armory: {
    name: '战争兵器库',
    desc: '以来之不易的荣誉购得的战争饰品与武器。',
  },
  // Vault of Ages (Phase 21): composed from the shipped vault noun (the
  // col_reliquary_complete title reads 宝库策展人).
  horizons_vault_of_ages: {
    name: '岁月宝库',
    desc: '属于过往年代的绝版珍宝。这些圣物已无法再获得；宝库以此致敬仍保有它们的老玩家。',
  },
  // Riftbound (Phase 21): the shipped band noun (entities.items.
  // riftbound_band_of_*.name read 裂隙之戒), which carries the same rift noun
  // the Rift page uses.
  horizons_riftbound: {
    name: '裂隙之戒',
    desc: '个人专属的裂隙之戒，为率先通关分级裂隙的队伍中每位勇士铸造。每个角色只能拥有自己的那一枚。',
  },
};
