<div align="center">

# World of ClaudeCraft

**Lös uppdrag, slå dig samman och raida en handbyggd värld, gratis i din webbläsare. Öppen källkod, web3 och online just nu.**

**Officiell webbplats: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.32.4-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.sv_SE.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Čeština](README.cs_CZ.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · **Svenska** · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Spela nu](https://worldofclaudecraft.com/) · [Hosta din egen värld](#host-your-own-world-one-command) · [Träna en agent](#train-an-agent-headless-rl) · [Web3](#web3) · [Bidra](CONTRIBUTING.sv_SE.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![World of ClaudeCraft titelskärm](../../docs/screenshots/title-screen.jpg)

</div>

## Vad det här är

World of ClaudeCraft är en komplett MMO i klassisk stil som du kan spela just nu i din webbläsare, hosta själv med ett enda kommando och till och med träna AI-agenter att spela. Den är gratis, öppen källkod och live på [worldofclaudecraft.com](https://worldofclaudecraft.com/).

En gemensam värld körs på tre platser, alla från samma spelkärna:

- den **auktoritativa flerspelarservern**, den levande världen du spelar på worldofclaudecraft.com, där Postgres-baserade konton delar ett enda beständigt rike,
- den **offline-webbläsarvärlden**, en lokal enspelar-Sim som du får från utvecklingsservern, användbar för utveckling och för att läsa spelkärnan från början till slut,
- den **huvudlösa RL-miljön**, där Python driver det riktiga spelet genom ett Gym-gränssnitt.

Samma seed, samma värld, överallt. Mycket av det du ser ritas fortfarande från kod vid körning, och resten är en kurerad uppsättning tillgångar som följer med projektet, så en fork fungerar direkt.

## Höjdpunkter

- **Nio klassiska klasser**, var och en med ett fullständigt kit i klassisk stil som får nya ranker när du levlar, plus ett fullständigt **talangsystem** (tre specar per klass, 27 specar totalt).
- **Tre öppna världszoner** från nivå 1 till 20, mer än 90 uppdrag och en enda sammanhängande berättelse om Gravecaller-konspirationen.
- **Fem instansierade dungeons**, fyra av dem femspelares elitraids och en solo-krypta, med elitskalning, AoE-bossmekanik, loot efter klassarketyp som samlas till tier-set, och en **Heroic-svårighetsnivå** med rikare belöningar, plus **world bosses** i den öppna världen och en tiospelares raid-final.
- **Två skalbara delves**, ett läge för små grupper med en eller två spelare plus en AI-följeslagare, ombyggt från slumpade kammare varje gång över Normal- och Heroic-nivåerna.
- **Rankad PvP** över två arenakartor: 1v1- och 2v2-stegar, ett livligare 2v2 Fiesta-läge och **Protect Yumi**, ett målbaserat 3v3- och 5v5-läge. Rankat spel ger Honor, som köper en utrustningsuppsättning enbart för PvP som aldrig överskalar dungeon-loot i PvE.
- **The Vale Cup**, en boarball-liga som spelas i sin egen arena söder om Eastbrook, och **Card Duel**, ett snabbt kortspel man mot man som hålls i staden.
- **En Book of Deeds**: en bedriftsjournal med kosmetiska titlar, badge-ramar och Renown, med Chronicles per zon som förs av Chronicler-NPC:er ute i världen och en topplista genom tiderna.
- **En djup yrkesekonomi**: fyra insamlingsyrken matar tio hantverk, från matlagning och alkemi till juvelerkonst, vapensmide och förtrollning, med verktyg i nivåer, arbetsstationer i staden, mästerverkskvalitet och beställningar, allt matande en spelardriven **World Market** och posttjänsten **Ravenpost**.
- **Riktig flerspelare**: grupper och raids, gillen, byteshandel, dueller, tap-rättigheter, gruppdelad XP, viskningar, frånvarostatus och en **Dungeon Finder** med rollköer och premade-annonser.
- **Skapat i kod, inte i en 3D-editor**: terräng, vatten, väder, stadsplaner, realtidsskuggor och effekter genereras vid körning, och de modeller som faktiskt levereras byggs av procedurella fabriker och ett kurerat tillgångsbibliotek snarare än att skulpteras för hand.
- **Lokaliserat till 22 lokaler** genom en deterministisk pipeline där simuleringen sänder ut nycklar.
- **En medföljande wiki på `/wiki`**, genererad direkt från levande spelinnehåll så att den inte kan glida ifrån världen den dokumenterar.
- **Nativa appar på varje plattform**: signerade skrivbordsinstallerare för Windows, Linux och macOS med automatiska uppdateringar och valfri spegling av Steam-achievements, plus iOS- och Android-byggen, alla med samma webbläsarklient och samma onlinevärld.
- **Skalar till maskinen du har**: grafikförinställningar och en automatisk bildfrekvensregulator byter visuell rikedom mot mjukhet, och hålls till en rättviseregel som hindrar dem från att någonsin dölja något som en spelare reagerar på.
- **Huvudlös RL-miljö** med Gymnasium-bindningar, belöningsformning och ett benchmark-läge.
- **$WOC-nytta, helt valfritt**: länka en Solana-plånbok för innehavarflair, Daily Rewards och ett rabatterat betalningsalternativ i den kosmetiska butiken. Spelet förblir gratis att spela och icke-förvaltande.
- **Season 1 Armory**: samla kosmetiska vapenskins genom WOC Store, med Claudium köpt för fiatvaluta, SOL, USDC eller $WOC. Kosmetika ger aldrig stridskraft.

## Skärmbilder

![Torget i Eastbrook, lägerelden och uppdragsgivarna](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Skymning vid lägerelden i Eastbrook](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Skymning vid lägerelden i Eastbrook* | ![Elitpulls i the Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Fackelbelysta elitpulls i the Hollow Crypt* |
| ![De rastlösa döda vid det förfallna kapellet](../../docs/screenshots/restless-dead.jpg)<br>*De rastlösa döda vid det förfallna kapellet* | ![Ett slagsmål med Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*I underläge vid banditlägret* |
| ![Old Greyjaw jagad på norra vägen](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, den sällsynta spawnen, nedjagad på norra vägen* | ![Gränssnitt för handlare och väskor](../../docs/screenshots/vendor-and-bags.jpg)<br>*Utrustar sig hos Trader Wilkes, med handlaren och väskorna öppna* |
| ![Måneporten på Glimmermere-stranden](../../docs/screenshots/glimmermere-moongate.jpg)<br>*De dränkta klättrar upp vid Glimmermere-måneporten* | ![Ysolei på altaret i the Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Lunar Tempest och altaret i the Drowned Temple* |

Vädret styrs av biomet och är endast renderingsmässigt, så det rör aldrig den deterministiska simuleringen:

| | | |
|:---:|:---:|:---:|
| ![Klar himmel över Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Klart över the Vale* | ![Regn över Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Regn över Mirefen Marsh* | ![Snö på Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Snö på Thornpeak Heights* |

## Spela det

Spela i din webbläsare på [worldofclaudecraft.com](https://worldofclaudecraft.com/), eller installera den nativa appen för Windows, Linux, macOS, iOS eller Android. Varje klient ansluter till samma onlinevärld.

### Online, med andra spelare

Skapa ett konto, skapa en karaktär och kliv in i den levande världen. För att köra samma klient/server-stack själv, se [Hosta din egen värld](#host-your-own-world-one-command) nedan.

### Offline, i utvecklingsservern

Offline-läget är en lokal enspelarvärld utan konto och utan serverauktoritet, så det ingår endast i utvecklingsbyggen. Kör utvecklingsservern så dyker det upp i lägesväljaren:

```bash
npm install
npm run dev        # then open http://localhost:5173 and choose Play Offline
```

Namnge din karaktär, välj någon av de nio klasserna, och du börjar i **Eastbrook Vale** (nivå 1-7), en marknadsstad omringad av nav: vargstråk i norr, vildsvinsängar i öster, Sableweb-skogarna i väster, Mirror Lake i nordväst, en burrower-drabbad koppargruva i sydväst och ett förfallet kapell med rastlösa döda i nordöst, med Gorraks banditläger i sydöst. Norra vägen klättrar uppför ett bergspass in i **Mirefen Marsh** (6-13, nav Fenbridge) och vidare upp till **Thornpeak Heights** (13-20, nav Highwatch). Världens seed är fast i `src/main.ts`, så det är samma plats vid varje besök.

### Skrivbordsappar för Windows, Linux och macOS

World of ClaudeCraft levereras som fullständiga skrivbordsappar för alla tre stora skrivbordsplattformar: signerade Windows-installerare, Linux-paket som AppImage och deb, och signerade och notariserade universella macOS-byggen. De använder samma spelklient och samma onlinevärld som webbläsaren, med nativ paketering och automatiska uppdateringar.

Online-inloggning sker endast med Discord och e-post, precis som webbflödet: e-post och lösenord loggar in inne i appen, och "Continue with Discord" öppnar din standardwebbläsare på sidan `/desktop-login`, som lämnar tillbaka en engångskod till appen över en `worldofclaudecraft://`-djuplänk som appen växlar in mot en vanlig World of ClaudeCraft-sessionstoken.

```bash
npm run electron:dev          # Vite + Electron dev shell
npm run electron:pack         # local unpacked desktop app
npm run electron:build        # website-channel installers (self-updating)
npm run electron:build:steam  # SteamPipe depot layouts (in-app updater off)
```

Rikta skalet mot ett annat API med `VITE_DESKTOP_API_ORIGIN`, till exempel en lokal server eller en staging-värd:

```bash
VITE_DESKTOP_API_ORIGIN=http://127.0.0.1:8787 npm run electron:dev
```

Åsidosätt produktions-API:ets ursprung för staging-byggen med `VITE_DESKTOP_API_ORIGIN=https://dev.worldofclaudecraft.com` (ett värde vid BYGGTID: det bakas in i bundeln och stämplas in i den paketerade appen, och installerade byggen ignorerar det som en miljövariabel vid körning). Steam är en distributionskanal (samma Electron-bundle, uppladdad via SteamPipe), och skrivbordsspelare kan länka ett Steam-konto för att spegla de deeds de tjänar in till Steam-achievements; själva inloggningen förblir e-post och Discord. Den fullständiga release-runbooken (signering, notarisering, publicering av en automatisk uppdatering, SteamPipe-depåer, serverdistributionen) är `docs/desktop-release.md`. iOS och Android levereras genom Capacitor, med en egen runbook i `docs/mobile-store-release.md`.

<a id="host-your-own-world-one-command"></a>

## Hosta din egen värld (ett kommando)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres and the game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

För **fjärrhosting**, placera compose-stacken på vilken VPS som helst, sätt ett riktigt `POSTGRES_PASSWORD` i miljön och ställ en TLS-omvänd proxy framför port 8787. Caddy gör detta på en handfull rader; WebSockets proxas automatiskt och klienten väljer automatiskt `wss://` på https-sidor. Autentiseringsändpunkter har hastighetsbegränsning, lösenord scrypt-hashas och inloggningssessioner går ut. Sätt aldrig `ALLOW_DEV_COMMANDS=1` i produktion, eftersom det aktiverar hela `/dev`-fusksamlingen: de nivå- och teleporteringsfusk som testbotarna använder, plus föremålstilldelningar, mob-spawns, instansteleporteringar och det inbyggda GUI:t för dev-kommandon. [DEPLOY.md](../../DEPLOY.md) är den fullständiga produktionsguiden, inklusive den omvänd-proxy-konfiguration som håller hälso- och mätvärdesändpunkterna borta från den publika kanten.

<a id="develop-online-with-hot-reload"></a>

### Utveckla online med hot reload

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api, /admin/api, and /ws)
```

Öppna http://localhost:5173, välj **Play Online**, skapa ett konto, skapa en karaktär och Enter World. Karaktärsvalsskärmen visar de senaste release-nyheterna i sin News & Updates-panel, med NEW-märken för allt du inte har sett. Öppna en andra flik och logga in igen för att se varandra i staden. `Enter` öppnar chatten. Spelarwikin är den Guide som ligger i repot, serverad på http://localhost:5173/wiki och på `/wiki` i produktion; dess innehåll genereras från aktuell speldata av `npm run wiki:content`.

Vad som består och hur servern behåller kontrollen:

- **Konton**: scrypt-hashade lösenord och bearer-tokens som går ut.
- **Karaktärer**: upp till 10 per konto och rike; nivå, utrustning, väskor, bankvalv, uppdrag, talanger, yrken, PvP- och deed-framsteg, position och pengar består som JSONB i Postgres, sparade på en timer, vid utloggning och vid serveravstängning. Namn är unika per rike och klassiska i stilen.
- **Servern är auktoritativ**: klienter strömmar rörelseavsikt och kommandon vid 20 Hz; servern kör den enda gemensamma `Sim` och returnerar intresseavgränsade snapshots plus händelser per spelare. Varje stridstärning, lootfall, uppdragskredit och handlartransaktion avgörs på serversidan. Klienten är en renderare.

<a id="train-an-agent-headless-rl"></a>

## Träna en agent (huvudlös RL)

Samma deterministiska kärna körs som en [Gymnasium](https://gymnasium.farama.org/)-miljö, så en agent lär sig mot det faktiska spelet, inte en återimplementering av det. Miljöservern (`headless/env_server.ts`) omsluter en `Sim` och talar radavgränsad JSON över stdio; Python-bindningarna i `python/` startar den som en delprocess och exponerar den vanliga `reset` / `step` / `close`-loopen.

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

- **Observations- och handlingsrymderna härleds från innehållet.** Fråga efter dem från miljöns `info`-svar vid uppstart i stället för att hårdkoda; de växer med spelet. Handlingsrymden är en `Discrete` som täcker rörelse, mål, attack, hela förmågekittet, interagera och äta/dricka; observationen är en `Box` som täcker sig själv, förmågor, mål, närliggande mobs, närmaste interagerbara och uppdragsframsteg.
- **Belöning** är en viktad summa av räknardeltan per tick (XP, åsamkad och mottagen skada, kills, dödsfall, uppdragsframsteg, nivåhöjningar), justerbar per reset. Varje `step` tillämpar en handling och avancerar fem simuleringsticks som standard, alltså ungefär fyra beslut per simulerad sekund.
- **Deterministisk i sin konstruktion.** Ingen väggklocka, ingen `Math.random`. Seeda reset och episoden spelas upp exakt igen.

Protokollet och bindningarna är dokumenterade i `headless/CLAUDE.md` och `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft är web3-inbyggt kring **$WOC**, vår community-token på Solana. Anslut en Solana-plånbok, länka den till ditt konto med en signatur (icke-förvaltande, ingen transaktion att godkänna), och ditt skrivskyddade $WOC-saldo dyker upp i HUD:en tillsammans med en kosmetisk innehavarnivå-badge.

$WOC har också valfri nytta i det levande spelet:

- **WOC Store**: köp Claudium, den enkelriktade kosmetiska valutan, med fiatvaluta, SOL, USDC eller $WOC. Betalningsspåret i $WOC är rabatterat mot de andra.
- **Season 1 Armory**: spendera Claudium på samlingar av kosmetiska vapenskins. Butiksköp lägger inte till statistik eller stridskraft.
- **Daily Rewards**: berättigade verifierade innehavare kan tjäna poäng genom ett dagligt snurr och roterande uppgifter, och sedan tävla om en andel av den dagliga prispotten.

Inget av detta behövs för att spela. Plånbokslänkning är valfri och icke-förvaltande, det finns inget pay-to-win, och hela spelet spelas utmärkt utan att någonsin ansluta en plånbok.

**$WOC-kontraktsadress (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Mer om token på [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## En rundtur i världen

### De nio klasserna

Varje klass körs på MMO-mekanik från den klassiska eran, implementerad från grunden, och lär sig rankade trollformler över nivå 1-20, med signaturförmågor som Low Blow, Early Grave, Skyfall, Urgent Prayer och Ancestral Strike som låses upp under klättringens senare hälft.

- **Warrior**: rage, Iron Bellow, Onrush, Quaking Blow, Maiming Strike, Gaping Wounds (en blödning som rider på dina slag), Widening Arc, Hobbling Cut, Blood Toll, Redhand (dodge-proc).
- **Paladin**: Oathbrand utlöst av Verdict, Mending Light, Steadfast Aura, Oath of Iron, Ward of Faith (absorb), Sundering Gavel (stun), Last Rite.
- **Hunter**: automatisk attack på avstånd (8-35 yd med en klassisk död zon), Gutting Strike, Harrier's Guise, Venom Barb, Fell Shot, Rattling Shot, Counterfang, Fettering Slash, och ett tämjbart husdjur från nivå 10.
- **Rogue**: energy och combo points, Wicked Slash, Dirt Nap, Craven Thrust (bakifrån, dolk), Eye Jab, Ghostfoot, Cutthroat Tempo, Swift Heels.
- **Priest**: Smite, Whispered Prayer, Litany of Resolve, Dirge of Decay, Psalm of Warding (absorb), Lingering Grace (HoT), Mindfracture.
- **Shaman**: Arc Bolt, Stonebound Weapon (imbue), Mending Waters, Earthen Jolt, Thunder Ward (thorns), Cinder Jolt.
- **Mage**: Cinderbolt, Hoarfrost Mantle, Aether Insight, Rimelance, Waterbind, Cinderfall, Aether Darts (kanaliserad), Bewitch, Icebind, en frammanad vattenelementar, och Chronomancy, en helarspec byggd på tidsmagi.
- **Warlock**: Gloom Bolt, Fiendhide, Burning Pact, Blackrot, Hard Bargain, Hex of Anguish, Consume, och sju framkallningsbara demoner från Emberkin till Wraithborn.
- **Druid**: Wildbolt, Wildmend, Wildward, Lunar Tempest, Wildbloom, Briarguard, Gripping Roots, och skepnadsbyte till Wolf Form vid 5, Bruin Form vid 8 och Moonwing Form vid 10.

Heals och buffs landar på gruppmedlemmar, healing kan kritta, och absorb-sköldar suger upp skada före hälsa. Spendera poäng över **tre talangspecar per klass** (Battlecraft/Bloodrush/Ironguard, Moongrove/Wildfang/Groveheart, och så vidare); fördelningen valideras på servern och kan exporteras som en build-sträng.

### Dungeons

Gravecaller-berättelsen löper genom tre femspelares elitinstanser, en fjärde väntar bakom en måneport med sin egen dränkta lore, och en solo-krypta ligger vid sidan om för utforskare.

- **The Hollow Crypt** (5 spelare) under the Fallen Chapel: parad elit-trash, minibossen Sexton Marrow och Morthen the Gravecaller med sin återkommande skugg-AoE. Kryptdörren teleporterar din grupp in i en privat instanskopia som återställs när den väl har tömts.
- **The Sunken Bastion** (5 spelare, runt nivå 13, sydöstra Mirefen): Vael the Fogbinder framkallar vågor av Drowned Thralls allteftersom striden drar ut på tiden.
- **Gravewyrm Sanctum** (5 spelare, nivå 20, under Thornpeak): tre kammare av elit-boneguard och scaleguard, Korgath the Bound, Grand Necromancer Velkhar, och Korzul the Gravewyrm, där episka vapen droppar.
- **The Drowned Temple** (5 spelare) genom Glimmermere-måneporten: en blek, månviolett instans som leder till Choirmother Selthe och sedan Ysolei, Avatar of the Drowned Moon, vars måntidvatten och frammanade Moonspawn straffar en grupp som står stilla.
- **The Abandoned Crypt** (solo) i Thornpeak: en stillsam keystone-och-dagboksdykning för en, vars spår låser upp den kungliga dörren till **Nythraxis, Scourge of Thornpeak**, en tiospelares raid-final utkämpad över tre soul wardstones.

Varje instans går också att köra på **Heroic**: fiender på högre nivå, skarpare mekanik och egen loot och handlarvaluta. Upptakts-uppdragskedjorna går att klara solo, så berättelsen är aldrig spärrad bakom att hitta en grupp. Vår automatiserade fem-bots raid (warrior, paladin, priest, mage, hunter med focus-fire och healer-AI) klarar the Hollow Crypt på ungefär fem minuter (`node scripts/crypt_raid.mjs`, kräver `ALLOW_DEV_COMMANDS=1`).

### Delves

Delves är ett separat, skalbart läge för små grupper med en eller två spelare, ombyggt från slumpade kammare vid varje genomgång och avslutat vid en låst relikvariekista som öppnas genom ett dyrkningsminispel i stället för ett lootkast. **The Collapsed Reliquary** (nivå 7 och uppåt) slutar vid Deacon Varric, med en AI-följeslagare, Tessa, som slåss vid din sida om du går ensam. **The Drowned Litany** (nivå 12 och uppåt) följer spåret in i en översvämmad helgedom i utkanten av Mirefen Marsh. En delve-tavla sätter nivån: Heroic höjer fiendernas nivåer och lägger till ett slumpat affix för rikare belöningar.

### Rankad PvP (the Ashen Coliseum)

Tryck `G` eller arenaknappen för att köa. Matchmaking teleporterar fighters in i en privat grop, en kort nedräkning helar och återställer alla för en rättvis start, och drabbningen slutar när en sida ger upp. Ingen dör, och du återvänder exakt där du köade. Protect Yumi utkämpas i sin egen labyrint i stället för i Coliseum-gropen.

- **1v1- och 2v2-rankade stegar**, var och en med en beständig Elo-liknande rating och en topplista genom tiderna.
- **2v2 Fiesta**, ett livligare gruppläge där lagen kappas mot ett nedtagningsmål medan förstärkningsupphämtningar delar ut kraft och en avslutande ring tvingar samman striden.
- **Protect Yumi**, ett orankat målbaserat 3v3- och 5v5-läge som utkämpas i en labyrint: varje lag vaktar en katt-familiar samtidigt som det försöker fälla motståndarens, så eskorter och picks betyder mer än rena kills.

Rankade vinster och Fiesta-nedtagningar ger **Honor**, som kvartermästaren i staden byter mot en uppsättning Warfare-utrustning. Warfare är en statistik enbart för PvP, så uppsättningen vinner dueller utan att någonsin överutrusta dungeon-loot på samma nivå i PvE.

### Spela tillsammans

- **Dungeon Finder**: öppna den med `Shift+I` för att bläddra bland dungeons och raids, granska bossar och loot, gå med i en automatisk rollkö för tank/healer/DPS, eller skapa en premade-annons. Grupper som Finder skapat reser fortfarande till ingången tillsammans.
- **Grupper** upp till 5, omvandlade till en tiospelares raid av två grupper när ni är fulltaliga: högerklicka en spelare och Invite to Party. Medlemmar delar tap-rättigheter och uppdragskredit, delar XP med gruppbonusarna från den klassiska eran, och visas som blippar på minimapen. `/p` för gruppchatt, `/roll` för att avgöra loot.
- **Byteshandel**: högerklicka och Trade. Båda sidor lägger fram föremål och pengar, båda måste acceptera, och bytet är atomärt och servervaliderat. Uppdragsföremål kan inte handlas, och att gå isär avbryter.
- **Dueller**: högerklicka och Challenge to a Duel. En 3-sekunders nedräkning, sedan strid tills en sida når 1 hp; vinnaren tillkännages zon-brett och att springa 60 yards bort innebär förlust.
- **Tap-rättigheter och frånvarostatus**: den första spelaren som skadar en mob äger dess loot, XP och uppdragskredit; `/afk` och `/dnd` markerar dig som frånvarande med ett autosvar på viskningar.

### Värld och system

- **Yrken** (`Shift+P`): fyra insamlingsyrken (gruvdrift, skogsavverkning, örtkunskap, fiske) matar tio hantverk, från matlagning och alkemi till vapensmide, juvelerkonst och förtrollning. Insamlingsverktyg finns i nivåer som avgör vilka noder du kan bearbeta, hantverk sker vid stadens arbetsstationer med en chans till mästerverkskvalitet som bär ditt tillverkarmärke, och det finns ett arketypsystem att upptäcka allteftersom du specialiserar dig.
- **The World Market**: ett spelardrivet auktionshus för utrustning, material och förbrukningsvaror, som går att bläddra i från navstäderna.
- **Ravenpost-post**: skicka föremål och mynt till andra karaktärer, med bilagor som förvaras säkert tills de hämtas.
- **Gillen**: stiftelseurkunder, medlemslistor, ranger och gillechatt.
- **The Guide**: en sökbar wiki på plats under `/wiki` som täcker klasser, varelser, zoner och deeds, genererad direkt från levande spelinnehåll så att den inte kan glida ifrån världen den dokumenterar.
- **The Vale Cup och Card Duel**: boarball på Sowfield-arenan söder om Eastbrook, i format från 1v1 till 5v5, och ett snabbt kortspel man mot man som hålls av the Card Master i staden.
- **Daily Rewards**: verifierade $WOC-innehavare kan tjäna topplistepoäng från ett dagligt snurr och roterande uppgifter, med automatiska utbetalningar från den dagliga prispotten.
- **WOC Store och Season 1 Armory**: köp Claudium med fiatvaluta, SOL, USDC eller $WOC, och spendera det sedan på rent kosmetiska vapenskins.
- **Äta och dricka**: sitt för att återställa, avbrutet av skada eller att resa sig, och ja, du kan äta och dricka samtidigt.
- **Handlare** som köper mat och vatten och säljer ärlig vit utrustning, med mynt visade i guld, silver och koppar.
- **En personlig bank** (the Gilded Strongbox): kassörer i varje navstad håller ett valv per karaktär, från 24 platser upp till 96 med myntköpta utökningar, plus bonusplatser som tjänas in online för en verifierad e-postadress, länkade konton och värvningar.
- **The Book of Deeds**: en bedriftsjournal (som standard `Shift+Z`) över uppdrag, kills, clears och godbitar, som ger kosmetiska titlar du kan bära på din namnplatta, i chatten och på topplistorna, plus en HUD-spårare för de deeds du jagar, Chronicles per zon som förs av Chronicler-NPC:er, och en Renown-topplista genom tiderna; den publika listan finns på `/wiki/deeds`.
- **Mob-AI**: vandra, närhetsaggro efter nivåskillnad, sociala pulls, jaga, leash och återställning, lik-loot, och respawns, med en sällsynt spawn (Old Greyjaw) på en lång timer.
- **Fiske**platser med egna loottabeller och sällsynta fångster.
- **Kosmetiska skins** rullade i ovanlig, sällsynt och episk sällsynthet, enbart för utseendet.
- **Död och återhämtning**: släpp din ande till kyrkogården, ta fallskada, och sakta ner medan du simmar.
- **Biomväder**: klart i the Vale, regn i the Marsh, snö på the Peaks, med övertoning när du rör dig mellan zoner.

### Kontroller (klassisk layout)

| Inmatning | Handling |
|---|---|
| `W` / `S` | spring / backa. `A`/`D` svänger (strafe med höger mus nedtryckt), `Q`/`E` strafe |
| högerdrag / vänsterdrag | mouselook / orbitkamera. Hjulet zoomar, `Space` hoppar |
| `Tab` | växla mellan närmaste fiender. vänsterklicka för att måla, högerklicka för att attackera, loota eller prata |
| `1`-`9`, `0`, `-`, `=` | handlingsfält |
| `F` | interagera (loota ett lik, plocka upp ett objekt, prata) |
| `C` `P` `L` `M` `B` `N` `T` | karaktär, trollformelsbok, uppdragslogg, världskarta, väskor, talanger, hantverk |
| `G` `O` `K` `I` `Y` `Shift+I` `Shift+P` `Shift+Z` | arena, vänner och gille, topplista, kalender, Vale Cup, Dungeon Finder, yrken, deeds |
| `Z` / `X` | stoppa undan eller dra dina vapen, emote-hjul |
| `V` / `R` / `Esc` | namnplattor, autorun, stäng det översta fönstret (eller öppna spelmenyn) |

Varje bindning går att mappa om i kortkommandopanelen. Pekkontroller (en rörelsespak, kameradrag och handlingsknappar på skärmen) dyker upp automatiskt på mobil.

## Arkitektur (en simulering, tre värdar)

Tre idéer håller samman projektet:

- **En simulering, tre värdar.** Samma `src/sim/`-kod kör offline-webbläsarvärlden, online-servern och RL-miljön. Beteendet måste vara identiskt överallt, och testerna finns för att hålla det så.
- **`IWorld` är den enda fogen.** `IWorld` definieras som facett-gränssnitt per domän under `src/world_api/`, sammanförda av `src/world_api.ts`. Offline-`Sim` uppfyller det strukturellt och online-`ClientWorld` implementerar det genom att spegla serverns snapshots. Renderaren och HUD:en talar bara med `IWorld`, aldrig med en konkret värld, så en ny funktion utökar först den matchande facetten och sedan båda världarna.
- **Servern är auktoritativ.** Klienter skickar avsikt; servern avgör utfall. Klienten avgör aldrig strid, loot eller ekonomi på egen hand.

Simuleringen är ett fast 20 Hz-tick (`DT = 1/20`), all slumpmässighet flödar genom en seedad `Rng`, och `src/sim/` bär noll DOM-, webbläsar- eller Three.js-importer. Det är vad som låter samma kod buntas in i en Node-miljöserver, en auktoritativ spelloop och en webbläsarflik utan att ändra en rad.

### Projektlayout

| Sökväg | Vad det är |
|---|---|
| `src/sim/` | Deterministisk spelkärna, sanningskällan. Inga DOM- eller Three-beroenden. |
| `src/sim/content/` | Data som kod: de nio klasserna, förmågor, zoner, dungeons, delves, föremål, recept, förtrollningar, talanger, yrken, deeds. |
| `src/world_api.ts` + `src/world_api/` | `IWorld`, fogen som renderaren och HUD:en beror på: ett facett-gränssnitt per domän. |
| `src/` (resten) | Three.js-renderare, HUD och stilar, inmatning/ljud, online-spegeln, och SPA:erna för admin, guide och editor. |
| `server/` | Auktoritativ server: HTTP och WS, världsloop, Postgres, autentisering, socialt, moderering. |
| `server/http/` | REST-förfrågningspipelinen: tabellrouter, middleware och ruttdefinitioner per domän. |
| `headless/` + `python/` | RL-miljöserver (`env_server.ts`) och Python Gym-bindningar. |
| `bot/` | Discord-bot (roller, relä, aktivitetsflöde). |
| `electron/`, `android/`, `ios/` | Skrivbordsskal (Steam) och nativa mobilskal. |
| `tests/` | Vitest-svit. |
| `scripts/` | Verktyg för bygge, tillgångar, i18n, SFX, skärmbilder och webbläsar-E2E. |
| `deploy/` · `mediawiki/` | Produktionens första-uppstart-tillgångar och containern för spelarwikin. |
| `public/` · `docs/` | Statiska tillgångar (distribuerade ordagrant till webbplatsen) och designdokument. |

Inget av detta bygger på hedersord: `tests/architecture.test.ts` skannar varje simuleringsfil
efter en förbjuden import, en DOM-global eller ett vilset klock- eller `Math.random`-anrop, och
`tests/world_api_parity.test.ts` fäster fogen så att de två världarna inte kan glida isär.

De flesta kataloger bär sin egen `CLAUDE.md` med lokala konventioner, och hela uppsättningen
projektinvarianter finns i rot-[`CLAUDE.md`](../../CLAUDE.md). Agentbidragsgivare börjar där,
och plockar sedan upp ingångspunkten för sin körmiljö: [`AGENTS.md`](../../AGENTS.md) plus
[Codex-operatörsguiden](../codex.md) för Codex, [`GEMINI.md`](../../GEMINI.md) för Gemini. Alla
leder in i samma kanoniska arkitektur.

## Byggt som klassikerna

Strid, levling och hot körs alla på autentiska regler från den klassiska eran: rage och energy, hit- och dodge-tabeller, rustningsmitigering, den riktiga XP-kurvan, swing timers och den globala nedkylningen. Det känns som du minns det snarare än att approximera det. De exakta siffrorna finns i `src/sim/` om du vill läsa dem.

Världen är skapad i kod snarare än i en 3D-editor, och det är vad som håller den liten,
deterministisk och lätt att forka:

- Terräng, vatten, väder, himmel, stadsplaner, realtidsskuggor och stridseffekter genereras vid körning från simuleringens egna data.
- De modeller som faktiskt levereras byggs på samma sätt: procedurella fabriker under `scripts/assets/` exporterar deterministiska GLB:er genom projektets image-to-GLB-pipeline, tillsammans med ett kurerat bibliotek av CC0-modellkit. Riggade varelse- och karaktärsfamiljer bär fullständiga gång-, attack-, cast-, sitt- och dödsanimationer.
- Ikoner är en lagerbaserad målare som komponerar konst för allt som saknar en levererad fil, så inget står någonsin utan ikon, med kurerad målad konst lagd ovanpå för förmågor, föremål och deeds.
- En komplett klassisk HUD (enhetsramar, handlingsfält, verktygstips, uppdragslogg, världskarta, minimap, flytande stridstext, the Book of Deeds), samplade rumsliga ljudeffekter och gränssnittsljud, och ett soundtrack komponerat procedurellt i repot och levererat som strömmade remastringar som tonar över mellan zoner, städer, dungeons och strid.

Varje levererad tillgång och dess licens är registrerad i [CREDITS.md](../../CREDITS.md), och medföljande
tredjepartsberoenden bär sina meddelanden i [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Utveckling

Förutom spelklienten producerar bygget operatörsdashboarden, världseditorn på
`/editor` och den publika Guide på `/wiki`, alla serverade från samma utvecklingsserver.

Varje FFmpeg-väg som gaten och ljudtesterna använder löser de medföljande npm-paketen
`ffmpeg-static`/`ffprobe-static`, så ett normalt bidrag kräver ingen FFmpeg-installation i
systemet. De vägar som mäter konformitet (`npm run sfx:check`, ljudtesterna, Studions
export-validering) binder direkt till de statiska binärerna, utan reservlösning via `PATH`:
kör `npm ci` igen om en installation som hoppade över skript lämnade dem saknade. Studions
uppspelnings- och kodningsprocesser och preflighten i `npm run gate` löser via
`scripts/sfx/ffmpeg_paths.mjs`, som faktiskt faller tillbaka på `PATH`. Vissa fristående
ljudgenereringsskript (till exempel `scripts/gen_ui_sfx.mjs`) använder fortfarande som
standard `ffmpeg` från `PATH`.

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

Logik- och enhetstester använder Vitest. Medan du itererar, kör en enda fil: `npx vitest run tests/sim.test.ts`. Gränssnittsändringar har också en frivillig svit i riktig webbläsare som täcker tillgänglighet, tangentbordsnavigering och pekmål: `npm run test:browser`. Skärmbilds- och rökskripten driver riktiga webbläsare via `puppeteer-core` och kräver att `npm run dev` körs; skripten på trådnivå (`mp_integration.mjs`, `social_e2e.mjs`, `crypt_raid.mjs`) talar direkt med servern och kräver `npm run server` i stället. Webbläsaragenter kan driva rörelse genom `window.__game.controller` i stället för att simulera nedtryckta tangenter, till exempel `controller.move({ forward: true }, facingRadians)` eller kompakta flaggor som `{ f: 1, sr: 1 }`.

Kontrollerna körs i lager, beskrivna i [docs/qa-gate.md](../qa-gate.md): rikta din klon mot
de delade hookarna med `git config core.hooksPath .githooks` så körs ett snabbt golv innan
något lämnar din maskin.

För serverkommandona se [Utveckla online](#develop-online-with-hot-reload) ovan,
[CONTRIBUTING.md](CONTRIBUTING.sv_SE.md) för bidragsflödet, [SFX Studio-handledningen](../sfx-studio-tutorial.md)
för ljudskapande och artefaktexport, [DEPLOY.md](../../DEPLOY.md) för produktion, och
[CREDITS.md](../../CREDITS.md) för asset-licenser.

## Lokalisering

Varje spelarsynlig sträng löses genom `t()`, och spelet levereras i **22 lokaler** (engelska, två spanska, två franska, engelska Kanada, italienska, tyska, förenklad och traditionell kinesiska, koreanska, japanska, brasiliansk portugisiska, ryska, tjeckiska, nederländska, polska, indonesiska, turkiska, svenska, vietnamesiska och danska). Simuleringen och servern förblir språkagnostiska: de sänder ut stabila nycklar eller engelska som klienten omlokaliserar vid gränsen, vilket håller determinismen intakt. Bidragsgivare lägger till engelska enbart; underhållaren batchfyller de andra lokalerna före varje release. Arbetsflödet är dokumenterat i `docs/i18n-scaling/translation-workflow.md`.

## Bidra

Bidrag av alla slag är välkomna: kod, översättningar, buggrapporter och dokumentation. Börja med [CONTRIBUTING.md](CONTRIBUTING.sv_SE.md) för installation, läs [uppförandekoden](../../CODE_OF_CONDUCT.md), och kolla [SECURITY.md](../../SECURITY.md) innan du rapporterar en sårbarhet. Ny här? Leta efter issues märkta [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), öppna en [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose), eller säg hej på [Discord](https://discord.com/invite/worldofclaudecraft).

Aktiv utveckling sker på den nyaste `release/vX.Y.Z`-grenen. Ta reda på vilken det är i stället för att anta, och förgrena dig sedan från den och rikta din pull request mot den. Förgrena aldrig från och rikta aldrig mot `main`, som bara tar emot en release-gren när den versionen levereras. [CONTRIBUTING.md](CONTRIBUTING.sv_SE.md) har enradskommandot som hittar den aktuella.

## Licens

**Koden är [MIT-licensierad](../../LICENSE), så forka den, remixa den och hosta din egen värld.** Det är hela poängen, och inget annat på den här sidan eller på vår webbplats tar tillbaka det.

Tre saker licensieras separat, så det är värt trettio sekunder att veta vilket som är vilket:

| Vad | Licens | Får du distribuera det vidare? |
|---|---|---|
| **Källkod**, alltså allt utom de mediatillgångar som undantas nedan | [MIT](../../LICENSE) | Ja. Kommersiellt också. |
| **Mediatillgångar**: modeller, texturer, HDRIs, ikoner, ljud, typsnitt (mestadels under `public/`) | Per tillgång, registrerad i [CREDITS.md](../../CREDITS.md) | Mestadels ja (de flesta är CC0). Vissa inte, se nedan. |
| **Namn och varumärke**: "World of ClaudeCraft", "Levy Street", logotyperna | Inte licensierade | Nej. |

**Forka den och hosta din egen värld. Det fungerar, och tillgångarna står inte i vägen.** Det mesta du ser är CC0 public domain (KayKit, Quaternius, Kenney, ambientCG, Poly Haven), och våra egna genererade props, varelser, bakgrunder och gränssnittsljud följer med projektet, så en fork fungerar direkt. Du kan bara inte lyfta ut dem och sälja dem som fristående konst.

Vad du skulle behöva ta bort eller ersätta innan du distribuerar vidare:

- **CraftPix klassförmågeikoner** under `public/ui/skills/` köptes av Levy Street och **får inte distribueras vidare**, så köp din egen licens om du vill leverera dem;
- **@jamiecypher-ljudeffekterna** är CC BY-NC 4.0, så dela dem icke-kommersiellt med kreditering, men det kommersiella tillståndet gäller endast det här projektet;
- **butiks- och prestigekonsten** (Season 1 Armory, Claudium-uppsättningen, yrkeskonstuppsättningen, Book of Deeds-ikonerna, elitdrakemblemet) är beställd kommersiell konst och **rättigheterna är förbehållna**;
- **tredjeparts varumärkesmärken** (Twitch, X, Kick, YouTube, Discord, Solana, USDC) är varumärken som tillhör sina ägare och är inte våra att licensiera vidare;
- en handfull **ikoner och inspelningar som används med tillstånd** kräver tillstånd för att föras vidare.

[CREDITS.md](../../CREDITS.md) är den auktoritativa listan, med en kolumn för vidaredistribution per tillgång. Där en tillgång är listad där gäller den licensen framför projektets MIT-licens. Det registret håller fortfarande på att färdigställas, så en mediatillgång som saknas i det är oregistrerad snarare än fri: fråga innan du förlitar dig på den. Källkoden fungerar tvärtom, och allt som inte undantas är MIT.

Våra [användarvillkor](https://worldofclaudecraft.com/terms) täcker det hostade spel som vi kör på worldofclaudecraft.com: konton, uppförande, virtuella föremål. De begränsar inte de rättigheter som MIT-licensen ger dig i den här källkoden.
