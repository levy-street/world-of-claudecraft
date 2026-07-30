<div align="center">

# World of ClaudeCraft

**Quest, group up, and raid a hand-built world, free in your browser. Open source, web3, and online right now.**

**Official website: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.32.0-blue)](package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

**English** · [Español](docs/i18n/README.es.md) · [Español (España)](docs/i18n/README.es_ES.md) · [Français](docs/i18n/README.fr_FR.md) · [Français (Canada)](docs/i18n/README.fr_CA.md) · [Italiano](docs/i18n/README.it_IT.md) · [Deutsch](docs/i18n/README.de_DE.md) · [简体中文](docs/i18n/README.zh_CN.md) · [繁體中文](docs/i18n/README.zh_TW.md) · [한국어](docs/i18n/README.ko_KR.md) · [日本語](docs/i18n/README.ja_JP.md) · [Português (Brasil)](docs/i18n/README.pt_BR.md) · [Русский](docs/i18n/README.ru_RU.md) · [Čeština](docs/i18n/README.cs_CZ.md) · [Nederlands](docs/i18n/README.nl_NL.md) · [Polski](docs/i18n/README.pl_PL.md) · [Bahasa Indonesia](docs/i18n/README.id_ID.md) · [Türkçe](docs/i18n/README.tr_TR.md) · [Svenska](docs/i18n/README.sv_SE.md) · [Tiếng Việt](docs/i18n/README.vi_VN.md) · [Dansk](docs/i18n/README.da_DK.md)

[Play now](https://worldofclaudecraft.com/) · [Host your own world](#host-your-own-world-one-command) · [Train an agent](#train-an-agent-headless-rl) · [Web3](#web3) · [Contributing](CONTRIBUTING.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![World of ClaudeCraft title screen](docs/screenshots/title-screen.jpg)

</div>

## What this is

World of ClaudeCraft is a complete classic-era MMO you can play right now in your browser, host yourself with one command, and even train AI agents to play. It is free, open source, and live at [worldofclaudecraft.com](https://worldofclaudecraft.com/).

One shared world runs in three places, all from the same game core:

- the **authoritative multiplayer server**, the live world you play at worldofclaudecraft.com, where Postgres-backed accounts share one persistent realm,
- the **offline browser world**, a local single-player Sim you get from the dev server, useful for development and for reading the game core end to end,
- the **headless RL env**, where Python drives the real game through a Gym interface.

Same seed, same world, everywhere. Much of what you see is still drawn from code at runtime, and the rest is a curated asset set that ships with the project, so a fork runs out of the box.

## Highlights

- **Nine classic classes**, each with a full classic-era-style kit that gains ranks as you level, plus a full **talent system** (three specs per class, 27 specs in all).
- **Three open-world zones** from level 1 to 20, more than 90 quests, and a single connected storyline about the Gravecaller conspiracy.
- **Five instanced dungeons**, four of them five-player elite raids and one solo crypt, with elite scaling, AoE boss mechanics, class-archetype loot that collects into tier sets, and a **Heroic difficulty tier** with richer rewards, plus open-world **world bosses** and a ten-player raid finale.
- **Two scalable delves**, a small-group mode for one or two players plus an AI companion, rebuilt from randomized chambers each run across Normal and Heroic tiers.
- **Ranked PvP** across two arena maps: 1v1 and 2v2 ladders, a livelier 2v2 Fiesta mode, and **Protect Yumi**, a 3v3 and 5v5 objective mode. Ranked play pays Honor, which buys a PvP-only gear set that never out-scales dungeon loot in PvE.
- **The Vale Cup**, a boarball league played in its own stadium south of Eastbrook, and **Card Duel**, a quick head-to-head card game hosted in town.
- **A Book of Deeds**: an achievement journal of cosmetic titles, badge borders, and Renown, with per-zone Chronicles kept by in-world Chronicler NPCs and a lifetime leaderboard.
- **A deep professions economy**: four gathering trades feed ten crafts, from cooking and alchemy to jewelcrafting, weaponcrafting, and enchanting, with tiered tools, town workstations, masterwork quality, and commissions, all feeding a player-driven **World Market** and the **Ravenpost** mail service.
- **Real multiplayer**: parties and raids, guilds, trading, duels, tap rights, party-split XP, whispers, away status, and a **Dungeon Finder** with role queues and premade listings.
- **Authored in code, not in a 3D editor**: terrain, water, weather, town layouts, real-time shadows, and effects are generated at runtime, and the models that do ship are built by procedural factories and a curated asset library rather than hand-sculpted.
- **Localized into 22 locales** through a deterministic, sim-emits-keys pipeline.
- **A companion wiki at `/wiki`**, generated straight from live game content so it cannot drift from the world it documents.
- **Native apps on every platform**: signed desktop installers for Windows, Linux, and macOS with automatic updates and optional Steam achievement mirroring, plus iOS and Android builds, all sharing the browser client and the same online world.
- **Scales to the machine you have**: graphics presets and an automatic frame-rate governor trade visual richness for smoothness, and are held to a fairness rule that keeps them from ever hiding something a player reacts to.
- **Headless RL environment** with Gymnasium bindings, reward shaping, and a benchmark mode.
- **$WOC utility, fully optional**: link a Solana wallet for holder flair, Daily Rewards, and a discounted payment option in the cosmetic store. The game remains free to play and non-custodial.
- **Season 1 Armory**: collect cosmetic weapon skins through the WOC Store, using Claudium purchased with fiat, SOL, USDC, or $WOC. Cosmetics never provide combat power.

## Screenshots

![The Eastbrook town square, campfire and questgivers](docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Dusk at the Eastbrook campfire](docs/screenshots/eastbrook-dusk.jpg)<br>*Dusk at the Eastbrook campfire* | ![Elite pulls in the Hollow Crypt](docs/screenshots/hollow-crypt.jpg)<br>*Torch-lit elite pulls in the Hollow Crypt* |
| ![The restless dead at the ruined chapel](docs/screenshots/restless-dead.jpg)<br>*The restless dead at the ruined chapel* | ![A brawl with Vale Bandits](docs/screenshots/vale-bandits.jpg)<br>*Outnumbered at the bandit camp* |
| ![Old Greyjaw hunted down on the north road](docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, the rare spawn, run down on the north road* | ![Vendor and bags UI](docs/screenshots/vendor-and-bags.jpg)<br>*Gearing up at Trader Wilkes's, with the vendor and bags open* |
| ![The moongate on the Glimmermere shore](docs/screenshots/glimmermere-moongate.jpg)<br>*The drowned climb out at the Glimmermere moongate* | ![Ysolei on the altar of the Drowned Temple](docs/screenshots/drowned-temple-altar.jpg)<br>*Lunar Tempest and the altar of the Drowned Temple* |

Weather is biome-driven and render-only, so it never touches the deterministic sim:

| | | |
|:---:|:---:|:---:|
| ![Clear skies over Eastbrook Vale](docs/screenshots/weather-vale_clear.jpg)<br>*Clear over the Vale* | ![Rain over Mirefen Marsh](docs/screenshots/weather-marsh_rain.jpg)<br>*Rain over Mirefen Marsh* | ![Snow on Thornpeak Heights](docs/screenshots/weather-peaks_snow.jpg)<br>*Snow on Thornpeak Heights* |

## Play it

Play in your browser at [worldofclaudecraft.com](https://worldofclaudecraft.com/), or install the native app for Windows, Linux, macOS, iOS, or Android. Every client connects to the same online world.

### Online, with other players

Create an account, create a character, and enter the live world. To run that same client/server stack yourself, see [Host your own world](#host-your-own-world-one-command) below.

### Offline, in the dev server

Offline mode is a local single-player world with no account and no server authority, so it ships in development builds only. Run the dev server and it appears in the mode picker:

```bash
npm install
npm run dev        # then open http://localhost:5173 and choose Play Offline
```

Name your character, pick any of the nine classes, and you start in **Eastbrook Vale** (levels 1-7), a market town ringed by hubs: wolf runs to the north, boar meadows east, the Sableweb woods west, Mirror Lake northwest, a burrower-ridden copper dig southwest, and a ruined chapel of restless dead northeast, with Gorrak's bandit camp to the southeast. The north road climbs a mountain pass into **Mirefen Marsh** (6-13, hub Fenbridge) and on up to **Thornpeak Heights** (13-20, hub Highwatch). The world seed is fixed in `src/main.ts`, so it is the same place every visit.

### Desktop apps for Windows, Linux, and macOS

World of ClaudeCraft ships as full desktop apps for all three major desktop platforms: signed Windows installers, Linux AppImage and deb packages, and signed and notarized universal macOS builds. They use the same game client and online world as the browser, with native packaging and automatic updates.

Online sign-in is Discord and email only, exactly the web flow: email/password logs in inside the app, and "Continue with Discord" opens your default browser on the `/desktop-login` page, which hands a one-time code back to the app over a `worldofclaudecraft://` deep link that the app exchanges for a normal World of ClaudeCraft session token.

```bash
npm run electron:dev          # Vite + Electron dev shell
npm run electron:pack         # local unpacked desktop app
npm run electron:build        # website-channel installers (self-updating)
npm run electron:build:steam  # SteamPipe depot layouts (in-app updater off)
```

Point the shell at a different API with `VITE_DESKTOP_API_ORIGIN`, for example a local server or a staging host:

```bash
VITE_DESKTOP_API_ORIGIN=http://127.0.0.1:8787 npm run electron:dev
```

Override the production API origin for staging builds with `VITE_DESKTOP_API_ORIGIN=https://dev.worldofclaudecraft.com` (a BUILD-time value: it is baked into the bundle and stamped into the packaged app, and installed builds ignore it as a runtime env var). Steam is a distribution channel (the same Electron bundle, uploaded via SteamPipe), and desktop players can link a Steam account to mirror the deeds they earn into Steam achievements; sign-in itself stays email and Discord. The full release runbook (signing, notarization, publishing an auto-update, SteamPipe depots, the server deploy) is `docs/desktop-release.md`. iOS and Android ship through Capacitor, with their own runbook in `docs/mobile-store-release.md`.

## Host your own world (one command)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres and the game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

For **remote hosting**, put the compose stack on any VPS, set a real `POSTGRES_PASSWORD` in the environment, and front port 8787 with a TLS reverse proxy. Caddy makes this a handful of lines; WebSockets are proxied automatically and the client auto-selects `wss://` on https pages. Auth endpoints are rate-limited, passwords are scrypt-hashed, and login sessions expire. Never set `ALLOW_DEV_COMMANDS=1` in production, since it enables the full `/dev` cheat set: the level and teleport cheats the test bots use, plus item grants, mob spawns, instance teleports, and the in-game dev command GUI. [DEPLOY.md](DEPLOY.md) is the full production guide, including the reverse-proxy configuration that keeps the health and metrics endpoints off the public edge.

### Develop online with hot reload

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api, /admin/api, and /ws)
```

Open http://localhost:5173, choose **Play Online**, create an account, create a character, and Enter World. The character-select screen shows the latest release news in its News & Updates panel, with NEW badges for anything you have not seen. Open a second tab and log in again to see each other in town. `Enter` opens chat. The player wiki is the in-repo Guide, served at http://localhost:5173/wiki and at `/wiki` in production; its content is generated from current game data by `npm run wiki:content`.

What persists and how the server stays in charge:

- **Accounts**: scrypt-hashed passwords and expiring bearer tokens.
- **Characters**: up to 10 per account per realm; level, gear, bags, bank vault, quests, talents, professions, PvP and deed progress, position, and money persist as JSONB in Postgres, saved on a timer, on logout, and on server shutdown. Names are unique per realm and classic in style.
- **The server is authoritative**: clients stream movement intent and commands at 20 Hz; the server runs the one shared `Sim` and returns interest-scoped snapshots plus per-player events. Every combat roll, loot drop, quest credit, and vendor transaction resolves server-side. The client is a renderer.

## Train an agent (headless RL)

The same deterministic core runs as a [Gymnasium](https://gymnasium.farama.org/) environment, so an agent learns against the actual game, not a reimplementation of it. The env server (`headless/env_server.ts`) wraps one `Sim` and speaks newline-delimited JSON over stdio; the Python bindings in `python/` launch it as a subprocess and expose the usual `reset` / `step` / `close` loop.

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

- **Observation and action spaces are content-derived.** Query them from the env's `info` reply at startup rather than hardcoding; they grow with the game. The action space is a `Discrete` covering movement, target, attack, the full ability kit, interact, and eat/drink; the observation is a `Box` covering self, abilities, target, nearby mobs, the nearest interactable, and quest progress.
- **Reward** is a weighted sum of per-tick counter deltas (XP, damage dealt and taken, kills, deaths, quest progress, level-ups), tunable per reset. Each `step` applies one action and advances five sim ticks by default, so roughly four decisions per simulated second.
- **Deterministic by construction.** No wall clock, no `Math.random`. Seed the reset and the episode replays exactly.

The protocol and bindings are documented in `headless/CLAUDE.md` and `python/CLAUDE.md`.

## Web3

World of ClaudeCraft is web3-native around **$WOC**, our community token on Solana. Connect a Solana wallet, link it to your account with one signature (non-custodial, no transaction to approve), and your read-only $WOC balance shows up in the HUD alongside a cosmetic holder-tier badge.

$WOC also has optional utility in the live game:

- **WOC Store**: buy Claudium, the one-way cosmetic currency, with fiat, SOL, USDC, or $WOC. The $WOC payment rail is discounted against the others.
- **Season 1 Armory**: spend Claudium on cosmetic weapon-skin collections. Store purchases do not add stats or combat power.
- **Daily Rewards**: eligible verified holders can earn points through a daily spin and rotating tasks, then compete for a share of the daily prize pool.

None of this is needed to play. Wallet linking is optional and non-custodial, there is no pay-to-win, and the whole game plays fine without ever connecting a wallet.

**$WOC contract address (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

More on the token at [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## A tour of the world

### The nine classes

Every class runs on classic-era MMO mechanics implemented from first principles, and learns ranked spells across levels 1-20, with signature abilities like Low Blow, Early Grave, Skyfall, Urgent Prayer, and Ancestral Strike unlocking across the back half of the climb.

- **Warrior**: rage, Iron Bellow, Onrush, Quaking Blow, Maiming Strike, Gaping Wounds (a bleed that rides your strikes), Widening Arc, Hobbling Cut, Blood Toll, Redhand (dodge proc).
- **Paladin**: Oathbrand unleashed by Verdict, Mending Light, Steadfast Aura, Oath of Iron, Ward of Faith (absorb), Sundering Gavel (stun), Last Rite.
- **Hunter**: ranged auto-attack (8-35 yd with a classic-style dead zone), Gutting Strike, Harrier's Guise, Venom Barb, Fell Shot, Rattling Shot, Counterfang, Fettering Slash, and a tameable pet from level 10.
- **Rogue**: energy and combo points, Wicked Slash, Dirt Nap, Craven Thrust (behind, dagger), Eye Jab, Ghostfoot, Cutthroat Tempo, Swift Heels.
- **Priest**: Smite, Whispered Prayer, Litany of Resolve, Dirge of Decay, Psalm of Warding (absorb), Lingering Grace (HoT), Mindfracture.
- **Shaman**: Arc Bolt, Stonebound Weapon (imbue), Mending Waters, Earthen Jolt, Thunder Ward (thorns), Cinder Jolt.
- **Mage**: Cinderbolt, Hoarfrost Mantle, Aether Insight, Rimelance, Waterbind, Cinderfall, Aether Darts (channeled), Bewitch, Icebind, a summoned water elemental, and Chronomancy, a time-magic healing spec.
- **Warlock**: Gloom Bolt, Fiendhide, Burning Pact, Blackrot, Hard Bargain, Hex of Anguish, Consume, and seven summonable demons from Emberkin to Wraithborn.
- **Druid**: Wildbolt, Wildmend, Wildward, Lunar Tempest, Wildbloom, Briarguard, Gripping Roots, and shapeshifting into Wolf Form at 5, Bruin Form at 8, and Moonwing Form at 10.

Heals and buffs land on party members, healing can crit, and absorb shields soak damage before health. Spend points across **three talent specs per class** (Battlecraft/Bloodrush/Ironguard, Moongrove/Wildfang/Groveheart, and so on); allocation is server-validated and exportable as a build string.

### Dungeons

The Gravecaller storyline runs through three five-player elite instances, a fourth waits behind a moongate with its own drowned lore, and a solo crypt sits off to the side for explorers.

- **The Hollow Crypt** (5 players) beneath the Fallen Chapel: paired elite trash, the Sexton Marrow miniboss, and Morthen the Gravecaller and his recurring shadow AoE. The crypt door teleports your party into a private instance copy that resets once it empties out.
- **The Sunken Bastion** (5 players, around level 13, southeast Mirefen): Vael the Fogbinder summons waves of Drowned Thralls as the fight wears on.
- **Gravewyrm Sanctum** (5 players, level 20, beneath Thornpeak): three chambers of elite boneguard and scaleguard, Korgath the Bound, Grand Necromancer Velkhar, and Korzul the Gravewyrm, where epic weapons drop.
- **The Drowned Temple** (5 players) through the Glimmermere moongate: a pale, moon-violet instance leading to Choirmother Selthe and then Ysolei, Avatar of the Drowned Moon, whose lunar tides and summoned Moonspawn punish a stationary group.
- **The Abandoned Crypt** (solo) in Thornpeak: a quiet keystone-and-diary dive for one whose trail unseals the royal door to **Nythraxis, Scourge of Thornpeak**, a ten-player raid finale fought across three soul wardstones.

Every instance also runs on **Heroic**: higher-level enemies, sharper mechanics, and its own loot and vendor currency. The lead-up quest chains are soloable, so the story is never gated behind finding a group. Our automated five-bot raid (warrior, paladin, priest, mage, hunter with focus-fire and healer AI) clears the Hollow Crypt in about five minutes (`node scripts/crypt_raid.mjs`, needs `ALLOW_DEV_COMMANDS=1`).

### Delves

Delves are a separate, scalable small-group mode for one or two players, rebuilt from randomized chambers on every run and ending on a locked reliquary chest that opens through a lockpicking minigame rather than a loot roll. **The Collapsed Reliquary** (level 7 and up) ends at Deacon Varric, with an AI companion, Tessa, fighting at your side if you go alone. **The Drowned Litany** (level 12 and up) follows the trail into a flooded shrine at the edge of Mirefen Marsh. A delve board sets the tier: Heroic raises enemy levels and adds a random affix for richer rewards.

### Ranked PvP (the Ashen Coliseum)

Press `G` or the arena button to queue. Matchmaking teleports fighters into a private pit, a short countdown heals and resets everyone for a fair start, and the bout ends when a side yields. Nobody dies, and you return exactly where you queued. Protect Yumi is fought in its own maze rather than the Coliseum pit.

- **1v1 and 2v2 ranked ladders**, each with a persistent Elo-style rating and an all-time leaderboard.
- **2v2 Fiesta**, a livelier party mode where teams race to a takedown target while augment pickups drop power and a closing ring forces the fight together.
- **Protect Yumi**, an unrated 3v3 and 5v5 objective mode fought in a maze: each team guards a cat familiar while trying to bring the other side's down, so escorts and picks matter more than raw kills.

Ranked wins and Fiesta takedowns pay **Honor**, which the quartermaster in town trades for a set of Warfare gear. Warfare is a PvP-only stat, so the set wins duels without ever out-gearing same-tier dungeon loot in PvE.

### Playing together

- **Dungeon Finder**: open it with `Shift+I` to browse dungeons and raids, inspect bosses and loot, join an automatic tank/healer/DPS role queue, or create a premade listing. Finder-made groups still travel to the entrance together.
- **Parties** up to 5, converted into a 10-player raid of two groups once you are full: right-click a player and Invite to Party. Members share tap rights and quest credit, split XP with the classic-era group bonuses, and show up as blips on the minimap. `/p` for party chat, `/roll` to settle loot.
- **Trading**: right-click and Trade. Both sides stage items and money, both must accept, and the swap is atomic and server-validated. Quest items cannot be traded, and walking apart cancels.
- **Duels**: right-click and Challenge to a Duel. A 3-second countdown, then fight until one side hits 1 hp; the winner is announced zone-wide and running 60 yards away forfeits.
- **Tap rights and away status**: the first player to damage a mob owns its loot, XP, and quest credit; `/afk` and `/dnd` mark you away with an auto-reply to whispers.

### World and systems

- **Professions** (`Shift+P`): four gathering trades (mining, logging, herbalism, fishing) feed ten crafts, from cooking and alchemy to weaponcrafting, jewelcrafting, and enchanting. Gathering tools come in tiers that decide which nodes you can work, crafting runs at town workstations with a chance at masterwork quality that carries your maker's mark, and there is an archetype system to discover as you specialize.
- **The World Market**: a player-driven auction house for gear, materials, and consumables, browsable from the hub towns.
- **Ravenpost mail**: send items and coin to other characters, with attachments held safely until claimed.
- **Guilds**: charters, rosters, ranks, and guild chat.
- **The Guide**: a searchable in-site wiki at `/wiki` covering classes, creatures, zones, and deeds, generated straight from live game content so it cannot drift from the world it documents.
- **The Vale Cup and Card Duel**: boarball at the Sowfield stadium south of Eastbrook, in formats from 1v1 to 5v5, and a quick head-to-head card game hosted by the Card Master in town.
- **Daily Rewards**: verified $WOC holders can earn leaderboard points from a daily spin and rotating tasks, with automatic payouts from the daily prize pool.
- **WOC Store and Season 1 Armory**: buy Claudium with fiat, SOL, USDC, or $WOC, then spend it on purely cosmetic weapon skins.
- **Eating and drinking**: sit to restore, broken by damage or standing, and yes, you can eat and drink at once.
- **Vendors** that buy food and water and sell honest white gear, with coin shown in gold, silver, and copper.
- **A personal bank** (the Gilded Strongbox): bursars in each hub town keep a vault per character, from 24 slots up to 96 with coin-bought expansions, plus bonus slots earned online for a verified email, linked accounts, and referrals.
- **The Book of Deeds**: an achievement journal (default `Shift+Z`) of quests, kills, clears, and delights, paying out cosmetic titles you can wear on your nameplate, in chat, and on the boards, plus a HUD tracker for the deeds you are chasing, per-zone Chronicles kept by Chronicler NPCs, and a lifetime Renown leaderboard; the public list lives at `/wiki/deeds`.
- **Mob AI**: wander, proximity aggro by level difference, social pulls, chase, leash and reset, corpse loot, and respawns, with a rare spawn (Old Greyjaw) on a long timer.
- **Fishing** spots with their own loot tables and rare catches.
- **Cosmetic skins** rolled at uncommon, rare, and epic rarity, purely for looks.
- **Death and recovery**: release your spirit to the graveyard, take falling damage, and slow down while swimming.
- **Biome weather**: clear in the Vale, rain in the Marsh, snow on the Peaks, cross-fading as you move between zones.

### Controls (classic layout)

| Input | Action |
|---|---|
| `W` / `S` | run / backpedal. `A`/`D` turn (strafe with right mouse held), `Q`/`E` strafe |
| right-drag / left-drag | mouselook / orbit camera. Wheel zooms, `Space` jumps |
| `Tab` | cycle nearest enemies. left-click to target, right-click to attack, loot, or talk |
| `1`-`9`, `0`, `-`, `=` | action bar |
| `F` | interact (loot a corpse, pick up an object, talk) |
| `C` `P` `L` `M` `B` `N` `T` | character, spellbook, quest log, world map, bags, talents, crafting |
| `G` `O` `K` `I` `Y` `Shift+I` `Shift+P` `Shift+Z` | arena, friends and guild, leaderboard, calendar, Vale Cup, Dungeon Finder, professions, deeds |
| `Z` / `X` | sheath or draw your weapons, emote wheel |
| `V` / `R` / `Esc` | nameplates, autorun, close the top window (or open the game menu) |

Every binding is remappable in the keybinds panel. Touch controls (a movement stick, camera drag, and on-screen action buttons) come up automatically on mobile.

## Architecture (one sim, three hosts)

Three ideas hold the project together:

- **One sim, three hosts.** The same `src/sim/` code runs the offline browser world, the online server, and the RL env. Behavior must be identical everywhere, and the tests exist to keep it that way.
- **`IWorld` is the only seam.** `IWorld` is defined as per-domain facet interfaces under `src/world_api/`, aggregated by `src/world_api.ts`. The offline `Sim` satisfies it structurally and the online `ClientWorld` implements it by mirroring server snapshots. The renderer and HUD talk only to `IWorld`, never to a concrete world, so a new feature extends the matching facet first and then both worlds.
- **The server is authoritative.** Clients send intent; the server decides outcomes. The client never resolves combat, loot, or economy on its own.

The sim is a fixed 20 Hz tick (`DT = 1/20`), all randomness flows through one seeded `Rng`, and `src/sim/` carries zero DOM, browser, or Three.js imports. That is what lets the same code bundle into a Node env server, an authoritative game loop, and a browser tab without changing a line.

### Project layout

| Path | What it is |
|---|---|
| `src/sim/` | Deterministic game core, the source of truth. No DOM or Three dependencies. |
| `src/sim/content/` | Data as code: the nine classes, abilities, zones, dungeons, delves, items, recipes, enchants, talents, professions, deeds. |
| `src/world_api.ts` + `src/world_api/` | `IWorld`, the seam the renderer and HUD depend on: one facet interface per domain. |
| `src/` (rest) | Three.js renderer, HUD + styles, input/audio, online mirror, and the admin, guide, and editor SPAs. |
| `server/` | Authoritative server: HTTP and WS, world loop, Postgres, auth, social, moderation. |
| `server/http/` | The REST request pipeline: table router, middleware, and per-domain route definitions. |
| `headless/` + `python/` | RL env server (`env_server.ts`) and Python Gym bindings. |
| `bot/` | Discord bot (roles, relay, activity feed). |
| `electron/`, `android/`, `ios/` | Desktop (Steam) and native mobile shells. |
| `tests/` | Vitest suite. |
| `scripts/` | Build, asset, i18n, SFX, screenshot, and browser E2E tooling. |
| `deploy/` · `mediawiki/` | Production first-boot assets and the player-wiki container. |
| `public/` · `docs/` | Static assets (deployed verbatim to the site) and design docs. |

None of this is honour-system: `tests/architecture.test.ts` scans every sim file for a
forbidden import, a DOM global, or a stray clock or `Math.random` call, and
`tests/world_api_parity.test.ts` pins the seam so the two worlds cannot drift.

Most directories carry their own `CLAUDE.md` with local conventions, and the full set of
project invariants lives in the root [`CLAUDE.md`](CLAUDE.md). Agent contributors start
there, then pick up their runtime's entry point: [`AGENTS.md`](AGENTS.md) plus the
[Codex operator guide](docs/codex.md) for Codex, [`GEMINI.md`](GEMINI.md) for Gemini. All
of them route into the same canonical architecture.

## Built like the classics

Combat, leveling, and threat all run on authentic classic-era rules: rage and energy, hit and dodge tables, armor mitigation, the real XP curve, swing timers, and the global cooldown. It feels the way you remember rather than approximating it. The exact numbers live in `src/sim/` if you want to read them.

The world is authored in code rather than in a 3D editor, which is what keeps it small,
deterministic, and easy to fork:

- Terrain, water, weather, sky, town layouts, real-time shadows, and combat effects are generated at runtime from the sim's own data.
- The models that do ship are built the same way: procedural factories under `scripts/assets/` export deterministic GLBs through the project's image-to-GLB pipeline, alongside a curated library of CC0 model kits. Rigged creature and character families carry full walk, attack, cast, sit, and death animations.
- Icons are a layered painter that composes art for anything without a shipped file, so nothing is ever missing an icon, with curated painted art layered on top for abilities, items, and deeds.
- A complete classic HUD (unit frames, action bars, tooltips, quest log, world map, minimap, floating combat text, the Book of Deeds), sampled spatial and interface sound effects, and a soundtrack composed procedurally in the repo and shipped as streamed remasters that crossfade between zones, towns, dungeons, and combat.

Every shipped asset and its license is recorded in [CREDITS.md](CREDITS.md), and bundled
third-party dependencies carry their notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Development

Besides the game client, the build produces the operator dashboard, the world editor at
`/editor`, and the public Guide at `/wiki`, all served from the same dev server.

Every FFmpeg path the gate and the audio tests exercise resolves the bundled
`ffmpeg-static`/`ffprobe-static` npm packages, so a normal contribution needs no system
FFmpeg install. The conformance-measuring paths (`npm run sfx:check`, the audio tests, the
Studio's export validation) bind to the static binaries directly, with no `PATH` fallback:
rerun `npm ci` if a scripts-skipped install left them missing. The Studio's playback and
encode spawns and the `npm run gate` preflight resolve via `scripts/sfx/ffmpeg_paths.mjs`,
which does fall back to `PATH`. Some standalone audio generator scripts (for example
`scripts/gen_ui_sfx.mjs`) still default to `PATH` `ffmpeg`.

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

Logic and unit tests use Vitest. While iterating, run a single file: `npx vitest run tests/sim.test.ts`. Interface changes also have an opt-in real-browser suite covering accessibility, keyboard navigation, and touch targets: `npm run test:browser`. The screenshot and smoke scripts drive real browsers via `puppeteer-core` and need `npm run dev` running; the wire-level scripts (`mp_integration.mjs`, `social_e2e.mjs`, `crypt_raid.mjs`) talk to the server directly and need `npm run server` instead. Browser agents can drive movement through `window.__game.controller` instead of simulating held keys, for example `controller.move({ forward: true }, facingRadians)` or compact flags like `{ f: 1, sr: 1 }`.

Checks run in layers, described in [docs/qa-gate.md](docs/qa-gate.md): point your clone at
the shared hooks with `git config core.hooksPath .githooks` and a fast floor runs before
anything leaves your machine.

For the server commands see [Develop online](#develop-online-with-hot-reload) above,
[CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow, the
[SFX Studio tutorial](docs/sfx-studio-tutorial.md) for sound authoring and
artifact export, [DEPLOY.md](DEPLOY.md) for production, and
[CREDITS.md](CREDITS.md) for asset licenses.

## Localization

Every player-visible string resolves through `t()`, and the game ships in **22 locales** (English, two Spanish, two French, English Canada, Italian, German, Simplified and Traditional Chinese, Korean, Japanese, Brazilian Portuguese, Russian, Czech, Dutch, Polish, Indonesian, Turkish, Swedish, Vietnamese, and Danish). The sim and server stay language-agnostic: they emit stable keys or English that the client re-localizes at the boundary, which keeps determinism intact. Contributors add English only; the maintainer batch-fills the other locales before each release. The workflow is documented in `docs/i18n-scaling/translation-workflow.md`.

## Contributing

Contributions of every kind are welcome: code, translations, bug reports, and documentation. Start with [CONTRIBUTING.md](CONTRIBUTING.md) for setup, read the [Code of Conduct](CODE_OF_CONDUCT.md), and check [SECURITY.md](SECURITY.md) before reporting a vulnerability. New here? Look for issues labeled [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), open an [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose), or say hello on [Discord](https://discord.com/invite/worldofclaudecraft).

Active development runs on the newest `release/vX.Y.Z` branch. Look it up rather than assuming, then branch from it and target it with your pull request. Never branch from or target `main`, which only receives a release branch once that version ships. [CONTRIBUTING.md](CONTRIBUTING.md) has the one-line command that finds the current one.

## License

**The code is [MIT licensed](LICENSE), so fork it, remix it, and host your own world.** That is the whole point, and nothing else on this page or on our website takes it back.

Three things are licensed separately, so it is worth thirty seconds to know which is which:

| What | License | Can you redistribute it? |
|---|---|---|
| **Source code**, meaning all of it except the media assets carved out below | [MIT](LICENSE) | Yes. Commercially too. |
| **Media assets**: models, textures, HDRIs, icons, sounds, fonts (mostly under `public/`) | Per asset, recorded in [CREDITS.md](CREDITS.md) | Mostly yes (most are CC0). Some are not, see below. |
| **Name and branding**: "World of ClaudeCraft", "Levy Street", the logos | Not licensed | No. |

**Fork it and host your own world. That works, and the assets are not in your way.** Most of what you see is CC0 public domain (KayKit, Quaternius, Kenney, ambientCG, Poly Haven), and our own generated props, creatures, backdrops and interface sounds ship with the project so a fork runs out of the box. You just can't lift those out and sell them as standalone art.

What you would need to remove or replace before redistributing:

- the **CraftPix class ability icons** under `public/ui/skills/` were purchased by Levy Street and **may not be redistributed**, so buy your own licence if you want to ship them;
- the **@jamiecypher sound effects** are CC BY-NC 4.0, so share them non-commercially with credit, but the commercial grant runs to this project only;
- the **store and prestige art** (Season 1 Armory, the Claudium set, the professions art set, Book of Deeds icons, the elite dragon emblem) is commissioned commercial art and **rights are reserved**;
- the **third-party brand marks** (Twitch, X, Kick, YouTube, Discord, Solana, USDC) are trademarks of their owners and are not ours to license on;
- a handful of **icons and recordings used with permission** need permission to pass on.

[CREDITS.md](CREDITS.md) is the authoritative list, with a redistribution column per asset. Where an asset is listed there, that license controls over the project's MIT license. That register is still being completed, so a media asset missing from it is unrecorded rather than free: ask before relying on it. Source code is the other way around, and everything not carved out is MIT.

Our [Terms of Service](https://worldofclaudecraft.com/terms) cover the hosted game that we run at worldofclaudecraft.com: accounts, conduct, virtual items. They do not restrict the rights the MIT License gives you in this source code.
