# World of Claudecraft — a WoW-Classic-style MMO

[Join the community Discord](https://discord.gg/GjhnUsBtw)

![World of Claudecraft title screen](docs/screenshots/title-screen.jpg)

A vanilla-WoW-flavored micro-MMO you can host and play:

1. **Play it online** — a real client/server game with accounts, persistent
   characters in Postgres, and other players in the world with you.
2. **Play it offline** in your browser to jump straight into the world.

Both run the **same deterministic simulation core** (`src/sim/`), so the
offline world behaves identically to what the authoritative multiplayer server
runs for everyone online.

## Screenshots

![A party gathers outside the apothecary in Eastbrook](docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Dusk at the Eastbrook campfire](docs/screenshots/eastbrook-dusk.jpg)<br>*Dusk at the Eastbrook campfire* | ![Elite pulls in the Hollow Crypt](docs/screenshots/hollow-crypt.jpg)<br>*Torch-lit elite pulls in the Hollow Crypt* |
| ![The restless dead at the ruined chapel](docs/screenshots/restless-dead.jpg)<br>*The restless dead at the ruined chapel* | ![A brawl with Vale Bandits](docs/screenshots/vale-bandits.jpg)<br>*Outnumbered at the bandit camp* |
| ![Old Greyjaw hunted down on the north road](docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, the rare spawn, run down on the north road* | ![Vendor and bags UI](docs/screenshots/vendor-and-bags.jpg)<br>*Gearing up at Smith Haldren's — tooltips, bags, coin* |

![World of Claude](worldofclaude.png)

![World of Claudecraft community](woc_community.png)

---

## Host it (one command)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres + game server, fully built
# open http://localhost:8787 — accounts, characters, the whole world
```

For **remote hosting**: put the compose stack on any VPS, set a real
`POSTGRES_PASSWORD` in the environment, and front port 8787 with a TLS
reverse proxy (Caddy makes this two lines — `your.domain { reverse_proxy
localhost:8787 }`); WebSockets are proxied automatically and the client
auto-selects `wss://` on https pages. Auth endpoints are rate-limited per IP;
passwords are scrypt-hashed; tokens expire after 7 days. Never set
`ALLOW_DEV_COMMANDS=1` in production (it enables level/teleport cheats used
by the test bots).

## Develop online (hot reload)

```bash
npm install
cp .env.example .env
# edit .env and set POSTGRES_PASSWORD and DATABASE_URL to the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api and /ws)
```

Open http://localhost:5173 → **Play Online** → create an account → create a
character → Enter World. Open a second browser/tab and log in again — you'll
see each other in town. `Enter` opens chat.

- **Accounts**: scrypt-hashed passwords, 7-day bearer tokens (`auth_tokens`).
- **Characters**: up to 10 per account; level/gear/bags/quests/position/money
  persist as JSONB in Postgres — saved every 30 s, on logout, and on server
  shutdown. Names are globally unique, letters only, classic style.
- **The server is authoritative**: clients stream movement intent + commands
  at 20 Hz; the server runs the world (one shared `Sim`) and sends
  interest-scoped snapshots (~120 yd) plus per-player-routed events. All
  combat math, loot rolls, quest credit and vendor transactions happen
  server-side; the client is a renderer.
- **Parties** (up to 5): right-click a player → *Invite to Party*. Party
  frames on the left, members share tap rights, kill quest credit and split
  XP with the real vanilla group bonuses (1.166/1.3/1.43 for 3/4/5). Party
  chat with `/p message`. Blue member blips on the minimap. Settle loot
  disputes with `/roll` (also `/roll N` or `/roll M-N`) — a server-rolled
  number broadcast to the party, or to nearby players when ungrouped.
- **Trading**: right-click a player → *Trade*. Both sides stage items + money,
  both must accept, and the swap is atomic and server-validated (quest items
  are untradeable). Walking apart cancels.
- **Duels**: right-click → *Challenge to a Duel*. 3-second countdown, fight
  until one side hits 1 hp — nobody dies, the winner is announced zone-wide.
  Running 60 yards away forfeits.
- **The Ashen Coliseum** (1v1 ranked arena): press `G` (or the ⚔ button) to
  open the arena panel and *Enter the Queue*. Matchmaking pairs you with the
  nearest-rated challenger online, then teleports you both into a private,
  torch-lit fighting pit. A 5-second countdown heals and resets both fighters
  for a fair start; the bout ends when one yields at 1 hp (nobody dies). Wins
  and losses move a persistent **Elo rating** (everyone starts at 1500), and
  you return exactly where you queued. The panel shows your standing, the live
  online ladder, and the all-time leaderboard (`GET /api/arena/leaderboard`).
- **Multiplayer rules**: classic tap rights (first player to damage a mob owns
  its loot/XP/quest credit — others get "You don't have permission to loot
  that."), mobs retarget the next attacker when their victim dies (no free
  resets), join/leave announcements, `/say`-style chat.

## The Hollow Crypt — 5-player elite instance

Brother Aldric's storyline continues past *The Restless Dead*: **Whispers
Below** (find the Gravecaller's sigil at the ruined chapel) → **The Binding
Rite** (gather Blessed Tallow from the kobold dig and Ghostly Essence from
the restless dead) → **Into the Hollow** (*suggested players: 5*) — kill
Morthen the Gravecaller at the bottom of the crypt beneath the chapel.

- The crypt door at the Fallen Chapel teleports your **party into its own
  private instance copy** (6 slots; instances reset after 5 minutes empty).
- Inside: torch-lit halls, paired **elite** trash packs (vanilla elite
  scaling: ~2.3× health, ~1.5× damage, double XP), the miniboss Sexton
  Marrow, and Morthen — a level-10 elite boss with a **Shadow Pulse** AoE
  every 10 seconds. Dungeon trash does not respawn until the instance resets.
- Rewards: rare (blue) weapons per class archetype, 1 gold, 1500 XP.
- It is genuinely tuned for 5: our automated 5-bot raid (warrior, paladin,
  priest, mage, hunter with focus-fire + healer AI) clears it in ~5 minutes
  with ~10 deaths (`node scripts/crypt_raid.mjs`, needs ALLOW_DEV_COMMANDS=1).

```
docker compose ps          # eastbrook-db (postgres:16-alpine, healthcheck)
node scripts/mp_integration.mjs   # 26-check API/WS/persistence suite
node scripts/mp_browser.mjs       # two real browser clients see each other
```

## The Sunken Bastion & Gravewyrm Sanctum

The conspiracy doesn't end with Morthen. **The Sunken Bastion** (5-player,
~level 13, southeast Mirefen) holds Vael the Mistcaller — he summons waves of
Drowned Thralls at 60% and 30% health. The finale is the **Gravewyrm
Sanctum** (5-player, level 20, beneath Thornpeak): three chambers of elite
boneguard and drakonid, Korgath the Bound (enrages below 30%), Grand
Necromancer Velkhar (more add waves), and **Korzul the Gravewyrm** — epic
weapons drop here, and the lead-up quest chain is soloable so nobody is
locked out of the story.



## Play offline

```bash
npm run dev        # open http://localhost:5173 -> Play Offline
```

Name your character, pick any of the nine classes, and you're in **Eastbrook
Vale** (levels 1-7): a market town ringed by six hubs — wolf runs north, boar
meadows east, the Webwood west, Mirror Lake northwest, a kobold copper dig
southwest, a ruined chapel with restless dead northeast, and Gorrak's bandit
camp southeast. The road north climbs through a mountain pass into **Mirefen
Marsh** (6-13, hub: Fenbridge) and on up to **Thornpeak Heights** (13-20,
hub: Highwatch) — three zones, ~60 quests, and one storyline: the Gravecaller
conspiracy, from the first restless bones outside Eastbrook to **Korzul the
Gravewyrm** beneath the peaks. Each hub has vendors (including weapon- and
armorsmiths selling honest white gear), a graveyard, its own music, and a
zone map.

### Controls (classic layout)

| Input | Action |
|---|---|
| `W`/`S` | run / backpedal — `A`/`D` turn (strafe while right mouse held), `Q`/`E` strafe |
| right-drag / left-drag | mouselook / orbit camera &nbsp;·&nbsp; wheel zooms · `Space` jumps |
| `Tab` | cycle nearest enemies · left-click target · right-click attack/loot/talk |
| `1`–`9`, `0`, `-`, `=` | action bar |
| `F` | interact (loot corpse / pick up object / talk) |
| `C` `P` `L` `M` `B` `G` | character · spellbook · quest log · world map · bags · arena (Ashen Coliseum) |
| `V` / `R` / `Esc` | nameplates · autorun · close windows / clear target |

### Classic-fidelity checklist

**Formulas (the real vanilla ones)**
- Rage conversion `c = 0.0091L² + 3.23L + 4.27`; gains `7.5·d/c` dealing, `2.5·d/c` taking
- Spell-hit table with the +3-level cliff (96/95/94/83%); melee miss/dodge vs level
- Armor DR `armor/(armor + 85·AttackerLevel + 400)`
- HP/mana stat rules: first 20 stamina → 1 hp each, rest → 10; first 20 int → 1 mana, rest → 15
- XP curve 400/900/1400/… through level 20; mob XP `45 + 5·L` with real zero-difference gray bands
- 1.5 s GCD (1.0 s for rogues), weapon swing timers, 5-second mana rule

**All nine vanilla classes (learn levels and rank values from vanilla, 1–20 —
spells gain ranks as you level: Lightning Bolt R2 at 8, R3 at 14, R4 at 20,
plus new high-band abilities like Execute, Kidney Shot, Flash Heal,
Stormstrike, and Starfire)**
- *Warrior*: rage, Heroic Strike (on-next-swing, off-GCD), Battle Shout,
  Charge, Rend, Thunder Clap, Hamstring, Bloodrage, Overpower (dodge proc)
- *Paladin*: Seal of Righteousness (weapon imbue) unleashed by **Judgement**,
  Holy Light, Devotion Aura, Blessing of Might, Divine Protection (absorb),
  Hammer of Justice (stun), Lay on Hands
- *Hunter*: **ranged Auto Shot** (8–35 yd with the classic dead zone),
  Raptor Strike, Aspect of the Hawk, Serpent Sting, Arcane Shot, Concussive
  Shot, Mongoose Bite (dodge proc), Wing Clip
- *Rogue*: energy + **combo points**, Sinister Strike, Eviscerate, Backstab
  (behind + dagger), Gouge, Evasion, Slice and Dice, Sprint
- *Priest*: Smite, Lesser Heal, Power Word: Fortitude, Shadow Word: Pain,
  **Power Word: Shield** (absorb), **Renew** (HoT), Mind Blast
- *Shaman*: Lightning Bolt, **Rockbiter Weapon** (imbue), Healing Wave,
  Earth Shock, **Lightning Shield** (thorns), Flame Shock
- *Mage*: Fireball, Frost Armor, Arcane Intellect, Frostbolt, Conjure Water,
  Fire Blast, Arcane Missiles (channeled), **Polymorph**, Frost Nova
- *Warlock*: Shadow Bolt, Demon Skin, Immolate, Corruption, **Life Tap**,
  Curse of Agony, **Drain Life** (channeled health steal)
- *Druid*: Wrath, Healing Touch, Mark of the Wild, Moonfire, Rejuvenation,
  Thorns, Entangling Roots, **Bear Form** (toggle shapeshift at 10)
- Heals can target party members (click a party frame, then heal); buffs are
  castable on friendly players; healing crits; absorb shields soak damage
  before health.

**World & systems**
- Eating/drinking: sit down, restore over 18 s, breaks on damage or standing
  — and yes, you can eat and drink at the same time
- Vendor: buy food/water, sell your grays; coin display in g/s/c
- Ground quest objects with sparkles (steal the bandits' supply crates back)
- Mob AI: wander, proximity aggro by level difference, social pulls (murlocs
  pull from farther — bring friends), chase, leash-evade-reset, corpse loot,
  respawns; a rare spawn (Old Greyjaw) on a long timer
- Death → release spirit → graveyard; falling damage; swimming slows you
- Quest log with abandon, gossip dialogs with greetings, per-class rewards

**Presentation**
- Procedural everything: timber-framed houses, shingled roofs, chapel, market
  stall, tents, campfires with flickering light, mine portal, ruined columns,
  fishing dock, murloc mud-huts, roads painted into the terrain, grass tufts,
  pine + oak trees, lake with animated water, drifting clouds, real-time shadows
- Twelve rigged creature families (wolf/boar/spider/murloc/kobold/skeleton/
  humanoid/troll/ogre/elemental/dragonkin/sheep) with walk/attack/cast/sit/
  death animations
- Painted procedural icons for every spell, item, and buff — drawn on canvas
  at runtime, no asset files
- Classic UI: portrait unit frames, buff/debuff bars with durations, action
  bar with cooldown sweeps + range/resource coloring, cast/channel bar,
  spellbook, character paperdoll, quest log, world map, vendor + loot windows,
  gold-bordered tooltips, floating combat text, combat log, segmented XP bar,
  minimap with blips and a full zone map
- Procedural WebAudio sound: melee/spell impacts, level-up fanfare, quest
  chimes, coin clinks, the death sting — no audio files

## Development

```bash
npm test                        # vitest suite: formulas, combat, AI, quests, all 9 classes,
                                #   parties, duels, trades, elites, the crypt
npm run build                   # production web build
node scripts/smoke_browser.mjs  # warrior E2E (needs `npm run dev` running)
node scripts/smoke_mage.mjs     # mage: casting, polymorph, conjure+drink, death/release
node scripts/smoke_rogue.mjs    # rogue: combo points, eviscerate, vendor, eating
node scripts/visual_tour.mjs    # screenshot tour of the zone + UI into tmp/
node scripts/mp_integration.mjs # 26-check API/WS/persistence suite (server running)
node scripts/social_e2e.mjs     # trade + duel over the wire (ALLOW_DEV_COMMANDS=1)
node scripts/arena_visual.mjs   # two clients queue + fight a ranked 1v1 in the Ashen Coliseum
node scripts/crypt_raid.mjs     # five bots clear the Hollow Crypt (ALLOW_DEV_COMMANDS=1)
```

Browser agents can drive movement through `window.__game.controller` instead
of simulating held keys. Use `controller.move({ forward: true }, facingRadians)`
or compact websocket flags such as `{ f: 1, sr: 1 }`; call
`controller.face(facingRadians)` to update facing without changing movement and
`controller.stop()` to return to real keyboard input. Online play sends the
same input frame to the server, which accepts only boolean/`1` movement flags
and finite facing values.

Layout:

```
src/sim/      deterministic N-player game core (no DOM imports) — shared by all targets
src/render/   Three.js renderer: models.ts (rigs), props.ts, textures.ts (procedural)
src/game/     input + camera + WebAudio synth
src/ui/       classic HUD: frames, windows, tooltips, map, FCT
src/net/      online client: REST auth + WebSocket world mirror (ClientWorld)
src/world_api.ts  the IWorld interface both Sim and ClientWorld satisfy
server/       game server: main.ts (HTTP+WS), game.ts (world loop), db.ts, auth.ts
docker-compose.yml  postgres:16-alpine
tests/        vitest suite
scripts/      browser E2E + screenshot tour + multiplayer integration tests
```

Names, quests and the zones are original; formulas and mechanics follow
vanilla. World seed is fixed in `src/main.ts` so the world is the same place
every visit.

## License

The code is [MIT licensed](LICENSE) — fork it, remix it, host your own world.

The bundled third-party art assets (models, textures, HDRIs) remain under
their own licenses — all CC0 public domain except the MIT water normal maps,
as documented per pack in [CREDITS.md](CREDITS.md).
