<div align="center">

# World of ClaudeCraft

**Plň questy, spoj se do skupiny a raiduj ručně stavěný svět, zdarma ve svém prohlížeči. Open source, web3 a online právě teď.**

**Oficiální web: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.31.0-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.cs_CZ.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · **Čeština** · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Hraj hned](https://worldofclaudecraft.com/) · [Postav si vlastní svět](#host-your-own-world-one-command) · [Vytrénuj agenta](#train-an-agent-headless-rl) · [Web3](#web3) · [Přispívání](CONTRIBUTING.cs_CZ.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![Úvodní obrazovka World of ClaudeCraft](../../docs/screenshots/title-screen.jpg)

</div>

## Co to je

World of ClaudeCraft je kompletní MMO klasické éry, které si můžeš zahrát hned teď v prohlížeči, jedním příkazem hostovat sám a dokonce na něm trénovat AI agenty, aby ho hráli. Je zdarma, open source a běží živě na [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Jeden sdílený svět běží na třech místech, všechna z téhož herního jádra:

- **autoritativní multiplayerový server**, živý svět, který hraješ na worldofclaudecraft.com, kde účty uložené v Postgresu sdílejí jednu trvalou říši,
- **offline svět v prohlížeči**, lokální Sim pro jednoho hráče, který dostaneš z vývojového serveru, užitečný pro vývoj a pro přečtení herního jádra od začátku do konce,
- **bezhlavé RL prostředí**, kde Python řídí skutečnou hru přes rozhraní Gym.

Stejný seed, stejný svět, všude. Velká část toho, co vidíš, se pořád kreslí z kódu za běhu, a zbytek je kurátorovaná sada assetů, která se dodává s projektem, takže fork běží rovnou po vybalení.

## Hlavní přednosti

- **Devět klasických tříd**, každá s plnou sadou schopností ve stylu klasické éry, která s úrovněmi získává rangy, plus kompletní **systém talentů** (tři specializace na třídu, 27 specializací celkem).
- **Tři zóny otevřeného světa** od úrovně 1 do 20, více než 90 questů a jedna propojená příběhová linka o spiknutí Gravecaller.
- **Pět instancovaných dungeonů**, čtyři z nich pětičlenné elitní raidy a jedna sólo krypta, s elitním škálováním, AoE mechanikami bossů, lootem podle archetypů tříd, který se sbírá do tier setů, a s obtížností **Heroic** a bohatšími odměnami, plus **world bossy** v otevřeném světě a desetičlenné raidové finále.
- **Dva škálovatelné delves**, režim pro malou skupinu jednoho nebo dvou hráčů plus AI společník, přestavěné z náhodných komnat při každém průchodu, v úrovních Normal a Heroic.
- **Hodnocené PvP** na dvou arénových mapách: žebříčky 1v1 a 2v2, živější režim 2v2 Fiesta a **Protect Yumi**, objektivový režim 3v3 a 5v5. Hodnocené hraní platí Honor, za který se kupuje sada výbavy jen pro PvP, jež v PvE nikdy nepřeroste loot z dungeonů.
- **The Vale Cup**, boarballová liga hraná na vlastním stadionu jižně od Eastbrooku, a **Card Duel**, rychlá karetní hra jeden na jednoho pořádaná ve městě.
- **Book of Deeds**: deník úspěchů plný kosmetických titulů, rámečků odznaků a Renown, s Kronikami pro každou zónu, které vedou NPC Chronicleři, a s celoživotním žebříčkem.
- **Hluboká ekonomika profesí**: čtyři sběrné profese zásobují deset řemesel, od vaření a alchymie po klenotnictví, zbrojířství a enchanting, s odstupňovanými nástroji, městskými pracovišti, mistrovskou kvalitou a zakázkami, a to vše napájí hráči řízený **World Market** a poštovní službu **Ravenpost**.
- **Skutečný multiplayer**: party a raidy, guildy, obchodování, souboje, tap práva, XP dělené ve skupině, šeptání, stav nepřítomnosti a **Dungeon Finder** s frontami podle rolí a inzeráty na předem složené skupiny.
- **Vytvořeno v kódu, ne ve 3D editoru**: terén, voda, počasí, rozvržení měst, stíny v reálném čase a efekty vznikají za běhu a modely, které se dodávají, staví procedurální továrny a kurátorovaná knihovna assetů, nikoli ruční sochání.
- **Lokalizováno do 22 jazyků** deterministickou pipeline, ve které sim emituje klíče.
- **Doprovodná wiki na `/wiki`**, generovaná přímo z živého herního obsahu, takže se nemůže rozejít se světem, který popisuje.
- **Nativní aplikace na každé platformě**: podepsané desktopové instalátory pro Windows, Linux a macOS s automatickými aktualizacemi a volitelným zrcadlením achievementů na Steamu, plus buildy pro iOS a Android, všechny sdílejí prohlížečového klienta a tentýž online svět.
- **Škáluje se podle stroje, který máš**: grafické předvolby a automatický regulátor snímkové frekvence vyměňují vizuální bohatost za plynulost a drží se pravidla férovosti, které jim nikdy nedovolí skrýt něco, na co hráč reaguje.
- **Bezhlavé RL prostředí** s Gymnasium bindingy, tvarováním odměny a benchmarkovým režimem.
- **$WOC utilita, zcela volitelná**: propoj Solana peněženku pro odznak držitele, Daily Rewards a zvýhodněnou platební možnost v kosmetickém obchodě. Hra zůstává zdarma ke hraní a nekustodiální.
- **Season 1 Armory**: sbírej kosmetické skiny zbraní přes WOC Store za Claudium nakoupené za fiat, SOL, USDC nebo $WOC. Kosmetika nikdy neposkytuje bojovou sílu.

## Snímky obrazovky

![Náměstí v Eastbrooku, táborák a zadavatelé questů](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Soumrak u táboráku v Eastbrooku](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Soumrak u táboráku v Eastbrooku* | ![Elitní pully v the Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Pochodněmi osvětlené elitní pully v the Hollow Crypt* |
| ![Neklidní mrtví u zřícené kaple](../../docs/screenshots/restless-dead.jpg)<br>*Neklidní mrtví u zřícené kaple* | ![Rvačka s Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*V přesile nepřátel v banditském táboře* |
| ![Old Greyjaw dostižen na severní cestě](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, vzácný spawn, dostižen na severní cestě* | ![Rozhraní obchodníka a tašek](../../docs/screenshots/vendor-and-bags.jpg)<br>*Vystrojení u Trader Wilkes, s otevřeným obchodníkem a taškami* |
| ![Měsíční brána na břehu Glimmermere](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Utopenci vylézají u měsíční brány v Glimmermere* | ![Ysolei na oltáři the Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Lunar Tempest a oltář the Drowned Temple* |

Počasí je řízené biomy a existuje jen ve vykreslování, takže se nikdy nedotkne deterministické simu:

| | | |
|:---:|:---:|:---:|
| ![Jasná obloha nad Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Jasno nad Vale* | ![Déšť nad Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Déšť nad Mirefen Marsh* | ![Sníh na Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Sníh na Thornpeak Heights* |

## Zahraj si

Hraj v prohlížeči na [worldofclaudecraft.com](https://worldofclaudecraft.com/), nebo si nainstaluj nativní aplikaci pro Windows, Linux, macOS, iOS či Android. Každý klient se připojuje k témuž online světu.

### Online, s ostatními hráči

Vytvoř si účet, vytvoř postavu a vstup do živého světa. Pokud chceš stejný stack klient/server provozovat sám, podívej se níže na [Postav si vlastní svět](#host-your-own-world-one-command).

### Offline, na vývojovém serveru

Offline režim je lokální svět pro jednoho hráče bez účtu a bez serverové autority, takže se dodává jen ve vývojových buildech. Spusť vývojový server a objeví se ve výběru režimu:

```bash
npm install
npm run dev        # then open http://localhost:5173 and choose Play Offline
```

Pojmenuj svou postavu, vyber si kteroukoli z devíti tříd a začínáš v **Eastbrook Vale** (úrovně 1-7), tržním městečku obklopeném uzly: vlčí revíry na severu, kančí louky na východě, les Sableweb na západě, Mirror Lake na severozápadě, měděný důl zamořený hrabavci na jihozápadě a zřícená kaple neklidných mrtvých na severovýchodě, s Gorrakovým banditským táborem na jihovýchodě. Severní cesta stoupá horským průsmykem do **Mirefen Marsh** (6-13, uzel Fenbridge) a dál nahoru do **Thornpeak Heights** (13-20, uzel Highwatch). Seed světa je pevně dán v `src/main.ts`, takže je to při každé návštěvě stejné místo.

### Desktopové aplikace pro Windows, Linux a macOS

World of ClaudeCraft se dodává jako plnohodnotná desktopová aplikace pro všechny tři hlavní desktopové platformy: podepsané instalátory pro Windows, balíčky AppImage a deb pro Linux a podepsané a notarizované univerzální buildy pro macOS. Používají stejného herního klienta a stejný online svět jako prohlížeč, s nativním balením a automatickými aktualizacemi.

Online přihlášení běží jen přes Discord a e-mail, přesně jako na webu: e-mail a heslo tě přihlásí přímo v aplikaci a "Continue with Discord" otevře tvůj výchozí prohlížeč na stránce `/desktop-login`, která předá aplikaci jednorázový kód přes hluboký odkaz `worldofclaudecraft://`, jejž aplikace vymění za běžný session token World of ClaudeCraft.

```bash
npm run electron:dev          # Vite + Electron dev shell
npm run electron:pack         # local unpacked desktop app
npm run electron:build        # website-channel installers (self-updating)
npm run electron:build:steam  # SteamPipe depot layouts (in-app updater off)
```

Nasměruj shell na jiné API pomocí `VITE_DESKTOP_API_ORIGIN`, například na lokální server nebo na staging host:

```bash
VITE_DESKTOP_API_ORIGIN=http://127.0.0.1:8787 npm run electron:dev
```

Produkční API origin pro staging buildy přepíšeš pomocí `VITE_DESKTOP_API_ORIGIN=https://dev.worldofclaudecraft.com` (je to hodnota z doby BUILDU: zapeče se do bundlu a otiskne se do zabalené aplikace, a nainstalované buildy ji jako runtime proměnnou prostředí ignorují). Steam je distribuční kanál (tentýž Electron bundle, nahraný přes SteamPipe) a desktopoví hráči si mohou propojit účet na Steamu a zrcadlit do Steam achievementů deeds, které si vyslouží; samotné přihlášení zůstává e-mail a Discord. Kompletní release runbook (podepisování, notarizace, publikování automatické aktualizace, SteamPipe depoty, nasazení serveru) je `docs/desktop-release.md`. iOS a Android se dodávají přes Capacitor a mají vlastní runbook v `docs/mobile-store-release.md`.

<a id="host-your-own-world-one-command"></a>

## Postav si vlastní svět (jedním příkazem)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres and the game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

Pro **vzdálený hosting** postav compose stack na libovolném VPS, nastav v prostředí skutečné `POSTGRES_PASSWORD` a před port 8787 postav TLS reverzní proxy. V Caddy to zvládneš na pár řádcích; WebSockety se proxují automaticky a klient si na https stránkách sám vybere `wss://`. Autentizační endpointy mají limit počtu požadavků, hesla se hashují přes scrypt a přihlašovací session vyprší. Nikdy nenastavuj `ALLOW_DEV_COMMANDS=1` v produkci, protože to zapne celou sadu cheatů `/dev`: cheaty na úroveň a teleport, které používají testovací boti, plus přidělování předmětů, spawnování mobů, teleporty do instancí a herní GUI pro dev příkazy. [DEPLOY.md](../../DEPLOY.md) je kompletní produkční průvodce včetně konfigurace reverzní proxy, která drží health a metrics endpointy mimo veřejný okraj sítě.

<a id="develop-online-with-hot-reload"></a>

### Vývoj online s hot reloadem

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api, /admin/api, and /ws)
```

Otevři http://localhost:5173, zvol **Play Online**, vytvoř si účet, vytvoř postavu a Enter World. Obrazovka výběru postavy ukazuje nejnovější release novinky v panelu News & Updates, s odznaky NEW u všeho, co jsi ještě neviděl. Otevři druhou záložku a přihlas se znovu, abyste se ve městě viděli navzájem. `Enter` otevírá chat. Hráčská wiki je Guide přímo v repozitáři, servírovaný na http://localhost:5173/wiki a na `/wiki` v produkci; jeho obsah generuje z aktuálních herních dat `npm run wiki:content`.

Co přetrvává a jak si server drží kontrolu:

- **Účty**: hesla hashovaná přes scrypt a bearer tokeny s expirací.
- **Postavy**: až 10 na účet a říši; úroveň, výbava, tašky, bankovní trezor, questy, talenty, profese, PvP a postup v deeds, pozice a peníze přetrvávají jako JSONB v Postgresu, ukládají se na časovač, při odhlášení a při vypnutí serveru. Jména jsou unikátní v rámci říše a klasická stylem.
- **Server je autoritativní**: klienti streamují pohybový záměr a příkazy při 20 Hz; server běží jednu sdílenou `Sim` a vrací snímky omezené zájmovou oblastí plus události pro jednotlivé hráče. Každý hod v boji, drop lootu, započtení questu a transakce u obchodníka se vyhodnocuje na serveru. Klient je renderer.

<a id="train-an-agent-headless-rl"></a>

## Vytrénuj agenta (bezhlavé RL)

Totéž deterministické jádro běží jako prostředí [Gymnasium](https://gymnasium.farama.org/), takže se agent učí proti skutečné hře, ne proti její napodobenině. Env server (`headless/env_server.ts`) obaluje jednu `Sim` a mluví JSONem odděleným novými řádky přes stdio; Python bindingy v `python/` ho spouštějí jako podproces a vystavují obvyklou smyčku `reset` / `step` / `close`.

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

- **Prostory pozorování a akcí jsou odvozené z obsahu.** Zjisti si je při startu z odpovědi `info` daného prostředí, místo abys je zadrátoval napevno; rostou spolu se hrou. Prostor akcí je `Discrete` pokrývající pohyb, cíl, útok, celou sadu schopností, interakci a jídlo a pití; pozorování je `Box` pokrývající sebe sama, schopnosti, cíl, okolní moby, nejbližší interagovatelný objekt a postup v questech.
- **Odměna** je vážený součet rozdílů čítačů za tick (XP, udělené a utržené poškození, killy, smrti, postup v questech, postupy na úroveň), laditelný při každém resetu. Každý `step` aplikuje jednu akci a ve výchozím stavu posune pět simulačních ticků, tedy zhruba čtyři rozhodnutí za simulovanou sekundu.
- **Deterministické z podstaty.** Žádné nástěnné hodiny, žádný `Math.random`. Naseeduj reset a epizoda se přehraje přesně stejně.

Protokol a bindingy jsou zdokumentované v `headless/CLAUDE.md` a `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft je web3 nativní kolem **$WOC**, našeho komunitního tokenu na Solaně. Připoj Solana peněženku, propoj ji s účtem jediným podpisem (nekustodiálně, žádná transakce ke schválení) a tvůj $WOC zůstatek pro čtení se objeví v HUD vedle kosmetického odznaku úrovně držitele.

$WOC má také volitelnou utilitu v živé hře:

- **WOC Store**: kup Claudium, jednosměrnou kosmetickou měnu, za fiat, SOL, USDC nebo $WOC. Platební cesta přes $WOC je oproti ostatním zvýhodněná.
- **Season 1 Armory**: utrať Claudium za kolekce kosmetických skinů zbraní. Nákupy v obchodě nepřidávají staty ani bojovou sílu.
- **Daily Rewards**: způsobilí ověření držitelé mohou získávat body denním roztočením a rotujícími úkoly a pak soutěžit o podíl z denního výherního fondu.

Nic z toho není ke hraní potřeba. Propojení peněženky je volitelné a nekustodiální, není tu žádné pay-to-win a celá hra si v pohodě vystačí bez toho, abys kdy peněženku připojil.

**$WOC kontraktní adresa (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Více o tokenu na [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Prohlídka světa

### Devět tříd

Každá třída běží na MMO mechanikách klasické éry implementovaných od základů a učí se rangovaná kouzla napříč úrovněmi 1-20, přičemž charakteristické schopnosti jako Low Blow, Early Grave, Skyfall, Urgent Prayer a Ancestral Strike se odemykají v druhé polovině stoupání.

- **Warrior**: vztek, Iron Bellow, Onrush, Quaking Blow, Maiming Strike, Gaping Wounds (krvácení, které jede na tvých úderech), Widening Arc, Hobbling Cut, Blood Toll, Redhand (proc po úhybu).
- **Paladin**: Oathbrand rozpoutaný skrze Verdict, Mending Light, Steadfast Aura, Oath of Iron, Ward of Faith (pohlcení), Sundering Gavel (omráčení), Last Rite.
- **Hunter**: automatický útok na dálku (8-35 yd s mrtvou zónou v klasickém stylu), Gutting Strike, Harrier's Guise, Venom Barb, Fell Shot, Rattling Shot, Counterfang, Fettering Slash a ochočitelný pet od úrovně 10.
- **Rogue**: energie a combo body, Wicked Slash, Dirt Nap, Craven Thrust (zezadu, dýkou), Eye Jab, Ghostfoot, Cutthroat Tempo, Swift Heels.
- **Priest**: Smite, Whispered Prayer, Litany of Resolve, Dirge of Decay, Psalm of Warding (pohlcení), Lingering Grace (HoT), Mindfracture.
- **Shaman**: Arc Bolt, Stonebound Weapon (imbue), Mending Waters, Earthen Jolt, Thunder Ward (thorns), Cinder Jolt.
- **Mage**: Cinderbolt, Hoarfrost Mantle, Aether Insight, Rimelance, Waterbind, Cinderfall, Aether Darts (kanálované), Bewitch, Icebind, přivolaný vodní elementál a Chronomancy, léčitelská specializace s magií času.
- **Warlock**: Gloom Bolt, Fiendhide, Burning Pact, Blackrot, Hard Bargain, Hex of Anguish, Consume a sedm přivolatelných démonů od Emberkin po Wraithborn.
- **Druid**: Wildbolt, Wildmend, Wildward, Lunar Tempest, Wildbloom, Briarguard, Gripping Roots a proměna do Wolf Form na 5, Bruin Form na 8 a Moonwing Form na 10.

Léčení a buffy dopadají na členy party, léčení může critnout a absorpční štíty pohltí poškození dřív, než dojde na zdraví. Body rozděluješ mezi **tři talentové specializace na třídu** (Battlecraft/Bloodrush/Ironguard, Moongrove/Wildfang/Groveheart a tak dále); rozdělení ověřuje server a dá se vyexportovat jako build string.

### Dungeony

Příběhová linka Gravecaller vede třemi pětičlennými elitními instancemi, čtvrtá čeká za měsíční bránou s vlastní utopeneckou lore a stranou stojí sólo krypta pro průzkumníky.

- **The Hollow Crypt** (5 hráčů) pod Fallen Chapel: elitní trash po dvojicích, miniboss Sexton Marrow a Morthen the Gravecaller s opakujícím se stínovým AoE. Dveře krypty teleportují tvou partu do soukromé kopie instance, která se resetuje, jakmile se vyprázdní.
- **The Sunken Bastion** (5 hráčů, kolem úrovně 13, jihovýchodní Mirefen): Vael the Fogbinder přivolává vlny Drowned Thralls, jak se boj vleče.
- **Gravewyrm Sanctum** (5 hráčů, úroveň 20, pod Thornpeakem): tři komnaty elitní kostěné a šupinaté gardy, Korgath the Bound, Grand Necromancer Velkhar a Korzul the Gravewyrm, kde padají epické zbraně.
- **The Drowned Temple** (5 hráčů) skrze měsíční bránu v Glimmermere: bledá, měsíčně fialová instance vedoucí ke Choirmother Selthe a pak k Ysolei, Avatar of the Drowned Moon, jejíž měsíční přílivy a přivolaní Moonspawn trestají skupinu, která stojí na místě.
- **The Abandoned Crypt** (sólo) v Thornpeaku: tichý sestup s klíčovými kameny a deníky pro jednoho, jehož stopa odpečetí královské dveře k **Nythraxis, Scourge of Thornpeak**, desetičlennému raidovému finále vedenému přes tři soul wardstones.

Každá instance běží také na **Heroic**: nepřátelé vyšších úrovní, ostřejší mechaniky a vlastní loot i měna u obchodníka. Návazné questové řetězce jsou zvládnutelné sólo, takže příběh nikdy nestojí na tom, jestli najdeš skupinu. Náš automatizovaný raid pěti botů (warrior, paladin, priest, mage, hunter s fokusovanou palbou a léčitelskou AI) vyčistí the Hollow Crypt zhruba za pět minut (`node scripts/crypt_raid.mjs`, vyžaduje `ALLOW_DEV_COMMANDS=1`).

### Delves

Delves jsou samostatný, škálovatelný režim pro malou skupinu jednoho nebo dvou hráčů, při každém průchodu přestavěný z náhodných komnat a končící u zamčené relikviářové truhly, která se otevírá minihrou na páčení zámků, ne hodem o loot. **The Collapsed Reliquary** (od úrovně 7) končí u Deacon Varric a pokud jdeš sám, po tvém boku bojuje AI společnice Tessa. **The Drowned Litany** (od úrovně 12) sleduje stopu do zatopené svatyně na okraji Mirefen Marsh. Nástěnka delves nastavuje stupeň: Heroic zvedá úrovně nepřátel a přidává náhodný afix pro bohatší odměny.

### Hodnocené PvP (the Ashen Coliseum)

Do fronty se zařadíš klávesou `G` nebo tlačítkem arény. Matchmaking teleportuje bojovníky do soukromé jámy, krátké odpočítávání všechny vyléčí a resetuje pro férový začátek a střetnutí končí, když se jedna strana vzdá. Nikdo neumírá a vracíš se přesně tam, odkud jsi se zařadil do fronty. Protect Yumi se bojuje ve vlastním bludišti, ne v jámě Coliseu.

- **Hodnocené žebříčky 1v1 a 2v2**, každý s trvalým hodnocením ve stylu Ela a s celkovým žebříčkem všech dob.
- **2v2 Fiesta**, živější týmový režim, kde týmy závodí k cílovému počtu sražení, zatímco sbírané augmenty rozdávají sílu a zavírající se kruh tlačí boj k sobě.
- **Protect Yumi**, nehodnocený objektivový režim 3v3 a 5v5 hraný v bludišti: každý tým hlídá kočičího familiára a snaží se skolit toho druhého, takže doprovod a vypíchnutí cílů váží víc než holé killy.

Hodnocené výhry a sražení ve Fiestě platí **Honor**, který ve městě quartermaster mění za sadu výbavy Warfare. Warfare je stat jen pro PvP, takže sada vyhrává souboje, aniž by v PvE kdy přerostla loot z dungeonů stejného stupně.

### Hraní společně

- **Dungeon Finder**: otevři ho přes `Shift+I` a procházej dungeony a raidy, prohlížej si bosse a loot, zařaď se do automatické fronty rolí tank/léčitel/DPS nebo vytvoř inzerát na předem složenou skupinu. Skupiny složené přes Finder pořád cestují ke vchodu společně.
- **Party** až do 5 hráčů, po naplnění převedená na desetičlenný raid ze dvou skupin: klikni pravým na hráče a Invite to Party. Členové sdílejí tap práva a započtení questů, dělí si XP s bonusy skupiny z klasické éry a objevují se jako body na minimapě. `/p` pro chat party, `/roll` na vyřešení lootu.
- **Obchodování**: klikni pravým a Trade. Obě strany nachystají předměty a peníze, obě musí potvrdit a výměna je atomická a ověřená serverem. Questové předměty se obchodovat nedají a odejít od sebe obchod zruší.
- **Souboje**: klikni pravým a Challenge to a Duel. Třísekundové odpočítávání, pak boj, dokud jedna strana nespadne na 1 hp; vítěz se vyhlašuje po celé zóně a odběhnout 60 yardů znamená vzdát se.
- **Tap práva a stav nepřítomnosti**: první hráč, který mobovi ublíží, vlastní jeho loot, XP i započtení questu; `/afk` a `/dnd` tě označí jako nepřítomného s automatickou odpovědí na šeptání.

### Svět a systémy

- **Profese** (`Shift+P`): čtyři sběrné profese (hornictví, dřevorubectví, bylinkářství, rybaření) zásobují deset řemesel, od vaření a alchymie po zbrojířství, klenotnictví a enchanting. Sběrné nástroje mají stupně, které rozhodují, jaké uzly zvládneš zpracovat, řemesla se dělají u městských pracovišť se šancí na mistrovskou kvalitu, jež nese značku svého tvůrce, a jak se specializuješ, čeká na tebe systém archetypů k objevení.
- **World Market**: hráči řízená aukční síň na výbavu, materiály a spotřebiče, prohlížitelná z hlavních měst.
- **Ravenpost pošta**: posílej předměty a mince jiným postavám, přílohy se bezpečně drží až do vyzvednutí.
- **Guildy**: zakládací listiny, rostery, hodnosti a guildovní chat.
- **Guide**: prohledávatelná wiki přímo na webu na `/wiki` pokrývající třídy, tvory, zóny a deeds, generovaná přímo z živého herního obsahu, takže se nemůže rozejít se světem, který popisuje.
- **The Vale Cup a Card Duel**: boarball na stadionu Sowfield jižně od Eastbrooku, ve formátech od 1v1 po 5v5, a rychlá karetní hra jeden na jednoho, kterou ve městě pořádá Card Master.
- **Daily Rewards**: ověření držitelé $WOC mohou získávat body do žebříčku z denního roztočení a rotujících úkolů, s automatickými výplatami z denního výherního fondu.
- **WOC Store a Season 1 Armory**: kup Claudium za fiat, SOL, USDC nebo $WOC a pak ho utrať za čistě kosmetické skiny zbraní.
- **Jídlo a pití**: sedni si a regeneruj, přeruší tě poškození nebo vstávání, a ano, jíst a pít jde současně.
- **Obchodníci**, kteří kupují jídlo a vodu a prodávají poctivou bílou výbavu, s mincemi zobrazenými ve zlatě, stříbře a mědi.
- **Osobní banka** (the Gilded Strongbox): bursaři v každém hlavním městě drží trezor pro každou postavu, od 24 slotů až po 96 s rozšířeními za mince, plus bonusové sloty získané online za ověřený e-mail, propojené účty a doporučení.
- **Book of Deeds**: deník úspěchů (výchozí `Shift+Z`) plný questů, killů, vyčištěných instancí a radostí, který vyplácí kosmetické tituly, jež můžeš nosit na jmenovce, v chatu i na nástěnkách, plus HUD tracker pro deeds, které honíš, Kroniky pro každou zónu vedené NPC Chroniclery a celoživotní žebříček Renown; veřejný seznam žije na `/wiki/deeds`.
- **AI mobů**: potulování, aggro podle vzdálenosti a rozdílu úrovní, sociální pully, pronásledování, leash a reset, loot z mrtvol a respawny, se vzácným spawnem (Old Greyjaw) na dlouhém časovači.
- **Rybářská místa** s vlastními tabulkami lootu a vzácnými úlovky.
- **Kosmetické skiny** házené v neobvyklé, vzácné a epické raritě, čistě pro vzhled.
- **Smrt a návrat**: propusť svého ducha na hřbitov, utrž poškození z pádu a ve vodě plav pomaleji.
- **Počasí podle biomů**: jasno ve Vale, déšť v Marsh, sníh na Peaks, s prolínáním, jak se pohybuješ mezi zónami.

### Ovládání (klasické rozvržení)

| Vstup | Akce |
|---|---|
| `W` / `S` | běh / couvání. `A`/`D` otáčí (se drženým pravým tlačítkem strafuje), `Q`/`E` strafuje |
| tažení pravým / tažení levým | mouselook / obíhající kamera. Kolečko zoomuje, `Space` skáče |
| `Tab` | přepínání nejbližších nepřátel. Levý klik cílí, pravý klik útočí, lootuje nebo mluví |
| `1`-`9`, `0`, `-`, `=` | akční lišta |
| `F` | interakce (vylootovat mrtvolu, sebrat objekt, promluvit) |
| `C` `P` `L` `M` `B` `N` `T` | postava, kniha kouzel, deník questů, mapa světa, tašky, talenty, řemesla |
| `G` `O` `K` `I` `Y` `Shift+I` `Shift+P` `Shift+Z` | aréna, přátelé a guilda, žebříček, kalendář, Vale Cup, Dungeon Finder, profese, deeds |
| `Z` / `X` | schovat nebo tasit zbraně, kolo emotů |
| `V` / `R` / `Esc` | jmenovky, autorun, zavřít horní okno (nebo otevřít herní menu) |

Každou klávesu si přemapuješ v panelu klávesových zkratek. Dotykové ovládání (pohybová páčka, tažení kamery a akční tlačítka na obrazovce) naskočí na mobilu automaticky.

## Architektura (jedna sim, tři hostitelé)

Projekt drží pohromadě tři myšlenky:

- **Jedna sim, tři hostitelé.** Tentýž kód `src/sim/` pohání offline svět v prohlížeči, online server i RL prostředí. Chování musí být všude identické a testy existují proto, aby to tak zůstalo.
- **`IWorld` je jediná spára.** `IWorld` je definované jako sada facetových rozhraní podle domén pod `src/world_api/`, které agreguje `src/world_api.ts`. Offline `Sim` ho splňuje strukturálně a online `ClientWorld` ho implementuje zrcadlením serverových snímků. Renderer a HUD mluví jen s `IWorld`, nikdy s konkrétním světem, takže nová funkce nejdřív rozšíří odpovídající facetu a pak oba světy.
- **Server je autoritativní.** Klienti posílají záměr; server rozhoduje o výsledcích. Klient sám nikdy nevyhodnocuje boj, loot ani ekonomiku.

Sim je pevný tick na 20 Hz (`DT = 1/20`), veškerá náhoda protéká jediným naseedovaným `Rng` a `src/sim/` nenese žádné DOM, prohlížečové ani Three.js importy. Právě to dovoluje tentýž kód zabalit do Node env serveru, autoritativní herní smyčky i záložky prohlížeče, aniž bys změnil řádek.

### Rozvržení projektu

| Cesta | Co to je |
|---|---|
| `src/sim/` | Deterministické herní jádro, zdroj pravdy. Žádné DOM ani Three závislosti. |
| `src/sim/content/` | Data jako kód: devět tříd, schopnosti, zóny, dungeony, delves, předměty, recepty, enchanty, talenty, profese, deeds. |
| `src/world_api.ts` + `src/world_api/` | `IWorld`, spára, na které stojí renderer a HUD: jedno facetové rozhraní na doménu. |
| `src/` (zbytek) | Three.js renderer, HUD a styly, vstup a zvuk, online zrcadlo a SPA pro admin, guide a editor. |
| `server/` | Autoritativní server: HTTP a WS, smyčka světa, Postgres, auth, sociální funkce, moderace. |
| `server/http/` | REST požadavková pipeline: tabulkový router, middleware a definice rout podle domén. |
| `headless/` + `python/` | RL env server (`env_server.ts`) a Python Gym bindingy. |
| `bot/` | Discord bot (role, relay, feed aktivit). |
| `electron/`, `android/`, `ios/` | Desktopový (Steam) a nativní mobilní shell. |
| `tests/` | Vitest suite. |
| `scripts/` | Nástroje pro build, assety, i18n, SFX, screenshoty a prohlížečové E2E. |
| `deploy/` · `mediawiki/` | Produkční assety pro první start a kontejner hráčské wiki. |
| `public/` · `docs/` | Statické assety (nasazované na web doslova) a designové dokumenty. |

Nic z toho nestojí na čestném slově: `tests/architecture.test.ts` prochází každý soubor simu a hledá
zakázaný import, DOM globál nebo zatoulané volání hodin či `Math.random`, a
`tests/world_api_parity.test.ts` připíná spáru, aby se oba světy nemohly rozejít.

Většina adresářů nese vlastní `CLAUDE.md` s místními konvencemi a kompletní sada
invariantů projektu žije v kořenovém [`CLAUDE.md`](../../CLAUDE.md). Přispěvatelé z řad agentů začínají
tam a pak si vezmou vstupní bod svého běhového prostředí: [`AGENTS.md`](../../AGENTS.md) plus
[průvodce operátora Codexu](../codex.md) pro Codex, [`GEMINI.md`](../../GEMINI.md) pro Gemini. Všechny
ústí do téže kanonické architektury.

## Postaveno jako klasiky

Boj, postup na úrovních i threat běží na autentických pravidlech klasické éry: vztek a energie, tabulky zásahů a úhybů, redukce podle zbroje, skutečná XP křivka, swing timery a globální cooldown. Působí to tak, jak si to pamatuješ, místo aby to jen přibližovalo. Přesná čísla leží v `src/sim/`, pokud si je chceš přečíst.

Svět je vytvořený v kódu, ne ve 3D editoru, což je to, co ho drží malý,
deterministický a snadno forkovatelný:

- Terén, voda, počasí, obloha, rozvržení měst, stíny v reálném čase a bojové efekty vznikají za běhu z vlastních dat simu.
- Modely, které se dodávají, vznikají stejně: procedurální továrny pod `scripts/assets/` exportují deterministické GLB skrze projektovou image-to-GLB pipeline, vedle kurátorované knihovny CC0 model kitů. Riggované rodiny tvorů a postav nesou plné animace chůze, útoku, sesílání, sezení a smrti.
- Ikony jsou vrstvený painter, který složí grafiku pro cokoli, co nemá dodaný soubor, takže nikdy nic nezůstane bez ikony, a nad tím leží kurátorovaná malovaná grafika pro schopnosti, předměty a deeds.
- Kompletní klasický HUD (unit framy, akční lišty, tooltipy, deník questů, mapa světa, minimapa, plovoucí bojový text, Book of Deeds), samplované prostorové a rozhraní zvukové efekty a soundtrack složený procedurálně v repozitáři a dodávaný jako streamované remastery, které se prolínají mezi zónami, městy, dungeony a bojem.

Každý dodaný asset a jeho licence je zaznamenaný v [CREDITS.md](../../CREDITS.md) a přibalené
závislosti třetích stran nesou svá oznámení v [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Vývoj

Kromě herního klienta build vyrábí i operátorský dashboard, editor světa na
`/editor` a veřejný Guide na `/wiki`, vše servírované z téhož vývojového serveru.

Každá cesta k FFmpegu, kterou gate a zvukové testy používají, se rozřeší na přibalené
npm balíčky `ffmpeg-static`/`ffprobe-static`, takže běžný příspěvek nepotřebuje systémovou
instalaci FFmpegu. Cesty, které měří konformitu (`npm run sfx:check`, zvukové testy,
validace exportu ve Studiu), se vážou přímo na statické binárky, bez záložního `PATH`:
pokud je instalace s přeskočenými skripty nechala chybět, spusť znovu `npm ci`. Přehrávání a
enkódování ve Studiu a preflight `npm run gate` se rozřeší přes `scripts/sfx/ffmpeg_paths.mjs`,
který na `PATH` zpátky sáhne. Některé samostatné skripty generující zvuk (například
`scripts/gen_ui_sfx.mjs`) pořád spoléhají na `ffmpeg` z `PATH`.

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

Logické a unit testy používají Vitest. Při iteraci spouštěj jeden soubor: `npx vitest run tests/sim.test.ts`. Změny rozhraní mají navíc volitelnou sadu v reálném prohlížeči, která pokrývá přístupnost, ovládání klávesnicí a dotykové cíle: `npm run test:browser`. Screenshotové a smoke skripty řídí skutečné prohlížeče přes `puppeteer-core` a potřebují běžící `npm run dev`; skripty na úrovni drátu (`mp_integration.mjs`, `social_e2e.mjs`, `crypt_raid.mjs`) mluví se serverem přímo a potřebují místo toho `npm run server`. Prohlížečoví agenti mohou řídit pohyb přes `window.__game.controller` místo simulace držených kláves, například `controller.move({ forward: true }, facingRadians)` nebo kompaktními flagy jako `{ f: 1, sr: 1 }`.

Kontroly běží ve vrstvách popsaných v [docs/qa-gate.md](../qa-gate.md): nasměruj svůj klon na
sdílené hooky pomocí `git config core.hooksPath .githooks` a rychlá spodní vrstva poběží dřív,
než cokoli opustí tvůj stroj.

Serverové příkazy najdeš výše v [Vývoj online](#develop-online-with-hot-reload),
[CONTRIBUTING.cs_CZ.md](CONTRIBUTING.cs_CZ.md) pro postup přispívání,
[tutoriál SFX Studia](../sfx-studio-tutorial.md) pro tvorbu zvuku a
export artefaktů, [DEPLOY.md](../../DEPLOY.md) pro produkci a
[CREDITS.md](../../CREDITS.md) pro licence assetů.

## Lokalizace

Každý řetězec viditelný pro hráče se rozřeší přes `t()` a hra vychází ve **22 jazycích** (angličtina, dvě španělštiny, dvě francouzštiny, kanadská angličtina, italština, němčina, zjednodušená a tradiční čínština, korejština, japonština, brazilská portugalština, ruština, čeština, nizozemština, polština, indonéština, turečtina, švédština, vietnamština a dánština). Sim a server zůstávají jazykově neutrální: emitují stabilní klíče nebo angličtinu, kterou klient na hranici znovu lokalizuje, což zachovává determinismus. Přispěvatelé přidávají jen angličtinu; správce před každým vydáním hromadně doplní ostatní jazyky. Postup je zdokumentovaný v `docs/i18n-scaling/translation-workflow.md`.

## Přispívání

Příspěvky všeho druhu jsou vítané: kód, překlady, hlášení chyb i dokumentace. Začni s [CONTRIBUTING.cs_CZ.md](CONTRIBUTING.cs_CZ.md) kvůli nastavení, přečti si [Kodex chování](../../CODE_OF_CONDUCT.md) a než nahlásíš zranitelnost, projdi si [SECURITY.md](../../SECURITY.md). Jsi tu nový? Poohlédni se po issues se štítkem [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), otevři [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose) nebo pozdrav na [Discordu](https://discord.com/invite/worldofclaudecraft).

Aktivní vývoj běží na nejnovější větvi `release/vX.Y.Z`. Nedomýšlej si ji, radši si ji vyhledej, pak se z ní odděl a na ni miř svůj pull request. Nikdy nevětvi z `main` ani na něj nemiř, ta dostane release větev až ve chvíli, kdy daná verze vyjde. [CONTRIBUTING.md](CONTRIBUTING.cs_CZ.md) obsahuje jednořádkový příkaz, který tu aktuální najde.

## Licence

**Kód je [licencovaný pod MIT](../../LICENSE), takže ho forkni, remixuj a hostuj si vlastní svět.** O to tu celou dobu jde a nic dalšího na této stránce ani na našem webu to nebere zpět.

Tři věci jsou licencované zvlášť, takže stojí za třicet sekund vědět, co je co:

| Co | Licence | Můžeš to šířit dál? |
|---|---|---|
| **Zdrojový kód**, tedy všechen kromě mediálních assetů vyčleněných níže | [MIT](../../LICENSE) | Ano. I komerčně. |
| **Mediální assety**: modely, textury, HDRI, ikony, zvuky, fonty (většinou pod `public/`) | Podle assetu, zaznamenáno v [CREDITS.md](../../CREDITS.md) | Většinou ano (většina je CC0). Některé ne, viz níže. |
| **Jméno a branding**: "World of ClaudeCraft", "Levy Street", loga | Nelicencováno | Ne. |

**Forkni to a hostuj si vlastní svět. To funguje a assety ti v tom nestojí v cestě.** Většina toho, co vidíš, je CC0 volné dílo (KayKit, Quaternius, Kenney, ambientCG, Poly Haven) a naše vlastní generované propy, tvorové, pozadí a zvuky rozhraní se dodávají s projektem, takže fork běží rovnou po vybalení. Jen je nemůžeš vytáhnout ven a prodávat jako samostatnou grafiku.

Co bys musel odstranit nebo nahradit, než to budeš šířit dál:

- **ikony schopností tříd od CraftPix** pod `public/ui/skills/` koupila Levy Street a **nesmí se šířit dál**, takže pokud je chceš dodávat, kup si vlastní licenci;
- **zvukové efekty od @jamiecypher** jsou CC BY-NC 4.0, takže je sdílej nekomerčně a s uvedením autora, ale komerční licence platí jen pro tento projekt;
- **grafika obchodu a prestiže** (Season 1 Armory, sada Claudium, sada grafiky profesí, ikony Book of Deeds, emblém elitního draka) je zakázková komerční grafika a **práva jsou vyhrazena**;
- **značky třetích stran** (Twitch, X, Kick, YouTube, Discord, Solana, USDC) jsou ochranné známky svých vlastníků a nejsou naše, abychom je licencovali dál;
- **hrstka ikon a nahrávek použitých se svolením** potřebuje svolení k dalšímu předání.

[CREDITS.md](../../CREDITS.md) je autoritativní seznam se sloupcem o dalším šíření pro každý asset. Kde je asset uvedený tam, tamní licence má přednost před MIT licencí projektu. Ten registr se pořád ještě dokončuje, takže mediální asset, který v něm chybí, je nezaznamenaný, ne volný: než se na něj spolehneš, zeptej se. U zdrojového kódu to platí naopak a všechno, co není vyčleněné, je MIT.

Naše [Podmínky služby](https://worldofclaudecraft.com/terms) pokrývají hostovanou hru, kterou provozujeme na worldofclaudecraft.com: účty, chování, virtuální předměty. Neomezují práva, která ti k tomuto zdrojovému kódu dává MIT licence.
