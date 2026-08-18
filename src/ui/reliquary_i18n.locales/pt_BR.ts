// Reliquary page name and description locale table for pt_BR
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
    name: 'A Cripta Vazia',
    desc: 'Espólios marcantes arrancados de Morthen e da Cripta Vazia.',
  },
  conquerors_hollow_crypt_heroic: {
    name: 'Heroico: A Cripta Vazia',
    desc: 'Épicos exclusivos do modo heroico de Morthen o Gravecaller.',
  },
  conquerors_sunken_bastion: {
    name: 'O Bastião Submerso',
    desc: 'Espólios raros e épicos de Olen e de Vael, o Fogbinder.',
  },
  conquerors_sunken_bastion_heroic: {
    name: 'Heroico: O Bastião Submerso',
    desc: 'Épicos exclusivos do modo heroico de Vael, o Fogbinder.',
  },
  conquerors_drowned_temple: {
    name: 'O Templo Afogado',
    desc: 'Espólios raros de Mãe-do-Coro Selthe e de Ysolei, Avatar da Lua Afogada.',
  },
  conquerors_drowned_temple_heroic: {
    name: 'Heroico: O Templo Afogado',
    desc: 'Épicos exclusivos do modo heroico de Ysolei.',
  },
  conquerors_gravewyrm_sanctum: {
    name: 'Santuário do Gravewyrm',
    desc: 'Espólios raros e épicos dos chefes do Santuário e de Korzul o Gravewyrm.',
  },
  conquerors_gravewyrm_sanctum_heroic: {
    name: 'Heroico: Santuário do Gravewyrm',
    desc: 'Épicos exclusivos do modo heroico de Korzul o Gravewyrm.',
  },
  conquerors_wildheart_basin: {
    name: 'A Bacia de Wildheart',
    desc: 'Armas marcantes de Zulgar e do Mestre de Feras Senhor das Presas.',
  },
  conquerors_wildheart_basin_heroic: {
    name: 'Heroico: A Bacia de Wildheart',
    desc: 'Épicos exclusivos do modo heroico de Zulgar, Voz da Bacia.',
  },
  conquerors_nythraxis: {
    name: 'Raide de Nythraxis',
    desc: 'Espólios épicos e lendários de Nythraxis, Flagelo de Thornpeak.',
  },
  conquerors_nythraxis_heroic: {
    name: 'Heroico: Raide de Nythraxis',
    desc: 'Armas de raide exclusivas do modo heroico de Nythraxis.',
  },
  conquerors_thunzharr: {
    name: 'Thunzharr, o Pico Desperto',
    desc: 'Espólios épicos pessoais do chefe mundial do Pico Desperto.',
  },
  conquerors_collapsed_reliquary: {
    name: 'O Relicário Desmoronado',
    desc: 'Raros marcantes do baú com fechadura do Relicário Desmoronado.',
  },
  conquerors_drowned_litany: {
    name: 'A Ladainha Afogada',
    desc: 'Espólios raros e épicos da Ladainha Afogada.',
  },
  conquerors_set_deathlord: {
    name: 'Traje de Batalha Barrowlord',
    desc: 'A família completa de placas Deathlord.',
  },
  conquerors_set_wyrmshadow: {
    name: 'Traje Nightfang',
    desc: 'A família completa de couro Wyrmshadow.',
  },
  conquerors_set_necromancers: {
    name: 'Vestes Mournweave',
    desc: 'A família completa de tecido Necromancers.',
  },
  conquerors_set_crownforged: {
    name: 'Traje de Batalha Bonewrought',
    desc: 'A família completa de placas Crownforged.',
  },
  conquerors_set_nighttalon: {
    name: 'Traje de Couro Direfang',
    desc: 'A família completa de couro Nighttalon.',
  },
  conquerors_set_soulflame: {
    name: 'Vestes Wraithfire',
    desc: 'A família completa de tecido Soulflame.',
  },
  conquerors_set_stormcallers: {
    name: 'Vestes Galecall',
    desc: 'A família completa de tecido Stormcallers.',
  },
  professions_masterwork: {
    name: 'Galeria de Obras-primas',
    desc: 'Troféus vitalícios das primeiras obras-primas. Fica vazia até a próxima se o veterano for anterior à galeria (nenhum histórico de criação inventado).',
  },
  professions_field_notes: {
    name: 'Notas de Campo Raras',
    desc: 'Achados raros e marcantes da natureza: veios, cerne, flores ao luar e espécimes perfeitos.',
  },
  professions_specimens: {
    name: 'Espécimes Essenciais',
    desc: 'Espécimes imaculados de carcaças, materiais de campo finos do mais alto grau e a presa cobiçada do pescador: um museu de artesão em miniatura.',
  },
  horizons_mounts: {
    name: 'Montarias',
    desc: 'Montarias do estábulo, rédeas heroicas, épicos das Fendas e selas mais raras. A posse segue as rédeas reais (bolsas e banco).',
  },
  horizons_weapon_skins: {
    name: 'Visuais de Arma',
    desc: 'Visuais de arma do Arsenal, válidos em toda a conta. Vazio offline ou sem cosméticos de conta; nunca é espólio de personagem.',
  },
  horizons_titles: {
    name: 'Títulos',
    desc: 'Títulos obtidos no Livro dos Feitos. Apenas cosméticos: nunca poder, chance de espólio ou compensação por azar.',
  },
  conquerors_the_rift: {
    name: 'A Fenda',
    desc: 'Espólios marcantes da Fenda mutável, dos seus horrores errantes aos dois tesouros da caça de grau S.',
  },
  conquerors_rares_of_the_realm: {
    name: 'Raros do Reino',
    desc: 'Prova de cada raro nomeado abatido por todo o reino.',
  },
  conquerors_spoils_of_the_realm: {
    name: 'Espólios do Reino',
    desc: 'Tesouros marcantes carregados pelos raros nomeados do reino.',
  },
  conquerors_warfare_gallery: {
    name: 'Galeria de Guerra',
    desc: 'Os cinco kits de batalha de Guerra, conquistados peça por peça com honra.',
  },
  conquerors_warfare_armory: {
    name: 'Arsenal de Guerra',
    desc: 'Joias e armas de Guerra compradas com honra suada.',
  },
  horizons_vault_of_ages: {
    name: 'Câmara das Eras',
    desc: 'Tesouros retirados de uma era passada. Estas relíquias não podem mais ser conquistadas; a câmara honra os veteranos que as guardam.',
  },
  horizons_riftbound: {
    name: 'Anéis de Fenda',
    desc: 'Os anéis de Fenda pessoais, cunhados para cada campeão do grupo que vence a primeira conquista de uma Fenda classificada. Cada personagem só pode ter o seu.',
  },
};
