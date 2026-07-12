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
  'download.macCta': 'Telecharger la version macOS',
  'download.windowsPending': 'Version Windows a venir.',
  'seo.title': 'World of ClaudeCraft: MMO Web de style classique',
  'seo.description':
    'Lancez-vous dans une aventure épique dans World of ClaudeCraft, un micro-MMO de style classique jouable directement dans votre navigateur. Rejoignez un monde partagé et persistant, faites monter vos classes en niveau et terrassez vos ennemis.',
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
    'Les paladins sont de saints croisés qui épaulent leurs alliés par des bénédictions, soignent les blessures avec la Lumière guérisseuse et protègent les faibles sous une armure lourde.',
  'classDetails.lore.hunter':
    "Les chasseurs sont des spécialistes à distance qui combattent aux côtés d'une bête apprivoisée, criblant leurs ennemis de tirs précis et rapides, les ralentissant de morsures et de traits de choc, et changeant d'aspect selon le moment.",
  'classDetails.lore.shaman':
    'Les chamans commandent les éléments, imprègnent leurs armes, frappent avec la foudre et restaurent leurs alliés.',
  'classDetails.lore.mage':
    "Les mages manient le Feu, le Givre et la force des Arcanes pour détruire leurs ennemis, conjurer de l'eau et figer les menaces sur place.",
  'classDetails.lore.warlock':
    'Les démonistes invoquent des démons, jettent des malédictions et des dégâts prolongés, puis drainent la vie de leurs ennemis pour tenir bon.',
  'classDetails.lore.druid':
    'Les druides canalisent la nature, guérissent, entravent les ennemis et prennent des formes animales pour défendre ou attaquer.',
  'classDetails.lore.warriorClassic':
    "Le guerrier exactement tel qu'il se jouait avant la refonte du combat : la panoplie de techniques et le rythme de rage d'origine, conservés aux côtés du nouveau guerrier pour que vous puissiez essayer les deux et nous dire lequel vous plaît le plus.",
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
  'entities.abilities.battle_stance.description':
    'Une posture de combat agressive : vous générez 10% de rage de plus. La posture par défaut des spécialisations Armes et Protection.',
  'entities.abilities.berserker_stance.description':
    'Une posture de combat téméraire : vos coups critiques tombent 3% plus souvent et frappent 3% plus fort. Le guerrier Fureur combat toujours dans cette posture.',
  'entities.abilities.berserker_stance.name': 'Posture de berserker',
  'entities.abilities.breachmaker.description':
    "Martèle la cible pour les dégâts de l'arme plus {damage} et fissure sa garde : vos propres attaques contre elle infligent 20% de dégâts de plus pendant 8 s. (Armes)",
  'entities.abilities.breachmaker.name': 'Breachmaker',
  'entities.abilities.chain_heal.description':
    'Soigne la cible de {damage} points, puis rebondit vers un maximum de 2 alliés proches, chaque rebond soignant la moitié du montant précédent.',
  'entities.abilities.cleaving_blows.description':
    'Récolte rouge rembourse toujours une charge de Twinstrike. (Fureur)',
  'entities.abilities.deep_wounds.description':
    'Passif : votre Frappe mutilante fait saigner la cible, lui infligeant des dégâts physiques pendant 6 s. (Armes)',
  'entities.abilities.defiant_bellow.description':
    'Un beuglement de défi : tous les ennemis à moins de 10 mètres sont provoqués et contraints de vous attaquer pendant 3 s. (Protection)',
  'entities.abilities.diabolical_twinstrike.description':
    'Tant que vous êtes enragé, votre Twinstrike inflige 15% de dégâts de plus. (Fureur)',
  'entities.abilities.diabolical_twinstrike.name': 'Twinstrike diabolique',
  'entities.abilities.die_by_sword.description':
    "Recours défensif : pendant 8 s, vous subissez 30% de dégâts de moins et esquivez beaucoup plus d'attaques.",
  'entities.abilities.emboldening_roar.description':
    'Pousse un rugissement galvanisant : vous et les joueurs alliés à moins de 40 mètres êtes galvanisés, et vos 3 prochaines techniques sont des coups critiques garantis. (Fureur)',
  'entities.abilities.enrage_passive.description':
    'Passif : tant que vous êtes enragé, vous infligez 7% de dégâts de plus, attaquez 25% plus vite et vous déplacez 10% plus vite pendant 4 s. Saignée a 30% de chances de vous enrager. Récolte rouge vous enrage toujours. (Fureur)',
  'entities.abilities.faultline.description':
    'Envoie une onde de choc dans le sol : les ennemis devant vous à moins de 8 mètres subissent {damage} points de dégâts et sont sonnés pendant 3 s. (Protection)',
  'entities.abilities.faultline.name': 'Faultline',
  'entities.abilities.fel_domination.description':
    'Domine les énergies funestes, rendant votre prochain sort instantané. (Signature Démonologie)',
  'entities.abilities.fel_domination.name': 'Domination funeste',
  'entities.abilities.furious_mending.description':
    "Pendant 10 s, vous subissez 20% de dégâts de moins et, tant que l'effet dure, votre Saignée vous rend 20% de vos points de vie maximum. (Fureur)",
  'entities.abilities.intimidating_shout.description':
    "Un cri terrifiant qui fait fuir de peur jusqu'à 5 ennemis à moins de 8 mètres pendant 8 s. Les dégâts peuvent briser l'effet.",
  'entities.abilities.intimidating_shout.name': "Cri d'intimidation",
  'entities.abilities.iron_resolve.description':
    'Serrez les dents et ignorez la douleur : consomme toute votre rage (20 au minimum) pour absorber 4 points de dégâts par point de rage dépensé, pendant un maximum de 10 s. (Protection)',
  'entities.abilities.measured_fury.description':
    'Votre fureur mesurée aiguise votre économie : vos techniques coûtent 10% de rage de moins. (Armes)',
  'entities.abilities.natures_swiftness.description':
    'Fait appel à la nature pour rendre votre prochain sort instantané. (Signature Restauration)',
  'entities.abilities.piercing_howl.description':
    'Un hurlement perçant qui ralentit de 50% tous les ennemis à moins de 15 mètres pendant 8 s.',
  'entities.abilities.raging_gale.description':
    "Frappe instantanément deux fois avec votre arme, chaque coup infligeant 40% des dégâts de l'arme plus {damage}, et génère {rage} points de rage. Conserve jusqu'à 2 charges. (Fureur)",
  'entities.abilities.raging_gale.name': 'Twinstrike',
  'entities.abilities.raised_guard.description':
    "Abritez-vous derrière votre bouclier : vous subissez 50% de dégâts physiques de moins pendant 6 s. Conserve jusqu'à 2 charges. (Protection)",
  'entities.abilities.recklessness.description':
    'Enragez-vous : votre génération de rage augmente de 50% et vos chances de coup critique de 20% pendant 12 s.',
  'entities.abilities.red_harvest.description':
    "Dépensez tout : trois frappes frénétiques infligeant chacune 65% des dégâts de l'arme plus {damage}, qui vous enragent toujours. (Fureur)",
  'entities.abilities.red_harvest.name': 'Récolte rouge',
  'entities.abilities.repentance.description':
    "Plonge l'ennemi dans un état de méditation pendant un maximum de 6 s. Le moindre dégât brise l'effet. (Signature Rétribution)",
  'entities.abilities.revenge.description':
    'Attaque en arc large, infligeant des dégâts physiques à tous les ennemis devant vous. Au-delà de 5 cibles, les dégâts sont réduits. Quand vous esquivez ou parez, votre prochaine Vengeance peut ne coûter aucune rage.',
  'entities.abilities.seasoned_soldier.description':
    'Vos attaques automatiques critiques génèrent 10% de rage de plus. (Armes)',
  'entities.abilities.shamanistic_rage.description':
    'Libère une rage chamanique, rendant 160 points de mana. (Signature Amélioration)',
  'entities.abilities.storm_bolt.description':
    'Lance votre arme sur la cible pour {damage} points de dégâts et la sonne pendant 3 s.',
  'entities.abilities.storm_bolt.name': 'Projectile de tempête',
  'entities.abilities.sudden_death.description':
    'Vos attaques automatiques ont une chance de vous permettre de lancer Tombe précoce sur une cible peu importe ses points de vie, sans coût de rage. (Armes)',
  'entities.abilities.victory_rush.description':
    "Frappe pour les dégâts de l'arme plus {damage} et vous rend 20% de vos points de vie maximum. Utilisable seulement dans les 20 s qui suivent la mort d'un ennemi.",
  'entities.abilities.victory_rush.name': 'Élan de victoire',
  'entities.items.eastbrook_buckler.name': "Targe d'Eastbrook",
  'entities.mobs.reliquary_gravecall_acolyte.name': "Acolyte de l'appel des tombes",
  'entities.npcs.brother_halven.greeting': "Le reliquaire en bas s'est encore déplacé.",
  'guide.abilityHook.cw_charge':
    'Fonce sur un ennemi éloigné pour ouvrir le combat avec un bref étourdissement.',
  'guide.abilityHook.cw_commanding_shout':
    "Renforce l'endurance pour que tout le monde tienne plus longtemps en combat.",
  'guide.abilityHook.cw_heroic_strike':
    'Prépare un coup plus lourd qui dépense de la rage lors de votre prochaine attaque.',
  'guide.abilityHook.cw_rend': 'Ouvre une plaie qui use la cible au fil du temps.',
  'guide.abilityHook.cw_thunder_clap':
    'Frappe tout ce qui vous entoure et ralentit les attaques ennemies.',
  'guide.abilityHook.hamstring':
    "Taillade les jambes de la cible pour la ralentir afin qu'elle ne puisse pas vous rattraper.",
  'guide.abilityHook.revenge':
    'Une contre-attaque balayante qui frappe tout ce qui se trouve devant vous, et qui coûte moins cher juste après que vous avez détourné un coup.',
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
  // Mobile touch controls: the hotbar page-flip button and its accessible name.
  'hudChrome.mobile.hotbarPageAria': 'Afficher la prochaine série de techniques',
  // Corpse-harvest focus picker (window title, confirm button, component labels).
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
  'hudChrome.auraEffect.imbueRange': 'Arme enchantée : {min} à {max} dégâts bonus au Verdict',
  'hudChrome.auraEffect.stealth': 'Dissimulé ; vitesse de déplacement réduite de {pct}%',
  'hudChrome.auraEffect.formBear': 'Forme de Bruin : points de vie et armure accrus',
  'hudChrome.auraEffect.formCat': 'Forme féline : dégâts de mêlée et énergie',
  'hudChrome.auraEffect.formTravel': 'Forme de Fleet : vitesse de déplacement accrue de {pct}%',
  'hudChrome.auraEffect.defensiveStance':
    'Guarded Stance : dégâts encaissés réduits, menace accrue',
  'hudChrome.auraEffect.righteousFury':
    'Burning Oath : menace générée par les dégâts Sacrés fortement accrue',
  'hudChrome.auraEffect.scale': 'Gabarit augmentée de {pct}%',
  'hudChrome.auraEffect.jump': 'Saut augmentée de {pct}%',
  'hudChrome.auraEffect.school.physical': 'physique',
  'hudChrome.auraEffect.school.fire': 'feu',
  'hudChrome.auraEffect.school.frost': 'froid',
  'hudChrome.auraEffect.school.arcane': 'arcane',
  'hudChrome.auraEffect.school.shadow': 'ombre',
  'hudChrome.auraEffect.school.holy': 'sacré',
  'hudChrome.auraEffect.school.nature': 'nature',
  'hudChrome.auraEffect.avatar': 'Colosse : dégâts infligés accrus de {pct}%',
  'hudChrome.auraEffect.battleStance': 'Posture de combat : génération de rage accrue de 10%',
  'hudChrome.auraEffect.berserkerStance':
    'Posture de berserker : coups critiques 3% plus fréquents et 3% plus puissants',
  'hudChrome.auraEffect.bloodbath':
    'Accroît les chances de coup critique et les dégâts infligés de {pct}%',
  'hudChrome.auraEffect.crit': 'Accroît les chances de coup critique de {pct}%',
  'hudChrome.auraEffect.dieBySword':
    'Diminue les dégâts subis de {pct}% ({lowPct}% sous {hpPct}% de points de vie)',
  'hudChrome.auraEffect.dmgDone': 'Accroît les dégâts infligés de {pct}%',
  'hudChrome.auraEffect.dmgDoneReduce': 'Diminue les dégâts infligés de {pct}%',
  'hudChrome.auraEffect.maxHpPct': 'Accroît les points de vie maximum de {pct}%',
  'hudChrome.auraEffect.rageGen': 'Accroît la génération de rage de {pct}%',
  'hudChrome.auraEffect.reckless':
    'Accroît les chances de coup critique de {pct}% et la génération de rage de {ragePct}%',
  'hudChrome.auraEffect.sanguine':
    "Accroît la vitesse d'attaque de {hastePct}% et les dégâts infligés de {dmgPct}%",
  'hudChrome.auraEffect.victoryRush': 'Élan de victoire est prêt',
  'hudChrome.auth.appleChoiceIntro':
    'Créez un nouveau compte ou liez Apple à un compte que vous avez déjà.',
  'hudChrome.options.mouseoverCast': 'Lancement au survol sur les cadres de groupe',
  'hudChrome.specPanel.selectSpec': 'Choisir la spécialisation',
  'hudChrome.specPanel.specUnlockBanner': 'Spécialisation débloquée!',
  'hudChrome.statInfo.desc.haste':
    "Accélère vos coups d'arme et vos incantations de sorts. Ne réduit pas le délai de récupération global.",
  'hudChrome.statInfo.desc.parry':
    'Vos chances de parer entièrement une attaque de mêlée de front, sans subir de dégâts. Un coup porté dans le dos ne peut pas être paré.',
};
