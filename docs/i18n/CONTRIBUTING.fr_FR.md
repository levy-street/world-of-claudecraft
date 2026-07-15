<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · **Français** · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# Contribuer à World of ClaudeCraft

Avant tout, merci d'être là. World of ClaudeCraft est construit par une communauté
de passionnés des MMO classiques, et chaque contribution, grande ou petite, le rend
meilleur. Corriger une faute de frappe, traduire le jeu, signaler un bug, créer un
donjon entier : tout compte, et vous êtes le bienvenu ici.

Ce guide vous aidera à mettre en place votre environnement et à réussir en douceur
votre première contribution. Pas besoin d'être un expert. Si quelque chose n'est pas
clair, demandez sur [Discord](https://discord.com/invite/worldofclaudecraft) et quelqu'un se fera un
plaisir de vous aider.

En participant, vous acceptez de respecter notre [Code de conduite](../../CODE_OF_CONDUCT.md).

## Comment contribuer

Il y a une place pour chacun ici :

- **Le code.** Corrigez un bug, ajoutez une fonctionnalité ou améliorez les
  performances. Les tickets étiquetés
  [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue)
  et [`help wanted`](https://github.com/levy-street/world-of-claudecraft/labels/help%20wanted)
  sont de bons points de départ.
- **Les traductions.** Aidez les joueurs du monde entier en améliorant ou en
  complétant une langue. Voir [Traduire le jeu](#translating-the-game) ci-dessous.
  C'est l'une des manières les plus simples et les plus utiles de commencer.
- **Les rapports de bugs et les idées de fonctionnalités.** Ouvrez un [ticket](https://github.com/levy-street/world-of-claudecraft/issues/new/choose).
  Un rapport de bug clair est une vraie contribution.
- **La documentation.** Les guides comme celui-ci, le README et les documents de
  conception dans `docs/` peuvent toujours être améliorés.
- **Les tests de jeu et les retours.** Jouez au jeu, dites-nous ce qui sonne faux et
  partagez vos idées sur Discord.

## Pour démarrer

Vous aurez besoin de [Node.js 22+](https://nodejs.org/) et de npm. Pour le serveur
multijoueur, il vous faudra également [Docker](https://www.docker.com/) afin de faire
tourner Postgres.

```bash
# 1. Forkez le dépôt sur GitHub, puis clonez votre fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Installez les dépendances
npm ci

# 3. Lancez le client hors ligne (ni serveur ni base de données requis)
npm run dev          # ouvrez l'URL affichée (en général http://localhost:5173)
```

Cela suffit pour jouer au monde hors ligne et travailler sur la plupart des choses.
Pour lancer la stack en ligne complète :

```bash
npm run db:up        # démarre Postgres 16 dans Docker (base de dev sur le port 5433)
npm run server       # compile et lance le serveur de jeu autoritaire sur :8787
npm run dev          # dans un autre terminal ; le client passe par un proxy vers le serveur
```

Le [README](../../README.md) contient le guide complet d'hébergement, de développement et
de jeu, et les fichiers `CLAUDE.md` répartis dans le dépôt documentent les
conventions de chaque domaine.

## Réaliser votre modification

1. **Créez une branche** depuis `main` : `feature/<short-slug>` ou `fix/<short-slug>`.
2. **Faites des commits ciblés.** Des modifications plus petites et autonomes sont
   plus faciles à relire et à fusionner que de grosses modifications.
3. **Ajoutez ou mettez à jour les tests** pour tout comportement que vous modifiez
   dans `src/sim/` ou `server/`.
4. **Gardez les textes visibles par les joueurs traduisibles.** Voir
   [Localisation](#localization) et [Traduire le jeu](#translating-the-game).

### À garder à l'esprit

Voici les règles porteuses du code. Le détail complet se trouve dans le
[`CLAUDE.md`](../../CLAUDE.md) à la racine, mais en résumé :

- **Le cœur de simulation (`src/sim/`) est la source de vérité**, et il reste pur,
  sans aucun import du DOM, du navigateur ni de Three.js, afin que le même code
  s'exécute à l'identique hors ligne, sur le serveur et dans l'environnement RL
  headless.
- **La simulation est déterministe.** Elle tourne à un tick fixe de 20 Hz, et tout
  l'aléatoire passe par `Rng`, jamais par `Math.random`, `Date.now` ni
  `performance.now` dans la logique de simulation. La même graine produit toujours
  le même monde.
- **Les calculs de gameplay suivent les formules des MMO de l'ère classique** (rage,
  tables de coups, armure, courbes d'XP). Merci de ne pas inventer de valeurs
  d'équilibrage. Citez plutôt la formule.
- **Ne modifiez pas à la main les fichiers générés** comme `*.generated.ts`.
  Régénérez-les via la compilation.
- **Ne committez jamais de secrets** ni de fichier `.env`, et n'activez jamais
  `ALLOW_DEV_COMMANDS` dans un chemin de production, car cela débloque des triches.

## Avant d'ouvrir une pull request

Merci de lancer ces commandes en local. Ce sont les mêmes vérifications que celles de
la CI :

```bash
npm test                    # suite Vitest
npx tsc --noEmit            # vérification de types TypeScript (le projet est strict)
npm run build               # build de production du client
```

Si vous avez modifié du code serveur ou headless, lancez aussi `npm run build:server`
et `npm run build:env`.

Ensuite, testez votre modification à la fois sur ordinateur et sur mobile, y compris
sur une fenêtre de la taille d'un téléphone en portrait et en paysage, si elle touche
à quoi que ce soit que les joueurs voient. Les cibles tactiles doivent rester d'au
moins 40x40px et les champs de formulaire d'au moins 16px de police. Les standards de
l'interface sont documentés dans [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## Ouvrir la pull request

Poussez votre branche et ouvrez une PR vers `main`. Le
[modèle de pull request](../../.github/PULL_REQUEST_TEMPLATE.md) vous guidera à travers une
courte liste de vérifications. Merci de la remplir :

- Décrivez **ce qui** a changé et **pourquoi**.
- Reliez tout ticket associé (par exemple, « Closes #123 »).
- Ajoutez des **captures d'écran ou un clip pour les changements d'interface**, sur
  ordinateur et sur mobile.
- Confirmez que les tests, la vérification de types et le build passent, et que les
  nouveaux textes sont traduits.

Une CI au vert et une liste de vérifications complète sont ce que nous regardons avant
de fusionner. Un mainteneur peut suggérer des changements. C'est une étape normale et
collaborative du processus, pas un refus. Nous cherchons à être bienveillants et
constructifs lors de la relecture, et nous vous demandons d'en faire autant.

> Les messages de commit et les titres de PR suivent les [Conventional Commits](https://www.conventionalcommits.org/)
> avec une portée lorsque cela convient (`feat(talents): ...`, `fix(net): ...`). C'est
> une convention que nous apprécions plutôt qu'une exigence stricte. Des messages
> clairs et descriptifs comptent plus qu'un formatage parfait.

<a id="localization"></a>

## Localisation

World of ClaudeCraft est disponible dans de nombreuses langues, et nous le gardons
ainsi à mesure que le jeu grandit. Chaque texte visible par les joueurs est traduit
dans chaque langue prise en charge.

- Tout texte destiné à l'utilisateur est une clé `t()` définie dans [`src/ui/i18n.ts`](../../src/ui/i18n.ts).
  Ajoutez d'abord un nouveau texte à la langue `en`, puis fournissez une vraie
  traduction dans chacune des autres langues de `supportedLanguages`. Pas de texte
  anglais provisoire, et pas de `// TODO`.
- Les nombres, les sommes d'argent, les dates, les unités et les pourcentages passent
  par les formateurs (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`) plutôt
  que par une construction manuelle de chaînes.
- Le texte destiné aux joueurs émis depuis `src/sim/` ou `server/`, qui restent
  indépendants de la langue, doit être relocalisé à la frontière du client dans la
  même modification. Le test de garde `npx vitest run tests/localization_fixes.test.ts`
  le vérifie.

Si votre modification ajoute un texte que vous ne savez écrire que dans certaines
langues, ce n'est pas grave. Ouvrez la PR et demandez de l'aide pour le reste dans la
description. Nous préférons de loin vous aider à terminer plutôt que de vous voir vous
retenir.

<a id="translating-the-game"></a>

## Traduire le jeu

Vous voulez améliorer une langue, ou aider à porter le jeu dans une nouvelle ? Pas
besoin d'écrire la moindre ligne de code du jeu pour cela :

1. Ouvrez [`src/ui/i18n.ts`](../../src/ui/i18n.ts) et trouvez la langue sur laquelle vous
   voulez travailler. Chaque objet de langue liste les mêmes clés que `en`.
2. Améliorez les traductions existantes, ou complétez celles qui sonnent maladroites.
3. Lancez `npx tsc --noEmit` pour confirmer que rien ne manque, puis ouvrez une PR.

Pour proposer une toute nouvelle langue, ou pour discuter du ton et de la
terminologie, lancez un fil sur [Discord](https://discord.com/invite/worldofclaudecraft) et nous vous
aiderons à la mettre en place. Les locuteurs natifs et courants sont particulièrement
les bienvenus. De bonnes traductions donnent aux joueurs du monde entier l'impression
d'être chez eux.

## Signaler des bugs et demander des fonctionnalités

Merci d'utiliser les [modèles de ticket](https://github.com/levy-street/world-of-claudecraft/issues/new/choose) :

- **Rapport de bug.** Cherchez d'abord parmi les [tickets existants](https://github.com/levy-street/world-of-claudecraft/issues)
  pour éviter les doublons, puis indiquez les étapes pour reproduire, ce que vous
  attendiez, ce qui s'est passé, et votre environnement (hors ligne ou en ligne,
  navigateur, ordinateur ou mobile).
- **Demande de fonctionnalité.** Décrivez le problème que vous cherchez à résoudre,
  pas seulement la solution. Le contexte nous aide à concevoir la bonne chose.

## Obtenir de l'aide

Bloqué, ou vous voulez juste dire bonjour ? Rejoignez le
[Discord de la communauté](https://discord.com/invite/worldofclaudecraft). Aucune question n'est trop
petite, et les nouveaux contributeurs sont toujours les bienvenus.

## Licence

En contribuant, vous acceptez que vos contributions soient placées sous la
[Licence MIT](../../LICENSE) du projet, la même licence qui couvre le projet.

---

Merci de contribuer à World of ClaudeCraft. Nous avons hâte de voir ce que vous
construirez avec nous.
