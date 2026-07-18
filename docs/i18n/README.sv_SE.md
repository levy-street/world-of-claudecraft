<div align="center">

# World of ClaudeCraft

**Lös uppdrag, slå dig samman och raida en handbyggd värld, gratis i din webbläsare. Öppen källkod, web3 och online just nu.**

**Officiell webbplats: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r185-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.27.0-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.sv_SE.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · **Svenska** · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Spela nu](https://worldofclaudecraft.com/) · [Hosta din egen värld](#host-your-own-world-one-command) · [Träna en agent](#train-an-agent-headless-rl) · [Web3](#web3) · [Bidra](CONTRIBUTING.sv_SE.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![World of ClaudeCraft titelskärm](../../docs/screenshots/title-screen.jpg)

</div>

## Vad det här är

World of ClaudeCraft är en komplett MMO i klassisk stil som du kan spela just nu i din webbläsare, hosta själv med ett enda kommando och till och med träna AI-agenter att spela. Den är gratis, öppen källkod och live på [worldofclaudecraft.com](https://worldofclaudecraft.com/).

En gemensam värld körs på tre platser, alla från samma spelkärna:

- den **offline-webbläsarvärlden**, där du klickar på Play Offline och är inne,
- den **auktoritativa flerspelarservern**, där Postgres-baserade konton delar en levande värld,
- den **huvudlösa RL-miljön**, där Python driver det riktiga spelet genom ett Gym-gränssnitt.

Samma seed, samma värld, överallt. Och nästan ingenting är en levererad tillgång: städerna, varelserna, trollformelsikonerna och ljudet genereras alla vid körning.

## Höjdpunkter

- **Nio klassiska klasser**, var och en med ett riktigt vanilla-format kit som får nya ranker när du levlar, plus ett fullständigt **talangsystem** (tre specar per klass, 27 specar totalt).
- **Tre öppna världszoner** från nivå 1 till 20, nästan 80 uppdrag och en enda sammanhängande berättelse om Gravecaller-konspirationen.
- **Fem instansierade dungeons**, fyra av dem femspelares elitraids och en solo-krypta, med elitskalning, AoE-bossmekanik och loot efter klassarketyp.
- **Skalbara delves**, ett läge för små grupper med en eller två spelare plus en AI-följeslagare, ombyggt från slumpade kammare varje gång över Normal- och Heroic-nivåer.
- **The Ashen Coliseum**, en rankad PvP-arena med 1v1- och 2v2-stegar plus ett 2v2 Fiesta-läge (förstärkningsupphämtningar, en krympande ring, först till femton nedtagningar).
- **Riktig flerspelare**: grupper, byteshandel, dueller, tap-rättigheter, gruppdelad XP, viskningar, frånvarostatus och en server som äger varje stridstärning.
- **Procedurellt allt**: städer med korsvirke, riggade varelsefamiljer, målade trollformelsikoner ritade på canvas, WebAudio-ljud, biomväder och realtidsskuggor. Inga 3D-modellfiler för världen.
- **Lokaliserat till 21 lokaler** genom en deterministisk pipeline där simuleringen sänder ut nycklar.
- **Huvudlös RL-miljö** med Gymnasium-bindningar, belöningsformning och ett benchmark-läge.
- **Web3-inbyggt**: länka en Solana-plånbok för att visa ditt $WOC-saldo och en kosmetisk innehavar-badge, helt valfritt och icke-förvaltande.

## Skärmbilder

![En grupp samlas utanför apoteket i Eastbrook](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Skymning vid lägerelden i Eastbrook](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Skymning vid lägerelden i Eastbrook* | ![Elitpulls i the Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Fackelbelysta elitpulls i the Hollow Crypt* |
| ![De rastlösa döda vid det förfallna kapellet](../../docs/screenshots/restless-dead.jpg)<br>*De rastlösa döda vid det förfallna kapellet* | ![Ett slagsmål med Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*I underläge vid banditlägret* |
| ![Old Greyjaw jagad på norra vägen](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, den sällsynta spawnen, nedjagad på norra vägen* | ![Gränssnitt för handlare och väskor](../../docs/screenshots/vendor-and-bags.jpg)<br>*Utrustar sig hos Smith Haldren, med verktygstips, väskor och mynt* |
| ![Måneporten på Glimmermere-stranden](../../docs/screenshots/glimmermere-moongate.jpg)<br>*De dränkta klättrar upp vid Glimmermere-måneporten* | ![Ysolei på altaret i the Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Moonfire och altaret i the Drowned Temple* |

Vädret styrs av biomet och är endast renderingsmässigt, så det rör aldrig den deterministiska simuleringen:

| | | |
|:---:|:---:|:---:|
| ![Klar himmel över Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Klart över the Vale* | ![Regn över Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Regn över Mirefen Marsh* | ![Snö på Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Snö på Thornpeak Heights* |

## Spela det

Du har två sätt in, och de kör samma värld.

### Offline, i din webbläsare

```bash
npm install
npm run dev        # then open http://localhost:5173 and click Play Offline
```

Namnge din karaktär, välj någon av de nio klasserna, och du börjar i **Eastbrook Vale** (nivå 1-7), en marknadsstad omringad av sex nav: vargstråk i norr, vildsvinsängar i öster, the Webwood i väster, Mirror Lake i nordväst, en kobold-koppargruva i sydväst och ett förfallet kapell med rastlösa döda i nordöst, med Gorraks banditläger i sydöst. Norra vägen klättrar uppför ett bergspass in i **Mirefen Marsh** (6-13, nav Fenbridge) och vidare upp till **Thornpeak Heights** (13-20, nav Highwatch). Världens seed är fast i `src/main.ts`, så det är samma plats vid varje besök.

### Online, med andra spelare

Se [Hosta din egen värld](#host-your-own-world-one-command) nedan för att starta upp det riktiga klient/server-spelet med konton och beständiga karaktärer.

<a id="host-your-own-world-one-command"></a>

## Hosta din egen värld (ett kommando)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres + game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

För **fjärrhosting**, placera compose-stacken på vilken VPS som helst, sätt ett riktigt `POSTGRES_PASSWORD` i miljön och ställ en TLS-omvänd proxy framför port 8787. Caddy gör detta på två rader (`your.domain { reverse_proxy localhost:8787 }`); WebSockets proxas automatiskt och klienten väljer automatiskt `wss://` på https-sidor. Autentiseringsändpunkter har hastighetsbegränsning per IP, lösenord scrypt-hashas och tokens går ut efter 7 dagar. Sätt aldrig `ALLOW_DEV_COMMANDS=1` i produktion, eftersom det aktiverar de nivå- och teleporteringsfusk som testbotarna använder. Se [DEPLOY.md](../../DEPLOY.md) för den fullständiga produktionsguiden.

<a id="develop-online-with-hot-reload"></a>

### Utveckla online med hot reload

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api and /ws)
```

Öppna http://localhost:5173, välj **Play Online**, skapa ett konto, skapa en karaktär och Enter World. Öppna en andra flik och logga in igen för att se varandra i staden. `Enter` öppnar chatten. En riktig MediaWiki-spelarwiki dyker upp tillsammans med Docker Compose-stacken på http://localhost:8080/wiki/; dess startsidor genereras från aktuellt spelinnehåll med `npm run wiki:seed`.

Vad som består och hur servern behåller kontrollen:

- **Konton**: scrypt-hashade lösenord och 7-dagars bearer-tokens (`auth_tokens`).
- **Karaktärer**: upp till 10 per konto; nivå, utrustning, väskor, uppdrag, talanger, position och pengar består som JSONB i Postgres, sparas var 30:e sekund, vid utloggning och vid serveravstängning. Namn är globalt unika, endast bokstäver, klassisk stil.
- **Servern är auktoritativ**: klienter strömmar rörelseavsikt och kommandon vid 20 Hz; servern kör den enda gemensamma `Sim` och returnerar intresseavgränsade snapshots (~120 yd) plus händelser per spelare. Varje stridstärning, lootfall, uppdragskredit och handlartransaktion avgörs på serversidan. Klienten är en renderare.

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

env = WoWClassicEnv(player_class="warrior")   # warrior or mage
obs, info = env.reset(seed=42)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
env.close()
```

- **Observations- och handlingsrymderna härleds från innehållet.** Fråga efter dem från miljöns `info`-svar vid uppstart i stället för att hårdkoda; de växer med spelet. Idag är handlingsrymden `Discrete(44)` (rörelse, mål, attack, hela förmågekittet, interagera, äta/dricka) och observationen är en `Box` av 276 flyttal (sig själv, förmågor, mål, närliggande mobs, närmaste interagerbara, uppdragsframsteg).
- **Belöning** är en viktad summa av räknardeltan per tick (XP, åsamkad och mottagen skada, kills, dödsfall, uppdragsframsteg, nivåhöjningar), justerbar per reset. Varje `step` tillämpar en handling och avancerar fem simuleringsticks som standard, alltså ungefär fyra beslut per simulerad sekund.
- **Deterministisk i sin konstruktion.** Ingen väggklocka, ingen `Math.random`. Seeda reset och episoden spelas upp exakt igen.

Protokollet och bindningarna är dokumenterade i `headless/CLAUDE.md` och `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft är web3-inbyggt kring **$WOC**, vår community-token på Solana. Anslut en Solana-plånbok, länka den till ditt konto med en signatur (icke-förvaltande, ingen transaktion att godkänna), och ditt skrivskyddade $WOC-saldo dyker upp i HUD:en tillsammans med en kosmetisk innehavarnivå-badge.

Det är endast kosmetiskt och behövs inte för att spela. Inget spenderas eller tjänas in i spelet, det finns inget pay-to-win, och hela spelet spelas utmärkt utan att någonsin ansluta en plånbok.

**$WOC-kontraktsadress (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Mer om token på [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## En rundtur i världen

### De nio klasserna

Varje klass använder riktig vanilla-mekanik och lär sig rankade trollformler över nivå 1-20 (Lightning Bolt R2 vid 8, R3 vid 14, R4 vid 20, med förmågor i de höga banden som Execute, Kidney Shot, Flash Heal, Stormstrike och Starfire som anländer på sin klassiska nivå).

- **Warrior**: rage, Heroic Strike (på nästa swing, off-GCD), Battle Shout, Charge, Rend, Thunder Clap, Hamstring, Bloodrage, Overpower (dodge-proc).
- **Paladin**: Seal of Righteousness utlöst av Judgement, Holy Light, Devotion Aura, Blessing of Might, Divine Protection (absorb), Hammer of Justice (stun), Lay on Hands.
- **Hunter**: Auto Shot på avstånd (8-35 yd med den klassiska döda zonen), Raptor Strike, Aspect of the Hawk, Serpent Sting, Arcane Shot, Concussive Shot, Mongoose Bite, Wing Clip, och ett tämjbart husdjur från nivå 10.
- **Rogue**: energy och combo points, Sinister Strike, Eviscerate, Backstab (bakifrån, dolk), Gouge, Evasion, Slice and Dice, Sprint.
- **Priest**: Smite, Lesser Heal, Power Word: Fortitude, Shadow Word: Pain, Power Word: Shield (absorb), Renew (HoT), Mind Blast.
- **Shaman**: Lightning Bolt, Rockbiter Weapon (imbue), Healing Wave, Earth Shock, Lightning Shield (thorns), Flame Shock.
- **Mage**: Fireball, Frost Armor, Arcane Intellect, Frostbolt, Conjure Water, Fire Blast, Arcane Missiles (channeled), Polymorph, Frost Nova.
- **Warlock**: Shadow Bolt, Demon Skin, Immolate, Corruption, Life Tap, Curse of Agony, Drain Life, och sju framkallningsbara demoner från Imp till Doomguard.
- **Druid**: Wrath, Healing Touch, Mark of the Wild, Moonfire, Rejuvenation, Thorns, Entangling Roots, Bear Form vid 10.

Heals och buffs landar på gruppmedlemmar, healing kan kritta, och absorb-sköldar suger upp skada före hälsa. Spendera poäng över **tre talangspecar per klass** (Arms/Fury/Protection, Balance/Feral/Restoration, och så vidare); fördelningen valideras på servern och kan exporteras som en build-sträng.

### Dungeons

Gravecaller-berättelsen löper genom fyra femspelares elitinstanser, och en solo-krypta ligger vid sidan om för utforskare.

- **The Hollow Crypt** (5 spelare) under the Fallen Chapel: parad elit-trash, minibossen Sexton Marrow och Morthen the Gravecaller, som släpper en Shadow Pulse AoE var tionde sekund. Kryptdörren teleporterar din grupp in i en privat instanskopia som återställs efter fem minuter tom.
- **The Sunken Bastion** (5 spelare, runt nivå 13, sydöstra Mirefen): Vael the Mistcaller framkallar vågor av Drowned Thralls vid 60% och 30% hälsa.
- **Gravewyrm Sanctum** (5 spelare, nivå 20, under Thornpeak): tre kammare av elit-boneguard och drakonid, Korgath the Bound (rasar under 30%), Grand Necromancer Velkhar, och Korzul the Gravewyrm, där episka vapen droppar.
- **The Drowned Temple** (5 spelare) genom Glimmermere-måneporten: en blek, månviolett instans som leder till Choirmother Selthe och sedan Ysolei, Avatar of the Drowned Moon, som pulserar Lunar Tide var nionde sekund och framkallar Moonspawn vid 60% och 30%.
- **The Abandoned Crypt** (solo) i Thornpeak: en stillsam keystone-och-dagboksdykning för en, vars spår låser upp den kungliga dörren till **Nythraxis, Scourge of Thornpeak**, ett tiospelares raid-final utkämpat över tre soul wardstones.

Upptakts-uppdragskedjorna går att klara solo, så berättelsen är aldrig spärrad bakom att hitta en grupp. Vår automatiserade fem-bots raid (warrior, paladin, priest, mage, hunter med focus-fire och healer-AI) klarar the Hollow Crypt på ungefär fem minuter (`node scripts/crypt_raid.mjs`, kräver `ALLOW_DEV_COMMANDS=1`).

### Delves

Delves är ett separat, skalbart läge för små grupper med en eller två spelare. **The Collapsed Reliquary** (nivå 7 och uppåt) är en krypta ombyggd från slumpade kammare vid varje genomgång, som slutar vid Deacon Varric. Klara den solo så slåss en AI-följeslagare, Tessa, vid din sida. Brother Halven vid relikvarie-ruinen sköter delve-tavlan, där Normal eller Heroic är ditt val: Heroic höjer fiendernas nivåer och lägger till ett slumpat affix för rikare belöningar.

### The Ashen Coliseum (rankad PvP)

Tryck `G` eller arenaknappen för att köa. Matchmaking teleporterar fighters in i en privat, fackelbelyst grop, en kort nedräkning helar och återställer alla för en rättvis start, och drabbningen slutar när en sida ger upp vid 1 hp. Ingen dör, och du återvänder exakt där du köade.

- **1v1- och 2v2-rankade stegar**, var och en med en beständig Elo-liknande rating (alla börjar på 1500) och en topplista genom tiderna (`GET /api/arena/leaderboard`).
- **2v2 Fiesta**, ett livligare gruppläge: första laget till femton nedtagningar vinner inom en sextiominuters gräns, spelare respawnar på växande timers, förstärkningsupphämtningar släpper kraft över tre vågor, och en avslutande ring tvingar samman striden.

### Spela tillsammans

- **Grupper** upp till 5: högerklicka en spelare och Invite to Party. Medlemmar delar tap-rättigheter och uppdragskredit, delar XP med de riktiga vanilla-gruppbonusarna (1.166 / 1.3 / 1.43 för 3/4/5), och visas som blippar på minimapen. `/p` för gruppchatt, `/roll` för att avgöra loot.
- **Byteshandel**: högerklicka och Trade. Båda sidor lägger fram föremål och pengar, båda måste acceptera, och bytet är atomärt och servervaliderat. Uppdragsföremål kan inte handlas, och att gå isär avbryter.
- **Dueller**: högerklicka och Challenge to a Duel. En 3-sekunders nedräkning, sedan strid tills en sida når 1 hp; vinnaren tillkännages zon-brett och att springa 60 yards bort innebär förlust.
- **Tap-rättigheter och frånvarostatus**: den första spelaren som skadar en mob äger dess loot, XP och uppdragskredit; `/afk` och `/dnd` markerar dig som frånvarande med ett autosvar på viskningar.

### Värld och system

- **Äta och dricka**: sitt för att återställa över 18 sekunder, avbrutet av skada eller att resa sig, och ja, du kan äta och dricka samtidigt.
- **Handlare** som köper mat och vatten och säljer ärlig vit utrustning, med mynt visade i guld, silver och koppar.
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
| `C` `P` `L` `M` `B` `G` | karaktär, trollformelsbok, uppdragslogg, världskarta, väskor, arena |
| `V` / `R` / `Esc` | namnplattor, autorun, stäng fönster eller rensa mål |

Pekkontroller (en rörelsespak, kameradrag och handlingsknappar på skärmen) dyker upp automatiskt på mobil.

## Arkitektur (en simulering, tre värdar)

Tre idéer håller samman projektet:

- **En simulering, tre värdar.** Samma `src/sim/`-kod kör offline-webbläsarvärlden, online-servern och RL-miljön. Beteendet måste vara identiskt överallt, och testerna finns för att hålla det så.
- **`IWorld` är den enda fogen.** `src/world_api.ts` definierar `IWorld`. Offline-`Sim` uppfyller det strukturellt och online-`ClientWorld` implementerar det genom att spegla serverns snapshots. Renderaren och HUD:en talar bara med `IWorld`, aldrig med en konkret värld, så en ny funktion utökar gränssnittet först och sedan båda världarna.
- **Servern är auktoritativ.** Klienter skickar avsikt; servern avgör utfall. Klienten avgör aldrig strid, loot eller ekonomi på egen hand.

Simuleringen är ett fast 20 Hz-tick (`DT = 1/20`), all slumpmässighet flödar genom en seedad `Rng`, och `src/sim/` bär noll DOM-, webbläsar- eller Three.js-importer. Det är vad som låter samma kod buntas in i en Node-miljöserver, en auktoritativ spelloop och en webbläsarflik utan att ändra en rad.

### Projektlayout

| Sökväg | Vad det är |
|---|---|
| `src/sim/` | Deterministisk spelkärna, sanningskällan. Inga DOM- eller Three-beroenden. |
| `src/sim/content/` | Data som kod: de nio klasserna, förmågor, zoner, dungeons, föremål, talanger. |
| `src/render/` | Three.js-renderare (procedurell geometri, texturer, VFX). Läser världen, muterar den aldrig. |
| `src/game/` | Lokal inmatning, kamera, kortkommandon, mobilkontroller, procedurell WebAudio. |
| `src/ui/` | Klassisk HUD (ramar, fönster, verktygstips, karta, flytande stridstext), procedurella ikoner, i18n. |
| `src/net/` | Online-klient: REST-autentisering plus en WebSocket-världsspegel (`ClientWorld`). |
| `src/admin/` | Admin-dashboard-SPA (separat `admin.html`-ingång). |
| `server/` | Auktoritativ server: HTTP och WS, världsloop, Postgres, autentisering, socialt, moderering. |
| `headless/` + `python/` | RL-miljöserver (`env_server.ts`) och Python Gym-bindningar. |
| `tests/` | Vitest-svit. |
| `scripts/` | Asset-bygge plus webbläsar-E2E-, skärmbilds- och integrationsskript. |
| `public/` · `docs/` | Statiska tillgångar (GLB-modeller, texturer, HDRIs) och designdokument. |

De flesta kataloger bär sin egen `CLAUDE.md` med lokala konventioner. Hela uppsättningen projektinvarianter finns i rot-[`CLAUDE.md`](../../CLAUDE.md).

## Byggt som klassikerna

Strid, levling och hot körs alla på autentiska regler från den klassiska eran: rage och energy, hit- och dodge-tabeller, rustningsmitigering, den riktiga XP-kurvan, swing timers och den globala nedkylningen. Det känns som du minns det snarare än att approximera det. De exakta siffrorna finns i `src/sim/` om du vill läsa dem.

Och nästan inget av det är en levererad tillgång. Världen ritas från kod:

- Procedurella städer, varelser, terräng, vatten, väder och realtidsskuggor, utan några 3D-modellfiler för världen.
- Tolv riggade varelsefamiljer med fullständiga gång-, attack-, cast-, sitt- och dödsanimationer.
- Trollformels-, föremåls- och buff-ikoner målade på canvas vid körning.
- En komplett klassisk HUD (enhetsramar, handlingsfält, verktygstips, uppdragslogg, världskarta, minimap, flytande stridstext) och procedurell WebAudio för varje ljud.

## Utveckling

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

Logik- och enhetstester använder Vitest. Medan du itererar, kör en enda fil: `npx vitest run tests/sim.test.ts`. E2E- och visuella skript driver riktiga webbläsare via `puppeteer-core` och kräver att `npm run dev` körs (ofta `npm run server` också). Webbläsaragenter kan driva rörelse genom `window.__game.controller` i stället för att simulera nedtryckta tangenter, till exempel `controller.move({ forward: true }, facingRadians)` eller kompakta flaggor som `{ f: 1, sr: 1 }`.

För serverkommandona se [Utveckla online](#develop-online-with-hot-reload) ovan, [DEPLOY.md](../../DEPLOY.md) för produktion, och [CREDITS.md](../../CREDITS.md) för asset-licenser.

## Lokalisering

Varje spelarsynlig sträng löses genom `t()`, och spelet levereras i **21 lokaler** (engelska, två spanska, två franska, engelska Kanada, italienska, tyska, förenklad och traditionell kinesiska, koreanska, japanska, brasiliansk portugisiska, ryska, nederländska, polska, indonesiska, turkiska, svenska, vietnamesiska och danska). Simuleringen och servern förblir språkagnostiska: de sänder ut stabila nycklar eller engelska som klienten omlokaliserar vid gränsen, vilket håller determinismen intakt. Bidragsgivare lägger till engelska enbart; underhållaren batchfyller de andra lokalerna före varje release. Arbetsflödet är dokumenterat i `docs/i18n-scaling/translation-workflow.md`.

## Bidra

Bidrag av alla slag är välkomna: kod, översättningar, buggrapporter och dokumentation. Börja med [CONTRIBUTING.md](CONTRIBUTING.sv_SE.md) för installation, läs [uppförandekoden](../../CODE_OF_CONDUCT.md), och kolla [SECURITY.md](../../SECURITY.md) innan du rapporterar en sårbarhet. Ny här? Leta efter issues märkta [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), öppna en [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose), eller säg hej på [Discord](https://discord.com/invite/worldofclaudecraft).

<div align="center">

![World of Claude](../../worldofclaude.png)

![World of ClaudeCraft community](../../woc_community.png)

</div>

## Licens

Koden är [MIT-licensierad](../../LICENSE), så forka den, remixa den och hosta din egen värld.

De medföljande tredjeparts konsttillgångarna (modeller, texturer, HDRIs) behåller sina egna licenser, alla CC0 public domain förutom MIT-vattennormalkartorna, dokumenterade per pack i [CREDITS.md](../../CREDITS.md).
