<div align="center">

# World of ClaudeCraft

**Quest, group up, and raid a hand-built world, free in your browser. Open source, web3, and online right now.**

**Official website: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r185-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.27.0-blue)](package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

**English** · [Español](docs/i18n/README.es.md) · [Español (España)](docs/i18n/README.es_ES.md) · [Français](docs/i18n/README.fr_FR.md) · [Français (Canada)](docs/i18n/README.fr_CA.md) · [Italiano](docs/i18n/README.it_IT.md) · [Deutsch](docs/i18n/README.de_DE.md) · [简体中文](docs/i18n/README.zh_CN.md) · [繁體中文](docs/i18n/README.zh_TW.md) · [한국어](docs/i18n/README.ko_KR.md) · [日本語](docs/i18n/README.ja_JP.md) · [Português (Brasil)](docs/i18n/README.pt_BR.md) · [Русский](docs/i18n/README.ru_RU.md) · [Nederlands](docs/i18n/README.nl_NL.md) · [Polski](docs/i18n/README.pl_PL.md) · [Bahasa Indonesia](docs/i18n/README.id_ID.md) · [Türkçe](docs/i18n/README.tr_TR.md) · [Svenska](docs/i18n/README.sv_SE.md) · [Tiếng Việt](docs/i18n/README.vi_VN.md) · [Dansk](docs/i18n/README.da_DK.md)

[Play now](https://worldofclaudecraft.com/) · [Host your own world](#host-your-own-world-one-command) · [Train an agent](#train-an-agent-headless-rl) · [Web3](#web3) · [Contributing](CONTRIBUTING.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![World of ClaudeCraft title screen](docs/screenshots/title-screen.jpg)

</div>

## What this is

World of ClaudeCraft is a complete classic-era MMO you can play right now in your browser, host yourself with one command, and even train AI agents to play. It is free, open source, and live at [worldofclaudecraft.com](https://worldofclaudecraft.com/).

One shared world runs in three places, all from the same game core:

- the **offline browser world**, where you click Play Offline and you are in,
- the **authoritative multiplayer server**, where Postgres-backed accounts share a live world,
- the **headless RL env**, where Python drives the real game through a Gym interface.

Same seed, same world, everywhere. And almost nothing is a shipped asset: the towns, creatures, spell icons, and sound are all generated at runtime.

## Highlights

- **Nine classic classes**, each with a full classic-era-style kit that gains ranks as you level, plus a full **talent system** (three specs per class, 27 specs in all).
- **Three open-world zones** from level 1 to 20, nearly 80 quests, and a single connected storyline about the Gravecaller conspiracy.
- **Five instanced dungeons**, four of them five-player elite raids and one solo crypt, with elite scaling, AoE boss mechanics, class-archetype loot, and a **Heroic difficulty tier** with richer rewards, plus open-world **world bosses**.
- **Scalable delves**, a small-group mode for one or two players plus an AI companion, rebuilt from randomized chambers each run across Normal and Heroic tiers.
- **The Ashen Coliseum**, a ranked PvP arena with 1v1 and 2v2 ladders plus a 2v2 Fiesta mode (augment pickups, a shrinking ring, first to fifteen takedowns), and the **Vale Cup**, a seasonal boarball tournament.
- **A Book of Deeds**: an achievement journal of cosmetic titles, badge borders, and Renown, with per-zone Chronicles kept by in-world Chronicler NPCs and a lifetime leaderboard.
- **Professions**: gathering nodes across every zone, crafting stations in town, and deeper trades to discover, feeding a player-driven **World Market** and the **Ravenpost** mail service.
- **Real multiplayer**: parties, guilds, trading, duels, tap rights, party-split XP, whispers, away status, and a **Dungeon Finder** with role queues and premade listings.
- **Procedural everything**: timber-framed towns, rigged creature families, painted spell icons drawn on canvas, WebAudio sound, biome weather, and real-time shadows. No 3D model files for the world.
- **Localized into 22 locales** through a deterministic, sim-emits-keys pipeline.
- **Full desktop apps for Windows, Linux, and macOS**, with native installers, automatic updates, and the same online world as the browser.
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

Play in your browser or install the full desktop app for Windows, Linux, or macOS. Every client connects to the same online world.

### Offline, in your browser

```bash
npm install
npm run dev        # then open http://localhost:5173 and click Play Offline
```

Name your character, pick any of the nine classes, and you start in **Eastbrook Vale** (levels 1-7), a market town ringed by six hubs: wolf runs to the north, boar meadows east, the Webwood west, Mirror Lake northwest, a burrower-ridden copper dig southwest, and a ruined chapel of restless dead northeast, with Gorrak's bandit camp to the southeast. The north road climbs a mountain pass into **Mirefen Marsh** (6-13, hub Fenbridge) and on up to **Thornpeak Heights** (13-20, hub Highwatch). The world seed is fixed in `src/main.ts`, so it is the same place every visit.

### Online, with other players

See [Host your own world](#host-your-own-world-one-command) below to stand up the real client/server game with accounts and persistent characters.

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

Override the production API origin for staging builds with `VITE_DESKTOP_API_ORIGIN=https://dev.worldofclaudecraft.com` (a BUILD-time value: it is baked into the bundle and stamped into the packaged app, and installed builds ignore it as a runtime env var). Steam is a distribution channel only (the same Electron bundle, uploaded via SteamPipe); there is no Steam sign-in. The full release runbook (signing, notarization, publishing an auto-update, SteamPipe depots, the server deploy) is `docs/desktop-release.md`.

## Host your own world (one command)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres + game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

For **remote hosting**, put the compose stack on any VPS, set a real `POSTGRES_PASSWORD` in the environment, and front port 8787 with a TLS reverse proxy. Caddy makes this two lines (`your.domain { reverse_proxy localhost:8787 }`); WebSockets are proxied automatically and the client auto-selects `wss://` on https pages. Auth endpoints are rate-limited per IP, passwords are scrypt-hashed, and tokens expire after 7 days. Never set `ALLOW_DEV_COMMANDS=1` in production, since it enables the full `/dev` cheat set: the level and teleport cheats the test bots use, plus item grants, mob spawns, instance teleports, and the in-game dev command GUI. See [DEPLOY.md](DEPLOY.md) for the full production guide.

### Develop online with hot reload

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api and /ws)
```

Open http://localhost:5173, choose **Play Online**, create an account, create a character, and Enter World. A Welcome Screen greets you while the realm connection establishes behind it: the latest release news with NEW badges for anything you have not seen, a Join our Discord strip, and, on the desktop web client, Daily Rewards and Season 1 Armory tiles; Continue enables once the connection is ready, and offline play opens through the same screen. Open a second tab and log in again to see each other in town. `Enter` opens chat. A real MediaWiki player wiki comes up alongside the Docker Compose stack at http://localhost:8080/wiki/; its seed pages are generated from current game content with `npm run wiki:seed`.

What persists and how the server stays in charge:

- **Accounts**: scrypt-hashed passwords and 7-day bearer tokens (`auth_tokens`).
- **Characters**: up to 10 per account; level, gear, bags, bank vault, quests, talents, position, and money persist as JSONB in Postgres, saved every 30 seconds, on logout, and on server shutdown. Names are globally unique, letters only, classic style.
- **The server is authoritative**: clients stream movement intent and commands at 20 Hz; the server runs the one shared `Sim` and returns interest-scoped snapshots (~120 yd) plus per-player events. Every combat roll, loot drop, quest credit, and vendor transaction resolves server-side. The client is a renderer.

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

- **WOC Store**: buy Claudium, the one-way cosmetic currency, with fiat, SOL, USDC, or $WOC. The $WOC payment rail receives a service-quoted discount.
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

Every class runs on classic-era MMO mechanics implemented from first principles, and learns ranked spells across levels 1-20 (Arc Bolt R2 at 8, R3 at 14, R4 at 20, with high-band abilities like Early Grave, Low Blow, Urgent Prayer, Ancestral Strike, and Skyfall arriving near the top of the band).

- **Warrior**: rage, Reaver Strike (on-next-swing, off-GCD), Iron Bellow, Onrush, Deep Gash, Quaking Blow, Hobbling Cut, Blood Toll, Redhand (dodge proc).
- **Paladin**: Oathbrand unleashed by Verdict, Mending Light, Steadfast Aura, Oath of Iron, Ward of Faith (absorb), Sundering Gavel (stun), Last Rite.
- **Hunter**: ranged auto-attack (8-35 yd with a classic-style dead zone), Gutting Strike, Harrier's Guise, Venom Barb, Fell Shot, Rattling Shot, Counterfang, Fettering Slash, and a tameable pet from level 10.
- **Rogue**: energy and combo points, Wicked Slash, Dirt Nap, Craven Thrust (behind, dagger), Eye Jab, Ghostfoot, Cutthroat Tempo, Swift Heels.
- **Priest**: Smite, Whispered Prayer, Litany of Resolve, Dirge of Decay, Psalm of Warding (absorb), Lingering Grace (HoT), Mindfracture.
- **Shaman**: Arc Bolt, Stonebound Weapon (imbue), Mending Waters, Earthen Jolt, Thunder Ward (thorns), Cinder Jolt.
- **Mage**: Cinderbolt, Hoarfrost Mantle, Aether Insight, Rimelance, Waterbind, Cinderfall, Aether Darts (channeled), Bewitch, Icebind.
- **Warlock**: Gloom Bolt, Fiendhide, Burning Pact, Blackrot, Hard Bargain, Hex of Anguish, Consume, and seven summonable demons from Emberkin to Wraithborn.
- **Druid**: Wildbolt, Wildmend, Wildward, Lunar Tempest, Wildbloom, Briarguard, Gripping Roots, Bruin Form at 10.

Heals and buffs land on party members, healing can crit, and absorb shields soak damage before health. Spend points across **three talent specs per class** (Battlecraft/Bloodrush/Ironguard, Moongrove/Wildfang/Groveheart, and so on); allocation is server-validated and exportable as a build string.

### Dungeons

The Gravecaller storyline runs through four five-player elite instances, and a solo crypt sits off to the side for explorers.

- **The Hollow Crypt** (5 players) beneath the Fallen Chapel: paired elite trash, the Sexton Marrow miniboss, and Morthen the Gravecaller, who drops a Shadow Pulse AoE every ten seconds. The crypt door teleports your party into a private instance copy that resets after five minutes empty.
- **The Sunken Bastion** (5 players, around level 13, southeast Mirefen): Vael the Mistcaller summons waves of Drowned Thralls at 60% and 30% health.
- **Gravewyrm Sanctum** (5 players, level 20, beneath Thornpeak): three chambers of elite boneguard and scaleguard, Korgath the Bound (enrages below 30%), Grand Necromancer Velkhar, and Korzul the Gravewyrm, where epic weapons drop.
- **The Drowned Temple** (5 players) through the Glimmermere moongate: a pale, moon-violet instance leading to Choirmother Selthe and then Ysolei, Avatar of the Drowned Moon, who pulses Lunar Tide every nine seconds and summons Moonspawn at 60% and 30%.
- **The Abandoned Crypt** (solo) in Thornpeak: a quiet keystone-and-diary dive for one whose trail unseals the royal door to **Nythraxis, Scourge of Thornpeak**, a ten-player raid finale fought across three soul wardstones.

The lead-up quest chains are soloable, so the story is never gated behind finding a group. Our automated five-bot raid (warrior, paladin, priest, mage, hunter with focus-fire and healer AI) clears the Hollow Crypt in about five minutes (`node scripts/crypt_raid.mjs`, needs `ALLOW_DEV_COMMANDS=1`).

### Delves

Delves are a separate, scalable small-group mode for one or two players. **The Collapsed Reliquary** (level 7 and up) is a crypt rebuilt from randomized chambers on every run, ending at Deacon Varric. Solo it and an AI companion, Tessa, fights at your side. Brother Halven at the reliquary ruin runs the delve board, where Normal or Heroic is your call: Heroic raises enemy levels and adds a random affix for richer rewards.

### The Ashen Coliseum (ranked PvP)

Press `G` or the arena button to queue. Matchmaking teleports fighters into a private, torch-lit pit, a short countdown heals and resets everyone for a fair start, and the bout ends when a side yields at 1 hp. Nobody dies, and you return exactly where you queued.

- **1v1 and 2v2 ranked ladders**, each with a persistent Elo-style rating (everyone starts at 1500) and an all-time leaderboard (`GET /api/arena/leaderboard`).
- **2v2 Fiesta**, a livelier party mode: first team to fifteen takedowns wins inside a six-minute cap, players respawn on growing timers, augment pickups drop power across three waves, and a closing ring forces the fight together.

### Playing together

- **Dungeon Finder**: open it with `Shift+I` to browse dungeons and raids, inspect bosses and loot, join an automatic tank/healer/DPS role queue, or create a premade listing. Finder-made groups still travel to the entrance together.
- **Parties** up to 5: right-click a player and Invite to Party. Members share tap rights and quest credit, split XP with the classic-era group bonuses (1.166 / 1.3 / 1.43 for 3/4/5), and show up as blips on the minimap. `/p` for party chat, `/roll` to settle loot.
- **Trading**: right-click and Trade. Both sides stage items and money, both must accept, and the swap is atomic and server-validated. Quest items cannot be traded, and walking apart cancels.
- **Duels**: right-click and Challenge to a Duel. A 3-second countdown, then fight until one side hits 1 hp; the winner is announced zone-wide and running 60 yards away forfeits.
- **Tap rights and away status**: the first player to damage a mob owns its loot, XP, and quest credit; `/afk` and `/dnd` mark you away with an auto-reply to whispers.

### World and systems

- **Professions**: gather from ore, herb, and timber nodes seeded across every zone, craft at hub-town stations, and trade the results; there are deeper trades (and an archetype system) to discover in play.
- **The World Market**: a player-driven auction house for gear, materials, and consumables, browsable from the hub towns.
- **Ravenpost mail**: send items and coin to other characters, with attachments held safely until claimed.
- **Guilds**: charters, rosters, ranks, and guild chat.
- **Daily Rewards**: verified $WOC holders can earn leaderboard points from a daily spin and rotating tasks, with automatic payouts from the daily prize pool.
- **WOC Store and Season 1 Armory**: buy Claudium with fiat, SOL, USDC, or $WOC, then spend it on purely cosmetic weapon skins.
- **Eating and drinking**: sit to restore over 18 seconds, broken by damage or standing, and yes, you can eat and drink at once.
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
| `C` `P` `L` `M` `B` `G` `Shift+I` `Shift+Z` | character, spellbook, quest log, world map, bags, arena, Dungeon Finder, deeds |
| `Z` | sheath or draw your weapons |
| `V` / `R` / `Esc` | nameplates, autorun, close windows or clear target |

Touch controls (a movement stick, camera drag, and on-screen action buttons) come up automatically on mobile.

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
| `src/sim/content/` | Data as code: the nine classes, abilities, zones, dungeons, items, talents, professions, deeds. |
| `src/` (rest) | Three.js renderer, HUD + styles, input/audio, online mirror, and the admin, guide, and editor SPAs. |
| `server/` | Authoritative server: HTTP and WS, world loop, Postgres, auth, social, moderation. |
| `headless/` + `python/` | RL env server (`env_server.ts`) and Python Gym bindings. |
| `bot/` | Discord bot (roles, relay, activity feed). |
| `electron/`, `android/`, `ios/` | Desktop (Steam) and native mobile shells. |
| `tests/` | Vitest suite. |
| `scripts/` | Build, asset, i18n, SFX, screenshot, and browser E2E tooling. |
| `public/` · `docs/` | Static assets (deployed verbatim to the site) and design docs. |

Most directories carry their own `CLAUDE.md` with local conventions. The full set of
project invariants lives in the root [`CLAUDE.md`](CLAUDE.md). Codex contributors start
with [`AGENTS.md`](AGENTS.md) and the [Codex operator guide](docs/codex.md); those files
route into the same canonical architecture without changing the Claude Code setup.

## Built like the classics

Combat, leveling, and threat all run on authentic classic-era rules: rage and energy, hit and dodge tables, armor mitigation, the real XP curve, swing timers, and the global cooldown. It feels the way you remember rather than approximating it. The exact numbers live in `src/sim/` if you want to read them.

And almost none of it is a shipped asset. The world is drawn from code:

- Procedural towns, creatures, terrain, water, weather, and real-time shadows, with no 3D model files for the world.
- Rigged creature families with full walk, attack, cast, sit, and death animations.
- Spell, item, and buff icons painted on canvas at runtime.
- A complete classic HUD (unit frames, action bars, tooltips, quest log, world map, minimap, floating combat text, the Book of Deeds), sampled spatial/UI sound effects, and a procedural soundtrack.

## Development

All FFmpeg consumers use the bundled `ffmpeg-static`/`ffprobe-static` npm packages, so no
system FFmpeg install is needed. The conformance-measuring paths (`npm run sfx:check`, the
audio tests, the Studio's export validation) bind to the static binaries directly, with no
`PATH` fallback: rerun `npm ci` if a scripts-skipped install left them missing. The Studio's
playback/encode spawns and the `npm run gate` preflight resolve via
`scripts/sfx/ffmpeg_paths.mjs`, which does fall back to `PATH`. Some standalone audio
generator scripts (for example `scripts/gen_ui_sfx.mjs`) still default to `PATH` `ffmpeg`.

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

Logic and unit tests use Vitest. While iterating, run a single file: `npx vitest run tests/sim.test.ts`. The E2E and visual scripts drive real browsers via `puppeteer-core` and need `npm run dev` running (often `npm run server` too). Browser agents can drive movement through `window.__game.controller` instead of simulating held keys, for example `controller.move({ forward: true }, facingRadians)` or compact flags like `{ f: 1, sr: 1 }`.

For the server commands see [Develop online](#develop-online-with-hot-reload) above,
the [SFX Studio tutorial](docs/sfx-studio-tutorial.md) for sound authoring and
artifact export, [DEPLOY.md](DEPLOY.md) for production, and
[CREDITS.md](CREDITS.md) for asset licenses.

## Localization

Every player-visible string resolves through `t()`, and the game ships in **22 locales** (English, two Spanish, two French, English Canada, Italian, German, Simplified and Traditional Chinese, Korean, Japanese, Brazilian Portuguese, Russian, Czech, Dutch, Polish, Indonesian, Turkish, Swedish, Vietnamese, and Danish). The sim and server stay language-agnostic: they emit stable keys or English that the client re-localizes at the boundary, which keeps determinism intact. Contributors add English only; the maintainer batch-fills the other locales before each release. The workflow is documented in `docs/i18n-scaling/translation-workflow.md`.

## Contributing

Contributions of every kind are welcome: code, translations, bug reports, and documentation. Start with [CONTRIBUTING.md](CONTRIBUTING.md) for setup, read the [Code of Conduct](CODE_OF_CONDUCT.md), and check [SECURITY.md](SECURITY.md) before reporting a vulnerability. New here? Look for issues labeled [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), open an [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose), or say hello on [Discord](https://discord.com/invite/worldofclaudecraft).

<div align="center">

![World of Claude](worldofclaude.png)

![World of ClaudeCraft community](woc_community.png)

</div>

## License

The code is [MIT licensed](LICENSE), so fork it, remix it, and host your own world.

The bundled third-party art assets (models, textures, HDRIs, fonts) keep their own licenses, mostly CC0 public domain, documented per pack in [CREDITS.md](CREDITS.md). Original sound recordings contributed by individual authors may carry their own terms (see the Audio section of [CREDITS.md](CREDITS.md)) rather than the project's default license.
