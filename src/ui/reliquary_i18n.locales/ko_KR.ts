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
  conquerors_hollow_crypt: {
    name: '텅 빈 묘실',
    desc: '무덤부름 모르덴과 공허한 묘소에서 빼앗은 상징적인 전리품.',
  },
  conquerors_hollow_crypt_heroic: {
    name: '영웅: 텅 빈 묘실',
    desc: '무덤부름 모르덴에게서 영웅 난이도에서만 나오는 서사 장비.',
  },
  conquerors_sunken_bastion: {
    name: '가라앉은 요새',
    desc: '올렌과 안개엮는자 바엘에게서 나오는 희귀 및 서사 전리품.',
  },
  conquerors_sunken_bastion_heroic: {
    name: '영웅: 가라앉은 요새',
    desc: '안개엮는자 바엘에게서 영웅 난이도에서만 나오는 서사 장비.',
  },
  conquerors_drowned_temple: {
    name: '익사한 신전',
    desc: '성가대모 셀세와 이솔레이, 익사한 달의 화신에게서 나오는 희귀 전리품.',
  },
  conquerors_drowned_temple_heroic: {
    name: '영웅: 익사한 신전',
    desc: '이솔레이에게서 영웅 난이도에서만 나오는 서사 장비.',
  },
  conquerors_gravewyrm_sanctum: {
    name: '무덤고룡 성소',
    desc: '성소의 우두머리들과 무덤고룡 코르줄에게서 나오는 희귀 및 서사 전리품.',
  },
  conquerors_gravewyrm_sanctum_heroic: {
    name: '영웅: 무덤고룡 성소',
    desc: '무덤고룡 코르줄에게서 영웅 난이도에서만 나오는 서사 장비.',
  },
  conquerors_wildheart_basin: {
    name: '야생심장 분지',
    desc: '줄가르와 송곳니 군주 야수조련사에게서 나오는 상징적인 무기.',
  },
  conquerors_wildheart_basin_heroic: {
    name: '영웅: 야생심장 분지',
    desc: '분지의 목소리 줄가르에게서 영웅 난이도에서만 나오는 서사 장비.',
  },
  // The arena entity reads 니트락시스 공격대 투기장; the page collects the raid's
  // spoils rather than naming the room, so the arena noun is dropped and the
  // boss transliteration kept byte-identical to that entity name.
  conquerors_nythraxis: {
    name: '니트락시스 공격대',
    desc: '나이트락시스, 손피크의 재앙에게서 나오는 서사 및 전설 전리품.',
  },
  conquerors_nythraxis_heroic: {
    name: '영웅: 니트락시스 공격대',
    desc: '나이트락시스에게서 영웅 난이도에서만 나오는 공격대 무기.',
  },
  conquerors_thunzharr: {
    name: '천자르, 깨어나는 봉우리',
    desc: '깨어나는 봉우리의 월드 보스에게서 나오는 개인 서사 전리품.',
  },
  conquerors_collapsed_reliquary: {
    name: '무너진 성물실',
    desc: '무너진 성물고의 자물쇠 상자에서 나오는 상징적인 희귀 물품.',
  },
  conquerors_drowned_litany: {
    name: '익사한 연도',
    desc: '익사한 연도에서 나오는 희귀 및 서사 전리품.',
  },
  // Set pages: entities.itemSets.* names verbatim.
  conquerors_set_deathlord: {
    name: '고분군주의 전투장비',
    desc: '데스로드 판금 세트 전체.',
  },
  conquerors_set_wyrmshadow: {
    name: '밤송곳니 의복',
    desc: '웜섀도우 가죽 세트 전체.',
  },
  conquerors_set_necromancers: {
    name: '비탄직물 의복',
    desc: '네크로맨서 천 세트 전체.',
  },
  conquerors_set_crownforged: {
    name: '뼈벼림 전투장비',
    desc: '크라운포지드 판금 세트 전체.',
  },
  conquerors_set_nighttalon: {
    name: '흉포송곳니 가죽장비',
    desc: '나이트탈론 가죽 세트 전체.',
  },
  conquerors_set_soulflame: {
    name: '망령불꽃 의복',
    desc: '소울플레임 천 세트 전체.',
  },
  conquerors_set_stormcallers: {
    name: '강풍부름 의복',
    desc: '스톰콜러 천 세트 전체.',
  },
  // Professions pages: 걸작 is the one masterwork noun everywhere (crafting
  // toast/seal, the markFind labels these pages hold, and this title; the
  // 2026-08-07 QA retired the gallery's former 명작 coinage, see the masterwork
  // glossary row), 희귀한 발견 the guide's rare-finds heading, 표본 the
  // perfect-specimen mark's noun.
  professions_masterwork: {
    name: '걸작 갤러리',
    desc: '첫 걸작을 기리는 평생 전리품. 고참 캐릭터가 이 전시실보다 오래되었다면 다음 걸작이 나올 때까지 비어 있습니다(제작 이력을 지어내지 않습니다).',
  },
  professions_field_notes: {
    name: '희귀한 발견 기록',
    desc: '야생에서 얻은 상징적인 희귀 발견물: 광맥, 심재, 달빛 꽃, 그리고 완벽한 표본.',
  },
  professions_specimens: {
    name: '주요 표본',
    desc: '흠 없는 사체 표본, 최상급 고급 야외 재료, 그리고 낚시꾼이 노리는 대어: 축소판 장인 박물관.',
  },
  // Horizons pages: the shipped HUD labels for the same three collections.
  horizons_mounts: {
    name: '탈것',
    desc: '마구간의 탈것, 영웅 난이도 고삐, 균열 서사 장비, 그리고 더 희귀한 안장. 소유 여부는 실제 고삐 물품을 따릅니다(가방과 은행).',
  },
  horizons_weapon_skins: {
    name: '무기 스킨',
    desc: '무기고의 계정 전체 무기 외형. 오프라인이거나 계정 치장품이 없으면 비어 있으며, 캐릭터 전리품이 되는 일은 없습니다.',
  },
  horizons_titles: {
    name: '칭호',
    desc: '업적의 서에서 얻은 칭호. 오직 치장용으로, 능력치나 드롭률, 보정을 주지 않습니다.',
  },
  // The Rift page (Phase 21): the shipped rift noun (deed dgn_rift and the
  // sourceRift line both say 균열), used bare as the proper name.
  conquerors_the_rift: {
    name: '균열',
    desc: '끊임없이 변하는 균열의 상징적인 전리품. 떠도는 공포부터 S등급 사냥의 두 보물까지.',
  },
  // Rares of the Realm pages (Phase 21): composed in the chronicle rare
  // deeds' register (chr_marsh_rares ko reads 안개 속의 이름들); no mob names
  // inside page names.
  conquerors_rares_of_the_realm: {
    name: '온 땅의 이름들',
    desc: '왕국 곳곳에서 쓰러뜨린 모든 이름 있는 희귀 개체의 증표.',
  },
  conquerors_spoils_of_the_realm: {
    name: '이름난 자들의 전리품',
    desc: '왕국의 이름 있는 희귀 개체들이 지니고 다니는 상징적인 보물.',
  },
  // Warfare pages (Phase 21): the shipped WARFARE brand noun (statInfo and
  // the itemSets.warfare_* bonus lines both say 워페어) plus the gallery noun
  // the masterwork page uses (갤러리) and the shipped armory noun
  // (wocStore.armoryTitle 무기고).
  conquerors_warfare_gallery: {
    name: '워페어 갤러리',
    desc: '다섯 가지 전쟁 전투 장비. 명예로 한 점씩 얻습니다.',
  },
  conquerors_warfare_armory: {
    name: '워페어 무기고',
    desc: '힘겹게 모은 명예로 구입하는 전쟁 장신구와 무기.',
  },
  // Vault of Ages (Phase 21): composed from the shipped vault noun (the
  // col_reliquary_complete title reads 보물고의 큐레이터).
  horizons_vault_of_ages: {
    name: '옛 시대의 보물고',
    desc: '지나간 시대의 단종된 보물. 이 성물들은 더 이상 얻을 수 없으며, 이 보고는 그것을 간직한 고참들을 기립니다.',
  },
  // Riftbound (Phase 21): the shipped Riftbound adjective from the band item
  // names (entities.items.riftbound_band_of_*.name read 균열결속 반지), used
  // bare as the family name.
  horizons_riftbound: {
    name: '균열결속',
    desc: '개인 전용 균열의 고리. 등급 균열의 첫 클리어를 따낸 파티의 용사 한 명 한 명을 위해 벼려집니다. 캐릭터는 자기 것만 가질 수 있습니다.',
  },
};
