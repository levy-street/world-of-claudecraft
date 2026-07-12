<div align="center">

# World of ClaudeCraft

**Faites des quêtes, formez un groupe et menez des raids dans un monde fait main, gratuit dans votre navigateur. Code ouvert, web3 et en ligne dès maintenant.**

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
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.fr_CA.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/GjhnUsBtw)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · **Français (Canada)** · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Jouer maintenant](https://worldofclaudecraft.com/) · [Héberger votre propre monde](#host-your-own-world-one-command) · [Entraîner un agent](#train-an-agent-headless-rl) · [Web3](#web3) · [Contribuer](CONTRIBUTING.fr_CA.md) · [Discord](https://discord.gg/GjhnUsBtw)

![Écran-titre de World of ClaudeCraft](../../docs/screenshots/title-screen.jpg)

</div>

## Ce que c'est

World of ClaudeCraft est un MMO complet d'époque classique auquel vous pouvez jouer dès maintenant dans votre navigateur, que vous pouvez héberger vous-même avec une seule commande et où vous pouvez même entraîner des agents d'IA à jouer. Il est gratuit, à code ouvert et en ligne sur [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Un seul monde partagé s'exécute à trois endroits, tous à partir du même noyau de jeu :

- le **monde de navigateur hors ligne**, où vous cliquez sur Play Offline et vous y êtes,
- le **serveur multijoueur faisant autorité**, où des comptes soutenus par Postgres partagent un monde en direct,
- l'**environnement RL sans interface**, où Python pilote le vrai jeu à travers une interface Gym.

Même graine, même monde, partout. Et presque rien n'est une ressource livrée : les villes, les créatures, les icônes de sorts et le son sont tous générés à l'exécution.

## Points saillants

- **Neuf classes classiques**, chacune avec une véritable panoplie de style vanilla qui gagne des rangs à mesure que vous montez en niveau, plus un **système de talents** complet (trois spécialisations par classe, 27 spécialisations en tout).
- **Trois zones de monde ouvert** du niveau 1 à 20, près de 80 quêtes et une seule trame narrative connectée autour de la conspiration des Gravecaller.
- **Cinq donjons instanciés**, dont quatre raids d'élite à cinq joueurs et une crypte en solo, avec mise à l'échelle d'élite, mécaniques de boss en zone d'effet et butin par archétype de classe.
- **Delves évolutives**, un mode pour petit groupe d'un ou deux joueurs accompagnés d'un compagnon IA, reconstruites à partir de chambres aléatoires à chaque partie selon les paliers Normal et Héroïque.
- **The Ashen Coliseum**, une arène JcJ classée avec des échelles 1c1 et 2c2 plus un mode 2c2 Fiesta (ramassages d'amélioration, un anneau qui rétrécit, premier à quinze mises à mort).
- **Vrai multijoueur** : groupes, échanges, duels, droits de première attaque, partage d'XP en groupe, chuchotements, statut d'absence et un serveur qui possède chaque jet de combat.
- **Tout est procédural** : villes à ossature de bois, familles de créatures animées, icônes de sorts peintes sur canvas, son WebAudio, météo de biome et ombres en temps réel. Aucun fichier de modèle 3D pour le monde.
- **Localisé dans 21 langues** au moyen d'un pipeline déterministe où la simulation émet des clés.
- **Environnement RL sans interface** avec liaisons Gymnasium, modelage de récompense et un mode de banc d'essai.
- **Natif web3** : liez un portefeuille Solana pour afficher votre solde de $WOC et un badge cosmétique de détenteur, entièrement optionnel et non dépositaire.

## Captures d'écran

![Un groupe se rassemble devant l'apothicaire à Eastbrook](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Crépuscule au feu de camp d'Eastbrook](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Crépuscule au feu de camp d'Eastbrook* | ![Pulls d'élite dans the Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Pulls d'élite éclairés aux torches dans the Hollow Crypt* |
| ![Les morts agités à la chapelle en ruine](../../docs/screenshots/restless-dead.jpg)<br>*Les morts agités à la chapelle en ruine* | ![Une bagarre avec les Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*En infériorité numérique au camp des bandits* |
| ![Old Greyjaw traqué sur la route du nord](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, l'apparition rare, rattrapé sur la route du nord* | ![Interface de marchand et de sacs](../../docs/screenshots/vendor-and-bags.jpg)<br>*On s'équipe chez Smith Haldren, avec infobulles, sacs et pièces* |
| ![Le portail lunaire sur la rive de Glimmermere](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Les noyés remontent au portail lunaire de Glimmermere* | ![Ysolei sur l'autel de the Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Moonfire et l'autel de the Drowned Temple* |

La météo est pilotée par le biome et purement visuelle, donc elle ne touche jamais la simulation déterministe :

| | | |
|:---:|:---:|:---:|
| ![Ciel dégagé au-dessus d'Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Dégagé sur the Vale* | ![Pluie sur Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Pluie sur Mirefen Marsh* | ![Neige sur Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Neige sur Thornpeak Heights* |

## Jouez-y

Vous avez deux façons d'entrer, et elles font tourner le même monde.

### Hors ligne, dans votre navigateur

```bash
npm install
npm run dev        # then open http://localhost:5173 and click Play Offline
```

Nommez votre personnage, choisissez l'une des neuf classes, et vous commencez dans **Eastbrook Vale** (niveaux 1-7), une ville marchande entourée de six pôles : des courses de loups au nord, des prairies de sangliers à l'est, the Webwood à l'ouest, Mirror Lake au nord-ouest, une mine de cuivre de kobolds au sud-ouest et une chapelle en ruine de morts agités au nord-est, avec le camp de bandits de Gorrak au sud-est. La route du nord grimpe par un col de montagne jusqu'à **Mirefen Marsh** (6-13, pôle Fenbridge) et continue jusqu'à **Thornpeak Heights** (13-20, pôle Highwatch). La graine du monde est fixée dans `src/main.ts`, donc c'est le même endroit à chaque visite.

### En ligne, avec d'autres joueurs

Voyez [Héberger votre propre monde](#host-your-own-world-one-command) ci-dessous pour mettre en place le vrai jeu client/serveur avec comptes et personnages persistants.

<a id="host-your-own-world-one-command"></a>

## Héberger votre propre monde (une seule commande)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres + game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

Pour un **hébergement distant**, placez la pile compose sur n'importe quel VPS, définissez un vrai `POSTGRES_PASSWORD` dans l'environnement et placez un proxy inverse TLS devant le port 8787. Caddy le fait en deux lignes (`your.domain { reverse_proxy localhost:8787 }`) ; les WebSockets sont relayés automatiquement et le client choisit tout seul `wss://` sur les pages https. Les points de terminaison d'authentification sont limités en débit par IP, les mots de passe sont hachés avec scrypt et les jetons expirent au bout de 7 jours. Ne définissez jamais `ALLOW_DEV_COMMANDS=1` en production, puisque cela active les triches de niveau et de téléportation qu'utilisent les robots de test. Voyez [DEPLOY.md](../../DEPLOY.md) pour le guide de production complet.

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

Ouvrez http://localhost:5173, choisissez **Play Online**, créez un compte, créez un personnage et faites Enter World. Ouvrez un deuxième onglet et reconnectez-vous pour vous voir mutuellement en ville. `Enter` ouvre le clavardage. Un vrai wiki joueur MediaWiki se monte aux côtés de la pile Docker Compose à http://localhost:8080/wiki/ ; ses pages initiales sont générées à partir du contenu de jeu actuel avec `npm run wiki:seed`.

Ce qui persiste et comment le serveur garde le contrôle :

- **Comptes** : mots de passe hachés avec scrypt et jetons porteurs de 7 jours (`auth_tokens`).
- **Personnages** : jusqu'à 10 par compte ; niveau, équipement, sacs, quêtes, talents, position et argent persistent en JSONB dans Postgres, sauvegardés toutes les 30 secondes, à la déconnexion et à l'arrêt du serveur. Les noms sont uniques à l'échelle mondiale, lettres seulement, style classique.
- **Le serveur fait autorité** : les clients diffusent leur intention de mouvement et leurs commandes à 20 Hz ; le serveur exécute l'unique `Sim` partagée et renvoie des instantanés limités à la zone d'intérêt (~120 yd) plus des événements par joueur. Chaque jet de combat, chute de butin, crédit de quête et transaction de marchand se résout côté serveur. Le client est un afficheur.

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

env = WoWClassicEnv(player_class="warrior")   # warrior or mage
obs, info = env.reset(seed=42)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
env.close()
```

- **Les espaces d'observation et d'action sont dérivés du contenu.** Interrogez-les depuis la réponse `info` de l'environnement au démarrage plutôt que de les coder en dur ; ils grandissent avec le jeu. Aujourd'hui l'espace d'action est `Discrete(44)` (déplacement, ciblage, attaque, la panoplie de capacités complète, interaction, manger/boire) et l'observation est un `Box` de 276 flottants (soi, capacités, cible, mobs à proximité, interactif le plus proche, progression des quêtes).
- **La récompense** est une somme pondérée de deltas de compteurs par tick (XP, dégâts infligés et subis, mises à mort, morts, progression des quêtes, montées de niveau), réglable à chaque reset. Chaque `step` applique une action et avance de cinq ticks de simulation par défaut, soit environ quatre décisions par seconde simulée.
- **Déterministe par construction.** Pas d'horloge murale, pas de `Math.random`. Donnez une graine au reset et l'épisode se rejoue à l'identique.

Le protocole et les liaisons sont documentés dans `headless/CLAUDE.md` et `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft est natif web3 autour de **$WOC**, notre jeton communautaire sur Solana. Connectez un portefeuille Solana, liez-le à votre compte avec une seule signature (non dépositaire, aucune transaction à approuver), et votre solde de $WOC en lecture seule apparaît dans l'ATH à côté d'un badge cosmétique de palier de détenteur.

C'est purement cosmétique et non requis pour jouer. Rien n'est dépensé ni gagné en jeu, il n'y a pas de pay-to-win, et tout le jeu se joue très bien sans jamais connecter de portefeuille.

**Adresse du contrat $WOC (Solana) :**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Plus de détails sur le jeton à [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Une visite du monde

### Les neuf classes

Chaque classe utilise de vraies mécaniques de style vanilla et apprend des sorts à rangs au fil des niveaux 1-20 (Lightning Bolt R2 au 8, R3 au 14, R4 au 20, avec des capacités de haut palier comme Execute, Kidney Shot, Flash Heal, Stormstrike et Starfire qui arrivent à leur niveau classique).

- **Warrior** : rage, Heroic Strike (au prochain coup, hors GCD), Battle Shout, Charge, Rend, Thunder Clap, Hamstring, Bloodrage, Overpower (proc d'esquive).
- **Paladin** : Seal of Righteousness libéré par Judgement, Holy Light, Devotion Aura, Blessing of Might, Divine Protection (absorption), Hammer of Justice (étourdissement), Lay on Hands.
- **Hunter** : Auto Shot à distance (8-35 yd avec la zone morte classique), Raptor Strike, Aspect of the Hawk, Serpent Sting, Arcane Shot, Concussive Shot, Mongoose Bite, Wing Clip, et un familier apprivoisable dès le niveau 10.
- **Rogue** : énergie et points de combo, Sinister Strike, Eviscerate, Backstab (de dos, dague), Gouge, Evasion, Slice and Dice, Sprint.
- **Priest** : Smite, Lesser Heal, Power Word: Fortitude, Shadow Word: Pain, Power Word: Shield (absorption), Renew (HoT), Mind Blast.
- **Shaman** : Lightning Bolt, Rockbiter Weapon (enchantement d'arme), Healing Wave, Earth Shock, Lightning Shield (épines), Flame Shock.
- **Mage** : Fireball, Frost Armor, Arcane Intellect, Frostbolt, Conjure Water, Fire Blast, Arcane Missiles (canalisé), Polymorph, Frost Nova.
- **Warlock** : Shadow Bolt, Demon Skin, Immolate, Corruption, Life Tap, Curse of Agony, Drain Life, et sept démons invocables de l'Imp au Doomguard.
- **Druid** : Wrath, Healing Touch, Mark of the Wild, Moonfire, Rejuvenation, Thorns, Entangling Roots, Bear Form au 10.

Les soins et les améliorations s'appliquent aux membres du groupe, les soins peuvent faire des coups critiques, et les boucliers d'absorption encaissent les dégâts avant la vie. Dépensez des points dans **trois spécialisations de talents par classe** (Arms/Fury/Protection, Balance/Feral/Restoration, et ainsi de suite) ; l'allocation est validée par le serveur et exportable sous forme de chaîne de build.

### Donjons

La trame des Gravecaller traverse quatre instances d'élite à cinq joueurs, et une crypte en solo se trouve à l'écart pour les explorateurs.

- **The Hollow Crypt** (5 joueurs) sous the Fallen Chapel : groupes d'élites appariés, le miniboss Sexton Marrow et Morthen the Gravecaller, qui lâche un Shadow Pulse en zone d'effet toutes les dix secondes. La porte de la crypte téléporte votre groupe dans une copie d'instance privée qui se réinitialise après cinq minutes à vide.
- **The Sunken Bastion** (5 joueurs, autour du niveau 13, sud-est de Mirefen) : Vael the Mistcaller invoque des vagues de Drowned Thralls à 60 % et 30 % de vie.
- **Gravewyrm Sanctum** (5 joueurs, niveau 20, sous Thornpeak) : trois chambres de gardes d'os d'élite et de drakonides, Korgath the Bound (s'enrage sous 30 %), Grand Necromancer Velkhar et Korzul the Gravewyrm, où des armes épiques tombent.
- **The Drowned Temple** (5 joueurs) par le portail lunaire de Glimmermere : une instance pâle, violet-lune, menant à Choirmother Selthe puis à Ysolei, Avatar of the Drowned Moon, qui pulse Lunar Tide toutes les neuf secondes et invoque des Moonspawn à 60 % et 30 %.
- **The Abandoned Crypt** (solo) à Thornpeak : une plongée tranquille de clé de voûte et de journal intime pour une personne, dont la piste descelle la porte royale vers **Nythraxis, Scourge of Thornpeak**, un final de raid à dix joueurs livré à travers trois pierres-gardes d'âme.

Les chaînes de quêtes préparatoires sont jouables en solo, donc l'histoire n'est jamais bloquée derrière la recherche d'un groupe. Notre raid automatisé à cinq robots (warrior, paladin, priest, mage, hunter avec IA de tir concentré et de soin) nettoie the Hollow Crypt en environ cinq minutes (`node scripts/crypt_raid.mjs`, nécessite `ALLOW_DEV_COMMANDS=1`).

### Delves

Les delves sont un mode séparé et évolutif pour petit groupe d'un ou deux joueurs. **The Collapsed Reliquary** (niveau 7 et plus) est une crypte reconstruite à partir de chambres aléatoires à chaque partie, se terminant chez Deacon Varric. Faites-la en solo et une compagne IA, Tessa, combat à vos côtés. Brother Halven, à la ruine du reliquaire, tient le tableau des delves, où Normal ou Héroïque est votre choix : Héroïque relève les niveaux des ennemis et ajoute un affixe aléatoire pour de plus riches récompenses.

### The Ashen Coliseum (JcJ classé)

Appuyez sur `G` ou sur le bouton d'arène pour entrer en file. L'appariement téléporte les combattants dans une fosse privée éclairée aux torches, un court compte à rebours soigne et réinitialise tout le monde pour un départ équitable, et le combat se termine quand un camp abandonne à 1 pv. Personne ne meurt, et vous revenez exactement là où vous avez fait la file.

- **Échelles classées 1c1 et 2c2**, chacune avec un classement persistant de style Elo (tout le monde commence à 1500) et un palmarès de tous les temps (`GET /api/arena/leaderboard`).
- **2c2 Fiesta**, un mode de fête plus animé : la première équipe à quinze mises à mort gagne dans une limite de six minutes, les joueurs réapparaissent sur des minuteries croissantes, les ramassages d'amélioration distribuent de la puissance sur trois vagues, et un anneau qui se referme force le combat à se rejoindre.

### Jouer ensemble

- **Groupes** jusqu'à 5 : clic droit sur un joueur et Inviter dans le groupe. Les membres partagent les droits de première attaque et le crédit de quête, partagent l'XP avec les vrais bonus de groupe vanilla (1.166 / 1.3 / 1.43 pour 3/4/5), et apparaissent comme points sur la minicarte. `/p` pour le clavardage de groupe, `/roll` pour régler le butin.
- **Échanges** : clic droit et Échanger. Les deux camps préparent objets et argent, les deux doivent accepter, et l'échange est atomique et validé par le serveur. Les objets de quête ne peuvent pas être échangés, et s'éloigner annule.
- **Duels** : clic droit et Défier en duel. Un compte à rebours de 3 secondes, puis on se bat jusqu'à ce qu'un camp atteigne 1 pv ; le vainqueur est annoncé à l'échelle de la zone et courir à 60 verges abandonne.
- **Droits de première attaque et statut d'absence** : le premier joueur à blesser un mob possède son butin, son XP et son crédit de quête ; `/afk` et `/dnd` vous marquent absent avec une réponse automatique aux chuchotements.

### Monde et systèmes

- **Manger et boire** : asseyez-vous pour récupérer sur 18 secondes, interrompu par des dégâts ou en vous levant, et oui, vous pouvez manger et boire en même temps.
- **Marchands** qui achètent nourriture et eau et vendent de l'équipement blanc honnête, avec les pièces affichées en or, argent et cuivre.
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
| `C` `P` `L` `M` `B` `G` | personnage, grimoire, journal de quêtes, carte du monde, sacs, arène |
| `V` / `R` / `Esc` | plaques de nom, course auto, fermer les fenêtres ou effacer la cible |

Les contrôles tactiles (un manche de déplacement, le glissement de caméra et des boutons d'action à l'écran) apparaissent automatiquement sur mobile.

## Architecture (une simulation, trois hôtes)

Trois idées tiennent le projet ensemble :

- **Une simulation, trois hôtes.** Le même code `src/sim/` fait tourner le monde de navigateur hors ligne, le serveur en ligne et l'environnement RL. Le comportement doit être identique partout, et les tests existent pour le maintenir ainsi.
- **`IWorld` est la seule jointure.** `src/world_api.ts` définit `IWorld`. La `Sim` hors ligne le satisfait structurellement et la `ClientWorld` en ligne l'implémente en réfléchissant les instantanés du serveur. L'afficheur et l'ATH ne parlent qu'à `IWorld`, jamais à un monde concret, donc une nouvelle fonctionnalité étend d'abord l'interface puis les deux mondes.
- **Le serveur fait autorité.** Les clients envoient l'intention ; le serveur décide des résultats. Le client ne résout jamais le combat, le butin ou l'économie de lui-même.

La simulation est un tick fixe à 20 Hz (`DT = 1/20`), tout le hasard passe par un seul `Rng` à graine, et `src/sim/` ne porte aucun import DOM, navigateur ou Three.js. C'est ce qui permet au même code de se grouper en un serveur d'environnement Node, une boucle de jeu faisant autorité et un onglet de navigateur sans changer une seule ligne.

### Disposition du projet

| Chemin | Ce que c'est |
|---|---|
| `src/sim/` | Noyau de jeu déterministe, la source de vérité. Aucune dépendance DOM ou Three. |
| `src/sim/content/` | Données comme code : les neuf classes, capacités, zones, donjons, objets, talents. |
| `src/render/` | Afficheur Three.js (géométrie, textures, VFX procédurales). Lit le monde, ne le mute jamais. |
| `src/game/` | Entrée locale, caméra, raccourcis, contrôles mobiles, WebAudio procédural. |
| `src/ui/` | ATH classique (cadres, fenêtres, infobulles, carte, texte de combat flottant), icônes procédurales, i18n. |
| `src/net/` | Client en ligne : authentification REST plus un miroir de monde WebSocket (`ClientWorld`). |
| `src/admin/` | SPA du tableau de bord d'administration (entrée `admin.html` distincte). |
| `server/` | Serveur faisant autorité : HTTP et WS, boucle de monde, Postgres, authentification, social, modération. |
| `headless/` + `python/` | Serveur d'environnement RL (`env_server.ts`) et liaisons Python Gym. |
| `tests/` | Suite Vitest. |
| `scripts/` | Construction des ressources plus scripts de navigateur E2E, capture d'écran et intégration. |
| `public/` · `docs/` | Ressources statiques (modèles GLB, textures, HDRIs) et documents de conception. |

La plupart des répertoires portent leur propre `CLAUDE.md` avec leurs conventions locales. L'ensemble complet des invariants du projet vit dans le [`CLAUDE.md`](../../CLAUDE.md) racine.

## Construit comme les classiques

Le combat, la montée de niveau et la menace tournent tous sur d'authentiques règles d'époque classique : rage et énergie, tables de toucher et d'esquive, mitigation d'armure, la vraie courbe d'XP, minuteries de coup et le temps de recharge global. Ça a la sensation dont vous vous souvenez plutôt que de l'approximer. Les chiffres exacts vivent dans `src/sim/` si vous voulez les lire.

Et presque rien de tout cela n'est une ressource livrée. Le monde est dessiné à partir du code :

- Villes, créatures, terrain, eau, météo et ombres en temps réel procéduraux, sans aucun fichier de modèle 3D pour le monde.
- Douze familles de créatures animées avec animations complètes de marche, attaque, incantation, assise et mort.
- Icônes de sorts, d'objets et d'améliorations peintes sur canvas à l'exécution.
- Un ATH classique complet (cadres d'unité, barres d'action, infobulles, journal de quêtes, carte du monde, minicarte, texte de combat flottant) et du WebAudio procédural pour chaque son.

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

Les tests de logique et unitaires utilisent Vitest. Pendant que vous itérez, exécutez un seul fichier : `npx vitest run tests/sim.test.ts`. Les scripts E2E et visuels pilotent de vrais navigateurs via `puppeteer-core` et nécessitent `npm run dev` en marche (souvent `npm run server` aussi). Les agents de navigateur peuvent piloter le déplacement par `window.__game.controller` plutôt que de simuler des touches maintenues, par exemple `controller.move({ forward: true }, facingRadians)` ou des indicateurs compacts comme `{ f: 1, sr: 1 }`.

Pour les commandes de serveur, voyez [Développer en ligne](#develop-online-with-hot-reload) ci-dessus, [DEPLOY.md](../../DEPLOY.md) pour la production, et [CREDITS.md](../../CREDITS.md) pour les licences des ressources.

## Localisation

Chaque chaîne visible par le joueur se résout via `t()`, et le jeu est livré en **21 langues** (anglais, deux espagnols, deux français, anglais Canada, italien, allemand, chinois simplifié et traditionnel, coréen, japonais, portugais brésilien, russe, néerlandais, polonais, indonésien, turc, suédois, vietnamien et danois). La simulation et le serveur restent agnostiques de la langue : ils émettent des clés stables ou de l'anglais que le client relocalise à la frontière, ce qui préserve le déterminisme. Les contributeurs ajoutent l'anglais seulement ; le mainteneur remplit par lots les autres langues avant chaque version. Le flux de travail est documenté dans `docs/i18n-scaling/translation-workflow.md`.

## Contribuer

Les contributions de toutes sortes sont les bienvenues : code, traductions, rapports de bogues et documentation. Commencez par [CONTRIBUTING.md](CONTRIBUTING.fr_CA.md) pour la configuration, lisez le [Code de conduite](../../CODE_OF_CONDUCT.md), et consultez [SECURITY.md](../../SECURITY.md) avant de signaler une vulnérabilité. Nouveau ici ? Cherchez les enjeux étiquetés [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), ouvrez un [enjeu](https://github.com/levy-street/world-of-claudecraft/issues/new/choose), ou dites bonjour sur [Discord](https://discord.gg/GjhnUsBtw).

<div align="center">

![World of Claude](../../worldofclaude.png)

![Communauté de World of ClaudeCraft](../../woc_community.png)

</div>

## Licence

Le code est [sous licence MIT](../../LICENSE), alors forkez-le, remixez-le et hébergez votre propre monde.

Les ressources artistiques tierces incluses (modèles, textures, HDRIs) gardent leurs propres licences, toutes CC0 du domaine public sauf les cartes de normales d'eau sous MIT, documentées par pack dans [CREDITS.md](../../CREDITS.md).
