// Reliquary page name and description locale table for nl_NL
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
    name: 'De Holle Crypte',
    desc: 'Kenmerkende buit ontworsteld aan Morthen en de Holle Crypte.',
  },
  conquerors_hollow_crypt_heroic: {
    name: 'Heroïsch: De Holle Crypte',
    desc: 'Alleen heroïsch verkrijgbare epics van Morthen de Grafroeper.',
  },
  conquerors_sunken_bastion: {
    name: 'Het Verzonken Bastion',
    desc: 'Zeldzame en epische buit van Olen en Vael de Fogbinder.',
  },
  conquerors_sunken_bastion_heroic: {
    name: 'Heroïsch: Het Verzonken Bastion',
    desc: 'Alleen heroïsch verkrijgbare epics van Vael de Fogbinder.',
  },
  conquerors_drowned_temple: {
    name: 'De Verdronken Tempel',
    desc: 'Zeldzame buit van Koormoeder Selthe en Ysolei, Avatar van de Verdronken Maan.',
  },
  conquerors_drowned_temple_heroic: {
    name: 'Heroïsch: De Verdronken Tempel',
    desc: 'Alleen heroïsch verkrijgbare epics van Ysolei.',
  },
  conquerors_gravewyrm_sanctum: {
    name: 'Grafwurm-Heiligdom',
    desc: 'Zeldzame en epische buit van de bazen van het Heiligdom en Korzul de Grafwurm.',
  },
  conquerors_gravewyrm_sanctum_heroic: {
    name: 'Heroïsch: Grafwurm-Heiligdom',
    desc: 'Alleen heroïsch verkrijgbare epics van Korzul de Grafwurm.',
  },
  conquerors_wildheart_basin: {
    name: 'Het Wildhartbekken',
    desc: 'Kenmerkende wapens van Zulgar en de Slagtandheer Beestenmeester.',
  },
  conquerors_wildheart_basin_heroic: {
    name: 'Heroïsch: Het Wildhartbekken',
    desc: 'Alleen heroïsch verkrijgbare epics van Zulgar, Stem van het Bekken.',
  },
  conquerors_nythraxis: {
    name: 'Nythraxis-raid',
    desc: 'Epische en legendarische buit van Nythraxis, Gesel van Doorntop.',
  },
  conquerors_nythraxis_heroic: {
    name: 'Heroïsch: Nythraxis-raid',
    desc: 'Alleen heroïsch verkrijgbare raidwapens van Nythraxis.',
  },
  conquerors_thunzharr: {
    name: 'Thunzharr, de Ontwakende Piek',
    desc: 'Persoonlijke epische buit van de wereldbaas van de Ontwakende Piek.',
  },
  conquerors_collapsed_reliquary: {
    name: 'Het Ingestorte Reliekschrijn',
    desc: 'Kenmerkende zeldzame stukken uit de te forceren kist van het Ingestorte Reliekschrijn.',
  },
  conquerors_drowned_litany: {
    name: 'De Verdronken Litanie',
    desc: 'Zeldzame en epische buit uit de Verdronken Litanie.',
  },
  conquerors_set_deathlord: {
    name: 'Barrowlord-Strijduitrusting',
    desc: 'De volledige Deathlord-plaatfamilie.',
  },
  conquerors_set_wyrmshadow: {
    name: 'Nightfang-Gewaden',
    desc: 'De volledige Wyrmshadow-leerfamilie.',
  },
  conquerors_set_necromancers: {
    name: 'Mournweave-Gewaden',
    desc: 'De volledige Necromancers-stoffamilie.',
  },
  conquerors_set_crownforged: {
    name: 'Bonewrought-Regalia',
    desc: 'De volledige Crownforged-plaatfamilie.',
  },
  conquerors_set_nighttalon: {
    name: 'Direfang-Pels',
    desc: 'De volledige Nighttalon-leerfamilie.',
  },
  conquerors_set_soulflame: {
    name: 'Wraithfire-Regalia',
    desc: 'De volledige Soulflame-stoffamilie.',
  },
  conquerors_set_stormcallers: {
    name: 'Galecall-Gewaden',
    desc: 'De volledige Stormcallers-stoffamilie.',
  },
  professions_masterwork: {
    name: 'Meesterwerkgalerij',
    desc: 'Levenslange trofeeën voor eerste meesterwerken. Blijft leeg tot het volgende meesterwerk als een veteraan ouder is dan de galerij (geen verzonnen ambachtsgeschiedenis).',
  },
  professions_field_notes: {
    name: 'Zeldzame Veldnotities',
    desc: 'Kenmerkende zeldzame vondsten uit de wildernis: aders, kernhout, bloesems in maanlicht en perfecte exemplaren.',
  },
  professions_specimens: {
    name: 'Kernexemplaren',
    desc: 'Ongerepte exemplaren uit kadavers, fijne veldmaterialen van de hoogste graad en de begeerde vangst van de visser: een ambachtsmuseum in het klein.',
  },
  horizons_mounts: {
    name: 'Rijdieren',
    desc: 'Berijdbare rijdieren uit de stal, heroïsche teugels, Rift-epics en zeldzamere zadels. Bezit volgt de echte teugels (tassen en bank).',
  },
  horizons_weapon_skins: {
    name: 'Wapenskins',
    desc: 'Accountbrede wapenskins uit de Wapenkamer. Leeg offline of zonder accountcosmetica; nooit personagebuit.',
  },
  horizons_titles: {
    name: 'Titels',
    desc: 'Titels verdiend in het Boek der Daden. Alleen cosmetisch: nooit kracht, buitkans of pechcompensatie.',
  },
  conquerors_the_rift: {
    name: 'De Rift',
    desc: 'Kenmerkende buit van de wisselende Rift, van haar zwervende verschrikkingen tot de twee schatten van de S-rangjacht.',
  },
  conquerors_rares_of_the_realm: {
    name: 'Zeldzamen van het Rijk',
    desc: 'Het bewijs van elke benoemde zeldzame die in het rijk is geveld.',
  },
  conquerors_spoils_of_the_realm: {
    name: 'Buit van het Rijk',
    desc: 'Kenmerkende schatten die de benoemde zeldzamen van het rijk met zich dragen.',
  },
  conquerors_warfare_gallery: {
    name: 'Oorlogsvoeringgalerij',
    desc: 'De vijf strijduitrustingen van Oorlogsvoering, stuk voor stuk met eer verdiend.',
  },
  conquerors_warfare_armory: {
    name: 'Oorlogsvoeringwapenkamer',
    desc: 'Sieraden en wapens van Oorlogsvoering, gekocht met zwaarbevochten eer.',
  },
  horizons_vault_of_ages: {
    name: 'Schatkamer der Eeuwen',
    desc: 'Vervallen schatten uit een vervlogen tijd. Deze relieken zijn niet langer te winnen; de schatkamer eert de veteranen die ze bewaren.',
  },
  horizons_riftbound: {
    name: 'Riftbanden',
    desc: 'De persoonlijke Riftbanden, geslagen voor elke kampioen in de groep die de eerste voltooiing van een gerangschikte Rift wint. Een personage kan alleen het zijne bezitten.',
  },
};
