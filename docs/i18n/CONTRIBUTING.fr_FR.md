<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · **Français** · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Čeština](CONTRIBUTING.cs_CZ.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

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

Vous aurez besoin de [Node.js 26](https://nodejs.org/) et de **pnpm 10.34.x** (version exacte dans `package.json` sous `packageManager`, aujourd'hui `pnpm@10.34.5`). Les majeures Node plus anciennes ne sont pas testées. Pour le serveur multijoueur, prévoyez aussi [Docker](https://www.docker.com/) pour faire tourner Postgres.

**Corepack n'est pas requis.** Installez pnpm une fois avec le npm livré avec Node. Le même chemin fonctionne sur macOS, Linux et Windows.

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Install pnpm once (same command on macOS, Linux, Windows)
#    Match the packageManager pin in package.json (today: 10.34.5).
npm install -g pnpm@10.34.5
pnpm --version   # should print 10.34.5 (or the pin in package.json)

# 3. Install dependencies (uses the global content-addressable store)
pnpm install --frozen-lockfile

# 4. Point git at the repository hooks (once per clone)
git config core.hooksPath .githooks

# 5. Run the offline client (no server or database needed)
pnpm run dev         # open the URL it prints (usually http://localhost:5173)
```

`npm run <script>` fonctionne encore après une installation pnpm (Node fournit npm), mais **les installations et les mises à jour du lockfile doivent passer par pnpm**. Ne committez pas de `package-lock.json`; la seule source de vérité est `pnpm-lock.yaml`.

Cela suffit pour jouer au monde hors ligne et travailler sur la plupart des choses.
Pour lancer la stack en ligne complète, il vous faut d'abord un mot de passe de base
de données dans votre environnement :

```bash
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
pnpm run db:up       # start Postgres 16 in Docker (dev DB on port 5433)
pnpm run server      # build and run the authoritative game server on :8787
pnpm run dev         # in another terminal; the client proxies to the server
```

Si vous comptez lancer le gate complet décrit plus bas, installez une fois le
navigateur qu'il pilote : `pnpm exec playwright install chromium`.

Le [README](README.fr_FR.md) contient le guide complet d'hébergement, de développement et
de jeu, et les fichiers `CLAUDE.md` répartis dans le dépôt documentent les
conventions de chaque domaine.

### Chaîne d'outils TypeScript

La vérification de types tourne sur TypeScript 7, le compilateur natif :
`npx tsc --noEmit` fonctionne exactement comme avant et une vérification complète du
dépôt prend désormais quelques secondes au lieu de plusieurs dizaines de secondes.
L'installation utilise le double alias officiel : le paquet `typescript` résout l'API
JS de TypeScript 6 (via le wrapper `@typescript/typescript6`) parce que
`svelte-check` consomme encore cette API, tandis que `@typescript/native` fournit le
binaire `tsc`. Ce qu'il faut savoir :

- **Les éditeurs.** VS Code a besoin de l'extension « TypeScript 7 » de la
  marketplace (`TypeScriptTeam.native-preview`) pour la prise en charge du service
  de langage natif, en attendant que le support intégré arrive ; elle s'active via le
  réglage `js/ts.experimental.useTsgo`, et sa commande « Disable TypeScript 7
  Language Server » est le repli officiel vers le tsserver de TypeScript 6. Les IDE
  JetBrains ne détectent automatiquement le serveur natif que sous le nom de paquet
  `@typescript/native-preview`, ils ne le reconnaîtront donc pas depuis l'alias
  `@typescript/native` de ce dépôt ; leur prise en charge intégrée de TypeScript 6
  fonctionne très bien.
- **Options utiles de tsc.** `--checkers N` fixe le nombre de workers de vérification
  de types en parallèle (4 par défaut ; les résultats sont identiques quel que soit le
  nombre) : baissez-le pour limiter la mémoire sur un runner contraint, augmentez-le
  sur une machine à nombreux cœurs, et mesurez dans les deux cas, car plus n'est pas
  toujours plus rapide. `--singleThreaded` désactive tout parallélisme. Vérifier un
  seul fichier à la volée (`npx tsc somefile.ts`) échoue quand le répertoire contient
  un `tsconfig.json` ; passez `--ignoreConfig` pour retrouver l'ancien comportement.
- **Le lockfile.** Le lockfile est `pnpm-lock.yaml` (pnpm 10 / lockfileVersion 9). Mettez-le à jour uniquement avec `pnpm install`, `pnpm add` ou `pnpm update` depuis la racine de ce dépôt (jamais à la main). Committez `pnpm-lock.yaml` avec les changements de `package.json`. CI installe avec `pnpm install --frozen-lockfile`; un lockfile périmé échoue. N'introduisez pas un second lockfile (`package-lock.json` / yarn.lock) : les lockfiles doubles divergent en silence et sont interdits. Le bruit de dépendances pairs des arbres wallet/solana optionnels est toléré via `.npmrc` (`strict-peer-dependencies=false`); ne l'assouplissez pas davantage sans mesurer.
- **Quand y revenir.** Ramenez le double alias à une seule dépendance `typescript`
  une fois que les DEUX conditions sont remplies : l'API JS stable de TypeScript 7.1
  est publiée (TypeScript 7.0 ne fournit aucune API JS ; le remplacement est suivi
  dans le ticket 2824 de microsoft/typescript-go), et le ticket 3063 de
  sveltejs/language-tools est clos avec une version publiée de `svelte-check` qui
  l'adopte. Les modes expérimentaux `--tsgo` de svelte-check ne lèvent pas son besoin
  de l'API TypeScript 6, et son chargement de TypeScript 7 en cours de développement
  (PR 3073 de language-tools) lit l'alias `@typescript/native` que ce dépôt utilise
  déjà, aucun renommage n'est donc nécessaire.

## Réaliser votre modification

1. **Partez de la dernière branche de release, jamais de `main`.** Le travail en cours
   est intégré sur une branche `release/vX.Y.Z` ; `main` est en retard sur elle et n'est
   pas la base des contributions. Trouvez la plus récente et créez votre branche
   depuis celle-ci :

   ```bash
   git fetch origin
   git branch -r --list 'origin/release/*' | sort -V | tail -1   # la branche de release la plus récente
   git switch -c feature/<short-slug> origin/release/vX.Y.Z
   ```

   Lancez toujours cette recherche plutôt que de recopier un numéro de version depuis
   ce guide : les branches de release se renouvellent souvent, et la plus récente
   change à chaque publication. Les branches sont nommées `feature/<short-slug>` ou
   `fix/<short-slug>`.
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
- **Toute nouvelle logique arrive sous la forme de son propre petit module testé
  derrière une couture existante**, plutôt que d'être ajoutée à l'un des gros
  fichiers coordinateurs. Les données que lisent le moteur de rendu ou le HUD
  traversent l'interface `IWorld` (`src/world_api/`) et sont implémentées dans les
  deux mondes, hors ligne et en ligne ; un nouveau système de simulation passe
  derrière `SimContext` ; un nouveau point d'entrée REST est un module de route que
  vous pouvez générer avec `pnpm run new:endpoint`.
- **Ne modifiez pas à la main les fichiers générés** comme `*.generated.ts`.
  Régénérez-les via la compilation.
- **Style rédactionnel de la maison : aucun tiret cadratin, tiret demi-cadratin ni
  emoji** nulle part, ni dans le code, les commentaires, la documentation, les
  messages de commit, le texte des PR ou les textes destinés aux joueurs. Utilisez
  des virgules, des deux-points, des parenthèses, ou « à » pour les intervalles. Une
  vérification avant push analyse votre diff et bloque le push en cas de détection.
- **Ne committez jamais de secrets** ni de fichier `.env`, et n'activez jamais
  `ALLOW_DEV_COMMANDS` dans un chemin de production, car cela débloque des triches.

### Style de code

Le formatage est assuré par [Biome](https://biomejs.dev/), configuré dans
`biome.json` : indentation de 2 espaces, lignes de 100 colonnes, guillemets simples,
virgules finales. Ne formatez que les fichiers que vous avez touchés
(`npx @biomejs/biome check --write <your-file.ts>`) et vérifiez-les avec
`pnpm run ci:changed`. La CI ne contrôle que les fichiers modifiés, merci donc de ne
pas reformater le reste de l'arborescence : une exécution sur tout le dépôt fait
remonter une dette ancienne qu'il ne vous revient pas de corriger.

## Avant d'ouvrir une pull request

Lancez le gate du dépôt en local. C'est le même contrat que celui appliqué par la CI :

```bash
pnpm run gate
```

Pendant que vous itérez, lancez une seule suite (`npx vitest run tests/sim.test.ts`)
et `pnpm run ci:changed` pour le formatage ; `pnpm test` exécute tout, et la carte des
suites se trouve dans `tests/CLAUDE.md`. Le `pnpm run gate` complet couvre la
fraîcheur des artefacts générés, le scan anti-malware, le formatage des fichiers
modifiés, la vérification de conformité des effets sonores, l'ensemble de la suite de
tests, une passe de régression dans un vrai navigateur, la vérification de types
stricte, ainsi que les builds client, serveur et headless. Les vérifications en
couches, à partir du socle avant push, sont décrites dans
[`docs/qa-gate.md`](../qa-gate.md).

Ensuite, testez votre modification à la fois sur ordinateur et sur mobile, y compris
sur une fenêtre de la taille d'un téléphone en portrait et en paysage, si elle touche
à quoi que ce soit que les joueurs voient. Les cibles tactiles doivent rester d'au
moins 40x40px et les champs de formulaire d'au moins 16px de police. Les standards de
l'interface sont documentés dans [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## Ouvrir la pull request

Poussez votre branche et ouvrez une PR **visant la même dernière branche
`release/vX.Y.Z` que celle dont vous êtes parti. Ne visez jamais `main`**, qui est une
branche d'intégration au moment de la release plutôt que la base des contributions.
GitHub présélectionne souvent `main` pour vous, changez donc la branche de base avant
de soumettre. Le
[modèle de pull request](../../.github/PULL_REQUEST_TEMPLATE.md) vous guidera à travers une
courte liste de vérifications. Merci de la remplir :

- Décrivez **ce qui** a changé et **pourquoi**.
- Reliez tout ticket associé (par exemple, « Closes #123 »).
- Ajoutez des **captures d'écran ou un clip pour les changements d'interface**, sur
  ordinateur et sur mobile.
- Confirmez que `pnpm run gate` passe et que les nouveaux textes destinés aux joueurs
  suivent la politique « anglais d'abord » pour les contributeurs décrite plus bas.

Sur votre PR, la CI exécute le formatage et le linting sur vos fichiers modifiés, la
suite de tests complète répartie sur quatre shards parallèles, une passe de
régression navigateur, ainsi que la vérification de types et les builds client,
serveur et headless. Cela correspond à ce que `pnpm run gate` lance en local, un gate
au vert est donc un bon indicateur d'une PR au vert.

Une CI au vert et une liste de vérifications complète sont ce que nous regardons avant
de fusionner. Un mainteneur peut suggérer des changements. C'est une étape normale et
collaborative du processus, pas un refus. Nous cherchons à être bienveillants et
constructifs lors de la relecture, et nous vous demandons d'en faire autant.

> Les messages de commit et les titres de PR suivent les [Conventional Commits](https://www.conventionalcommits.org/)
> avec une portée (`feat(talents): ...`, `fix(net): ...`). Chaque commit porte aussi un
> corps : après une ligne vide, une à quatre phrases simples disant ce qui a changé et
> pourquoi, avec un retour à la ligne autour de 72 colonnes. Un titre seul ne suffit pas.

<a id="localization"></a>

## Localisation

World of ClaudeCraft est disponible dans de nombreuses langues. Chaque texte visible
par les joueurs doit être une clé de traduction, tandis que les contributeurs de
fonctionnalités n'ajoutent normalement que la source anglaise.

- Tout texte destiné à l'utilisateur est une clé `t()`. Ajoutez le nouveau texte
  anglais au module par domaine correspondant sous
  [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) (les nouveaux éléments de
  décor du HUD vont dans `hud_chrome.ts`), puis affichez-le avec
  `t('dotted.key', values)`. Fournir uniquement l'anglais est exactement ce qu'il faut
  pour une PR de fonctionnalité : le mainteneur remplit les autres langues au moment
  de la release, vous ne modifiez donc pas les surcouches `src/ui/i18n.locales/` et
  vous n'y laissez jamais de texte anglais provisoire ni de `// TODO`. L'exception M16
  concerne une nouvelle valeur anglaise verbeuse, qui nécessite aussi les cinq
  remplissages non latins décrits dans
  [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).
- Les nombres, les sommes d'argent, les dates, les unités et les pourcentages passent
  par les formateurs (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`) plutôt
  que par une construction manuelle de chaînes.
- Le texte destiné aux joueurs émis depuis `src/sim/` ou `server/`, qui restent
  indépendants de la langue, doit être relocalisé à la frontière du client dans la
  même modification. Le test de garde `npx vitest run tests/localization_fixes.test.ts`
  le vérifie.
- Après avoir ajouté ou modifié un texte, lancez `pnpm run i18n:gen` et committez les
  bundles régénérés dans la même modification. Le gate et la CI comparent tous deux
  les artefacts committés à une régénération fraîche, un bundle périmé fait donc
  échouer la compilation.

Ajoutez donc vos textes en anglais et ouvrez la PR ; vous n'avez pas besoin de les
traduire vous-même. Si vous souhaitez aider pour les traductions, voir la section
suivante.

<a id="translating-the-game"></a>

## Traduire le jeu

Vous voulez améliorer une langue, ou aider à porter le jeu dans une nouvelle ? Pas
besoin d'écrire la moindre ligne de code du jeu pour cela :

1. La plupart des traductions destinées aux joueurs se trouvent dans les fichiers de
   surcouche par langue sous
   [`src/ui/i18n.locales/`](../../src/ui/i18n.locales/) (un par langue), qui reflètent
   les clés anglaises de [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/). Le texte
   émis par la simulation et le serveur est traduit dans `src/ui/sim_i18n.ts` et
   `src/ui/server_i18n.ts`, les textes de talents dans les modules `talent_i18n`, et le
   tableau de bord d'administration possède son propre ensemble sous
   `src/admin/i18n.locales/`.
2. Améliorez les traductions existantes, ou complétez celles qui sonnent maladroites.
3. Lancez `pnpm run i18n:gen`, committez les bundles régénérés avec votre modification
   de surcouche, puis lancez les suites de localisation
   (`npx vitest run tests/i18n_completeness.test.ts tests/localization_coverage.test.ts`)
   et ouvrez une PR. Une simple vérification de types ne vous dira pas si une clé
   manque, car les surcouches sont volontairement partielles.

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
- **Vulnérabilités de sécurité.** Merci de ne pas ouvrir de ticket public.
  Signalez-les en privé en suivant [SECURITY.md](../../SECURITY.md), et nous
  travaillerons avec vous sur un correctif et sur la divulgation.

## Obtenir de l'aide

Bloqué, ou vous voulez juste dire bonjour ? Rejoignez le
[Discord de la communauté](https://discord.com/invite/worldofclaudecraft). Aucune question n'est trop
petite, et les nouveaux contributeurs sont toujours les bienvenus.

## Licence

En contribuant du code, vous acceptez que vos contributions de code soient placées
sous la [Licence MIT](../../LICENSE) du projet, la même licence qui couvre le projet.

La Licence MIT dit exactement ce qu'elle dit : n'importe qui peut utiliser, modifier
et redistribuer le code, à des fins commerciales ou non. Nos
[Conditions d'utilisation](https://worldofclaudecraft.com/terms) régissent le jeu
hébergé que nous exploitons sur worldofclaudecraft.com (comptes, conduite, objets
virtuels) et ne restreignent pas les droits que la Licence MIT vous donne, à vous ou
à quiconque, sur ce code. Les noms et l'identité visuelle « World of ClaudeCraft » et
« Levy Street » ne sont pas couverts par la Licence MIT.

Les ressources créatives originales (enregistrements sonores, musique, illustrations
et autres œuvres du même type) font exception. Si vous contribuez une ressource
originale que vous avez créée, vous pouvez à la place en conserver le droit d'auteur
et la fournir sous une licence de votre choix (par exemple CC BY-NC 4.0), à condition
que :

- la licence, les chemins des ressources qu'elle couvre et votre attribution soient
  consignés dans le tableau des licences de [CREDITS.md](../../CREDITS.md) dans le
  cadre de la même pull request, et
- elle inclue au minimum une concession perpétuelle et libre de redevances à Levy
  Street pour utiliser les ressources commercialement dans World of ClaudeCraft, y
  compris dans les versions officielles et la boutique en jeu.

Pour les ressources listées dans le tableau de CREDITS.md, cette licence consignée
prime sur la licence MIT par défaut du projet.

**Les ressources média sans entrée dans CREDITS.md ne sont pas sous licence MIT.** Le
registre est encore en cours de complétion, donc une entrée manquante signifie que
les conditions ne sont pas consignées, pas que la ressource est libre de droits.
C'est délibéré : cela évite qu'une contribution non enregistrée soit cédée par
défaut. Pour le code, c'est l'inverse, et tout ce qui n'est pas exclu dans CREDITS.md
est sous MIT.

C'est exactement pour cela que l'entrée au registre n'est pas une formalité
optionnelle. Si vous contribuez une ressource sans ligne dans CREDITS.md, personne en
aval ne peut l'utiliser et nous n'avons aucune trace de ce que vous nous avez
concédé. Renseignez aussi honnêtement la colonne **Redistribution**. C'est elle qui
indique à quelqu'un qui forke ce projet s'il peut transmettre votre ressource, et
certaines lignes portent la mention « No, permission required » précisément parce que
ce n'est pas le cas.

---

Merci de contribuer à World of ClaudeCraft. Nous avons hâte de voir ce que vous
construirez avec nous.
