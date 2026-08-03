<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · **Français (Canada)** · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Čeština](CONTRIBUTING.cs_CZ.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

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

Il vous faudra [Node.js 26](https://nodejs.org/) et **pnpm 10.34.x** (la version exacte est dans `package.json` sous `packageManager`, aujourd'hui `pnpm@10.34.5`). Les majeures Node plus anciennes ne sont pas testées. Pour le serveur multijoueur, vous voudrez aussi [Docker](https://www.docker.com/) pour faire tourner Postgres.

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

C'est suffisant pour jouer au monde hors ligne et travailler sur la plupart des
choses. Pour exécuter la pile en ligne au complet, il vous faut d'abord un mot de
passe de base de données dans votre environnement :

```bash
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
pnpm run db:up       # start Postgres 16 in Docker (dev DB on port 5433)
pnpm run server      # build and run the authoritative game server on :8787
pnpm run dev         # in another terminal; the client proxies to the server
```

Si vous prévoyez d'exécuter le gate complet décrit plus bas, installez une fois le
fureteur qu'il pilote : `pnpm exec playwright install chromium`.

Le [README](../../README.md) contient le guide complet pour héberger, développer et
jouer, et les fichiers `CLAUDE.md` répartis dans le dépôt documentent les
conventions de chaque secteur.

### Chaîne d'outils TypeScript

La vérification de types tourne sur TypeScript 7, le compilateur natif :
`npx tsc --noEmit` fonctionne exactement comme avant et une vérification complète
du dépôt prend maintenant quelques secondes plutôt que des dizaines de secondes.
L'installation utilise le double alias officiel : le paquet `typescript` résout
l'API JS de TypeScript 6 (via l'enveloppe `@typescript/typescript6`) parce que
`svelte-check` consomme encore cette API, tandis que `@typescript/native` fournit
le binaire `tsc`. À savoir :

- **Éditeurs.** VS Code a besoin de l'extension « TypeScript 7 » de la place de
  marché (`TypeScriptTeam.native-preview`) pour la prise en charge du service de
  langage natif tant que la prise en charge intégrée n'est pas livrée ; elle
  s'active par le réglage `js/ts.experimental.useTsgo`, et sa commande « Disable
  TypeScript 7 Language Server » est le repli sanctionné vers le tsserver de
  TypeScript 6. Les EDI JetBrains ne détectent automatiquement le serveur natif
  que sous le nom de paquet `@typescript/native-preview` ; ils ne le prendront
  donc pas depuis l'alias `@typescript/native` de ce dépôt, mais leur prise en
  charge intégrée de TypeScript 6 fonctionne très bien.
- **Options `tsc` utiles.** `--checkers N` fixe le nombre de processus de
  vérification de types en parallèle (4 par défaut ; les résultats sont
  identiques quel que soit le nombre) : abaissez-le pour plafonner la mémoire sur
  un exécuteur contraint, augmentez-le sur une machine à plusieurs cœurs, et
  mesurez dans les deux cas, puisque plus n'est pas toujours plus rapide.
  `--singleThreaded` désactive tout parallélisme. Vérifier un seul fichier à la
  volée (`npx tsc somefile.ts`) échoue quand le répertoire contient un
  `tsconfig.json` ; passez `--ignoreConfig` pour retrouver l'ancien comportement.
- **Fichier de verrouillage.** Le lockfile est `pnpm-lock.yaml` (pnpm 10 / lockfileVersion 9). Mettez-le à jour uniquement avec `pnpm install`, `pnpm add` ou `pnpm update` depuis la racine de ce dépôt (jamais à la main). Committez `pnpm-lock.yaml` avec les changements de `package.json`. CI installe avec `pnpm install --frozen-lockfile`; un lockfile périmé échoue. N'introduisez pas un second lockfile (`package-lock.json` / yarn.lock) : les lockfiles doubles divergent en silence et sont interdits. Le bruit de dépendances pairs des arbres wallet/solana optionnels est toléré via `.npmrc` (`strict-peer-dependencies=false`); ne l'assouplissez pas davantage sans mesurer.
- **Quand y revenir.** Ramenez le double alias à une seule dépendance
  `typescript` une fois que les DEUX conditions tiennent : l'API JS stable de
  TypeScript 7.1 est livrée (TypeScript 7.0 ne livre aucune API JS ; le
  remplacement est suivi dans le ticket 2824 de microsoft/typescript-go), et le
  ticket 3063 de sveltejs/language-tools est fermé avec un `svelte-check` publié
  qui l'adopte. Les modes expérimentaux `--tsgo` de svelte-check ne lèvent pas
  son exigence d'API TypeScript 6, et son chargement de TypeScript 7 en cours
  (PR 3073 de language-tools) lit l'alias `@typescript/native` que ce dépôt
  utilise déjà, donc aucun renommage n'est nécessaire.

## Apporter votre modification

1. **Partez de la dernière branche de version, jamais de `main`.** Le travail
   actif est intégré sur une branche `release/vX.Y.Z` ; `main` la suit de loin et
   n'est pas la base des contributions. Trouvez la plus récente et créez votre
   branche à partir d'elle :

   ```bash
   git fetch origin
   git branch -r --list 'origin/release/*' | sort -V | tail -1   # the newest release branch
   git switch -c feature/<short-slug> origin/release/vX.Y.Z
   ```

   Exécutez toujours cette recherche plutôt que de recopier un numéro de version
   tiré de ce guide : les branches de version se renouvellent souvent, et la plus
   récente change à chaque livraison. Les branches sont nommées
   `feature/<short-slug>` ou `fix/<short-slug>`.
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
- **La nouvelle logique arrive sous forme de petit module testé derrière une
  couture existante**, plutôt qu'ajoutée à l'un des gros fichiers coordinateurs.
  Les données que lisent le moteur de rendu ou le HUD traversent l'interface
  `IWorld` (`src/world_api/`) et sont implémentées dans les deux mondes, hors
  ligne et en ligne ; un nouveau système de simulation passe derrière
  `SimContext` ; un nouveau point de terminaison REST est un module de route que
  vous pouvez générer avec `pnpm run new:endpoint`.
- **Ne modifiez pas à la main les fichiers générés** comme les `*.generated.ts`.
  Régénérez-les par la compilation.
- **Style de rédaction maison : aucun tiret cadratin, tiret demi-cadratin ni
  émoji** nulle part, ni dans le code, les commentaires, la documentation, les
  messages de commit, le texte des PR ou les textes destinés aux joueurs. Servez-vous
  de virgules, de deux-points, de parenthèses, ou de « à » pour les intervalles.
  Une vérification avant le push analyse votre diff et bloque le push en cas de
  correspondance.
- **Ne committez jamais de secrets** ni de fichier `.env`, et n'activez jamais
  `ALLOW_DEV_COMMANDS` dans un chemin de production, puisque ça déverrouille des
  triches.

### Style de code

Le formatage est assuré par [Biome](https://biomejs.dev/), configuré dans
`biome.json` : indentation de 2 espaces, lignes de 100 colonnes, guillemets
simples, virgules finales. Ne formatez que les fichiers que vous avez touchés
(`npx @biomejs/biome check --write <your-file.ts>`) et vérifiez-les avec
`pnpm run ci:changed`. La CI ne contrôle que les fichiers modifiés, alors veuillez
ne pas reformater le reste de l'arbre : une exécution à l'échelle du dépôt fait
remonter une dette de longue date qu'il ne vous revient pas de corriger.

## Avant d'ouvrir une pull request

Exécutez le gate du dépôt localement. C'est le même contrat que la CI applique :

```bash
pnpm run gate
```

Pendant que vous itérez, lancez une seule suite (`npx vitest run tests/sim.test.ts`)
et `pnpm run ci:changed` pour le formatage ; `pnpm test` exécute tout, et la carte
des suites se trouve dans `tests/CLAUDE.md`. Le `pnpm run gate` complet couvre la
fraîcheur des artefacts générés, l'analyse antimaliciel, le formatage des fichiers
modifiés, la vérification de conformité des effets sonores, la suite de tests au
complet, une passe de régression en fureteur réel, la vérification de types
stricte, ainsi que les builds du client, du serveur et du mode sans affichage. Les
vérifications en couches, à partir du plancher avant le push, sont décrites dans
[`docs/qa-gate.md`](../qa-gate.md).

Ensuite, testez votre modification sur ordinateur et sur mobile, y compris dans
une fenêtre d'affichage de la taille d'un téléphone, en mode portrait et paysage,
si ça touche quoi que ce soit que les joueurs voient. Les cibles tactiles
devraient rester d'au moins 40x40px et les champs de formulaire avoir une police
d'au moins 16px. Les normes d'interface sont documentées dans
[`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## Ouvrir la pull request

Poussez votre branche et ouvrez une PR **visant la même dernière branche
`release/vX.Y.Z` que celle d'où vous êtes parti. Ne visez jamais `main`**, qui est
une branche d'intégration au moment des versions plutôt que la base des
contributions. GitHub présélectionne souvent `main` pour vous, alors changez la
branche de base avant de soumettre. Le
[gabarit de pull request](../../.github/PULL_REQUEST_TEMPLATE.md) vous guidera dans une
courte liste de vérification. Veuillez la remplir :

- Décrivez **ce qui** a changé et **pourquoi**.
- Liez tout ticket connexe (par exemple, « Closes #123 »).
- Ajoutez des **captures d'écran ou un clip pour les changements d'interface**,
  sur ordinateur et sur mobile.
- Confirmez que `pnpm run gate` passe et que les nouvelles chaînes destinées aux
  joueurs suivent la politique « l'anglais d'abord » pour les contributions,
  décrite plus bas.

Sur votre PR, la CI exécute le formatage et le linting sur vos fichiers modifiés,
la suite de tests complète répartie sur quatre fragments parallèles, une passe de
régression en fureteur, ainsi que la vérification de types et les builds du client,
du serveur et du mode sans affichage. Ça correspond à ce que `pnpm run gate` exécute
localement, donc un gate au vert est un bon indicateur d'une PR au vert.

Une exécution de CI au vert et une liste de vérification complète, voilà ce que
nous cherchons avant de fusionner. Une personne mainteneuse pourrait proposer des
changements. C'est une partie normale et collaborative du processus, pas un refus.
Nous visons à être bienveillants et constructifs en révision, et nous vous
demandons la même chose.

> Les messages de commit et les titres de PR suivent les [Conventional Commits](https://www.conventionalcommits.org/)
> avec un scope (`feat(talents): ...`, `fix(net): ...`). Chaque commit porte aussi
> un corps : après une ligne vide, de une à quatre phrases simples disant ce qui a
> changé et pourquoi, avec un retour à la ligne vers 72 colonnes. Un titre seul ne
> suffit pas.

<a id="localization"></a>

## Localisation

World of ClaudeCraft est offert en plusieurs langues. Chaque chaîne visible par
les joueurs doit être une clé de traduction, alors que les personnes qui
contribuent une fonctionnalité n'ajoutent normalement que la source anglaise.

- Tout le texte destiné à l'utilisateur est une clé `t()`. Ajoutez la nouvelle
  copie anglaise au module par domaine correspondant sous
  [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) (le nouvel habillage du HUD
  va dans `hud_chrome.ts`), puis affichez-la avec `t('dotted.key', values)`.
  L'anglais seul est exactement ce qu'il faut pour une PR de fonctionnalité : la
  personne mainteneuse remplit les autres locales au moment de la version, donc
  vous ne modifiez pas les surcouches de `src/ui/i18n.locales/` et vous n'y
  laissez jamais un espace réservé en anglais ni un `// TODO`. L'exception M16 est
  une nouvelle valeur anglaise verbeuse, qui exige aussi les cinq remplissages non
  latins décrits dans [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).
- Les nombres, l'argent, les dates, les unités et les pourcentages passent par
  les formateurs (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`)
  plutôt que par un assemblage de chaînes à la main.
- Le texte destiné aux joueurs émis depuis `src/sim/` ou `server/`, qui
  demeurent indépendants de la langue, doit être relocalisé à la frontière du
  client dans la même modification. Le test de garde
  `npx vitest run tests/localization_fixes.test.ts` l'impose.
- Après avoir ajouté ou modifié une chaîne, exécutez `pnpm run i18n:gen` et
  committez les paquets régénérés dans la même modification. Le gate et la CI
  comparent tous deux les artefacts committés à une régénération fraîche, donc un
  paquet périmé fait échouer la compilation.

Ajoutez donc vos chaînes en anglais et ouvrez la PR ; vous n'avez pas à les
traduire vous-même. Si vous aimeriez donner un coup de main du côté des
traductions, voyez la section suivante.

<a id="translating-the-game"></a>

## Traduire le jeu

Vous voulez améliorer une langue, ou aider à amener le jeu vers une nouvelle ?
Pas besoin d'écrire du code de jeu pour ça :

1. La plupart des traductions destinées aux joueurs vivent dans les fichiers de
   surcouche par langue sous
   [`src/ui/i18n.locales/`](../../src/ui/i18n.locales/) (un par locale), qui
   reflètent les clés anglaises de
   [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/). Le texte émis par la
   simulation et le serveur se traduit dans `src/ui/sim_i18n.ts` et
   `src/ui/server_i18n.ts`, la copie des talents dans les modules `talent_i18n`,
   et le tableau de bord d'administration a son propre jeu sous
   `src/admin/i18n.locales/`.
2. Améliorez les traductions existantes, ou complétez celles qui se lisent
   maladroitement.
3. Exécutez `pnpm run i18n:gen`, committez les paquets régénérés en même temps que
   votre modification de surcouche, puis exécutez les suites de localisation
   (`npx vitest run tests/i18n_completeness.test.ts tests/localization_coverage.test.ts`)
   et ouvrez une PR. Une vérification de types seule ne vous dira pas si une clé
   manque, puisque les surcouches sont volontairement clairsemées.

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
- **Vulnérabilités de sécurité.** Veuillez ne pas ouvrir de ticket public.
  Signalez-les en privé en suivant [SECURITY.md](../../SECURITY.md), et nous
  travaillerons avec vous sur un correctif et sur la divulgation.

## Obtenir de l'aide

Vous êtes coincé, ou vous voulez simplement dire bonjour ? Rejoignez le
[Discord de la communauté](https://discord.com/invite/worldofclaudecraft). Aucune question n'est
trop petite, et les nouvelles personnes qui contribuent sont toujours les
bienvenues.

## Licence

En contribuant du code, vous acceptez que vos contributions de code soient
placées sous la [licence MIT](../../LICENSE) du projet, la même licence qui couvre
le projet.

La licence MIT dit ce qu'elle dit : n'importe qui peut utiliser, modifier et
redistribuer le code, à des fins commerciales ou non. Nos
[conditions d'utilisation](https://worldofclaudecraft.com/terms) régissent le jeu
hébergé que nous exploitons à worldofclaudecraft.com (comptes, conduite, objets
virtuels) et ne restreignent pas les droits que la licence MIT vous donne, à vous
ou à quiconque, sur ce code. Les noms et l'image de marque « World of ClaudeCraft »
et « Levy Street » ne sont pas couverts par la licence MIT.

Les ressources créatives originales (enregistrements sonores, musique, art et
œuvres du même genre) font exception. Si vous contribuez une ressource originale
que vous avez créée, vous pouvez plutôt conserver le droit d'auteur et la
contribuer sous la licence de votre choix (par exemple CC BY-NC 4.0), à condition
que :

- la licence, les chemins de ressources qu'elle couvre et votre attribution
  soient consignés dans le tableau des licences de
  [CREDITS.md](../../CREDITS.md) dans le cadre de la même pull request, et
- elle inclue au minimum une concession perpétuelle et libre de redevances à Levy
  Street pour utiliser les ressources commercialement dans World of ClaudeCraft,
  y compris les versions officielles et la boutique en jeu.

Pour les ressources listées dans le tableau de CREDITS.md, cette licence
consignée prévaut sur la licence MIT par défaut du projet.

**Les ressources média sans entrée dans CREDITS.md ne sont pas sous licence MIT.**
Le registre est encore en cours de constitution, donc une entrée manquante
signifie que les conditions ne sont pas consignées, pas que la ressource est libre
d'être prise. C'est délibéré : ça empêche qu'une contribution non enregistrée soit
donnée par défaut. Le code fonctionne à l'inverse, et tout ce qui n'est pas mis à
part dans CREDITS.md est sous MIT.

C'est exactement pourquoi l'entrée au registre n'est pas de la paperasse
facultative. Si vous contribuez une ressource sans ligne dans CREDITS.md,
personne en aval ne peut l'utiliser et nous n'avons aucune trace de ce que vous
nous avez concédé. Remplissez aussi honnêtement la colonne **Redistribution**.
C'est elle qui indique à quelqu'un qui forke ce projet s'il peut transmettre
votre ressource, et certaines lignes portent la mention « No, permission
required » précisément parce qu'elles ne le permettent pas.

---

Merci de contribuer à World of ClaudeCraft. Nous avons hâte de voir ce que vous
bâtirez avec nous.
