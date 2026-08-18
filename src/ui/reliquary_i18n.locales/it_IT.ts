// Reliquary page name and description locale table for it_IT
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
    name: 'La Cripta Vuota',
    desc: 'Bottini distintivi strappati a Morthen e alla Cripta Vuota.',
  },
  conquerors_hollow_crypt_heroic: {
    name: 'Eroico: La Cripta Vuota',
    desc: 'Epici esclusivi della modalità eroica di Morthen il Gravecaller.',
  },
  conquerors_sunken_bastion: {
    name: 'Il Bastione Sommerso',
    desc: 'Bottini rari ed epici di Olen e di Vael il Fogbinder.',
  },
  conquerors_sunken_bastion_heroic: {
    name: 'Eroico: Il Bastione Sommerso',
    desc: 'Epici esclusivi della modalità eroica di Vael il Fogbinder.',
  },
  conquerors_drowned_temple: {
    name: 'Il Tempio Annegato',
    desc: 'Bottini rari di Selthe Madre del Coro e di Ysolei, Avatar della Luna Annegata.',
  },
  conquerors_drowned_temple_heroic: {
    name: 'Eroico: Il Tempio Annegato',
    desc: 'Epici esclusivi della modalità eroica di Ysolei.',
  },
  conquerors_gravewyrm_sanctum: {
    name: 'Santuario del Gravewyrm',
    desc: 'Bottini rari ed epici dei boss del Santuario e di Korzul il Gravewyrm.',
  },
  conquerors_gravewyrm_sanctum_heroic: {
    name: 'Eroico: Santuario del Gravewyrm',
    desc: 'Epici esclusivi della modalità eroica di Korzul il Gravewyrm.',
  },
  conquerors_wildheart_basin: {
    name: 'Il Bacino di Wildheart',
    desc: 'Armi distintive di Zulgar e del Domabestie Signore delle Zanne.',
  },
  conquerors_wildheart_basin_heroic: {
    name: 'Eroico: Il Bacino di Wildheart',
    desc: 'Epici esclusivi della modalità eroica di Zulgar, Voce del Bacino.',
  },
  conquerors_nythraxis: {
    name: 'Raid di Nythraxis',
    desc: 'Bottini epici e leggendari di Nythraxis, Flagello di Thornpeak.',
  },
  conquerors_nythraxis_heroic: {
    name: 'Eroico: Raid di Nythraxis',
    desc: 'Armi da raid esclusive della modalità eroica di Nythraxis.',
  },
  conquerors_thunzharr: {
    name: 'Thunzharr, il Picco Risvegliato',
    desc: 'Bottini epici personali del boss mondiale del Picco Risvegliato.',
  },
  conquerors_collapsed_reliquary: {
    name: 'Il Reliquiario Crollato',
    desc: 'Rari distintivi dallo scrigno da scassinare del Reliquiario Crollato.',
  },
  conquerors_drowned_litany: {
    name: 'La Litania Annegata',
    desc: 'Bottini rari ed epici della Litania Annegata.',
  },
  conquerors_set_deathlord: {
    name: 'Tenuta da battaglia di Barrowlord',
    desc: 'La famiglia completa in piastre Deathlord.',
  },
  conquerors_set_wyrmshadow: {
    name: 'Vesti Nightfang',
    desc: 'La famiglia completa in cuoio Wyrmshadow.',
  },
  conquerors_set_necromancers: {
    name: 'Vesti Mournweave',
    desc: 'La famiglia completa in stoffa Necromancers.',
  },
  conquerors_set_crownforged: {
    name: 'Tenuta da battaglia Bonewrought',
    desc: 'La famiglia completa in piastre Crownforged.',
  },
  conquerors_set_nighttalon: {
    name: 'Tenuta di cuoio Direfang',
    desc: 'La famiglia completa in cuoio Nighttalon.',
  },
  conquerors_set_soulflame: {
    name: 'Paramenti Wraithfire',
    desc: 'La famiglia completa in stoffa Soulflame.',
  },
  conquerors_set_stormcallers: {
    name: 'Vesti Galecall',
    desc: 'La famiglia completa in stoffa Stormcallers.',
  },
  professions_masterwork: {
    name: 'Galleria dei capolavori',
    desc: 'Trofei a vita dei primi capolavori. Resta vuota fino al prossimo se il veterano precede la galleria (nessuna cronologia di creazione inventata).',
  },
  professions_field_notes: {
    name: 'Appunti di campo rari',
    desc: 'Ritrovamenti rari e distintivi dalla natura: vene, durame, fiori al chiaro di luna ed esemplari perfetti.',
  },
  professions_specimens: {
    name: 'Esemplari chiave',
    desc: "Esemplari incontaminati ricavati dalle carcasse, materiali da campo pregiati di grado massimo e la preda ambita del pescatore: un museo dell'artigiano in miniatura.",
  },
  horizons_mounts: {
    name: 'Cavalcature',
    desc: 'Cavalcature della stalla, redini eroiche, epiche degli Squarci e selle più rare. Il possesso segue le redini reali (borse e banca).',
  },
  horizons_weapon_skins: {
    name: 'Aspetti delle armi',
    desc: "Aspetti delle armi dell'Armeria, validi per tutto l'account. Vuoto offline o senza cosmetici dell'account; mai bottino del personaggio.",
  },
  horizons_titles: {
    name: 'Titoli',
    desc: 'Titoli ottenuti dal Libro delle Imprese. Solo cosmetici: mai potenza, probabilità di bottino o compensazione per la sfortuna.',
  },
  conquerors_the_rift: {
    name: 'Lo Squarcio',
    desc: 'Bottini distintivi dello Squarcio mutevole, dai suoi orrori erranti ai due tesori della caccia di rango S.',
  },
  conquerors_rares_of_the_realm: {
    name: 'Rari del reame',
    desc: 'La prova di ogni raro con nome abbattuto in tutto il reame.',
  },
  conquerors_spoils_of_the_realm: {
    name: 'Bottini del reame',
    desc: 'Tesori distintivi portati dai rari con nome del reame.',
  },
  conquerors_warfare_gallery: {
    name: 'Galleria di Guerra',
    desc: "I cinque completi da battaglia di Guerra, ottenuti pezzo per pezzo con l'onore.",
  },
  conquerors_warfare_armory: {
    name: 'Armeria di Guerra',
    desc: 'Gioielli e armi di Guerra acquistati con onore sudato.',
  },
  horizons_vault_of_ages: {
    name: 'Camera del Tesoro delle Ere',
    desc: "Tesori ritirati di un'epoca passata. Queste reliquie non si possono più conquistare; la camera rende onore ai veterani che le conservano.",
  },
  horizons_riftbound: {
    name: 'Anelli dello Squarcio',
    desc: 'Gli anelli dello Squarcio personali, coniati per ogni campione del gruppo che ottiene la prima conquista di uno Squarcio classificato. Ogni personaggio può possedere solo il proprio.',
  },
};
