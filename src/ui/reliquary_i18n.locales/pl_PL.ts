// Reliquary page name and description locale table for pl_PL
// (data-as-code, size-exempt). One per-base-locale chunk behind
// RELIQUARY_LOCALE_LOADERS in reliquary_i18n.ts, so a visitor downloads only
// their own locale's page strings. Every page name reuses an already-shipped
// string wherever one exists (dungeon, delve, world-boss and item-set entity
// names verbatim; the deed table's heroic-prefix form for the heroic pages), so
// a page never disagrees with the content it collects. Values carry no em or en
// dashes (repo copy rule). English (en / en_CA) resolves to the authored source
// before this table is consulted.
import type { ReliquaryLocaleTable } from '../reliquary_i18n';

export const table: ReliquaryLocaleTable = {
  conquerors_hollow_crypt: {
    name: 'Wydrążona Krypta',
    desc: 'Charakterystyczne łupy wyrwane Morthenowi i Wydrążonej Krypcie.',
  },
  conquerors_hollow_crypt_heroic: {
    name: 'Heroiczna: Wydrążona Krypta',
    desc: 'Epiki dostępne wyłącznie heroicznie od Morthena Grobowego Wołacza.',
  },
  conquerors_sunken_bastion: {
    name: 'Zatopiony Bastion',
    desc: 'Rzadkie i epickie łupy od Olena oraz Vaela Fogbindera.',
  },
  conquerors_sunken_bastion_heroic: {
    name: 'Heroiczny: Zatopiony Bastion',
    desc: 'Epiki dostępne wyłącznie heroicznie od Vaela Fogbindera.',
  },
  conquerors_drowned_temple: {
    name: 'Zatopiona Świątynia',
    desc: 'Rzadkie łupy od Chórmatki Selthe oraz Ysolei, Awatara Utopionego Księżyca.',
  },
  conquerors_drowned_temple_heroic: {
    name: 'Heroiczna: Zatopiona Świątynia',
    desc: 'Epiki dostępne wyłącznie heroicznie od Ysolei.',
  },
  conquerors_gravewyrm_sanctum: {
    name: 'Sanktuarium Grobowego Żmija',
    desc: 'Rzadkie i epickie łupy od bossów Sanktuarium oraz Korzula Grobowego Żmija.',
  },
  conquerors_gravewyrm_sanctum_heroic: {
    name: 'Heroiczne: Sanktuarium Grobowego Żmija',
    desc: 'Epiki dostępne wyłącznie heroicznie od Korzula Grobowego Żmija.',
  },
  conquerors_wildheart_basin: {
    name: 'Kotlina Dzikiego Serca',
    desc: 'Charakterystyczne bronie od Zulgara oraz Kłolorda, Pogromcy Bestii.',
  },
  conquerors_wildheart_basin_heroic: {
    name: 'Heroiczna: Kotlina Dzikiego Serca',
    desc: 'Epiki dostępne wyłącznie heroicznie od Zulgara, Głosu Kotliny.',
  },
  conquerors_nythraxis: {
    name: 'Rajd Nythraxis',
    desc: 'Epickie i legendarne łupy od Nythraxis, Plagi Ciernistego Szczytu.',
  },
  conquerors_nythraxis_heroic: {
    name: 'Heroiczny: Rajd Nythraxis',
    desc: 'Bronie rajdowe dostępne wyłącznie heroicznie od Nythraxis.',
  },
  conquerors_thunzharr: {
    name: 'Thunzharr, Budzący się Szczyt',
    desc: 'Osobiste epickie łupy od światowego bossa Budzącego się Szczytu.',
  },
  conquerors_collapsed_reliquary: {
    name: 'Zawalony Relikwiarz',
    desc: 'Charakterystyczne rzadkości ze skrzyni na zamek w Zawalonym Relikwiarzu.',
  },
  conquerors_drowned_litany: {
    name: 'Utopiona Litania',
    desc: 'Rzadkie i epickie łupy z Utopionej Litanii.',
  },
  conquerors_set_deathlord: {
    name: 'Rynsztunek bojowy Barrowlorda',
    desc: 'Pełna rodzina płytowa Deathlord.',
  },
  conquerors_set_wyrmshadow: {
    name: 'Szaty Nightfang',
    desc: 'Pełna rodzina skórzana Wyrmshadow.',
  },
  conquerors_set_necromancers: {
    name: 'Szaty Mournweave',
    desc: 'Pełna rodzina tkaninowa Necromancers.',
  },
  conquerors_set_crownforged: {
    name: 'Regalia Bonewrought',
    desc: 'Pełna rodzina płytowa Crownforged.',
  },
  conquerors_set_nighttalon: {
    name: 'Skóra Direfang',
    desc: 'Pełna rodzina skórzana Nighttalon.',
  },
  conquerors_set_soulflame: {
    name: 'Regalia Wraithfire',
    desc: 'Pełna rodzina tkaninowa Soulflame.',
  },
  conquerors_set_stormcallers: {
    name: 'Szaty Galecall',
    desc: 'Pełna rodzina tkaninowa Stormcallers.',
  },
  professions_masterwork: {
    name: 'Galeria Arcydzieł',
    desc: 'Dożywotnie trofea za pierwsze arcydzieła. Pozostaje pusta do następnego, jeśli weteran jest starszy niż galeria (żadnej zmyślonej historii wytwarzania).',
  },
  professions_field_notes: {
    name: 'Rzadkie Notatki Terenowe',
    desc: 'Charakterystyczne rzadkie znaleziska z dziczy: żyły, twardziel, kwiaty w blasku księżyca i doskonałe okazy.',
  },
  professions_specimens: {
    name: 'Kluczowe Okazy',
    desc: 'Nietknięte okazy ze zwłok, najwyższej klasy szlachetne materiały terenowe i wyczekiwany połów wędkarza: muzeum rzemieślnika w miniaturze.',
  },
  horizons_mounts: {
    name: 'Wierzchowce',
    desc: 'Wierzchowce ze stajni, heroiczne wodze, epiki ze Szczelin i rzadsze siodła. Posiadanie idzie za rzeczywistymi wodzami (torby i bank).',
  },
  horizons_weapon_skins: {
    name: 'Wyglądy Broni',
    desc: 'Wyglądy broni ze Zbrojowni obejmujące całe konto. Puste offline lub bez kosmetyki konta; nigdy nie są łupem postaci.',
  },
  horizons_titles: {
    name: 'Tytuły',
    desc: 'Tytuły zdobyte w Księdze Czynów. Wyłącznie kosmetyczne: nigdy moc, szansa na łup ani rekompensata za pecha.',
  },
  conquerors_the_rift: {
    name: 'Szczelina',
    desc: 'Charakterystyczne łupy zmiennej Szczeliny, od jej wędrownych okropieństw po dwa skarby polowania na rangę S.',
  },
  conquerors_rares_of_the_realm: {
    name: 'Rzadkie Bestie Królestwa',
    desc: 'Dowód na każdą nazwaną rzadką bestię powaloną w całym królestwie.',
  },
  conquerors_spoils_of_the_realm: {
    name: 'Łupy Królestwa',
    desc: 'Charakterystyczne skarby noszone przez nazwane rzadkie bestie królestwa.',
  },
  conquerors_warfare_gallery: {
    name: 'Galeria Wojny',
    desc: 'Pięć bojowych zestawów Wojny, zdobywanych sztuka po sztuce za honor.',
  },
  conquerors_warfare_armory: {
    name: 'Zbrojownia Wojny',
    desc: 'Biżuteria i bronie Wojny kupione za ciężko wywalczony honor.',
  },
  horizons_vault_of_ages: {
    name: 'Skarbiec Wieków',
    desc: 'Wycofane skarby minionej epoki. Tych relikwii nie da się już zdobyć; skarbiec czci weteranów, którzy je zachowali.',
  },
  horizons_riftbound: {
    name: 'Pierścienie Szczeliny',
    desc: 'Osobiste pierścienie Szczeliny, bite dla każdego czempiona w drużynie, która zdobędzie pierwsze przejście rankingowej Szczeliny. Każda postać może mieć tylko własny.',
  },
};
