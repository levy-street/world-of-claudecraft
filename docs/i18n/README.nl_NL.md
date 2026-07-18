<div align="center">

# World of ClaudeCraft

**Volbreng quests, vorm een groep en raid een handgemaakte wereld, gratis in je browser. Open source, web3 en nu meteen online.**

**Officiële website: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r185-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.27.0-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.nl_NL.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · **Nederlands** · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Speel nu](https://worldofclaudecraft.com/) · [Host je eigen wereld](#host-your-own-world-one-command) · [Train een agent](#train-an-agent-headless-rl) · [Web3](#web3) · [Bijdragen](CONTRIBUTING.nl_NL.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![World of ClaudeCraft titelscherm](../../docs/screenshots/title-screen.jpg)

</div>

## Wat dit is

World of ClaudeCraft is een complete MMO uit het klassieke tijdperk die je nu meteen in je browser kunt spelen, zelf met één commando kunt hosten en zelfs door AI-agents kunt laten spelen. Het is gratis, open source en live op [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Eén gedeelde wereld draait op drie plekken, allemaal vanuit dezelfde game-core:

- de **offline browserwereld**, waar je op Play Offline klikt en je er meteen in zit,
- de **autoritatieve multiplayerserver**, waar accounts op basis van Postgres een live wereld delen,
- de **headless RL-omgeving**, waar Python de echte game aanstuurt via een Gym-interface.

Dezelfde seed, dezelfde wereld, overal. En vrijwel niets is een meegeleverde asset: de steden, wezens, spreukpictogrammen en geluiden worden allemaal tijdens runtime gegenereerd.

## Hoogtepunten

- **Negen klassieke classes**, elk met een echte vanilla-stijl uitrusting die ranks krijgt naarmate je levelt, plus een volledig **talent-systeem** (drie specs per class, in totaal 27 specs).
- **Drie open-wereldzones** van level 1 tot 20, bijna 80 quests en één samenhangende verhaallijn over de Gravecaller-samenzwering.
- **Vijf instanced dungeons**, waarvan vier elite-raids voor vijf spelers en één solo-crypte, met elite-schaling, AoE-bossmechanieken en class-archetype-loot.
- **Schaalbare delves**, een modus voor kleine groepen van één of twee spelers plus een AI-metgezel, elke run opnieuw opgebouwd uit gerandomiseerde kamers over de tiers Normal en Heroic.
- **The Ashen Coliseum**, een ranked PvP-arena met 1v1- en 2v2-ladders plus een 2v2 Fiesta-modus (augment-pickups, een krimpende ring, eerste tot vijftien takedowns).
- **Echte multiplayer**: parties, handelen, duels, tap rights, party-split XP, whispers, away-status en een server die elke combat roll bezit.
- **Procedureel alles**: vakwerksteden, gerigde wezenfamilies, geschilderde spreukpictogrammen op canvas, WebAudio-geluid, biome-weer en realtime schaduwen. Geen 3D-modelbestanden voor de wereld.
- **Gelokaliseerd in 21 locales** via een deterministische pijplijn waarin de sim sleutels uitzendt.
- **Headless RL-omgeving** met Gymnasium-bindings, reward shaping en een benchmark-modus.
- **Web3-native**: koppel een Solana-wallet om je $WOC-saldo en een cosmetische holder-badge te tonen, volledig optioneel en non-custodial.

## Schermafbeeldingen

![Een party verzamelt zich buiten de apotheek in Eastbrook](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Schemering bij het kampvuur van Eastbrook](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Schemering bij het kampvuur van Eastbrook* | ![Elite pulls in the Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Toortsverlichte elite pulls in the Hollow Crypt* |
| ![De rusteloze doden bij de verwoeste kapel](../../docs/screenshots/restless-dead.jpg)<br>*De rusteloze doden bij de verwoeste kapel* | ![Een gevecht met Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*In de minderheid bij het bandietenkamp* |
| ![Old Greyjaw opgejaagd op de noordweg](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, de rare spawn, neergehaald op de noordweg* | ![Vendor- en bags-UI](../../docs/screenshots/vendor-and-bags.jpg)<br>*Je uitrusten bij Smith Haldren, met tooltips, bags en munten* |
| ![De moongate aan de oever van Glimmermere](../../docs/screenshots/glimmermere-moongate.jpg)<br>*De verdronkenen klimmen omhoog bij de moongate van Glimmermere* | ![Ysolei op het altaar van the Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Moonfire en het altaar van the Drowned Temple* |

Weer wordt aangedreven door biomes en is render-only, dus het raakt nooit de deterministische sim:

| | | |
|:---:|:---:|:---:|
| ![Heldere lucht boven Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Helder boven the Vale* | ![Regen boven Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Regen boven Mirefen Marsh* | ![Sneeuw op Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Sneeuw op Thornpeak Heights* |

## Speel het

Je hebt twee manieren om binnen te komen, en ze draaien dezelfde wereld.

### Offline, in je browser

```bash
npm install
npm run dev        # then open http://localhost:5173 and click Play Offline
```

Geef je personage een naam, kies een van de negen classes, en je begint in **Eastbrook Vale** (levels 1-7), een marktstad omringd door zes hubs: wolvenpaden in het noorden, everzwijnweiden in het oosten, the Webwood in het westen, Mirror Lake in het noordwesten, een kobold-kopergroeve in het zuidwesten en een verwoeste kapel met rusteloze doden in het noordoosten, met Gorrak's bandietenkamp in het zuidoosten. De noordweg klimt via een bergpas omhoog naar **Mirefen Marsh** (6-13, hub Fenbridge) en verder omhoog naar **Thornpeak Heights** (13-20, hub Highwatch). De wereld-seed staat vast in `src/main.ts`, dus het is bij elk bezoek dezelfde plek.

### Online, met andere spelers

Zie [Host je eigen wereld](#host-your-own-world-one-command) hieronder om de echte client/server-game met accounts en persistente personages op te zetten.

<a id="host-your-own-world-one-command"></a>

## Host je eigen wereld (één commando)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres + game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

Voor **remote hosting** zet je de compose-stack op een willekeurige VPS, stel je een echt `POSTGRES_PASSWORD` in de omgeving in en plaats je een TLS reverse proxy voor poort 8787. Met Caddy zijn dat twee regels (`your.domain { reverse_proxy localhost:8787 }`); WebSockets worden automatisch geproxyd en de client kiest op https-pagina's automatisch `wss://`. Auth-endpoints zijn per IP rate-limited, wachtwoorden zijn scrypt-gehasht en tokens verlopen na 7 dagen. Stel in productie nooit `ALLOW_DEV_COMMANDS=1` in, want dat schakelt de level- en teleport-cheats in die de testbots gebruiken. Zie [DEPLOY.md](../../DEPLOY.md) voor de volledige productiegids.

<a id="develop-online-with-hot-reload"></a>

### Online ontwikkelen met hot reload

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api and /ws)
```

Open http://localhost:5173, kies **Play Online**, maak een account aan, maak een personage aan en klik op Enter World. Open een tweede tabblad en log opnieuw in om elkaar in de stad te zien. `Enter` opent de chat. Naast de Docker Compose-stack komt een echte MediaWiki-spelerwiki online op http://localhost:8080/wiki/; de basispagina's worden gegenereerd uit de huidige game-content met `npm run wiki:seed`.

Wat blijft bewaard en hoe de server de leiding houdt:

- **Accounts**: scrypt-gehashte wachtwoorden en bearer-tokens van 7 dagen (`auth_tokens`).
- **Personages**: maximaal 10 per account; level, gear, bags, quests, talents, positie en geld blijven als JSONB in Postgres bewaard, elke 30 seconden opgeslagen, bij uitloggen en bij het afsluiten van de server. Namen zijn wereldwijd uniek, alleen letters, klassieke stijl.
- **De server is autoritatief**: clients streamen bewegingsintentie en commando's met 20 Hz; de server draait de ene gedeelde `Sim` en stuurt interest-scoped snapshots (~120 yd) plus per-player events terug. Elke combat roll, loot drop, quest credit en vendor-transactie wordt aan de serverkant afgehandeld. De client is een renderer.

<a id="train-an-agent-headless-rl"></a>

## Train een agent (headless RL)

Dezelfde deterministische core draait als [Gymnasium](https://gymnasium.farama.org/)-omgeving, zodat een agent traint tegen de echte game, niet tegen een herimplementatie ervan. De env-server (`headless/env_server.ts`) verpakt één `Sim` en spreekt newline-gescheiden JSON over stdio; de Python-bindings in `python/` starten hem als subprocess en bieden de gebruikelijke `reset` / `step` / `close`-lus.

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

- **Observation- en action-spaces zijn afgeleid van content.** Vraag ze bij het opstarten op uit het `info`-antwoord van de env in plaats van ze hard te coderen; ze groeien mee met de game. Vandaag is de action-space `Discrete(44)` (beweging, target, attack, de volledige ability-kit, interact, eten/drinken) en de observation is een `Box` van 276 floats (zelf, abilities, target, mobs in de buurt, dichtstbijzijnde interactable, questvoortgang).
- **Reward** is een gewogen som van per-tick counter-delta's (XP, aangerichte en geïncasseerde schade, kills, deaths, questvoortgang, level-ups), instelbaar per reset. Elke `step` past één actie toe en zet standaard vijf sim-ticks vooruit, dus ongeveer vier beslissingen per gesimuleerde seconde.
- **Deterministisch van opzet.** Geen wandklok, geen `Math.random`. Seed de reset en de episode speelt zich exact opnieuw af.

Het protocol en de bindings staan beschreven in `headless/CLAUDE.md` en `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft is web3-native rond **$WOC**, onze community-token op Solana. Verbind een Solana-wallet, koppel hem met één handtekening aan je account (non-custodial, geen transactie om goed te keuren), en je alleen-lezen $WOC-saldo verschijnt in de HUD naast een cosmetische holder-tier-badge.

Het is puur cosmetisch en niet nodig om te spelen. Er wordt niets uitgegeven of verdiend in de game, er is geen pay-to-win, en de hele game speelt prima zonder ooit een wallet te verbinden.

**$WOC contract-adres (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Meer over de token op [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Een rondleiding door de wereld

### De negen classes

Elke class gebruikt echte vanilla-stijl mechanieken en leert ranked spreuken over de levels 1-20 (Lightning Bolt R2 op 8, R3 op 14, R4 op 20, met high-band abilities zoals Execute, Kidney Shot, Flash Heal, Stormstrike en Starfire die op hun klassieke level binnenkomen).

- **Warrior**: rage, Heroic Strike (on-next-swing, off-GCD), Battle Shout, Charge, Rend, Thunder Clap, Hamstring, Bloodrage, Overpower (dodge proc).
- **Paladin**: Seal of Righteousness ontketend door Judgement, Holy Light, Devotion Aura, Blessing of Might, Divine Protection (absorb), Hammer of Justice (stun), Lay on Hands.
- **Hunter**: ranged Auto Shot (8-35 yd met de klassieke dead zone), Raptor Strike, Aspect of the Hawk, Serpent Sting, Arcane Shot, Concussive Shot, Mongoose Bite, Wing Clip, en een tembare pet vanaf level 10.
- **Rogue**: energy en combo points, Sinister Strike, Eviscerate, Backstab (van achteren, dagger), Gouge, Evasion, Slice and Dice, Sprint.
- **Priest**: Smite, Lesser Heal, Power Word: Fortitude, Shadow Word: Pain, Power Word: Shield (absorb), Renew (HoT), Mind Blast.
- **Shaman**: Lightning Bolt, Rockbiter Weapon (imbue), Healing Wave, Earth Shock, Lightning Shield (thorns), Flame Shock.
- **Mage**: Fireball, Frost Armor, Arcane Intellect, Frostbolt, Conjure Water, Fire Blast, Arcane Missiles (channeled), Polymorph, Frost Nova.
- **Warlock**: Shadow Bolt, Demon Skin, Immolate, Corruption, Life Tap, Curse of Agony, Drain Life, en zeven oproepbare demonen van Imp tot Doomguard.
- **Druid**: Wrath, Healing Touch, Mark of the Wild, Moonfire, Rejuvenation, Thorns, Entangling Roots, Bear Form op 10.

Heals en buffs landen op party-leden, healing kan critten, en absorb-shields vangen schade op vóór de health. Besteed punten over **drie talent-specs per class** (Arms/Fury/Protection, Balance/Feral/Restoration, enzovoort); de toewijzing wordt door de server gevalideerd en is exporteerbaar als een build-string.

### Dungeons

De Gravecaller-verhaallijn loopt door vier elite-instances voor vijf spelers, en een solo-crypte ligt er voor verkenners terzijde.

- **The Hollow Crypt** (5 spelers) onder the Fallen Chapel: gepaarde elite-trash, de Sexton Marrow miniboss, en Morthen the Gravecaller, die elke tien seconden een Shadow Pulse AoE laat vallen. De cryptedeur teleporteert je party naar een privé-instancekopie die na vijf minuten leegstand reset.
- **The Sunken Bastion** (5 spelers, rond level 13, zuidoostelijk Mirefen): Vael the Mistcaller roept golven Drowned Thralls op bij 60% en 30% health.
- **Gravewyrm Sanctum** (5 spelers, level 20, onder Thornpeak): drie kamers met elite-boneguard en drakonid, Korgath the Bound (enraget onder 30%), Grand Necromancer Velkhar, en Korzul the Gravewyrm, waar epic weapons vallen.
- **The Drowned Temple** (5 spelers) via de moongate van Glimmermere: een bleke, maanviolette instance die leidt naar Choirmother Selthe en daarna Ysolei, Avatar of the Drowned Moon, die elke negen seconden Lunar Tide pulst en bij 60% en 30% Moonspawn oproept.
- **The Abandoned Crypt** (solo) in Thornpeak: een stille keystone-en-dagboek-duik voor één persoon, waarvan het spoor de koninklijke deur naar **Nythraxis, Scourge of Thornpeak** ontzegelt, een tien-spelers raid-finale uitgevochten over drie soul wardstones.

De aanloop-questketens zijn solo te doen, dus het verhaal zit nooit achter het vinden van een groep weggesloten. Onze geautomatiseerde vijf-bot raid (warrior, paladin, priest, mage, hunter met focus-fire en healer-AI) klaart the Hollow Crypt in ongeveer vijf minuten (`node scripts/crypt_raid.mjs`, vereist `ALLOW_DEV_COMMANDS=1`).

### Delves

Delves zijn een aparte, schaalbare modus voor kleine groepen van één of twee spelers. **The Collapsed Reliquary** (level 7 en hoger) is een crypte die elke run opnieuw wordt opgebouwd uit gerandomiseerde kamers, eindigend bij Deacon Varric. Speel hem solo en een AI-metgezel, Tessa, vecht aan je zij. Brother Halven bij de reliekruïne beheert het delve-bord, waar Normal of Heroic jouw keuze is: Heroic verhoogt de vijandlevels en voegt een willekeurige affix toe voor rijkere beloningen.

### The Ashen Coliseum (ranked PvP)

Druk op `G` of de arena-knop om in de wachtrij te gaan. Matchmaking teleporteert vechters naar een privé, toortsverlichte pit, een korte aftelling heelt en reset iedereen voor een eerlijke start, en het gevecht eindigt wanneer een kant zich overgeeft bij 1 hp. Niemand sterft, en je keert precies terug naar waar je in de wachtrij ging.

- **1v1- en 2v2-ranked ladders**, elk met een persistente Elo-achtige rating (iedereen begint op 1500) en een aller-tijden leaderboard (`GET /api/arena/leaderboard`).
- **2v2 Fiesta**, een levendigere party-modus: het eerste team tot vijftien takedowns wint binnen een limiet van zes minuten, spelers respawnen op oplopende timers, augment-pickups laten power vallen over drie golven, en een sluitende ring dwingt het gevecht bij elkaar.

### Samen spelen

- **Parties** tot 5: rechtsklik op een speler en kies Invite to Party. Leden delen tap rights en quest credit, splitsen XP met de echte vanilla group-bonussen (1.166 / 1.3 / 1.43 voor 3/4/5), en verschijnen als blips op de minimap. `/p` voor party-chat, `/roll` om loot te beslechten.
- **Handelen**: rechtsklik en kies Trade. Beide kanten plaatsen items en geld klaar, beide moeten accepteren, en de ruil is atomisch en door de server gevalideerd. Questitems kunnen niet worden verhandeld, en uit elkaar lopen annuleert.
- **Duels**: rechtsklik en kies Challenge to a Duel. Een aftelling van 3 seconden, dan vechten tot een kant 1 hp raakt; de winnaar wordt zone-breed aangekondigd en 60 yards weglopen betekent verlies.
- **Tap rights en away-status**: de eerste speler die een mob schade doet, bezit de loot, XP en quest credit ervan; `/afk` en `/dnd` markeren je als afwezig met een automatisch antwoord op whispers.

### Wereld en systemen

- **Eten en drinken**: ga zitten om over 18 seconden te herstellen, onderbroken door schade of opstaan, en ja, je kunt tegelijk eten en drinken.
- **Vendors** die food en water kopen en eerlijke witte gear verkopen, met munten getoond in gold, silver en copper.
- **Mob-AI**: ronddwalen, proximity aggro op basis van levelverschil, social pulls, achtervolgen, leashen en resetten, corpse loot, en respawns, met een rare spawn (Old Greyjaw) op een lange timer.
- **Visplekken** met hun eigen loot tables en zeldzame vangsten.
- **Cosmetische skins** uitgerold op uncommon, rare en epic rarity, puur voor het uiterlijk.
- **Dood en herstel**: laat je geest los naar het kerkhof, krijg valschade, en vertraag tijdens het zwemmen.
- **Biome-weer**: helder in the Vale, regen in the Marsh, sneeuw op the Peaks, overvloeiend terwijl je tussen zones beweegt.

### Besturing (klassieke indeling)

| Invoer | Actie |
|---|---|
| `W` / `S` | rennen / achteruit. `A`/`D` draaien (strafe met rechtermuis ingedrukt), `Q`/`E` strafe |
| rechts slepen / links slepen | mouselook / orbit-camera. Wiel zoomt, `Space` springt |
| `Tab` | wissel tussen dichtstbijzijnde vijanden. linksklik om te targeten, rechtsklik om aan te vallen, te looten of te praten |
| `1`-`9`, `0`, `-`, `=` | action bar |
| `F` | interact (een corpse looten, een object oppakken, praten) |
| `C` `P` `L` `M` `B` `G` | character, spellbook, quest log, world map, bags, arena |
| `V` / `R` / `Esc` | nameplates, autorun, vensters sluiten of target wissen |

Touch-besturing (een bewegingsstick, camera slepen en action-knoppen op het scherm) verschijnt automatisch op mobiel.

## Architectuur (één sim, drie hosts)

Drie ideeën houden het project bij elkaar:

- **Één sim, drie hosts.** Dezelfde `src/sim/`-code draait de offline browserwereld, de online server en de RL-omgeving. Het gedrag moet overal identiek zijn, en de tests bestaan om dat zo te houden.
- **`IWorld` is de enige naad.** `src/world_api.ts` definieert `IWorld`. De offline `Sim` voldoet er structureel aan en de online `ClientWorld` implementeert het door server-snapshots te spiegelen. De renderer en HUD praten alleen met `IWorld`, nooit met een concrete wereld, dus een nieuwe feature breidt eerst de interface uit en daarna beide werelden.
- **De server is autoritatief.** Clients sturen intentie; de server beslist over uitkomsten. De client lost combat, loot of economie nooit zelf op.

De sim is een vaste tick van 20 Hz (`DT = 1/20`), alle randomness stroomt door één geseede `Rng`, en `src/sim/` bevat nul DOM-, browser- of Three.js-imports. Dat is wat dezelfde code in staat stelt om te bundelen in een Node env-server, een autoritatieve game-loop en een browsertabblad zonder ook maar één regel te wijzigen.

### Projectindeling

| Pad | Wat het is |
|---|---|
| `src/sim/` | Deterministische game-core, de source of truth. Geen DOM- of Three-dependencies. |
| `src/sim/content/` | Data als code: de negen classes, abilities, zones, dungeons, items, talents. |
| `src/render/` | Three.js-renderer (procedurele geometrie, textures, VFX). Leest de wereld, muteert hem nooit. |
| `src/game/` | Lokale invoer, camera, keybinds, mobiele besturing, procedurele WebAudio. |
| `src/ui/` | Klassieke HUD (frames, vensters, tooltips, map, floating combat text), procedurele pictogrammen, i18n. |
| `src/net/` | Online client: REST-auth plus een WebSocket-wereldspiegel (`ClientWorld`). |
| `src/admin/` | Admin-dashboard SPA (aparte `admin.html`-entry). |
| `server/` | Autoritatieve server: HTTP en WS, world loop, Postgres, auth, social, moderatie. |
| `headless/` + `python/` | RL env-server (`env_server.ts`) en Python Gym-bindings. |
| `tests/` | Vitest-suite. |
| `scripts/` | Asset-build plus browser-E2E-, screenshot- en integratiescripts. |
| `public/` · `docs/` | Statische assets (GLB-modellen, textures, HDRIs) en designdocs. |

De meeste directories dragen hun eigen `CLAUDE.md` met lokale conventies. De volledige set project-invarianten staat in de root-[`CLAUDE.md`](../../CLAUDE.md).

## Gebouwd als de klassiekers

Combat, leveling en threat draaien allemaal op authentieke regels uit het klassieke tijdperk: rage en energy, hit- en dodge-tables, armor mitigation, de echte XP-curve, swing timers en de global cooldown. Het voelt zoals je het je herinnert in plaats van het te benaderen. De exacte getallen staan in `src/sim/` als je ze wilt lezen.

En vrijwel niets ervan is een meegeleverde asset. De wereld wordt vanuit code getekend:

- Procedurele steden, wezens, terrein, water, weer en realtime schaduwen, zonder 3D-modelbestanden voor de wereld.
- Twaalf gerigde wezenfamilies met volledige walk-, attack-, cast-, sit- en death-animaties.
- Spreuk-, item- en buff-pictogrammen tijdens runtime op canvas geschilderd.
- Een complete klassieke HUD (unit frames, action bars, tooltips, quest log, world map, minimap, floating combat text) en procedurele WebAudio voor elk geluid.

## Ontwikkeling

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

Logica- en unittests gebruiken Vitest. Voer tijdens het itereren één bestand uit: `npx vitest run tests/sim.test.ts`. De E2E- en visuele scripts sturen echte browsers aan via `puppeteer-core` en hebben `npm run dev` draaiend nodig (vaak ook `npm run server`). Browser-agents kunnen beweging aansturen via `window.__game.controller` in plaats van ingedrukte toetsen te simuleren, bijvoorbeeld `controller.move({ forward: true }, facingRadians)` of compacte flags zoals `{ f: 1, sr: 1 }`.

Voor de servercommando's zie [Online ontwikkelen](#develop-online-with-hot-reload) hierboven, [DEPLOY.md](../../DEPLOY.md) voor productie, en [CREDITS.md](../../CREDITS.md) voor asset-licenties.

## Lokalisatie

Elke voor de speler zichtbare string wordt opgelost via `t()`, en de game wordt geleverd in **21 locales** (Engels, twee Spaans, twee Frans, Engels Canada, Italiaans, Duits, Vereenvoudigd en Traditioneel Chinees, Koreaans, Japans, Braziliaans Portugees, Russisch, Nederlands, Pools, Indonesisch, Turks, Zweeds, Vietnamees en Deens). De sim en server blijven taalonafhankelijk: ze zenden stabiele sleutels of Engels uit dat de client aan de grens herlokaliseert, wat de determinisme intact houdt. Bijdragers voegen alleen Engels toe; de onderhouder vult de andere locales vóór elke release batchgewijs in. De workflow staat beschreven in `docs/i18n-scaling/translation-workflow.md`.

## Bijdragen

Bijdragen van elke soort zijn welkom: code, vertalingen, bugrapporten en documentatie. Begin met [CONTRIBUTING.nl_NL.md](CONTRIBUTING.nl_NL.md) voor de setup, lees de [Code of Conduct](../../CODE_OF_CONDUCT.md), en bekijk [SECURITY.md](../../SECURITY.md) voordat je een kwetsbaarheid meldt. Nieuw hier? Zoek naar issues met het label [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), open een [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose), of zeg hallo op [Discord](https://discord.com/invite/worldofclaudecraft).

<div align="center">

![World of Claude](../../worldofclaude.png)

![World of ClaudeCraft community](../../woc_community.png)

</div>

## Licentie

De code is [MIT-gelicentieerd](../../LICENSE), dus fork hem, remix hem en host je eigen wereld.

De meegeleverde third-party art-assets (modellen, textures, HDRIs) behouden hun eigen licenties, allemaal CC0 publiek domein behalve de MIT water normal maps, per pack gedocumenteerd in [CREDITS.md](../../CREDITS.md).
