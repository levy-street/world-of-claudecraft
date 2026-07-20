// Deed name / desc / title locale table for ja_JP (data-as-code, size-exempt).
// One per-base-locale chunk behind DEED_LOCALE_LOADERS in deed_i18n.ts, so a
// visitor downloads only their own locale's deed strings. Split verbatim from
// the former deed_i18n.newlocales.ts single chunk; values carry no em or en
// dashes (repo copy rule). English (en / en_CA) resolves to the authored
// source before this table is consulted.
import type { DeedLocaleTable } from '../deed_i18n';

export const table: DeedLocaleTable = {
  pvp_card_duel_first_win: {
    name: '我が流儀',
    desc: 'カードマスターのもとでカードデュエルに勝利する。',
  },
  prog_first_steps: {
    name: 'はじめの一歩',
    desc: 'レベル2に到達し、長い旅路の最初の一歩を踏み出す。',
  },
  prog_finding_your_feet: {
    name: '足慣らし',
    desc: 'レベル5に到達する。荒野は早くも、少しだけ小さく見える。',
  },
  prog_double_digits: { name: '二桁の大台', desc: 'レベル10に到達し、タレントを解放する。' },
  prog_the_long_middle: { name: '長い道の半ば', desc: 'レベル15に到達する。' },
  prog_level_cap: { name: '頂の眺め', desc: 'レベル上限であるレベル20に到達する。' },
  prog_well_rested: {
    name: '英気を養う',
    desc: '休息経験値を得るまで、宿屋に腰を落ち着けてくつろぐ。',
  },
  prog_talented: { name: '価値ある1ポイント', desc: '最初のタレントポイントを振る。' },
  prog_specialized: { name: '所信表明', desc: '特化を選び、その象徴となるアビリティを習得する。' },
  prog_deep_roots: { name: '深き根', desc: '最終段のタレントにポイントを振る。' },
  prog_full_build: {
    name: '六段の極み',
    desc: '1つのビルドで全6段のタレントから1つずつ選択する。',
  },
  prog_veteran: { name: '古参', desc: '生涯経験値250,000を獲得する。', title: '古参' },
  prog_champion: { name: '勇者', desc: '生涯経験値500,000を獲得する。', title: '勇者' },
  prog_paragon: { name: '範士', desc: '生涯経験値1,000,000を獲得する。', title: '範士' },
  prog_mythic: { name: '神話', desc: '生涯経験値2,500,000を獲得する。', title: '神話' },
  prog_eternal: { name: '永遠', desc: '生涯経験値5,000,000を獲得する。', title: '永遠' },
  prog_prestige: {
    name: 'もう一度はじめから',
    desc: 'レベル上限に達したのち、もう一度バーを満たしてプレステージランク1を手にする。',
  },
  prog_prestige_5: { name: '三つ子の魂', desc: 'プレステージランク5に到達する。' },
  prog_prestige_10: { name: '永久機関', desc: 'プレステージランク10に到達する。' },
  prog_first_harvest: { name: '野の実り', desc: '初めて採集ポイントを収穫する。' },
  prog_mining_100: { name: '血は鉱脈より濃し', desc: '採掘の熟練度100に到達する。' },
  prog_logging_100: { name: '心材断ち', desc: '伐採の熟練度100に到達する。' },
  prog_herbalism_100: { name: '野辺の名人', desc: '薬草学の熟練度100に到達する。' },
  prog_master_gatherer: {
    name: '採集の達人',
    desc: '採掘、伐採、薬草学のすべてで熟練度100に到達する。',
  },
  prog_first_craft: { name: '手仕事の味', desc: '初めての製作を成功させる。' },
  prog_craft_specialist: {
    name: '秘伝の技',
    desc: 'いずれかひとつの製作スキルで75に到達し、その特化の恩恵を解放する。',
  },
  prog_around_the_ring: { name: '環をひと巡り', desc: '5種類の異なる製作スキルで25に到達する。' },
  cmb_first_blood: { name: '初陣の血', desc: '初めての敵を打ち倒す。' },
  cmb_slayer: { name: '討伐者', desc: '敵を1,000体倒す。' },
  cmb_legion_of_one: { name: '一騎当千', desc: '敵を10,000体倒す。' },
  cmb_heavy_hitter: { name: '剛打の使い手', desc: '合計500,000のダメージを与える。' },
  cmb_critical_eye: { name: '会心の眼', desc: 'クリティカルヒットを500回命中させる。' },
  cmb_giantslayer: { name: '巨人殺し', desc: '自分より5レベル以上高い敵にとどめの一撃を放つ。' },
  cmb_first_fall: { name: '埃を払って立て', desc: '初めて死ぬ。誰にでもあることだ。' },
  dgn_hollow_crypt: { name: '墓所破り', desc: '虚ろの墓所で墓呼びのモーセンを倒す。' },
  dgn_sunken_bastion: {
    name: '解けた霧の縛め',
    desc: '沈んだ砦でフォグバインダーのヴァエルを倒す。',
  },
  dgn_drowned_temple: { name: '月を沈める', desc: '溺れし神殿で「イソレイ、溺月の化身」を倒す。' },
  dgn_gravewyrm_sanctum: {
    name: '地の底のワーム',
    desc: '墓ワームの聖所で墓ワームのコルズルを倒す。',
  },
  dgn_hollow_crypt_heroic: {
    name: '英雄: 虚ろの墓所',
    desc: '英雄難易度の虚ろの墓所で墓呼びのモーセンを倒す。',
  },
  dgn_sunken_bastion_heroic: {
    name: '英雄: 沈んだ砦',
    desc: '英雄難易度の沈んだ砦でフォグバインダーのヴァエルを倒す。',
  },
  dgn_drowned_temple_heroic: {
    name: '英雄: 溺れし神殿',
    desc: '英雄難易度の溺れし神殿で「イソレイ、溺月の化身」を倒す。',
  },
  dgn_gravewyrm_sanctum_heroic: {
    name: '英雄: 墓ワームの聖所',
    desc: '英雄難易度の墓ワームの聖所で墓ワームのコルズルを倒す。',
  },
  dgn_nythraxis: {
    name: '災厄、ここに果てる',
    desc: '封印された王家の扉の先で「ナイスラクシス、ソーンピークの災厄」を倒す。',
  },
  dgn_nythraxis_heroic: {
    name: '英雄: 災厄、ここに果てる',
    desc: '英雄難易度で「ナイスラクシス、ソーンピークの災厄」を倒す。',
  },
  dgn_thornpeak_rounds: {
    name: '巡り巡って',
    desc: '虚ろの墓所、沈んだ砦、溺れし神殿、墓ワームの聖所を攻略する。',
  },
  dgn_deepward: {
    name: '深淵の護り手',
    desc: 'すべてのダンジョンとレイド、そして両方のデルヴを英雄難易度で制覇する。',
  },
  dgn_mark_circuit: {
    name: '完全周回',
    desc: '1日のうちに、4つの英雄ダンジョンすべてで英雄の証を手に入れる。',
  },
  dgn_boss_clears_50: { name: '五十の扉の先', desc: 'ダンジョン最奥のボスを50体倒す。' },
  dgn_morthen_flawless: {
    name: '骨折り知らず',
    desc: 'パーティメンバーを1人も死なせずに、英雄難易度で墓呼びのモーセンを倒す。',
  },
  dgn_morthen_trio: { name: '墓に挑む三人', desc: '3人以下のプレイヤーで墓呼びのモーセンを倒す。' },
  dgn_olen_arc: {
    name: '死神かわし',
    desc: '刈り取りの弧を現在の標的以外の誰にも当てさせずに、騎士司令官オレンを倒す。',
  },
  dgn_vael_thralls: {
    name: '下僕はお断り',
    desc: '呼び出される溺れた下僕をすべて倒しきった上で、フォグバインダーのヴァエルを倒す。',
  },
  dgn_ysolei_moonspawn: {
    name: '月の落とし子、残らず',
    desc: '呼び出される月の落とし子をすべて倒しきった上で、イソレイを倒す。',
  },
  dgn_ysolei_flawless: {
    name: '乾いた瞳',
    desc: 'パーティメンバーを1人も死なせずに、英雄難易度で「イソレイ、溺月の化身」を倒す。',
  },
  dgn_velkhar_bonewalkers: {
    name: '墓に還れ',
    desc: '甦った骨歩きをすべて破壊してから、大死霊術師ヴェルカーを倒す。',
  },
  dgn_korzul_flawless: {
    name: 'ワーム討ち',
    desc: 'パーティメンバーを1人も死なせずに、英雄難易度で墓ワームのコルズルを倒す。',
    title: 'ワーム討ち',
  },
  dgn_sanctum_speed: {
    name: '聖所駆け',
    desc: 'パーティが墓ワームの聖所を確保してから15分以内に、墓ワームのコルズルを倒す。',
  },
  dgn_nythraxis_gravebreaker: {
    name: '王に跪かず',
    desc: '墓砕きを現在の標的以外の誰にも当てさせずに、ナイスラクシスを倒す。',
  },
  dgn_nythraxis_wardens: {
    name: '護り石の番人',
    desc: 'すべての不死の憤怒を着弾前に打ち破った上で、ナイスラクシスを倒す。',
  },
  dgn_nythraxis_deathless: {
    name: '不死身の中の不死身',
    desc: 'レイドの誰ひとり死なせずに、英雄難易度で「ナイスラクシス、ソーンピークの災厄」を倒す。',
    title: '不死身',
  },
  cmb_thunzharr: {
    name: 'かくして山は倒れた',
    desc: 'ストームクラッグで「サンザール、目覚めし峰」を打ち倒す。',
  },
  cmb_thunzharr_unbroken: {
    name: '峰砕き',
    desc: '最初の一撃から最後の吐息まで一度も死なずに、「サンザール、目覚めし峰」を打ち倒す。',
    title: '峰砕き',
  },
  cmb_thunzharr_ten: { name: '山崩しの常連', desc: '「サンザール、目覚めし峰」を10回打ち倒す。' },
  dlv_reliquary: { name: '聖遺物庫の走り手', desc: '崩れた聖遺物庫を攻略する。' },
  dlv_reliquary_heroic: {
    name: '英雄：崩れた聖遺物庫',
    desc: '崩れた聖遺物庫を英雄ティアで攻略する。',
  },
  dlv_litany: { name: '連祷を鎮めよ', desc: '溺れし連祷を攻略する。' },
  dlv_litany_heroic: { name: '英雄：溺れし連祷', desc: '溺れし連祷を英雄ティアで攻略する。' },
  dlv_lore_journal: { name: '欄外の書き込み', desc: 'デルヴ日誌の項目5つをすべて解放する。' },
  dlv_companion_max: { name: '深みの友', desc: 'デルヴの相棒を最高位まで育て上げる。' },
  dlv_companions_both: {
    name: '灯る二つのランタン',
    desc: '侍祭テッサとエッダ・リードハンド、二人のデルヴの相棒をどちらも最高位まで育て上げる。',
  },
  dlv_clears_50: { name: '五十尋の深み', desc: 'デルヴの探索を50回完遂する。' },
  dlv_solo_heroic: {
    name: 'ふたりで満員',
    desc: '他のプレイヤーを連れず、自分と相棒だけで英雄ティアのデルヴを攻略する。',
  },
  dlv_tumbler_premium: {
    name: '錠前師の道、その極み',
    desc: '護りの掛かった聖遺物庫の宝箱に最高の賭け金で挑み、ただ一度きりの機会で、しくじりなく開け切る。',
  },
  dlv_rite_flawless: {
    name: '一言一句、違わず',
    desc: '溺れし聖遺物庫の儀式を一度も間違えずに完遂する。',
  },
  dlv_varric_ringers: {
    name: '鳴りやむ鐘',
    desc: '彼が甦らせる葬儀の鐘鳴らしをすべて先に仕留めてから、助祭ヴァリックを倒す。',
  },
  dlv_nhalia_bells: {
    name: '鐘鎮め',
    desc: 'パーティの誰ひとり鳴り響く鐘に打たれることなく、修道女ナリア、溺れし聖歌を打ち倒す。',
    title: '鐘鎮め',
  },
  chr_vale_chapter_i: {
    name: '渓谷年代記 第一章',
    desc: 'ソールの年代記の第一章を仕上げる：イーストブルックでの手始めの使い走り、渓谷の地勢、そして生業の最初の味見。',
  },
  chr_vale_chapter_ii: {
    name: '渓谷年代記 第二章',
    desc: 'ソールの年代記の第二章を仕上げる：盗賊、泥ひれの潜伏者、鉱山の害獣どもを退治し、ソウフィールドで試合をこなし、聖遺物庫へ挑む。',
  },
  chr_vale_chapter_iii: {
    name: '渓谷の年代記',
    desc: '渓谷の物語を最後まで見届ける：グレイブコーラーの正体を暴き、虚ろの墓所を浄め、渓谷に名だたる恐怖をことごとく討ち倒す。',
    title: '渓谷の語り部',
  },
  chr_vale_gatherer: {
    name: '地の恵みに生きる',
    desc: 'イーストブルック渓谷で鉱脈、木立、薬草の茂みをそれぞれ採取する。',
  },
  chr_vale_first_cast: {
    name: '鏡の湖に潜むもの',
    desc: 'イーストブルック渓谷の水辺で魚を釣り上げる。',
  },
  chr_vale_packbreaker: { name: '群れ崩し', desc: '10秒以内に森の狼を3体倒す。' },
  chr_vale_cup_debut: {
    name: '銅の手桶の挑戦者',
    desc: 'ソウフィールドでのヴェイルカップの試合に出場し、ボールに触れる。',
  },
  chr_vale_rares: {
    name: '渓谷の恐怖',
    desc: 'イーストブルック渓谷に名だたる5体の恐怖、老グレイジョー、モガー、トンネルキングのグリックス、ヴァーラン隊長、魂縛りマルドレクを討ち倒す。',
  },
  chr_marsh_chapter_i: {
    name: '湿地年代記 第一章',
    desc: 'オズリック・フェンの年代記の第一章を仕上げる：フェンブリッジの召集に応じ、土手道を確保し、沼沢の姿かたちを知る。',
  },
  chr_marsh_chapter_ii: {
    name: '湿地年代記 第二章',
    desc: 'オズリック・フェンの年代記の第二章を仕上げる：ウィドウどもを焼き払い、溺れ死者を眠りにつかせ、タラのゴッドファーザーを釣り上げ、連祷へ挑む。',
  },
  chr_marsh_chapter_iii: {
    name: 'マイアフェンの年代記',
    desc: '沼沢の物語を最後まで見届ける：教団の野営地を打ち砕き、沈んだ砦でフォグバインダーを黙らせ、霧に名だたる恐怖をことごとく討ち倒す。',
    title: 'マイアフェンの語り部',
  },
  chr_marsh_gatherer: {
    name: 'フェンブリッジの採集行',
    desc: 'マイアフェン湿地で鉱脈、木立、薬草の茂みをそれぞれ採取する。',
  },
  chr_marsh_unburst: {
    name: '胞子の上に立つな',
    desc: '腐食胞子の破裂に巻き込まれることなく、沼の膨れ者を8体倒す。',
  },
  chr_marsh_hush_the_mending: {
    name: '手当てを封じよ',
    desc: 'グレイブコーラーの野営地で、グレイブコーラーの癒し手を、その世話を受ける信徒の誰よりも先に仕留める。',
  },
  chr_marsh_rares: {
    name: '霧に名だたる者',
    desc: 'マイアフェン湿地に名だたる3体の恐怖、貪るマイアジョー、溺れし者スルームトゥース、シスター・ナリアを討ち倒す。',
  },
  chr_peaks_chapter_i: {
    name: '高地年代記 第一章',
    desc: 'ゼンジーの年代記の第一章を仕上げる：尾根の道を掃討し、巣穴を空にし、ハイウォッチが守るすべての道を知る。',
  },
  chr_peaks_chapter_ii: {
    name: '高地年代記 第二章',
    desc: 'ゼンジーの年代記の第二章を仕上げる：ドログマーの戦営を打ち破り、目覚めゆく嵐を読み解き、グリマーミアが輝くその畔に立つ。',
  },
  chr_peaks_chapter_iii: {
    name: 'ソーンピークの年代記',
    desc: '山の物語を最後まで見届ける：ワーム教団を壊滅させ、聖所を鎮め、目覚めし峰を打ち倒し、岩山に名だたる恐怖をことごとく討ち倒す。',
    title: 'ソーンピークの語り部',
  },
  chr_peaks_sparring: {
    name: '城壁の型稽古',
    desc: 'ハイウォッチの高台にある訓練用ダミーに合計1,000のダメージを与える。',
  },
  chr_peaks_glimmer_cast: {
    name: '冷たい水、さらに冷たい光',
    desc: 'グリマーミアで魚を釣り上げる。',
  },
  chr_peaks_moongate: {
    name: '冷たき門をくぐって',
    desc: 'グリマーミアの岸辺にある月の門をくぐり抜ける。',
  },
  chr_peaks_waking_witness: {
    name: '歩く山',
    desc: 'サンザール、目覚めし峰が山を練り歩くその姿をこの目で見る。',
  },
  chr_peaks_rares: {
    name: '岩山に刻まれし名',
    desc: 'ソーンピーク高地に名だたる4体の恐怖、鉄脈の現場監督、頭蓋砕きブルトーク、燃え翼のヴォスカル、髄王ヴァーカスを討ち倒す。',
  },
  col_discovery_25: {
    name: 'ためこみ屋',
    desc: '25種類のアイテムを発見する（アイテムは初めて所持品に入った時点で数えられる）。',
  },
  col_discovery_75: { name: '光り物好きのカササギ', desc: '75種類のアイテムを発見する。' },
  col_discovery_150: {
    name: '驚異の陳列棚',
    desc: '150種類のアイテムを発見する。',
    title: '蒐集家',
  },
  col_discovery_250: { name: '大いなる目録', desc: '250種類のアイテムを発見する。' },
  col_first_rare: { name: 'サムシング・ブルー', desc: '初めてレア品質のアイテムを手に入れる。' },
  col_first_epic: { name: '高貴なる紫', desc: '初めてエピック品質のアイテムを手に入れる。' },
  col_first_legendary: {
    name: '果報は橙色',
    desc: '初めてレジェンダリー品質のアイテムを手に入れる。',
  },
  col_set_vale_arcanist: {
    name: '渓谷の秘術師の礼装',
    desc: '渓谷の秘術師の礼装の全部位を発見する。',
  },
  col_set_boundstone_vanguard: { name: '束縛石の先鋒', desc: '束縛石の先鋒の全部位を発見する。' },
  col_set_greyjaw_stalker: {
    name: 'グレイジョー追跡者の装具',
    desc: 'グレイジョー追跡者の装具の全部位を発見する。',
  },
  col_set_deathlord: {
    name: 'バロウロードの戦装備',
    desc: 'バロウロードの戦装備の全部位を発見する。',
  },
  col_set_wyrmshadow: {
    name: 'ナイトファングの装束',
    desc: 'ナイトファングの装束の全部位を発見する。',
  },
  col_set_necromancers: {
    name: 'モーンウィーヴの衣',
    desc: 'モーンウィーヴの衣の全部位を発見する。',
  },
  col_set_crownforged: {
    name: 'ボーンロートの礼装',
    desc: 'ボーンロートの礼装の全部位を発見する。',
  },
  col_set_nighttalon: {
    name: 'ダイアファングの毛皮',
    desc: 'ダイアファングの毛皮の全部位を発見する。',
  },
  col_set_soulflame: {
    name: 'レイスファイアの礼装',
    desc: 'レイスファイアの礼装の全部位を発見する。',
  },
  col_set_stormcallers: {
    name: 'ゲイルコールの装束',
    desc: 'ゲイルコールの装束の全部位を発見する。',
  },
  col_seven_regalia: {
    name: '七揃いの衣装箪笥',
    desc: 'エピック防具全7系統、その全部位を発見する。',
    title: '絢爛',
  },
  col_true_colors: { name: '本当の色', desc: 'クラス既定以外の見た目を身にまとって戦場に出る。' },
  col_all_slots: {
    name: '十一分の隙もなし',
    desc: '11か所の装備枠すべてに同時にアイテムを装備する。',
  },
  col_quartermaster_buyout: {
    name: 'お得意様',
    desc: '補給係ヴェックスの品揃え全10点を発見する。',
  },
  col_glimmerfin: { name: '希望のきらめき', desc: 'きらめきヒレの錦鯉を釣り上げる。' },
  col_full_creel: {
    name: '満杯の魚籠',
    desc: '渓谷、湿地、高地の水辺で釣れるコモンの獲物6種をすべて発見する。',
  },
  col_junk_drawer: { name: 'がらくたの引き出し', desc: 'プア品質のアイテムを10種類発見する。' },
  pvp_arena_first_match: {
    name: '砂の洗礼',
    desc: '灰燼のコロシアムで、どちらかの部門のランク戦を戦う。',
  },
  pvp_arena_first_win: {
    name: '沸き立つ観衆',
    desc: 'どちらかの部門でアリーナのランク戦に勝利する。',
  },
  pvp_arena_1v1_1600: {
    name: 'コロシアムの挑戦者',
    desc: 'アリーナの1v1部門でレート1600に到達する。',
  },
  pvp_arena_1v1_1750: {
    name: 'コロシアムの好敵手',
    desc: 'アリーナの1v1部門でレート1750に到達する。',
  },
  pvp_arena_1v1_1900: {
    name: 'グラディエーター',
    desc: 'アリーナの1v1部門でレート1900に到達する。',
    title: 'グラディエーター',
  },
  pvp_arena_2v2_1600: { name: '二人三脚', desc: 'アリーナの2v2部門でレート1600に到達する。' },
  pvp_arena_2v2_1750: { name: '戦慄の二人組', desc: 'アリーナの2v2部門でレート1750に到達する。' },
  pvp_arena_2v2_1900: { name: '完璧なる連携', desc: 'アリーナの2v2部門でレート1900に到達する。' },
  pvp_duel_first_win: { name: '表へ出ろ', desc: '決闘に勝利する。' },
  pvp_duel_grace: { name: '謙虚さの心得', desc: '威厳をおおむね保ったまま、決闘に敗れる。' },
  pvp_vcup_first_match: {
    name: 'ピッチに立つ',
    desc: '勝ち負けを問わず、ソウフィールドでのヴェイルカップの試合を最後まで戦い抜く。',
  },
  pvp_vcup_first_win: { name: '初めての銀杯', desc: 'ヴェイルカップのレート戦に勝利する。' },
  pvp_vcup_wins_10: { name: '熟練ボアボーラー', desc: 'ヴェイルカップのレート戦で10勝する。' },
  pvp_vcup_wins_25: {
    name: 'ボアボールの伝説',
    desc: 'ヴェイルカップのレート戦で25勝する。',
    title: 'ボアボールの伝説',
  },
  pvp_vcup_first_goal: { name: 'まずは一点', desc: 'ヴェイルカップのレート戦でゴールを決める。' },
  pvp_vcup_hat_trick: {
    name: 'ハットトリックの英雄',
    desc: '3v3以上の部門で、ヴェイルカップのレート戦1試合中に3ゴールを決める。',
  },
  pvp_vcup_golden_goal: {
    name: '黄金の瞬間',
    desc: 'ヴェイルカップのレート戦に決着をつけるゴールデンゴールを叩き込む。',
  },
  pvp_vcup_first_save: {
    name: '鉄壁の両手',
    desc: 'ヴェイルカップのレート戦でキーパーとしてセーブを決める。',
  },
  pvp_vcup_clean_sheet: {
    name: '何ひとつ通さない',
    desc: 'キーパーとして無失点のまま、ヴェイルカップのレート戦に勝利する。',
  },
  pvp_vcup_guild_win: {
    name: '旗の名にかけて',
    desc: 'ギルドの旗を掲げて出場したヴェイルカップのレート戦に勝利する。',
  },
  pvp_fiesta_first_bout: {
    name: '宴への乱入者',
    desc: '勝ち負けを問わず、2v2フィエスタの一戦を最後まで戦い抜く。',
  },
  pvp_fiesta_first_win: { name: '宴の主役', desc: '2v2フィエスタの一戦に勝利する。' },
  pvp_fiesta_double: { name: '二丁上がり', desc: 'フィエスタで4秒以内に2回の撃破を決める。' },
  pvp_fiesta_shutdown: {
    name: '祭りに水を差す者',
    desc: 'フィエスタで、3連続撃破以上の勢いに乗った敵を仕留める。',
  },
  pvp_fiesta_full_build: {
    name: '宴の正装',
    desc: '3回のウェーブすべてで強化を確定させた状態で、フィエスタの一戦に勝利する。',
  },
  pvp_fiesta_powerups: {
    name: '全部ひとつずつ',
    desc: 'リングの4種のパワーアップ、スピードデーモン、コロッサス、ムーンブーツ、バーサーカーをそれぞれ1回以上手に入れる。',
  },
  pvp_fiesta_five_kills: { name: '宴を背負う者', desc: 'フィエスタの一戦で5回の撃破を決める。' },
  soc_first_party: { name: '持つべきものは仲間', desc: '他のプレイヤーとパーティを組む。' },
  soc_full_house: { name: 'フルハウス', desc: '5人満員のパーティでダンジョンを攻略する。' },
  soc_guild_joined: { name: '同じ旗の下に', desc: 'ギルドの一員になる。' },
  soc_guild_founded: { name: '創設者の羽ペン', desc: '自分のギルドを設立する。' },
  soc_first_trade: { name: '公正な取引', desc: '他のプレイヤーとの取引を成立させる。' },
  soc_first_sale: { name: '本日開店', desc: '世界市場での初めての売上金を受け取る。' },
  soc_steady_custom: {
    name: '堅実な商い',
    desc: '世界市場の売上から生涯累計10ゴールドを受け取る。',
  },
  soc_market_magnate: {
    name: '市場の豪商',
    desc: '世界市場の売上から生涯累計100ゴールドを受け取る。',
    title: '豪商',
  },
  soc_by_ravens_wing: {
    name: '鴉の翼に乗せて',
    desc: '硬貨か小包を託したレイヴンポストの手紙を送る。',
  },
  soc_room_for_more: { name: 'まだまだ入る', desc: '銀行の拡張を初めて購入する。' },
  soc_gilded_strongbox: {
    name: '金張りの金庫',
    desc: '出納官が売ってくれる銀行の拡張をすべて購入する。',
  },
  soc_meet_bursar: {
    name: '我らフェルナンドを信ず',
    desc: 'イーストブルックで金張りの金庫を預かる出納官フェルナンドのもとを訪れ、敬意を表する。',
  },
  soc_pocket_money: { name: '小遣い銭', desc: '硬貨を生涯累計で1ゴールド拾い集める。' },
  soc_heavy_purse: { name: 'ずっしり重い財布', desc: '硬貨を生涯累計で10ゴールド拾い集める。' },
  soc_wyrms_hoard: { name: 'ワームの財宝', desc: '硬貨を生涯累計で100ゴールド拾い集める。' },
  soc_civic_duty: { name: '市民の務め', desc: '町の重点ポイントを初めて割り振る。' },
  exp_long_road_north: {
    name: '北への長い道',
    desc: '3つの拠点集落、イーストブルック、フェンブリッジ、ハイウォッチをすべて訪れる。',
  },
  exp_vale_wayfarer: {
    name: '渓谷の旅人',
    desc: 'イーストブルック渓谷の名のある場所11か所をすべて訪れる。',
  },
  exp_marsh_wayfarer: {
    name: '湿地の旅人',
    desc: 'マイアフェン湿地の名のある場所8か所をすべて訪れる。',
  },
  exp_peaks_wayfarer: {
    name: '高地の旅人',
    desc: 'ソーンピーク高地の名のある場所10か所をすべて訪れる。',
  },
  exp_world_traveler: {
    name: '世界を巡る者',
    desc: '3つの地方すべてで「旅人」の功績を獲得する。',
    title: '旅人',
  },
  exp_something_shiny: { name: 'きらりと光るもの', desc: '地面できらめく物を拾い上げる。' },
  exp_first_ore: { name: '大地を穿て', desc: '初めての鉱脈から鉱石を採掘する。' },
  exp_first_timber: { name: '倒れるぞーっ！', desc: '初めての立ち木を伐採する。' },
  exp_first_herb: { name: '緑の指', desc: '初めての薬草を摘み取る。' },
  feat_era_cap: { name: '第一の時代の申し子', desc: '第一の時代のさなかにレベル20へ到達した。' },
  feat_book_complete: { name: '書のすべて', desc: '功績の書に載るすべての功績を獲得する。' },
  feat_brightwood_relic: {
    name: 'ブライトウッドの追憶',
    desc: '旧きブライトウッドの遺品、茨革のジャーキンまたは君主の王冠を持ち続ける。',
  },
  hid_saul_footnote: {
    name: '歴史の脚注',
    desc: '年代記官ソールに休む間もなく9回つきまとった。',
    title: '脚注',
  },
  hid_gilded_tour: { name: '金張り巡りの旅', desc: '金張りの金庫の3つの支店すべてで取引をした。' },
  hid_fall_death: { name: '重力は常に勝つ', desc: '地面との長い対話の末に死んだ。' },
  hid_keepers_toll_twice: {
    name: '番人は二度取り立てる',
    desc: '「番人の通行料」がまだ重くのしかかっているうちに死んだ。',
  },
  hid_roll_hundred: { name: 'ナチュラル100', desc: '素の/rollで100ぴったりを出した。' },
  hid_yumi_cheer: {
    name: 'ユミの一番のファン',
    desc: '試合の最中、ユミの耳に届くところで声援を送った。',
  },
  hid_bountiful_coffer: { name: '紫の宝匣', desc: '錠が噛んでしまう前に豊穣の宝匣をこじ開けた。' },
  hid_companion_save: {
    name: '彼女の目の黒いうちは',
    desc: 'デルヴの相棒が、倒れた仲間を引きずり起こして立たせた。',
  },
  hid_codfather: {
    name: 'ファミリーの一員に',
    desc: 'ディープフェンの浅瀬からタラのゴッドファーザーを引きずり上げた。',
  },
  prog_crown_below: {
    name: '地の底の王冠',
    desc: '安らがぬ骨の野から王ナイスラクシスの墓所まで王冠の行方を辿り、「災厄の終わり」を成し遂げる。',
  },
  prog_mere_at_rest: {
    name: '湖水は眠りにつく',
    desc: '聖歌隊を沈黙させ、蒼渦を討ち、溺月を安らかな眠りにつかせて、オンドレル・ヴェインの見張りを最後まで見届ける。',
  },
  prog_callused_hands: {
    name: '手のマメも勲章',
    desc: '「どの手にも生業を」を完了し、イーストブルックの生業で最初のマメをこしらえる。',
  },
  prog_tools_of_the_trade: {
    name: '商売道具',
    desc: '製作拠点で製作を1回完了する。',
  },
  dgn_nythraxis_crypt: {
    name: '墓所が守りしもの',
    desc: '放棄された地下墓所へ足を踏み入れ、その守護者たちから要石の両片と古い日誌を回収する。',
  },
  chr_marsh_first_cast: { name: '葦間のウナギ', desc: 'マイアフェン湿地の水辺で魚を釣り上げる。' },
};
