<div align="center">

# World of ClaudeCraft

**Tag på quests, dan grupper, og raid en håndbygget verden, gratis i din browser. Open source, web3, og online lige nu.**

**Officiel hjemmeside: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.26.0-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.da_DK.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · **Dansk**

[Spil nu](https://worldofclaudecraft.com/) · [Hav din egen verden](#host-your-own-world-one-command) · [Træn en agent](#train-an-agent-headless-rl) · [Web3](#web3) · [Bidrag](CONTRIBUTING.da_DK.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![World of ClaudeCraft titelskærm](../../docs/screenshots/title-screen.jpg)

</div>

## Hvad er dette

World of ClaudeCraft er en komplet MMO i klassisk stil, som du kan spille lige nu i din browser, selv hoste med en enkelt kommando, og endda træne AI-agenter til at spille. Den er gratis, open source, og live på [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Én fælles verden kører tre steder, alt sammen fra den samme spilkerne:

- den **offline browser-verden**, hvor du klikker Play Offline og er inde,
- den **autoritative multiplayer-server**, hvor Postgres-understøttede konti deler en levende verden,
- det **headless RL-miljø**, hvor Python driver det rigtige spil gennem en Gym-grænseflade.

Samme seed, samme verden, overalt. Og næsten intet er et leveret asset: byerne, skabningerne, spell-ikonerne, og lyden bliver alle genereret ved kørselstidspunktet.

## Højdepunkter

- **Ni klassiske klasser**, hver med et ægte vanilla-agtigt kit, der får ranks efterhånden som du stiger i level, plus et fuldt **talentsystem** (tre specs per klasse, 27 specs i alt).
- **Tre open world-zoner** fra level 1 til 20, næsten 80 quests, og en enkelt sammenhængende fortælling om the Gravecaller-konspirationen.
- **Fem instancerede dungeons**, fire af dem femspiller-elite-raids og én solo-krypt, med elite-skalering, AoE-bossmekanikker, og loot efter klassearketype.
- **Skalerbare delves**, en mode for små grupper på én eller to spillere plus en AI-ledsager, genopbygget fra randomiserede kamre i hvert gennemløb på tværs af Normal- og Heroic-tiers.
- **The Ashen Coliseum**, en ranket PvP-arena med 1v1- og 2v2-stiger plus en 2v2 Fiesta-mode (augment-pickups, en krympende ring, først til femten takedowns).
- **Ægte multiplayer**: parties, handel, dueller, tap rights, party-delt XP, hvisken, away-status, og en server der ejer hvert eneste kampslag.
- **Procedural alting**: bindingsværksbyer, riggede skabningsfamilier, malede spell-ikoner tegnet på canvas, WebAudio-lyd, biome-vejr, og realtidsskygger. Ingen 3D-modelfiler til verdenen.
- **Lokaliseret til 21 sprog** gennem en deterministisk pipeline hvor sim'en udsender nøgler.
- **Headless RL-miljø** med Gymnasium-bindings, reward shaping, og en benchmark-mode.
- **Web3-native**: forbind en Solana-wallet for at vise din $WOC-balance og et kosmetisk holder-badge, helt valgfrit og non-custodial.

## Skærmbilleder

![Et party samles uden for apoteket i Eastbrook](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Skumring ved Eastbrook-lejrbålet](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Skumring ved Eastbrook-lejrbålet* | ![Elite-pulls i the Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Fakkelbelyste elite-pulls i the Hollow Crypt* |
| ![De rastløse døde ved det ødelagte kapel](../../docs/screenshots/restless-dead.jpg)<br>*De rastløse døde ved det ødelagte kapel* | ![Et slagsmål med Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*I undertal ved banditlejren* |
| ![Old Greyjaw jaget ned på nordvejen](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, den sjældne spawn, jaget ned på nordvejen* | ![Vendor- og bags-UI](../../docs/screenshots/vendor-and-bags.jpg)<br>*Gør dig klar hos Smith Haldren, med tooltips, bags, og mønter* |
| ![Moongate ved Glimmermere-kysten](../../docs/screenshots/glimmermere-moongate.jpg)<br>*De druknede klatrer op ved Glimmermere-moongate* | ![Ysolei på alteret i the Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Moonfire og alteret i the Drowned Temple* |

Vejret er biome-drevet og kun render-only, så det rører aldrig den deterministiske sim:

| | | |
|:---:|:---:|:---:|
| ![Klar himmel over Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Klart over the Vale* | ![Regn over Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Regn over Mirefen Marsh* | ![Sne på Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Sne på Thornpeak Heights* |

## Spil det

Du har to veje ind, og de kører den samme verden.

### Offline, i din browser

```bash
npm install
npm run dev        # then open http://localhost:5173 and click Play Offline
```

Navngiv din karakter, vælg en af de ni klasser, og du starter i **Eastbrook Vale** (level 1-7), en handelsby omkranset af seks hubs: ulveløb mod nord, vildsvineenge mod øst, the Webwood mod vest, Mirror Lake mod nordvest, en kobold-kobbergrav mod sydvest, og et ødelagt kapel med rastløse døde mod nordøst, med Gorraks banditlejr mod sydøst. Nordvejen stiger op gennem et bjergpas ind i **Mirefen Marsh** (6-13, hub Fenbridge) og videre op til **Thornpeak Heights** (13-20, hub Highwatch). Verdens-seed'en er fastlåst i `src/main.ts`, så det er det samme sted ved hvert besøg.

### Online, med andre spillere

Se [Hav din egen verden](#host-your-own-world-one-command) nedenfor for at rejse det rigtige client/server-spil med konti og persistente karakterer.

<a id="host-your-own-world-one-command"></a>

## Hav din egen verden (én kommando)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres + game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

Til **remote hosting**, læg compose-stakken på en hvilken som helst VPS, sæt en rigtig `POSTGRES_PASSWORD` i miljøet, og sæt en TLS reverse proxy foran port 8787. Caddy gør dette til to linjer (`your.domain { reverse_proxy localhost:8787 }`); WebSockets bliver proxyet automatisk og klienten vælger automatisk `wss://` på https-sider. Auth-endpoints er rate-limited per IP, passwords er scrypt-hashede, og tokens udløber efter 7 dage. Sæt aldrig `ALLOW_DEV_COMMANDS=1` i produktion, da det aktiverer level- og teleport-snydekoderne som testbotterne bruger. Se [DEPLOY.md](../../DEPLOY.md) for den fulde produktionsguide.

<a id="develop-online-with-hot-reload"></a>

### Udvikl online med hot reload

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api and /ws)
```

Åbn http://localhost:5173, vælg **Play Online**, opret en konto, opret en karakter, og Enter World. Åbn en anden fane og log ind igen for at se hinanden i byen. `Enter` åbner chatten. En rigtig MediaWiki-spillerwiki kommer op ved siden af Docker Compose-stakken på http://localhost:8080/wiki/; dens seed-sider bliver genereret fra det aktuelle spilindhold med `npm run wiki:seed`.

Hvad der persisterer og hvordan serveren bevarer kontrollen:

- **Konti**: scrypt-hashede passwords og 7-dages bearer-tokens (`auth_tokens`).
- **Karakterer**: op til 10 per konto; level, gear, bags, quests, talenter, position, og penge persisterer som JSONB i Postgres, gemt hvert 30. sekund, ved logout, og ved server-nedlukning. Navne er globalt unikke, kun bogstaver, klassisk stil.
- **Serveren er autoritativ**: klienter streamer bevægelsesintention og kommandoer ved 20 Hz; serveren kører den ene fælles `Sim` og returnerer interesse-afgrænsede snapshots (~120 yd) plus per-spiller-events. Hvert kampslag, loot drop, quest-credit, og vendor-transaktion afgøres på serversiden. Klienten er en renderer.

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

env = WoWClassicEnv(player_class="warrior")   # warrior or mage
obs, info = env.reset(seed=42)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
env.close()
```

- **Observation- og action-spaces er indholdsafledte.** Forespørg dem fra env'ens `info`-svar ved opstart i stedet for at hardcode dem; de vokser med spillet. I dag er action-spacet `Discrete(44)` (bevægelse, target, attack, det fulde ability-kit, interact, eat/drink) og observationen er en `Box` af 276 floats (selv, abilities, target, nærliggende mobs, nærmeste interactable, quest-fremgang).
- **Reward** er en vægtet sum af per-tick counter-deltaer (XP, skade tildelt og modtaget, kills, deaths, quest-fremgang, level-ups), justerbar per reset. Hvert `step` anvender én action og fremrykker fem sim-ticks som standard, så omtrent fire beslutninger per simuleret sekund.
- **Deterministisk af konstruktion.** Intet wall clock, ingen `Math.random`. Seed reset'et og episoden gentages nøjagtigt.

Protokollen og bindingsene er dokumenteret i `headless/CLAUDE.md` og `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft er web3-native omkring **$WOC**, vores community-token på Solana. Forbind en Solana-wallet, link den til din konto med en enkelt signatur (non-custodial, ingen transaktion at godkende), og din skrivebeskyttede $WOC-balance dukker op i HUD'en ved siden af et kosmetisk holder-tier-badge.

Det er kun kosmetisk og ikke nødvendigt for at spille. Intet bliver brugt eller tjent i spillet, der er ingen pay-to-win, og hele spillet spiller fint uden nogensinde at forbinde en wallet.

**$WOC-kontraktadresse (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Mere om token'et på [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## En rundtur i verdenen

### De ni klasser

Hver klasse bruger ægte vanilla-agtige mekanikker og lærer rankede spells på tværs af level 1-20 (Lightning Bolt R2 ved 8, R3 ved 14, R4 ved 20, med high-band-abilities som Execute, Kidney Shot, Flash Heal, Stormstrike, og Starfire der ankommer på deres klassiske level).

- **Warrior**: rage, Heroic Strike (on-next-swing, off-GCD), Battle Shout, Charge, Rend, Thunder Clap, Hamstring, Bloodrage, Overpower (dodge proc).
- **Paladin**: Seal of Righteousness udløst af Judgement, Holy Light, Devotion Aura, Blessing of Might, Divine Protection (absorb), Hammer of Justice (stun), Lay on Hands.
- **Hunter**: ranged Auto Shot (8-35 yd med den klassiske dead zone), Raptor Strike, Aspect of the Hawk, Serpent Sting, Arcane Shot, Concussive Shot, Mongoose Bite, Wing Clip, og et tæmbart pet fra level 10.
- **Rogue**: energy og combo points, Sinister Strike, Eviscerate, Backstab (bagfra, dolk), Gouge, Evasion, Slice and Dice, Sprint.
- **Priest**: Smite, Lesser Heal, Power Word: Fortitude, Shadow Word: Pain, Power Word: Shield (absorb), Renew (HoT), Mind Blast.
- **Shaman**: Lightning Bolt, Rockbiter Weapon (imbue), Healing Wave, Earth Shock, Lightning Shield (thorns), Flame Shock.
- **Mage**: Fireball, Frost Armor, Arcane Intellect, Frostbolt, Conjure Water, Fire Blast, Arcane Missiles (channeled), Polymorph, Frost Nova.
- **Warlock**: Shadow Bolt, Demon Skin, Immolate, Corruption, Life Tap, Curse of Agony, Drain Life, og syv tilkaldelige dæmoner fra Imp til Doomguard.
- **Druid**: Wrath, Healing Touch, Mark of the Wild, Moonfire, Rejuvenation, Thorns, Entangling Roots, Bear Form ved 10.

Heals og buffs lander på party-medlemmer, healing kan critte, og absorb-shields opsuger skade før health. Brug point på tværs af **tre talent-specs per klasse** (Arms/Fury/Protection, Balance/Feral/Restoration, og så videre); allokeringen er server-valideret og kan eksporteres som en build-streng.

### Dungeons

The Gravecaller-fortællingen løber gennem fire femspiller-elite-instances, og en solo-krypt ligger til siden for opdagelsesrejsende.

- **The Hollow Crypt** (5 spillere) under the Fallen Chapel: parret elite-trash, Sexton Marrow-minibossen, og Morthen the Gravecaller, der dropper en Shadow Pulse AoE hvert tiende sekund. Kryptdøren teleporterer dit party ind i en privat instance-kopi, der nulstilles efter fem minutter uden spillere.
- **The Sunken Bastion** (5 spillere, omkring level 13, sydøstlige Mirefen): Vael the Mistcaller tilkalder bølger af Drowned Thralls ved 60% og 30% health.
- **Gravewyrm Sanctum** (5 spillere, level 20, under Thornpeak): tre kamre af elite-boneguard og drakonid, Korgath the Bound (enrager under 30%), Grand Necromancer Velkhar, og Korzul the Gravewyrm, hvor epic-våben dropper.
- **The Drowned Temple** (5 spillere) gennem Glimmermere-moongate: en bleg, måne-violet instance der fører til Choirmother Selthe og derefter Ysolei, Avatar of the Drowned Moon, der pulserer Lunar Tide hvert niende sekund og tilkalder Moonspawn ved 60% og 30%.
- **The Abandoned Crypt** (solo) i Thornpeak: et stille keystone-og-dagbog-dyk for én, hvis spor åbner den kongelige dør til **Nythraxis, Scourge of Thornpeak**, en tispiller-raid-finale udkæmpet på tværs af tre soul wardstones.

Optakts-questkæderne kan klares solo, så historien er aldrig spærret bag det at finde en gruppe. Vores automatiserede fembot-raid (warrior, paladin, priest, mage, hunter med focus-fire og healer-AI) klarer the Hollow Crypt på omkring fem minutter (`node scripts/crypt_raid.mjs`, kræver `ALLOW_DEV_COMMANDS=1`).

### Delves

Delves er en separat, skalerbar mode for små grupper på én eller to spillere. **The Collapsed Reliquary** (level 7 og op) er en krypt genopbygget fra randomiserede kamre i hvert gennemløb, der ender ved Deacon Varric. Tag den solo, og en AI-ledsager, Tessa, kæmper ved din side. Brother Halven ved relikvie-ruinen driver delve-tavlen, hvor Normal eller Heroic er dit valg: Heroic hæver fjendernes levels og tilføjer et tilfældigt affix for rigere belønninger.

### The Ashen Coliseum (ranket PvP)

Tryk `G` eller arena-knappen for at sætte i kø. Matchmaking teleporterer kæmpere ind i en privat, fakkelbelyst grube, en kort nedtælling healer og nulstiller alle for en fair start, og kampen slutter når en side giver op ved 1 hp. Ingen dør, og du vender tilbage nøjagtigt hvor du satte i kø.

- **1v1- og 2v2-rankede stiger**, hver med en persistent Elo-agtig rating (alle starter ved 1500) og en all-time leaderboard (`GET /api/arena/leaderboard`).
- **2v2 Fiesta**, en livligere party-mode: det første hold til femten takedowns vinder inden for et seks-minutters loft, spillere respawner på voksende timere, augment-pickups dropper power på tværs af tre bølger, og en lukkende ring tvinger kampen sammen.

### At spille sammen

- **Parties** op til 5: højreklik på en spiller og Invite to Party. Medlemmer deler tap rights og quest-credit, splitter XP med de rigtige vanilla-gruppebonusser (1.166 / 1.3 / 1.43 for 3/4/5), og dukker op som blips på minimappet. `/p` for party-chat, `/roll` for at afgøre loot.
- **Handel**: højreklik og Trade. Begge sider lægger items og penge frem, begge skal acceptere, og byttet er atomisk og server-valideret. Quest-items kan ikke handles, og at gå fra hinanden annullerer.
- **Dueller**: højreklik og Challenge to a Duel. En 3-sekunders nedtælling, så kæmp indtil en side rammer 1 hp; vinderen annonceres zone-bredt og at løbe 60 yards væk giver fortabt.
- **Tap rights og away-status**: den første spiller, der skader en mob, ejer dens loot, XP, og quest-credit; `/afk` og `/dnd` markerer dig som away med et auto-svar på hvisken.

### Verden og systemer

- **Spise og drikke**: sæt dig for at genoprette over 18 sekunder, afbrudt af skade eller at rejse sig, og ja, du kan spise og drikke på én gang.
- **Vendors** der køber mad og vand og sælger ærligt hvidt gear, med mønter vist i guld, sølv, og kobber.
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
| `C` `P` `L` `M` `B` `G` | karakter, spellbook, quest log, world map, bags, arena |
| `V` / `R` / `Esc` | nameplates, autorun, luk vinduer eller ryd target |

Touch-kontroller (en bevægelses-joystick, kamera-træk, og action-knapper på skærmen) kommer op automatisk på mobil.

## Arkitektur (én sim, tre hosts)

Tre ideer holder projektet sammen:

- **Én sim, tre hosts.** Den samme `src/sim/`-kode kører den offline browser-verden, online-serveren, og RL-miljøet. Adfærden skal være identisk overalt, og testene findes for at holde det sådan.
- **`IWorld` er den eneste søm.** `src/world_api.ts` definerer `IWorld`. Den offline `Sim` opfylder den strukturelt og den online `ClientWorld` implementerer den ved at spejle server-snapshots. Rendereren og HUD'en taler kun til `IWorld`, aldrig til en konkret verden, så en ny feature udvider grænsefladen først og derefter begge verdener.
- **Serveren er autoritativ.** Klienter sender intention; serveren beslutter udfald. Klienten afgør aldrig kamp, loot, eller økonomi på egen hånd.

Sim'en er et fast 20 Hz-tick (`DT = 1/20`), al randomness flyder gennem én seedet `Rng`, og `src/sim/` bærer nul DOM-, browser-, eller Three.js-imports. Det er det, der lader den samme kode bundle ind i en Node env-server, en autoritativ game loop, og en browserfane uden at ændre en linje.

### Projektlayout

| Sti | Hvad det er |
|---|---|
| `src/sim/` | Deterministisk spilkerne, kilden til sandhed. Ingen DOM- eller Three-afhængigheder. |
| `src/sim/content/` | Data som kode: de ni klasser, abilities, zoner, dungeons, items, talenter. |
| `src/render/` | Three.js-renderer (procedural geometri, teksturer, VFX). Læser verdenen, muterer den aldrig. |
| `src/game/` | Lokalt input, kamera, keybinds, mobilkontroller, procedural WebAudio. |
| `src/ui/` | Klassisk HUD (frames, vinduer, tooltips, map, floating combat text), procedural ikoner, i18n. |
| `src/net/` | Online-klient: REST-auth plus en WebSocket-verdensspejling (`ClientWorld`). |
| `src/admin/` | Admin-dashboard-SPA (separat `admin.html`-indgang). |
| `server/` | Autoritativ server: HTTP og WS, world loop, Postgres, auth, social, moderation. |
| `headless/` + `python/` | RL env-server (`env_server.ts`) og Python Gym-bindings. |
| `tests/` | Vitest-suite. |
| `scripts/` | Asset-build plus browser-E2E-, screenshot-, og integrationsscripts. |
| `public/` · `docs/` | Statiske assets (GLB-modeller, teksturer, HDRIs) og designdokumenter. |

De fleste mapper bærer deres egen `CLAUDE.md` med lokale konventioner. Det fulde sæt af projekt-invarianter ligger i roden [`CLAUDE.md`](../../CLAUDE.md).

## Bygget som klassikerne

Kamp, leveling, og threat kører alle på autentiske regler fra den klassiske æra: rage og energy, hit- og dodge-tabeller, armor-mitigation, den rigtige XP-kurve, swing timers, og den globale cooldown. Det føles som du husker det, snarere end at approksimere det. De nøjagtige tal ligger i `src/sim/`, hvis du vil læse dem.

Og næsten intet af det er et leveret asset. Verdenen er tegnet fra kode:

- Procedurale byer, skabninger, terræn, vand, vejr, og realtidsskygger, uden 3D-modelfiler til verdenen.
- Tolv riggede skabningsfamilier med fulde walk-, attack-, cast-, sit-, og death-animationer.
- Spell-, item-, og buff-ikoner malet på canvas ved kørselstidspunktet.
- En komplet klassisk HUD (unit frames, action bars, tooltips, quest log, world map, minimap, floating combat text) og procedural WebAudio for hver lyd.

## Udvikling

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

Logik- og unit-tests bruger Vitest. Mens du itererer, kør en enkelt fil: `npx vitest run tests/sim.test.ts`. E2E- og visual-scriptsene driver rigtige browsere via `puppeteer-core` og kræver at `npm run dev` kører (ofte `npm run server` også). Browser-agenter kan drive bevægelse gennem `window.__game.controller` i stedet for at simulere holdte taster, for eksempel `controller.move({ forward: true }, facingRadians)` eller kompakte flags som `{ f: 1, sr: 1 }`.

For server-kommandoerne se [Udvikl online](#develop-online-with-hot-reload) ovenfor, [DEPLOY.md](../../DEPLOY.md) for produktion, og [CREDITS.md](../../CREDITS.md) for asset-licenser.

## Lokalisering

Hver spiller-synlig streng resolver gennem `t()`, og spillet leveres på **21 sprog** (engelsk, to spanske, to franske, engelsk Canada, italiensk, tysk, forenklet og traditionel kinesisk, koreansk, japansk, brasiliansk portugisisk, russisk, hollandsk, polsk, indonesisk, tyrkisk, svensk, vietnamesisk, og dansk). Sim'en og serveren forbliver sprog-agnostiske: de udsender stabile nøgler eller engelsk, som klienten re-lokaliserer ved grænsen, hvilket holder determinismen intakt. Bidragydere tilføjer kun engelsk; vedligeholderen batch-udfylder de andre sprog før hver udgivelse. Workflowet er dokumenteret i `docs/i18n-scaling/translation-workflow.md`.

## Bidrag

Bidrag af enhver art er velkomne: kode, oversættelser, fejlrapporter, og dokumentation. Start med [CONTRIBUTING.md](CONTRIBUTING.da_DK.md) for opsætning, læs [Code of Conduct](../../CODE_OF_CONDUCT.md), og tjek [SECURITY.md](../../SECURITY.md) før du rapporterer en sårbarhed. Ny her? Kig efter issues mærket [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), åbn et [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose), eller sig hej på [Discord](https://discord.com/invite/worldofclaudecraft).

<div align="center">

![World of Claude](../../worldofclaude.png)

![World of ClaudeCraft community](../../woc_community.png)

</div>

## Licens

Koden er [MIT-licenseret](../../LICENSE), så fork den, remix den, og host din egen verden.

De medfølgende tredjeparts-kunstassets (modeller, teksturer, HDRIs) beholder deres egne licenser, alle CC0 public domain undtagen MIT water normal maps, dokumenteret per pakke i [CREDITS.md](../../CREDITS.md).
