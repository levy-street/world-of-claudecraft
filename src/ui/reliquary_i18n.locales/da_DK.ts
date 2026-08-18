// Reliquary page name and description locale table for da_DK
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
    name: 'Den Hule Krypt',
    desc: 'Kendetegnende bytte taget fra Morthen og Den Hule Krypt.',
  },
  conquerors_hollow_crypt_heroic: {
    name: 'Heroisk: Den Hule Krypt',
    desc: 'Episke genstande kun fra heroisk tilstand, fra Morthen Gravkalderen.',
  },
  conquerors_sunken_bastion: {
    name: 'Den Sunkne Bastion',
    desc: 'Sjældent og episk bytte fra Olen og Vael Fogbinderen.',
  },
  conquerors_sunken_bastion_heroic: {
    name: 'Heroisk: Den Sunkne Bastion',
    desc: 'Episke genstande kun fra heroisk tilstand, fra Vael Fogbinderen.',
  },
  conquerors_drowned_temple: {
    name: 'Det Druknede Tempel',
    desc: 'Sjældent bytte fra Kormoder Selthe og Ysolei, den Druknede Månes Avatar.',
  },
  conquerors_drowned_temple_heroic: {
    name: 'Heroisk: Det Druknede Tempel',
    desc: 'Episke genstande kun fra heroisk tilstand, fra Ysolei.',
  },
  conquerors_gravewyrm_sanctum: {
    name: 'Gravormens Helligdom',
    desc: 'Sjældent og episk bytte fra Helligdommens bosser og Korzul Gravormen.',
  },
  conquerors_gravewyrm_sanctum_heroic: {
    name: 'Heroisk: Gravormens Helligdom',
    desc: 'Episke genstande kun fra heroisk tilstand, fra Korzul Gravormen.',
  },
  conquerors_wildheart_basin: {
    name: 'Vildhjertebassinet',
    desc: 'Kendetegnende våben fra Zulgar og Hugtandherre Bæstmester.',
  },
  conquerors_wildheart_basin_heroic: {
    name: 'Heroisk: Vildhjertebassinet',
    desc: 'Episke genstande kun fra heroisk tilstand, fra Zulgar, Bassinets Stemme.',
  },
  conquerors_nythraxis: {
    name: 'Nythraxis-raid',
    desc: 'Episk og legendarisk bytte fra Nythraxis, Tornetops Svøbe.',
  },
  conquerors_nythraxis_heroic: {
    name: 'Heroisk: Nythraxis-raid',
    desc: 'Raidvåben kun fra heroisk tilstand, fra Nythraxis.',
  },
  conquerors_thunzharr: {
    name: 'Thunzharr, den Vågnende Tinde',
    desc: 'Personligt episk bytte fra den Vågnende Tindes verdensboss.',
  },
  conquerors_collapsed_reliquary: {
    name: 'Det Sammenstyrtede Relikvarium',
    desc: 'Kendetegnende sjældenheder fra dirkekisten i Det Sammenstyrtede Relikvarium.',
  },
  conquerors_drowned_litany: {
    name: 'Det Druknede Litani',
    desc: 'Sjældent og episk bytte fra Det Druknede Litani.',
  },
  conquerors_set_deathlord: {
    name: 'Barrowlord kampudstyr',
    desc: 'Hele Deathlord-familien i plade.',
  },
  conquerors_set_wyrmshadow: {
    name: 'Nightfang klæder',
    desc: 'Hele Wyrmshadow-familien i læder.',
  },
  conquerors_set_necromancers: {
    name: 'Mournweave klæder',
    desc: 'Hele Necromancers-familien i stof.',
  },
  conquerors_set_crownforged: {
    name: 'Bonewrought regalier',
    desc: 'Hele Crownforged-familien i plade.',
  },
  conquerors_set_nighttalon: {
    name: 'Direfang pels',
    desc: 'Hele Nighttalon-familien i læder.',
  },
  conquerors_set_soulflame: {
    name: 'Wraithfire regalier',
    desc: 'Hele Soulflame-familien i stof.',
  },
  conquerors_set_stormcallers: {
    name: 'Galecall klæder',
    desc: 'Hele Stormcallers-familien i stof.',
  },
  professions_masterwork: {
    name: 'Mesterværksgalleri',
    desc: 'Livsvarige trofæer for første mesterværker. Står tom indtil næste gang, hvis en veteran er ældre end galleriet (ingen opdigtet håndværkshistorik).',
  },
  professions_field_notes: {
    name: 'Sjældne Feltnoter',
    desc: 'Kendetegnende sjældne fund fra vildmarken: årer, kerneved, måneoplyste blomster og perfekte eksemplarer.',
  },
  professions_specimens: {
    name: 'Nøgleeksemplarer',
    desc: 'Urørte eksemplarer fra kadavere, fine feltmaterialer af højeste grad og fiskerens eftertragtede fangst: et håndværkermuseum i miniature.',
  },
  horizons_mounts: {
    name: 'Ridedyr',
    desc: 'Ridedyr fra stalden, heroiske tøjler, episke genstande fra Rifter og sjældnere sadler. Ejerskabet følger de rigtige tøjler (tasker og bank).',
  },
  horizons_weapon_skins: {
    name: 'Våbenudseender',
    desc: 'Kontodækkende våbenudseender fra Våbenkammeret. Tomt offline eller uden kontokosmetik; aldrig figurens bytte.',
  },
  horizons_titles: {
    name: 'Titler',
    desc: 'Titler optjent i Bedrifternes Bog. Kun kosmetiske: aldrig styrke, byttechance eller uheldskompensation.',
  },
  conquerors_the_rift: {
    name: 'Riften',
    desc: 'Kendetegnende bytte fra den skiftende Rift, fra dens omvandrende rædsler til de to skatte i jagten på rang S.',
  },
  conquerors_rares_of_the_realm: {
    name: 'Rigets sjældenheder',
    desc: 'Beviset på hver navngiven sjældenhed, der er fældet i riget.',
  },
  conquerors_spoils_of_the_realm: {
    name: 'Rigets bytte',
    desc: 'Kendetegnende skatte, som rigets navngivne sjældenheder bærer på.',
  },
  conquerors_warfare_gallery: {
    name: 'Krigsførelsesgalleri',
    desc: 'De fem kampsæt til Krigsførelse, optjent stykke for stykke med ære.',
  },
  conquerors_warfare_armory: {
    name: 'Krigsførelsens våbenkammer',
    desc: 'Smykker og våben til Krigsførelse, købt for hårdt vundet ære.',
  },
  horizons_vault_of_ages: {
    name: 'Tidsaldrenes hvælving',
    desc: 'Udgåede skatte fra en svunden tid. Disse relikvier kan ikke længere vindes; hvælvingen hædrer de veteraner, der har beholdt dem.',
  },
  horizons_riftbound: {
    name: 'Riftringe',
    desc: 'De personlige riftringe, præget til hver mester i gruppen, der vinder den første gennemførsel af en rangeret Rift. En figur kan kun eje sin egen.',
  },
};
