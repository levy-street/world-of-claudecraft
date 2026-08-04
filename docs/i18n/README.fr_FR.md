<div align="center">

# World of ClaudeCraft

**Partez en quête, formez un groupe et affrontez des raids dans un monde fait main, gratuitement dans votre navigateur. Open source, web3 et en ligne dès maintenant.**

**Site officiel : https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.34.0-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.fr_FR.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · **Français** · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Čeština](README.cs_CZ.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Jouer maintenant](https://worldofclaudecraft.com/) · [Héberger votre propre monde](#host-your-own-world-one-command) · [Entraîner un agent](#train-an-agent-headless-rl) · [Web3](#web3) · [Contribuer](CONTRIBUTING.fr_FR.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![Écran-titre de World of ClaudeCraft](../../docs/screenshots/title-screen.jpg)

</div>

## Présentation

World of ClaudeCraft est un MMO complet d'inspiration classique auquel vous pouvez jouer dès maintenant dans votre navigateur, que vous pouvez héberger vous-même en une seule commande, et qui vous permet même d'entraîner des agents IA à y jouer. Il est gratuit, open source, et en ligne sur [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Un même monde partagé tourne à trois endroits, tous issus du même cœur de jeu :

- le **serveur multijoueur autoritaire**, le monde vivant auquel vous jouez sur worldofclaudecraft.com, où des comptes stockés dans Postgres partagent un seul royaume persistant,
- le **monde navigateur hors ligne**, un `Sim` local solo fourni par le serveur de développement, utile pour développer et pour lire le cœur de jeu de bout en bout,
- l'**environnement RL headless**, où Python pilote le vrai jeu via une interface Gym.

Même graine, même monde, partout. Une grande partie de ce que vous voyez est encore dessinée à partir du code à l'exécution, et le reste est un ensemble d'assets sélectionnés livré avec le projet, si bien qu'un fork tourne sans configuration.

## Points forts

- **Neuf classes classiques**, chacune dotée d'une véritable panoplie d'inspiration classique qui gagne des rangs à mesure que vous montez en niveau, plus un **système de talents** complet (trois spécialisations par classe, 27 spécialisations en tout).
- **Trois zones en monde ouvert** du niveau 1 au niveau 20, plus de 90 quêtes, et une seule trame narrative reliée autour de la conspiration des Gravecaller.
- **Cinq donjons instanciés**, dont quatre raids d'élite à cinq joueurs et une crypte en solo, avec une mise à l'échelle d'élite, des mécaniques de boss à dégâts de zone, du butin propre à chaque archétype de classe qui se rassemble en sets de palier, et un **palier de difficulté Héroïque** aux récompenses plus riches, plus des **world bosses** en monde ouvert et un final de raid à dix joueurs.
- **Deux delves évolutives**, un mode pour petit groupe à un ou deux joueurs accompagnés d'un compagnon IA, reconstruites à partir de salles aléatoires à chaque partie, sur les paliers Normal et Héroïque.
- **JcJ classé** sur deux cartes d'arène : classements 1c1 et 2c2, un mode 2c2 Fiesta plus animé, et **Protect Yumi**, un mode à objectif en 3c3 et 5c5. Le jeu classé rapporte de l'Honor, qui achète un set d'équipement réservé au JcJ et qui ne dépasse jamais le butin de donjon en JcE.
- **La Vale Cup**, une ligue de boarball disputée dans son propre stade au sud d'Eastbrook, et **Card Duel**, un jeu de cartes rapide en tête-à-tête organisé en ville.
- **Un Book of Deeds** : un journal de hauts faits fait de titres cosmétiques, de bordures de badge et de Renown, avec des Chronicles par zone tenues par des PNJ Chronicler et un classement à vie.
- **Une économie de métiers profonde** : quatre métiers de récolte alimentent dix métiers de fabrication, de la cuisine et de l'alchimie à la joaillerie, la forge d'armes et l'enchantement, avec des outils par palier, des postes de travail en ville, une qualité chef-d'œuvre et des commandes, le tout alimentant un **World Market** piloté par les joueurs et le service de courrier **Ravenpost**.
- **Du vrai multijoueur** : groupes et raids, guildes, échanges, duels, droits de butin, partage d'XP en groupe, chuchotements, statut absent, et un **Dungeon Finder** avec files par rôle et annonces de groupes préformés.
- **Écrit en code, pas dans un éditeur 3D** : terrain, eau, météo, plans de ville, ombres en temps réel et effets sont générés à l'exécution, et les modèles effectivement livrés sont produits par des fabriques procédurales et une bibliothèque d'assets sélectionnés plutôt que sculptés à la main.
- **Localisé dans 22 langues** grâce à un pipeline déterministe où la sim émet des clés.
- **Un wiki compagnon sur `/wiki`**, généré directement à partir du contenu de jeu en vigueur, de sorte qu'il ne peut pas diverger du monde qu'il documente.
- **Des applications natives sur toutes les plateformes** : installateurs de bureau signés pour Windows, Linux et macOS, avec mises à jour automatiques et miroir optionnel des succès Steam, plus des builds iOS et Android, tous partageant le client navigateur et le même monde en ligne.
- **S'adapte à la machine dont vous disposez** : les préréglages graphiques et un gouverneur automatique de fréquence d'images échangent de la richesse visuelle contre de la fluidité, et sont tenus par une règle d'équité qui les empêche de masquer quoi que ce soit à quoi un joueur réagit.
- **Environnement RL headless** avec des bindings Gymnasium, un façonnage de récompense, et un mode benchmark.
- **Utilité $WOC, entièrement optionnelle** : reliez un portefeuille Solana pour un badge de détenteur, les Daily Rewards et une option de paiement remisée dans la boutique cosmétique. Le jeu reste gratuit et non dépositaire.
- **Season 1 Armory** : collectionnez des apparences d'arme cosmétiques via le WOC Store, avec du Claudium acheté en monnaie fiduciaire, en SOL, en USDC ou en $WOC. Les cosmétiques n'apportent jamais de puissance en combat.

## Captures d'écran

![La place d'Eastbrook, le feu de camp et les donneurs de quêtes](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Crépuscule au feu de camp d'Eastbrook](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Crépuscule au feu de camp d'Eastbrook* | ![Pulls d'élite dans the Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Pulls d'élite à la lueur des torches dans the Hollow Crypt* |
| ![Les morts agités à la chapelle en ruine](../../docs/screenshots/restless-dead.jpg)<br>*Les morts agités à la chapelle en ruine* | ![Une mêlée avec les Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*En infériorité numérique au camp de bandits* |
| ![Old Greyjaw traqué sur la route du nord](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, le rare spawn, rattrapé sur la route du nord* | ![Interface du marchand et des sacs](../../docs/screenshots/vendor-and-bags.jpg)<br>*S'équiper chez Trader Wilkes, avec le marchand et les sacs ouverts* |
| ![Le portail lunaire sur la rive de Glimmermere](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Les noyés remontent au portail lunaire de Glimmermere* | ![Ysolei sur l'autel du Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Lunar Tempest et l'autel du Drowned Temple* |

La météo est pilotée par le biome et purement visuelle, elle ne touche donc jamais à la sim déterministe :

| | | |
|:---:|:---:|:---:|
| ![Ciel dégagé sur Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Ciel dégagé sur la Vale* | ![Pluie sur Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Pluie sur Mirefen Marsh* | ![Neige sur Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Neige sur Thornpeak Heights* |

## Jouer

Jouez dans votre navigateur sur [worldofclaudecraft.com](https://worldofclaudecraft.com/), ou installez l'application native pour Windows, Linux, macOS, iOS ou Android. Tous les clients se connectent au même monde en ligne.

### En ligne, avec d'autres joueurs

Créez un compte, créez un personnage, et entrez dans le monde vivant. Pour faire tourner vous-même cette même pile client/serveur, voir [Héberger votre propre monde](#host-your-own-world-one-command) ci-dessous.

### Hors ligne, dans le serveur de développement

Le mode hors ligne est un monde local solo, sans compte ni autorité serveur, et il n'est donc livré que dans les builds de développement. Lancez le serveur de développement et il apparaît dans le sélecteur de mode :

```bash
npm install
npm run dev        # then open http://localhost:5173 and choose Play Offline
```

Nommez votre personnage, choisissez l'une des neuf classes, et vous démarrez à **Eastbrook Vale** (niveaux 1-7), une ville marchande entourée de pôles : les coulées de loups au nord, les prés de sangliers à l'est, les bois de Sableweb à l'ouest, Mirror Lake au nord-ouest, une mine de cuivre infestée de fouisseurs au sud-ouest, et une chapelle en ruine peuplée de morts agités au nord-est, avec le camp de bandits de Gorrak au sud-est. La route du nord grimpe par un col de montagne jusqu'à **Mirefen Marsh** (6-13, pôle Fenbridge) et continue jusqu'à **Thornpeak Heights** (13-20, pôle Highwatch). La graine du monde est fixée dans `src/sim/world_seed.ts`, c'est donc le même endroit à chaque visite.

### Applications de bureau pour Windows, Linux et macOS

World of ClaudeCraft est livré sous forme d'applications de bureau complètes pour les trois grandes plateformes : installateurs Windows signés, paquets Linux AppImage et deb, et builds macOS universels signés et notarisés. Ils utilisent le même client de jeu et le même monde en ligne que le navigateur, avec un empaquetage natif et des mises à jour automatiques.

La connexion en ligne se fait uniquement par Discord et par e-mail, exactement comme sur le web : l'e-mail et le mot de passe connectent depuis l'application, et « Continue with Discord » ouvre votre navigateur par défaut sur la page `/desktop-login`, qui renvoie un code à usage unique à l'application via un lien profond `worldofclaudecraft://` que l'application échange contre un jeton de session World of ClaudeCraft normal.

```bash
npm run electron:dev          # Vite + Electron dev shell
npm run electron:pack         # local unpacked desktop app
npm run electron:build        # website-channel installers (self-updating)
npm run electron:build:steam  # SteamPipe depot layouts (in-app updater off)
```

Pointez le shell vers une autre API avec `VITE_DESKTOP_API_ORIGIN`, par exemple un serveur local ou un hôte de préproduction :

```bash
VITE_DESKTOP_API_ORIGIN=http://127.0.0.1:8787 npm run electron:dev
```

Remplacez l'origine d'API de production pour les builds de préproduction avec `VITE_DESKTOP_API_ORIGIN=https://dev.worldofclaudecraft.com` (une valeur de BUILD : elle est intégrée au bundle et estampillée dans l'application empaquetée, et les builds installés l'ignorent en tant que variable d'environnement à l'exécution). Steam est un canal de distribution (le même bundle Electron, téléversé via SteamPipe), et les joueurs sur bureau peuvent relier un compte Steam pour refléter les deeds qu'ils obtiennent dans les succès Steam ; la connexion elle-même reste par e-mail et Discord. Le runbook de publication complet (signature, notarisation, publication d'une mise à jour automatique, dépôts SteamPipe, déploiement du serveur) est `docs/desktop-release.md`. iOS et Android sont livrés via Capacitor, avec leur propre runbook dans `docs/mobile-store-release.md`.

<a id="host-your-own-world-one-command"></a>

## Héberger votre propre monde (une seule commande)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres and the game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

Pour un **hébergement distant**, déployez la pile compose sur n'importe quel VPS, définissez un vrai `POSTGRES_PASSWORD` dans l'environnement, et placez un reverse proxy TLS devant le port 8787. Caddy permet de le faire en quelques lignes ; les WebSockets sont proxifiés automatiquement et le client sélectionne tout seul `wss://` sur les pages https. Les points d'accès d'authentification sont limités en débit, les mots de passe sont hachés avec scrypt, et les sessions de connexion expirent. Ne définissez jamais `ALLOW_DEV_COMMANDS=1` en production, car cela active l'ensemble des triches `/dev` : les triches de niveau et de téléportation utilisées par les bots de test, plus l'octroi d'objets, l'apparition de créatures, la téléportation vers les instances et l'interface de commandes de développement en jeu. [DEPLOY.md](../../DEPLOY.md) est le guide de production complet, y compris la configuration du reverse proxy qui garde les points d'accès de santé et de métriques hors de la façade publique.

<a id="develop-online-with-hot-reload"></a>

### Développer en ligne avec rechargement à chaud

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api, /admin/api, and /ws)
```

Ouvrez http://localhost:5173, choisissez **Play Online**, créez un compte, créez un personnage, et cliquez sur Enter World. L'écran de sélection de personnage affiche les dernières nouvelles de version dans son panneau News & Updates, avec des badges NEW pour tout ce que vous n'avez pas encore vu. Ouvrez un deuxième onglet et reconnectez-vous pour vous voir mutuellement en ville. `Enter` ouvre le tchat. Le wiki des joueurs est le Guide intégré au dépôt, servi sur http://localhost:5173/wiki et sur `/wiki` en production ; son contenu est généré à partir des données de jeu en vigueur par `npm run wiki:content`.

Ce qui persiste et comment le serveur garde la main :

- **Comptes** : mots de passe hachés avec scrypt et jetons porteurs à expiration.
- **Personnages** : jusqu'à 10 par compte et par royaume ; niveau, équipement, sacs, coffre de banque, quêtes, talents, métiers, progression JcJ et de deeds, position et argent persistent en JSONB dans Postgres, sauvegardés sur minuteur, à la déconnexion et à l'arrêt du serveur. Les noms sont uniques par royaume et de style classique.
- **Le serveur est autoritaire** : les clients envoient en flux l'intention de mouvement et les commandes à 20 Hz ; le serveur fait tourner l'unique `Sim` partagé et renvoie des snapshots limités à la zone d'intérêt ainsi que des événements par joueur. Chaque jet de combat, chute de butin, crédit de quête et transaction avec un marchand est résolu côté serveur. Le client est un moteur de rendu.

<a id="train-an-agent-headless-rl"></a>

## Entraîner un agent (RL headless)

Le même cœur déterministe tourne comme un environnement [Gymnasium](https://gymnasium.farama.org/), si bien qu'un agent apprend face au vrai jeu, et non à une réimplémentation. Le serveur d'environnement (`headless/env_server.ts`) enveloppe un `Sim` et communique en JSON délimité par des sauts de ligne sur stdio ; les bindings Python du dossier `python/` le lancent comme sous-processus et exposent la boucle habituelle `reset` / `step` / `close`.

```bash
npm run build:env    # bundle the env server to dist-env/env_server.cjs
npm run env          # run it directly (NDJSON on stdio)
npm run bench        # in-process throughput benchmark (no IPC)

# drive it from Python
pip install gymnasium numpy
python python/example_random_agent.py
```

```python
from wow_env import WoWClassicEnv

env = WoWClassicEnv(player_class="warrior")   # any of the nine classes
obs, info = env.reset(seed=42)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
env.close()
```

- **Les espaces d'observation et d'action sont dérivés du contenu.** Interrogez-les depuis la réponse `info` de l'env au démarrage plutôt que de les coder en dur ; ils grandissent avec le jeu. L'espace d'action est un `Discrete` couvrant le déplacement, le ciblage, l'attaque, la panoplie complète d'aptitudes, l'interaction et manger/boire ; l'observation est un `Box` couvrant soi, les aptitudes, la cible, les créatures à proximité, l'interactif le plus proche et la progression des quêtes.
- **La récompense** est une somme pondérée de variations de compteurs par tick (XP, dégâts infligés et subis, éliminations, morts, progression des quêtes, montées de niveau), réglable à chaque reset. Chaque `step` applique une action et fait avancer cinq ticks de sim par défaut, soit environ quatre décisions par seconde simulée.
- **Déterministe par construction.** Pas d'horloge murale, pas de `Math.random`. Donnez une graine au reset et l'épisode se rejoue à l'identique.

Le protocole et les bindings sont documentés dans `headless/CLAUDE.md` et `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft est nativement web3 autour de **$WOC**, notre jeton communautaire sur Solana. Connectez un portefeuille Solana, reliez-le à votre compte avec une seule signature (non dépositaire, aucune transaction à approuver), et votre solde de $WOC en lecture seule s'affiche dans le HUD aux côtés d'un badge cosmétique de palier de détenteur.

$WOC a aussi une utilité optionnelle dans le jeu en ligne :

- **WOC Store** : achetez du Claudium, la monnaie cosmétique à sens unique, en monnaie fiduciaire, en SOL, en USDC ou en $WOC. Le rail de paiement $WOC est remisé par rapport aux autres.
- **Season 1 Armory** : dépensez du Claudium dans des collections d'apparences d'arme cosmétiques. Les achats en boutique n'ajoutent ni statistiques ni puissance en combat.
- **Daily Rewards** : les détenteurs vérifiés éligibles peuvent gagner des points via une roue quotidienne et des tâches tournantes, puis se disputer une part de la cagnotte du jour.

Rien de tout cela n'est nécessaire pour jouer. La liaison de portefeuille est optionnelle et non dépositaire, il n'y a pas de pay-to-win, et tout le jeu se joue très bien sans jamais connecter de portefeuille.

**Adresse du contrat $WOC (Solana) :**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Plus d'informations sur le jeton à [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Visite guidée du monde

### Les neuf classes

Chaque classe utilise des mécaniques de MMO d'inspiration classique implémentées depuis les premiers principes, et apprend des sorts à rangs au fil des niveaux 1-20, avec des aptitudes emblématiques comme Low Blow, Early Grave, Skyfall, Urgent Prayer et Ancestral Strike qui se débloquent sur la seconde moitié de la montée.

- **Warrior** : rage, Iron Bellow, Onrush, Quaking Blow, Maiming Strike, Gaping Wounds (un saignement qui accompagne vos coups), Widening Arc, Hobbling Cut, Blood Toll, Redhand (proc d'esquive).
- **Paladin** : Oathbrand déclenché par Verdict, Mending Light, Steadfast Aura, Oath of Iron, Ward of Faith (absorption), Sundering Gavel (étourdissement), Last Rite.
- **Hunter** : attaque automatique à distance (8-35 yd avec une zone morte de style classique), Gutting Strike, Harrier's Guise, Venom Barb, Fell Shot, Rattling Shot, Counterfang, Fettering Slash, et un familier apprivoisable à partir du niveau 10.
- **Rogue** : énergie et points de combo, Wicked Slash, Dirt Nap, Craven Thrust (dans le dos, dague), Eye Jab, Ghostfoot, Cutthroat Tempo, Swift Heels.
- **Priest** : Smite, Whispered Prayer, Litany of Resolve, Dirge of Decay, Psalm of Warding (absorption), Lingering Grace (HoT), Mindfracture.
- **Shaman** : Arc Bolt, Stonebound Weapon (enchantement d'arme), Mending Waters, Earthen Jolt, Thunder Ward (épines), Cinder Jolt.
- **Mage** : Cinderbolt, Hoarfrost Mantle, Aether Insight, Rimelance, Waterbind, Cinderfall, Aether Darts (canalisé), Bewitch, Icebind, un élémentaire d'eau invocable, et Chronomancy, une spécialisation de soin fondée sur la magie temporelle.
- **Warlock** : Gloom Bolt, Fiendhide, Burning Pact, Blackrot, Hard Bargain, Hex of Anguish, Consume, et sept démons invocables, d'Emberkin à Wraithborn.
- **Druid** : Wildbolt, Wildmend, Wildward, Lunar Tempest, Wildbloom, Briarguard, Gripping Roots, et la métamorphose en Wolf Form au niveau 5, Bruin Form au 8 et Moonwing Form au 10.

Les soins et les buffs s'appliquent aux membres du groupe, les soins peuvent porter des coups critiques, et les boucliers d'absorption encaissent les dégâts avant les points de vie. Dépensez des points dans **trois spécialisations de talents par classe** (Battlecraft/Bloodrush/Ironguard, Moongrove/Wildfang/Groveheart, et ainsi de suite) ; l'allocation est validée par le serveur et exportable sous forme de chaîne de build.

### Donjons

La trame des Gravecaller passe par trois instances d'élite à cinq joueurs, une quatrième attend derrière un portail lunaire avec sa propre légende des noyés, et une crypte solo se tient à l'écart pour les explorateurs.

- **The Hollow Crypt** (5 joueurs) sous the Fallen Chapel : des packs d'élite par paire, le mini-boss Sexton Marrow, et Morthen the Gravecaller avec ses dégâts de zone d'ombre récurrents. La porte de la crypte téléporte votre groupe dans une copie d'instance privée qui se réinitialise une fois qu'elle se vide.
- **The Sunken Bastion** (5 joueurs, vers le niveau 13, au sud-est de Mirefen) : Vael the Fogbinder invoque des vagues de Drowned Thralls à mesure que le combat s'étire.
- **Gravewyrm Sanctum** (5 joueurs, niveau 20, sous Thornpeak) : trois salles de gardes-os et de gardes-écailles d'élite, Korgath the Bound, Grand Necromancer Velkhar, et Korzul the Gravewyrm, où tombent des armes épiques.
- **The Drowned Temple** (5 joueurs) par le portail lunaire de Glimmermere : une instance pâle, d'un violet lunaire, menant à Choirmother Selthe puis à Ysolei, Avatar of the Drowned Moon, dont les marées lunaires et les Moonspawn invoqués punissent un groupe statique.
- **The Abandoned Crypt** (solo) à Thornpeak : une plongée tranquille à base de clé de voûte et de journal, pour un seul joueur, dont la piste descelle la porte royale vers **Nythraxis, Scourge of Thornpeak**, un final de raid à dix joueurs livré autour de trois pierres-gardiennes d'âme.

Chaque instance tourne aussi en **Héroïque** : des ennemis de niveau supérieur, des mécaniques plus tranchées, et son propre butin et sa propre monnaie de marchand. Les chaînes de quêtes préparatoires sont jouables en solo, l'histoire n'est donc jamais bloquée derrière la recherche d'un groupe. Notre raid automatisé à cinq bots (Warrior, Paladin, Priest, Mage, Hunter avec focus-fire et IA de soigneur) nettoie the Hollow Crypt en environ cinq minutes (`node scripts/crypt_raid.mjs`, nécessite `ALLOW_DEV_COMMANDS=1`).

### Delves

Les delves sont un mode pour petit groupe distinct et évolutif, à un ou deux joueurs, reconstruit à partir de salles aléatoires à chaque partie et se terminant sur un coffre de reliquaire verrouillé qui s'ouvre par un mini-jeu de crochetage plutôt que par un jet de butin. **The Collapsed Reliquary** (niveau 7 et plus) se termine sur Deacon Varric, avec une compagne IA, Tessa, qui combat à vos côtés si vous y allez seul. **The Drowned Litany** (niveau 12 et plus) suit la piste jusqu'à un sanctuaire inondé en bordure de Mirefen Marsh. Un tableau des delves fixe le palier : l'Héroïque augmente le niveau des ennemis et ajoute un affixe aléatoire pour des récompenses plus riches.

### JcJ classé (the Ashen Coliseum)

Appuyez sur `G` ou sur le bouton d'arène pour vous mettre en file. Le matchmaking téléporte les combattants dans une fosse privée, un court compte à rebours soigne et réinitialise tout le monde pour un départ équitable, et le combat se termine quand un camp abandonne. Personne ne meurt, et vous revenez exactement là où vous vous étiez mis en file. Protect Yumi se joue dans son propre labyrinthe plutôt que dans la fosse du Coliseum.

- **Classements 1c1 et 2c2**, chacun avec un classement persistant de type Elo et un classement absolu.
- **2c2 Fiesta**, un mode de groupe plus animé où les équipes courent vers un objectif d'éliminations pendant que des ramassages d'amélioration distribuent de la puissance et qu'un anneau qui se referme force le combat à se rassembler.
- **Protect Yumi**, un mode à objectif non classé en 3c3 et 5c5 disputé dans un labyrinthe : chaque équipe garde un familier félin tout en essayant d'abattre celui d'en face, si bien que les escortes et les prises comptent plus que les éliminations brutes.

Les victoires classées et les éliminations en Fiesta rapportent de l'**Honor**, que l'intendant en ville échange contre un set d'équipement Warfare. Warfare est une statistique réservée au JcJ, ce set gagne donc les duels sans jamais surpasser le butin de donjon de même palier en JcE.

### Jouer ensemble

- **Dungeon Finder** : ouvrez-le avec `Shift+I` pour parcourir donjons et raids, examiner boss et butin, rejoindre une file automatique par rôle tank/soigneur/DPS, ou créer une annonce de groupe préformé. Les groupes formés par le Finder se rendent quand même ensemble à l'entrée.
- **Groupes** jusqu'à 5, convertis en raid à 10 joueurs sur deux groupes une fois complets : clic droit sur un joueur et Inviter dans le groupe. Les membres partagent les droits de butin et le crédit de quête, se répartissent l'XP avec les bonus de groupe d'inspiration classique, et apparaissent comme des points sur la minicarte. `/p` pour le tchat de groupe, `/roll` pour départager le butin.
- **Échanges** : clic droit et Échanger. Les deux parties déposent objets et argent, les deux doivent accepter, et l'échange est atomique et validé par le serveur. Les objets de quête ne peuvent pas être échangés, et s'éloigner annule.
- **Duels** : clic droit et Défier en duel. Un compte à rebours de 3 secondes, puis combat jusqu'à ce qu'un camp tombe à 1 pv ; le vainqueur est annoncé à toute la zone et s'enfuir à 60 mètres équivaut à un forfait.
- **Droits de butin et statut absent** : le premier joueur à blesser une créature possède son butin, son XP et son crédit de quête ; `/afk` et `/dnd` vous marquent comme absent avec une réponse automatique aux chuchotements.

### Monde et systèmes

- **Métiers** (`Shift+P`) : quatre métiers de récolte (minage, bûcheronnage, herboristerie, pêche) alimentent dix métiers de fabrication, de la cuisine et de l'alchimie à la forge d'armes, la joaillerie et l'enchantement. Les outils de récolte existent en paliers qui déterminent les gisements que vous pouvez exploiter, la fabrication se fait aux postes de travail en ville avec une chance de qualité chef-d'œuvre qui porte votre marque d'artisan, et il y a un système d'archétypes à découvrir à mesure que vous vous spécialisez.
- **Le World Market** : un hôtel des ventes piloté par les joueurs pour l'équipement, les matériaux et les consommables, consultable depuis les villes-pôles.
- **Courrier Ravenpost** : envoyez objets et pièces à d'autres personnages, les pièces jointes étant conservées en sécurité jusqu'à leur récupération.
- **Guildes** : chartes, effectifs, rangs et tchat de guilde.
- **Le Guide** : un wiki intégré au site et consultable sur `/wiki`, couvrant classes, créatures, zones et deeds, généré directement à partir du contenu de jeu en vigueur, de sorte qu'il ne peut pas diverger du monde qu'il documente.
- **La Vale Cup et Card Duel** : du boarball au stade de Sowfield au sud d'Eastbrook, dans des formats du 1c1 au 5c5, et un jeu de cartes rapide en tête-à-tête organisé par le Card Master en ville.
- **Daily Rewards** : les détenteurs de $WOC vérifiés peuvent gagner des points de classement via une roue quotidienne et des tâches tournantes, avec des versements automatiques depuis la cagnotte du jour.
- **WOC Store et Season 1 Armory** : achetez du Claudium en monnaie fiduciaire, en SOL, en USDC ou en $WOC, puis dépensez-le en apparences d'arme purement cosmétiques.
- **Manger et boire** : asseyez-vous pour récupérer, interrompu par les dégâts ou par le fait de se lever, et oui, vous pouvez manger et boire en même temps.
- **Des marchands** qui achètent nourriture et eau et vendent de l'équipement blanc honnête, avec l'argent affiché en or, argent et cuivre.
- **Une banque personnelle** (the Gilded Strongbox) : des économes dans chaque ville-pôle tiennent un coffre par personnage, de 24 emplacements jusqu'à 96 avec des extensions achetées en pièces, plus des emplacements bonus obtenus en ligne pour une adresse e-mail vérifiée, des comptes reliés et des parrainages.
- **Le Book of Deeds** : un journal de hauts faits (par défaut `Shift+Z`) de quêtes, éliminations, nettoyages et curiosités, qui rapporte des titres cosmétiques à porter sur votre barre de nom, dans le tchat et sur les classements, plus un traqueur HUD pour les deeds que vous poursuivez, des Chronicles par zone tenues par des PNJ Chronicler, et un classement de Renown à vie ; la liste publique vit sur `/wiki/deeds`.
- **IA des créatures** : errance, agressivité de proximité selon la différence de niveau, pulls sociaux, poursuite, retour à la laisse et réinitialisation, butin de cadavre, et réapparitions, avec un rare spawn (Old Greyjaw) sur un long minuteur.
- **Des spots de pêche** avec leurs propres tables de butin et des prises rares.
- **Des apparences cosmétiques** tirées en rareté peu commune, rare et épique, purement pour le look.
- **Mort et rétablissement** : libérez votre esprit vers le cimetière, subissez des dégâts de chute, et ralentissez en nageant.
- **Météo de biome** : ciel dégagé dans la Vale, pluie dans le Marsh, neige sur les Peaks, avec un fondu enchaîné quand vous passez d'une zone à l'autre.

### Commandes (disposition classique)

| Saisie | Action |
|---|---|
| `W` / `S` | courir / reculer. `A`/`D` tournent (strafe en maintenant le clic droit), `Q`/`E` font du strafe |
| clic droit glissé / clic gauche glissé | regard à la souris / caméra en orbite. La molette zoome, `Space` saute |
| `Tab` | passer aux ennemis les plus proches. Clic gauche pour cibler, clic droit pour attaquer, piller ou parler |
| `1`-`9`, `0`, `-`, `=` | barre d'action |
| `F` | interagir (piller un cadavre, ramasser un objet, parler) |
| `C` `P` `L` `M` `B` `N` `T` | personnage, grimoire, journal de quêtes, carte du monde, sacs, talents, artisanat |
| `G` `O` `K` `I` `Y` `Shift+I` `Shift+P` `Shift+Z` | arène, amis et guilde, classement, calendrier, Vale Cup, Dungeon Finder, métiers, deeds |
| `Z` / `X` | rengainer ou dégainer vos armes, roue d'emotes |
| `V` / `R` / `Esc` | barres de nom, course automatique, fermer la fenêtre du dessus (ou ouvrir le menu du jeu) |

Chaque raccourci est remappable dans le panneau des raccourcis clavier. Les commandes tactiles (un stick de déplacement, le glissement de caméra et des boutons d'action à l'écran) apparaissent automatiquement sur mobile.

## Architecture (une sim, trois hôtes)

Trois idées tiennent le projet ensemble :

- **Une sim, trois hôtes.** Le même code `src/sim/` fait tourner le monde navigateur hors ligne, le serveur en ligne, et l'env RL. Le comportement doit être identique partout, et les tests existent pour le garantir.
- **`IWorld` est la seule jointure.** `IWorld` est défini sous forme d'interfaces de facette par domaine sous `src/world_api/`, agrégées par `src/world_api.ts`. Le `Sim` hors ligne le satisfait structurellement et le `ClientWorld` en ligne l'implémente en reflétant les snapshots du serveur. Le moteur de rendu et le HUD ne parlent qu'à `IWorld`, jamais à un monde concret, si bien qu'une nouvelle fonctionnalité étend d'abord la facette correspondante, puis les deux mondes.
- **Le serveur est autoritaire.** Les clients envoient l'intention ; le serveur décide des résultats. Le client ne résout jamais le combat, le butin ou l'économie de lui-même.

La sim est un tick fixe à 20 Hz (`DT = 1/20`), tout l'aléatoire passe par un unique `Rng` à graine, et `src/sim/` ne porte aucun import DOM, navigateur ou Three.js. C'est ce qui permet au même code de se bundler en serveur d'env Node, en boucle de jeu autoritaire et en onglet de navigateur sans changer une ligne.

### Organisation du projet

| Chemin | De quoi il s'agit |
|---|---|
| `src/sim/` | Cœur de jeu déterministe, la source de vérité. Aucune dépendance DOM ou Three. |
| `src/sim/content/` | Les données comme du code : les neuf classes, aptitudes, zones, donjons, delves, objets, recettes, enchantements, talents, métiers, deeds. |
| `src/world_api.ts` + `src/world_api/` | `IWorld`, la jointure dont dépendent le moteur de rendu et le HUD : une interface de facette par domaine. |
| `src/` (le reste) | Moteur de rendu Three.js, HUD et styles, saisie/audio, miroir en ligne, et les SPA admin, guide et éditeur. |
| `server/` | Serveur autoritaire : HTTP et WS, boucle de monde, Postgres, authentification, social, modération. |
| `server/http/` | Le pipeline de requêtes REST : routeur par table, middlewares, et définitions de routes par domaine. |
| `headless/` + `python/` | Serveur d'env RL (`env_server.ts`) et bindings Python Gym. |
| `bot/` | Bot Discord (rôles, relais, fil d'activité). |
| `electron/`, `android/`, `ios/` | Coques de bureau (Steam) et mobiles natives. |
| `tests/` | Suite Vitest. |
| `scripts/` | Outillage de build, assets, i18n, SFX, captures d'écran et E2E navigateur. |
| `deploy/` · `mediawiki/` | Assets de premier démarrage en production et conteneur du wiki des joueurs. |
| `public/` · `docs/` | Assets statiques (déployés tels quels sur le site) et documents de conception. |

Rien de tout cela ne repose sur la bonne foi : `tests/architecture.test.ts` inspecte chaque
fichier de la sim à la recherche d'un import interdit, d'une globale DOM, ou d'un appel
d'horloge ou de `Math.random` égaré, et `tests/world_api_parity.test.ts` épingle la jointure
pour que les deux mondes ne puissent pas diverger.

La plupart des répertoires portent leur propre `CLAUDE.md` avec les conventions locales, et
l'ensemble complet des invariants du projet vit dans le [`CLAUDE.md`](../../CLAUDE.md) racine.
Les contributeurs agents commencent par là, puis récupèrent le point d'entrée de leur
runtime : [`AGENTS.md`](../../AGENTS.md) plus le
[guide opérateur Codex](../codex.md) pour Codex, [`GEMINI.md`](../../GEMINI.md) pour Gemini.
Tous mènent à la même architecture canonique.

## Construit comme les classiques

Le combat, la montée en niveau et la menace tournent tous sur d'authentiques règles d'inspiration classique : rage et énergie, tables de toucher et d'esquive, atténuation par l'armure, la vraie courbe d'XP, les minuteurs de coup, et le cooldown global. Le ressenti est tel que vous vous en souvenez plutôt qu'une approximation. Les chiffres exacts vivent dans `src/sim/` si vous voulez les lire.

Le monde est écrit en code plutôt que dans un éditeur 3D, et c'est ce qui le garde petit,
déterministe et facile à forker :

- Terrain, eau, météo, ciel, plans de ville, ombres en temps réel et effets de combat sont générés à l'exécution à partir des propres données de la sim.
- Les modèles effectivement livrés sont construits de la même façon : des fabriques procédurales sous `scripts/assets/` exportent des GLB déterministes via le pipeline image-vers-GLB du projet, aux côtés d'une bibliothèque sélectionnée de kits de modèles CC0. Les familles de créatures et de personnages riggées portent des animations complètes de marche, attaque, incantation, assise et mort.
- Les icônes reposent sur un peintre en couches qui compose une illustration pour tout ce qui n'a pas de fichier livré, si bien que rien ne manque jamais d'icône, avec des illustrations peintes sélectionnées superposées pour les aptitudes, les objets et les deeds.
- Un HUD classique complet (cadres d'unité, barres d'action, infobulles, journal de quêtes, carte du monde, minicarte, texte de combat flottant, le Book of Deeds), des effets sonores spatialisés et d'interface échantillonnés, et une bande-son composée procéduralement dans le dépôt puis livrée en remasters diffusés en flux qui s'enchaînent en fondu entre zones, villes, donjons et combat.

Chaque asset livré et sa licence sont consignés dans [CREDITS.md](../../CREDITS.md), et les
dépendances tierces fournies portent leurs mentions dans [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Développement

Outre le client de jeu, le build produit le tableau de bord opérateur, l'éditeur de monde sur
`/editor`, et le Guide public sur `/wiki`, tous servis depuis le même serveur de développement.

Chaque chemin FFmpeg que le gate et les tests audio exercent résout les paquets npm fournis
`ffmpeg-static`/`ffprobe-static`, si bien qu'une contribution normale n'exige aucune
installation système de FFmpeg. Les chemins qui mesurent la conformité (`npm run sfx:check`,
les tests audio, la validation d'export du Studio) se lient directement aux binaires statiques,
sans repli sur `PATH` : relancez `npm ci` si une installation ayant sauté les scripts les a
laissés manquants. Les processus de lecture et d'encodage du Studio ainsi que le préflight de
`npm run gate` passent par `scripts/sfx/ffmpeg_paths.mjs`, qui, lui, se replie sur `PATH`.
Certains scripts autonomes de génération audio (par exemple `scripts/gen_ui_sfx.mjs`) utilisent
encore `ffmpeg` depuis `PATH` par défaut.

```bash
npm test                        # vitest: formulas, combat, AI, quests, all 9 classes, parties, duels, trades, dungeons
npm run gate                    # complete CI-equivalent contribution gate
npm run build                   # production web build
npm run sfx:studio              # local SFX authoring, runtime mix, and production export
node scripts/smoke_browser.mjs  # warrior end-to-end (needs npm run dev)
node scripts/smoke_mage.mjs     # mage: casting, polymorph, conjure and drink, death and release
node scripts/visual_tour.mjs    # screenshot tour of the zone and UI into tmp/
node scripts/tour_temple.mjs    # screenshot tour of the Glimmermere and Drowned Temple into tmp/
node scripts/mp_integration.mjs # API, WS, and persistence checks (server running)
node scripts/social_e2e.mjs     # trade and duel over the wire (ALLOW_DEV_COMMANDS=1)
node scripts/arena_visual.mjs   # two clients queue and fight a ranked 1v1
node scripts/crypt_raid.mjs     # five bots clear the Hollow Crypt (ALLOW_DEV_COMMANDS=1)
```

Les tests logiques et unitaires utilisent Vitest. Pendant l'itération, lancez un seul fichier : `npx vitest run tests/sim.test.ts`. Les changements d'interface disposent aussi d'une suite optionnelle en vrai navigateur couvrant l'accessibilité, la navigation au clavier et les cibles tactiles : `npm run test:browser`. Les scripts de captures d'écran et de smoke pilotent de vrais navigateurs via `puppeteer-core` et nécessitent que `npm run dev` tourne ; les scripts au niveau du fil (`mp_integration.mjs`, `social_e2e.mjs`, `crypt_raid.mjs`) parlent directement au serveur et nécessitent plutôt `npm run server`. Les agents navigateurs peuvent piloter le déplacement via `window.__game.controller` plutôt que de simuler des touches maintenues, par exemple `controller.move({ forward: true }, facingRadians)` ou des indicateurs compacts comme `{ f: 1, sr: 1 }`.

Les vérifications s'exécutent en couches, décrites dans [docs/qa-gate.md](../qa-gate.md) :
pointez votre clone vers les hooks partagés avec `git config core.hooksPath .githooks` et un
plancher rapide s'exécute avant que quoi que ce soit ne quitte votre machine.

Pour les commandes du serveur, voir [Développer en ligne](#develop-online-with-hot-reload) ci-dessus,
[CONTRIBUTING.md](CONTRIBUTING.fr_FR.md) pour le processus de contribution, le
[tutoriel du SFX Studio](../sfx-studio-tutorial.md) pour la création sonore et
l'export d'artefacts, [DEPLOY.md](../../DEPLOY.md) pour la production, et
[CREDITS.md](../../CREDITS.md) pour les licences des assets.

## Localisation

Chaque chaîne visible par le joueur est résolue via `t()`, et le jeu est livré dans **22 langues** (anglais, deux espagnols, deux français, anglais Canada, italien, allemand, chinois simplifié et traditionnel, coréen, japonais, portugais du Brésil, russe, tchèque, néerlandais, polonais, indonésien, turc, suédois, vietnamien et danois). La sim et le serveur restent agnostiques sur la langue : ils émettent des clés stables ou de l'anglais que le client relocalise à la frontière, ce qui préserve le déterminisme. Les contributeurs ajoutent uniquement l'anglais ; le mainteneur remplit en lot les autres langues avant chaque version. Le workflow est documenté dans `docs/i18n-scaling/translation-workflow.md`.

## Contribuer

Les contributions de toute sorte sont les bienvenues : code, traductions, rapports de bugs et documentation. Commencez par [CONTRIBUTING.md](CONTRIBUTING.fr_FR.md) pour la mise en place, lisez le [Code de conduite](../../CODE_OF_CONDUCT.md), et consultez [SECURITY.md](../../SECURITY.md) avant de signaler une vulnérabilité. Nouveau ici ? Cherchez les tickets étiquetés [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), ouvrez un [ticket](https://github.com/levy-street/world-of-claudecraft/issues/new/choose), ou venez dire bonjour sur [Discord](https://discord.com/invite/worldofclaudecraft).

Le développement actif se fait sur la branche `release/vX.Y.Z` la plus récente. Recherchez-la plutôt que de la supposer, puis créez votre branche à partir d'elle et ciblez-la avec votre pull request. Ne créez jamais de branche depuis `main` et ne la ciblez jamais : `main` ne reçoit une branche de version qu'une fois cette version publiée. [CONTRIBUTING.md](CONTRIBUTING.fr_FR.md) contient la commande d'une seule ligne qui trouve la branche en vigueur.

## Licence

**Le code est [sous licence MIT](../../LICENSE), alors forkez-le, remixez-le, et hébergez votre propre monde.** C'est tout l'intérêt, et rien d'autre sur cette page ni sur notre site web ne revient dessus.

Trois choses sont sous licence distincte, cela vaut donc trente secondes pour savoir laquelle est laquelle :

| Quoi | Licence | Pouvez-vous le redistribuer ? |
|---|---|---|
| **Code source**, c'est-à-dire tout sauf les assets média détachés ci-dessous | [MIT](../../LICENSE) | Oui. Commercialement aussi. |
| **Assets média** : modèles, textures, HDRIs, icônes, sons, polices (surtout sous `public/`) | Par asset, consigné dans [CREDITS.md](../../CREDITS.md) | Le plus souvent oui (la plupart sont CC0). Certains non, voir ci-dessous. |
| **Nom et image de marque** : « World of ClaudeCraft », « Levy Street », les logos | Pas sous licence | Non. |

**Forkez-le et hébergez votre propre monde. Cela fonctionne, et les assets ne vous gênent pas.** L'essentiel de ce que vous voyez est CC0 dans le domaine public (KayKit, Quaternius, Kenney, ambientCG, Poly Haven), et nos propres props, créatures, décors et sons d'interface générés sont livrés avec le projet, si bien qu'un fork tourne sans configuration. Vous ne pouvez simplement pas les extraire et les vendre comme illustrations autonomes.

Ce qu'il faudrait retirer ou remplacer avant une redistribution :

- les **icônes d'aptitudes de classe CraftPix** sous `public/ui/skills/` ont été achetées par Levy Street et **ne peuvent pas être redistribuées**, achetez donc votre propre licence si vous voulez les livrer ;
- les **effets sonores de @jamiecypher** sont en CC BY-NC 4.0, partagez-les donc de façon non commerciale avec crédit, mais l'autorisation commerciale ne vaut que pour ce projet ;
- les **illustrations de boutique et de prestige** (Season 1 Armory, l'ensemble Claudium, la série d'illustrations des métiers, les icônes du Book of Deeds, l'emblème du dragon d'élite) sont des illustrations commerciales commandées et **les droits sont réservés** ;
- les **marques de tiers** (Twitch, X, Kick, YouTube, Discord, Solana, USDC) sont des marques déposées de leurs propriétaires et ne nous appartiennent pas pour être concédées ;
- une poignée d'**icônes et d'enregistrements utilisés avec autorisation** nécessitent une autorisation pour être transmis.

[CREDITS.md](../../CREDITS.md) est la liste faisant autorité, avec une colonne de redistribution par asset. Là où un asset y est répertorié, cette licence prime sur la licence MIT du projet. Ce registre est encore en cours d'achèvement : un asset média absent est donc non répertorié plutôt que libre, demandez avant de compter dessus. Le code source fonctionne dans l'autre sens, et tout ce qui n'est pas détaché est en MIT.

Nos [Conditions d'utilisation](https://worldofclaudecraft.com/terms) couvrent le jeu hébergé que nous faisons tourner sur worldofclaudecraft.com : comptes, conduite, objets virtuels. Elles ne restreignent pas les droits que la licence MIT vous donne sur ce code source.
