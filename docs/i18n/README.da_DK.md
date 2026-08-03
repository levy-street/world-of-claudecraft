<div align="center">

# World of ClaudeCraft

**Tag på quests, dan grupper, og raid en håndbygget verden, gratis i din browser. Open source, web3, og online lige nu.**

**Officiel hjemmeside: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.33.1-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.da_DK.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Čeština](README.cs_CZ.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · **Dansk**

[Spil nu](https://worldofclaudecraft.com/) · [Hav din egen verden](#host-your-own-world-one-command) · [Træn en agent](#train-an-agent-headless-rl) · [Web3](#web3) · [Bidrag](CONTRIBUTING.da_DK.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![World of ClaudeCraft titelskærm](../../docs/screenshots/title-screen.jpg)

</div>

## Hvad er dette

World of ClaudeCraft er en komplet MMO i klassisk stil, som du kan spille lige nu i din browser, selv hoste med en enkelt kommando, og endda træne AI-agenter til at spille. Den er gratis, open source, og live på [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Én fælles verden kører tre steder, alt sammen fra den samme spilkerne:

- den **autoritative multiplayer-server**, den levende verden du spiller i på worldofclaudecraft.com, hvor Postgres-understøttede konti deler ét persistent realm,
- den **offline browser-verden**, en lokal single-player Sim som du får fra dev-serveren, nyttig til udvikling og til at læse spilkernen fra ende til anden,
- det **headless RL-miljø**, hvor Python driver det rigtige spil gennem en Gym-grænseflade.

Samme seed, samme verden, overalt. Meget af det du ser bliver stadig tegnet fra kode ved kørselstidspunktet, og resten er et kurateret sæt assets, der leveres med projektet, så et fork kører ud af boksen.

## Højdepunkter

- **Ni klassiske klasser**, hver med et fuldt kit i klassisk stil, der får ranks efterhånden som du stiger i level, plus et fuldt **talentsystem** (tre specs per klasse, 27 specs i alt).
- **Tre open world-zoner** fra level 1 til 20, mere end 90 quests, og en enkelt sammenhængende fortælling om the Gravecaller-konspirationen.
- **Fem instancerede dungeons**, fire af dem femspiller-elite-raids og én solo-krypt, med elite-skalering, AoE-bossmekanikker, loot efter klassearketype der samler sig til tier-sæt, og et **Heroic-sværhedsgradstier** med rigere belønninger, plus **world bosses** i den åbne verden og en tispiller-raid-finale.
- **To skalerbare delves**, en mode for små grupper på én eller to spillere plus en AI-ledsager, genopbygget fra randomiserede kamre i hvert gennemløb på tværs af Normal- og Heroic-tiers.
- **Ranket PvP** på tværs af to arenakort: 1v1- og 2v2-stiger, en livligere 2v2 Fiesta-mode, og **Protect Yumi**, en 3v3- og 5v5-objective-mode. Ranket spil betaler Honor, som køber et PvP-kun gear-sæt, der aldrig overgår dungeon-loot i PvE.
- **The Vale Cup**, en boarball-liga spillet på sit eget stadion syd for Eastbrook, og **Card Duel**, et hurtigt kortspil mand mod mand, der afholdes i byen.
- **En Book of Deeds**: en achievement-journal med kosmetiske titler, badge-kanter, og Renown, med Chronicles per zone ført af Chronicler-NPC'er ude i verdenen og en all-time leaderboard.
- **En dyb professions-økonomi**: fire gathering-fag fodrer ti crafts, fra madlavning og alkymi til smykkekunst, våbensmedning, og fortryllelse, med værktøj i tiers, workstations i byerne, masterwork-kvalitet, og commissions, alt sammen ind i et spillerdrevet **World Market** og postservicen **Ravenpost**.
- **Ægte multiplayer**: parties og raids, guilds, handel, dueller, tap rights, party-delt XP, hvisken, away-status, og en **Dungeon Finder** med rollekøer og premade-opslag.
- **Skrevet i kode, ikke i en 3D-editor**: terræn, vand, vejr, bylayouts, realtidsskygger, og effekter bliver genereret ved kørselstidspunktet, og de modeller der rent faktisk leveres, er bygget af procedurale fabrikker og et kurateret assetbibliotek frem for skulptureret i hånden.
- **Lokaliseret til 22 sprog** gennem en deterministisk pipeline hvor sim'en udsender nøgler.
- **En ledsagende wiki på `/wiki`**, genereret direkte fra levende spilindhold, så den ikke kan drive fra den verden den dokumenterer.
- **Native apps på alle platforme**: signerede desktop-installere til Windows, Linux, og macOS med automatiske opdateringer og valgfri spejling til Steam-achievements, plus iOS- og Android-builds, der alle deler browserklienten og den samme online verden.
- **Skalerer til den maskine du har**: grafik-presets og en automatisk framerate-governor bytter visuel rigdom for jævnhed, og de er bundet af en fairness-regel, der forhindrer dem i nogensinde at skjule noget, en spiller reagerer på.
- **Headless RL-miljø** med Gymnasium-bindings, reward shaping, og en benchmark-mode.
- **$WOC-nytte, helt valgfrit**: link en Solana-wallet for holder-flair, Daily Rewards, og en rabatteret betalingsmulighed i den kosmetiske butik. Spillet forbliver gratis at spille og non-custodial.
- **Season 1 Armory**: saml kosmetiske våben-skins gennem WOC Store med Claudium købt for fiat, SOL, USDC, eller $WOC. Kosmetik giver aldrig kampkraft.

## Skærmbilleder

![Eastbrook-torvet, lejrbålet og questgivere](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Skumring ved Eastbrook-lejrbålet](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Skumring ved Eastbrook-lejrbålet* | ![Elite-pulls i the Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Fakkelbelyste elite-pulls i the Hollow Crypt* |
| ![De rastløse døde ved det ødelagte kapel](../../docs/screenshots/restless-dead.jpg)<br>*De rastløse døde ved det ødelagte kapel* | ![Et slagsmål med Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*I undertal ved banditlejren* |
| ![Old Greyjaw jaget ned på nordvejen](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, den sjældne spawn, jaget ned på nordvejen* | ![Vendor- og bags-UI](../../docs/screenshots/vendor-and-bags.jpg)<br>*Gør dig klar hos Trader Wilkes, med vendor og bags åbne* |
| ![Moongate ved Glimmermere-kysten](../../docs/screenshots/glimmermere-moongate.jpg)<br>*De druknede klatrer op ved Glimmermere-moongate* | ![Ysolei på alteret i the Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Lunar Tempest og alteret i the Drowned Temple* |

Vejret er biome-drevet og findes kun i rendereren, så det rører aldrig den deterministiske sim:

| | | |
|:---:|:---:|:---:|
| ![Klar himmel over Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Klart over the Vale* | ![Regn over Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Regn over Mirefen Marsh* | ![Sne på Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Sne på Thornpeak Heights* |

## Spil det

Spil i din browser på [worldofclaudecraft.com](https://worldofclaudecraft.com/), eller installer den native app til Windows, Linux, macOS, iOS, eller Android. Hver klient forbinder til den samme online verden.

### Online, med andre spillere

Opret en konto, opret en karakter, og gå ind i den levende verden. For selv at køre den samme client/server-stak, se [Hav din egen verden](#host-your-own-world-one-command) nedenfor.

### Offline, i dev-serveren

Offline mode er en lokal single-player-verden uden konto og uden serverautoritet, så den leveres kun i udviklingsbuilds. Kør dev-serveren, og den dukker op i mode-vælgeren:

```bash
npm install
npm run dev        # then open http://localhost:5173 and choose Play Offline
```

Navngiv din karakter, vælg en af de ni klasser, og du starter i **Eastbrook Vale** (level 1-7), en handelsby omkranset af hubs: ulveløb mod nord, vildsvineenge mod øst, Sableweb-skoven mod vest, Mirror Lake mod nordvest, en burrower-plaget kobbergrav mod sydvest, og et ødelagt kapel med rastløse døde mod nordøst, med Gorraks banditlejr mod sydøst. Nordvejen stiger op gennem et bjergpas ind i **Mirefen Marsh** (6-13, hub Fenbridge) og videre op til **Thornpeak Heights** (13-20, hub Highwatch). Verdens-seed'en er fastlåst i `src/main.ts`, så det er det samme sted ved hvert besøg.

### Desktop-apps til Windows, Linux, og macOS

World of ClaudeCraft leveres som fulde desktop-apps til alle tre store desktop-platforme: signerede Windows-installere, Linux AppImage- og deb-pakker, og signerede og notariserede universelle macOS-builds. De bruger den samme spilklient og den samme online verden som browseren, med native pakning og automatiske opdateringer.

Online-login er kun Discord og email, præcis som web-flowet: email og password logger ind inde i appen, og "Continue with Discord" åbner din standardbrowser på `/desktop-login`-siden, som sender en engangskode tilbage til appen over et `worldofclaudecraft://` deep link, som appen veksler til et normalt World of ClaudeCraft-sessionstoken.

```bash
npm run electron:dev          # Vite + Electron dev shell
npm run electron:pack         # local unpacked desktop app
npm run electron:build        # website-channel installers (self-updating)
npm run electron:build:steam  # SteamPipe depot layouts (in-app updater off)
```

Peg shell'en mod et andet API med `VITE_DESKTOP_API_ORIGIN`, for eksempel en lokal server eller en staging-host:

```bash
VITE_DESKTOP_API_ORIGIN=http://127.0.0.1:8787 npm run electron:dev
```

Tilsidesæt produktions-API-origin for staging-builds med `VITE_DESKTOP_API_ORIGIN=https://dev.worldofclaudecraft.com` (en værdi på BUILD-tidspunktet: den bages ind i bundlen og stemples ind i den pakkede app, og installerede builds ignorerer den som runtime-env-variabel). Steam er en distributionskanal (den samme Electron-bundle, uploadet via SteamPipe), og desktop-spillere kan linke en Steam-konto for at spejle de deeds de optjener over i Steam-achievements; selve login forbliver email og Discord. Den fulde release-runbook (signering, notarisering, udgivelse af en auto-opdatering, SteamPipe-depoter, server-deploy) er `docs/desktop-release.md`. iOS og Android leveres gennem Capacitor, med deres egen runbook i `docs/mobile-store-release.md`.

<a id="host-your-own-world-one-command"></a>

## Hav din egen verden (én kommando)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres and the game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

Til **remote hosting**, læg compose-stakken på en hvilken som helst VPS, sæt en rigtig `POSTGRES_PASSWORD` i miljøet, og sæt en TLS reverse proxy foran port 8787. Caddy gør dette til en håndfuld linjer; WebSockets bliver proxyet automatisk og klienten vælger automatisk `wss://` på https-sider. Auth-endpoints er rate-limited, passwords er scrypt-hashede, og login-sessioner udløber. Sæt aldrig `ALLOW_DEV_COMMANDS=1` i produktion, da det aktiverer hele `/dev`-snydesættet: level- og teleport-snydekoderne som testbotterne bruger, plus item-tildelinger, mob-spawns, instance-teleports, og den indbyggede dev-kommando-GUI. [DEPLOY.md](../../DEPLOY.md) er den fulde produktionsguide, inklusive den reverse proxy-konfiguration, der holder health- og metrics-endpoints væk fra den offentlige kant.

<a id="develop-online-with-hot-reload"></a>

### Udvikl online med hot reload

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api, /admin/api, and /ws)
```

Åbn http://localhost:5173, vælg **Play Online**, opret en konto, opret en karakter, og Enter World. Karaktervalgsskærmen viser de seneste release-nyheder i sit News & Updates-panel, med NEW-badges for alt du ikke har set endnu. Åbn en anden fane og log ind igen for at se hinanden i byen. `Enter` åbner chatten. Spillerwikien er den indbyggede Guide, serveret på http://localhost:5173/wiki og på `/wiki` i produktion; dens indhold bliver genereret fra det aktuelle spildata af `npm run wiki:content`.

Hvad der persisterer og hvordan serveren bevarer kontrollen:

- **Konti**: scrypt-hashede passwords og udløbende bearer-tokens.
- **Karakterer**: op til 10 per konto per realm; level, gear, bags, bankboks, quests, talenter, professioner, PvP- og deed-fremgang, position, og penge persisterer som JSONB i Postgres, gemt på en timer, ved logout, og ved server-nedlukning. Navne er unikke per realm og klassiske i stilen.
- **Serveren er autoritativ**: klienter streamer bevægelsesintention og kommandoer ved 20 Hz; serveren kører den ene fælles `Sim` og returnerer interesse-afgrænsede snapshots plus per-spiller-events. Hvert kampslag, loot drop, quest-credit, og vendor-transaktion afgøres på serversiden. Klienten er en renderer.

<a id="train-an-agent-headless-rl"></a>

## Træn en agent (headless RL)

Den samme deterministiske kerne kører som et [Gymnasium](https://gymnasium.farama.org/)-miljø, så en agent lærer mod det faktiske spil, ikke en genimplementering af det. Env-serveren (`headless/env_server.ts`) wrapper én `Sim` og taler newline-afgrænset JSON over stdio; Python-bindingsene i `python/` starter den som en subproces og eksponerer den sædvanlige `reset` / `step` / `close`-løkke.

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

- **Observation- og action-spaces er indholdsafledte.** Forespørg dem fra env'ens `info`-svar ved opstart i stedet for at hardcode dem; de vokser med spillet. Action-spacet er et `Discrete`, der dækker bevægelse, target, attack, det fulde ability-kit, interact, og eat/drink; observationen er en `Box`, der dækker selv, abilities, target, nærliggende mobs, den nærmeste interactable, og quest-fremgang.
- **Reward** er en vægtet sum af per-tick counter-deltaer (XP, skade tildelt og modtaget, kills, deaths, quest-fremgang, level-ups), justerbar per reset. Hvert `step` anvender én action og fremrykker fem sim-ticks som standard, så omtrent fire beslutninger per simuleret sekund.
- **Deterministisk af konstruktion.** Intet wall clock, ingen `Math.random`. Seed reset'et og episoden gentages nøjagtigt.

Protokollen og bindingsene er dokumenteret i `headless/CLAUDE.md` og `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft er web3-native omkring **$WOC**, vores community-token på Solana. Forbind en Solana-wallet, link den til din konto med en enkelt signatur (non-custodial, ingen transaktion at godkende), og din skrivebeskyttede $WOC-balance dukker op i HUD'en ved siden af et kosmetisk holder-tier-badge.

$WOC har også valgfri nytte i det levende spil:

- **WOC Store**: køb Claudium, den envejs kosmetiske valuta, med fiat, SOL, USDC, eller $WOC. $WOC-betalingssporet er rabatteret i forhold til de andre.
- **Season 1 Armory**: brug Claudium på samlinger af kosmetiske våben-skins. Butikskøb tilføjer hverken stats eller kampkraft.
- **Daily Rewards**: berettigede verificerede holdere kan optjene point gennem et dagligt spin og roterende opgaver, og derefter konkurrere om en andel af den daglige præmiepulje.

Intet af dette er nødvendigt for at spille. Wallet-linking er valgfrit og non-custodial, der er ingen pay-to-win, og hele spillet spiller fint uden nogensinde at forbinde en wallet.

**$WOC-kontraktadresse (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Mere om token'et på [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## En rundtur i verdenen

### De ni klasser

Hver klasse kører på klassiske MMO-mekanikker implementeret fra bunden og lærer rankede spells på tværs af level 1-20, med signatur-abilities som Low Blow, Early Grave, Skyfall, Urgent Prayer, og Ancestral Strike, der låses op i den sidste halvdel af klatringen.

- **Warrior**: rage, Iron Bellow, Onrush, Quaking Blow, Maiming Strike, Gaping Wounds (en bleed der rider med på dine slag), Widening Arc, Hobbling Cut, Blood Toll, Redhand (dodge proc).
- **Paladin**: Oathbrand udløst af Verdict, Mending Light, Steadfast Aura, Oath of Iron, Ward of Faith (absorb), Sundering Gavel (stun), Last Rite.
- **Hunter**: ranged auto-attack (8-35 yd med en klassisk dead zone), Gutting Strike, Harrier's Guise, Venom Barb, Fell Shot, Rattling Shot, Counterfang, Fettering Slash, og et tæmbart pet fra level 10.
- **Rogue**: energy og combo points, Wicked Slash, Dirt Nap, Craven Thrust (bagfra, dolk), Eye Jab, Ghostfoot, Cutthroat Tempo, Swift Heels.
- **Priest**: Smite, Whispered Prayer, Litany of Resolve, Dirge of Decay, Psalm of Warding (absorb), Lingering Grace (HoT), Mindfracture.
- **Shaman**: Arc Bolt, Stonebound Weapon (imbue), Mending Waters, Earthen Jolt, Thunder Ward (thorns), Cinder Jolt.
- **Mage**: Cinderbolt, Hoarfrost Mantle, Aether Insight, Rimelance, Waterbind, Cinderfall, Aether Darts (channeled), Bewitch, Icebind, en tilkaldt vand-elemental, og Chronomancy, en healing-spec bygget på tidsmagi.
- **Warlock**: Gloom Bolt, Fiendhide, Burning Pact, Blackrot, Hard Bargain, Hex of Anguish, Consume, og syv tilkaldelige dæmoner fra Emberkin til Wraithborn.
- **Druid**: Wildbolt, Wildmend, Wildward, Lunar Tempest, Wildbloom, Briarguard, Gripping Roots, og shapeshifting til Wolf Form ved 5, Bruin Form ved 8, og Moonwing Form ved 10.

Heals og buffs lander på party-medlemmer, healing kan critte, og absorb-shields opsuger skade før health. Brug point på tværs af **tre talent-specs per klasse** (Battlecraft/Bloodrush/Ironguard, Moongrove/Wildfang/Groveheart, og så videre); allokeringen er server-valideret og kan eksporteres som en build-streng.

### Dungeons

The Gravecaller-fortællingen løber gennem tre femspiller-elite-instances, en fjerde venter bag en moongate med sin egen drowned-lore, og en solo-krypt ligger til siden for opdagelsesrejsende.

- **The Hollow Crypt** (5 spillere) under the Fallen Chapel: parret elite-trash, Sexton Marrow-minibossen, og Morthen the Gravecaller med hans tilbagevendende shadow-AoE. Kryptdøren teleporterer dit party ind i en privat instance-kopi, der nulstilles når den er tømt for spillere.
- **The Sunken Bastion** (5 spillere, omkring level 13, sydøstlige Mirefen): Vael the Fogbinder tilkalder bølger af Drowned Thralls, efterhånden som kampen trækker ud.
- **Gravewyrm Sanctum** (5 spillere, level 20, under Thornpeak): tre kamre af elite-boneguard og scaleguard, Korgath the Bound, Grand Necromancer Velkhar, og Korzul the Gravewyrm, hvor epic-våben dropper.
- **The Drowned Temple** (5 spillere) gennem Glimmermere-moongate: en bleg, måne-violet instance, der fører til Choirmother Selthe og derefter Ysolei, Avatar of the Drowned Moon, hvis månetidevand og tilkaldte Moonspawn straffer en gruppe, der bliver stående.
- **The Abandoned Crypt** (solo) i Thornpeak: et stille keystone-og-dagbog-dyk for én, hvis spor åbner den kongelige dør til **Nythraxis, Scourge of Thornpeak**, en tispiller-raid-finale udkæmpet på tværs af tre soul wardstones.

Hver instance kører også på **Heroic**: fjender af højere level, skarpere mekanikker, og sit eget loot og sin egen vendor-valuta. Optakts-questkæderne kan klares solo, så historien er aldrig spærret bag det at finde en gruppe. Vores automatiserede fembot-raid (warrior, paladin, priest, mage, hunter med focus-fire og healer-AI) klarer the Hollow Crypt på omkring fem minutter (`node scripts/crypt_raid.mjs`, kræver `ALLOW_DEV_COMMANDS=1`).

### Delves

Delves er en separat, skalerbar mode for små grupper på én eller to spillere, genopbygget fra randomiserede kamre i hvert gennemløb og med en låst relikvie-kiste til sidst, der åbnes gennem et dirke-minispil frem for et loot roll. **The Collapsed Reliquary** (level 7 og op) ender ved Deacon Varric, med en AI-ledsager, Tessa, der kæmper ved din side, hvis du går solo. **The Drowned Litany** (level 12 og op) følger sporet ind i en oversvømmet helligdom i udkanten af Mirefen Marsh. En delve-tavle sætter tier'en: Heroic hæver fjendernes levels og tilføjer et tilfældigt affix for rigere belønninger.

### Ranket PvP (the Ashen Coliseum)

Tryk `G` eller arena-knappen for at sætte i kø. Matchmaking teleporterer kæmpere ind i en privat grube, en kort nedtælling healer og nulstiller alle for en fair start, og kampen slutter når en side giver op. Ingen dør, og du vender tilbage nøjagtigt hvor du satte i kø. Protect Yumi udkæmpes i sin egen labyrint frem for i Coliseum-gruben.

- **1v1- og 2v2-rankede stiger**, hver med en persistent Elo-agtig rating og en all-time leaderboard.
- **2v2 Fiesta**, en livligere party-mode hvor hold kapløber mod et takedown-mål, mens augment-pickups dropper power og en lukkende ring tvinger kampen sammen.
- **Protect Yumi**, en uranket 3v3- og 5v5-objective-mode udkæmpet i en labyrint: hvert hold vogter en katte-familiar og forsøger samtidig at nedlægge modstanderens, så eskorter og picks betyder mere end rene kills.

Rankede sejre og Fiesta-takedowns betaler **Honor**, som quartermasteren i byen bytter til et sæt Warfare-gear. Warfare er en PvP-kun stat, så sættet vinder dueller uden nogensinde at overgå dungeon-loot fra samme tier i PvE.

### At spille sammen

- **Dungeon Finder**: åbn den med `Shift+I` for at browse dungeons og raids, inspicere bosser og loot, gå i en automatisk tank/healer/DPS-rollekø, eller oprette et premade-opslag. Grupper dannet i Finder rejser stadig til indgangen sammen.
- **Parties** op til 5, omdannet til et 10-spiller-raid af to grupper når I er fyldt op: højreklik på en spiller og Invite to Party. Medlemmer deler tap rights og quest-credit, splitter XP med gruppebonusserne fra den klassiske æra, og dukker op som blips på minimappet. `/p` for party-chat, `/roll` for at afgøre loot.
- **Handel**: højreklik og Trade. Begge sider lægger items og penge frem, begge skal acceptere, og byttet er atomisk og server-valideret. Quest-items kan ikke handles, og at gå fra hinanden annullerer.
- **Dueller**: højreklik og Challenge to a Duel. En 3-sekunders nedtælling, så kæmp indtil en side rammer 1 hp; vinderen annonceres zone-bredt og at løbe 60 yards væk giver fortabt.
- **Tap rights og away-status**: den første spiller, der skader en mob, ejer dens loot, XP, og quest-credit; `/afk` og `/dnd` markerer dig som away med et auto-svar på hvisken.

### Verden og systemer

- **Professioner** (`Shift+P`): fire gathering-fag (minedrift, skovhugst, urtesamling, fiskeri) fodrer ti crafts, fra madlavning og alkymi til våbensmedning, smykkekunst, og fortryllelse. Gathering-værktøj kommer i tiers, der afgør hvilke nodes du kan arbejde på, crafting foregår ved workstations i byerne med en chance for masterwork-kvalitet, der bærer dit mestermærke, og der er et arketypesystem at opdage, efterhånden som du specialiserer dig.
- **The World Market**: et spillerdrevet auktionshus for gear, materialer, og forbrugsvarer, som kan gennemses fra hub-byerne.
- **Ravenpost-post**: send items og mønter til andre karakterer, med vedhæftninger opbevaret sikkert indtil de bliver hentet.
- **Guilds**: charters, rosters, ranks, og guild chat.
- **The Guide**: en søgbar wiki på selve sitet på `/wiki`, der dækker klasser, skabninger, zoner, og deeds, genereret direkte fra levende spilindhold, så den ikke kan drive fra den verden den dokumenterer.
- **The Vale Cup og Card Duel**: boarball på Sowfield-stadionet syd for Eastbrook, i formater fra 1v1 til 5v5, og et hurtigt kortspil mand mod mand afholdt af the Card Master i byen.
- **Daily Rewards**: verificerede $WOC-holdere kan optjene leaderboard-point fra et dagligt spin og roterende opgaver, med automatiske udbetalinger fra den daglige præmiepulje.
- **WOC Store og Season 1 Armory**: køb Claudium med fiat, SOL, USDC, eller $WOC, og brug det derefter på rent kosmetiske våben-skins.
- **Spise og drikke**: sæt dig for at genoprette, afbrudt af skade eller at rejse sig, og ja, du kan spise og drikke på én gang.
- **Vendors** der køber mad og vand og sælger ærligt hvidt gear, med mønter vist i guld, sølv, og kobber.
- **En personlig bank** (the Gilded Strongbox): bursarer i hver hub-by holder en boks per karakter, fra 24 slots op til 96 med udvidelser købt for mønter, plus bonus-slots optjent online for en verificeret email, linkede konti, og henvisninger.
- **The Book of Deeds**: en achievement-journal (som standard `Shift+Z`) over quests, kills, clears, og små fornøjelser, der betaler kosmetiske titler ud, som du kan bære på dit nameplate, i chatten, og på tavlerne, plus en HUD-tracker til de deeds du jagter, Chronicles per zone ført af Chronicler-NPC'er, og en all-time Renown-leaderboard; den offentlige liste ligger på `/wiki/deeds`.
- **Mob-AI**: vandren, proximity-aggro efter level-forskel, social pulls, jagt, leash og reset, lig-loot, og respawns, med en sjælden spawn (Old Greyjaw) på en lang timer.
- **Fiskepladser** med deres egne loot tables og sjældne fangster.
- **Kosmetiske skins** rullet ved uncommon, rare, og epic rarity, udelukkende for udseendet.
- **Død og genopretning**: frigiv din ånd til kirkegården, tag faldskade, og sæt farten ned mens du svømmer.
- **Biome-vejr**: klart i the Vale, regn i the Marsh, sne på the Peaks, krydsfadende efterhånden som du bevæger dig mellem zoner.

### Kontroller (klassisk layout)

| Input | Handling |
|---|---|
| `W` / `S` | løb / baglæns. `A`/`D` drej (strafe med højre museknap holdt), `Q`/`E` strafe |
| højre-træk / venstre-træk | mouselook / orbit-kamera. Hjul zoomer, `Space` hopper |
| `Tab` | skift mellem nærmeste fjender. venstreklik for at targette, højreklik for at angribe, loote, eller tale |
| `1`-`9`, `0`, `-`, `=` | action bar |
| `F` | interact (loot et lig, saml et objekt op, tal) |
| `C` `P` `L` `M` `B` `N` `T` | karakter, spellbook, quest log, world map, bags, talenter, crafting |
| `G` `O` `K` `I` `Y` `Shift+I` `Shift+P` `Shift+Z` | arena, venner og guild, leaderboard, kalender, Vale Cup, Dungeon Finder, professioner, deeds |
| `Z` / `X` | stik våbnene i skeden eller træk dem, emote-hjul |
| `V` / `R` / `Esc` | nameplates, autorun, luk det øverste vindue (eller åbn spilmenuen) |

Hver binding kan remappes i keybinds-panelet. Touch-kontroller (en bevægelses-joystick, kamera-træk, og action-knapper på skærmen) kommer op automatisk på mobil.

## Arkitektur (én sim, tre hosts)

Tre ideer holder projektet sammen:

- **Én sim, tre hosts.** Den samme `src/sim/`-kode kører den offline browser-verden, online-serveren, og RL-miljøet. Adfærden skal være identisk overalt, og testene findes for at holde det sådan.
- **`IWorld` er den eneste søm.** `IWorld` er defineret som facet-grænseflader per domæne under `src/world_api/`, aggregeret af `src/world_api.ts`. Den offline `Sim` opfylder den strukturelt og den online `ClientWorld` implementerer den ved at spejle server-snapshots. Rendereren og HUD'en taler kun til `IWorld`, aldrig til en konkret verden, så en ny feature udvider først den tilsvarende facet og derefter begge verdener.
- **Serveren er autoritativ.** Klienter sender intention; serveren beslutter udfald. Klienten afgør aldrig kamp, loot, eller økonomi på egen hånd.

Sim'en er et fast 20 Hz-tick (`DT = 1/20`), al randomness flyder gennem én seedet `Rng`, og `src/sim/` bærer nul DOM-, browser-, eller Three.js-imports. Det er det, der lader den samme kode bundle ind i en Node env-server, en autoritativ game loop, og en browserfane uden at ændre en linje.

### Projektlayout

| Sti | Hvad det er |
|---|---|
| `src/sim/` | Deterministisk spilkerne, kilden til sandhed. Ingen DOM- eller Three-afhængigheder. |
| `src/sim/content/` | Data som kode: de ni klasser, abilities, zoner, dungeons, delves, items, opskrifter, enchants, talenter, professioner, deeds. |
| `src/world_api.ts` + `src/world_api/` | `IWorld`, den søm rendereren og HUD'en afhænger af: én facet-grænseflade per domæne. |
| `src/` (resten) | Three.js-renderer, HUD og styles, input og lyd, online-spejling, og admin-, guide-, og editor-SPA'erne. |
| `server/` | Autoritativ server: HTTP og WS, world loop, Postgres, auth, social, moderation. |
| `server/http/` | REST-request-pipelinen: tabel-router, middleware, og rutedefinitioner per domæne. |
| `headless/` + `python/` | RL env-server (`env_server.ts`) og Python Gym-bindings. |
| `bot/` | Discord-bot (roller, relay, aktivitetsfeed). |
| `electron/`, `android/`, `ios/` | Desktop-shell (Steam) og native mobil-shells. |
| `tests/` | Vitest-suite. |
| `scripts/` | Værktøj til build, assets, i18n, SFX, screenshots, og browser-E2E. |
| `deploy/` · `mediawiki/` | Produktions-assets til første opstart og containeren til spillerwikien. |
| `public/` · `docs/` | Statiske assets (deployet ordret til sitet) og designdokumenter. |

Intet af dette hviler på tillid: `tests/architecture.test.ts` scanner hver eneste sim-fil for
et forbudt import, en DOM-global, eller et løsrevet ur- eller `Math.random`-kald, og
`tests/world_api_parity.test.ts` fastpinner sømmen, så de to verdener ikke kan drive fra hinanden.

De fleste mapper bærer deres egen `CLAUDE.md` med lokale konventioner, og det fulde sæt af
projekt-invarianter ligger i roden [`CLAUDE.md`](../../CLAUDE.md). Agent-bidragydere starter
der og samler derefter deres runtimes indgangspunkt op: [`AGENTS.md`](../../AGENTS.md) plus
[Codex-operatørguiden](../codex.md) til Codex, [`GEMINI.md`](../../GEMINI.md) til Gemini. De
fører alle ind i den samme kanoniske arkitektur.

## Bygget som klassikerne

Kamp, leveling, og threat kører alle på autentiske regler fra den klassiske æra: rage og energy, hit- og dodge-tabeller, armor-mitigation, den rigtige XP-kurve, swing timers, og den globale cooldown. Det føles som du husker det, snarere end at approksimere det. De nøjagtige tal ligger i `src/sim/`, hvis du vil læse dem.

Verdenen er skrevet i kode frem for i en 3D-editor, og det er det, der holder den lille,
deterministisk, og let at forke:

- Terræn, vand, vejr, himmel, bylayouts, realtidsskygger, og kampeffekter bliver genereret ved kørselstidspunktet ud fra sim'ens egne data.
- De modeller der rent faktisk leveres, er bygget på samme måde: procedurale fabrikker under `scripts/assets/` eksporterer deterministiske GLB'er gennem projektets image-to-GLB-pipeline, side om side med et kurateret bibliotek af CC0-modelkits. Riggede skabnings- og karakterfamilier bærer fulde walk-, attack-, cast-, sit-, og death-animationer.
- Ikoner er en lagdelt maler, der komponerer kunst til alt uden en leveret fil, så intet mangler nogensinde et ikon, med kurateret malet kunst lagt ovenpå til abilities, items, og deeds.
- En komplet klassisk HUD (unit frames, action bars, tooltips, quest log, world map, minimap, floating combat text, the Book of Deeds), samplede rumlige lydeffekter og interface-lyde, og et soundtrack komponeret proceduralt i repoet og leveret som streamede remastere, der krydsfader mellem zoner, byer, dungeons, og kamp.

Hvert leveret asset og dets licens er noteret i [CREDITS.md](../../CREDITS.md), og medfølgende
tredjeparts-afhængigheder bærer deres noter i [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Udvikling

Ud over spilklienten producerer builden operatør-dashboardet, world-editoren på
`/editor`, og den offentlige Guide på `/wiki`, alle serveret fra den samme dev-server.

Hver FFmpeg-sti som gaten og lydtestene bruger, resolver de medfølgende npm-pakker
`ffmpeg-static`/`ffprobe-static`, så et normalt bidrag kræver ingen FFmpeg-installation på
systemet. De stier der måler conformance (`npm run sfx:check`, lydtestene, Studioets
export-validering) binder direkte til de statiske binærfiler, uden `PATH` som fallback:
kør `npm ci` igen, hvis en installation der sprang scripts over efterlod dem manglende.
Studioets afspilnings- og encode-spawns og preflight'en i `npm run gate` resolver via
`scripts/sfx/ffmpeg_paths.mjs`, som til gengæld falder tilbage på `PATH`. Nogle fritstående
lydgenerator-scripts (for eksempel `scripts/gen_ui_sfx.mjs`) bruger stadig `PATH`-`ffmpeg` som standard.

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

Logik- og unit-tests bruger Vitest. Mens du itererer, kør en enkelt fil: `npx vitest run tests/sim.test.ts`. Ændringer i grænsefladen har også en opt-in suite i en rigtig browser, der dækker tilgængelighed, tastaturnavigation, og touch-mål: `npm run test:browser`. Screenshot- og smoke-scriptsene driver rigtige browsere via `puppeteer-core` og kræver at `npm run dev` kører; scriptsene på wire-niveau (`mp_integration.mjs`, `social_e2e.mjs`, `crypt_raid.mjs`) taler direkte med serveren og kræver i stedet `npm run server`. Browser-agenter kan drive bevægelse gennem `window.__game.controller` i stedet for at simulere holdte taster, for eksempel `controller.move({ forward: true }, facingRadians)` eller kompakte flags som `{ f: 1, sr: 1 }`.

Tjekkene kører i lag, beskrevet i [docs/qa-gate.md](../qa-gate.md): peg dit klon mod de
delte hooks med `git config core.hooksPath .githooks`, så kører et hurtigt minimum, før
noget forlader din maskine.

For server-kommandoerne se [Udvikl online](#develop-online-with-hot-reload) ovenfor,
[CONTRIBUTING.md](CONTRIBUTING.da_DK.md) for bidrags-workflowet,
[SFX Studio-tutorialen](../sfx-studio-tutorial.md) for lyd-forfatning og
artefakt-eksport, [DEPLOY.md](../../DEPLOY.md) for produktion, og
[CREDITS.md](../../CREDITS.md) for asset-licenser.

## Lokalisering

Hver spiller-synlig streng resolver gennem `t()`, og spillet leveres på **22 sprog** (engelsk, to spanske, to franske, engelsk Canada, italiensk, tysk, forenklet og traditionel kinesisk, koreansk, japansk, brasiliansk portugisisk, russisk, tjekkisk, hollandsk, polsk, indonesisk, tyrkisk, svensk, vietnamesisk, og dansk). Sim'en og serveren forbliver sprog-agnostiske: de udsender stabile nøgler eller engelsk, som klienten re-lokaliserer ved grænsen, hvilket holder determinismen intakt. Bidragydere tilføjer kun engelsk; vedligeholderen batch-udfylder de andre sprog før hver udgivelse. Workflowet er dokumenteret i `docs/i18n-scaling/translation-workflow.md`.

## Bidrag

Bidrag af enhver art er velkomne: kode, oversættelser, fejlrapporter, og dokumentation. Start med [CONTRIBUTING.md](CONTRIBUTING.da_DK.md) for opsætning, læs [Code of Conduct](../../CODE_OF_CONDUCT.md), og tjek [SECURITY.md](../../SECURITY.md) før du rapporterer en sårbarhed. Ny her? Kig efter issues mærket [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), åbn et [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose), eller sig hej på [Discord](https://discord.com/invite/worldofclaudecraft).

Den aktive udvikling foregår på den nyeste `release/vX.Y.Z`-branch. Slå den op i stedet for at antage, og forgren så fra den og ret din pull request mod den. Forgren aldrig fra `main` og ret aldrig mod den, da den kun modtager en release-branch når den version udkommer. [CONTRIBUTING.md](CONTRIBUTING.da_DK.md) indeholder den ene kommandolinje, der finder den aktuelle.

## Licens

**Koden er [MIT-licenseret](../../LICENSE), så fork den, remix den, og host din egen verden.** Det er hele pointen, og intet andet på denne side eller på vores hjemmeside tager det tilbage.

Tre ting er licenseret separat, så det er tredive sekunder værd at vide hvad der er hvad:

| Hvad | Licens | Må du videredistribuere det? |
|---|---|---|
| **Kildekode**, altså det hele undtagen de medieassets der er skåret ud nedenfor | [MIT](../../LICENSE) | Ja. Også kommercielt. |
| **Medieassets**: modeller, teksturer, HDRIs, ikoner, lyde, fonte (for det meste under `public/`) | Per asset, noteret i [CREDITS.md](../../CREDITS.md) | For det meste ja (de fleste er CC0). Nogle er ikke, se nedenfor. |
| **Navn og branding**: "World of ClaudeCraft", "Levy Street", logoerne | Ikke licenseret | Nej. |

**Fork den og host din egen verden. Det virker, og assets står ikke i vejen for dig.** Det meste af det du ser er CC0 public domain (KayKit, Quaternius, Kenney, ambientCG, Poly Haven), og vores egne genererede props, skabninger, baggrunde, og interface-lyde leveres med projektet, så et fork kører ud af boksen. Du kan bare ikke løfte dem ud og sælge dem som selvstændig kunst.

Hvad du ville skulle fjerne eller erstatte før videredistribution:

- **CraftPix-klasseability-ikonerne** under `public/ui/skills/` blev købt af Levy Street og **må ikke videredistribueres**, så køb din egen licens hvis du vil levere dem;
- **@jamiecypher-lydeffekterne** er CC BY-NC 4.0, så del dem ikke-kommercielt med kreditering, men den kommercielle tilladelse gælder kun dette projekt;
- **butiks- og prestige-kunsten** (Season 1 Armory, Claudium-sættet, professions-kunstsættet, Book of Deeds-ikonerne, elite-drageemblemet) er bestilt kommerciel kunst og **rettighederne er forbeholdt**;
- **tredjeparts-varemærkerne** (Twitch, X, Kick, YouTube, Discord, Solana, USDC) er deres ejeres varemærker og er ikke vores at licensere videre;
- en håndfuld **ikoner og optagelser brugt med tilladelse** kræver tilladelse for at blive givet videre.

[CREDITS.md](../../CREDITS.md) er den autoritative liste, med en kolonne om videredistribution per asset. Hvor et asset er opført der, gælder den licens over projektets MIT-licens. Det register er stadig ved at blive færdiggjort, så et medieasset der mangler i det, er uregistreret snarere end frit: spørg før du regner med det. For kildekode er det omvendt, og alt der ikke er skåret ud, er MIT.

Vores [Servicevilkår](https://worldofclaudecraft.com/terms) dækker det hostede spil, som vi kører på worldofclaudecraft.com: konti, adfærd, virtuelle genstande. De begrænser ikke de rettigheder, MIT-licensen giver dig i denne kildekode.
