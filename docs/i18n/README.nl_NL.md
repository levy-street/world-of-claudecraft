<div align="center">

# World of ClaudeCraft

**Volbreng quests, vorm een groep en raid een handgemaakte wereld, gratis in je browser. Open source, web3 en nu meteen online.**

**Officiële website: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.32.4-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.nl_NL.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Čeština](README.cs_CZ.md) · **Nederlands** · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Speel nu](https://worldofclaudecraft.com/) · [Host je eigen wereld](#host-your-own-world-one-command) · [Train een agent](#train-an-agent-headless-rl) · [Web3](#web3) · [Bijdragen](CONTRIBUTING.nl_NL.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![World of ClaudeCraft titelscherm](../../docs/screenshots/title-screen.jpg)

</div>

## Wat dit is

World of ClaudeCraft is een complete MMO uit het klassieke tijdperk die je nu meteen in je browser kunt spelen, zelf met één commando kunt hosten en waarin je zelfs AI-agents kunt trainen om te spelen. Het is gratis, open source en live op [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Eén gedeelde wereld draait op drie plekken, allemaal vanuit dezelfde game-core:

- de **autoritatieve multiplayerserver**, de live wereld die je speelt op worldofclaudecraft.com, waar accounts op basis van Postgres één persistent realm delen,
- de **offline browserwereld**, een lokale single-player Sim die je uit de dev-server krijgt, handig voor ontwikkeling en om de game-core van begin tot eind te lezen,
- de **headless RL-omgeving**, waar Python de echte game aanstuurt via een Gym-interface.

Dezelfde seed, dezelfde wereld, overal. Veel van wat je ziet wordt nog altijd tijdens runtime vanuit code getekend, en de rest is een samengestelde assetset die met het project wordt meegeleverd, zodat een fork meteen werkt.

## Hoogtepunten

- **Negen klassieke classes**, elk met een volledige uitrusting in de stijl van het klassieke tijdperk die ranks krijgt naarmate je levelt, plus een volledig **talent-systeem** (drie specs per class, in totaal 27 specs).
- **Drie open-wereldzones** van level 1 tot 20, meer dan 90 quests en één samenhangende verhaallijn over de Gravecaller-samenzwering.
- **Vijf instanced dungeons**, waarvan vier elite-raids voor vijf spelers en één solo-crypte, met elite-schaling, AoE-bossmechanieken, class-archetype-loot die zich verzamelt tot tier sets, en een **Heroic-moeilijkheidstier** met rijkere beloningen, plus **world bosses** in de open wereld en een raid-finale voor tien spelers.
- **Twee schaalbare delves**, een modus voor kleine groepen van één of twee spelers plus een AI-metgezel, elke run opnieuw opgebouwd uit gerandomiseerde kamers over de tiers Normal en Heroic.
- **Ranked PvP** op twee arenakaarten: 1v1- en 2v2-ladders, een levendigere 2v2 Fiesta-modus, en **Protect Yumi**, een objective-modus voor 3v3 en 5v5. Ranked spelen betaalt Honor uit, waarmee je een PvP-only gearset koopt die in PvE nooit boven dungeon-loot uitstijgt.
- **The Vale Cup**, een boarball-competitie in een eigen stadion ten zuiden van Eastbrook, en **Card Duel**, een snel kaartspel voor twee spelers dat in de stad wordt gehost.
- **Een Book of Deeds**: een prestatiejournaal met cosmetische titels, badge-randen en Renown, met Chronicles per zone die worden bijgehouden door Chronicler-NPC's in de wereld, en een aller-tijden leaderboard.
- **Een diepe professie-economie**: vier verzamelberoepen voeden tien ambachten, van koken en alchemie tot jewelcrafting, weaponcrafting en enchanting, met getierde tools, werkplaatsen in de stad, masterwork-kwaliteit en commissies, allemaal gekoppeld aan een spelergedreven **World Market** en de **Ravenpost**-postdienst.
- **Echte multiplayer**: parties en raids, guilds, handelen, duels, tap rights, party-split XP, whispers, away-status en een **Dungeon Finder** met rolwachtrijen en premade-listings.
- **Geschreven in code, niet in een 3D-editor**: terrein, water, weer, stadsindelingen, realtime schaduwen en effecten worden tijdens runtime gegenereerd, en de modellen die wel worden meegeleverd zijn gebouwd door procedurele fabrieken en een samengestelde assetbibliotheek in plaats van met de hand gemodelleerd.
- **Gelokaliseerd in 22 locales** via een deterministische pijplijn waarin de sim sleutels uitzendt.
- **Een bijbehorende wiki op `/wiki`**, rechtstreeks gegenereerd uit live game-content, zodat hij niet kan afwijken van de wereld die hij documenteert.
- **Native apps op elk platform**: ondertekende desktop-installers voor Windows, Linux en macOS met automatische updates en optionele spiegeling van Steam-achievements, plus iOS- en Android-builds, allemaal met dezelfde browserclient en dezelfde online wereld.
- **Schaalt mee met de machine die je hebt**: grafische presets en een automatische framerate-governor ruilen visuele rijkdom in voor vloeiendheid, en worden gehouden aan een eerlijkheidsregel die voorkomt dat ze ooit iets verbergen waar een speler op reageert.
- **Headless RL-omgeving** met Gymnasium-bindings, reward shaping en een benchmark-modus.
- **$WOC-utility, volledig optioneel**: koppel een Solana-wallet voor holder-flair, Daily Rewards en een kortingsoptie bij het betalen in de cosmetische winkel. De game blijft gratis te spelen en non-custodial.
- **Season 1 Armory**: verzamel cosmetische wapenskins via de WOC Store, met Claudium dat je koopt met fiat, SOL, USDC of $WOC. Cosmetica geven nooit gevechtskracht.

## Schermafbeeldingen

![Het marktplein van Eastbrook, kampvuur en questgevers](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Schemering bij het kampvuur van Eastbrook](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Schemering bij het kampvuur van Eastbrook* | ![Elite pulls in the Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Toortsverlichte elite pulls in the Hollow Crypt* |
| ![De rusteloze doden bij de verwoeste kapel](../../docs/screenshots/restless-dead.jpg)<br>*De rusteloze doden bij de verwoeste kapel* | ![Een gevecht met Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*In de minderheid bij het bandietenkamp* |
| ![Old Greyjaw opgejaagd op de noordweg](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, de rare spawn, neergehaald op de noordweg* | ![Vendor- en bags-UI](../../docs/screenshots/vendor-and-bags.jpg)<br>*Je uitrusten bij Trader Wilkes, met de vendor en bags open* |
| ![De moongate aan de oever van Glimmermere](../../docs/screenshots/glimmermere-moongate.jpg)<br>*De verdronkenen klimmen omhoog bij de moongate van Glimmermere* | ![Ysolei op het altaar van the Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Lunar Tempest en het altaar van the Drowned Temple* |

Weer wordt aangedreven door biomes en is render-only, dus het raakt nooit de deterministische sim:

| | | |
|:---:|:---:|:---:|
| ![Heldere lucht boven Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Helder boven the Vale* | ![Regen boven Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Regen boven Mirefen Marsh* | ![Sneeuw op Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Sneeuw op Thornpeak Heights* |

## Speel het

Speel in je browser op [worldofclaudecraft.com](https://worldofclaudecraft.com/), of installeer de native app voor Windows, Linux, macOS, iOS of Android. Elke client verbindt met dezelfde online wereld.

### Online, met andere spelers

Maak een account aan, maak een personage aan en betreed de live wereld. Zie [Host je eigen wereld](#host-your-own-world-one-command) hieronder om diezelfde client/server-stack zelf te draaien.

### Offline, in de dev-server

De offline modus is een lokale single-player wereld zonder account en zonder serverautoriteit, dus hij wordt alleen in development-builds meegeleverd. Start de dev-server en hij verschijnt in de moduskiezer:

```bash
npm install
npm run dev        # then open http://localhost:5173 and choose Play Offline
```

Geef je personage een naam, kies een van de negen classes, en je begint in **Eastbrook Vale** (levels 1-7), een marktstad omringd door hubs: wolvenpaden in het noorden, everzwijnweiden in het oosten, de Sableweb-bossen in het westen, Mirror Lake in het noordwesten, een door burrowers vergeven kopergroeve in het zuidwesten en een verwoeste kapel met rusteloze doden in het noordoosten, met Gorrak's bandietenkamp in het zuidoosten. De noordweg klimt via een bergpas omhoog naar **Mirefen Marsh** (6-13, hub Fenbridge) en verder omhoog naar **Thornpeak Heights** (13-20, hub Highwatch). De wereld-seed staat vast in `src/main.ts`, dus het is bij elk bezoek dezelfde plek.

### Desktop-apps voor Windows, Linux en macOS

World of ClaudeCraft wordt geleverd als volwaardige desktop-apps voor alle drie de grote desktopplatforms: ondertekende Windows-installers, Linux AppImage- en deb-pakketten, en ondertekende en genotariseerde universele macOS-builds. Ze gebruiken dezelfde gameclient en dezelfde online wereld als de browser, met native packaging en automatische updates.

Online inloggen gaat alleen via Discord en e-mail, precies zoals de webflow: e-mail en wachtwoord logt binnen de app in, en "Continue with Discord" opent je standaardbrowser op de `/desktop-login`-pagina, die een eenmalige code via een `worldofclaudecraft://` deep link terug aan de app geeft, waarna de app die inwisselt voor een normaal World of ClaudeCraft-sessietoken.

```bash
npm run electron:dev          # Vite + Electron dev shell
npm run electron:pack         # local unpacked desktop app
npm run electron:build        # website-channel installers (self-updating)
npm run electron:build:steam  # SteamPipe depot layouts (in-app updater off)
```

Wijs de shell naar een andere API met `VITE_DESKTOP_API_ORIGIN`, bijvoorbeeld een lokale server of een staging-host:

```bash
VITE_DESKTOP_API_ORIGIN=http://127.0.0.1:8787 npm run electron:dev
```

Overschrijf de productie-API-origin voor staging-builds met `VITE_DESKTOP_API_ORIGIN=https://dev.worldofclaudecraft.com` (een waarde op BUILD-moment: hij wordt in de bundle gebakken en in de verpakte app gestempeld, en geïnstalleerde builds negeren hem als runtime-omgevingsvariabele). Steam is een distributiekanaal (dezelfde Electron-bundle, geüpload via SteamPipe), en desktopspelers kunnen een Steam-account koppelen om de deeds die ze verdienen naar Steam-achievements te spiegelen; het inloggen zelf blijft e-mail en Discord. Het volledige release-draaiboek (ondertekening, notarisatie, een auto-update publiceren, SteamPipe-depots, de server-deploy) is `docs/desktop-release.md`. iOS en Android worden via Capacitor geleverd, met hun eigen draaiboek in `docs/mobile-store-release.md`.

<a id="host-your-own-world-one-command"></a>

## Host je eigen wereld (één commando)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres and the game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

Voor **remote hosting** zet je de compose-stack op een willekeurige VPS, stel je een echt `POSTGRES_PASSWORD` in de omgeving in en plaats je een TLS reverse proxy voor poort 8787. Met Caddy zijn dat een handvol regels; WebSockets worden automatisch geproxyd en de client kiest op https-pagina's automatisch `wss://`. Auth-endpoints zijn rate-limited, wachtwoorden zijn scrypt-gehasht en login-sessies verlopen. Stel in productie nooit `ALLOW_DEV_COMMANDS=1` in, want dat schakelt de volledige `/dev`-cheatset in: de level- en teleport-cheats die de testbots gebruiken, plus item-grants, mob-spawns, instance-teleports en de dev-command-GUI in de game. [DEPLOY.md](../../DEPLOY.md) is de volledige productiegids, inclusief de reverse-proxy-configuratie die de health- en metrics-endpoints van de publieke rand weghoudt.

<a id="develop-online-with-hot-reload"></a>

### Online ontwikkelen met hot reload

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api, /admin/api, and /ws)
```

Open http://localhost:5173, kies **Play Online**, maak een account aan, maak een personage aan en klik op Enter World. Het personageselectiescherm toont het laatste release-nieuws in het paneel News & Updates, met NEW-badges voor alles wat je nog niet hebt gezien. Open een tweede tabblad en log opnieuw in om elkaar in de stad te zien. `Enter` opent de chat. De spelerwiki is de Guide in de repo, geserveerd op http://localhost:5173/wiki en op `/wiki` in productie; de content wordt uit de huidige game-data gegenereerd met `npm run wiki:content`.

Wat blijft bewaard en hoe de server de leiding houdt:

- **Accounts**: scrypt-gehashte wachtwoorden en verlopende bearer-tokens.
- **Personages**: maximaal 10 per account per realm; level, gear, bags, bankkluis, quests, talents, professions, PvP- en deed-voortgang, positie en geld blijven als JSONB in Postgres bewaard, opgeslagen op een timer, bij uitloggen en bij het afsluiten van de server. Namen zijn uniek per realm en klassiek van stijl.
- **De server is autoritatief**: clients streamen bewegingsintentie en commando's met 20 Hz; de server draait de ene gedeelde `Sim` en stuurt interest-scoped snapshots plus per-player events terug. Elke combat roll, loot drop, quest credit en vendor-transactie wordt aan de serverkant afgehandeld. De client is een renderer.

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

env = WoWClassicEnv(player_class="warrior")   # any of the nine classes
obs, info = env.reset(seed=42)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
env.close()
```

- **Observation- en action-spaces zijn afgeleid van content.** Vraag ze bij het opstarten op uit het `info`-antwoord van de env in plaats van ze hard te coderen; ze groeien mee met de game. De action-space is een `Discrete` die beweging, target, attack, de volledige ability-kit, interact en eten/drinken dekt; de observation is een `Box` die zelf, abilities, target, mobs in de buurt, de dichtstbijzijnde interactable en questvoortgang dekt.
- **Reward** is een gewogen som van per-tick counter-delta's (XP, aangerichte en geïncasseerde schade, kills, deaths, questvoortgang, level-ups), instelbaar per reset. Elke `step` past één actie toe en zet standaard vijf sim-ticks vooruit, dus ongeveer vier beslissingen per gesimuleerde seconde.
- **Deterministisch van opzet.** Geen wandklok, geen `Math.random`. Seed de reset en de episode speelt zich exact opnieuw af.

Het protocol en de bindings staan beschreven in `headless/CLAUDE.md` en `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft is web3-native rond **$WOC**, onze community-token op Solana. Verbind een Solana-wallet, koppel hem met één handtekening aan je account (non-custodial, geen transactie om goed te keuren), en je alleen-lezen $WOC-saldo verschijnt in de HUD naast een cosmetische holder-tier-badge.

$WOC heeft ook optionele utility in de live game:

- **WOC Store**: koop Claudium, de cosmetische eenrichtingsvaluta, met fiat, SOL, USDC of $WOC. De $WOC-betaalroute is goedkoper dan de andere.
- **Season 1 Armory**: geef Claudium uit aan collecties cosmetische wapenskins. Aankopen in de winkel voegen geen stats of gevechtskracht toe.
- **Daily Rewards**: geverifieerde holders die in aanmerking komen, kunnen punten verdienen met een dagelijkse spin en roulerende taken, en daarna meedingen naar een deel van de dagelijkse prijzenpot.

Niets hiervan is nodig om te spelen. Het koppelen van een wallet is optioneel en non-custodial, er is geen pay-to-win, en de hele game speelt prima zonder ooit een wallet te verbinden.

**$WOC contract-adres (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Meer over de token op [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Een rondleiding door de wereld

### De negen classes

Elke class draait op MMO-mechanieken uit het klassieke tijdperk die vanaf de basis zijn geïmplementeerd, en leert ranked spreuken over de levels 1-20, met signature abilities als Low Blow, Early Grave, Skyfall, Urgent Prayer en Ancestral Strike die in de tweede helft van de klim vrijkomen.

- **Warrior**: rage, Iron Bellow, Onrush, Quaking Blow, Maiming Strike, Gaping Wounds (een bleed die met je slagen meelift), Widening Arc, Hobbling Cut, Blood Toll, Redhand (dodge proc).
- **Paladin**: Oathbrand ontketend door Verdict, Mending Light, Steadfast Aura, Oath of Iron, Ward of Faith (absorb), Sundering Gavel (stun), Last Rite.
- **Hunter**: ranged auto-attack (8-35 yd met een dead zone in klassieke stijl), Gutting Strike, Harrier's Guise, Venom Barb, Fell Shot, Rattling Shot, Counterfang, Fettering Slash, en een tembare pet vanaf level 10.
- **Rogue**: energy en combo points, Wicked Slash, Dirt Nap, Craven Thrust (van achteren, dagger), Eye Jab, Ghostfoot, Cutthroat Tempo, Swift Heels.
- **Priest**: Smite, Whispered Prayer, Litany of Resolve, Dirge of Decay, Psalm of Warding (absorb), Lingering Grace (HoT), Mindfracture.
- **Shaman**: Arc Bolt, Stonebound Weapon (imbue), Mending Waters, Earthen Jolt, Thunder Ward (thorns), Cinder Jolt.
- **Mage**: Cinderbolt, Hoarfrost Mantle, Aether Insight, Rimelance, Waterbind, Cinderfall, Aether Darts (channeled), Bewitch, Icebind, een opgeroepen waterelementaal, en Chronomancy, een healing-spec met tijdmagie.
- **Warlock**: Gloom Bolt, Fiendhide, Burning Pact, Blackrot, Hard Bargain, Hex of Anguish, Consume, en zeven oproepbare demonen van Emberkin tot Wraithborn.
- **Druid**: Wildbolt, Wildmend, Wildward, Lunar Tempest, Wildbloom, Briarguard, Gripping Roots, en shapeshiften naar Wolf Form op 5, Bruin Form op 8 en Moonwing Form op 10.

Heals en buffs landen op party-leden, healing kan critten, en absorb-shields vangen schade op vóór de health. Besteed punten over **drie talent-specs per class** (Battlecraft/Bloodrush/Ironguard, Moongrove/Wildfang/Groveheart, enzovoort); de toewijzing wordt door de server gevalideerd en is exporteerbaar als een build-string.

### Dungeons

De Gravecaller-verhaallijn loopt door drie elite-instances voor vijf spelers, een vierde wacht achter een moongate met zijn eigen verdronken lore, en een solo-crypte ligt er voor verkenners terzijde.

- **The Hollow Crypt** (5 spelers) onder the Fallen Chapel: gepaarde elite-trash, de Sexton Marrow miniboss, en Morthen the Gravecaller met zijn terugkerende shadow-AoE. De cryptedeur teleporteert je party naar een privé-instancekopie die reset zodra hij leegloopt.
- **The Sunken Bastion** (5 spelers, rond level 13, zuidoostelijk Mirefen): Vael the Fogbinder roept golven Drowned Thralls op naarmate het gevecht vordert.
- **Gravewyrm Sanctum** (5 spelers, level 20, onder Thornpeak): drie kamers met elite-boneguard en scaleguard, Korgath the Bound, Grand Necromancer Velkhar, en Korzul the Gravewyrm, waar epic weapons vallen.
- **The Drowned Temple** (5 spelers) via de moongate van Glimmermere: een bleke, maanviolette instance die leidt naar Choirmother Selthe en daarna Ysolei, Avatar of the Drowned Moon, wier maangetijden en opgeroepen Moonspawn een stilstaande groep afstraffen.
- **The Abandoned Crypt** (solo) in Thornpeak: een stille keystone-en-dagboek-duik voor één persoon, waarvan het spoor de koninklijke deur naar **Nythraxis, Scourge of Thornpeak** ontzegelt, een raid-finale voor tien spelers uitgevochten over drie soul wardstones.

Elke instance draait ook op **Heroic**: vijanden van een hoger level, scherpere mechanieken, en een eigen loot- en vendorvaluta. De aanloop-questketens zijn solo te doen, dus het verhaal zit nooit achter het vinden van een groep weggesloten. Onze geautomatiseerde vijf-bot raid (warrior, paladin, priest, mage, hunter met focus-fire en healer-AI) klaart the Hollow Crypt in ongeveer vijf minuten (`node scripts/crypt_raid.mjs`, vereist `ALLOW_DEV_COMMANDS=1`).

### Delves

Delves zijn een aparte, schaalbare modus voor kleine groepen van één of twee spelers, elke run opnieuw opgebouwd uit gerandomiseerde kamers en eindigend bij een vergrendelde reliekkist die opengaat via een lockpicking-minigame in plaats van een loot roll. **The Collapsed Reliquary** (level 7 en hoger) eindigt bij Deacon Varric, met een AI-metgezel, Tessa, die aan je zij vecht als je alleen gaat. **The Drowned Litany** (level 12 en hoger) volgt het spoor naar een ondergelopen heiligdom aan de rand van Mirefen Marsh. Een delve-bord bepaalt de tier: Heroic verhoogt de vijandlevels en voegt een willekeurige affix toe voor rijkere beloningen.

### Ranked PvP (the Ashen Coliseum)

Druk op `G` of de arena-knop om in de wachtrij te gaan. Matchmaking teleporteert vechters naar een privé pit, een korte aftelling heelt en reset iedereen voor een eerlijke start, en het gevecht eindigt wanneer een kant zich overgeeft. Niemand sterft, en je keert precies terug naar waar je in de wachtrij ging. Protect Yumi wordt uitgevochten in een eigen doolhof in plaats van in de pit van the Coliseum.

- **1v1- en 2v2-ranked ladders**, elk met een persistente Elo-achtige rating en een aller-tijden leaderboard.
- **2v2 Fiesta**, een levendigere party-modus waarin teams racen naar een takedown-doel terwijl augment-pickups power laten vallen en een sluitende ring het gevecht bij elkaar dwingt.
- **Protect Yumi**, een ongewaardeerde objective-modus voor 3v3 en 5v5 die in een doolhof wordt uitgevochten: elk team bewaakt een kattenfamiliar en probeert die van de tegenpartij neer te halen, dus escortes en picks tellen zwaarder dan pure kills.

Ranked-overwinningen en Fiesta-takedowns betalen **Honor** uit, dat de kwartiermeester in de stad ruilt voor een set Warfare-gear. Warfare is een PvP-only stat, dus de set wint duels zonder in PvE ooit boven dungeon-loot van dezelfde tier uit te komen.

### Samen spelen

- **Dungeon Finder**: open hem met `Shift+I` om dungeons en raids te bekijken, bosses en loot te inspecteren, in een automatische tank/healer/DPS-rolwachtrij te gaan, of een premade-listing aan te maken. Groepen die via de Finder ontstaan, reizen nog steeds samen naar de ingang.
- **Parties** tot 5, omgezet in een raid van tien spelers in twee groepen zodra je vol zit: rechtsklik op een speler en kies Invite to Party. Leden delen tap rights en quest credit, splitsen XP met de groepsbonussen uit het klassieke tijdperk, en verschijnen als blips op de minimap. `/p` voor party-chat, `/roll` om loot te beslechten.
- **Handelen**: rechtsklik en kies Trade. Beide kanten plaatsen items en geld klaar, beide moeten accepteren, en de ruil is atomisch en door de server gevalideerd. Questitems kunnen niet worden verhandeld, en uit elkaar lopen annuleert.
- **Duels**: rechtsklik en kies Challenge to a Duel. Een aftelling van 3 seconden, dan vechten tot een kant 1 hp raakt; de winnaar wordt zone-breed aangekondigd en 60 yards weglopen betekent verlies.
- **Tap rights en away-status**: de eerste speler die een mob schade doet, bezit de loot, XP en quest credit ervan; `/afk` en `/dnd` markeren je als afwezig met een automatisch antwoord op whispers.

### Wereld en systemen

- **Professions** (`Shift+P`): vier verzamelberoepen (mining, logging, herbalism, fishing) voeden tien ambachten, van koken en alchemie tot weaponcrafting, jewelcrafting en enchanting. Verzameltools komen in tiers die bepalen welke nodes je kunt bewerken, crafting gebeurt aan werkplaatsen in de stad met een kans op masterwork-kwaliteit die het merk van de maker draagt, en er is een archetype-systeem om te ontdekken naarmate je je specialiseert.
- **The World Market**: een spelergedreven veilinghuis voor gear, materialen en consumables, doorzoekbaar vanuit de hubsteden.
- **Ravenpost-post**: stuur items en munten naar andere personages, met bijlagen die veilig worden bewaard tot ze worden opgehaald.
- **Guilds**: charters, rosters, ranks en guild chat.
- **The Guide**: een doorzoekbare wiki op de site op `/wiki` over classes, wezens, zones en deeds, rechtstreeks gegenereerd uit live game-content zodat hij niet kan afwijken van de wereld die hij documenteert.
- **The Vale Cup en Card Duel**: boarball in het Sowfield-stadion ten zuiden van Eastbrook, in formats van 1v1 tot 5v5, en een snel kaartspel voor twee spelers dat door de Card Master in de stad wordt gehost.
- **Daily Rewards**: geverifieerde $WOC-holders kunnen leaderboard-punten verdienen met een dagelijkse spin en roulerende taken, met automatische uitbetalingen uit de dagelijkse prijzenpot.
- **WOC Store en Season 1 Armory**: koop Claudium met fiat, SOL, USDC of $WOC, en geef het daarna uit aan puur cosmetische wapenskins.
- **Eten en drinken**: ga zitten om te herstellen, onderbroken door schade of opstaan, en ja, je kunt tegelijk eten en drinken.
- **Vendors** die food en water kopen en eerlijke witte gear verkopen, met munten getoond in gold, silver en copper.
- **Een persoonlijke bank** (the Gilded Strongbox): bursars in elke hubstad houden een kluis per personage bij, van 24 slots tot 96 met uitbreidingen die je met munten koopt, plus bonusslots die je online verdient voor een geverifieerd e-mailadres, gekoppelde accounts en referrals.
- **The Book of Deeds**: een prestatiejournaal (standaard `Shift+Z`) van quests, kills, clears en verrassingen, dat cosmetische titels uitbetaalt die je op je nameplate, in de chat en op de boards kunt dragen, plus een HUD-tracker voor de deeds die je najaagt, Chronicles per zone bijgehouden door Chronicler-NPC's, en een aller-tijden Renown-leaderboard; de publieke lijst staat op `/wiki/deeds`.
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
| `C` `P` `L` `M` `B` `N` `T` | character, spellbook, quest log, world map, bags, talents, crafting |
| `G` `O` `K` `I` `Y` `Shift+I` `Shift+P` `Shift+Z` | arena, vrienden en guild, leaderboard, kalender, Vale Cup, Dungeon Finder, professions, deeds |
| `Z` / `X` | wapens opbergen of trekken, emote-wiel |
| `V` / `R` / `Esc` | nameplates, autorun, het bovenste venster sluiten (of het spelmenu openen) |

Elke binding is opnieuw toe te wijzen in het keybinds-paneel. Touch-besturing (een bewegingsstick, camera slepen en action-knoppen op het scherm) verschijnt automatisch op mobiel.

## Architectuur (één sim, drie hosts)

Drie ideeën houden het project bij elkaar:

- **Één sim, drie hosts.** Dezelfde `src/sim/`-code draait de offline browserwereld, de online server en de RL-omgeving. Het gedrag moet overal identiek zijn, en de tests bestaan om dat zo te houden.
- **`IWorld` is de enige naad.** `IWorld` is gedefinieerd als facet-interfaces per domein onder `src/world_api/`, samengevoegd door `src/world_api.ts`. De offline `Sim` voldoet er structureel aan en de online `ClientWorld` implementeert het door server-snapshots te spiegelen. De renderer en HUD praten alleen met `IWorld`, nooit met een concrete wereld, dus een nieuwe feature breidt eerst het bijbehorende facet uit en daarna beide werelden.
- **De server is autoritatief.** Clients sturen intentie; de server beslist over uitkomsten. De client lost combat, loot of economie nooit zelf op.

De sim is een vaste tick van 20 Hz (`DT = 1/20`), alle randomness stroomt door één geseede `Rng`, en `src/sim/` bevat nul DOM-, browser- of Three.js-imports. Dat is wat dezelfde code in staat stelt om te bundelen in een Node env-server, een autoritatieve game-loop en een browsertabblad zonder ook maar één regel te wijzigen.

### Projectindeling

| Pad | Wat het is |
|---|---|
| `src/sim/` | Deterministische game-core, de source of truth. Geen DOM- of Three-dependencies. |
| `src/sim/content/` | Data als code: de negen classes, abilities, zones, dungeons, delves, items, recipes, enchants, talents, professions, deeds. |
| `src/world_api.ts` + `src/world_api/` | `IWorld`, de naad waar de renderer en HUD van afhangen: één facet-interface per domein. |
| `src/` (de rest) | Three.js-renderer, HUD en styles, invoer/audio, online spiegel, en de admin-, guide- en editor-SPA's. |
| `server/` | Autoritatieve server: HTTP en WS, world loop, Postgres, auth, social, moderatie. |
| `server/http/` | De REST-requestpijplijn: tabelrouter, middleware en routedefinities per domein. |
| `headless/` + `python/` | RL env-server (`env_server.ts`) en Python Gym-bindings. |
| `bot/` | Discord-bot (rollen, relay, activiteitenfeed). |
| `electron/`, `android/`, `ios/` | Desktop- (Steam) en native mobiele shells. |
| `tests/` | Vitest-suite. |
| `scripts/` | Build-, asset-, i18n-, SFX-, screenshot- en browser-E2E-tooling. |
| `deploy/` · `mediawiki/` | Productie-assets voor de eerste boot en de container voor de spelerwiki. |
| `public/` · `docs/` | Statische assets (verbatim naar de site gedeployd) en designdocs. |

Niets hiervan gaat op erewoord: `tests/architecture.test.ts` scant elk sim-bestand op een
verboden import, een DOM-global of een verdwaalde klok- of `Math.random`-aanroep, en
`tests/world_api_parity.test.ts` pint de naad vast zodat de twee werelden niet uit elkaar kunnen lopen.

De meeste directories dragen hun eigen `CLAUDE.md` met lokale conventies, en de volledige set
project-invarianten staat in de root-[`CLAUDE.md`](../../CLAUDE.md). Bijdragende agents beginnen
daar en pakken daarna het startpunt van hun runtime op: [`AGENTS.md`](../../AGENTS.md) plus de
[Codex-operatorgids](../codex.md) voor Codex, [`GEMINI.md`](../../GEMINI.md) voor Gemini. Ze komen
allemaal uit bij dezelfde canonieke architectuur.

## Gebouwd als de klassiekers

Combat, leveling en threat draaien allemaal op authentieke regels uit het klassieke tijdperk: rage en energy, hit- en dodge-tables, armor mitigation, de echte XP-curve, swing timers en de global cooldown. Het voelt zoals je het je herinnert in plaats van het te benaderen. De exacte getallen staan in `src/sim/` als je ze wilt lezen.

De wereld is in code geschreven in plaats van in een 3D-editor, en dat is wat hem klein,
deterministisch en makkelijk te forken houdt:

- Terrein, water, weer, lucht, stadsindelingen, realtime schaduwen en combat-effecten worden tijdens runtime gegenereerd uit de eigen data van de sim.
- De modellen die wel worden meegeleverd zijn op dezelfde manier gebouwd: procedurele fabrieken onder `scripts/assets/` exporteren deterministische GLB's via de image-to-GLB-pijplijn van het project, naast een samengestelde bibliotheek met CC0-modelkits. Gerigde wezen- en personagefamilies dragen volledige walk-, attack-, cast-, sit- en death-animaties.
- Pictogrammen zijn een gelaagde painter die kunst samenstelt voor alles zonder meegeleverd bestand, zodat er nooit een pictogram ontbreekt, met daarbovenop samengestelde geschilderde kunst voor abilities, items en deeds.
- Een complete klassieke HUD (unit frames, action bars, tooltips, quest log, world map, minimap, floating combat text, the Book of Deeds), gesamplede ruimtelijke en interface-geluidseffecten, en een soundtrack die procedureel in de repo is gecomponeerd en als gestreamde remasters wordt geleverd die overvloeien tussen zones, steden, dungeons en combat.

Elke meegeleverde asset en zijn licentie staat vastgelegd in [CREDITS.md](../../CREDITS.md), en
gebundelde third-party dependencies dragen hun kennisgevingen in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Ontwikkeling

Naast de gameclient levert de build het operatordashboard op, de wereld-editor op
`/editor` en de publieke Guide op `/wiki`, allemaal geserveerd vanaf dezelfde dev-server.

Elk FFmpeg-pad dat de gate en de audiotests aanspreken, komt uit bij de meegeleverde
npm-pakketten `ffmpeg-static`/`ffprobe-static`, dus een normale bijdrage heeft geen
systeeminstallatie van FFmpeg nodig. De paden die conformiteit meten (`npm run sfx:check`, de
audiotests, de exportvalidatie van de Studio) binden rechtstreeks aan de statische binaries,
zonder terugval op `PATH`: draai `npm ci` opnieuw als een installatie waarbij scripts zijn
overgeslagen ze heeft laten ontbreken. De playback- en encode-spawns van de Studio en de
preflight van `npm run gate` komen uit via `scripts/sfx/ffmpeg_paths.mjs`, dat wel terugvalt op
`PATH`. Sommige losstaande audio-generatorscripts (bijvoorbeeld `scripts/gen_ui_sfx.mjs`)
gebruiken nog steeds standaard `ffmpeg` uit `PATH`.

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

Logica- en unittests gebruiken Vitest. Voer tijdens het itereren één bestand uit: `npx vitest run tests/sim.test.ts`. Interfacewijzigingen hebben ook een opt-in suite in een echte browser die toegankelijkheid, toetsenbordnavigatie en touch-doelen dekt: `npm run test:browser`. De screenshot- en smoke-scripts sturen echte browsers aan via `puppeteer-core` en hebben `npm run dev` draaiend nodig; de wire-level scripts (`mp_integration.mjs`, `social_e2e.mjs`, `crypt_raid.mjs`) praten rechtstreeks met de server en hebben in plaats daarvan `npm run server` nodig. Browser-agents kunnen beweging aansturen via `window.__game.controller` in plaats van ingedrukte toetsen te simuleren, bijvoorbeeld `controller.move({ forward: true }, facingRadians)` of compacte flags zoals `{ f: 1, sr: 1 }`.

Controles draaien in lagen, beschreven in [docs/qa-gate.md](../qa-gate.md): wijs je clone naar
de gedeelde hooks met `git config core.hooksPath .githooks` en er draait een snelle ondergrens
voordat er iets van je machine vertrekt.

Voor de servercommando's zie [Online ontwikkelen](#develop-online-with-hot-reload) hierboven,
[CONTRIBUTING.nl_NL.md](CONTRIBUTING.nl_NL.md) voor de bijdrageworkflow, de
[SFX Studio-tutorial](../sfx-studio-tutorial.md) voor geluidsontwerp en
artifact-export, [DEPLOY.md](../../DEPLOY.md) voor productie, en
[CREDITS.md](../../CREDITS.md) voor asset-licenties.

## Lokalisatie

Elke voor de speler zichtbare string wordt opgelost via `t()`, en de game wordt geleverd in **22 locales** (Engels, twee Spaans, twee Frans, Engels Canada, Italiaans, Duits, Vereenvoudigd en Traditioneel Chinees, Koreaans, Japans, Braziliaans Portugees, Russisch, Tsjechisch, Nederlands, Pools, Indonesisch, Turks, Zweeds, Vietnamees en Deens). De sim en server blijven taalonafhankelijk: ze zenden stabiele sleutels of Engels uit dat de client aan de grens herlokaliseert, wat het determinisme intact houdt. Bijdragers voegen alleen Engels toe; de onderhouder vult de andere locales vóór elke release batchgewijs in. De workflow staat beschreven in `docs/i18n-scaling/translation-workflow.md`.

## Bijdragen

Bijdragen van elke soort zijn welkom: code, vertalingen, bugrapporten en documentatie. Begin met [CONTRIBUTING.nl_NL.md](CONTRIBUTING.nl_NL.md) voor de setup, lees de [Code of Conduct](../../CODE_OF_CONDUCT.md), en bekijk [SECURITY.md](../../SECURITY.md) voordat je een kwetsbaarheid meldt. Nieuw hier? Zoek naar issues met het label [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), open een [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose), of zeg hallo op [Discord](https://discord.com/invite/worldofclaudecraft).

De actieve ontwikkeling loopt op de nieuwste `release/vX.Y.Z`-branch. Zoek die op in plaats van ervan uit te gaan, vertak er vervolgens vanaf en richt je pull request daarop. Vertak nooit vanaf `main` en richt er nooit op; die krijgt pas een release-branch wanneer die versie uitkomt. [CONTRIBUTING.md](CONTRIBUTING.nl_NL.md) bevat het commando van één regel dat de huidige vindt.

## Licentie

**De code is [MIT-gelicentieerd](../../LICENSE), dus fork hem, remix hem en host je eigen wereld.** Dat is de hele bedoeling, en niets anders op deze pagina of op onze website neemt dat terug.

Drie zaken zijn apart gelicentieerd, dus het is dertig seconden waard om te weten wat wat is:

| Wat | Licentie | Mag je het herdistribueren? |
|---|---|---|
| **Broncode**, oftewel alles behalve de media-assets die hieronder worden uitgezonderd | [MIT](../../LICENSE) | Ja. Ook commercieel. |
| **Media-assets**: modellen, textures, HDRI's, pictogrammen, geluiden, fonts (grotendeels onder `public/`) | Per asset, vastgelegd in [CREDITS.md](../../CREDITS.md) | Meestal wel (de meeste zijn CC0). Sommige niet, zie hieronder. |
| **Naam en branding**: "World of ClaudeCraft", "Levy Street", de logo's | Niet gelicentieerd | Nee. |

**Fork het en host je eigen wereld. Dat werkt, en de assets zitten je niet in de weg.** Het meeste van wat je ziet is CC0 publiek domein (KayKit, Quaternius, Kenney, ambientCG, Poly Haven), en onze eigen gegenereerde props, wezens, achtergronden en interfacegeluiden worden met het project meegeleverd, zodat een fork meteen werkt. Je mag ze alleen niet eruit tillen en als losstaande kunst verkopen.

Wat je zou moeten verwijderen of vervangen voordat je herdistribueert:

- de **CraftPix class-ability-pictogrammen** onder `public/ui/skills/` zijn door Levy Street gekocht en **mogen niet worden herdistribueerd**, dus koop je eigen licentie als je ze wilt meeleveren;
- de **@jamiecypher-geluidseffecten** vallen onder CC BY-NC 4.0, dus deel ze niet-commercieel met naamsvermelding, maar de commerciële toestemming geldt alleen voor dit project;
- de **winkel- en prestige-kunst** (Season 1 Armory, de Claudium-set, de professies-kunstset, Book of Deeds-pictogrammen, het elite-drakenembleem) is in opdracht gemaakte commerciële kunst en **de rechten zijn voorbehouden**;
- de **merktekens van derden** (Twitch, X, Kick, YouTube, Discord, Solana, USDC) zijn handelsmerken van hun eigenaren en zijn niet van ons om door te licentiëren;
- een handvol **pictogrammen en opnames die met toestemming worden gebruikt** hebben toestemming nodig om door te geven.

[CREDITS.md](../../CREDITS.md) is de gezaghebbende lijst, met per asset een kolom over herdistributie. Waar een asset daar vermeld staat, gaat die licentie boven de MIT-licentie van het project. Dat register wordt nog aangevuld, dus een media-asset die er niet in staat is niet-geregistreerd in plaats van vrij: vraag het na voordat je erop vertrouwt. Voor broncode geldt het omgekeerde, en alles wat niet is uitgezonderd is MIT.

Onze [Terms of Service](https://worldofclaudecraft.com/terms) gelden voor de gehoste game die wij draaien op worldofclaudecraft.com: accounts, gedrag, virtuele items. Ze beperken de rechten die de MIT-licentie je op deze broncode geeft niet.
