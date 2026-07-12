<div align="center">

# World of ClaudeCraft

**Partez en quête, formez un groupe et affrontez des raids dans un monde fait main, gratuitement dans votre navigateur. Open source, web3 et en ligne dès maintenant.**

**Site officiel : https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.24.1-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.fr_FR.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/GjhnUsBtw)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · **Français** · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Jouer maintenant](https://worldofclaudecraft.com/) · [Héberger votre propre monde](#host-your-own-world-one-command) · [Entraîner un agent](#train-an-agent-headless-rl) · [Web3](#web3) · [Contribuer](CONTRIBUTING.fr_FR.md) · [Discord](https://discord.gg/GjhnUsBtw)

![Écran-titre de World of ClaudeCraft](../../docs/screenshots/title-screen.jpg)

</div>

## Présentation

World of ClaudeCraft est un MMO complet d'inspiration classique auquel vous pouvez jouer dès maintenant dans votre navigateur, que vous pouvez héberger vous-même en une seule commande, et qui vous permet même d'entraîner des agents IA à y jouer. Il est gratuit, open source, et en ligne sur [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Un même monde partagé tourne à trois endroits, tous issus du même cœur de jeu :

- le **monde navigateur hors ligne**, où il suffit de cliquer sur Play Offline pour entrer en jeu,
- le **serveur multijoueur autoritaire**, où des comptes stockés dans Postgres partagent un monde vivant,
- l'**environnement RL headless**, où Python pilote le vrai jeu via une interface Gym.

Même graine, même monde, partout. Et presque rien n'est un asset livré : les villes, les créatures, les icônes de sorts et le son sont tous générés à l'exécution.

## Points forts

- **Neuf classes classiques**, chacune dotée d'une véritable panoplie d'inspiration vanilla qui gagne des rangs à mesure que vous montez en niveau, plus un **système de talents** complet (trois spécialisations par classe, 27 spécialisations en tout).
- **Trois zones en monde ouvert** du niveau 1 au niveau 20, près de 80 quêtes, et une seule trame narrative reliée autour de la conspiration des Gravecaller.
- **Cinq donjons instanciés**, dont quatre raids d'élite à cinq joueurs et une crypte en solo, avec une mise à l'échelle d'élite, des mécaniques de boss à dégâts de zone, et du butin propre à chaque archétype de classe.
- **Des delves évolutives**, un mode pour petit groupe à un ou deux joueurs accompagnés d'un compagnon IA, reconstruites à partir de salles aléatoires à chaque partie, sur les paliers Normal et Héroïque.
- **The Ashen Coliseum**, une arène JcJ classée avec des classements 1c1 et 2c2 ainsi qu'un mode 2c2 Fiesta (ramassage d'améliorations, un anneau qui se resserre, premier à quinze éliminations).
- **Du vrai multijoueur** : groupes, échanges, duels, droits de butin, partage d'XP en groupe, chuchotements, statut absent, et un serveur qui gère chaque jet de combat.
- **Tout est procédural** : villes à colombages, familles de créatures riggées, icônes de sorts peintes sur canvas, son WebAudio, météo de biome, et ombres en temps réel. Aucun fichier de modèle 3D pour le monde.
- **Localisé dans 21 langues** grâce à un pipeline déterministe où la sim émet des clés.
- **Environnement RL headless** avec des bindings Gymnasium, un façonnage de récompense, et un mode benchmark.
- **Nativement web3** : reliez un portefeuille Solana pour afficher votre solde de $WOC et un badge cosmétique de détenteur, entièrement optionnel et non dépositaire.

## Captures d'écran

![Un groupe se rassemble devant l'apothicaire d'Eastbrook](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Crépuscule au feu de camp d'Eastbrook](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Crépuscule au feu de camp d'Eastbrook* | ![Pulls d'élite dans the Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Pulls d'élite à la lueur des torches dans the Hollow Crypt* |
| ![Les morts agités à la chapelle en ruine](../../docs/screenshots/restless-dead.jpg)<br>*Les morts agités à la chapelle en ruine* | ![Une mêlée avec les Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*En infériorité numérique au camp de bandits* |
| ![Old Greyjaw traqué sur la route du nord](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, le rare spawn, rattrapé sur la route du nord* | ![Interface du marchand et des sacs](../../docs/screenshots/vendor-and-bags.jpg)<br>*S'équiper chez Smith Haldren, avec infobulles, sacs et pièces* |
| ![Le portail lunaire sur la rive de Glimmermere](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Les noyés remontent au portail lunaire de Glimmermere* | ![Ysolei sur l'autel du Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Moonfire et l'autel du Drowned Temple* |

La météo est pilotée par le biome et purement visuelle, elle ne touche donc jamais à la sim déterministe :

| | | |
|:---:|:---:|:---:|
| ![Ciel dégagé sur Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Ciel dégagé sur la Vale* | ![Pluie sur Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Pluie sur Mirefen Marsh* | ![Neige sur Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Neige sur Thornpeak Heights* |

## Jouer

Vous avez deux façons d'entrer, et elles font tourner le même monde.

### Hors ligne, dans votre navigateur

```bash
npm install
npm run dev        # then open http://localhost:5173 and click Play Offline
```

Nommez votre personnage, choisissez l'une des neuf classes, et vous démarrez à **Eastbrook Vale** (niveaux 1-7), une ville marchande entourée de six pôles : les coulées de loups au nord, les prés de sangliers à l'est, the Webwood à l'ouest, Mirror Lake au nord-ouest, une mine de cuivre kobold au sud-ouest, et une chapelle en ruine peuplée de morts agités au nord-est, avec le camp de bandits de Gorrak au sud-est. La route du nord grimpe par un col de montagne jusqu'à **Mirefen Marsh** (6-13, pôle Fenbridge) et continue jusqu'à **Thornpeak Heights** (13-20, pôle Highwatch). La graine du monde est fixée dans `src/main.ts`, c'est donc le même endroit à chaque visite.

### En ligne, avec d'autres joueurs

Voir [Héberger votre propre monde](#host-your-own-world-one-command) ci-dessous pour monter le vrai jeu client/serveur avec comptes et personnages persistants.

<a id="host-your-own-world-one-command"></a>

## Héberger votre propre monde (une seule commande)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres + game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

Pour un **hébergement distant**, déployez la pile compose sur n'importe quel VPS, définissez un vrai `POSTGRES_PASSWORD` dans l'environnement, et placez un reverse proxy TLS devant le port 8787. Caddy permet de le faire en deux lignes (`your.domain { reverse_proxy localhost:8787 }`) ; les WebSockets sont proxifiés automatiquement et le client sélectionne tout seul `wss://` sur les pages https. Les points d'accès d'authentification sont limités en débit par IP, les mots de passe sont hachés avec scrypt, et les jetons expirent au bout de 7 jours. Ne définissez jamais `ALLOW_DEV_COMMANDS=1` en production, car cela active les triches de niveau et de téléportation utilisées par les bots de test. Voir [DEPLOY.md](../../DEPLOY.md) pour le guide de production complet.

<a id="develop-online-with-hot-reload"></a>

### Développer en ligne avec rechargement à chaud

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api and /ws)
```

Ouvrez http://localhost:5173, choisissez **Play Online**, créez un compte, créez un personnage, et cliquez sur Enter World. Ouvrez un deuxième onglet et reconnectez-vous pour vous voir mutuellement en ville. `Enter` ouvre le tchat. Un vrai wiki de joueurs MediaWiki est lancé en parallèle de la pile Docker Compose à http://localhost:8080/wiki/ ; ses pages de départ sont générées à partir du contenu de jeu actuel avec `npm run wiki:seed`.

Ce qui persiste et comment le serveur garde la main :

- **Comptes** : mots de passe hachés avec scrypt et jetons porteurs valables 7 jours (`auth_tokens`).
- **Personnages** : jusqu'à 10 par compte ; niveau, équipement, sacs, quêtes, talents, position et argent persistent en JSONB dans Postgres, sauvegardés toutes les 30 secondes, à la déconnexion et à l'arrêt du serveur. Les noms sont uniques au monde, en lettres uniquement, dans le style classique.
- **Le serveur est autoritaire** : les clients envoient en flux l'intention de mouvement et les commandes à 20 Hz ; le serveur fait tourner l'unique `Sim` partagé et renvoie des snapshots limités à la zone d'intérêt (~120 yd) ainsi que des événements par joueur. Chaque jet de combat, chute de butin, crédit de quête et transaction avec un marchand est résolu côté serveur. Le client est un moteur de rendu.

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

env = WoWClassicEnv(player_class="warrior")   # warrior or mage
obs, info = env.reset(seed=42)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
env.close()
```

- **Les espaces d'observation et d'action sont dérivés du contenu.** Interrogez-les depuis la réponse `info` de l'env au démarrage plutôt que de les coder en dur ; ils grandissent avec le jeu. Aujourd'hui, l'espace d'action est `Discrete(44)` (déplacement, ciblage, attaque, la panoplie complète d'aptitudes, interaction, manger/boire) et l'observation est un `Box` de 276 flottants (soi, aptitudes, cible, créatures à proximité, interactif le plus proche, progression des quêtes).
- **La récompense** est une somme pondérée de variations de compteurs par tick (XP, dégâts infligés et subis, éliminations, morts, progression des quêtes, montées de niveau), réglable à chaque reset. Chaque `step` applique une action et fait avancer cinq ticks de sim par défaut, soit environ quatre décisions par seconde simulée.
- **Déterministe par construction.** Pas d'horloge murale, pas de `Math.random`. Donnez une graine au reset et l'épisode se rejoue à l'identique.

Le protocole et les bindings sont documentés dans `headless/CLAUDE.md` et `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft est nativement web3 autour de **$WOC**, notre jeton communautaire sur Solana. Connectez un portefeuille Solana, reliez-le à votre compte avec une seule signature (non dépositaire, aucune transaction à approuver), et votre solde de $WOC en lecture seule s'affiche dans le HUD aux côtés d'un badge cosmétique de palier de détenteur.

C'est purement cosmétique et non requis pour jouer. Rien n'est dépensé ni gagné en jeu, il n'y a pas de pay-to-win, et tout le jeu se joue très bien sans jamais connecter de portefeuille.

**Adresse du contrat $WOC (Solana) :**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Plus d'informations sur le jeton à [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Visite guidée du monde

### Les neuf classes

Chaque classe utilise de véritables mécaniques d'inspiration vanilla et apprend des sorts à rangs au fil des niveaux 1-20 (Lightning Bolt R2 au niveau 8, R3 au 14, R4 au 20, avec des aptitudes de haut niveau comme Execute, Kidney Shot, Flash Heal, Stormstrike et Starfire qui arrivent à leur niveau classique).

- **Warrior** : rage, Heroic Strike (au prochain coup, hors GCD), Battle Shout, Charge, Rend, Thunder Clap, Hamstring, Bloodrage, Overpower (proc d'esquive).
- **Paladin** : Seal of Righteousness déclenché par Judgement, Holy Light, Devotion Aura, Blessing of Might, Divine Protection (absorption), Hammer of Justice (étourdissement), Lay on Hands.
- **Hunter** : Auto Shot à distance (8-35 yd avec la zone morte classique), Raptor Strike, Aspect of the Hawk, Serpent Sting, Arcane Shot, Concussive Shot, Mongoose Bite, Wing Clip, et un familier apprivoisable à partir du niveau 10.
- **Rogue** : énergie et points de combo, Sinister Strike, Eviscerate, Backstab (dans le dos, dague), Gouge, Evasion, Slice and Dice, Sprint.
- **Priest** : Smite, Lesser Heal, Power Word: Fortitude, Shadow Word: Pain, Power Word: Shield (absorption), Renew (HoT), Mind Blast.
- **Shaman** : Lightning Bolt, Rockbiter Weapon (enchantement d'arme), Healing Wave, Earth Shock, Lightning Shield (épines), Flame Shock.
- **Mage** : Fireball, Frost Armor, Arcane Intellect, Frostbolt, Conjure Water, Fire Blast, Arcane Missiles (incantation canalisée), Polymorph, Frost Nova.
- **Warlock** : Shadow Bolt, Demon Skin, Immolate, Corruption, Life Tap, Curse of Agony, Drain Life, et sept démons invocables, de l'Imp au Doomguard.
- **Druid** : Wrath, Healing Touch, Mark of the Wild, Moonfire, Rejuvenation, Thorns, Entangling Roots, Bear Form au niveau 10.

Les soins et les buffs s'appliquent aux membres du groupe, les soins peuvent porter des coups critiques, et les boucliers d'absorption encaissent les dégâts avant les points de vie. Dépensez des points dans **trois spécialisations de talents par classe** (Arms/Fury/Protection, Balance/Feral/Restoration, et ainsi de suite) ; l'allocation est validée par le serveur et exportable sous forme de chaîne de build.

### Donjons

La trame des Gravecaller passe par quatre instances d'élite à cinq joueurs, et une crypte solo se tient à l'écart pour les explorateurs.

- **The Hollow Crypt** (5 joueurs) sous the Fallen Chapel : des packs d'élite par paire, le mini-boss Sexton Marrow, et Morthen the Gravecaller, qui lâche un Shadow Pulse à dégâts de zone toutes les dix secondes. La porte de la crypte téléporte votre groupe dans une copie d'instance privée qui se réinitialise après cinq minutes de vide.
- **The Sunken Bastion** (5 joueurs, vers le niveau 13, au sud-est de Mirefen) : Vael the Mistcaller invoque des vagues de Drowned Thralls à 60 % et 30 % de vie.
- **Gravewyrm Sanctum** (5 joueurs, niveau 20, sous Thornpeak) : trois salles de gardes-os d'élite et de drakonides, Korgath the Bound (enrage sous 30 %), Grand Necromancer Velkhar, et Korzul the Gravewyrm, où tombent des armes épiques.
- **The Drowned Temple** (5 joueurs) par le portail lunaire de Glimmermere : une instance pâle, d'un violet lunaire, menant à Choirmother Selthe puis à Ysolei, Avatar of the Drowned Moon, qui pulse Lunar Tide toutes les neuf secondes et invoque des Moonspawn à 60 % et 30 %.
- **The Abandoned Crypt** (solo) à Thornpeak : une plongée tranquille à base de clé de voûte et de journal, pour un seul joueur, dont la piste descelle la porte royale vers **Nythraxis, Scourge of Thornpeak**, un final de raid à dix joueurs livré autour de trois pierres-gardiennes d'âme.

Les chaînes de quêtes préparatoires sont jouables en solo, l'histoire n'est donc jamais bloquée derrière la recherche d'un groupe. Notre raid automatisé à cinq bots (Warrior, Paladin, Priest, Mage, Hunter avec focus-fire et IA de soigneur) nettoie the Hollow Crypt en environ cinq minutes (`node scripts/crypt_raid.mjs`, nécessite `ALLOW_DEV_COMMANDS=1`).

### Delves

Les delves sont un mode pour petit groupe distinct et évolutif, à un ou deux joueurs. **The Collapsed Reliquary** (niveau 7 et plus) est une crypte reconstruite à partir de salles aléatoires à chaque partie, se terminant sur Deacon Varric. Affrontez-la en solo et un compagnon IA, Tessa, combat à vos côtés. Brother Halven, à la ruine du reliquaire, tient le tableau des delves, où Normal ou Héroïque est votre choix : l'Héroïque augmente le niveau des ennemis et ajoute un affixe aléatoire pour des récompenses plus riches.

### The Ashen Coliseum (JcJ classé)

Appuyez sur `G` ou sur le bouton d'arène pour vous mettre en file. Le matchmaking téléporte les combattants dans une fosse privée éclairée aux torches, un court compte à rebours soigne et réinitialise tout le monde pour un départ équitable, et le combat se termine quand un camp abandonne à 1 pv. Personne ne meurt, et vous revenez exactement là où vous vous étiez mis en file.

- **Classements 1c1 et 2c2**, chacun avec un classement persistant de type Elo (tout le monde démarre à 1500) et un classement absolu (`GET /api/arena/leaderboard`).
- **2c2 Fiesta**, un mode de groupe plus animé : la première équipe à quinze éliminations gagne dans une limite de six minutes, les joueurs réapparaissent sur des minuteurs croissants, des ramassages d'amélioration distribuent de la puissance sur trois vagues, et un anneau qui se referme force le combat à se rassembler.

### Jouer ensemble

- **Groupes** jusqu'à 5 : clic droit sur un joueur et Inviter dans le groupe. Les membres partagent les droits de butin et le crédit de quête, se répartissent l'XP avec les vrais bonus de groupe vanilla (1.166 / 1.3 / 1.43 pour 3/4/5), et apparaissent comme des points sur la minicarte. `/p` pour le tchat de groupe, `/roll` pour départager le butin.
- **Échanges** : clic droit et Échanger. Les deux parties déposent objets et argent, les deux doivent accepter, et l'échange est atomique et validé par le serveur. Les objets de quête ne peuvent pas être échangés, et s'éloigner annule.
- **Duels** : clic droit et Défier en duel. Un compte à rebours de 3 secondes, puis combat jusqu'à ce qu'un camp tombe à 1 pv ; le vainqueur est annoncé à toute la zone et s'enfuir à 60 mètres équivaut à un forfait.
- **Droits de butin et statut absent** : le premier joueur à blesser une créature possède son butin, son XP et son crédit de quête ; `/afk` et `/dnd` vous marquent comme absent avec une réponse automatique aux chuchotements.

### Monde et systèmes

- **Manger et boire** : asseyez-vous pour récupérer sur 18 secondes, interrompu par les dégâts ou par le fait de se lever, et oui, vous pouvez manger et boire en même temps.
- **Des marchands** qui achètent nourriture et eau et vendent de l'équipement blanc honnête, avec l'argent affiché en or, argent et cuivre.
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
| `C` `P` `L` `M` `B` `G` | personnage, grimoire, journal de quêtes, carte du monde, sacs, arène |
| `V` / `R` / `Esc` | barres de nom, course automatique, fermer les fenêtres ou désélectionner la cible |

Les commandes tactiles (un stick de déplacement, le glissement de caméra et des boutons d'action à l'écran) apparaissent automatiquement sur mobile.

## Architecture (une sim, trois hôtes)

Trois idées tiennent le projet ensemble :

- **Une sim, trois hôtes.** Le même code `src/sim/` fait tourner le monde navigateur hors ligne, le serveur en ligne, et l'env RL. Le comportement doit être identique partout, et les tests existent pour le garantir.
- **`IWorld` est la seule jointure.** `src/world_api.ts` définit `IWorld`. Le `Sim` hors ligne le satisfait structurellement et le `ClientWorld` en ligne l'implémente en reflétant les snapshots du serveur. Le moteur de rendu et le HUD ne parlent qu'à `IWorld`, jamais à un monde concret, si bien qu'une nouvelle fonctionnalité étend d'abord l'interface, puis les deux mondes.
- **Le serveur est autoritaire.** Les clients envoient l'intention ; le serveur décide des résultats. Le client ne résout jamais le combat, le butin ou l'économie de lui-même.

La sim est un tick fixe à 20 Hz (`DT = 1/20`), tout l'aléatoire passe par un unique `Rng` à graine, et `src/sim/` ne porte aucun import DOM, navigateur ou Three.js. C'est ce qui permet au même code de se bundler en serveur d'env Node, en boucle de jeu autoritaire et en onglet de navigateur sans changer une ligne.

### Organisation du projet

| Chemin | De quoi il s'agit |
|---|---|
| `src/sim/` | Cœur de jeu déterministe, la source de vérité. Aucune dépendance DOM ou Three. |
| `src/sim/content/` | Les données comme du code : les neuf classes, aptitudes, zones, donjons, objets, talents. |
| `src/render/` | Moteur de rendu Three.js (géométrie procédurale, textures, VFX). Lit le monde, ne le modifie jamais. |
| `src/game/` | Saisie locale, caméra, raccourcis clavier, commandes mobiles, WebAudio procédural. |
| `src/ui/` | HUD classique (cadres, fenêtres, infobulles, carte, texte de combat flottant), icônes procédurales, i18n. |
| `src/net/` | Client en ligne : authentification REST plus un miroir de monde WebSocket (`ClientWorld`). |
| `src/admin/` | SPA du tableau de bord admin (entrée `admin.html` distincte). |
| `server/` | Serveur autoritaire : HTTP et WS, boucle de monde, Postgres, authentification, social, modération. |
| `headless/` + `python/` | Serveur d'env RL (`env_server.ts`) et bindings Python Gym. |
| `tests/` | Suite Vitest. |
| `scripts/` | Build d'assets plus scripts E2E navigateur, captures d'écran et intégration. |
| `public/` · `docs/` | Assets statiques (modèles GLB, textures, HDRIs) et documents de conception. |

La plupart des répertoires portent leur propre `CLAUDE.md` avec les conventions locales. L'ensemble complet des invariants du projet vit dans le [`CLAUDE.md`](../../CLAUDE.md) racine.

## Construit comme les classiques

Le combat, la montée en niveau et la menace tournent tous sur d'authentiques règles d'inspiration classique : rage et énergie, tables de toucher et d'esquive, atténuation par l'armure, la vraie courbe d'XP, les minuteurs de coup, et le cooldown global. Le ressenti est tel que vous vous en souvenez plutôt qu'une approximation. Les chiffres exacts vivent dans `src/sim/` si vous voulez les lire.

Et presque rien de tout cela n'est un asset livré. Le monde est dessiné à partir du code :

- Villes, créatures, terrain, eau, météo et ombres en temps réel procéduraux, sans aucun fichier de modèle 3D pour le monde.
- Douze familles de créatures riggées avec des animations complètes de marche, attaque, incantation, assise et mort.
- Icônes de sorts, d'objets et de buffs peintes sur canvas à l'exécution.
- Un HUD classique complet (cadres d'unité, barres d'action, infobulles, journal de quêtes, carte du monde, minicarte, texte de combat flottant) et du WebAudio procédural pour chaque son.

## Développement

```bash
npm test                        # vitest: formulas, combat, AI, quests, all 9 classes, parties, duels, trades, dungeons
npm run build                   # production web build
node scripts/smoke_browser.mjs  # warrior end-to-end (needs npm run dev)
node scripts/smoke_mage.mjs     # mage: casting, polymorph, conjure and drink, death and release
node scripts/visual_tour.mjs    # screenshot tour of the zone and UI into tmp/
node scripts/tour_temple.mjs    # screenshot tour of the Glimmermere and Drowned Temple into tmp/
node scripts/mp_integration.mjs # API, WS, and persistence checks (server running)
node scripts/social_e2e.mjs     # trade and duel over the wire (ALLOW_DEV_COMMANDS=1)
node scripts/arena_visual.mjs   # two clients queue and fight a ranked 1v1
node scripts/crypt_raid.mjs     # five bots clear the Hollow Crypt (ALLOW_DEV_COMMANDS=1)
```

Les tests logiques et unitaires utilisent Vitest. Pendant l'itération, lancez un seul fichier : `npx vitest run tests/sim.test.ts`. Les scripts E2E et visuels pilotent de vrais navigateurs via `puppeteer-core` et nécessitent que `npm run dev` tourne (souvent `npm run server` aussi). Les agents navigateurs peuvent piloter le déplacement via `window.__game.controller` plutôt que de simuler des touches maintenues, par exemple `controller.move({ forward: true }, facingRadians)` ou des indicateurs compacts comme `{ f: 1, sr: 1 }`.

Pour les commandes du serveur, voir [Développer en ligne](#develop-online-with-hot-reload) ci-dessus, [DEPLOY.md](../../DEPLOY.md) pour la production, et [CREDITS.md](../../CREDITS.md) pour les licences des assets.

## Localisation

Chaque chaîne visible par le joueur est résolue via `t()`, et le jeu est livré dans **21 langues** (anglais, deux espagnols, deux français, anglais Canada, italien, allemand, chinois simplifié et traditionnel, coréen, japonais, portugais du Brésil, russe, néerlandais, polonais, indonésien, turc, suédois, vietnamien et danois). La sim et le serveur restent agnostiques sur la langue : ils émettent des clés stables ou de l'anglais que le client relocalise à la frontière, ce qui préserve le déterminisme. Les contributeurs ajoutent uniquement l'anglais ; le mainteneur remplit en lot les autres langues avant chaque version. Le workflow est documenté dans `docs/i18n-scaling/translation-workflow.md`.

## Contribuer

Les contributions de toute sorte sont les bienvenues : code, traductions, rapports de bugs et documentation. Commencez par [CONTRIBUTING.md](CONTRIBUTING.fr_FR.md) pour la mise en place, lisez le [Code de conduite](../../CODE_OF_CONDUCT.md), et consultez [SECURITY.md](../../SECURITY.md) avant de signaler une vulnérabilité. Nouveau ici ? Cherchez les tickets étiquetés [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), ouvrez un [ticket](https://github.com/levy-street/world-of-claudecraft/issues/new/choose), ou venez dire bonjour sur [Discord](https://discord.gg/GjhnUsBtw).

<div align="center">

![World of Claude](../../worldofclaude.png)

![Communauté World of ClaudeCraft](../../woc_community.png)

</div>

## Licence

Le code est [sous licence MIT](../../LICENSE), alors forkez-le, remixez-le, et hébergez votre propre monde.

Les assets artistiques tiers fournis (modèles, textures, HDRIs) conservent leurs propres licences, tous CC0 du domaine public sauf les normal maps d'eau sous MIT, documentés par pack dans [CREDITS.md](../../CREDITS.md).
