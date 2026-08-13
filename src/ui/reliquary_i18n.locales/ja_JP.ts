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
  conquerors_hollow_crypt: {
    name: '虚ろの墓所',
    desc: '墓呼びのモーセンと虚ろの墓所から勝ち取った象徴的な戦利品。',
  },
  conquerors_hollow_crypt_heroic: {
    name: '英雄: 虚ろの墓所',
    desc: '墓呼びのモーセンからヒロイックでのみ得られるエピック。',
  },
  conquerors_sunken_bastion: {
    name: '沈んだ砦',
    desc: 'オレンとフォグバインダーのヴァエルから得られるレアおよびエピックの戦利品。',
  },
  conquerors_sunken_bastion_heroic: {
    name: '英雄: 沈んだ砦',
    desc: 'フォグバインダーのヴァエルからヒロイックでのみ得られるエピック。',
  },
  conquerors_drowned_temple: {
    name: '溺れし神殿',
    desc: '聖歌母セルセとイソレイ、溺月の化身から得られるレアな戦利品。',
  },
  conquerors_drowned_temple_heroic: {
    name: '英雄: 溺れし神殿',
    desc: 'イソレイからヒロイックでのみ得られるエピック。',
  },
  conquerors_gravewyrm_sanctum: {
    name: '墓ワームの聖所',
    desc: 'サンクタムのボスたちと墓ワームのコルズルから得られるレアおよびエピックの戦利品。',
  },
  conquerors_gravewyrm_sanctum_heroic: {
    name: '英雄: 墓ワームの聖所',
    desc: '墓ワームのコルズルからヒロイックでのみ得られるエピック。',
  },
  conquerors_wildheart_basin: {
    name: 'ワイルドハート盆地',
    desc: 'ズルガーと牙王の獣使いから得られる象徴的な武器。',
  },
  conquerors_wildheart_basin_heroic: {
    name: '英雄: ワイルドハート盆地',
    desc: '盆地の声ズルガーからヒロイックでのみ得られるエピック。',
  },
  // The arena entity reads ナイスラクシスのレイドアリーナ; the page collects the
  // raid's spoils rather than naming the room, so the arena noun is dropped and
  // the boss transliteration kept byte-identical.
  conquerors_nythraxis: {
    name: 'ナイスラクシスのレイド',
    desc: 'ナイスラクシス、ソーンピークの災厄から得られるエピックおよびレジェンダリーの戦利品。',
  },
  conquerors_nythraxis_heroic: {
    name: '英雄: ナイスラクシスのレイド',
    desc: 'ナイスラクシスからヒロイックでのみ得られるレイド武器。',
  },
  conquerors_thunzharr: {
    name: 'サンザール、目覚めし峰',
    desc: '目覚めし峰のワールドボスから得られる個人用エピック戦利品。',
  },
  conquerors_collapsed_reliquary: {
    name: '崩れた聖遺物庫',
    desc: '崩れた聖遺物庫の施錠された宝箱から出る象徴的なレア品。',
  },
  conquerors_drowned_litany: {
    name: '溺れし連祷',
    desc: '溺れた連祷から得られるレアおよびエピックの戦利品。',
  },
  // Set pages: entities.itemSets.* names verbatim.
  conquerors_set_deathlord: {
    name: 'バロウロードの戦装束',
    desc: 'デスロードのプレート一式。',
  },
  conquerors_set_wyrmshadow: {
    name: 'ナイトファングの装束',
    desc: 'ワームシャドウのレザー一式。',
  },
  conquerors_set_necromancers: {
    name: 'モーンウィーヴの法衣',
    desc: 'ネクロマンサーのクロス一式。',
  },
  conquerors_set_crownforged: {
    name: 'ボーンロートの戦装束',
    desc: 'クラウンフォージドのプレート一式。',
  },
  conquerors_set_nighttalon: {
    name: 'ダイアファングの革装束',
    desc: 'ナイトタロンのレザー一式。',
  },
  conquerors_set_soulflame: {
    name: 'レイスファイアの法衣',
    desc: 'ソウルフレイムのクロス一式。',
  },
  conquerors_set_stormcallers: {
    name: 'ゲイルコールの法衣',
    desc: 'ストームコーラーのクロス一式。',
  },
  // Professions pages: 傑作 is the one masterwork noun everywhere (crafting
  // toast/seal, the markFind labels these pages hold, and this title; the
  // 2026-08-07 QA retired the gallery's former 名作 coinage, see the
  // masterwork glossary row), 珍しい発見 the guide's rare-finds heading,
  // 標本 the perfect-specimen mark's noun.
  professions_masterwork: {
    name: '傑作ギャラリー',
    desc: '最初の傑作を記念する生涯のトロフィー。ベテランがこのギャラリーより古い場合、次の発動まで空のままです（制作履歴を捏造することはありません）。',
  },
  professions_field_notes: {
    name: '珍しい発見の記録',
    desc: '荒野で見つかる象徴的なレアの産物：鉱脈、心材、月光に咲く花、そして完璧な標本。',
  },
  professions_specimens: {
    name: '主要な標本',
    desc: '傷ひとつない死骸標本、最上級の上質な野外素材、そして釣り人が追い求める大物：小さな職人の博物館。',
  },
  // Horizons pages: the shipped HUD labels for the same three collections.
  horizons_mounts: {
    name: 'マウント',
    desc: '厩舎の騎乗マウント、ヒロイックの手綱、リフトのエピック、さらに希少な鞍。所有は実際の手綱アイテムに従います（バッグと銀行）。',
  },
  horizons_weapon_skins: {
    name: '武器スキン',
    desc: 'アーマリーのアカウント共通の武器スキン。オフライン時やアカウント装飾がない場合は空で、キャラクターの戦利品になることはありません。',
  },
  horizons_titles: {
    name: '称号',
    desc: '功績の書で獲得した称号。装飾のみで、強さもドロップ率も救済も一切与えません。',
  },
  // The Rift page (Phase 21): the shipped rift noun (deed dgn_rift and the
  // sourceRift line both say リフト), used bare as the proper name.
  conquerors_the_rift: {
    name: 'リフト',
    desc: '移ろうリフトの象徴的な戦利品。徘徊する恐怖から、Sランク追跡の二つの秘宝まで。',
  },
  // Rares of the Realm pages (Phase 21): composed in the chronicle rare
  // deeds' register (chr_marsh_rares ja reads 霧に名だたる者); no mob names
  // inside page names.
  conquerors_rares_of_the_realm: {
    name: '大地に名だたる者',
    desc: 'この世界で討ち取ったすべての名前付きレアの証。',
  },
  conquerors_spoils_of_the_realm: {
    name: '名だたる者の戦利品',
    desc: '世界の名前付きレアたちが携える象徴的な宝。',
  },
  // Warfare pages (Phase 21): the shipped WARFARE brand noun (statInfo and
  // the itemSets.warfare_* bonus lines both say ウォーフェア) plus the gallery
  // noun the masterwork page uses (ギャラリー) and the shipped armory noun
  // (wocStore.armoryTitle 武器庫).
  conquerors_warfare_gallery: {
    name: 'ウォーフェアギャラリー',
    desc: '五つの戦争戦闘装備一式。名誉を積み、一つずつ手に入れます。',
  },
  conquerors_warfare_armory: {
    name: 'ウォーフェア武器庫',
    desc: '苦労して得た名誉で購入する戦争の装飾品と武器。',
  },
  // Vault of Ages (Phase 21): composed from the shipped vault noun (the
  // col_reliquary_complete title reads 宝物庫のキュレーター).
  horizons_vault_of_ages: {
    name: '古き時代の宝物庫',
    desc: '過ぎ去った時代の絶版の宝。これらの聖遺物はもう手に入りません。この宝物庫は、今も持ち続けるベテランを称えます。',
  },
  // Riftbound (Phase 21): the shipped Riftbound adjective from the band item
  // names (entities.items.riftbound_band_of_*.name read リフトバウンドリング),
  // used bare as the family name.
  horizons_riftbound: {
    name: 'リフトバウンド',
    desc: '個人専用のリフトバウンドの指輪。ランク付きリフトの初回クリアを勝ち取ったパーティの勇者一人ひとりのために打たれます。キャラクターは自分の分しか持てません。',
  },
};
