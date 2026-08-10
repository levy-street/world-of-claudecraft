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
  conquerors_hollow_crypt: { name: 'Пустая крипта' },
  conquerors_hollow_crypt_heroic: { name: 'Героизм: Пустая крипта' },
  conquerors_sunken_bastion: { name: 'Затонувший бастион' },
  conquerors_sunken_bastion_heroic: { name: 'Героизм: Затонувший бастион' },
  conquerors_drowned_temple: { name: 'Утонувший храм' },
  conquerors_drowned_temple_heroic: { name: 'Героизм: Утонувший храм' },
  conquerors_gravewyrm_sanctum: { name: 'Святилище Могильного Вирма' },
  conquerors_gravewyrm_sanctum_heroic: { name: 'Героизм: Святилище Могильного Вирма' },
  conquerors_wildheart_basin: { name: 'Котловина Дикого Сердца' },
  conquerors_wildheart_basin_heroic: { name: 'Героизм: Котловина Дикого Сердца' },
  // The arena entity reads Рейдовая арена Нитраксиса; the page collects the
  // raid's spoils rather than naming the room, so the arena noun is dropped and
  // the boss transliteration kept byte-identical to that entity name.
  conquerors_nythraxis: { name: 'Рейд Нитраксиса' },
  conquerors_nythraxis_heroic: { name: 'Героизм: Рейд Нитраксиса' },
  conquerors_thunzharr: { name: 'Тунзарр, Пробуждающийся пик' },
  conquerors_collapsed_reliquary: { name: 'Обрушившийся Реликварий' },
  conquerors_drowned_litany: { name: 'Утонувшая Литания' },
  // Set pages: entities.itemSets.* names verbatim.
  conquerors_set_deathlord: { name: 'Боевой доспех Владыки Кургана' },
  conquerors_set_wyrmshadow: { name: 'Облачение Ночного Клыка' },
  conquerors_set_necromancers: { name: 'Одеяние Скорбного плетения' },
  conquerors_set_crownforged: { name: 'Костокованые регалии' },
  conquerors_set_nighttalon: { name: 'Кожаный доспех Лютого Клыка' },
  conquerors_set_soulflame: { name: 'Одеяние Призрачного пламени' },
  conquerors_set_stormcallers: { name: 'Одеяние Зова Бури' },
  // Professions pages: шедевр is the Reliquary's own masterwork noun (the
  // markFind labels these pages hold), редкие находки the guide's rare-finds
  // heading, образец the perfect-specimen mark's noun.
  professions_masterwork: { name: 'Галерея шедевров' },
  professions_field_notes: { name: 'Записи о редких находках' },
  professions_specimens: { name: 'Ключевые образцы' },
  // Horizons pages: the shipped HUD labels for the same three collections.
  horizons_mounts: { name: 'Транспорт' },
  horizons_weapon_skins: { name: 'Облики оружия' },
  horizons_titles: { name: 'Звания' },
  // The Rift page (Phase 21): the shipped rift noun (deed dgn_rift and the
  // sourceRift line both say Разлом), used bare as the proper name.
  conquerors_the_rift: { name: 'Разлом' },
  // Rares of the Realm pages (Phase 21): composed in the chronicle rare
  // deeds' register (chr_marsh_rares ru reads Имена в тумане); no mob names
  // inside page names.
  conquerors_rares_of_the_realm: { name: 'Имена всех земель' },
  conquerors_spoils_of_the_realm: { name: 'Добыча именных чудовищ' },
  // Warfare pages (Phase 21): the shipped WARFARE brand (statInfo and the
  // itemSets.warfare_* bonus lines both say Боевая мощь, genitive Боевой
  // мощи) plus the gallery noun the masterwork page uses (Галерея) and the
  // shipped armory noun (wocStore.armoryTitle Арсенал).
  conquerors_warfare_gallery: { name: 'Галерея Боевой мощи' },
  conquerors_warfare_armory: { name: 'Арсенал Боевой мощи' },
  // Vault of Ages (Phase 21): composed from the shipped vault noun (the
  // col_reliquary_complete title reads Хранитель Сокровищницы).
  horizons_vault_of_ages: { name: 'Сокровищница минувших эпох' },
  // Riftbound (Phase 21): Russian has no bare adjective for the family, so the
  // page takes the shipped band noun (entities.items.riftbound_band_of_*.name
  // read Кольцо разлома) in the plural.
  horizons_riftbound: { name: 'Кольца разлома' },
};
