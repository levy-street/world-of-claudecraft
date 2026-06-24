// Divergence-only dialect overlay for "fr_CA" over base locale "fr_FR".
//
// "fr_CA" inherits from "fr_FR": the build (scripts/i18n_build.mjs) resolves it as
// nested `en` -> fr_FR overlay -> this overlay, so any key absent here falls through to fr_FR, then to English. This file
// therefore carries ONLY the keys whose value differs from fr_FR; every other key is
// intentionally omitted. A key must NOT be re-added with a value equal to fr_FR
// (redundant duplication). Every key here must be a real `en` leaf
// path (tests/i18n_overlay_key_membership.test.ts + the byte gate). Keys are in `en`'s
// leaf order.

import type { TranslationKey } from '../i18n.catalog';

export const fr_CA: Partial<Record<TranslationKey, string>> = {
  // Stat tooltips inherit the fr_FR base: none of these strings has a genuine
  // Quebec-specific form, so per the divergence-only policy fr_CA carries no
  // hudChrome.statInfo.* overrides.
  'seo.title': 'World of ClaudeCraft: MMO Web de style classique',
  'seo.description':
    "Partez à l'aventure dans World of ClaudeCraft, un micro-MMO de style classique jouable directement dans votre navigateur. Rejoignez un royaume partagé, faites progresser vos classes et terrassez des ennemis.",
  'seo.operatingSystem': 'Navigateur Web',
  'a11y.toggleMenu': 'Ouvrir ou fermer le menu',
  'loading.assetsFailed': 'Le chargement des ressources a échoué: rechargez la page. {error}',
  'loading.rendererFailed': 'Impossible de démarrer le rendu: rechargez la page. {error}',
  'loading.enterTimeout':
    "Impossible d'entrer dans le monde. La connexion a expiré. Le serveur de jeu fonctionne-t-il ?",
  'errors.characterNameRequired': 'Entrez un nom de personnage.',
  'errors.characterNameInvalid':
    "Le nom doit compter 2 à 16 caractères, commencer par une lettre et contenir seulement lettres, espaces, traits d'union ou apostrophes.",
  'errors.selectClass': 'Choisissez une classe.',
  'errors.api.tooManyAttempts': 'Trop de tentatives. Attendez une minute et réessayez.',
  'errors.api.usernameShape':
    "Le nom d'utilisateur doit compter 3 à 24 caractères et utiliser lettres, chiffres ou tiret bas.",
  'errors.api.usernameTaken': "Ce nom d'utilisateur est déjà utilisé.",
  'errors.api.invalidCredentials': "Nom d'utilisateur ou mot de passe invalide.",
  'errors.api.nameTaken': 'Ce nom est déjà utilisé.',
  'errors.api.deleteConfirm': 'Tapez le nom du personnage pour confirmer la suppression.',
  'realm.onlineNow': '{count} en ligne maintenant',
  'character.inWorld': 'dans le monde',
  'deleteCharacter.body':
    'Cela supprimera définitivement {name}. Cette action ne peut pas être annulée.',
  'deleteCharacter.confirmLabel': 'Tapez le nom du personnage pour confirmer',
  'classDetails.sections.startingStats': 'Caractéristiques de départ',
  'classDetails.lore.warrior':
    'Les guerriers sont des combattants endurcis qui gagnent de la rage en infligeant ou subissant des dégâts. Ils encaissent ou écrasent leurs ennemis.',
  'classDetails.lore.paladin':
    'Les paladins sont des croisés sacrés qui aident par des bénédictions, soignent avec la Lumière sacrée et protègent les plus faibles.',
  'classDetails.lore.hunter':
    'Les chasseurs maîtrisent la nature sauvage, traquent de loin avec arcs ou armes à feu et contrôlent le terrain avec des pièges.',
  'classDetails.lore.shaman':
    'Les chamans commandent les éléments, imprègnent leurs armes, frappent avec la foudre et restaurent leurs alliés.',
  'classDetails.lore.mage':
    "Les mages manipulent Feu, Givre et Arcane pour détruire, conjurer de l'eau et figer les menaces.",
  'classDetails.lore.warlock':
    'Les démonistes invoquent des démons, posent malédictions et dégâts prolongés, puis drainent la vie pour survivre.',
  'classDetails.lore.druid':
    'Les druides canalisent la nature, guérissent, entravent les ennemis et prennent des formes animales pour défendre ou attaquer.',
  'classDetails.aria':
    'Détails de classe pour {className}: rôle {role}. Caractéristiques de départ: Force {str}, Agilité {agi}, Endurance {sta}, Intelligence {int}, Esprit {spi}.',
  'mobilePreflight.rotateTitle': 'Passez en mode paysage',
  'mobilePreflight.baseLandscape':
    "Tournez votre appareil en mode paysage avant d'entrer dans le monde.",
  'mobilePreflight.basePerformance':
    'Les performances mobiles peuvent diminuer. Fermez les onglets inutiles et réduisez la qualité de rendu si le jeu ralentit.',
  'mobilePreflight.iosInstallDetail':
    "Pour le vrai plein écran sur iPhone ou iPad, ajoutez d'abord cette page à l'écran d'accueil.",
  'mobilePreflight.androidInstallStep':
    "Dans Chrome, touchez le menu, puis Installer l'application ou Ajouter à l'écran d'accueil.",
  'serverUnavailable.body':
    'Nous redémarrons le service de jeu et Claudemoon devrait revenir sous peu. Cette page continuera de vérifier automatiquement.',
  'serverUnavailable.status': 'De retour bientôt',
  'delveUi.affix.candleblind': 'Aveuglement de chandelle',
  'delveUi.blessing.chapel_candle':
    "Chandelle de chapelle : parcours plus sûr, une Marque de moins à l'achèvement.",
  'delveUi.board.enter': "Entrer dans l'excavation",
  'delveUi.board.marks': "Marques d'excavation : {count}",
  'delveUi.board.openDelveAria': 'Ouvrir le tableau des excavations depuis {name}',
  'delveUi.board.title': 'Tableau des excavations',
  'delveUi.boss.varric.bell.emote': 'Le diacre Varric empoigne la cloche enfouie à deux mains!',
  'delveUi.boss.varric.bell.impact': 'Le glas de la cloche fissure le sol de la chambre!',
  'delveUi.boss.varric.bell.lesson':
    "Glas funèbre : un choc au sol toutes les douze secondes. Éloignez-vous avant l'impact.",
  'delveUi.boss.varric.bell.log': 'Le diacre Varric se met à sonner la cloche funéraire.',
  'delveUi.boss.varric.bell.warning': 'Éloignez-vous du diacre Varric!',
  'delveUi.boss.varric.mid60':
    'Le diacre Varric lit des noms dans le registre avec un triomphe tremblant.',
  'delveUi.boss.varric.pull':
    'Vous foulez la poussière sacrée avec des intentions impures. À genoux, et soyez compté.',
  'delveUi.boss.varric.raise.emote': 'Le diacre Varric appelle des noms des tombes brisées!',
  'delveUi.boss.varric.raise.interrupt_fail': "Les morts répondent à l'appel du diacre Varric!",
  'delveUi.boss.varric.raise.interrupt_ok': 'Le rite funèbre vacille.',
  'delveUi.boss.varric.raise.lesson':
    'Interrompez la tombe fissurée en cinq secondes, sinon les morts se lèvent à son appel.',
  'delveUi.boss.varric.raise.log': 'Le diacre Varric entame Relever les morts.',
  'delveUi.boss.varric.raise.object': "La tombe fissurée frémit d'un souffle volé.",
  'delveUi.boss.varric.raise.warning': 'Arrêtez le rite funèbre!',
  'delveUi.chest.flavor': "Les morts ont cédé ce qu'ils pouvaient épargner.",
  'delveUi.companion.tessa.combat_start':
    "Garde l'équilibre, {playerName}. Les morts sont agités ici.",
  'delveUi.companion.tessa.low_hp': 'Respire. Il me reste des prières pour toi.',
  'delveUi.companion.tessa.rank.1': 'Novice de chapelle',
  'delveUi.companion.tessa.rank.4': "Témoin de l'appel des tombes",
  'delveUi.companion.tessa.rank.5': 'Gardienne de chapelle',
  'delveUi.companion.tessa.trap_spotted': 'Attends, quelque chose dans le sol se souvient des pas.',
  'delveUi.death.warning': 'Une mort de plus mettra fin à cette excavation.',
  'delveUi.intro.heroic':
    "Les portes se referment en grinçant derrière vous. Des noms raclent la pierre comme des ongles. La chandelle de Tessa brûle bleu. « Ils n'appellent plus les morts, maintenant, {playerName}. Ils répondent à quelque chose. »",
  'delveUi.intro.normal':
    "L'escalier est froid et sombre. Des pierres de saints brisées jonchent la descente, et une douce note de cloche flotte dans l'air humide. L'acolyte Tessa murmure : « Le reliquaire ne devrait pas être ouvert aussi profondément. Reste près de moi, {playerName}. »",
  'delveUi.lore.bell_below':
    'Note en marge de Tessa : « Il y a une seconde cloche sous le reliquaire. Elle sonne pour les égarés, pas pour les morts. »',
  'delveUi.lore.eastbrook_ledger':
    "Une page tachée d'eau du registre funéraire d'Eastbrook. Des noms biffés et réécrits d'une main qui n'est pas humaine.",
  'delveUi.lore.first_collapse':
    'Les archives de la chapelle relatent le premier affaissement : pierres de saints fendues, étagères inclinées, et une note de cloche entendue depuis le sous-sol.',
  'delveUi.lore.gravecaller_mark':
    "Un sigil gravé dans le bois d'un cercueil, non pas le sceau de Morthen, mais une marque d'appel des tombes plus ancienne, antérieure à la Crypte creuse.",
  'delveUi.lore.tessa_note':
    "Bout de papier plié de l'écriture de Tessa : « Si les registres changent pendant que nous sommes en bas, fie-toi à la chandelle, pas aux voix. »",
  'delveUi.module.reliquary_bell_niche':
    "Des dizaines de clochettes pendent en silence, chacune nouée d'un linge funéraire.",
  'delveUi.module.reliquary_finale': 'La cloche enfouie sonne une seule fois sous vos bottes.',
  'delveUi.module.reliquary_saintless_hall':
    'Des statues dont les visages ont été burinés avec une haine méticuleuse.',
  'delveUi.module.reliquary_sunken_ossuary':
    "L'eau suinte à travers les étagères funéraires, charriant de vieilles cendres en filets argent et noir.",
  'delveUi.npc.halven.greeting':
    "Le reliquaire en bas s'est encore déplacé. Nous entendons des litanies à travers le plancher après minuit, et l'acolyte Tessa jure que les registres funéraires changent leur propre encre. Si tu as assez de courage, {playerName}, prends une chandelle et descends. Ne te fie pas à toutes les voix que tu entendras là-bas. Certaines connaissaient ton nom avant ta naissance.",
  'delveUi.run.failed': "L'excavation a échoué. Vous êtes ramené auprès du frère Halven.",
  'delveUi.summary.marks': "{count} Marques d'excavation gagnées",
  'delveUi.summary.title': 'Excavation terminée',
  'delveUi.tracker.marks': "Marques d'excavation : {count}",
  'delveUi.tracker.title': 'Excavation',
  'entities.mobs.reliquary_gravecall_acolyte.name': "Acolyte de l'appel des tombes",
  'entities.npcs.brother_halven.greeting': "Le reliquaire en bas s'est encore déplacé.",
  'sim.delve.alreadyInDelve': 'Vous êtes déjà dans une excavation.',
  'sim.delve.bossChest':
    "Le boss tombe. Un coffre de reliquaire scellé s'élève sur l'estrade : crochetez sa serrure pour réclamer votre butin.",
  'sim.delve.cannotAffordCompanionUpgrade':
    "Vous n'avez pas les moyens de payer cette amélioration.",
  'sim.delve.cannotEnterNow': "Vous ne pouvez pas entrer dans une excavation pour l'instant.",
  'sim.delve.companionMarksRequired':
    "Il vous faut {marks} Marques d'excavation pour améliorer {name}.",
  'sim.delve.companionMaxRank': 'Ce compagnon est déjà pleinement amélioré.',
  'sim.delve.complete': '{name} terminé.',
  'sim.delve.duringArena':
    "Vous ne pouvez pas entrer dans une excavation pendant un match d'arène.",
  'sim.delve.duringDuel': 'Vous ne pouvez pas entrer dans une excavation pendant un duel.',
  'sim.delve.graveFalters': 'Le rite funèbre vacille.',
  'sim.delve.mechanismOpen':
    "Un mécanisme s'ouvre dans un déclic tout près. Un passage s'ouvre vers le nord : trouvez le portail de sortie devant vous.",
  'sim.delve.notInDelve': "Vous n'êtes pas dans une excavation.",
  'sim.delve.nothingHappens': 'Rien ne se passe.',
  'sim.delve.raiseDead': '{name} entame Relever les morts.',
  'sim.delve.runFailed': "L'excavation {name} a échoué.",
  'sim.delve.strikeWall': 'Frappez le mur pour percer.',
  'sim.delve.surfaceStairs':
    "Un escalier vers la surface s'ouvre. Appuyez sur F à l'escalier pour partir.",
  'sim.delve.tombstoneHint':
    "Un passage de pierre tombale s'ouvre vers le nord une fois la salle nettoyée.",
  'sim.delve.tombstoneInto': 'Vous franchissez la pierre tombale vers {name}.',
  'sim.delve.tombstoneOpen':
    "Un passage de pierre tombale scellé s'ouvre en grinçant vers le nord. Avancez dedans pour continuer.",
  'sim.delve.unknownTier': "Palier d'excavation inconnu.",
  'sim.delve.whileTrading': 'Vous ne pouvez pas entrer dans une excavation pendant un échange.',
  'sim.lockpick.lastPickSnaps':
    "Le dernier crochet se brise. La serrure se bloque : le coffre est perdu à moins de terminer l'excavation de nouveau.",
  'sim.lockpick.lockJammed':
    "La serrure est bloquée, impossible à crocheter : terminez l'excavation de nouveau pour une autre tentative.",
  'sim.lockpick.lockYields': 'La serrure cède! Butin {tier}.',
};
