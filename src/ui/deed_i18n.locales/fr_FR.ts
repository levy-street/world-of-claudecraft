// Deed name / desc / title locale table for fr_FR (data-as-code, size-exempt).
// One per-base-locale chunk behind DEED_LOCALE_LOADERS in deed_i18n.ts, so a
// visitor downloads only their own locale's deed strings. Split verbatim from
// the former deed_i18n.newlocales.ts single chunk; values carry no em or en
// dashes (repo copy rule). English (en / en_CA) resolves to the authored
// source before this table is consulted.
import type { DeedLocaleTable } from '../deed_i18n';

export const table: DeedLocaleTable = {
  prog_first_steps: {
    name: 'Premiers pas',
    desc: 'Atteignez le niveau 2 et faites votre premier pas sur une longue route.',
  },
  prog_finding_your_feet: {
    name: 'Prendre ses marques',
    desc: 'Atteignez le niveau 5 ; les terres sauvages semblent déjà un peu moins vastes.',
  },
  prog_double_digits: {
    name: 'Deux chiffres',
    desc: 'Atteignez le niveau 10 et débloquez vos talents.',
  },
  prog_the_long_middle: { name: 'Au milieu du gué', desc: 'Atteignez le niveau 15.' },
  prog_level_cap: {
    name: 'La vue depuis le sommet',
    desc: 'Atteignez le niveau 20, le niveau maximum.',
  },
  prog_well_rested: {
    name: 'Bien reposé',
    desc: "Installez-vous dans une auberge jusqu'à avoir gagné de l'expérience de repos.",
  },
  prog_talented: { name: 'Un point bien placé', desc: 'Dépensez votre premier point de talent.' },
  prog_specialized: {
    name: "Déclaration d'intention",
    desc: 'Choisissez une spécialisation et apprenez sa technique emblématique.',
  },
  prog_deep_roots: {
    name: 'Racines profondes',
    desc: 'Dépensez un point de talent dans un talent de la dernière rangée.',
  },
  prog_full_build: {
    name: 'Les onze au complet',
    desc: 'Dépensez vos onze points de talent dans un seul et même build.',
  },
  prog_veteran: {
    name: 'Vétéran',
    desc: "Gagnez 250 000 points d'expérience cumulés.",
    title: 'Vétéran',
  },
  prog_champion: {
    name: 'Champion',
    desc: "Gagnez 500 000 points d'expérience cumulés.",
    title: 'Champion',
  },
  prog_paragon: {
    name: 'Parangon',
    desc: "Gagnez 1 000 000 points d'expérience cumulés.",
    title: 'Parangon',
  },
  prog_mythic: {
    name: 'Mythique',
    desc: "Gagnez 2 500 000 points d'expérience cumulés.",
    title: 'Mythique',
  },
  prog_eternal: {
    name: 'Éternel',
    desc: "Gagnez 5 000 000 points d'expérience cumulés.",
    title: 'Éternel',
  },
  prog_prestige: {
    name: 'Tout recommencer',
    desc: 'Atteignez le niveau maximum, remplissez la barre une fois de plus et réclamez le rang de prestige 1.',
  },
  prog_prestige_5: { name: 'Les vieilles habitudes', desc: 'Atteignez le rang de prestige 5.' },
  prog_prestige_10: { name: 'Mouvement perpétuel', desc: 'Atteignez le rang de prestige 10.' },
  prog_first_harvest: {
    name: 'Les fruits de la terre',
    desc: 'Exploitez votre premier point de récolte.',
  },
  prog_mining_100: {
    name: 'Le minerai dans le sang',
    desc: 'Atteignez 100 points de maîtrise en Minage.',
  },
  prog_logging_100: {
    name: 'Fendeur de bois de cœur',
    desc: 'Atteignez 100 points de maîtrise en Bûcheronnage.',
  },
  prog_herbalism_100: {
    name: 'Maître des prés',
    desc: 'Atteignez 100 points de maîtrise en Herboristerie.',
  },
  prog_master_gatherer: {
    name: 'Maître récolteur',
    desc: 'Atteignez 100 points de maîtrise en Minage, en Bûcheronnage et en Herboristerie.',
  },
  prog_first_craft: { name: 'Fait main', desc: 'Réussissez votre première fabrication.' },
  prog_craft_specialist: {
    name: 'Secrets de métier',
    desc: "Atteignez 75 points de compétence dans un métier d'artisanat et débloquez ses avantages de spécialisation.",
  },
  prog_around_the_ring: {
    name: 'Le tour du cercle',
    desc: "Atteignez 25 points de compétence dans cinq métiers d'artisanat différents.",
  },
  cmb_first_blood: { name: 'Premier sang', desc: 'Vainquez votre premier ennemi.' },
  cmb_slayer: { name: 'Pourfendeur', desc: 'Vainquez 1 000 ennemis.' },
  cmb_legion_of_one: { name: 'Une légion à soi seul', desc: 'Vainquez 10 000 ennemis.' },
  cmb_heavy_hitter: { name: 'Cogneur', desc: 'Infligez 500 000 points de dégâts au total.' },
  cmb_critical_eye: { name: 'Œil critique', desc: 'Portez 500 coups critiques.' },
  cmb_giantslayer: {
    name: 'Tueur de géants',
    desc: "Portez le coup fatal à un ennemi d'au moins cinq niveaux au-dessus du vôtre.",
  },
  cmb_first_fall: {
    name: 'On se relève',
    desc: 'Mourez pour la première fois ; cela arrive même aux meilleurs.',
  },
  dgn_hollow_crypt: {
    name: 'Brise-crypte',
    desc: 'Vainquez Morthen le Gravecaller dans la Crypte creuse.',
  },
  dgn_sunken_bastion: {
    name: 'Le Fogbinder délié',
    desc: 'Vainquez Vael le Fogbinder dans le Bastion englouti.',
  },
  dgn_drowned_temple: {
    name: 'Noyer la Lune',
    desc: 'Vainquez Ysolei, avatar de la Lune noyée, dans le Temple noyé.',
  },
  dgn_gravewyrm_sanctum: {
    name: 'Le wyrm des profondeurs',
    desc: 'Vainquez Korzul le Gravewyrm dans le Sanctuaire du Gravewyrm.',
  },
  dgn_hollow_crypt_heroic: {
    name: 'Héroïque : la Crypte creuse',
    desc: 'Vainquez Morthen le Gravecaller dans la Crypte creuse en difficulté héroïque.',
  },
  dgn_sunken_bastion_heroic: {
    name: 'Héroïque : le Bastion englouti',
    desc: 'Vainquez Vael le Fogbinder dans le Bastion englouti en difficulté héroïque.',
  },
  dgn_drowned_temple_heroic: {
    name: 'Héroïque : le Temple noyé',
    desc: 'Vainquez Ysolei, avatar de la Lune noyée, dans le Temple noyé en difficulté héroïque.',
  },
  dgn_gravewyrm_sanctum_heroic: {
    name: 'Héroïque : le Sanctuaire du Gravewyrm',
    desc: 'Vainquez Korzul le Gravewyrm dans le Sanctuaire du Gravewyrm en difficulté héroïque.',
  },
  dgn_nythraxis: {
    name: "Le Fléau n'est plus",
    desc: 'Vainquez Nythraxis, Fléau de Thornpeak, au-delà de la porte royale scellée.',
  },
  dgn_nythraxis_heroic: {
    name: "Héroïque : le Fléau n'est plus",
    desc: 'Vainquez Nythraxis, Fléau de Thornpeak, en difficulté héroïque.',
  },
  dgn_thornpeak_rounds: {
    name: 'La grande tournée',
    desc: 'Terminez la Crypte creuse, le Bastion englouti, le Temple noyé et le Sanctuaire du Gravewyrm.',
  },
  dgn_deepward: {
    name: 'Gardien des profondeurs',
    desc: 'Triomphez de chaque donjon, du raid et des deux plongées en difficulté héroïque.',
  },
  dgn_mark_circuit: {
    name: 'Le grand circuit',
    desc: 'Gagnez des Marques héroïques dans les quatre donjons héroïques en une seule journée.',
  },
  dgn_boss_clears_50: {
    name: 'Cinquante portes plus bas',
    desc: 'Vainquez 50 boss de fin de donjon.',
  },
  dgn_morthen_flawless: {
    name: 'Sans tomber sur un os',
    desc: "Vainquez Morthen le Gravecaller en difficulté héroïque sans qu'aucun membre du groupe ne meure.",
  },
  dgn_morthen_trio: {
    name: 'Trois contre la tombe',
    desc: 'Vainquez Morthen le Gravecaller à trois joueurs ou moins.',
  },
  dgn_olen_arc: {
    name: 'Esquiver la faucheuse',
    desc: "Vainquez le chevalier-commandant Olen sans que son Arc faucheur ne touche personne d'autre que sa cible du moment.",
  },
  dgn_vael_thralls: {
    name: 'Serviteur de personne',
    desc: "Vainquez Vael le Fogbinder alors que chaque Serviteur noyé qu'il appelle a déjà été abattu.",
  },
  dgn_ysolei_moonspawn: {
    name: "Jusqu'à la dernière engeance",
    desc: "Vainquez Ysolei alors que chaque Engeance de lune qu'elle appelle a déjà été abattue.",
  },
  dgn_ysolei_flawless: {
    name: 'Les yeux secs',
    desc: "Vainquez Ysolei, avatar de la Lune noyée, en difficulté héroïque sans qu'aucun membre du groupe ne meure.",
  },
  dgn_velkhar_bonewalkers: {
    name: 'Restez enterrés',
    desc: 'Vainquez le grand nécromancien Velkhar en ayant détruit chaque Marche-os relevé avant que Velkhar ne tombe.',
  },
  dgn_korzul_flawless: {
    name: 'Terrasse-wyrm',
    desc: "Vainquez Korzul le Gravewyrm en difficulté héroïque sans qu'aucun membre du groupe ne meure.",
    title: 'Terrasse-wyrm',
  },
  dgn_sanctum_speed: {
    name: 'Sprint du Sanctuaire',
    desc: 'Vainquez Korzul le Gravewyrm dans les 15 minutes suivant la prise du Sanctuaire du Gravewyrm par votre groupe.',
  },
  dgn_nythraxis_gravebreaker: {
    name: 'Ne plier devant aucun roi',
    desc: "Vainquez Nythraxis sans que Brise-tombe ne frappe personne d'autre que sa cible du moment.",
  },
  dgn_nythraxis_wardens: {
    name: 'Gardiens des pierres de garde',
    desc: "Vainquez Nythraxis en brisant chaque Rage immortelle avant qu'elle ne frappe.",
  },
  dgn_nythraxis_deathless: {
    name: "Nul n'est plus immortel",
    desc: "Vainquez Nythraxis, Fléau de Thornpeak, en difficulté héroïque sans qu'un seul membre du raid ne meure.",
    title: "l'Immortel",
  },
  cmb_thunzharr: {
    name: 'La montagne est tombée',
    desc: 'Terrassez Thunzharr, le Pic Éveillé, à Stormcrag.',
  },
  cmb_thunzharr_unbroken: {
    name: 'Brise-cime',
    desc: "Terrassez Thunzharr, le Pic Éveillé, sans mourir, de votre premier coup jusqu'à son dernier souffle.",
    title: 'Brise-cime',
  },
  cmb_thunzharr_ten: {
    name: "L'habitude des montagnes",
    desc: 'Terrassez Thunzharr, le Pic Éveillé, dix fois.',
  },
  dlv_reliquary: { name: 'Coureur de reliquaire', desc: 'Nettoyer le Reliquaire effondré.' },
  dlv_reliquary_heroic: {
    name: 'Héroïque : Le Reliquaire effondré',
    desc: 'Nettoyer le Reliquaire effondré au palier héroïque.',
  },
  dlv_litany: { name: 'Faire taire la Litanie', desc: 'Nettoyer la Litanie noyée.' },
  dlv_litany_heroic: {
    name: 'Héroïque : La Litanie noyée',
    desc: 'Nettoyer la Litanie noyée au palier héroïque.',
  },
  dlv_lore_journal: {
    name: 'Marginalia',
    desc: 'Débloquer les cinq entrées du journal de plongée.',
  },
  dlv_companion_max: {
    name: 'Une amie des profondeurs',
    desc: 'Hisser une compagne de plongée à son rang le plus élevé.',
  },
  dlv_companions_both: {
    name: 'Deux lanternes allumées',
    desc: "Hisser les deux compagnes de plongée, l'Acolyte Tessa et Edda Reedhand, à leur rang le plus élevé.",
  },
  dlv_clears_50: { name: 'Cinquante brasses', desc: 'Terminer 50 plongées.' },
  dlv_solo_heroic: {
    name: "Deux, c'est déjà trop",
    desc: 'Nettoyer une plongée au palier héroïque sans aucun autre joueur : seulement vous et votre compagne.',
  },
  dlv_tumbler_premium: {
    name: 'La Voie des goupilles, maîtrisée',
    desc: 'Ouvrir un coffre gardé du reliquaire à la mise la plus haute, sans faute, en un seul et unique essai.',
  },
  dlv_rite_flawless: {
    name: 'Au mot près',
    desc: 'Accomplir le Rite du Reliquaire noyé sans la moindre erreur.',
  },
  dlv_varric_ringers: {
    name: 'Les cloches se taisent',
    desc: "Vaincre le Diacre Varric alors que chaque Sonneur funéraire qu'il relève a déjà été abattu.",
  },
  dlv_nhalia_bells: {
    name: 'Étouffe-cloches',
    desc: "Vaincre Sœur Nhalia, le Cantique noyé, sans qu'aucun membre du groupe ne soit frappé par une Cloche du glas.",
    title: 'Étouffe-cloches',
  },
  chr_vale_chapter_i: {
    name: 'Chronique du Val, chapitre I',
    desc: "Terminer le premier chapitre de la chronique de Saul : les premières commissions d'Eastbrook, les contours du Val et un premier goût de ses métiers.",
  },
  chr_vale_chapter_ii: {
    name: 'Chronique du Val, chapitre II',
    desc: 'Terminer le deuxième chapitre de la chronique de Saul : bandits, murlocs et vermine de la mine abattus, un match disputé au Pré de la Truie et le Reliquaire bravé.',
  },
  chr_vale_chapter_iii: {
    name: 'Chronique du Val',
    desc: "Mener l'histoire du Val à son terme : le Gravecaller démasqué, la Crypte creuse purifiée et toutes les terreurs nommées du Val terrassées.",
    title: 'du Val',
  },
  chr_vale_gatherer: {
    name: 'Vivre de la terre',
    desc: "Récolter un filon de minerai, un bosquet de bois et un carré d'herbes dans le Val d'Eastbrook.",
  },
  chr_vale_first_cast: {
    name: 'Quelque chose dans le Lac Miroir',
    desc: "Pêcher un poisson dans les eaux du Val d'Eastbrook.",
  },
  chr_vale_packbreaker: {
    name: 'Brise-meute',
    desc: 'Tuer 3 Loups des bois en moins de 10 secondes.',
  },
  chr_vale_cup_debut: {
    name: 'Prétendant au Seau de cuivre',
    desc: "Entrer sur le terrain et toucher le ballon lors d'un match de Coupe du Val au Pré de la Truie.",
  },
  chr_vale_rares: {
    name: 'Les terreurs du Val',
    desc: "Tuer les cinq terreurs nommées du Val d'Eastbrook : Vieux Greyjaw, Mogger, Grix le Roi des tunnels, Capitaine Verlan et Maldrec le Lie-spectres.",
  },
  chr_marsh_chapter_i: {
    name: 'Chronique du Marais, chapitre I',
    desc: "Terminer le premier chapitre de la chronique d'Osric Fenn : répondre au rassemblement de Fenbridge, sécuriser la chaussée et apprendre les contours du marais.",
  },
  chr_marsh_chapter_ii: {
    name: 'Chronique du Marais, chapitre II',
    desc: "Terminer le deuxième chapitre de la chronique d'Osric Fenn : les veuves délogées par les flammes, les noyés rendus au repos, le Capitaine brochet remonté et la Litanie bravée.",
  },
  chr_marsh_chapter_iii: {
    name: 'Chronique de Mirefen',
    desc: "Mener l'histoire du marais à son terme : le camp du culte démantelé, le Fogbinder réduit au silence dans le Bastion englouti et toutes les terreurs nommées de la brume terrassées.",
    title: 'de Mirefen',
  },
  chr_marsh_gatherer: {
    name: 'Cueillette à Fenbridge',
    desc: "Récolter un filon de minerai, un bosquet de bois et un carré d'herbes dans le Marais de Mirefen.",
  },
  chr_marsh_unburst: {
    name: 'Ne restez pas dans les spores',
    desc: "Tuer 8 Boursouflés du bourbier sans être pris dans l'explosion de leurs Spores caustiques.",
  },
  chr_marsh_hush_the_mending: {
    name: 'Faire taire les soins',
    desc: "Dans le campement Gravecaller, tuer un Soigneur Gravecaller avant le moindre des cultistes qu'il soigne.",
  },
  chr_marsh_rares: {
    name: 'Des noms dans la brume',
    desc: "Tuer les trois terreurs nommées du Marais de Mirefen : Mirejaw l'Affamé, Sloomtooth le Noyé et Sœur Nhalia.",
  },
  chr_peaks_chapter_i: {
    name: 'Chronique des Hauteurs, chapitre I',
    desc: 'Terminer le premier chapitre de la chronique de Zenzie : dégager la route de la crête, vider les terriers et connaître chaque sentier que garde Highwatch.',
  },
  chr_peaks_chapter_ii: {
    name: 'Chronique des Hauteurs, chapitre II',
    desc: "Terminer le deuxième chapitre de la chronique de Zenzie : briser le camp de guerre de Drogmar, lire la tempête qui s'éveille et se tenir là où luit le Glimmermere.",
  },
  chr_peaks_chapter_iii: {
    name: 'Chronique de Thornpeak',
    desc: "Mener l'histoire de la montagne à son terme : le Culte du Wyrm brisé, le Sanctuaire réduit au silence, le Pic Éveillé abattu et toutes les terreurs nommées des falaises terrassées.",
    title: 'de Thornpeak',
  },
  chr_peaks_sparring: {
    name: 'Exercices de rempart',
    desc: "Infliger 1 000 points de dégâts au total au Mannequin d'entraînement qui surplombe Highwatch.",
  },
  chr_peaks_glimmer_cast: {
    name: 'Eau froide, lumière plus froide encore',
    desc: 'Pêcher un poisson dans le Glimmermere.',
  },
  chr_peaks_moongate: {
    name: 'Par la porte froide',
    desc: 'Franchir la porte de lune sur la rive du Glimmermere.',
  },
  chr_peaks_waking_witness: {
    name: 'La montagne qui marche',
    desc: "Poser les yeux sur Thunzharr, le Pic Éveillé, tandis qu'il arpente la montagne.",
  },
  chr_peaks_rares: {
    name: 'Des noms gravés dans le roc',
    desc: 'Tuer les quatre terreurs nommées des Hauteurs de Thornpeak : le Contremaître Veinefer, Brutok Brise-crânes, Voskar Aile-de-braise et le Seigneur de moelle Varkas.',
  },
  col_discovery_25: {
    name: 'Ramasse-tout',
    desc: "Découvrir 25 objets différents (un objet compte la première fois qu'il entre en votre possession).",
  },
  col_discovery_75: { name: 'Pie voleuse', desc: 'Découvrir 75 objets différents.' },
  col_discovery_150: {
    name: 'Cabinet de curiosités',
    desc: 'Découvrir 150 objets différents.',
    title: 'le Conservateur',
  },
  col_discovery_250: { name: 'Le Grand Catalogue', desc: 'Découvrir 250 objets différents.' },
  col_first_rare: {
    name: 'Quelque chose de bleu',
    desc: 'Obtenir votre premier objet de qualité rare.',
  },
  col_first_epic: {
    name: 'Né dans la pourpre',
    desc: 'Obtenir votre premier objet de qualité épique.',
  },
  col_first_legendary: {
    name: "L'orange vous va si bien",
    desc: 'Obtenir votre premier objet de qualité légendaire.',
  },
  col_set_vale_arcanist: {
    name: "Regalia d'arcaniste du Val",
    desc: "Découvrir chaque pièce du Regalia d'arcaniste du Val.",
  },
  col_set_boundstone_vanguard: {
    name: 'Avant-garde de pierre-liée',
    desc: "Découvrir chaque pièce de l'Avant-garde de pierre-liée.",
  },
  col_set_greyjaw_stalker: {
    name: 'Attirail du traqueur de Greyjaw',
    desc: "Découvrir chaque pièce de l'Attirail du traqueur de Greyjaw.",
  },
  col_set_deathlord: {
    name: 'Tenue de combat de Barrowlord',
    desc: 'Découvrir chaque pièce de la Tenue de combat de Barrowlord.',
  },
  col_set_wyrmshadow: {
    name: 'Habits Nightfang',
    desc: 'Découvrir chaque pièce des Habits Nightfang.',
  },
  col_set_necromancers: {
    name: 'Atours de Mournweave',
    desc: 'Découvrir chaque pièce des Atours de Mournweave.',
  },
  col_set_crownforged: {
    name: 'Regalia Bonewrought',
    desc: 'Découvrir chaque pièce du Regalia Bonewrought.',
  },
  col_set_nighttalon: {
    name: 'Pelage de Direfang',
    desc: 'Découvrir chaque pièce du Pelage de Direfang.',
  },
  col_set_soulflame: {
    name: 'Regalia Wraithfire',
    desc: 'Découvrir chaque pièce du Regalia Wraithfire.',
  },
  col_set_stormcallers: {
    name: 'Habits de Galecall',
    desc: 'Découvrir chaque pièce des Habits de Galecall.',
  },
  col_seven_regalia: {
    name: 'La Garde-robe aux sept parures',
    desc: "Découvrir chaque pièce des sept familles d'armures épiques.",
    title: 'le Resplendissant',
  },
  col_true_colors: {
    name: 'Sous ses vraies couleurs',
    desc: 'Entrer en lice avec une apparence autre que celle par défaut de votre classe.',
  },
  col_all_slots: {
    name: 'Sur son trente-et-onze',
    desc: "Porter un objet dans les onze emplacements d'équipement en même temps.",
  },
  col_quartermaster_buyout: {
    name: 'Client privilégié',
    desc: "Découvrir les dix pièces du stock de l'Intendant Vex.",
  },
  col_glimmerfin: {
    name: "Une lueur d'espoir",
    desc: 'Pêcher un Koï aux nageoires scintillantes.',
  },
  col_full_creel: {
    name: 'Bourriche pleine',
    desc: 'Découvrir les six prises communes des eaux du Val, du Marais et des Hauteurs.',
  },
  col_junk_drawer: {
    name: 'Le Tiroir à camelote',
    desc: 'Découvrir 10 objets différents de qualité médiocre.',
  },
  pvp_arena_first_match: {
    name: 'Du sable dans les bottes',
    desc: "Disputez un match classé au Colisée des Cendres, dans l'une ou l'autre catégorie.",
  },
  pvp_arena_first_win: {
    name: 'La foule rugit',
    desc: "Remportez un match d'arène classé, dans l'une ou l'autre catégorie.",
  },
  pvp_arena_1v1_1600: {
    name: 'Prétendant du Colisée',
    desc: "Atteignez une cote de 1600 dans la catégorie d'arène 1v1.",
  },
  pvp_arena_1v1_1750: {
    name: 'Rival du Colisée',
    desc: "Atteignez une cote de 1750 dans la catégorie d'arène 1v1.",
  },
  pvp_arena_1v1_1900: {
    name: 'Gladiateur',
    desc: "Atteignez une cote de 1900 dans la catégorie d'arène 1v1.",
    title: 'Gladiateur',
  },
  pvp_arena_2v2_1600: {
    name: 'Forts à deux',
    desc: "Atteignez une cote de 1600 dans la catégorie d'arène 2v2.",
  },
  pvp_arena_2v2_1750: {
    name: 'Duo redoutable',
    desc: "Atteignez une cote de 1750 dans la catégorie d'arène 2v2.",
  },
  pvp_arena_2v2_1900: {
    name: 'Entente parfaite',
    desc: "Atteignez une cote de 1900 dans la catégorie d'arène 2v2.",
  },
  pvp_duel_first_win: { name: 'On règle ça dehors', desc: 'Remportez un duel.' },
  pvp_duel_grace: {
    name: "Une leçon d'humilité",
    desc: 'Perdez un duel avec votre dignité à peu près intacte.',
  },
  pvp_vcup_first_match: {
    name: 'Crampons sur le pré',
    desc: "Disputez un match de la Coupe du Val jusqu'à son terme au Pré de la Truie, victoire ou défaite.",
  },
  pvp_vcup_first_win: {
    name: 'Premier trophée',
    desc: 'Remportez un match classé de la Coupe du Val.',
  },
  pvp_vcup_wins_10: {
    name: 'Briscard de la balle au sanglier',
    desc: 'Remportez 10 matchs classés de la Coupe du Val.',
  },
  pvp_vcup_wins_25: {
    name: 'Légende de la balle au sanglier',
    desc: 'Remportez 25 matchs classés de la Coupe du Val.',
    title: 'Légende de la balle au sanglier',
  },
  pvp_vcup_first_goal: {
    name: 'Compteur débloqué',
    desc: "Marquez un but lors d'un match classé de la Coupe du Val.",
  },
  pvp_vcup_hat_trick: {
    name: 'Coup du chapeau',
    desc: 'Marquez trois buts dans un même match classé de la Coupe du Val, en catégorie 3v3 ou plus.',
  },
  pvp_vcup_golden_goal: {
    name: 'Instant en or',
    desc: "Marquez le but en or qui décide d'un match classé de la Coupe du Val.",
  },
  pvp_vcup_first_save: {
    name: 'Des mains sûres',
    desc: "Réalisez un arrêt en tant que gardien lors d'un match classé de la Coupe du Val.",
  },
  pvp_vcup_clean_sheet: {
    name: 'Rien ne passe',
    desc: 'Remportez un match classé de la Coupe du Val en tant que gardien sans encaisser de but.',
  },
  pvp_vcup_guild_win: {
    name: 'Pour la bannière',
    desc: 'Remportez un match classé de la Coupe du Val disputé sous la bannière de votre guilde.',
  },
  pvp_fiesta_first_bout: {
    name: "Taper l'incruste",
    desc: "Disputez un combat de Fiesta 2v2 jusqu'au bout, victoire ou défaite.",
  },
  pvp_fiesta_first_win: { name: "L'âme de la Fiesta", desc: 'Remportez un combat de Fiesta 2v2.' },
  pvp_fiesta_double: {
    name: 'Coup double',
    desc: "Réussissez deux mises au tapis en Fiesta en l'espace de quatre secondes.",
  },
  pvp_fiesta_shutdown: {
    name: 'Trouble-fête',
    desc: 'Mettez au tapis un adversaire de Fiesta en pleine série de trois ou plus.',
  },
  pvp_fiesta_full_build: {
    name: 'Sur son trente-et-un',
    desc: 'Remportez un combat de Fiesta avec une amélioration verrouillée à chacune des trois vagues.',
  },
  pvp_fiesta_powerups: {
    name: 'Un de chaque',
    desc: 'Ramassez au moins une fois chacun des quatre bonus du ring : Démon de vitesse, Colosse, Bottes lunaires et Berserker.',
  },
  pvp_fiesta_five_kills: {
    name: 'Toute la fête sur le dos',
    desc: 'Réussissez cinq mises au tapis en un seul combat de Fiesta.',
  },
  soc_first_party: {
    name: "L'union fait la force",
    desc: 'Formez un groupe avec un autre joueur.',
  },
  soc_full_house: {
    name: 'Cinq sur cinq',
    desc: 'Terminez un donjon avec un groupe complet de cinq joueurs.',
  },
  soc_guild_joined: { name: 'Sous une même bannière', desc: "Devenez membre d'une guilde." },
  soc_guild_founded: { name: 'La plume du fondateur', desc: 'Fondez votre propre guilde.' },
  soc_first_trade: {
    name: 'Échange de bons procédés',
    desc: 'Menez à bien un échange avec un autre joueur.',
  },
  soc_first_sale: {
    name: 'Boutique ouverte',
    desc: "Encaissez l'argent de votre première vente au Marché mondial.",
  },
  soc_steady_custom: {
    name: 'Clientèle fidèle',
    desc: "Encaissez un total cumulé de 10 pièces d'or sur vos ventes au Marché mondial.",
  },
  soc_market_magnate: {
    name: 'Magnat du marché',
    desc: "Encaissez un total cumulé de 100 pièces d'or sur vos ventes au Marché mondial.",
    title: 'Magnat',
  },
  soc_by_ravens_wing: {
    name: "À tire-d'aile de corbeau",
    desc: "Envoyez une lettre de la Poste aux corbeaux contenant de l'argent ou un colis.",
  },
  soc_room_for_more: {
    name: 'Encore de la place',
    desc: 'Achetez votre première extension de banque.',
  },
  soc_gilded_strongbox: {
    name: 'Le Coffre doré',
    desc: 'Achetez toutes les extensions de banque que les trésoriers voudront bien vous vendre.',
  },
  soc_meet_bursar: {
    name: 'En Fernando nous croyons',
    desc: 'Présentez vos respects au trésorier Fernando, gardien du Coffre doré à Eastbrook.',
  },
  soc_pocket_money: {
    name: 'Argent de poche',
    desc: "Ramassez un total cumulé de 1 pièce d'or en espèces.",
  },
  soc_heavy_purse: {
    name: 'Bourse bien garnie',
    desc: "Ramassez un total cumulé de 10 pièces d'or en espèces.",
  },
  soc_wyrms_hoard: {
    name: 'Un trésor de wyrm',
    desc: "Ramassez un total cumulé de 100 pièces d'or en espèces.",
  },
  soc_civic_duty: {
    name: 'Devoir civique',
    desc: 'Attribuez votre premier point de priorité de la ville.',
  },
  exp_long_road_north: {
    name: 'La longue route du nord',
    desc: 'Visitez les trois bourgs principaux : Eastbrook, Fenbridge et Highwatch.',
  },
  exp_vale_wayfarer: {
    name: 'Voyageur du Val',
    desc: "Visitez les onze lieux-dits du Val d'Eastbrook.",
  },
  exp_marsh_wayfarer: {
    name: 'Voyageur du Marais',
    desc: 'Visitez les huit lieux-dits du Marais de Mirefen.',
  },
  exp_peaks_wayfarer: {
    name: 'Voyageur des Hauteurs',
    desc: 'Visitez les dix lieux-dits des Hauteurs de Thornpeak.',
  },
  exp_world_traveler: {
    name: 'Grand voyageur',
    desc: 'Obtenez le haut fait de voyageur des trois zones.',
    title: 'le Voyageur',
  },
  exp_something_shiny: {
    name: 'Quelque chose qui brille',
    desc: 'Ramassez un objet scintillant sur le sol.',
  },
  exp_first_ore: {
    name: 'Premier coup de pioche',
    desc: 'Récoltez votre premier filon de minerai.',
  },
  exp_first_timber: { name: 'Ça va tomber !', desc: 'Récoltez votre première coupe de bois.' },
  exp_first_herb: { name: 'La main verte', desc: "Récoltez votre premier plant d'herbes." },
  feat_era_cap: {
    name: 'Enfant de la Première Ère',
    desc: 'A atteint le niveau 20 du temps de la Première Ère.',
  },
  feat_book_complete: {
    name: 'Le Livre entier',
    desc: 'Obtenez chaque haut fait du Livre des hauts faits.',
  },
  feat_brightwood_relic: {
    name: 'En souvenir de Brightwood',
    desc: "Conservez une relique de l'ancienne Brightwood : le Justaucorps en peau de ronces ou la Couronne du Monarque.",
  },
  hid_saul_footnote: {
    name: "Une note de bas de page dans l'Histoire",
    desc: 'A importuné Saul le Chroniqueur neuf fois sans reprendre haleine.',
    title: 'la Note de bas de page',
  },
  hid_gilded_tour: {
    name: 'La tournée dorée',
    desc: 'A fait affaire avec les trois succursales du Coffre doré.',
  },
  hid_fall_death: {
    name: 'La gravité gagne toujours',
    desc: 'A succombé à une longue conversation avec le sol.',
  },
  hid_keepers_toll_twice: {
    name: 'Le Veilleur encaisse deux fois',
    desc: 'A succombé alors que le Tribut du Veilleur pesait encore sur ses épaules.',
  },
  hid_roll_hundred: { name: 'Cent naturel', desc: 'A obtenu un 100 parfait sur un simple /roll.' },
  hid_yumi_cheer: {
    name: 'Fan numéro un de Yumi',
    desc: "A acclamé Yumi assez près pour qu'elle l'entende, en plein combat.",
  },
  hid_bountiful_coffer: {
    name: 'Le Coffre pourpre',
    desc: "A crocheté un Coffre d'abondance avant qu'il ne s'enraye.",
  },
  hid_companion_save: {
    name: "Pas tant qu'elle veille",
    desc: 'Votre compagne de plongée a remis sur pied un coéquipier tombé à terre.',
  },
  hid_codfather: {
    name: 'Bienvenue dans la Famille',
    desc: 'A sorti le Capitaine brochet des Hauts-fonds de Deepfen.',
  },
  prog_crown_below: {
    name: 'La couronne des profondeurs',
    desc: "Suivez la couronne depuis les champs d'ossements agités jusqu'au tombeau du roi Nythraxis et menez « La Fin du Fléau » à son terme.",
  },
  prog_mere_at_rest: {
    name: 'Les eaux apaisées',
    desc: "Accompagnez la garde d'Ondrel Vane, le Veille-marées, jusqu'au bout : le chœur réduit au silence, le Pâlanneau abattu et la Lune noyée rendue au repos.",
  },
  prog_callused_hands: {
    name: 'Mains calleuses',
    desc: "Terminez « Un métier pour chaque main » et gagnez votre première callosité dans les métiers d'Eastbrook.",
  },
  prog_tools_of_the_trade: {
    name: 'Les outils du métier',
    desc: "Réalisez une fabrication exigeant un établi au pôle d'artisanat de Highwatch.",
  },
  dgn_nythraxis_crypt: {
    name: 'Ce que gardait la crypte',
    desc: 'Bravez la Crypte abandonnée et récupérez les deux moitiés de la clef ainsi que le journal ancien auprès de ses gardiens.',
  },
  chr_marsh_first_cast: {
    name: 'Des anguilles dans les roseaux',
    desc: 'Pêcher un poisson dans les eaux du Marais de Mirefen.',
  },
};

// fr_CA rides this base table plus the delve-vocabulary override layer
// assembled in deed_i18n.ts.
export const dialects: Record<string, DeedLocaleTable> = {
  fr_CA: {
    dgn_deepward: {
      name: 'Gardien des profondeurs',
      desc: 'Triomphez de chaque donjon, du raid et des deux excavations en difficulté héroïque.',
    },
    dlv_lore_journal: {
      name: 'Marginalia',
      desc: "Débloquer les cinq entrées du journal d'excavation.",
    },
    dlv_companion_max: {
      name: 'Une amie des profondeurs',
      desc: "Hisser une compagne d'excavation à son rang le plus élevé.",
    },
    dlv_clears_50: { name: 'Cinquante brasses', desc: 'Terminer 50 excavations.' },
  },
};
