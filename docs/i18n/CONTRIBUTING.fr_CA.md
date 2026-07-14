<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · **Français (Canada)** · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# Contribuer à World of ClaudeCraft

Tout d'abord, merci d'être ici. World of ClaudeCraft est bâti par une communauté
de gens qui adorent les MMO classiques, et chaque contribution, grande ou petite,
le rend meilleur. Corriger une coquille, traduire le jeu, signaler un bogue,
bâtir un tout nouveau donjon : tout compte, et vous êtes le bienvenu ici.

Ce guide vous aidera à tout configurer et à rendre votre première contribution
facile. Pas besoin d'être un expert. Si quelque chose vous semble flou,
demandez sur [Discord](https://discord.com/invite/worldofclaudecraft) et quelqu'un se fera un
plaisir de vous aider.

En participant, vous acceptez de respecter notre [code de conduite](../../CODE_OF_CONDUCT.md).

## Façons de contribuer

Il y a une place pour tout le monde ici :

- **Code.** Corrigez un bogue, ajoutez une fonctionnalité ou améliorez les
  performances. Les tickets étiquetés
  [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue)
  et [`help wanted`](https://github.com/levy-street/world-of-claudecraft/labels/help%20wanted)
  sont de bons points de départ.
- **Traductions.** Aidez les joueurs du monde entier en améliorant ou en
  complétant une langue. Voyez [Traduire le jeu](#translating-the-game)
  plus bas. C'est l'une des façons les plus simples et les plus marquantes de se
  lancer.
- **Signalements de bogues et idées de fonctionnalités.** Ouvrez un [ticket](https://github.com/levy-street/world-of-claudecraft/issues/new/choose).
  Un signalement de bogue clair est une vraie contribution.
- **Documentation.** Des guides comme celui-ci, le README et les documents de
  conception dans `docs/` peuvent toujours être améliorés.
- **Tests de jeu et rétroaction.** Jouez au jeu, dites-nous ce qui cloche et
  partagez vos idées sur Discord.

## Pour commencer

Il vous faudra [Node.js 22+](https://nodejs.org/) et npm. Pour le serveur
multijoueur, vous voudrez aussi [Docker](https://www.docker.com/) afin de faire
tourner Postgres.

```bash
# 1. Forkez le dépôt sur GitHub, puis clonez votre fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Installez les dépendances
npm ci

# 3. Lancez le client hors ligne (aucun serveur ni base de données requis)
npm run dev          # ouvrez l'URL affichée (habituellement http://localhost:5173)
```

C'est suffisant pour jouer au monde hors ligne et travailler sur la plupart des
choses. Pour exécuter la pile en ligne au complet :

```bash
npm run db:up        # démarrez Postgres 16 dans Docker (BD de dev sur le port 5433)
npm run server       # compilez et exécutez le serveur de jeu faisant autorité sur :8787
npm run dev          # dans un autre terminal ; le client relaie vers le serveur
```

Le [README](../../README.md) contient le guide complet pour héberger, développer et
jouer, et les fichiers `CLAUDE.md` répartis dans le dépôt documentent les
conventions de chaque secteur.

## Apporter votre modification

1. **Créez une branche** à partir de `main` : `feature/<short-slug>` ou
   `fix/<short-slug>`.
2. **Faites des commits ciblés.** Des changements plus petits et autonomes sont
   plus faciles à réviser et à fusionner que les gros.
3. **Ajoutez ou mettez à jour les tests** pour tout comportement que vous
   modifiez dans `src/sim/` ou `server/`.
4. **Gardez traduisible le texte visible par les joueurs.** Voyez
   [Localisation](#localization) et [Traduire le jeu](#translating-the-game).

### Des choses à garder en tête

Voici les règles porteuses de la base de code. Tout le détail se trouve dans le
[`CLAUDE.md`](../../CLAUDE.md) racine, mais voici la version courte :

- **Le cœur de simulation (`src/sim/`) est la source de vérité**, et il reste
  pur, sans aucun import DOM, fureteur ou Three.js, de sorte que le même code
  exact tourne hors ligne, sur le serveur et dans l'environnement RL sans
  affichage.
- **La simulation est déterministe.** Elle fonctionne à un tick fixe de 20 Hz, et
  tout l'aléatoire passe par `Rng`, jamais par `Math.random`, `Date.now` ou
  `performance.now` dans la logique de sim. La même graine produit toujours le
  même monde.
- **Le calcul de jeu suit les formules de MMO d'antan** (rage, tables de toucher,
  armure, courbes d'XP). Veuillez ne pas inventer de valeurs d'équilibrage.
  Citez plutôt la formule.
- **Ne modifiez pas à la main les fichiers générés** comme les `*.generated.ts`.
  Régénérez-les par la compilation.
- **Ne committez jamais de secrets** ni de fichier `.env`, et n'activez jamais
  `ALLOW_DEV_COMMANDS` dans un chemin de production, puisque ça déverrouille des
  triches.

## Avant d'ouvrir une pull request

Veuillez exécuter ceci localement. Ce sont les mêmes vérifications que la CI
effectue :

```bash
npm test                    # suite Vitest
npx tsc --noEmit            # vérification de types TypeScript (le projet est strict)
npm run build               # build du client de production
```

Si vous avez modifié du code serveur ou sans affichage, exécutez aussi
`npm run build:server` et `npm run build:env`.

Ensuite, testez votre modification sur ordinateur et sur mobile, y compris dans
une fenêtre d'affichage de la taille d'un téléphone, en mode portrait et paysage,
si ça touche quoi que ce soit que les joueurs voient. Les cibles tactiles
devraient rester d'au moins 40x40px et les champs de formulaire avoir une police
d'au moins 16px. Les normes d'interface sont documentées dans
[`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## Ouvrir la pull request

Poussez votre branche et ouvrez une PR vers `main`. Le
[gabarit de pull request](../../.github/PULL_REQUEST_TEMPLATE.md) vous guidera dans une
courte liste de vérification. Veuillez la remplir :

- Décrivez **ce qui** a changé et **pourquoi**.
- Liez tout ticket connexe (par exemple, « Closes #123 »).
- Ajoutez des **captures d'écran ou un clip pour les changements d'interface**,
  sur ordinateur et sur mobile.
- Confirmez que les tests, la vérification de types et le build passent, et que
  les nouvelles chaînes sont traduites.

Une exécution de CI au vert et une liste de vérification complète, voilà ce que
nous cherchons avant de fusionner. Une personne mainteneuse pourrait proposer des
changements. C'est une partie normale et collaborative du processus, pas un refus.
Nous visons à être bienveillants et constructifs en révision, et nous vous
demandons la même chose.

> Les messages de commit et les titres de PR suivent les [Conventional Commits](https://www.conventionalcommits.org/)
> avec un scope là où ça convient (`feat(talents): ...`, `fix(net): ...`). C'est
> une convention que nous aimons plutôt qu'une exigence stricte. Des messages
> clairs et descriptifs comptent plus qu'un formatage parfait.

<a id="localization"></a>

## Localisation

World of ClaudeCraft est offert en plusieurs langues, et nous le gardons ainsi à
mesure que le jeu grandit. Chaque chaîne visible par les joueurs est traduite
dans chaque locale prise en charge.

- Tout le texte destiné à l'utilisateur est une clé `t()` définie dans
  [`src/ui/i18n.ts`](../../src/ui/i18n.ts). Ajoutez d'abord une nouvelle chaîne à la
  locale `en`, puis fournissez une vraie traduction dans chacune des autres
  locales de `supportedLanguages`. Pas d'espaces réservés en anglais, et pas de
  `// TODO`.
- Les nombres, l'argent, les dates, les unités et les pourcentages passent par
  les formateurs (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`)
  plutôt que par un assemblage de chaînes à la main.
- Le texte destiné aux joueurs émis depuis `src/sim/` ou `server/`, qui
  demeurent indépendants de la langue, doit être relocalisé à la frontière du
  client dans la même modification. Le test de garde
  `npx vitest run tests/localization_fixes.test.ts` l'impose.

Si votre modification ajoute une chaîne et que vous ne pouvez l'écrire que dans
certaines langues, ce n'est pas grave. Ouvrez la PR et demandez de l'aide pour le
reste dans la description. Nous préférons de loin vous aider à terminer plutôt que
de vous voir vous retenir.

<a id="translating-the-game"></a>

## Traduire le jeu

Vous voulez améliorer une langue, ou aider à amener le jeu vers une nouvelle ?
Pas besoin d'écrire du code de jeu pour ça :

1. Ouvrez [`src/ui/i18n.ts`](../../src/ui/i18n.ts) et trouvez la locale sur laquelle
   vous voulez travailler. Chaque objet de locale liste les mêmes clés que `en`.
2. Améliorez les traductions existantes, ou complétez celles qui se lisent
   maladroitement.
3. Exécutez `npx tsc --noEmit` pour confirmer que rien ne manque, puis ouvrez une
   PR.

Pour proposer une toute nouvelle locale, ou pour discuter du ton et de la
terminologie, lancez un fil sur [Discord](https://discord.com/invite/worldofclaudecraft) et nous
vous aiderons à tout brancher. Les personnes de langue maternelle et celles qui
parlent couramment sont particulièrement les bienvenues. De bonnes traductions
donnent aux joueurs de partout l'impression d'être chez eux.

## Signaler des bogues et demander des fonctionnalités

Veuillez utiliser les [gabarits de tickets](https://github.com/levy-street/world-of-claudecraft/issues/new/choose) :

- **Signalement de bogue.** Cherchez d'abord parmi les [tickets existants](https://github.com/levy-street/world-of-claudecraft/issues)
  pour éviter les doublons, puis incluez les étapes pour reproduire, ce que vous
  attendiez, ce qui s'est produit, et votre environnement (hors ligne ou en
  ligne, fureteur, ordinateur ou mobile).
- **Demande de fonctionnalité.** Décrivez le problème que vous cherchez à
  résoudre, pas seulement la solution. Le contexte nous aide à concevoir la bonne
  chose.

## Obtenir de l'aide

Vous êtes coincé, ou vous voulez simplement dire bonjour ? Rejoignez le
[Discord de la communauté](https://discord.com/invite/worldofclaudecraft). Aucune question n'est
trop petite, et les nouvelles personnes qui contribuent sont toujours les
bienvenues.

## Licence

En contribuant, vous acceptez que vos contributions soient placées sous la
[licence MIT](../../LICENSE) du projet, la même licence qui couvre le projet.

---

Merci de contribuer à World of ClaudeCraft. Nous avons hâte de voir ce que vous
bâtirez avec nous.
