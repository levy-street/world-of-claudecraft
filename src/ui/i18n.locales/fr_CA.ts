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
    "Les chasseurs sont des spécialistes à distance qui combattent aux côtés d'une bête apprivoisée, criblant leurs ennemis de tirs précis et rapides, les ralentissant de morsures et de traits de choc, et changeant d'aspect selon le moment.",
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
  // Aura effect tooltip summaries.
  'hudChrome.auraEffect.dot': 'Cause {value} points de dégâts de {school} toutes les {interval} s',
  'hudChrome.auraEffect.hot': 'Redonne {value} points de vie toutes les {interval} s',
  'hudChrome.auraEffect.absorb': 'Bloque {value} points de dégâts',
  'hudChrome.auraEffect.healAbsorb': 'Bloque {value} points de soins reçus',
  'hudChrome.auraEffect.thorns': 'Cause {value} points de dégâts de {school} aux attaquants',
  'hudChrome.auraEffect.slow': 'Diminue la vitesse de déplacement de {pct}%',
  'hudChrome.auraEffect.speed': 'Accroît la vitesse de déplacement de {pct}%',
  'hudChrome.auraEffect.attackSpeedSlow': "Diminue la vitesse d'attaque de {pct}%",
  'hudChrome.auraEffect.attackSpeedFast': "Accroît la vitesse d'attaque de {pct}%",
  'hudChrome.auraEffect.haste': "Accroît la vitesse d'attaque et d'incantation de {pct}%",
  'hudChrome.auraEffect.tongues': "Accroît le temps d'incantation de {pct}%",
  'hudChrome.auraEffect.increase.ap': "Accroît la puissance d'attaque de {value}",
  'hudChrome.auraEffect.increase.armor': "Accroît l'armure de {value}",
  'hudChrome.auraEffect.increase.int': "Accroît l'intelligence de {value}",
  'hudChrome.auraEffect.increase.agi': "Accroît l'agilité de {value}",
  'hudChrome.auraEffect.increase.sta': "Accroît l'endurance de {value}",
  'hudChrome.auraEffect.increase.spi': "Accroît l'esprit de {value}",
  'hudChrome.auraEffect.increase.allStats': 'Accroît tous les attributs de {value}',
  'hudChrome.auraEffect.reduce.ap': "Diminue la puissance d'attaque de {value}",
  'hudChrome.auraEffect.reduce.armor': "Diminue l'armure de {value}",
  'hudChrome.auraEffect.reduce.int': "Diminue l'intelligence de {value}",
  'hudChrome.auraEffect.reduce.agi': "Diminue l'agilité de {value}",
  'hudChrome.auraEffect.reduce.sta': "Diminue l'endurance de {value}",
  'hudChrome.auraEffect.reduce.spi': "Diminue l'esprit de {value}",
  'hudChrome.auraEffect.reduce.allStats': 'Diminue tous les attributs de {value}',
  'hudChrome.auraEffect.dodge': "Accroît les chances d'esquive de {pct}%",
  'hudChrome.auraEffect.dodgeReduce': "Diminue les chances d'esquive de {pct}%",
  'hudChrome.auraEffect.armorFlat': "Diminue l'armure de {value}",
  'hudChrome.auraEffect.armorFlatStacks': "Diminue l'armure de {value} ({stacks} charges)",
  'hudChrome.auraEffect.mortalWound': 'Diminue les soins reçus de {pct}%',
  'hudChrome.auraEffect.vulnerability': 'Accroît les dégâts subis de {pct}%',
  'hudChrome.auraEffect.physVuln': 'Accroît les dégâts physiques subis de {pct}%',
  'hudChrome.auraEffect.spellVuln': 'Accroît les dégâts magiques subis de {pct}%',
  'hudChrome.auraEffect.critVuln': 'Accroît les chances de subir un coup critique de {pct}%',
  'hudChrome.auraEffect.costTax': 'Accroît le coût des techniques de {pct}%',
  'hudChrome.auraEffect.stun': "Sonné : impossible d'agir",
  'hudChrome.auraEffect.root': 'Immobilisé : impossible de bouger',
  'hudChrome.auraEffect.incapacitate': "Neutralisé, impossible d'agir",
  'hudChrome.auraEffect.polymorph': "Transformé : impossible d'agir",
  'hudChrome.auraEffect.hex': 'Diminue les dégâts et soins prodigués de {pct}%',
  'hudChrome.auraEffect.blind': "Aveuglé, impossible d'agir",
  'hudChrome.auraEffect.silence': 'Diminue au silence : impossible de lancer des sorts',
  'hudChrome.auraEffect.disarm': "Désarmé, impossible d'utiliser des attaques d'arme",
  'hudChrome.auraEffect.lockout': 'École de magie verrouillée',
  'hudChrome.auraEffect.imbue': 'Arme enchantée avec effets bonus',
  'hudChrome.auraEffect.imbueRange': 'Arme enchantée : {min} à {max} dégâts bonus au jugement',
  'hudChrome.auraEffect.stealth': 'Dissimulé ; vitesse de déplacement réduite de {pct}%',
  'hudChrome.auraEffect.formBear': 'Forme ours : points de vie et armure augmentés',
  'hudChrome.auraEffect.formCat': 'Forme féline : dégâts de mêlée et énergie',
  'hudChrome.auraEffect.formTravel': 'Forme voyage : vitesse de déplacement augmentée de {pct}%',
  'hudChrome.auraEffect.defensiveStance': 'Posture défensive, dégâts subis réduits, menace accrue',
  'hudChrome.auraEffect.righteousFury':
    'Fureur vertueuse, menace des dégâts Sacré fortement accrue',
  'hudChrome.auraEffect.scale': 'Gabarit augmentée de {pct}%',
  'hudChrome.auraEffect.jump': 'Saut augmentée de {pct}%',
  'hudChrome.auraEffect.school.physical': 'physique',
  'hudChrome.auraEffect.school.fire': 'feu',
  'hudChrome.auraEffect.school.frost': 'froid',
  'hudChrome.auraEffect.school.arcane': 'arcane',
  'hudChrome.auraEffect.school.shadow': 'ombre',
  'hudChrome.auraEffect.school.holy': 'sacré',
  'hudChrome.auraEffect.school.nature': 'nature',
  'entities.abilities.holy_shock.name': 'Horion sacré',
  'entities.abilities.holy_shock.description':
    'Frappe une cible alliée avec de l’énergie sacrée et lui rend {damage} points de vie. (signature Sacré)',
  'entities.abilities.holy_shield.name': 'Bouclier sacré',
  'entities.abilities.holy_shield.description':
    'Vous protège avec une puissance sacrée pendant 10 s, augmente l’armure de 90 et frappe les attaquants en mêlée pour 12 points de dégâts du Sacré. (signature Protection)',
  'entities.abilities.repentance.name': 'Repentir',
  'entities.abilities.repentance.description':
    'Plonge l’ennemi dans un état de méditation pendant un maximum de 6 s. Tout dégât interrompt l’effet. (signature Vindicte)',
  'entities.abilities.bestial_wrath.name': 'Courroux bestial',
  'entities.abilities.bestial_wrath.description':
    'Vous plonge dans une rage bestiale, augmentant la puissance d’attaque de 55 pendant 15 s. (signature Maîtrise des bêtes)',
  'entities.abilities.trueshot_aura.name': 'Aura de précision',
  'entities.abilities.trueshot_aura.description':
    'Inspire les alliés proches, augmentant leur puissance d’attaque de 35 pendant 5 min. (signature Précision)',
  'entities.abilities.wyvern_sting.name': 'Piqûre de wyverne',
  'entities.abilities.wyvern_sting.description':
    'Pique l’ennemi à distance et le rend incapable d’agir pendant un maximum de 4 s. Tout dégât interrompt l’effet. (signature Survie)',
  'entities.abilities.arcane_power.name': 'Pouvoir des Arcanes',
  'entities.abilities.arcane_power.description':
    'Augmente les dégâts des sorts de 20% et la hâte des sorts de 10% pendant 10 s. (signature Arcane)',
  'entities.abilities.combustion.name': 'Combustion',
  'entities.abilities.combustion.description':
    'Augmente les chances de coup critique des sorts de 50% pendant 15 s. (signature Feu)',
  'entities.abilities.icy_veins.name': 'Veines glaciales',
  'entities.abilities.icy_veins.description':
    'Augmente la hâte des sorts de 30% et empêche l’interruption et le recul des incantations pendant 10 s. (signature Givre)',
  'entities.abilities.cone_of_cold.name': 'Cône de froid',
  'entities.abilities.cone_of_cold.description':
    'Frappe les ennemis proches avec du givre et inflige {damage} points de dégâts de Givre. (talent de mage)',
  'entities.abilities.cold_blood.name': 'Sang froid',
  'entities.abilities.cold_blood.description':
    'Concentre votre intention meurtrière afin que votre prochaine attaque soit un coup critique. (signature Assassinat)',
  'entities.abilities.blade_flurry.name': 'Déluge de lames',
  'entities.abilities.blade_flurry.description':
    'Déchaîne un déluge de lames, augmentant la vitesse d’attaque de 20% pendant 12 s. (signature Combat)',
  'entities.abilities.hemorrhage.name': 'Hémorragie',
  'entities.abilities.hemorrhage.description':
    'Frappe l’ennemi pour les dégâts de l’arme plus {damage} et inflige des dégâts de saignement pendant 12 s. Confère 1 point de combo. (signature Finesse)',
  'entities.abilities.power_infusion.name': 'Infusion de puissance',
  'entities.abilities.power_infusion.description':
    'Insuffle de la puissance à une cible alliée, augmentant sa puissance des sorts de 28 pendant 15 s. (signature Discipline)',
  'entities.abilities.holy_nova.name': 'Nova sacrée',
  'entities.abilities.holy_nova.description':
    'Provoque une explosion de lumière sacrée, rend {damage} points de vie aux alliés proches et blesse les ennemis proches. (signature Sacré)',
  'entities.abilities.shadowform.name': "Forme d'Ombre",
  'entities.abilities.shadowform.description':
    'Adopte la Forme d’Ombre, renforçant la magie de l’ombre jusqu’à ce que vous changiez de nouveau. Lancez à nouveau pour revenir à la forme normale. (signature Ombre)',
  'entities.abilities.elemental_mastery.name': 'Maîtrise élémentaire',
  'entities.abilities.elemental_mastery.description':
    'Fait appel à la maîtrise élémentaire, rendant votre prochain sort instantané. (signature Élémentaire)',
  'entities.abilities.shamanistic_rage.name': 'Rage chamanique',
  'entities.abilities.shamanistic_rage.description':
    'Libère une rage chamanique et rend 160 points de mana. (signature Amélioration)',
  'entities.abilities.natures_swiftness.name': 'Rapidité de la nature',
  'entities.abilities.natures_swiftness.description':
    'Fait appel à la nature pour rendre votre prochain sort instantané. (signature Restauration)',
  'entities.abilities.siphon_life.name': 'Siphon de vie',
  'entities.abilities.siphon_life.description':
    'Siphonne la vie de l’ennemi, inflige {damage} points de dégâts d’Ombre en 30 s et vous soigne du montant des dégâts infligés. (signature Affliction)',
  'entities.abilities.fel_domination.name': 'Domination corrompue',
  'entities.abilities.fel_domination.description':
    'Domine les énergies gangrenées, rendant votre prochain sort instantané. (signature Démonologie)',
  'entities.abilities.conflagrate.name': 'Conflagration',
  'entities.abilities.conflagrate.description':
    'Consume votre Immolation sur l’ennemi pour l’enflammer et lui infliger {damage} points de dégâts de Feu. (signature Destruction)',
  'entities.abilities.moonkin_form.name': 'Forme de sélénien',
  'entities.abilities.moonkin_form.description':
    'Adopte la forme de sélénien, renforçant l’incantation jusqu’à ce que vous changiez de nouveau. Lancez à nouveau pour revenir à la forme normale. (signature Équilibre)',
  'entities.abilities.feral_charge.name': 'Charge farouche',
  'entities.abilities.feral_charge.description':
    'Charge un ennemi et l’enracine pendant 1 s. Portée de 8-25 m. (signature Farouche)',
  'entities.abilities.swiftmend.name': 'Prompte guérison',
  'entities.abilities.swiftmend.description':
    'Consume un effet de soins sur la durée sur une cible alliée pour lui rendre {damage} points de vie. (signature Restauration)',
  'entities.abilities.heroic_leap.name': 'Bond héroïque',
  'entities.abilities.heroic_leap.description':
    'Bondit vers la zone ciblée et inflige {damage} points de dégâts physiques aux ennemis proches. (Talent de guerrier)',
  'entities.abilities.pummel.name': 'Volée de coups',
  'entities.abilities.pummel.description':
    'Interrompt l’incantation et empêche de lancer des sorts de cette école pendant 4 s. (Talent de guerrier)',
  'entities.abilities.shield_wall.name': 'Mur protecteur',
  'entities.abilities.shield_wall.description':
    'Dresse votre mur protecteur, ce qui augmente fortement l’armure pendant 10 s. (Talent de guerrier)',
  'entities.abilities.last_stand.name': 'Dernier rempart',
  'entities.abilities.last_stand.description':
    'Augmente temporairement l’Endurance pendant 15 s, ce qui augmente les points de vie maximum. (Talent de guerrier)',
  'entities.abilities.bladestorm.name': 'Tempête de lames',
  'entities.abilities.bladestorm.description':
    'Vous devenez une tempête d’acier et frappez les ennemis proches chaque seconde pour {damage} points de dégâts. (Talent de guerrier)',
  'entities.abilities.avatar.name': 'Avatar',
  'entities.abilities.avatar.description':
    'Vous transforme en colosse, ce qui augmente la puissance d’attaque pendant 20 s. (Talent de guerrier)',
  'entities.abilities.rallying_cry.name': 'Cri de ralliement',
  'entities.abilities.rallying_cry.description':
    'Pousse un cri de ralliement qui augmente la puissance d’attaque des alliés proches pendant 10 s. (Talent de guerrier)',
  'entities.abilities.counterspell.name': 'Contresort',
  'entities.abilities.counterspell.description':
    'Contre l’incantation ennemie et empêche de lancer des sorts de cette école pendant 6 s. (Talent de mage)',
  'entities.abilities.ice_lance.name': 'Javelot de glace',
  'entities.abilities.ice_lance.description':
    'Projette un éclat de glace qui inflige {damage} points de dégâts de Givre. Inflige le triple aux cibles enracinées.',
  'entities.abilities.presence_of_mind.name': 'Présence spirituelle',
  'entities.abilities.presence_of_mind.description':
    'Rend instantané votre prochain sort avec un temps d incantation. Dure 60 s. (Talent de mage)',
  'entities.abilities.blink.name': 'Transfert',
  'entities.abilities.blink.description':
    'Vous téléporte de 15 m vers l’avant et brise les racines. (Talent de mage)',
  'entities.abilities.ice_block.name': 'Bloc de glace',
  'entities.abilities.ice_block.description':
    'Vous enferme dans la glace et absorbe une quantité massive de dégâts pendant 8 s. (Talent de mage)',
  'entities.abilities.deep_freeze.name': 'Congélation profonde',
  'entities.abilities.deep_freeze.description':
    'Congèle profondément la cible, inflige {damage} points de dégâts de Givre et l’étourdit pendant 4 s. (Talent de mage)',
  'entities.abilities.meteor.name': 'Météore',
  'entities.abilities.meteor.description':
    'Fait tomber un météore sur la zone ciblée, inflige {damage} points de dégâts de Feu et embrase le sol. (Talent de mage)',
  'entities.abilities.evocation.name': 'Évocation',
  'entities.abilities.evocation.description': 'Restaure rapidement du mana. (Talent de mage)',
  'entities.abilities.rebuke.name': 'Réprimande',
  'entities.abilities.rebuke.description':
    'Interrompt l’incantation et empêche les sorts de cette école pendant 4 s. (talent de paladin)',
  'entities.abilities.crusader_strike.name': 'Frappe du croisé',
  'entities.abilities.crusader_strike.description':
    'Frappe la cible et inflige les dégâts de l’arme plus {damage} points de dégâts du Sacré. (talent de paladin)',
  'entities.abilities.holy_wrath.name': 'Colère divine',
  'entities.abilities.holy_wrath.description':
    'Déchaîne la puissance sacrée et inflige {damage} points de dégâts aux ennemis proches. (talent de paladin)',
  'entities.abilities.divine_shield.name': 'Bouclier divin',
  'entities.abilities.divine_shield.description':
    'Vous protège d’une puissance sacrée et absorbe une quantité massive de dégâts pendant 8 s. (talent de paladin)',
  'entities.abilities.avenging_wrath.name': 'Courroux vengeur',
  'entities.abilities.avenging_wrath.description':
    'Appelle une puissance vengeresse, ce qui augmente la puissance d’attaque et la puissance des sorts pendant 20 s. (talent de paladin)',
  'entities.abilities.hammer_of_wrath.name': 'Marteau de courroux',
  'entities.abilities.hammer_of_wrath.description':
    'Lance un marteau sacré sur un ennemi blessé et inflige {damage} points de dégâts du Sacré. Utilisable seulement sous 20% de points de vie. (talent de paladin)',
  'entities.abilities.counter_shot.name': 'Flèche-bâillon',
  'entities.abilities.counter_shot.description':
    'Interrompt l’incantation et empêche les sorts de cette école pendant 4 s. (talent de chasseur)',
  'entities.abilities.frost_trap.name': 'Piège de givre',
  'entities.abilities.frost_trap.description':
    'Gèle les ennemis dans la zone ciblée pendant 3 s. (talent de chasseur)',
  'entities.abilities.mend_pet.name': 'Guérison du familier',
  'entities.abilities.mend_pet.description':
    'Rend {damage} points de vie à une cible alliée en 15 s. (talent de chasseur)',
  'entities.abilities.multi_shot.name': 'Flèches multiples',
  'entities.abilities.multi_shot.description':
    'Tire plusieurs projectiles qui touchent les ennemis proches et infligent {damage} points de dégâts. (talent de chasseur)',
  'entities.abilities.deterrence.name': 'Dissuasion',
  'entities.abilities.deterrence.description':
    'Augmente vos chances d’esquiver de 50% pendant 10 s. (talent de chasseur)',
  'entities.abilities.aspect_of_the_wild.name': 'Aspect de la nature',
  'entities.abilities.aspect_of_the_wild.description':
    'Inspire les alliés proches d’une force sauvage, ce qui augmente leur puissance d’attaque pendant 5 min. (talent de chasseur)',
  'entities.abilities.kick.name': 'Coup de pied',
  'entities.abilities.kick.description':
    'Interrompt l’incantation et empêche les sorts de cette école pendant 4 s. (talent de voleur)',
  'entities.abilities.preparation.name': 'Préparation',
  'entities.abilities.preparation.description':
    'Met fin au temps de recharge de Sprint, Évasion et Disparition. (talent de voleur)',
  'entities.abilities.ghostly_strike.name': 'Frappe fantomatique',
  'entities.abilities.ghostly_strike.description':
    'Frappe l’ennemi avec les dégâts de l’arme plus {damage} et augmente brièvement l’esquive. Confère 1 point de combo. (talent de voleur)',
  'entities.abilities.cloak_of_shadows.name': 'Cape d’ombre',
  'entities.abilities.cloak_of_shadows.description':
    'Vous enveloppe d’ombres et absorbe les dégâts pendant 5 s. (talent de voleur)',
  'entities.abilities.shadowstep.name': 'Pas de l’ombre',
  'entities.abilities.shadowstep.description':
    'Vous avancez à travers les ombres vers votre cible. (talent de voleur)',
  'entities.abilities.silence.name': 'Silence',
  'entities.abilities.silence.description':
    'Réduit la cible au silence pendant 4 s. (talent de prêtre)',
  'entities.abilities.psychic_scream.name': 'Cri psychique',
  'entities.abilities.psychic_scream.description':
    'Effraie les ennemis proches pendant un maximum de 4 s. Les dégâts peuvent interrompre l’effet. (talent de prêtre)',
  'entities.abilities.inner_focus.name': 'Focalisation améliorée',
  'entities.abilities.inner_focus.description':
    'Rend votre prochain sort gratuit. Dure 60 s. (talent de prêtre)',
  'entities.abilities.desperate_prayer.name': 'Prière du désespoir',
  'entities.abilities.desperate_prayer.description':
    'Vous rend instantanément {damage} points de vie. (talent de prêtre)',
  'entities.abilities.prayer_of_healing.name': 'Prière de soins',
  'entities.abilities.prayer_of_healing.description':
    'Rend {damage} points de vie aux alliés proches. (talent de prêtre)',
  'entities.abilities.mind_sear.name': 'Incandescence mentale',
  'entities.abilities.mind_sear.description':
    'Canalise de l’énergie d’Ombre dans la zone ciblée et inflige {damage} points de dégâts par seconde aux ennemis proches. (talent de prêtre)',
  'entities.abilities.earthbind.name': 'Lien terrestre',
  'entities.abilities.earthbind.description':
    'Lie les ennemis proches à la terre et les immobilise pendant 2 s. (talent de chaman)',
  'entities.abilities.healing_stream.name': 'Flot de soins',
  'entities.abilities.healing_stream.description':
    'Restaure une cible alliée pendant 12 s. (talent de chaman)',
  'entities.abilities.chain_lightning.name': 'Chaîne d’éclairs',
  'entities.abilities.chain_lightning.description':
    'Projette des éclairs dans la zone ciblée et inflige {damage} points de dégâts aux ennemis proches. (talent de chaman)',
  'entities.abilities.bloodlust.name': 'Furie sanguinaire',
  'entities.abilities.bloodlust.description':
    'Pousse les alliés proches à la frénésie et augmente leur vitesse d’attaque pendant 15 s. (talent de chaman)',
  'entities.abilities.spell_lock.name': 'Verrou magique',
  'entities.abilities.spell_lock.description':
    'Interrompt l’incantation et empêche les sorts de cette école pendant 5 s. (talent de démoniste)',
  'entities.abilities.howl_of_terror.name': 'Hurlement de terreur',
  'entities.abilities.howl_of_terror.description':
    'Effraie les ennemis proches pendant un maximum de 3 s. Les dégâts peuvent interrompre l’effet. (talent de démoniste)',
  'entities.abilities.curse_of_exhaustion.name': 'Malédiction de fatigue',
  'entities.abilities.curse_of_exhaustion.description':
    'Maudit la cible et réduit sa vitesse de déplacement de 30% pendant 12 s. (talent de démoniste)',
  'entities.abilities.death_coil.name': 'Voile mortel',
  'entities.abilities.death_coil.description':
    'Frappe l’ennemi et inflige {damage} points de dégâts d’Ombre, puis l’horrifie pendant 3 s. Cette version ne soigne pas le lanceur. (talent de démoniste)',
  'entities.abilities.chaos_bolt.name': 'Trait du chaos',
  'entities.abilities.chaos_bolt.description':
    'Projette un trait de feu chaotique qui inflige {damage} points de dégâts de Feu. (talent de démoniste)',
  'entities.abilities.metamorphosis.name': 'Métamorphose',
  'entities.abilities.metamorphosis.description':
    'Vous adoptez une puissance démoniaque, ce qui augmente l’armure et la puissance d’attaque pendant 20 s. (talent de démoniste)',
  'entities.abilities.skull_bash.name': 'Coup de crâne',
  'entities.abilities.skull_bash.description':
    'Interrompt l’incantation et empêche les sorts de cette école pendant 4 s. (talent de druide)',
  'entities.abilities.innervate.name': 'Innervation',
  'entities.abilities.innervate.description':
    'Restaure instantanément 200 de votre ressource actuelle. (talent de druide)',
  'entities.abilities.frenzied_regeneration.name': 'Régénération frénétique',
  'entities.abilities.frenzied_regeneration.description':
    'Régénère des points de vie pendant 10 s. Forme d’ours uniquement. (talent de druide)',
  'entities.abilities.berserk.name': 'Berserk',
  'entities.abilities.berserk.description':
    'Augmente la puissance d’attaque pendant 15 s. (talent de druide)',
  'entities.abilities.tranquility.name': 'Tranquillité',
  'entities.abilities.tranquility.description':
    'Canalise une énergie restauratrice qui soigne chaque seconde les alliés proches. (talent de druide)',
};
