// Reliquary page name and description locale table for de_DE
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
    name: 'Die Hohle Gruft',
    desc: 'Bezeichnende Beute, Morthen und der Hohlen Gruft abgerungen.',
  },
  conquerors_hollow_crypt_heroic: {
    name: 'Heroisch: Die Hohle Gruft',
    desc: 'Nur heroisch erhältliche Epics von Morthen der Gravecaller.',
  },
  conquerors_sunken_bastion: {
    name: 'Die versunkene Bastion',
    desc: 'Seltene und epische Beute von Olen und Vael der Fogbinder.',
  },
  conquerors_sunken_bastion_heroic: {
    name: 'Heroisch: Die versunkene Bastion',
    desc: 'Nur heroisch erhältliche Epics von Vael der Fogbinder.',
  },
  conquerors_drowned_temple: {
    name: 'Der Ertränkte Tempel',
    desc: 'Seltene Beute von Chormutter Selthe und Ysolei, Avatar des Ertränkten Mondes.',
  },
  conquerors_drowned_temple_heroic: {
    name: 'Heroisch: Der Ertränkte Tempel',
    desc: 'Nur heroisch erhältliche Epics von Ysolei.',
  },
  conquerors_gravewyrm_sanctum: {
    name: 'Gravewyrm-Heiligtum',
    desc: 'Seltene und epische Beute von den Bossen des Heiligtums und Korzul der Gravewyrm.',
  },
  conquerors_gravewyrm_sanctum_heroic: {
    name: 'Heroisch: Gravewyrm-Heiligtum',
    desc: 'Nur heroisch erhältliche Epics von Korzul der Gravewyrm.',
  },
  conquerors_wildheart_basin: {
    name: 'Das Wildherzbecken',
    desc: 'Bezeichnende Waffen von Zulgar und dem Fangfürst, Bestienmeister.',
  },
  conquerors_wildheart_basin_heroic: {
    name: 'Heroisch: Das Wildherzbecken',
    desc: 'Nur heroisch erhältliche Epics von Zulgar, Stimme des Beckens.',
  },
  conquerors_nythraxis: {
    name: 'Nythraxis-Schlachtzug',
    desc: 'Epische und legendäre Beute von Nythraxis, Geißel von Thornpeak.',
  },
  conquerors_nythraxis_heroic: {
    name: 'Heroisch: Nythraxis-Schlachtzug',
    desc: 'Nur heroisch erhältliche Schlachtzugswaffen von Nythraxis.',
  },
  conquerors_thunzharr: {
    name: 'Thunzharr, der Erwachende Gipfel',
    desc: 'Persönliche epische Beute vom Weltboss des Erwachenden Gipfels.',
  },
  conquerors_collapsed_reliquary: {
    name: 'Das Eingestürzte Reliquiar',
    desc: 'Bezeichnende seltene Stücke aus der Schlosstruhe des Eingestürzten Reliquiars.',
  },
  conquerors_drowned_litany: {
    name: 'Die Ertrunkene Litanei',
    desc: 'Seltene und epische Beute aus der Ertrunkenen Litanei.',
  },
  conquerors_set_deathlord: {
    name: 'Barrowlord-Kriegstracht',
    desc: 'Die vollständige Deathlord-Plattenfamilie.',
  },
  conquerors_set_wyrmshadow: {
    name: 'Nightfang-Gewänder',
    desc: 'Die vollständige Wyrmshadow-Lederfamilie.',
  },
  conquerors_set_necromancers: {
    name: 'Mournweave-Gewänder',
    desc: 'Die vollständige Necromancers-Stofffamilie.',
  },
  conquerors_set_crownforged: {
    name: 'Bonewrought-Kriegstracht',
    desc: 'Die vollständige Crownforged-Plattenfamilie.',
  },
  conquerors_set_nighttalon: {
    name: 'Direfang-Pelz',
    desc: 'Die vollständige Nighttalon-Lederfamilie.',
  },
  conquerors_set_soulflame: {
    name: 'Wraithfire-Gewänder',
    desc: 'Die vollständige Soulflame-Stofffamilie.',
  },
  conquerors_set_stormcallers: {
    name: 'Galecall-Gewänder',
    desc: 'Die vollständige Stormcallers-Stofffamilie.',
  },
  professions_masterwork: {
    name: 'Meisterwerkgalerie',
    desc: 'Lebenslange Trophäen für erste Meisterwerke. Bleibt bis zum nächsten Auslösen leer, wenn ein Veteran älter ist als die Galerie (keine erfundene Handwerksgeschichte).',
  },
  professions_field_notes: {
    name: 'Seltene Feldnotizen',
    desc: 'Bezeichnende seltene Funde aus der Wildnis: Adern, Kernholz, mondbeschienene Blüten und perfekte Exemplare.',
  },
  professions_specimens: {
    name: 'Schlüsselexemplare',
    desc: 'Makellose Kadaverproben, feine Feldmaterialien höchster Güte und der ersehnte Fang des Anglers: ein Handwerkermuseum im Kleinen.',
  },
  horizons_mounts: {
    name: 'Reittiere',
    desc: 'Reitbare Reittiere aus dem Stall, heroische Zügel, Riss-Epics und seltenere Sättel. Der Besitz folgt den echten Zügeln (Taschen und Bank).',
  },
  horizons_weapon_skins: {
    name: 'Waffenoptiken',
    desc: 'Kontoweite Waffenoptiken aus dem Waffenlager. Offline oder ohne Kontokosmetik leer; niemals Charakterbeute.',
  },
  horizons_titles: {
    name: 'Titel',
    desc: 'Im Buch der Taten errungene Titel. Rein kosmetisch: niemals Macht, Beutechance oder Pechausgleich.',
  },
  conquerors_the_rift: {
    name: 'Der Riss',
    desc: 'Bezeichnende Beute des wandelbaren Risses, von seinen streifenden Schrecken bis zu den zwei Schätzen der S-Rang-Jagd.',
  },
  conquerors_rares_of_the_realm: {
    name: 'Raritäten des Reichs',
    desc: 'Der Beweis für jede benannte Rarität, die im Reich zur Strecke gebracht wurde.',
  },
  conquerors_spoils_of_the_realm: {
    name: 'Beute des Reichs',
    desc: 'Bezeichnende Schätze, die die benannten Raritäten des Reichs mit sich tragen.',
  },
  conquerors_warfare_gallery: {
    name: 'Kriegsführungsgalerie',
    desc: 'Die fünf Kriegsführungs-Kampfausrüstungen, Stück für Stück mit Ehre verdient.',
  },
  conquerors_warfare_armory: {
    name: 'Kriegsführungsarsenal',
    desc: 'Kriegsführungsschmuck und -waffen, gekauft mit hart erkämpfter Ehre.',
  },
  horizons_vault_of_ages: {
    name: 'Gewölbe der Zeitalter',
    desc: 'Ausgemusterte Schätze einer vergangenen Zeit. Diese Reliquien lassen sich nicht mehr erringen; das Gewölbe ehrt die Veteranen, die sie bewahren.',
  },
  horizons_riftbound: {
    name: 'Rissbande',
    desc: 'Die persönlichen Rissbande, geprägt für jeden Champion der Gruppe, die den ersten Durchgang eines gewerteten Risses gewinnt. Ein Charakter kann immer nur das eigene besitzen.',
  },
};
