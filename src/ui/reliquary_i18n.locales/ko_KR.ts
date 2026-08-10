// Reliquary page name locale table for ko_KR (data-as-code, size-exempt).
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
  conquerors_hollow_crypt: { name: '텅 빈 묘실' },
  conquerors_hollow_crypt_heroic: { name: '영웅: 텅 빈 묘실' },
  conquerors_sunken_bastion: { name: '가라앉은 요새' },
  conquerors_sunken_bastion_heroic: { name: '영웅: 가라앉은 요새' },
  conquerors_drowned_temple: { name: '익사한 신전' },
  conquerors_drowned_temple_heroic: { name: '영웅: 익사한 신전' },
  conquerors_gravewyrm_sanctum: { name: '무덤고룡 성소' },
  conquerors_gravewyrm_sanctum_heroic: { name: '영웅: 무덤고룡 성소' },
  conquerors_wildheart_basin: { name: '야생심장 분지' },
  conquerors_wildheart_basin_heroic: { name: '영웅: 야생심장 분지' },
  // The arena entity reads 니트락시스 공격대 투기장; the page collects the raid's
  // spoils rather than naming the room, so the arena noun is dropped and the
  // boss transliteration kept byte-identical to that entity name.
  conquerors_nythraxis: { name: '니트락시스 공격대' },
  conquerors_nythraxis_heroic: { name: '영웅: 니트락시스 공격대' },
  conquerors_thunzharr: { name: '천자르, 깨어나는 봉우리' },
  conquerors_collapsed_reliquary: { name: '무너진 성물실' },
  conquerors_drowned_litany: { name: '익사한 연도' },
  // Set pages: entities.itemSets.* names verbatim.
  conquerors_set_deathlord: { name: '고분군주의 전투장비' },
  conquerors_set_wyrmshadow: { name: '밤송곳니 의복' },
  conquerors_set_necromancers: { name: '비탄직물 의복' },
  conquerors_set_crownforged: { name: '뼈벼림 전투장비' },
  conquerors_set_nighttalon: { name: '흉포송곳니 가죽장비' },
  conquerors_set_soulflame: { name: '망령불꽃 의복' },
  conquerors_set_stormcallers: { name: '강풍부름 의복' },
  // Professions pages: 걸작 is the one masterwork noun everywhere (crafting
  // toast/seal, the markFind labels these pages hold, and this title; the
  // 2026-08-07 QA retired the gallery's former 명작 coinage, see the masterwork
  // glossary row), 희귀한 발견 the guide's rare-finds heading, 표본 the
  // perfect-specimen mark's noun.
  professions_masterwork: { name: '걸작 갤러리' },
  professions_field_notes: { name: '희귀한 발견 기록' },
  professions_specimens: { name: '주요 표본' },
  // Horizons pages: the shipped HUD labels for the same three collections.
  horizons_mounts: { name: '탈것' },
  horizons_weapon_skins: { name: '무기 스킨' },
  horizons_titles: { name: '칭호' },
  // The Rift page (Phase 21): the shipped rift noun (deed dgn_rift and the
  // sourceRift line both say 균열), used bare as the proper name.
  conquerors_the_rift: { name: '균열' },
  // Rares of the Realm pages (Phase 21): composed in the chronicle rare
  // deeds' register (chr_marsh_rares ko reads 안개 속의 이름들); no mob names
  // inside page names.
  conquerors_rares_of_the_realm: { name: '온 땅의 이름들' },
  conquerors_spoils_of_the_realm: { name: '이름난 자들의 전리품' },
  // Warfare pages (Phase 21): the shipped WARFARE brand noun (statInfo and
  // the itemSets.warfare_* bonus lines both say 워페어) plus the gallery noun
  // the masterwork page uses (갤러리) and the shipped armory noun
  // (wocStore.armoryTitle 무기고).
  conquerors_warfare_gallery: { name: '워페어 갤러리' },
  conquerors_warfare_armory: { name: '워페어 무기고' },
  // Vault of Ages (Phase 21): composed from the shipped vault noun (the
  // col_reliquary_complete title reads 보물고의 큐레이터).
  horizons_vault_of_ages: { name: '옛 시대의 보물고' },
  // Riftbound (Phase 21): the shipped Riftbound adjective from the band item
  // names (entities.items.riftbound_band_of_*.name read 균열결속 반지), used
  // bare as the family name.
  horizons_riftbound: { name: '균열결속' },
};
