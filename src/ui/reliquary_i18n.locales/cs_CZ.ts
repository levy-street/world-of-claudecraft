// Reliquary page name and description locale table for cs_CZ
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
    name: 'Dutá krypta',
    desc: 'Příznačná kořist vyrvaná Morthenovi a Duté kryptě.',
  },
  conquerors_hollow_crypt_heroic: {
    name: 'Hrdinská: Dutá krypta',
    desc: 'Epické předměty dostupné jen hrdinsky od Morthena Hrobovolajícího.',
  },
  conquerors_sunken_bastion: {
    name: 'Potopená bašta',
    desc: 'Vzácná a epická kořist od Olena a Vaela Mlhovazače.',
  },
  conquerors_sunken_bastion_heroic: {
    name: 'Hrdinská: Potopená bašta',
    desc: 'Epické předměty dostupné jen hrdinsky od Vaela Mlhovazače.',
  },
  conquerors_drowned_temple: {
    name: 'Utopený chrám',
    desc: 'Vzácná kořist od Matky sboru Selthe a od Ysolei, avatara utopeného měsíce.',
  },
  conquerors_drowned_temple_heroic: {
    name: 'Hrdinská: Utopený chrám',
    desc: 'Epické předměty dostupné jen hrdinsky od Ysolei.',
  },
  conquerors_gravewyrm_sanctum: {
    name: 'Svatyně Hrobodraka',
    desc: 'Vzácná a epická kořist od bossů Svatyně a od Korzula Hrobodraka.',
  },
  conquerors_gravewyrm_sanctum_heroic: {
    name: 'Hrdinská: Svatyně Hrobodraka',
    desc: 'Epické předměty dostupné jen hrdinsky od Korzula Hrobodraka.',
  },
  conquerors_wildheart_basin: {
    name: 'Kotlina Divokého srdce',
    desc: 'Příznačné zbraně od Zulgara a od Tesákopána, krotitele zvěře.',
  },
  conquerors_wildheart_basin_heroic: {
    name: 'Hrdinská: Kotlina Divokého srdce',
    desc: 'Epické předměty dostupné jen hrdinsky od Zulgara, hlasu Kotliny.',
  },
  conquerors_nythraxis: {
    name: 'Raid Nythraxis',
    desc: 'Epická a legendární kořist od Nythraxe, metly Thornpeaku.',
  },
  conquerors_nythraxis_heroic: {
    name: 'Hrdinský: Raid Nythraxis',
    desc: 'Raidové zbraně dostupné jen hrdinsky od Nythraxe.',
  },
  conquerors_thunzharr: {
    name: 'Thunzharr, probouzející se štít',
    desc: 'Osobní epická kořist od světového bosse Probouzejícího se štítu.',
  },
  conquerors_collapsed_reliquary: {
    name: 'Zhroucený relikviář',
    desc: 'Příznačné vzácnosti z truhly na zámek ve Zhrouceném relikviáři.',
  },
  conquerors_drowned_litany: {
    name: 'Utopená litanie',
    desc: 'Vzácná a epická kořist z Utopené litanie.',
  },
  conquerors_set_deathlord: {
    name: 'Bojová výbava mohylového pána',
    desc: 'Úplná plátová rodina Deathlord.',
  },
  conquerors_set_wyrmshadow: {
    name: 'Roucha nočního tesáku',
    desc: 'Úplná kožená rodina Wyrmshadow.',
  },
  conquerors_set_necromancers: {
    name: 'Oděv smutkotkaní',
    desc: 'Úplná látková rodina Necromancers.',
  },
  conquerors_set_crownforged: {
    name: 'Regálie z kosti',
    desc: 'Úplná plátová rodina Crownforged.',
  },
  conquerors_set_nighttalon: {
    name: 'Kožešina děsivého tesáku',
    desc: 'Úplná kožená rodina Nighttalon.',
  },
  conquerors_set_soulflame: {
    name: 'Regálie přízračného ohně',
    desc: 'Úplná látková rodina Soulflame.',
  },
  conquerors_set_stormcallers: {
    name: 'Roucha volání vichru',
    desc: 'Úplná látková rodina Stormcallers.',
  },
  professions_masterwork: {
    name: 'Galerie mistrovských děl',
    desc: 'Doživotní trofeje za první mistrovská díla. Zůstane prázdná až do dalšího, pokud je veterán starší než galerie (žádná vymyšlená historie výroby).',
  },
  professions_field_notes: {
    name: 'Vzácné terénní zápisky',
    desc: 'Příznačné vzácné nálezy z divočiny: žíly, jádrové dřevo, květy v měsíčním svitu a dokonalé exempláře.',
  },
  professions_specimens: {
    name: 'Klíčové exempláře',
    desc: 'Netknuté vzorky z mrtvol, špičkové jemné terénní materiály a vytoužený rybářův úlovek: muzeum řemeslníka v malém.',
  },
  horizons_mounts: {
    name: 'Jízdní zvířata',
    desc: 'Jízdní zvířata ze stáje, hrdinské otěže, epické předměty z trhlin a vzácnější sedla. Vlastnictví se řídí skutečnými otěžemi (brašny a banka).',
  },
  horizons_weapon_skins: {
    name: 'Vzhledy zbraní',
    desc: 'Vzhledy zbraní ze Zbrojnice platné pro celý účet. Offline nebo bez kosmetiky účtu zůstává prázdné; nikdy nejde o kořist postavy.',
  },
  horizons_titles: {
    name: 'Tituly',
    desc: 'Tituly získané z Knihy skutků. Pouze kosmetické: nikdy ne síla, šance na kořist ani vyrovnání smůly.',
  },
  conquerors_the_rift: {
    name: 'Trhlina',
    desc: 'Příznačná kořist proměnlivé Trhliny, od jejích potulných hrůz až po dvojici pokladů z honby za hodností S.',
  },
  conquerors_rares_of_the_realm: {
    name: 'Vzácní tvorové říše',
    desc: 'Důkaz o každém pojmenovaném vzácném tvorovi skoleném napříč říší.',
  },
  conquerors_spoils_of_the_realm: {
    name: 'Kořist říše',
    desc: 'Příznačné poklady, které nosí pojmenovaní vzácní tvorové říše.',
  },
  conquerors_warfare_gallery: {
    name: 'Galerie Válčení',
    desc: 'Pět bojových sad Válčení, získaných kus po kuse za čest.',
  },
  conquerors_warfare_armory: {
    name: 'Zbrojnice Válčení',
    desc: 'Šperky a zbraně Válčení koupené za tvrdě vydobytou čest.',
  },
  horizons_vault_of_ages: {
    name: 'Klenotnice věků',
    desc: 'Vyřazené poklady dávné doby. Tyto relikvie už nelze získat; klenotnice ctí veterány, kteří si je uchovali.',
  },
  horizons_riftbound: {
    name: 'Prsteny trhliny',
    desc: 'Osobní prsteny trhliny, ražené pro každého šampiona v družině, která zvládne první průchod hodnocenou trhlinou. Každá postava může vlastnit jen ten svůj.',
  },
};
