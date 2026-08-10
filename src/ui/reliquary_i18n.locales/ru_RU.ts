// Reliquary page name locale table for ru_RU (data-as-code, size-exempt).
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
    name: 'Пустая крипта',
    desc: 'Знаковая добыча, отнятая у Мортена Могильного Зова и Полой усыпальницы.',
  },
  conquerors_hollow_crypt_heroic: {
    name: 'Героизм: Пустая крипта',
    desc: 'Эпические предметы, которые падают только в героическом режиме с Мортена Могильного Зова.',
  },
  conquerors_sunken_bastion: {
    name: 'Затонувший бастион',
    desc: 'Редкая и эпическая добыча с Олена и Ваэля Вязателя Тумана.',
  },
  conquerors_sunken_bastion_heroic: {
    name: 'Героизм: Затонувший бастион',
    desc: 'Эпические предметы, которые падают только в героическом режиме с Ваэля Вязателя Тумана.',
  },
  conquerors_drowned_temple: {
    name: 'Утонувший храм',
    desc: 'Редкая добыча с Матери хора Селте и Изолеи, Воплощения Утонувшей луны.',
  },
  conquerors_drowned_temple_heroic: {
    name: 'Героизм: Утонувший храм',
    desc: 'Эпические предметы, которые падают только в героическом режиме с Изолеи.',
  },
  conquerors_gravewyrm_sanctum: {
    name: 'Святилище Могильного Вирма',
    desc: 'Редкая и эпическая добыча с боссов Святилища и Корзула Могильного Вирма.',
  },
  conquerors_gravewyrm_sanctum_heroic: {
    name: 'Героизм: Святилище Могильного Вирма',
    desc: 'Эпические предметы, которые падают только в героическом режиме с Корзула Могильного Вирма.',
  },
  conquerors_wildheart_basin: {
    name: 'Котловина Дикого Сердца',
    desc: 'Знаковое оружие Зулгара и Повелителя клыков.',
  },
  conquerors_wildheart_basin_heroic: {
    name: 'Героизм: Котловина Дикого Сердца',
    desc: 'Эпические предметы, которые падают только в героическом режиме с Зулгара, Голоса Котловины.',
  },
  // The arena entity reads Рейдовая арена Нитраксиса; the page collects the
  // raid's spoils rather than naming the room, so the arena noun is dropped and
  // the boss transliteration kept byte-identical to that entity name.
  conquerors_nythraxis: {
    name: 'Рейд Нитраксиса',
    desc: 'Эпическая и легендарная добыча с Нитраксиса, Бича Торнпика.',
  },
  conquerors_nythraxis_heroic: {
    name: 'Героизм: Рейд Нитраксиса',
    desc: 'Рейдовое оружие, которое падает только в героическом режиме с Нитраксиса.',
  },
  conquerors_thunzharr: {
    name: 'Тунзарр, Пробуждающийся пик',
    desc: 'Личная эпическая добыча с мирового босса Пробуждающегося пика.',
  },
  conquerors_collapsed_reliquary: {
    name: 'Обрушившийся Реликварий',
    desc: 'Знаковые редкости из запертого сундука Обрушенного реликвария.',
  },
  conquerors_drowned_litany: {
    name: 'Утонувшая Литания',
    desc: 'Редкая и эпическая добыча из Утонувшей литании.',
  },
  // Set pages: entities.itemSets.* names verbatim.
  conquerors_set_deathlord: {
    name: 'Боевой доспех Владыки Кургана',
    desc: 'Полное латное семейство Deathlord.',
  },
  conquerors_set_wyrmshadow: {
    name: 'Облачение Ночного Клыка',
    desc: 'Полное кожаное семейство Wyrmshadow.',
  },
  conquerors_set_necromancers: {
    name: 'Одеяние Скорбного плетения',
    desc: 'Полное тканевое семейство Necromancers.',
  },
  conquerors_set_crownforged: {
    name: 'Костокованые регалии',
    desc: 'Полное латное семейство Crownforged.',
  },
  conquerors_set_nighttalon: {
    name: 'Кожаный доспех Лютого Клыка',
    desc: 'Полное кожаное семейство Nighttalon.',
  },
  conquerors_set_soulflame: {
    name: 'Одеяние Призрачного пламени',
    desc: 'Полное тканевое семейство Soulflame.',
  },
  conquerors_set_stormcallers: {
    name: 'Одеяние Зова Бури',
    desc: 'Полное тканевое семейство Stormcallers.',
  },
  // Professions pages: шедевр is the Reliquary's own masterwork noun (the
  // markFind labels these pages hold), редкие находки the guide's rare-finds
  // heading, образец the perfect-specimen mark's noun.
  professions_masterwork: {
    name: 'Галерея шедевров',
    desc: 'Пожизненные трофеи за первые шедевры. Остаётся пустой до следующего срабатывания, если ветеран старше самой галереи (выдуманная история ремесла не создаётся).',
  },
  professions_field_notes: {
    name: 'Записи о редких находках',
    desc: 'Знаковые редкие находки дикой природы: жилы, ядровая древесина, цветы под луной и безупречные образцы.',
  },
  professions_specimens: {
    name: 'Ключевые образцы',
    desc: 'Безупречные образцы с туш, лучшие тонкие полевые материалы и заветный улов рыболова: музей ремесленника в миниатюре.',
  },
  // Horizons pages: the shipped HUD labels for the same three collections.
  horizons_mounts: {
    name: 'Транспорт',
    desc: 'Ездовые животные из конюшни, героические поводья, эпические награды разломов и более редкие сёдла. Владение следует за самими поводьями (сумки и банк).',
  },
  horizons_weapon_skins: {
    name: 'Облики оружия',
    desc: 'Облики оружия из Оружейной, общие для всей учётной записи. Пусто офлайн или без косметики учётной записи; это никогда не добыча персонажа.',
  },
  horizons_titles: {
    name: 'Звания',
    desc: 'Звания, заслуженные по Книге деяний. Только косметика: никакой силы, шанса добычи или компенсации невезения.',
  },
  // The Rift page (Phase 21): the shipped rift noun (deed dgn_rift and the
  // sourceRift line both say Разлом), used bare as the proper name.
  conquerors_the_rift: {
    name: 'Разлом',
    desc: 'Знаковая добыча изменчивого разлома: от бродящих в нём ужасов до двух сокровищ охоты ранга S.',
  },
  // Rares of the Realm pages (Phase 21): composed in the chronicle rare
  // deeds' register (chr_marsh_rares ru reads Имена в тумане); no mob names
  // inside page names.
  conquerors_rares_of_the_realm: {
    name: 'Имена всех земель',
    desc: 'Доказательство победы над каждым именованным редким существом королевства.',
  },
  conquerors_spoils_of_the_realm: {
    name: 'Добыча именных чудовищ',
    desc: 'Знаковые сокровища, которые носят при себе именованные редкие существа королевства.',
  },
  // Warfare pages (Phase 21): the shipped WARFARE brand (statInfo and the
  // itemSets.warfare_* bonus lines both say Боевая мощь, genitive Боевой
  // мощи) plus the gallery noun the masterwork page uses (Галерея) and the
  // shipped armory noun (wocStore.armoryTitle Арсенал).
  conquerors_warfare_gallery: {
    name: 'Галерея Боевой мощи',
    desc: 'Пять боевых комплектов Войны, добываемых предмет за предметом за честь.',
  },
  conquerors_warfare_armory: {
    name: 'Арсенал Боевой мощи',
    desc: 'Украшения и оружие Войны, купленные за тяжело добытую честь.',
  },
  // Vault of Ages (Phase 21): composed from the shipped vault noun (the
  // col_reliquary_complete title reads Хранитель Сокровищницы).
  horizons_vault_of_ages: {
    name: 'Сокровищница минувших эпох',
    desc: 'Выведенные сокровища ушедшей эпохи. Эти реликвии больше нельзя добыть; сокровищница чтит ветеранов, что их сохранили.',
  },
  // Riftbound (Phase 21): Russian has no bare adjective for the family, so the
  // page takes the shipped band noun (entities.items.riftbound_band_of_*.name
  // read Кольцо разлома) in the plural.
  horizons_riftbound: {
    name: 'Кольца разлома',
    desc: 'Личные кольца разлома, отчеканенные для каждого героя отряда, что добывает первое прохождение рейтингового разлома. Персонаж может владеть только своим.',
  },
};
