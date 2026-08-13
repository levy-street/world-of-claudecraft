// Reliquary page name and description locale table for es
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
    name: 'La Cripta Hueca',
    desc: 'Botines emblemáticos arrebatados a Morthen y a la Cripta Hueca.',
  },
  conquerors_hollow_crypt_heroic: {
    name: 'Heroico: La Cripta Hueca',
    desc: 'Épicos exclusivos del modo heroico de Morthen el Gravecaller.',
  },
  conquerors_sunken_bastion: {
    name: 'El Bastión Sumergido',
    desc: 'Botines raros y épicos de Olen y de Vael el Fogbinder.',
  },
  conquerors_sunken_bastion_heroic: {
    name: 'Heroico: El Bastión Sumergido',
    desc: 'Épicos exclusivos del modo heroico de Vael el Fogbinder.',
  },
  conquerors_drowned_temple: {
    name: 'El Templo Ahogado',
    desc: 'Botines raros de Selthe, madre del coro, y de Ysolei, Avatar de la Luna Ahogada.',
  },
  conquerors_drowned_temple_heroic: {
    name: 'Heroico: El Templo Ahogado',
    desc: 'Épicos exclusivos del modo heroico de Ysolei.',
  },
  conquerors_gravewyrm_sanctum: {
    name: 'Santuario del Gravewyrm',
    desc: 'Botines raros y épicos de los jefes del Santuario y de Korzul el Gravewyrm.',
  },
  conquerors_gravewyrm_sanctum_heroic: {
    name: 'Heroico: Santuario del Gravewyrm',
    desc: 'Épicos exclusivos del modo heroico de Korzul el Gravewyrm.',
  },
  conquerors_wildheart_basin: {
    name: 'La Cuenca del Corazón Salvaje',
    desc: 'Armas emblemáticas de Zulgar y del Domador de Bestias Fanglord.',
  },
  conquerors_wildheart_basin_heroic: {
    name: 'Heroico: La Cuenca del Corazón Salvaje',
    desc: 'Épicos exclusivos del modo heroico de Zulgar, Voz de la Cuenca.',
  },
  conquerors_nythraxis: {
    name: 'Incursión de Nythraxis',
    desc: 'Botines épicos y legendarios de Nythraxis, Azote de Thornpeak.',
  },
  conquerors_nythraxis_heroic: {
    name: 'Heroico: Incursión de Nythraxis',
    desc: 'Armas de incursión exclusivas del modo heroico de Nythraxis.',
  },
  conquerors_thunzharr: {
    name: 'Thunzharr, el Pico Despierto',
    desc: 'Botines épicos personales del jefe de mundo del Pico Despierto.',
  },
  conquerors_collapsed_reliquary: {
    name: 'El Relicario Hundido',
    desc: 'Objetos raros emblemáticos del cofre con cerradura del Relicario Hundido.',
  },
  conquerors_drowned_litany: {
    name: 'La Letanía Ahogada',
    desc: 'Botines raros y épicos de la Letanía Ahogada.',
  },
  conquerors_set_deathlord: {
    name: 'Equipo de batalla de Barrowlord',
    desc: 'La familia completa de placas Deathlord.',
  },
  conquerors_set_wyrmshadow: {
    name: 'Atuendo de Nightfang',
    desc: 'La familia completa de cuero Wyrmshadow.',
  },
  conquerors_set_necromancers: {
    name: 'Vestiduras de Mournweave',
    desc: 'La familia completa de tela Necromancers.',
  },
  conquerors_set_crownforged: {
    name: 'Equipo de batalla Bonewrought',
    desc: 'La familia completa de placas Crownforged.',
  },
  conquerors_set_nighttalon: {
    name: 'Atuendo de cuero Direfang',
    desc: 'La familia completa de cuero Nighttalon.',
  },
  conquerors_set_soulflame: {
    name: 'Vestiduras de Wraithfire',
    desc: 'La familia completa de tela Soulflame.',
  },
  conquerors_set_stormcallers: {
    name: 'Vestiduras de Galecall',
    desc: 'La familia completa de tela Stormcallers.',
  },
  professions_masterwork: {
    name: 'Galería de obras maestras',
    desc: 'Trofeos de por vida de las primeras obras maestras. Se queda vacía hasta la siguiente si el veterano es anterior a la galería (no se inventa historial de creación).',
  },
  professions_field_notes: {
    name: 'Apuntes de campo raros',
    desc: 'Hallazgos raros y emblemáticos de la naturaleza: vetas, duramen, flores a la luz de la luna y especímenes perfectos.',
  },
  professions_specimens: {
    name: 'Especímenes clave',
    desc: 'Especímenes impolutos de cadáveres, materiales de campo finos de máxima calidad y la pieza codiciada del pescador: un museo de artesano en miniatura.',
  },
  horizons_mounts: {
    name: 'Monturas',
    desc: 'Monturas del establo, riendas heroicas, épicas de las Brechas y sillas más raras. La propiedad sigue las riendas en vivo (bolsas y banco).',
  },
  horizons_weapon_skins: {
    name: 'Aspectos de arma',
    desc: 'Aspectos de arma de la Armería, comunes a toda la cuenta. Vacío sin conexión o sin cosméticos de cuenta; nunca es botín de personaje.',
  },
  horizons_titles: {
    name: 'Títulos',
    desc: 'Títulos obtenidos en el Libro de Gestas. Solo cosméticos: nunca poder, probabilidad de botín ni compensación por mala suerte.',
  },
  conquerors_the_rift: {
    name: 'La Brecha',
    desc: 'Botines emblemáticos de la Brecha cambiante, desde sus horrores errantes hasta los dos tesoros de la caza de rango S.',
  },
  conquerors_rares_of_the_realm: {
    name: 'Raros del reino',
    desc: 'Prueba de todos los raros con nombre abatidos por el reino.',
  },
  conquerors_spoils_of_the_realm: {
    name: 'Botines del reino',
    desc: 'Tesoros emblemáticos que portan los raros con nombre del reino.',
  },
  conquerors_warfare_gallery: {
    name: 'Galería de Guerra',
    desc: 'Los cinco equipos de batalla de Guerra, conseguidos pieza a pieza con honor.',
  },
  conquerors_warfare_armory: {
    name: 'Armería de Guerra',
    desc: 'Joyería y armas de Guerra compradas con honor ganado a pulso.',
  },
  horizons_vault_of_ages: {
    name: 'Cámara de las Eras',
    desc: 'Tesoros retirados de una época pasada. Estas reliquias ya no se pueden conseguir; la cámara honra a los veteranos que las conservan.',
  },
  horizons_riftbound: {
    name: 'Anillos de Brecha',
    desc: 'Los anillos de Brecha personales, acuñados para cada campeón del grupo que logra la primera conquista de una Brecha clasificada. Cada personaje solo puede tener el suyo.',
  },
};
