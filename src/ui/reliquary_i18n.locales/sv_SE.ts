// Reliquary page name and description locale table for sv_SE
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
    name: 'Den ihåliga kryptan',
    desc: 'Utmärkande byte taget från Morthen och Den ihåliga kryptan.',
  },
  conquerors_hollow_crypt_heroic: {
    name: 'Heroisk: Den ihåliga kryptan',
    desc: 'Episka föremål enbart från heroiskt läge, från Morthen Gravkallaren.',
  },
  conquerors_sunken_bastion: {
    name: 'Den sjunkna bastionen',
    desc: 'Sällsynt och episkt byte från Olen och Vael Fogbindern.',
  },
  conquerors_sunken_bastion_heroic: {
    name: 'Heroisk: Den sjunkna bastionen',
    desc: 'Episka föremål enbart från heroiskt läge, från Vael Fogbindern.',
  },
  conquerors_drowned_temple: {
    name: 'Det dränkta templet',
    desc: 'Sällsynt byte från Körmoder Selthe och Ysolei, den dränkta månens avatar.',
  },
  conquerors_drowned_temple_heroic: {
    name: 'Heroisk: Det dränkta templet',
    desc: 'Episka föremål enbart från heroiskt läge, från Ysolei.',
  },
  conquerors_gravewyrm_sanctum: {
    name: 'Gravlindormens helgedom',
    desc: 'Sällsynt och episkt byte från helgedomens bossar och Korzul Gravlindormen.',
  },
  conquerors_gravewyrm_sanctum_heroic: {
    name: 'Heroisk: Gravlindormens helgedom',
    desc: 'Episka föremål enbart från heroiskt läge, från Korzul Gravlindormen.',
  },
  conquerors_wildheart_basin: {
    name: 'Vildhjärtats bassäng',
    desc: 'Utmärkande vapen från Zulgar och Huggtandsherren, djurens mästare.',
  },
  conquerors_wildheart_basin_heroic: {
    name: 'Heroisk: Vildhjärtats bassäng',
    desc: 'Episka föremål enbart från heroiskt läge, från Zulgar, Bassängens röst.',
  },
  conquerors_nythraxis: {
    name: 'Nythraxis-raid',
    desc: 'Episkt och legendariskt byte från Nythraxis, Törntoppens gissel.',
  },
  conquerors_nythraxis_heroic: {
    name: 'Heroisk: Nythraxis-raid',
    desc: 'Raidvapen enbart från heroiskt läge, från Nythraxis.',
  },
  conquerors_thunzharr: {
    name: 'Thunzharr, den vaknande toppen',
    desc: 'Personligt episkt byte från den vaknande toppens världsboss.',
  },
  conquerors_collapsed_reliquary: {
    name: 'Det rasade relikvariet',
    desc: 'Utmärkande sällsyntheter ur den dyrkbara kistan i Det rasade relikvariet.',
  },
  conquerors_drowned_litany: {
    name: 'Den dränkta litanian',
    desc: 'Sällsynt och episkt byte ur Den dränkta litanian.',
  },
  conquerors_set_deathlord: {
    name: 'Barrowlords stridsutrustning',
    desc: 'Hela Deathlord-familjen i plåt.',
  },
  conquerors_set_wyrmshadow: {
    name: 'Nightfang-skrud',
    desc: 'Hela Wyrmshadow-familjen i läder.',
  },
  conquerors_set_necromancers: {
    name: 'Mournweave-skrud',
    desc: 'Hela Necromancers-familjen i tyg.',
  },
  conquerors_set_crownforged: {
    name: 'Bonewrought-regalier',
    desc: 'Hela Crownforged-familjen i plåt.',
  },
  conquerors_set_nighttalon: {
    name: 'Direfang-päls',
    desc: 'Hela Nighttalon-familjen i läder.',
  },
  conquerors_set_soulflame: {
    name: 'Wraithfire-regalier',
    desc: 'Hela Soulflame-familjen i tyg.',
  },
  conquerors_set_stormcallers: {
    name: 'Galecall-skrud',
    desc: 'Hela Stormcallers-familjen i tyg.',
  },
  professions_masterwork: {
    name: 'Mästerverksgalleri',
    desc: 'Livslånga troféer för första mästerverk. Står tom till nästa gång om en veteran är äldre än galleriet (ingen påhittad hantverkshistorik).',
  },
  professions_field_notes: {
    name: 'Sällsynta fältanteckningar',
    desc: 'Utmärkande sällsynta fynd ur vildmarken: ådror, kärnved, månbelysta blommor och perfekta exemplar.',
  },
  professions_specimens: {
    name: 'Nyckelexemplar',
    desc: 'Orörda exemplar ur kadaver, fina fältmaterial av högsta grad och fiskarens eftertraktade fångst: ett hantverkarmuseum i miniatyr.',
  },
  horizons_mounts: {
    name: 'Riddjur',
    desc: 'Ridbara riddjur från stallet, heroiska tyglar, episka föremål ur Revorna och ovanligare sadlar. Ägandet följer de verkliga tyglarna (väskor och bank).',
  },
  horizons_weapon_skins: {
    name: 'Vapenutseenden',
    desc: 'Kontoövergripande vapenutseenden från Vapenkammaren. Tomt offline eller utan kontokosmetika; aldrig rollpersonens byte.',
  },
  horizons_titles: {
    name: 'Titlar',
    desc: 'Titlar förtjänade i Bedrifternas bok. Enbart kosmetiska: aldrig styrka, bytesfrekvens eller oturskompensation.',
  },
  conquerors_the_rift: {
    name: 'Revan',
    desc: 'Utmärkande byte ur den skiftande Revan, från dess kringströvande fasor till de två skatterna i jakten på S-rang.',
  },
  conquerors_rares_of_the_realm: {
    name: 'Rikets sällsyntheter',
    desc: 'Beviset på varje namngiven sällsynthet som fällts i riket.',
  },
  conquerors_spoils_of_the_realm: {
    name: 'Rikets byten',
    desc: 'Utmärkande skatter som rikets namngivna sällsyntheter bär på.',
  },
  conquerors_warfare_gallery: {
    name: 'Krigföringsgalleri',
    desc: 'De fem stridsutrustningarna för Krigföring, förtjänade del för del med ära.',
  },
  conquerors_warfare_armory: {
    name: 'Krigföringens vapenkammare',
    desc: 'Smycken och vapen för Krigföring, köpta för hårt vunnen ära.',
  },
  horizons_vault_of_ages: {
    name: 'Tidsåldrarnas valv',
    desc: 'Utgångna skatter från en svunnen tid. Dessa reliker går inte längre att vinna; valvet hedrar de veteraner som behållit dem.',
  },
  horizons_riftbound: {
    name: 'Revringar',
    desc: 'De personliga revringarna, präglade åt varje mästare i gruppen som vinner första klarningen av en rankad Reva. En rollperson kan bara äga sin egen.',
  },
};
