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
  "seo.title": "World of ClaudeCraft: MMO Web de style classique",
  "seo.description": "Partez à l'aventure dans World of ClaudeCraft, un micro-MMO de style classique jouable directement dans votre navigateur. Rejoignez un royaume partagé, faites progresser vos classes et terrassez des ennemis.",
  "seo.operatingSystem": "Navigateur Web",
  "a11y.toggleMenu": "Ouvrir ou fermer le menu",
  "loading.assetsFailed": "Le chargement des ressources a échoué: rechargez la page. {error}",
  "loading.rendererFailed": "Impossible de démarrer le rendu: rechargez la page. {error}",
  "loading.enterTimeout": "Impossible d'entrer dans le monde. La connexion a expiré. Le serveur de jeu fonctionne-t-il ?",
  "errors.characterNameRequired": "Entrez un nom de personnage.",
  "errors.characterNameInvalid": "Le nom doit compter 2 à 16 caractères, commencer par une lettre et contenir seulement lettres, espaces, traits d'union ou apostrophes.",
  "errors.selectClass": "Choisissez une classe.",
  "errors.api.tooManyAttempts": "Trop de tentatives. Attendez une minute et réessayez.",
  "errors.api.usernameShape": "Le nom d'utilisateur doit compter 3 à 24 caractères et utiliser lettres, chiffres ou tiret bas.",
  "errors.api.usernameTaken": "Ce nom d'utilisateur est déjà utilisé.",
  "errors.api.invalidCredentials": "Nom d'utilisateur ou mot de passe invalide.",
  "errors.api.nameTaken": "Ce nom est déjà utilisé.",
  "errors.api.deleteConfirm": "Tapez le nom du personnage pour confirmer la suppression.",
  "realm.onlineNow": "{count} en ligne maintenant",
  "character.inWorld": "dans le monde",
  "deleteCharacter.body": "Cela supprimera définitivement {name}. Cette action ne peut pas être annulée.",
  "deleteCharacter.confirmLabel": "Tapez le nom du personnage pour confirmer",
  "classDetails.sections.startingStats": "Caractéristiques de départ",
  "classDetails.lore.warrior": "Les guerriers sont des combattants endurcis qui gagnent de la rage en infligeant ou subissant des dégâts. Ils encaissent ou écrasent leurs ennemis.",
  "classDetails.lore.paladin": "Les paladins sont des croisés sacrés qui aident par des bénédictions, soignent avec la Lumière sacrée et protègent les plus faibles.",
  "classDetails.lore.hunter": "Les chasseurs maîtrisent la nature sauvage, traquent de loin avec arcs ou armes à feu et contrôlent le terrain avec des pièges.",
  "classDetails.lore.shaman": "Les chamans commandent les éléments, imprègnent leurs armes, frappent avec la foudre et restaurent leurs alliés.",
  "classDetails.lore.mage": "Les mages manipulent Feu, Givre et Arcane pour détruire, conjurer de l'eau et figer les menaces.",
  "classDetails.lore.warlock": "Les démonistes invoquent des démons, posent malédictions et dégâts prolongés, puis drainent la vie pour survivre.",
  "classDetails.lore.druid": "Les druides canalisent la nature, guérissent, entravent les ennemis et prennent des formes animales pour défendre ou attaquer.",
  "classDetails.aria": "Détails de classe pour {className}: rôle {role}. Caractéristiques de départ: Force {str}, Agilité {agi}, Endurance {sta}, Intelligence {int}, Esprit {spi}.",
  "mobilePreflight.rotateTitle": "Passez en mode paysage",
  "mobilePreflight.baseLandscape": "Tournez votre appareil en mode paysage avant d'entrer dans le monde.",
  "mobilePreflight.basePerformance": "Les performances mobiles peuvent diminuer. Fermez les onglets inutiles et réduisez la qualité de rendu si le jeu ralentit.",
  "mobilePreflight.iosInstallDetail": "Pour le vrai plein écran sur iPhone ou iPad, ajoutez d'abord cette page à l'écran d'accueil.",
  "mobilePreflight.androidInstallStep": "Dans Chrome, touchez le menu, puis Installer l'application ou Ajouter à l'écran d'accueil.",
  "serverUnavailable.body": "Nous redémarrons le service de jeu et Claudemoon devrait revenir sous peu. Cette page continuera de vérifier automatiquement.",
  "serverUnavailable.status": "De retour bientôt",
};
