// Deed name / desc / title locale table for ko_KR (data-as-code, size-exempt).
// One per-base-locale chunk behind DEED_LOCALE_LOADERS in deed_i18n.ts, so a
// visitor downloads only their own locale's deed strings. Split verbatim from
// the former deed_i18n.newlocales.ts single chunk; values carry no em or en
// dashes (repo copy rule). English (en / en_CA) resolves to the authored
// source before this table is consulted.
import type { DeedLocaleTable } from '../deed_i18n';

export const table: DeedLocaleTable = {
  prog_first_steps: {
    name: '첫걸음',
    desc: '레벨 2를 달성하고 머나먼 여정의 첫걸음을 내디디십시오.',
  },
  prog_finding_your_feet: {
    name: '걸음마 떼기',
    desc: '레벨 5를 달성하십시오. 야생이 벌써 조금은 만만해 보입니다.',
  },
  prog_double_digits: { name: '두 자릿수', desc: '레벨 10을 달성하고 특성을 해금하십시오.' },
  prog_the_long_middle: { name: '길고 긴 중반', desc: '레벨 15를 달성하십시오.' },
  prog_level_cap: { name: '정상에서 보는 풍경', desc: '최고 레벨인 레벨 20을 달성하십시오.' },
  prog_well_rested: { name: '충분한 휴식', desc: '휴식 경험치가 쌓일 때까지 여관에 머무르십시오.' },
  prog_talented: { name: '값진 한 점', desc: '첫 특성 점수를 사용하십시오.' },
  prog_specialized: { name: '출사표', desc: '전문화를 선택하고 그 대표 기술을 배우십시오.' },
  prog_deep_roots: { name: '깊이 내린 뿌리', desc: '마지막 단의 특성에 특성 점수를 사용하십시오.' },
  prog_full_build: {
    name: '온전한 열하나',
    desc: '특성 점수 11점을 모두 하나의 조합에 투자하십시오.',
  },
  prog_veteran: { name: '베테랑', desc: '누적 경험치 250,000을 획득하십시오.', title: '베테랑' },
  prog_champion: { name: '용사', desc: '누적 경험치 500,000을 획득하십시오.', title: '용사' },
  prog_paragon: { name: '귀감', desc: '누적 경험치 1,000,000을 획득하십시오.', title: '귀감' },
  prog_mythic: { name: '신화', desc: '누적 경험치 2,500,000을 획득하십시오.', title: '신화' },
  prog_eternal: { name: '영원', desc: '누적 경험치 5,000,000을 획득하십시오.', title: '영원' },
  prog_prestige: {
    name: '다시, 처음부터',
    desc: '최고 레벨에 도달한 뒤 경험치 막대를 한 번 더 채워 프레스티지 1등급을 획득하십시오.',
  },
  prog_prestige_5: { name: '몸에 밴 습관', desc: '프레스티지 5등급을 달성하십시오.' },
  prog_prestige_10: { name: '영구 기관', desc: '프레스티지 10등급을 달성하십시오.' },
  prog_first_harvest: { name: '들녘의 결실', desc: '첫 채집 지점을 수확하십시오.' },
  prog_mining_100: { name: '핏줄에 흐르는 광석', desc: '채광 숙련도 100을 달성하십시오.' },
  prog_logging_100: { name: '심재를 베는 자', desc: '벌목 숙련도 100을 달성하십시오.' },
  prog_herbalism_100: { name: '초원의 달인', desc: '약초 채집 숙련도 100을 달성하십시오.' },
  prog_master_gatherer: {
    name: '채집의 대가',
    desc: '채광, 벌목, 약초 채집 숙련도를 모두 100까지 올리십시오.',
  },
  prog_first_craft: { name: '손수 만든 물건', desc: '첫 제작을 성공적으로 완료하십시오.' },
  prog_craft_specialist: {
    name: '장인의 비법',
    desc: '한 가지 제작 기술을 75까지 올려 전문화 특전을 해금하십시오.',
  },
  prog_around_the_ring: {
    name: '공방 한 바퀴',
    desc: '서로 다른 다섯 가지 제작 기술을 25까지 올리십시오.',
  },
  cmb_first_blood: { name: '첫 피', desc: '첫 적을 처치하십시오.' },
  cmb_slayer: { name: '학살자', desc: '적 1,000명을 처치하십시오.' },
  cmb_legion_of_one: { name: '1인 군단', desc: '적 10,000명을 처치하십시오.' },
  cmb_heavy_hitter: { name: '강타자', desc: '총 500,000의 피해를 입히십시오.' },
  cmb_critical_eye: { name: '치명적인 눈', desc: '치명타를 500회 적중시키십시오.' },
  cmb_giantslayer: {
    name: '거인 사냥꾼',
    desc: '자신보다 레벨이 5 이상 높은 적에게 결정타를 날리십시오.',
  },
  cmb_first_fall: {
    name: '툭툭 털고 일어나기',
    desc: '처음으로 죽음을 맞이하십시오. 누구에게나 있는 일입니다.',
  },
  dgn_hollow_crypt: {
    name: '묘실을 깨뜨린 자',
    desc: '텅 빈 묘실에서 무덤부름 모르덴을 처치하십시오.',
  },
  dgn_sunken_bastion: {
    name: '안개의 매듭을 풀다',
    desc: '가라앉은 요새에서 안개엮는자 바엘을 처치하십시오.',
  },
  dgn_drowned_temple: {
    name: '달을 가라앉히다',
    desc: '익사한 신전에서 이솔레이, 익사한 달의 화신을 처치하십시오.',
  },
  dgn_gravewyrm_sanctum: {
    name: '지하의 고룡',
    desc: '무덤고룡 성소에서 무덤고룡 코르줄을 처치하십시오.',
  },
  dgn_hollow_crypt_heroic: {
    name: '영웅: 텅 빈 묘실',
    desc: '영웅 난이도의 텅 빈 묘실에서 무덤부름 모르덴을 처치하십시오.',
  },
  dgn_sunken_bastion_heroic: {
    name: '영웅: 가라앉은 요새',
    desc: '영웅 난이도의 가라앉은 요새에서 안개엮는자 바엘을 처치하십시오.',
  },
  dgn_drowned_temple_heroic: {
    name: '영웅: 익사한 신전',
    desc: '영웅 난이도의 익사한 신전에서 이솔레이, 익사한 달의 화신을 처치하십시오.',
  },
  dgn_gravewyrm_sanctum_heroic: {
    name: '영웅: 무덤고룡 성소',
    desc: '영웅 난이도의 무덤고룡 성소에서 무덤고룡 코르줄을 처치하십시오.',
  },
  dgn_nythraxis: {
    name: '재앙의 끝',
    desc: '봉인된 왕실 문 너머에서 나이트락시스, 손피크의 재앙을 처치하십시오.',
  },
  dgn_nythraxis_heroic: {
    name: '영웅: 재앙의 끝',
    desc: '영웅 난이도에서 나이트락시스, 손피크의 재앙을 처치하십시오.',
  },
  dgn_thornpeak_rounds: {
    name: '던전 순례',
    desc: '텅 빈 묘실, 가라앉은 요새, 익사한 신전, 무덤고룡 성소를 모두 공략하십시오.',
  },
  dgn_deepward: {
    name: '심연 파수꾼',
    desc: '모든 던전과 공격대, 두 탐굴을 영웅 난이도로 정복하십시오.',
  },
  dgn_mark_circuit: {
    name: '완주',
    desc: '하루 안에 네 곳의 영웅 던전 모두에서 영웅의 징표를 획득하십시오.',
  },
  dgn_boss_clears_50: { name: '쉰 번째 문 너머', desc: '던전 최종 우두머리를 50번 처치하십시오.' },
  dgn_morthen_flawless: {
    name: '뼈도 못 추리게',
    desc: '파티원이 한 명도 죽지 않고 영웅 난이도에서 무덤부름 모르덴을 처치하십시오.',
  },
  dgn_morthen_trio: {
    name: '무덤에 맞선 셋',
    desc: '3명 이하의 플레이어로 무덤부름 모르덴을 처치하십시오.',
  },
  dgn_olen_arc: {
    name: '사신을 비껴가다',
    desc: '기사대장 올렌을 처치하되, 그의 수확의 호가 현재 대상 외에는 누구도 맞히지 않게 하십시오.',
  },
  dgn_vael_thralls: {
    name: '노예는 없다',
    desc: '안개엮는자 바엘이 불러내는 익사한 노예를 모두 처치한 상태에서 그를 쓰러뜨리십시오.',
  },
  dgn_ysolei_moonspawn: {
    name: '달의 부산물까지 남김없이',
    desc: '이솔레이가 불러내는 달의 부산물을 모두 처치한 상태에서 그녀를 쓰러뜨리십시오.',
  },
  dgn_ysolei_flawless: {
    name: '젖지 않은 눈',
    desc: '파티원이 한 명도 죽지 않고 영웅 난이도에서 이솔레이, 익사한 달의 화신을 처치하십시오.',
  },
  dgn_velkhar_bonewalkers: {
    name: '무덤에 도로 잠들라',
    desc: '대강령술사 벨카르가 쓰러지기 전에 되살아난 뼈걸음꾼을 모두 파괴하고 그를 처치하십시오.',
  },
  dgn_korzul_flawless: {
    name: '고룡을 쓰러뜨린 자',
    desc: '파티원이 한 명도 죽지 않고 영웅 난이도에서 무덤고룡 코르줄을 처치하십시오.',
    title: '고룡을 쓰러뜨린 자',
  },
  dgn_sanctum_speed: {
    name: '성소 질주',
    desc: '파티가 무덤고룡 성소를 차지한 뒤 15분 안에 무덤고룡 코르줄을 처치하십시오.',
  },
  dgn_nythraxis_gravebreaker: {
    name: '왕 앞에 무릎 꿇지 않으리',
    desc: '나이트락시스를 처치하되, 무덤파쇄가 현재 대상 외에는 누구도 맞히지 않게 하십시오.',
  },
  dgn_nythraxis_wardens: {
    name: '수호석의 파수꾼',
    desc: '모든 불사의 격노를 발동하기 전에 끊어 내고 나이트락시스를 처치하십시오.',
  },
  dgn_nythraxis_deathless: {
    name: '진정한 불사',
    desc: '공격대원이 단 한 명도 죽지 않고 영웅 난이도에서 나이트락시스, 손피크의 재앙을 처치하십시오.',
    title: '불사신',
  },
  cmb_thunzharr: {
    name: '산이 무너지다',
    desc: '스톰크래그에서 천자르, 깨어나는 봉우리를 쓰러뜨리십시오.',
  },
  cmb_thunzharr_unbroken: {
    name: '봉우리를 부순 자',
    desc: '첫 일격부터 마지막 숨이 끊어질 때까지 한 번도 죽지 않고 천자르, 깨어나는 봉우리를 쓰러뜨리십시오.',
    title: '봉우리를 부순 자',
  },
  cmb_thunzharr_ten: {
    name: '산 사냥이 몸에 배다',
    desc: '천자르, 깨어나는 봉우리를 10번 쓰러뜨리십시오.',
  },
  dlv_reliquary: { name: '성물실 질주', desc: '무너진 성물실을 돌파하십시오.' },
  dlv_reliquary_heroic: {
    name: '영웅: 무너진 성물실',
    desc: '영웅 단계에서 무너진 성물실을 돌파하십시오.',
  },
  dlv_litany: { name: '잠잠해진 연도', desc: '익사한 연도를 돌파하십시오.' },
  dlv_litany_heroic: {
    name: '영웅: 익사한 연도',
    desc: '영웅 단계에서 익사한 연도를 돌파하십시오.',
  },
  dlv_lore_journal: { name: '여백의 기록', desc: '탐굴 일지의 다섯 항목을 모두 해금하십시오.' },
  dlv_companion_max: {
    name: '깊은 곳의 벗',
    desc: '탐굴 동료 하나를 최고 등급까지 성장시키십시오.',
  },
  dlv_companions_both: {
    name: '두 등불을 밝히다',
    desc: '두 탐굴 동료, 수련사제 테사와 에다 리드핸드를 모두 최고 등급까지 성장시키십시오.',
  },
  dlv_clears_50: { name: '쉰 길 깊이', desc: '탐굴을 50회 완료하십시오.' },
  dlv_solo_heroic: {
    name: '둘이면 만원',
    desc: '다른 플레이어 없이 당신과 동료 단둘이서 영웅 단계 탐굴을 돌파하십시오.',
  },
  dlv_tumbler_premium: {
    name: '자물쇠의 길, 통달',
    desc: '가장 높은 판돈을 걸고 단 한 번뿐인 시도를 실수 없이 성공하여, 결계 걸린 성물실 상자를 여십시오.',
  },
  dlv_rite_flawless: {
    name: '한 글자도 틀림없이',
    desc: '익사한 성물실 의식을 단 하나의 실수도 없이 완수하십시오.',
  },
  dlv_varric_ringers: {
    name: '종은 침묵한다',
    desc: '부제 바릭이 일으킨 장례 종지기를 모두 처치한 상태로 그를 물리치십시오.',
  },
  dlv_nhalia_bells: {
    name: '종을 재우는 자',
    desc: '파티원 누구도 울리는 종에 맞지 않은 채 나할리아 수녀, 익사한 성가를 물리치십시오.',
    title: '종을 재우는 자',
  },
  chr_vale_chapter_i: {
    name: '골짜기 연대기, 제1장',
    desc: '사울의 연대기 제1장을 끝마치십시오: 이스트브룩의 첫 심부름을 마치고, 골짜기의 지리를 익히고, 그 땅의 생업을 처음 맛보십시오.',
  },
  chr_vale_chapter_ii: {
    name: '골짜기 연대기, 제2장',
    desc: '사울의 연대기 제2장을 끝마치십시오: 도적과 멀록과 광산의 해로운 짐승들을 처치하고, 소우필드에서 경기를 뛰고, 성물실에 도전하십시오.',
  },
  chr_vale_chapter_iii: {
    name: '골짜기의 연대기',
    desc: '골짜기의 이야기를 끝까지 지켜보십시오: 무덤부름의 정체를 밝히고, 텅 빈 묘실을 정화하고, 골짜기의 이름난 공포를 모두 쓰러뜨리십시오.',
    title: '골짜기의 증인',
  },
  chr_vale_gatherer: {
    name: '땅이 먹여 살린다',
    desc: '이스트브룩 골짜기에서 광맥, 나무 군락, 약초밭을 하나씩 채집하십시오.',
  },
  chr_vale_first_cast: {
    name: '거울호수의 무언가',
    desc: '이스트브룩 골짜기의 물에서 물고기 한 마리를 낚으십시오.',
  },
  chr_vale_packbreaker: { name: '무리를 흩는 자', desc: '10초 안에 숲늑대 3마리를 처치하십시오.' },
  chr_vale_cup_debut: {
    name: '구리 양동이 도전자',
    desc: '소우필드에서 열리는 골짜기 컵 경기에 나서서 공을 만져 보십시오.',
  },
  chr_vale_rares: {
    name: '골짜기의 공포',
    desc: '이스트브룩 골짜기의 이름난 공포 다섯을 처치하십시오: 늙은 그레이죠, 모거, 땅굴왕 그릭스, 베를란 대장, 영혼결속자 말드렉.',
  },
  chr_marsh_chapter_i: {
    name: '습지 연대기, 제1장',
    desc: '오스릭 펜의 연대기 제1장을 끝마치십시오: 펜브리지의 소집에 응하고, 둑길을 지켜 내고, 늪의 생김새를 익히십시오.',
  },
  chr_marsh_chapter_ii: {
    name: '습지 연대기, 제2장',
    desc: '오스릭 펜의 연대기 제2장을 끝마치십시오: 과부거미를 불태워 몰아내고, 익사한 망자를 영면에 들게 하고, 대구 대부를 낚아 올리고, 연도에 도전하십시오.',
  },
  chr_marsh_chapter_iii: {
    name: '마이어펜의 연대기',
    desc: '늪의 이야기를 끝까지 지켜보십시오: 교단의 야영지를 무너뜨리고, 가라앉은 요새에서 안개엮는자를 침묵시키고, 안개의 이름난 공포를 모두 쓰러뜨리십시오.',
    title: '마이어펜의 증인',
  },
  chr_marsh_gatherer: {
    name: '펜브리지 채집꾼',
    desc: '마이어펜 습지에서 광맥, 나무 군락, 약초밭을 하나씩 채집하십시오.',
  },
  chr_marsh_unburst: {
    name: '포자를 밟지 마시오',
    desc: '부식성 포자 폭발에 휘말리지 않고 늪 부푼괴물 8마리를 처치하십시오.',
  },
  chr_marsh_hush_the_mending: {
    name: '치유부터 끊어라',
    desc: '무덤부름 야영지에서, 무덤부름 치유사가 돌보는 교단원들보다 먼저 치유사를 처치하십시오.',
  },
  chr_marsh_rares: {
    name: '안개 속의 이름들',
    desc: '마이어펜 습지의 이름난 공포 셋을 처치하십시오: 굶주린 마이어죠, 익사한 슬룸투스, 자매 날리아.',
  },
  chr_peaks_chapter_i: {
    name: '고지 연대기, 제1장',
    desc: '젠지의 연대기 제1장을 끝마치십시오: 산등성이 길을 소탕하고, 굴을 비우고, 하이워치가 지키는 모든 길을 익히십시오.',
  },
  chr_peaks_chapter_ii: {
    name: '고지 연대기, 제2장',
    desc: '젠지의 연대기 제2장을 끝마치십시오: 드로그마르의 전쟁 야영지를 부수고, 깨어나는 폭풍을 읽어 내고, 글리머미어가 빛나는 곳에 서십시오.',
  },
  chr_peaks_chapter_iii: {
    name: '쏜피크의 연대기',
    desc: '산의 이야기를 끝까지 지켜보십시오: 고룡교단을 무너뜨리고, 성소를 침묵시키고, 깨어나는 봉우리를 쓰러뜨리고, 바위산의 이름난 공포를 모두 처치하십시오.',
    title: '쏜피크의 증인',
  },
  chr_peaks_sparring: {
    name: '성벽 훈련',
    desc: '하이워치 위쪽의 훈련용 허수아비에게 총 1,000의 피해를 입히십시오.',
  },
  chr_peaks_glimmer_cast: {
    name: '찬 물, 더 찬 빛',
    desc: '글리머미어에서 물고기 한 마리를 낚으십시오.',
  },
  chr_peaks_moongate: {
    name: '차가운 관문을 지나',
    desc: '글리머미어 호숫가의 달의 관문을 통과하십시오.',
  },
  chr_peaks_waking_witness: {
    name: '걸어 다니는 산',
    desc: '산을 성큼성큼 누비는 천자르, 깨어나는 봉우리를 직접 목격하십시오.',
  },
  chr_peaks_rares: {
    name: '바위에 새겨진 이름들',
    desc: '쏜피크 고지의 이름난 공포 넷을 처치하십시오: 철맥 감독관, 해골분쇄자 브루톡, 잿불날개 보스카르, 골수군주 바르카스.',
  },
  col_discovery_25: {
    name: '못 버리는 성미',
    desc: '서로 다른 아이템 25종을 발견하십시오 (아이템은 처음으로 당신의 소유가 된 순간 집계됩니다).',
  },
  col_discovery_75: { name: '까치의 눈', desc: '서로 다른 아이템 75종을 발견하십시오.' },
  col_discovery_150: {
    name: '호기심의 방',
    desc: '서로 다른 아이템 150종을 발견하십시오.',
    title: '학예사',
  },
  col_discovery_250: { name: '대도감', desc: '서로 다른 아이템 250종을 발견하십시오.' },
  col_first_rare: {
    name: '파랗게 빛나는 것',
    desc: '희귀 등급 아이템을 처음으로 손에 넣으십시오.',
  },
  col_first_epic: { name: '자줏빛 태생', desc: '영웅 등급 아이템을 처음으로 손에 넣으십시오.' },
  col_first_legendary: {
    name: '행운의 주황빛',
    desc: '전설 등급 아이템을 처음으로 손에 넣으십시오.',
  },
  col_set_vale_arcanist: {
    name: '골짜기 비전술사 예복',
    desc: '골짜기 비전술사 예복의 모든 부위를 발견하십시오.',
  },
  col_set_boundstone_vanguard: {
    name: '속박석 선봉대',
    desc: '속박석 선봉대의 모든 부위를 발견하십시오.',
  },
  col_set_greyjaw_stalker: {
    name: '그레이죠 추적자 장비',
    desc: '그레이죠 추적자 장비의 모든 부위를 발견하십시오.',
  },
  col_set_deathlord: {
    name: '고분군주 전투장비',
    desc: '고분군주 전투장비의 모든 부위를 발견하십시오.',
  },
  col_set_wyrmshadow: { name: '밤송곳니 의복', desc: '밤송곳니 의복의 모든 부위를 발견하십시오.' },
  col_set_necromancers: {
    name: '비탄직물 의복',
    desc: '비탄직물 의복의 모든 부위를 발견하십시오.',
  },
  col_set_crownforged: { name: '뼈벼림 예복', desc: '뼈벼림 예복의 모든 부위를 발견하십시오.' },
  col_set_nighttalon: {
    name: '흉포송곳니 가죽',
    desc: '흉포송곳니 가죽의 모든 부위를 발견하십시오.',
  },
  col_set_soulflame: { name: '망령불꽃 예복', desc: '망령불꽃 예복의 모든 부위를 발견하십시오.' },
  col_set_stormcallers: {
    name: '강풍부름 의복',
    desc: '강풍부름 의복의 모든 부위를 발견하십시오.',
  },
  col_seven_regalia: {
    name: '일곱 겹 옷장',
    desc: '일곱 가지 영웅 방어구 세트의 모든 부위를 발견하십시오.',
    title: '찬란한 자',
  },
  col_true_colors: {
    name: '본색을 드러내다',
    desc: '직업 기본 외형이 아닌 다른 외형을 걸치고 전장에 나서십시오.',
  },
  col_all_slots: {
    name: '열한 곳 빈틈없이',
    desc: '열한 개의 장비 칸 전부에 아이템을 동시에 장착하십시오.',
  },
  col_quartermaster_buyout: {
    name: '단골 손님',
    desc: '병참장교 벡스의 취급 물품 열 가지를 모두 발견하십시오.',
  },
  col_glimmerfin: { name: '희망의 반짝임', desc: '반짝이는 지느러미 코이를 낚으십시오.' },
  col_full_creel: {
    name: '가득 찬 어망',
    desc: '골짜기, 습지, 고지의 물에서 나는 여섯 가지 흔한 어획물을 모두 발견하십시오.',
  },
  col_junk_drawer: {
    name: '잡동사니 서랍',
    desc: '서로 다른 하급 등급 아이템 10종을 발견하십시오.',
  },
  pvp_arena_first_match: {
    name: '신발 속 모래',
    desc: '잿빛 투기장에서 어느 부문이든 등급전 한 경기를 치르십시오.',
  },
  pvp_arena_first_win: {
    name: '관중의 함성',
    desc: '어느 부문이든 등급전 투기장 경기에서 승리하십시오.',
  },
  pvp_arena_1v1_1600: {
    name: '투기장의 도전자',
    desc: '1대1 투기장 부문에서 평점 1600을 달성하십시오.',
  },
  pvp_arena_1v1_1750: {
    name: '투기장의 호적수',
    desc: '1대1 투기장 부문에서 평점 1750을 달성하십시오.',
  },
  pvp_arena_1v1_1900: {
    name: '검투사',
    desc: '1대1 투기장 부문에서 평점 1900을 달성하십시오.',
    title: '검투사',
  },
  pvp_arena_2v2_1600: {
    name: '둘이면 충분하다',
    desc: '2대2 투기장 부문에서 평점 1600을 달성하십시오.',
  },
  pvp_arena_2v2_1750: {
    name: '무시무시한 2인조',
    desc: '2대2 투기장 부문에서 평점 1750을 달성하십시오.',
  },
  pvp_arena_2v2_1900: {
    name: '완벽한 공조',
    desc: '2대2 투기장 부문에서 평점 1900을 달성하십시오.',
  },
  pvp_duel_first_win: { name: '결판은 밖에서', desc: '결투에서 승리하십시오.' },
  pvp_duel_grace: { name: '겸손의 가르침', desc: '결투에서 지되, 체면은 그럭저럭 지켜 내십시오.' },
  pvp_vcup_first_match: {
    name: '그라운드에 선 첫발',
    desc: '소우필드에서 골짜기 컵 경기 한 판을 승패에 관계없이 끝까지 치르십시오.',
  },
  pvp_vcup_first_win: { name: '첫 우승컵', desc: '등급전 골짜기 컵 경기에서 승리하십시오.' },
  pvp_vcup_wins_10: {
    name: '노련한 멧돼지공 선수',
    desc: '등급전 골짜기 컵 경기에서 10회 승리하십시오.',
  },
  pvp_vcup_wins_25: {
    name: '멧돼지공의 전설',
    desc: '등급전 골짜기 컵 경기에서 25회 승리하십시오.',
    title: '멧돼지공의 전설',
  },
  pvp_vcup_first_goal: { name: '마수걸이 골', desc: '등급전 골짜기 컵 경기에서 골을 넣으십시오.' },
  pvp_vcup_hat_trick: {
    name: '해트트릭의 주인공',
    desc: '3대3 이상 부문의 등급전 골짜기 컵 경기 한 판에서 세 골을 넣으십시오.',
  },
  pvp_vcup_golden_goal: {
    name: '황금의 순간',
    desc: '등급전 골짜기 컵 경기의 승부를 가르는 골든골을 넣으십시오.',
  },
  pvp_vcup_first_save: {
    name: '든든한 두 손',
    desc: '등급전 골짜기 컵 경기에서 골키퍼로 선방에 성공하십시오.',
  },
  pvp_vcup_clean_sheet: {
    name: '철벽 수문장',
    desc: '골키퍼로 한 골도 내주지 않고 등급전 골짜기 컵 경기에서 승리하십시오.',
  },
  pvp_vcup_guild_win: {
    name: '깃발을 위하여',
    desc: '길드의 깃발 아래 출전한 등급전 골짜기 컵 경기에서 승리하십시오.',
  },
  pvp_fiesta_first_bout: {
    name: '잔치의 불청객',
    desc: '2대2 피에스타 한 판을 승패에 관계없이 끝까지 싸우십시오.',
  },
  pvp_fiesta_first_win: {
    name: '피에스타의 주인공',
    desc: '2대2 피에스타 한 판에서 승리하십시오.',
  },
  pvp_fiesta_double: { name: '연달아 둘', desc: '4초 안에 피에스타 처치 2회를 기록하십시오.' },
  pvp_fiesta_shutdown: {
    name: '흥을 깨는 자',
    desc: '연속 처치 3회 이상을 이어 가던 피에스타 상대를 쓰러뜨리십시오.',
  },
  pvp_fiesta_full_build: {
    name: '완벽한 채비',
    desc: '세 웨이브 모두에서 증강을 확정한 채 피에스타 한 판에서 승리하십시오.',
  },
  pvp_fiesta_powerups: {
    name: '하나씩 전부',
    desc: '링의 파워업 네 가지를 각각 한 번 이상 획득하십시오: 질주광, 거상, 달 장화, 광전사.',
  },
  pvp_fiesta_five_kills: {
    name: '잔치를 짊어지다',
    desc: '피에스타 한 판에서 처치 5회를 기록하십시오.',
  },
  soc_first_party: { name: '함께라면 더 멀리', desc: '다른 플레이어와 함께 파티에 들어가십시오.' },
  soc_full_house: { name: '풀 하우스', desc: '다섯 명이 꽉 찬 파티로 던전을 끝까지 공략하십시오.' },
  soc_guild_joined: { name: '하나의 깃발 아래', desc: '길드의 일원이 되십시오.' },
  soc_guild_founded: { name: '창립자의 깃펜', desc: '자신만의 길드를 창설하십시오.' },
  soc_first_trade: { name: '공정한 거래', desc: '다른 플레이어와 거래를 완료하십시오.' },
  soc_first_sale: { name: '개업 첫날', desc: '세계 시장에서 첫 판매 대금을 수령하십시오.' },
  soc_steady_custom: { name: '단골 장사', desc: '세계 시장 판매로 통산 10골드를 수령하십시오.' },
  soc_market_magnate: {
    name: '시장의 거물',
    desc: '세계 시장 판매로 통산 100골드를 수령하십시오.',
    title: '거물',
  },
  soc_by_ravens_wing: {
    name: '까마귀 날개에 실어',
    desc: '돈이나 소포를 담은 까마귀 우편 편지를 보내십시오.',
  },
  soc_room_for_more: { name: '더 넣을 자리', desc: '첫 은행 확장을 구매하십시오.' },
  soc_gilded_strongbox: {
    name: '도금 금고',
    desc: '출납관이 팔아 주는 모든 은행 확장을 구매하십시오.',
  },
  soc_meet_bursar: {
    name: '페르난도를 믿을지어다',
    desc: '이스트브룩의 도금 금고를 지키는 출납관 페르난도에게 경의를 표하십시오.',
  },
  soc_pocket_money: { name: '쌈짓돈', desc: '통산 1골드의 돈을 전리품으로 획득하십시오.' },
  soc_heavy_purse: { name: '묵직한 돈주머니', desc: '통산 10골드의 돈을 전리품으로 획득하십시오.' },
  soc_wyrms_hoard: {
    name: '고룡의 보물더미',
    desc: '통산 100골드의 돈을 전리품으로 획득하십시오.',
  },
  soc_civic_duty: { name: '시민의 의무', desc: '첫 마을 중점 포인트를 배분하십시오.' },
  exp_long_road_north: {
    name: '북으로 가는 먼 길',
    desc: '세 거점 정착지를 모두 방문하십시오: 이스트브룩, 펜브리지, 하이워치.',
  },
  exp_vale_wayfarer: {
    name: '골짜기의 길손',
    desc: '이스트브룩 골짜기의 이름난 장소 11곳을 모두 방문하십시오.',
  },
  exp_marsh_wayfarer: {
    name: '습지의 길손',
    desc: '마이어펜 습지의 이름난 장소 8곳을 모두 방문하십시오.',
  },
  exp_peaks_wayfarer: {
    name: '고지의 길손',
    desc: '쏜피크 고지의 이름난 장소 10곳을 모두 방문하십시오.',
  },
  exp_world_traveler: {
    name: '세계 여행가',
    desc: '세 지역의 길손 업적을 모두 획득하십시오.',
    title: '길손',
  },
  exp_something_shiny: { name: '반짝이는 무언가', desc: '땅에 떨어진 반짝이는 물건을 주우십시오.' },
  exp_first_ore: { name: '땅을 내리쳐라', desc: '처음으로 광맥을 캐내십시오.' },
  exp_first_timber: { name: '나무 넘어간다!', desc: '처음으로 나무를 베어 목재를 거두십시오.' },
  exp_first_herb: { name: '약초 캐는 손', desc: '처음으로 약초를 캐십시오.' },
  feat_era_cap: { name: '제1시대의 아이', desc: '제1시대가 이어지는 동안 레벨 20을 달성했습니다.' },
  feat_book_complete: {
    name: '책 한 권을 통째로',
    desc: '업적의 서에 실린 모든 업적을 획득하십시오.',
  },
  feat_brightwood_relic: {
    name: '브라이트우드를 기억하며',
    desc: '옛 브라이트우드의 유물을 간직하십시오: 가시가죽 저킨 또는 군주의 왕관.',
  },
  hid_saul_footnote: {
    name: '역사의 각주',
    desc: '연대기 기록관 사울을 쉴 틈 없이 아홉 번이나 졸라 댔습니다.',
    title: '각주',
  },
  hid_gilded_tour: { name: '도금빛 유람', desc: '도금 금고의 세 지점 모두와 거래를 했습니다.' },
  hid_fall_death: { name: '중력은 언제나 이긴다', desc: '땅바닥과 긴 대화를 나누다 죽었습니다.' },
  hid_keepers_toll_twice: {
    name: '지킴이는 두 번 거둔다',
    desc: '지킴이의 대가를 아직 짊어진 채 죽었습니다.',
  },
  hid_roll_hundred: { name: '내추럴 100', desc: '평범한 /roll에서 완벽한 100을 굴렸습니다.' },
  hid_yumi_cheer: {
    name: '유미의 열혈 팬',
    desc: '한창 경기 중에, 유미가 들을 수 있는 곳에서 응원을 보냈습니다.',
  },
  hid_bountiful_coffer: {
    name: '보랏빛 궤짝',
    desc: '자물쇠가 엉키기 전에 풍요의 궤짝을 따냈습니다.',
  },
  hid_companion_save: {
    name: '그녀가 지켜보는 한',
    desc: '탐굴 동료가 쓰러진 파티원을 부축해 다시 일으켜 세웠습니다.',
  },
  hid_codfather: { name: '패밀리 입단', desc: '딥펜 얕은 물에서 대구 대부를 끌어냈습니다.' },
  prog_crown_below: {
    name: '지하의 왕관',
    desc: "잠들지 못한 뼈밭에서 나이트락시스 왕의 무덤까지 왕관의 자취를 좇아 '재앙의 종말'을 끝까지 완수하십시오.",
  },
  prog_mere_at_rest: {
    name: '고요를 되찾은 호수',
    desc: '온드렐 베인의 불침번을 끝까지 함께하십시오: 성가대를 침묵시키고, 페일코일을 처치하고, 익사한 달을 잠재우십시오.',
  },
  prog_callused_hands: {
    name: '굳은살 박인 손',
    desc: "'모든 손을 위한 기술'을 완료하고 이스트브룩의 생업에서 첫 굳은살을 얻으십시오.",
  },
  prog_tools_of_the_trade: {
    name: '장인의 연장',
    desc: '하이워치 제작 거점에서 제작대가 필요한 제작을 완료하십시오.',
  },
  dgn_nythraxis_crypt: {
    name: '납골당이 지켜 온 것',
    desc: '버려진 납골당에 뛰어들어 그 수호자들에게서 열쇠돌 두 조각과 오래된 일지를 되찾으십시오.',
  },
  chr_marsh_first_cast: {
    name: '갈대밭의 뱀장어',
    desc: '마이어펜 습지의 물에서 물고기 한 마리를 낚으십시오.',
  },
};
