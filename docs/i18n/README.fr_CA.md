<div align="center">

# World of ClaudeCraft

**Faites des quêtes, formez un groupe et menez des raids dans un monde fait main, gratuit dans votre navigateur. Code ouvert, web3 et en ligne dès maintenant.**

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
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.fr_CA.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · **Français (Canada)** · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Čeština](README.cs_CZ.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Jouer maintenant](https://worldofclaudecraft.com/) · [Héberger votre propre monde](#host-your-own-world-one-command) · [Entraîner un agent](#train-an-agent-headless-rl) · [Web3](#web3) · [Contribuer](CONTRIBUTING.fr_CA.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![Écran-titre de World of ClaudeCraft](../../docs/screenshots/title-screen.jpg)

</div>

## Ce que c'est

World of ClaudeCraft est un MMO complet d'époque classique auquel vous pouvez jouer dès maintenant dans votre navigateur, que vous pouvez héberger vous-même avec une seule commande et où vous pouvez même entraîner des agents d'IA à jouer. Il est gratuit, à code ouvert et en ligne sur [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Un seul monde partagé s'exécute à trois endroits, tous à partir du même noyau de jeu :

- le **serveur multijoueur faisant autorité**, le monde en direct auquel vous jouez sur worldofclaudecraft.com, où des comptes soutenus par Postgres partagent un seul royaume persistant,
- le **monde de navigateur hors ligne**, une `Sim` locale à un joueur que vous obtenez du serveur de développement, utile pour le développement et pour lire le noyau de jeu de bout en bout,
- l'**environnement RL sans interface**, où Python pilote le vrai jeu à travers une interface Gym.

Même graine, même monde, partout. Une bonne partie de ce que vous voyez est encore dessinée à partir du code à l'exécution, et le reste est un ensemble de ressources sélectionnées livré avec le projet, de sorte qu'un fork fonctionne dès l'installation.

## Points saillants

- **Neuf classes classiques**, chacune avec une panoplie complète de style d'époque classique qui gagne des rangs à mesure que vous montez en niveau, plus un **système de talents** complet (trois spécialisations par classe, 27 spécialisations en tout).
- **Trois zones de monde ouvert** du niveau 1 à 20, plus de 90 quêtes et une seule trame narrative connectée autour de la conspiration des Gravecaller.
- **Cinq donjons instanciés**, dont quatre raids d'élite à cinq joueurs et une crypte en solo, avec mise à l'échelle d'élite, mécaniques de boss en zone d'effet, butin par archétype de classe qui s'assemble en ensembles de palier, et un **palier de difficulté Héroïque** aux récompenses plus riches, plus des **boss de monde** en monde ouvert et un final de raid à dix joueurs.
- **Deux delves évolutives**, un mode pour petit groupe d'un ou deux joueurs accompagnés d'un compagnon IA, reconstruites à partir de chambres aléatoires à chaque partie, selon les paliers Normal et Héroïque.
- **JcJ classé** sur deux cartes d'arène : des échelles 1c1 et 2c2, un mode 2c2 Fiesta plus animé, et **Protect Yumi**, un mode d'objectif 3c3 et 5c5. Le jeu classé rapporte de l'Honor, qui achète un ensemble d'équipement réservé au JcJ qui ne dépasse jamais le butin de donjon en JcE.
- **The Vale Cup**, une ligue de boarball jouée dans son propre stade au sud d'Eastbrook, et **Card Duel**, un jeu de cartes rapide en tête-à-tête tenu en ville.
- **Un Book of Deeds** : un journal de hauts faits fait de titres cosmétiques, de bordures de badge et de Renown, avec des Chroniques par zone tenues par des PNJ Chronicler en jeu et un palmarès à vie.
- **Une économie de métiers profonde** : quatre métiers de récolte alimentent dix métiers de fabrication, de la cuisine et l'alchimie à la joaillerie, la forge d'armes et l'enchantement, avec des outils à paliers, des postes de travail en ville, une qualité chef-d'œuvre et des commandes, le tout alimentant un **World Market** dirigé par les joueurs et le service de courrier **Ravenpost**.
- **Vrai multijoueur** : groupes et raids, guildes, échanges, duels, droits de première attaque, partage d'XP en groupe, chuchotements, statut d'absence, et un **Dungeon Finder** avec files par rôle et annonces de groupes préformés.
- **Créé en code, pas dans un éditeur 3D** : le terrain, l'eau, la météo, les plans de ville, les ombres en temps réel et les effets sont générés à l'exécution, et les modèles qui sont livrés sont construits par des fabriques procédurales et une bibliothèque de ressources sélectionnées plutôt que sculptés à la main.
- **Localisé dans 22 langues** au moyen d'un pipeline déterministe où la simulation émet des clés.
- **Un wiki compagnon à `/wiki`**, généré directement à partir du contenu de jeu en direct, de sorte qu'il ne peut pas s'écarter du monde qu'il documente.
- **Des applications natives sur toutes les plateformes** : des programmes d'installation signés pour Windows, Linux et macOS avec mises à jour automatiques et miroir optionnel des hauts faits Steam, plus des versions iOS et Android, toutes partageant le client de navigateur et le même monde en ligne.
- **S'adapte à la machine que vous avez** : des préréglages graphiques et un régulateur automatique de fréquence d'images échangent la richesse visuelle contre la fluidité, et sont tenus par une règle d'équité qui les empêche de jamais cacher quelque chose auquel un joueur réagit.
- **Environnement RL sans interface** avec liaisons Gymnasium, modelage de récompense et un mode de banc d'essai.
- **Utilité de $WOC, entièrement optionnelle** : liez un portefeuille Solana pour obtenir une distinction de détenteur, les Daily Rewards et une option de paiement à rabais dans la boutique cosmétique. Le jeu reste gratuit et non dépositaire.
- **Season 1 Armory** : collectionnez des apparences d'armes cosmétiques par la WOC Store, avec du Claudium acheté en monnaie fiduciaire, en SOL, en USDC ou en $WOC. Les cosmétiques ne procurent jamais de puissance de combat.

## Captures d'écran

![La place de la ville d'Eastbrook, feu de camp et donneurs de quêtes](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Crépuscule au feu de camp d'Eastbrook](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Crépuscule au feu de camp d'Eastbrook* | ![Pulls d'élite dans the Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Pulls d'élite éclairés aux torches dans the Hollow Crypt* |
| ![Les morts agités à la chapelle en ruine](../../docs/screenshots/restless-dead.jpg)<br>*Les morts agités à la chapelle en ruine* | ![Une bagarre avec les Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*En infériorité numérique au camp des bandits* |
| ![Old Greyjaw traqué sur la route du nord](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, l'apparition rare, rattrapé sur la route du nord* | ![Interface de marchand et de sacs](../../docs/screenshots/vendor-and-bags.jpg)<br>*On s'équipe chez Trader Wilkes, avec le marchand et les sacs ouverts* |
| ![Le portail lunaire sur la rive de Glimmermere](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Les noyés remontent au portail lunaire de Glimmermere* | ![Ysolei sur l'autel de the Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Lunar Tempest et l'autel de the Drowned Temple* |

La météo est pilotée par le biome et purement visuelle, donc elle ne touche jamais la simulation déterministe :

| | | |
|:---:|:---:|:---:|
| ![Ciel dégagé au-dessus d'Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Dégagé sur the Vale* | ![Pluie sur Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Pluie sur Mirefen Marsh* | ![Neige sur Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Neige sur Thornpeak Heights* |

## Jouez-y

Jouez dans votre navigateur à [worldofclaudecraft.com](https://worldofclaudecraft.com/), ou installez l'application native pour Windows, Linux, macOS, iOS ou Android. Chaque client se connecte au même monde en ligne.

### En ligne, avec d'autres joueurs

Créez un compte, créez un personnage et entrez dans le monde en direct. Pour faire tourner cette même pile client/serveur vous-même, voyez [Héberger votre propre monde](#host-your-own-world-one-command) ci-dessous.

### Hors ligne, dans le serveur de développement

Le mode hors ligne est un monde local à un joueur, sans compte ni autorité de serveur, donc il n'est livré que dans les versions de développement. Lancez le serveur de développement et il apparaît dans le sélecteur de mode :

```bash
npm install
npm run dev        # then open http://localhost:5173 and choose Play Offline
```

Nommez votre personnage, choisissez l'une des neuf classes, et vous commencez dans **Eastbrook Vale** (niveaux 1-7), une ville marchande entourée de pôles : des courses de loups au nord, des prairies de sangliers à l'est, les bois de Sableweb à l'ouest, Mirror Lake au nord-ouest, une mine de cuivre infestée de fouisseurs au sud-ouest et une chapelle en ruine de morts agités au nord-est, avec le camp de bandits de Gorrak au sud-est. La route du nord grimpe par un col de montagne jusqu'à **Mirefen Marsh** (6-13, pôle Fenbridge) et continue jusqu'à **Thornpeak Heights** (13-20, pôle Highwatch). La graine du monde est fixée dans `src/main.ts`, donc c'est le même endroit à chaque visite.

### Applications de bureau pour Windows, Linux et macOS

World of ClaudeCraft est livré comme des applications de bureau complètes pour les trois grandes plateformes de bureau : des programmes d'installation Windows signés, des paquets AppImage et deb pour Linux, et des versions macOS universelles signées et notariées. Elles utilisent le même client de jeu et le même monde en ligne que le navigateur, avec un empaquetage natif et des mises à jour automatiques.

La connexion en ligne se fait par Discord et courriel seulement, exactement comme le flux web : le courriel et le mot de passe vous connectent dans l'application, et « Continue with Discord » ouvre votre navigateur par défaut sur la page `/desktop-login`, qui renvoie un code à usage unique à l'application par un lien profond `worldofclaudecraft://` que l'application échange contre un jeton de session World of ClaudeCraft normal.

```bash
npm run electron:dev          # Vite + Electron dev shell
npm run electron:pack         # local unpacked desktop app
npm run electron:build        # website-channel installers (self-updating)
npm run electron:build:steam  # SteamPipe depot layouts (in-app updater off)
```

Pointez la coquille vers une autre API avec `VITE_DESKTOP_API_ORIGIN`, par exemple un serveur local ou un hôte de préproduction :

```bash
VITE_DESKTOP_API_ORIGIN=http://127.0.0.1:8787 npm run electron:dev
```

Remplacez l'origine de l'API de production pour les versions de préproduction avec `VITE_DESKTOP_API_ORIGIN=https://dev.worldofclaudecraft.com` (une valeur de temps de CONSTRUCTION : elle est intégrée au bundle et estampée dans l'application empaquetée, et les versions installées l'ignorent comme variable d'environnement d'exécution). Steam est un canal de distribution (le même bundle Electron, téléversé par SteamPipe), et les joueurs sur bureau peuvent lier un compte Steam pour refléter les deeds qu'ils gagnent dans les hauts faits Steam ; la connexion elle-même reste par courriel et Discord. Le manuel de version complet (signature, notarisation, publication d'une mise à jour automatique, dépôts SteamPipe, le déploiement du serveur) est `docs/desktop-release.md`. iOS et Android sont livrés par Capacitor, avec leur propre manuel dans `docs/mobile-store-release.md`.

<a id="host-your-own-world-one-command"></a>

## Héberger votre propre monde (une seule commande)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres and the game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

Pour un **hébergement distant**, placez la pile compose sur n'importe quel VPS, définissez un vrai `POSTGRES_PASSWORD` dans l'environnement et placez un proxy inverse TLS devant le port 8787. Caddy le fait en quelques lignes ; les WebSockets sont relayés automatiquement et le client choisit tout seul `wss://` sur les pages https. Les points de terminaison d'authentification sont limités en débit, les mots de passe sont hachés avec scrypt et les sessions de connexion expirent. Ne définissez jamais `ALLOW_DEV_COMMANDS=1` en production, puisque cela active l'ensemble complet des triches `/dev` : les triches de niveau et de téléportation qu'utilisent les robots de test, plus l'octroi d'objets, l'apparition de mobs, la téléportation vers les instances et l'interface de commandes de développement en jeu. [DEPLOY.md](../../DEPLOY.md) est le guide de production complet, y compris la configuration du proxy inverse qui garde les points de terminaison de santé et de métriques hors de la bordure publique.

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

Ouvrez http://localhost:5173, choisissez **Play Online**, créez un compte, créez un personnage et faites Enter World. L'écran de sélection de personnage affiche les dernières nouvelles de version dans son panneau News & Updates, avec des badges NEW pour tout ce que vous n'avez pas encore vu. Ouvrez un deuxième onglet et reconnectez-vous pour vous voir mutuellement en ville. `Enter` ouvre le clavardage. Le wiki joueur est le Guide inclus au dépôt, servi à http://localhost:5173/wiki et à `/wiki` en production ; son contenu est généré à partir des données de jeu actuelles par `npm run wiki:content`.

Ce qui persiste et comment le serveur garde le contrôle :

- **Comptes** : mots de passe hachés avec scrypt et jetons porteurs qui expirent.
- **Personnages** : jusqu'à 10 par compte et par royaume ; niveau, équipement, sacs, coffre de banque, quêtes, talents, métiers, progression JcJ et de deeds, position et argent persistent en JSONB dans Postgres, sauvegardés sur minuterie, à la déconnexion et à l'arrêt du serveur. Les noms sont uniques par royaume et de style classique.
- **Le serveur fait autorité** : les clients diffusent leur intention de mouvement et leurs commandes à 20 Hz ; le serveur exécute l'unique `Sim` partagée et renvoie des instantanés limités à la zone d'intérêt plus des événements par joueur. Chaque jet de combat, chute de butin, crédit de quête et transaction de marchand se résout côté serveur. Le client est un afficheur.

<a id="train-an-agent-headless-rl"></a>

## Entraîner un agent (RL sans interface)

Le même noyau déterministe s'exécute comme un environnement [Gymnasium](https://gymnasium.farama.org/), de sorte qu'un agent apprend contre le vrai jeu, et non une réimplémentation de celui-ci. Le serveur d'environnement (`headless/env_server.ts`) enveloppe une `Sim` et parle du JSON délimité par sauts de ligne par stdio ; les liaisons Python dans `python/` le lancent comme sous-processus et exposent la boucle habituelle `reset` / `step` / `close`.

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

- **Les espaces d'observation et d'action sont dérivés du contenu.** Interrogez-les depuis la réponse `info` de l'environnement au démarrage plutôt que de les coder en dur ; ils grandissent avec le jeu. L'espace d'action est un `Discrete` couvrant le déplacement, le ciblage, l'attaque, la panoplie de capacités complète, l'interaction et manger/boire ; l'observation est un `Box` couvrant soi, les capacités, la cible, les mobs à proximité, l'interactif le plus proche et la progression des quêtes.
- **La récompense** est une somme pondérée de deltas de compteurs par tick (XP, dégâts infligés et subis, mises à mort, morts, progression des quêtes, montées de niveau), réglable à chaque reset. Chaque `step` applique une action et avance de cinq ticks de simulation par défaut, soit environ quatre décisions par seconde simulée.
- **Déterministe par construction.** Pas d'horloge murale, pas de `Math.random`. Donnez une graine au reset et l'épisode se rejoue à l'identique.

Le protocole et les liaisons sont documentés dans `headless/CLAUDE.md` et `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft est natif web3 autour de **$WOC**, notre jeton communautaire sur Solana. Connectez un portefeuille Solana, liez-le à votre compte avec une seule signature (non dépositaire, aucune transaction à approuver), et votre solde de $WOC en lecture seule apparaît dans l'ATH à côté d'un badge cosmétique de palier de détenteur.

$WOC a aussi une utilité optionnelle dans le jeu en direct :

- **WOC Store** : achetez du Claudium, la monnaie cosmétique à sens unique, en monnaie fiduciaire, en SOL, en USDC ou en $WOC. Le rail de paiement $WOC est à rabais par rapport aux autres.
- **Season 1 Armory** : dépensez du Claudium en collections d'apparences d'armes cosmétiques. Les achats en boutique n'ajoutent ni statistiques ni puissance de combat.
- **Daily Rewards** : les détenteurs vérifiés admissibles peuvent gagner des points par une roue quotidienne et des tâches en rotation, puis se disputer une part de la cagnotte quotidienne.

Rien de tout cela n'est nécessaire pour jouer. Lier un portefeuille est optionnel et non dépositaire, il n'y a pas de pay-to-win, et tout le jeu se joue très bien sans jamais connecter de portefeuille.

**Adresse du contrat $WOC (Solana) :**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Plus de détails sur le jeton à [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Une visite du monde

### Les neuf classes

Chaque classe tourne sur des mécaniques de MMO d'époque classique implémentées à partir des premiers principes, et apprend des sorts à rangs à travers les niveaux 1-20, avec des capacités emblématiques comme Low Blow, Early Grave, Skyfall, Urgent Prayer et Ancestral Strike qui se débloquent dans la seconde moitié de la montée.

- **Warrior** : rage, Iron Bellow, Onrush, Quaking Blow, Maiming Strike, Gaping Wounds (un saignement qui accompagne vos coups), Widening Arc, Hobbling Cut, Blood Toll, Redhand (proc d'esquive).
- **Paladin** : Oathbrand libéré par Verdict, Mending Light, Steadfast Aura, Oath of Iron, Ward of Faith (absorption), Sundering Gavel (étourdissement), Last Rite.
- **Hunter** : attaque automatique à distance (8-35 yd avec une zone morte de style classique), Gutting Strike, Harrier's Guise, Venom Barb, Fell Shot, Rattling Shot, Counterfang, Fettering Slash, et un familier apprivoisable dès le niveau 10.
- **Rogue** : énergie et points de combo, Wicked Slash, Dirt Nap, Craven Thrust (de dos, dague), Eye Jab, Ghostfoot, Cutthroat Tempo, Swift Heels.
- **Priest** : Smite, Whispered Prayer, Litany of Resolve, Dirge of Decay, Psalm of Warding (absorption), Lingering Grace (HoT), Mindfracture.
- **Shaman** : Arc Bolt, Stonebound Weapon (enchantement d'arme), Mending Waters, Earthen Jolt, Thunder Ward (épines), Cinder Jolt.
- **Mage** : Cinderbolt, Hoarfrost Mantle, Aether Insight, Rimelance, Waterbind, Cinderfall, Aether Darts (canalisé), Bewitch, Icebind, un élémentaire d'eau invoqué, et Chronomancy, une spécialisation de soins fondée sur la magie du temps.
- **Warlock** : Gloom Bolt, Fiendhide, Burning Pact, Blackrot, Hard Bargain, Hex of Anguish, Consume, et sept démons invocables, de l'Emberkin au Wraithborn.
- **Druid** : Wildbolt, Wildmend, Wildward, Lunar Tempest, Wildbloom, Briarguard, Gripping Roots, et la métamorphose en Wolf Form au 5, Bruin Form au 8 et Moonwing Form au 10.

Les soins et les améliorations s'appliquent aux membres du groupe, les soins peuvent faire des coups critiques, et les boucliers d'absorption encaissent les dégâts avant la vie. Dépensez des points dans **trois spécialisations de talents par classe** (Battlecraft/Bloodrush/Ironguard, Moongrove/Wildfang/Groveheart, et ainsi de suite) ; l'allocation est validée par le serveur et exportable sous forme de chaîne de build.

### Donjons

La trame des Gravecaller traverse trois instances d'élite à cinq joueurs, une quatrième attend derrière un portail lunaire avec son propre folklore de noyés, et une crypte en solo se trouve à l'écart pour les explorateurs.

- **The Hollow Crypt** (5 joueurs) sous the Fallen Chapel : groupes d'élites appariés, le miniboss Sexton Marrow, et Morthen the Gravecaller avec son AoE d'ombre récurrent. La porte de la crypte téléporte votre groupe dans une copie d'instance privée qui se réinitialise une fois qu'elle se vide.
- **The Sunken Bastion** (5 joueurs, autour du niveau 13, sud-est de Mirefen) : Vael the Fogbinder invoque des vagues de Drowned Thralls à mesure que le combat s'étire.
- **Gravewyrm Sanctum** (5 joueurs, niveau 20, sous Thornpeak) : trois chambres de boneguard et de scaleguard d'élite, Korgath the Bound, Grand Necromancer Velkhar et Korzul the Gravewyrm, où des armes épiques tombent.
- **The Drowned Temple** (5 joueurs) par le portail lunaire de Glimmermere : une instance pâle, violet-lune, menant à Choirmother Selthe puis à Ysolei, Avatar of the Drowned Moon, dont les marées lunaires et les Moonspawn invoqués punissent un groupe immobile.
- **The Abandoned Crypt** (solo) à Thornpeak : une plongée tranquille de clé de voûte et de journal intime pour une personne, dont la piste descelle la porte royale vers **Nythraxis, Scourge of Thornpeak**, un final de raid à dix joueurs livré à travers trois pierres-gardes d'âme.

Chaque instance tourne aussi en **Héroïque** : des ennemis de niveau supérieur, des mécaniques plus tranchantes, et son propre butin et sa propre monnaie de marchand. Les chaînes de quêtes préparatoires sont jouables en solo, donc l'histoire n'est jamais bloquée derrière la recherche d'un groupe. Notre raid automatisé à cinq robots (warrior, paladin, priest, mage, hunter avec IA de tir concentré et de soin) nettoie the Hollow Crypt en environ cinq minutes (`node scripts/crypt_raid.mjs`, nécessite `ALLOW_DEV_COMMANDS=1`).

### Delves

Les delves sont un mode séparé et évolutif pour petit groupe d'un ou deux joueurs, reconstruit à partir de chambres aléatoires à chaque partie et se terminant sur un coffre-reliquaire verrouillé qui s'ouvre par un mini-jeu de crochetage plutôt que par un jet de butin. **The Collapsed Reliquary** (niveau 7 et plus) se termine chez Deacon Varric, avec une compagne IA, Tessa, qui combat à vos côtés si vous y allez seul. **The Drowned Litany** (niveau 12 et plus) suit la piste jusqu'à un sanctuaire inondé à la lisière de Mirefen Marsh. Un tableau des delves fixe le palier : Héroïque relève les niveaux des ennemis et ajoute un affixe aléatoire pour de plus riches récompenses.

### JcJ classé (the Ashen Coliseum)

Appuyez sur `G` ou sur le bouton d'arène pour entrer en file. L'appariement téléporte les combattants dans une fosse privée, un court compte à rebours soigne et réinitialise tout le monde pour un départ équitable, et le combat se termine quand un camp abandonne. Personne ne meurt, et vous revenez exactement là où vous avez fait la file. Protect Yumi se joue dans son propre labyrinthe plutôt que dans la fosse du Coliseum.

- **Échelles classées 1c1 et 2c2**, chacune avec un classement persistant de style Elo et un palmarès de tous les temps.
- **2c2 Fiesta**, un mode de fête plus animé où les équipes courent vers un objectif de mises à mort pendant que des ramassages d'amélioration distribuent de la puissance et qu'un anneau qui se referme force le combat à se rejoindre.
- **Protect Yumi**, un mode d'objectif non classé 3c3 et 5c5 joué dans un labyrinthe : chaque équipe garde un familier félin en tentant d'abattre celui du camp adverse, de sorte que les escortes et les prises comptent plus que les mises à mort brutes.

Les victoires classées et les mises à mort en Fiesta rapportent de l'**Honor**, que le quartier-maître en ville échange contre un ensemble d'équipement Warfare. Warfare est une statistique réservée au JcJ, donc l'ensemble gagne les duels sans jamais dépasser le butin de donjon du même palier en JcE.

### Jouer ensemble

- **Dungeon Finder** : ouvrez-le avec `Shift+I` pour parcourir donjons et raids, inspecter les boss et le butin, rejoindre une file automatique par rôle tank/soigneur/DPS, ou créer une annonce de groupe préformé. Les groupes formés par le Finder voyagent quand même ensemble jusqu'à l'entrée.
- **Groupes** jusqu'à 5, convertis en raid de 10 joueurs à deux groupes une fois pleins : clic droit sur un joueur et Inviter dans le groupe. Les membres partagent les droits de première attaque et le crédit de quête, partagent l'XP avec les bonus de groupe d'époque classique, et apparaissent comme points sur la minicarte. `/p` pour le clavardage de groupe, `/roll` pour régler le butin.
- **Échanges** : clic droit et Échanger. Les deux camps préparent objets et argent, les deux doivent accepter, et l'échange est atomique et validé par le serveur. Les objets de quête ne peuvent pas être échangés, et s'éloigner annule.
- **Duels** : clic droit et Défier en duel. Un compte à rebours de 3 secondes, puis on se bat jusqu'à ce qu'un camp atteigne 1 pv ; le vainqueur est annoncé à l'échelle de la zone et courir à 60 verges abandonne.
- **Droits de première attaque et statut d'absence** : le premier joueur à blesser un mob possède son butin, son XP et son crédit de quête ; `/afk` et `/dnd` vous marquent absent avec une réponse automatique aux chuchotements.

### Monde et systèmes

- **Métiers** (`Shift+P`) : quatre métiers de récolte (minage, bûcheronnage, herboristerie, pêche) alimentent dix métiers de fabrication, de la cuisine et l'alchimie à la forge d'armes, la joaillerie et l'enchantement. Les outils de récolte existent en paliers qui décident quels gisements vous pouvez exploiter, la fabrication se fait aux postes de travail en ville avec une chance de qualité chef-d'œuvre qui porte la marque de son artisan, et il y a un système d'archétypes à découvrir à mesure que vous vous spécialisez.
- **The World Market** : un hôtel des ventes dirigé par les joueurs pour l'équipement, les matériaux et les consommables, consultable depuis les villes-pôles.
- **Courrier Ravenpost** : envoyez objets et pièces à d'autres personnages, les pièces jointes étant gardées en sûreté jusqu'à leur réclamation.
- **Guildes** : chartes, listes de membres, rangs et clavardage de guilde.
- **The Guide** : un wiki de site consultable à `/wiki` couvrant classes, créatures, zones et deeds, généré directement à partir du contenu de jeu en direct, de sorte qu'il ne peut pas s'écarter du monde qu'il documente.
- **The Vale Cup et Card Duel** : du boarball au stade de Sowfield au sud d'Eastbrook, dans des formats du 1c1 au 5c5, et un jeu de cartes rapide en tête-à-tête tenu par le Card Master en ville.
- **Daily Rewards** : les détenteurs de $WOC vérifiés peuvent gagner des points de palmarès par une roue quotidienne et des tâches en rotation, avec versements automatiques depuis la cagnotte quotidienne.
- **WOC Store et Season 1 Armory** : achetez du Claudium en monnaie fiduciaire, en SOL, en USDC ou en $WOC, puis dépensez-le en apparences d'armes purement cosmétiques.
- **Manger et boire** : asseyez-vous pour récupérer, interrompu par des dégâts ou en vous levant, et oui, vous pouvez manger et boire en même temps.
- **Marchands** qui achètent nourriture et eau et vendent de l'équipement blanc honnête, avec les pièces affichées en or, argent et cuivre.
- **Une banque personnelle** (the Gilded Strongbox) : les intendants de chaque ville-pôle gardent un coffre par personnage, de 24 emplacements jusqu'à 96 avec des agrandissements achetés en pièces, plus des emplacements bonis gagnés en ligne pour un courriel vérifié, des comptes liés et des parrainages.
- **The Book of Deeds** : un journal de hauts faits (`Shift+Z` par défaut) de quêtes, mises à mort, nettoyages et curiosités, qui verse des titres cosmétiques que vous pouvez porter sur votre plaque de nom, dans le clavardage et sur les tableaux, plus un traqueur d'ATH pour les deeds que vous poursuivez, des Chroniques par zone tenues par les PNJ Chronicler, et un palmarès de Renown à vie ; la liste publique vit à `/wiki/deeds`.
- **IA des mobs** : errance, agression de proximité selon l'écart de niveau, pulls sociaux, poursuite, laisse et réinitialisation, butin de cadavre et réapparitions, avec une apparition rare (Old Greyjaw) sur une longue minuterie.
- **Coins de pêche** avec leurs propres tables de butin et leurs prises rares.
- **Apparences cosmétiques** tirées en rareté peu commune, rare et épique, purement pour l'allure.
- **Mort et récupération** : libérez votre esprit vers le cimetière, subissez des dégâts de chute et ralentissez en nageant.
- **Météo de biome** : dégagé dans the Vale, pluie dans the Marsh, neige sur the Peaks, avec fondu enchaîné quand vous passez d'une zone à l'autre.

### Contrôles (disposition classique)

| Entrée | Action |
|---|---|
| `W` / `S` | courir / reculer. `A`/`D` tournent (strafe avec le bouton droit maintenu), `Q`/`E` font du strafe |
| glisser-droit / glisser-gauche | regard libre / caméra en orbite. La molette zoome, `Space` saute |
| `Tab` | cycler les ennemis les plus proches. clic gauche pour cibler, clic droit pour attaquer, piller ou parler |
| `1`-`9`, `0`, `-`, `=` | barre d'action |
| `F` | interagir (piller un cadavre, ramasser un objet, parler) |
| `C` `P` `L` `M` `B` `N` `T` | personnage, grimoire, journal de quêtes, carte du monde, sacs, talents, artisanat |
| `G` `O` `K` `I` `Y` `Shift+I` `Shift+P` `Shift+Z` | arène, amis et guilde, palmarès, calendrier, Vale Cup, Dungeon Finder, métiers, deeds |
| `Z` / `X` | rengainer ou dégainer vos armes, roue d'émotes |
| `V` / `R` / `Esc` | plaques de nom, course auto, fermer la fenêtre du dessus (ou ouvrir le menu du jeu) |

Chaque raccourci est remappable dans le panneau des raccourcis. Les contrôles tactiles (un manche de déplacement, le glissement de caméra et des boutons d'action à l'écran) apparaissent automatiquement sur mobile.

## Architecture (une simulation, trois hôtes)

Trois idées tiennent le projet ensemble :

- **Une simulation, trois hôtes.** Le même code `src/sim/` fait tourner le monde de navigateur hors ligne, le serveur en ligne et l'environnement RL. Le comportement doit être identique partout, et les tests existent pour le maintenir ainsi.
- **`IWorld` est la seule jointure.** `IWorld` est défini comme des interfaces de facette par domaine sous `src/world_api/`, agrégées par `src/world_api.ts`. La `Sim` hors ligne le satisfait structurellement et la `ClientWorld` en ligne l'implémente en réfléchissant les instantanés du serveur. L'afficheur et l'ATH ne parlent qu'à `IWorld`, jamais à un monde concret, donc une nouvelle fonctionnalité étend d'abord la facette correspondante puis les deux mondes.
- **Le serveur fait autorité.** Les clients envoient l'intention ; le serveur décide des résultats. Le client ne résout jamais le combat, le butin ou l'économie de lui-même.

La simulation est un tick fixe à 20 Hz (`DT = 1/20`), tout le hasard passe par un seul `Rng` à graine, et `src/sim/` ne porte aucun import DOM, navigateur ou Three.js. C'est ce qui permet au même code de se grouper en un serveur d'environnement Node, une boucle de jeu faisant autorité et un onglet de navigateur sans changer une seule ligne.

### Disposition du projet

| Chemin | Ce que c'est |
|---|---|
| `src/sim/` | Noyau de jeu déterministe, la source de vérité. Aucune dépendance DOM ou Three. |
| `src/sim/content/` | Données comme code : les neuf classes, capacités, zones, donjons, delves, objets, recettes, enchantements, talents, métiers, deeds. |
| `src/world_api.ts` + `src/world_api/` | `IWorld`, la jointure dont dépendent l'afficheur et l'ATH : une interface de facette par domaine. |
| `src/` (le reste) | Afficheur Three.js, ATH et styles, entrée/audio, miroir en ligne, et les SPA d'administration, de guide et d'éditeur. |
| `server/` | Serveur faisant autorité : HTTP et WS, boucle de monde, Postgres, authentification, social, modération. |
| `server/http/` | Le pipeline de requêtes REST : routeur à table, intergiciels et définitions de routes par domaine. |
| `headless/` + `python/` | Serveur d'environnement RL (`env_server.ts`) et liaisons Python Gym. |
| `bot/` | Robot Discord (rôles, relais, fil d'activité). |
| `electron/`, `android/`, `ios/` | Coquilles de bureau (Steam) et mobiles natives. |
| `tests/` | Suite Vitest. |
| `scripts/` | Outillage de construction, ressources, i18n, SFX, captures d'écran et E2E navigateur. |
| `deploy/` · `mediawiki/` | Ressources de premier démarrage en production et le conteneur du wiki joueur. |
| `public/` · `docs/` | Ressources statiques (déployées telles quelles sur le site) et documents de conception. |

Rien de tout cela ne relève du système d'honneur : `tests/architecture.test.ts` scrute chaque fichier
de simulation à la recherche d'un import interdit, d'un global DOM ou d'un appel d'horloge ou de
`Math.random` égaré, et `tests/world_api_parity.test.ts` épingle la jointure pour que les deux mondes
ne puissent pas dériver.

La plupart des répertoires portent leur propre `CLAUDE.md` avec leurs conventions locales, et
l'ensemble complet des invariants du projet vit dans le [`CLAUDE.md`](../../CLAUDE.md) racine. Les
contributeurs agents commencent là, puis prennent le point d'entrée de leur runtime :
[`AGENTS.md`](../../AGENTS.md) plus le [guide d'opérateur Codex](../codex.md) pour Codex,
[`GEMINI.md`](../../GEMINI.md) pour Gemini. Tous mènent à la même architecture canonique.

## Construit comme les classiques

Le combat, la montée de niveau et la menace tournent tous sur d'authentiques règles d'époque classique : rage et énergie, tables de toucher et d'esquive, mitigation d'armure, la vraie courbe d'XP, minuteries de coup et le temps de recharge global. Ça a la sensation dont vous vous souvenez plutôt que de l'approximer. Les chiffres exacts vivent dans `src/sim/` si vous voulez les lire.

Le monde est créé en code plutôt que dans un éditeur 3D, ce qui le garde petit,
déterministe et facile à forker :

- Le terrain, l'eau, la météo, le ciel, les plans de ville, les ombres en temps réel et les effets de combat sont générés à l'exécution à partir des données mêmes de la simulation.
- Les modèles qui sont livrés sont construits de la même façon : des fabriques procédurales sous `scripts/assets/` exportent des GLB déterministes par le pipeline image-vers-GLB du projet, aux côtés d'une bibliothèque sélectionnée de trousses de modèles CC0. Les familles de créatures et de personnages avec squelette portent des animations complètes de marche, attaque, incantation, assise et mort.
- Les icônes sont un peintre en couches qui compose l'art de tout ce qui n'a pas de fichier livré, donc rien n'est jamais sans icône, avec de l'art peint sélectionné superposé par-dessus pour les capacités, les objets et les deeds.
- Un ATH classique complet (cadres d'unité, barres d'action, infobulles, journal de quêtes, carte du monde, minicarte, texte de combat flottant, the Book of Deeds), des effets sonores spatiaux et d'interface échantillonnés, et une trame sonore composée de façon procédurale dans le dépôt et livrée en remasterisations diffusées qui se fondent entre zones, villes, donjons et combat.

Chaque ressource livrée et sa licence sont consignées dans [CREDITS.md](../../CREDITS.md), et les
dépendances tierces incluses portent leurs avis dans [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Développement

En plus du client de jeu, la construction produit le tableau de bord d'opérateur, l'éditeur de monde
à `/editor` et le Guide public à `/wiki`, tous servis depuis le même serveur de développement.

Chaque chemin FFmpeg que le gate et les tests audio exercent résout les paquets npm
`ffmpeg-static`/`ffprobe-static` inclus, donc une contribution normale n'a besoin d'aucune
installation FFmpeg système. Les chemins qui mesurent la conformité (`npm run sfx:check`, les tests
audio, la validation d'export du Studio) se lient directement aux binaires statiques, sans repli sur
le `PATH` : relancez `npm ci` si une installation aux scripts ignorés les a laissés manquants. Les
lancements de lecture et d'encodage du Studio et la vérification préalable de `npm run gate`
résolvent via `scripts/sfx/ffmpeg_paths.mjs`, qui, lui, se replie sur le `PATH`. Certains scripts
autonomes de génération audio (par exemple `scripts/gen_ui_sfx.mjs`) utilisent encore `ffmpeg` du
`PATH` par défaut.

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

Les tests de logique et unitaires utilisent Vitest. Pendant que vous itérez, exécutez un seul fichier : `npx vitest run tests/sim.test.ts`. Les changements d'interface ont aussi une suite optionnelle en vrai navigateur couvrant l'accessibilité, la navigation au clavier et les cibles tactiles : `npm run test:browser`. Les scripts de capture d'écran et de fumée pilotent de vrais navigateurs via `puppeteer-core` et nécessitent `npm run dev` en marche ; les scripts au niveau du fil (`mp_integration.mjs`, `social_e2e.mjs`, `crypt_raid.mjs`) parlent directement au serveur et nécessitent plutôt `npm run server`. Les agents de navigateur peuvent piloter le déplacement par `window.__game.controller` plutôt que de simuler des touches maintenues, par exemple `controller.move({ forward: true }, facingRadians)` ou des indicateurs compacts comme `{ f: 1, sr: 1 }`.

Les vérifications s'exécutent en couches, décrites dans [docs/qa-gate.md](../qa-gate.md) : pointez
votre clone vers les hooks partagés avec `git config core.hooksPath .githooks` et un plancher rapide
s'exécute avant que quoi que ce soit quitte votre machine.

Pour les commandes de serveur, voyez [Développer en ligne](#develop-online-with-hot-reload) ci-dessus,
[CONTRIBUTING.md](CONTRIBUTING.fr_CA.md) pour le flux de contribution, le
[tutoriel du SFX Studio](../sfx-studio-tutorial.md) pour la création sonore et
l'export d'artefacts, [DEPLOY.md](../../DEPLOY.md) pour la production, et
[CREDITS.md](../../CREDITS.md) pour les licences des ressources.

## Localisation

Chaque chaîne visible par le joueur se résout via `t()`, et le jeu est livré en **22 langues** (anglais, deux espagnols, deux français, anglais Canada, italien, allemand, chinois simplifié et traditionnel, coréen, japonais, portugais brésilien, russe, tchèque, néerlandais, polonais, indonésien, turc, suédois, vietnamien et danois). La simulation et le serveur restent agnostiques de la langue : ils émettent des clés stables ou de l'anglais que le client relocalise à la frontière, ce qui préserve le déterminisme. Les contributeurs ajoutent l'anglais seulement ; le mainteneur remplit par lots les autres langues avant chaque version. Le flux de travail est documenté dans `docs/i18n-scaling/translation-workflow.md`.

## Contribuer

Les contributions de toutes sortes sont les bienvenues : code, traductions, rapports de bogues et documentation. Commencez par [CONTRIBUTING.md](CONTRIBUTING.fr_CA.md) pour la configuration, lisez le [Code de conduite](../../CODE_OF_CONDUCT.md), et consultez [SECURITY.md](../../SECURITY.md) avant de signaler une vulnérabilité. Nouveau ici ? Cherchez les enjeux étiquetés [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), ouvrez un [enjeu](https://github.com/levy-street/world-of-claudecraft/issues/new/choose), ou dites bonjour sur [Discord](https://discord.com/invite/worldofclaudecraft).

Le développement actif se déroule sur la plus récente branche `release/vX.Y.Z`. Repérez-la plutôt que de la supposer, puis créez votre branche à partir d'elle et visez-la avec votre demande de tirage. Ne créez jamais de branche à partir de `main` et ne la visez jamais : elle ne reçoit une branche de version que lorsque cette version est livrée. [CONTRIBUTING.md](CONTRIBUTING.fr_CA.md) donne la commande d'une seule ligne qui trouve la branche actuelle.

## Licence

**Le code est [sous licence MIT](../../LICENSE), alors forkez-le, remixez-le et hébergez votre propre monde.** C'est tout l'intérêt, et rien d'autre sur cette page ou sur notre site web ne le reprend.

Trois choses sont sous licence distincte, alors ça vaut trente secondes de savoir laquelle est laquelle :

| Quoi | Licence | Pouvez-vous le redistribuer ? |
|---|---|---|
| **Le code source**, c'est-à-dire tout sauf les ressources média retranchées ci-dessous | [MIT](../../LICENSE) | Oui. Commercialement aussi. |
| **Les ressources média** : modèles, textures, HDRIs, icônes, sons, polices (surtout sous `public/`) | Par ressource, consignée dans [CREDITS.md](../../CREDITS.md) | Surtout oui (la plupart sont CC0). Certaines non, voir ci-dessous. |
| **Le nom et la marque** : « World of ClaudeCraft », « Levy Street », les logos | Non licenciés | Non. |

**Forkez-le et hébergez votre propre monde. Ça fonctionne, et les ressources ne sont pas dans votre chemin.** La plupart de ce que vous voyez est du domaine public CC0 (KayKit, Quaternius, Kenney, ambientCG, Poly Haven), et nos propres accessoires générés, créatures, décors et sons d'interface sont livrés avec le projet pour qu'un fork fonctionne dès l'installation. Vous ne pouvez simplement pas les extraire pour les vendre comme art autonome.

Ce qu'il faudrait retirer ou remplacer avant de redistribuer :

- les **icônes de capacités de classe CraftPix** sous `public/ui/skills/` ont été achetées par Levy Street et **ne peuvent pas être redistribuées**, alors achetez votre propre licence si vous voulez les livrer ;
- les **effets sonores de @jamiecypher** sont sous CC BY-NC 4.0, alors partagez-les de façon non commerciale avec crédit, mais l'octroi commercial ne vaut que pour ce projet ;
- l'**art de boutique et de prestige** (Season 1 Armory, l'ensemble Claudium, l'ensemble d'art des métiers, les icônes du Book of Deeds, l'emblème du dragon d'élite) est de l'art commercial commandé et **les droits sont réservés** ;
- les **marques tierces** (Twitch, X, Kick, YouTube, Discord, Solana, USDC) sont des marques de commerce de leurs propriétaires et il ne nous appartient pas de les concéder ;
- une poignée d'**icônes et d'enregistrements utilisés avec permission** exigent une permission pour être transmis.

[CREDITS.md](../../CREDITS.md) est la liste faisant autorité, avec une colonne de redistribution par ressource. Là où une ressource y est inscrite, cette licence prime sur la licence MIT du projet. Ce registre est encore en cours d'achèvement, donc une ressource média absente est non consignée plutôt que libre : demandez avant de vous y fier. Le code source fonctionne à l'inverse, et tout ce qui n'est pas retranché est sous MIT.

Nos [conditions d'utilisation](https://worldofclaudecraft.com/terms) couvrent le jeu hébergé que nous exploitons à worldofclaudecraft.com : comptes, conduite, objets virtuels. Elles ne restreignent pas les droits que la licence MIT vous accorde sur ce code source.
