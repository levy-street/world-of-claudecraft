// Reliquary page name locale table for ja_JP (data-as-code, size-exempt).
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
  conquerors_hollow_crypt: { name: '虚ろの墓所' },
  conquerors_hollow_crypt_heroic: { name: '英雄: 虚ろの墓所' },
  conquerors_sunken_bastion: { name: '沈んだ砦' },
  conquerors_sunken_bastion_heroic: { name: '英雄: 沈んだ砦' },
  conquerors_drowned_temple: { name: '溺れし神殿' },
  conquerors_drowned_temple_heroic: { name: '英雄: 溺れし神殿' },
  conquerors_gravewyrm_sanctum: { name: '墓ワームの聖所' },
  conquerors_gravewyrm_sanctum_heroic: { name: '英雄: 墓ワームの聖所' },
  conquerors_wildheart_basin: { name: 'ワイルドハート盆地' },
  conquerors_wildheart_basin_heroic: { name: '英雄: ワイルドハート盆地' },
  // The arena entity reads ナイスラクシスのレイドアリーナ; the page collects the
  // raid's spoils rather than naming the room, so the arena noun is dropped and
  // the boss transliteration kept byte-identical.
  conquerors_nythraxis: { name: 'ナイスラクシスのレイド' },
  conquerors_nythraxis_heroic: { name: '英雄: ナイスラクシスのレイド' },
  conquerors_thunzharr: { name: 'サンザール、目覚めし峰' },
  conquerors_collapsed_reliquary: { name: '崩れた聖遺物庫' },
  conquerors_drowned_litany: { name: '溺れし連祷' },
  // Set pages: entities.itemSets.* names verbatim.
  conquerors_set_deathlord: { name: 'バロウロードの戦装束' },
  conquerors_set_wyrmshadow: { name: 'ナイトファングの装束' },
  conquerors_set_necromancers: { name: 'モーンウィーヴの法衣' },
  conquerors_set_crownforged: { name: 'ボーンロートの戦装束' },
  conquerors_set_nighttalon: { name: 'ダイアファングの革装束' },
  conquerors_set_soulflame: { name: 'レイスファイアの法衣' },
  conquerors_set_stormcallers: { name: 'ゲイルコールの法衣' },
  // Professions pages: 傑作 is the one masterwork noun everywhere (crafting
  // toast/seal, the markFind labels these pages hold, and this title; the
  // 2026-08-07 QA retired the gallery's former 名作 coinage, see the
  // masterwork glossary row), 珍しい発見 the guide's rare-finds heading,
  // 標本 the perfect-specimen mark's noun.
  professions_masterwork: { name: '傑作ギャラリー' },
  professions_field_notes: { name: '珍しい発見の記録' },
  professions_specimens: { name: '主要な標本' },
  // Horizons pages: the shipped HUD labels for the same three collections.
  horizons_mounts: { name: 'マウント' },
  horizons_weapon_skins: { name: '武器スキン' },
  horizons_titles: { name: '称号' },
  // The Rift page (Phase 21): the shipped rift noun (deed dgn_rift and the
  // sourceRift line both say リフト), used bare as the proper name.
  conquerors_the_rift: { name: 'リフト' },
  // Rares of the Realm pages (Phase 21): composed in the chronicle rare
  // deeds' register (chr_marsh_rares ja reads 霧に名だたる者); no mob names
  // inside page names.
  conquerors_rares_of_the_realm: { name: '大地に名だたる者' },
  conquerors_spoils_of_the_realm: { name: '名だたる者の戦利品' },
  // Warfare pages (Phase 21): the shipped WARFARE brand noun (statInfo and
  // the itemSets.warfare_* bonus lines both say ウォーフェア) plus the gallery
  // noun the masterwork page uses (ギャラリー) and the shipped armory noun
  // (wocStore.armoryTitle 武器庫).
  conquerors_warfare_gallery: { name: 'ウォーフェアギャラリー' },
  conquerors_warfare_armory: { name: 'ウォーフェア武器庫' },
  // Vault of Ages (Phase 21): composed from the shipped vault noun (the
  // col_reliquary_complete title reads 宝物庫のキュレーター).
  horizons_vault_of_ages: { name: '古き時代の宝物庫' },
  // Riftbound (Phase 21): the shipped Riftbound adjective from the band item
  // names (entities.items.riftbound_band_of_*.name read リフトバウンドリング),
  // used bare as the family name.
  horizons_riftbound: { name: 'リフトバウンド' },
};
