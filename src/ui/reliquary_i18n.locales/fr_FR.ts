// Reliquary page name and description locale table for fr_FR
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
    name: 'La Crypte creuse',
    desc: 'Butins emblématiques arrachés à Morthen et à la Crypte creuse.',
  },
  conquerors_hollow_crypt_heroic: {
    name: 'Héroïque : la Crypte creuse',
    desc: 'Épiques exclusifs au mode héroïque de Morthen le Gravecaller.',
  },
  conquerors_sunken_bastion: {
    name: 'Le Bastion englouti',
    desc: "Butins rares et épiques d'Olen et de Vael le Fogbinder.",
  },
  conquerors_sunken_bastion_heroic: {
    name: 'Héroïque : le Bastion englouti',
    desc: 'Épiques exclusifs au mode héroïque de Vael le Fogbinder.',
  },
  conquerors_drowned_temple: {
    name: 'Le Temple noyé',
    desc: "Butins rares de Selthe, mère de chœur, et d'Ysolei, avatar de la Lune noyée.",
  },
  conquerors_drowned_temple_heroic: {
    name: 'Héroïque : le Temple noyé',
    desc: "Épiques exclusifs au mode héroïque d'Ysolei.",
  },
  conquerors_gravewyrm_sanctum: {
    name: 'Sanctuaire du Gravewyrm',
    desc: 'Butins rares et épiques des boss du Sanctuaire et de Korzul le Gravewyrm.',
  },
  conquerors_gravewyrm_sanctum_heroic: {
    name: 'Héroïque : le Sanctuaire du Gravewyrm',
    desc: 'Épiques exclusifs au mode héroïque de Korzul le Gravewyrm.',
  },
  conquerors_wildheart_basin: {
    name: 'Le Bassin du Cœur Sauvage',
    desc: 'Armes emblématiques de Zulgar et du Maître des bêtes, Seigneur des crocs.',
  },
  conquerors_wildheart_basin_heroic: {
    name: 'Héroïque : le Bassin du Cœur Sauvage',
    desc: 'Épiques exclusifs au mode héroïque de Zulgar, Voix du Bassin.',
  },
  conquerors_nythraxis: {
    name: 'Raid de Nythraxis',
    desc: 'Butins épiques et légendaires de Nythraxis, Fléau de Thornpeak.',
  },
  conquerors_nythraxis_heroic: {
    name: 'Héroïque : Raid de Nythraxis',
    desc: 'Armes de raid exclusives au mode héroïque de Nythraxis.',
  },
  conquerors_thunzharr: {
    name: 'Thunzharr, le Pic Éveillé',
    desc: 'Butins épiques personnels du boss de monde du Pic Éveillé.',
  },
  conquerors_collapsed_reliquary: {
    name: 'Le Reliquaire effondré',
    desc: 'Objets rares emblématiques du coffre à crocheter du Reliquaire effondré.',
  },
  conquerors_drowned_litany: {
    name: 'La Litanie noyée',
    desc: 'Butins rares et épiques de la Litanie noyée.',
  },
  conquerors_set_deathlord: {
    name: 'Tenue de guerre de Barrowlord',
    desc: 'La famille complète de plaques Deathlord.',
  },
  conquerors_set_wyrmshadow: {
    name: 'Vêtements de Nightfang',
    desc: 'La famille complète de cuir Wyrmshadow.',
  },
  conquerors_set_necromancers: {
    name: 'Parure de Mournweave',
    desc: 'La famille complète de tissu Necromancers.',
  },
  conquerors_set_crownforged: {
    name: "Tenue d'apparat Bonewrought",
    desc: 'La famille complète de plaques Crownforged.',
  },
  conquerors_set_nighttalon: {
    name: 'Peau de Direfang',
    desc: 'La famille complète de cuir Nighttalon.',
  },
  conquerors_set_soulflame: {
    name: "Tenue d'apparat Wraithfire",
    desc: 'La famille complète de tissu Soulflame.',
  },
  conquerors_set_stormcallers: {
    name: 'Vêtements de Galecall',
    desc: 'La famille complète de tissu Stormcallers.',
  },
  professions_masterwork: {
    name: "Galerie des chefs-d'œuvre",
    desc: "Trophées à vie des premiers chefs-d'œuvre. Reste vide jusqu'au prochain si le vétéran est antérieur à la galerie (aucun historique d'artisanat inventé).",
  },
  professions_field_notes: {
    name: 'Notes de terrain rares',
    desc: 'Trouvailles rares et emblématiques de la nature : filons, bois de cœur, floraisons sous la lune et spécimens parfaits.',
  },
  professions_specimens: {
    name: 'Spécimens clés',
    desc: "Spécimens immaculés issus de dépouilles, matériaux de terrain fins du plus haut grade et la prise convoitée du pêcheur : un musée d'artisan en miniature.",
  },
  horizons_mounts: {
    name: 'Montures',
    desc: "Montures de l'écurie, rênes héroïques, épiques des Failles et selles plus rares. La possession suit les rênes réelles (sacs et banque).",
  },
  horizons_weapon_skins: {
    name: "Apparences d'arme",
    desc: "Apparences d'arme de l'Armurerie, communes à tout le compte. Vide hors ligne ou sans cosmétiques de compte ; jamais du butin de personnage.",
  },
  horizons_titles: {
    name: 'Titres',
    desc: 'Titres obtenus dans le Livre des hauts faits. Purement cosmétiques : jamais de puissance, de taux de butin ni de compensation de malchance.',
  },
  conquerors_the_rift: {
    name: 'La Faille',
    desc: 'Butins emblématiques de la Faille changeante, de ses horreurs errantes aux deux trésors de la chasse de rang S.',
  },
  conquerors_rares_of_the_realm: {
    name: 'Rares du royaume',
    desc: 'La preuve de chaque rare nommé abattu à travers le royaume.',
  },
  conquerors_spoils_of_the_realm: {
    name: 'Butins du royaume',
    desc: 'Trésors emblématiques portés par les rares nommés du royaume.',
  },
  conquerors_warfare_gallery: {
    name: 'Galerie de Guerre',
    desc: "Les cinq tenues de combat de Guerre, gagnées pièce par pièce avec de l'honneur.",
  },
  conquerors_warfare_armory: {
    name: 'Armurerie de Guerre',
    desc: 'Bijoux et armes de Guerre achetés avec un honneur durement gagné.',
  },
  horizons_vault_of_ages: {
    name: 'Chambre forte des âges',
    desc: "Trésors retirés d'une époque révolue. Ces reliques ne peuvent plus être gagnées ; la chambre forte rend hommage aux vétérans qui les conservent.",
  },
  horizons_riftbound: {
    name: 'Anneaux de Faille',
    desc: "Les anneaux de Faille personnels, frappés pour chaque champion du groupe qui remporte la première conquête d'une Faille classée. Un personnage ne peut jamais détenir que le sien.",
  },
};
