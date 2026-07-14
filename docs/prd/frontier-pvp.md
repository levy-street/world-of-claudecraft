# PRD: The Frontier (Factionless Open-World PvP Zone) and the $WOC Stakes Layer

| | |
|---|---|
| **Status** | Draft v3, the ACTIVE next-phase spec. Its foundation (honor + quartermaster + the Warfare PvP stat, `pvp-honor-and-quartermaster.md`) SHIPPED in #1817 on release/v0.25.0; the zone phases below are what remains. |
| **Owner** | design |
| **Created** | 2026-07-03 (v3 rework 2026-07-11) |
| **Design reference** | RuneScape's Wilderness (a single lawless zone: no factions, everyone-hostile-to-everyone, opt-in-by-entering, high-risk high-reward gathering, a danger gradient that deepens the further in you go, and full loot of what you carry when you die). Classic-era world-PvP objectives (contested nodes, rare spawns, a world boss, timed zone events) for the content. The degen-gaming thesis and Cambria's extraction loop (risk-native design, seasons, tunable rake) for the stakes layer. |
| **Depends on** | `docs/prd/pvp-honor-and-quartermaster.md`, SHIPPED in #1817 (Honor currency, the FURY quartermaster, and the Warfare PvP stat: the Frontier reuses all of it and adds the 2x-honor open-world premium) |
| **Related systems** | Duel/arena hostility (`src/sim/social/duel.ts`, `src/sim/social/arena.ts`, `isHostileTo` in `src/sim/sim.ts`), world boss (`src/sim/world_boss.ts`), rare spawns (`MobTemplate.rare`), currencies (`copper`, `delveMarks`, `honor` on `CharacterState`), vendors (`NpcDef.vendorItems`), realms (`server/realm.ts`), instance x-bands (`src/sim/data.ts`), wallet verification (`docs/prd/woc/wallet-link.md`), headless RL env (`headless/`, `python/`) |
| **Companion docs** | `docs/prd/pvp-honor-and-quartermaster.md` (the honor economy this builds on), `docs/prd/badges.md` (deterministic-currency precedent), `docs/prd/woc/holder-cosmetic-flair.md` |
| **Implementation handoff** | `docs/prd/FRONTIER_PHASE1_HANDOFF.md` |

---

## 1. Summary

The **Frontier** is a persistent, always-on, **factionless** open-world PvP zone that
any character level 15+ can enter from the overworld. There are **no teams**: the
moment you step into the zone you are **hostile to every other player in it**, and
they are hostile to you. It is the game's Wilderness, one lawless band where the rules
are "everyone can fight everyone, and what you carry is at risk."

The zone is dense with things worth fighting over: resource nodes to harvest, rare
spawns, a world boss, and a rotating **hourly event**. It gets **more dangerous and
more rewarding the deeper you go** (section 4): the shallow edge near the safe hub is
where you learn and gather in relative safety; the deep interior has the richest
nodes, the rares, the boss, and **multi-combat** (more than one attacker can pile on
at once), with no easy way out.

Honor, the FURY Quartermaster, and the Warfare PvP stat are **not** defined here;
they are the standalone system in `docs/prd/pvp-honor-and-quartermaster.md`, which
SHIPPED first (#1817). The Frontier reuses that system as-is and adds one headline rule:

> **Open-world kills in the Frontier pay 2x honor.** Fighting in the lawless zone,
> where anyone can jump you and your cargo is on the line, is worth double the honor
> of an instanced Fiesta kill. That premium is the whole reason to leave safety.

The extraction hook (the Wilderness risk): resources you harvest are **carried, not
banked**. They ride on your character as visible cargo, **drop for whoever kills you**
when you die, and only become yours when you turn them in at the safe hub. Every full
cargo bag walking home is a target on your back.

The zone runs as **two loops on one design**. The **free loop** (sections 4 to 9) is
always on, on every realm, with play stakes. The **$WOC stakes layer** (section 12)
reruns the same extraction loop as bounded, deposit-to-play **staked seasons** where
cargo settles to $WOC, plus a sanctioned **agent server** where automation is a
first-class way to play. The stakes layer never touches `src/sim/`: the sim deals in
cargo, honor, and copper only, and the token bridge lives at the server boundary (the
token firewall, section 12.2).

All outcomes resolve in the authoritative `Sim`; clients mirror via `IWorld` /
`ClientWorld`. Content is declarative in `src/sim/content/`.

## 2. Realm or zone? (resolving the framing)

The pitch says "realm", and the repo does support multiple realms (`server/realm.ts`,
`npm run realms`, `REALM_TYPE: 'PvP'`). But realms are isolated shards: characters,
friends, and guilds are scoped per realm, with no cross-realm travel. Shipping the
Frontier as a realm would mean players start blank characters there and abandon their
mains.

**Decision: ship it as a zone.** The Frontier is a new spatial band inside every
realm's world (like arena and delves). Entry is by teleport from the existing Arena
window (the `G` keybind, `src/game/keybinds.ts` id `arena`), which grows into the
general PvP window: the Ashen Coliseum queue, the Fiesta queue, and a Frontier section
with an Enter button, your honor balance, and the next-event countdown. This preserves
the whole point: your level-20 main, its gear, and its guild all matter in the
Frontier.

The realm framing returns in one place: the **agent server** (section 12.6) is a
dedicated realm where automation is sanctioned, because realms are exactly the
isolation boundary that stance needs. A `REALM_TYPE='PvP'` shard where the *entire
overworld* uses Frontier flagging rules remains a config-plus-small-code follow-up
(section 13), not v1.

## 3. Current state in the codebase (what this reuses and what is new)

| Concern | Exists today | Gap for this feature |
|---|---|---|
| PvP hostility | `isHostileTo` gates on active duels and arena/Fiesta matches only | Add a clause: **both players inside the Frontier band -> hostile** (free-for-all, no team check) |
| Honor / QM / Warfare | SHIPPED in #1817 (honor currency, `grantHonor`, the FURY Quartermaster, the Warfare PvP stat) | Reuse verbatim; add zone honor sources incl. the 2x kill premium (section 7) |
| World boss | `src/sim/world_boss.ts`: interval spawns, personal loot, daily gate via `PlayerMeta.worldBossDaily` | Add a Frontier boss (event-driven spawn, section 8) |
| Rare spawns | `MobTemplate.rare` + `elite` + `respawnMult`, exclusive loot roll groups | New Frontier rare templates; no engine work |
| Gathering | None. Only quest sparkle pickups (`ground_pickup_lines.ts`) | New: resource node entity type + gather channel + carried cargo (section 6) |
| Depth / danger gradient | None (zones are flat-danger) | A per-position **depth** derived from distance into the band, driving node richness, spawn danger, and single- vs multi-combat (section 4) |
| Timed events | `worldBossNextAt` sim-time scheduler in `sim.ts` | Generalize into a Frontier event scheduler (hourly, Rng-picked, section 8) |
| Spatial bands | Overworld x in [-180, 180]; dungeons 900+; arena 4200+; delves 4800+ | New Frontier band, `FRONTIER_X_MIN = 9000` (`isDelvePos` must gain an upper bound, handoff gotcha G1) |
| PvP rewards | Duel/arena/Fiesta grant honor per `pvp-honor-and-quartermaster.md`; world kills grant nothing | Honor on open-world kill at **2x**, with DR (section 7) |
| Full-loot risk | Equipped gear never drops (PvE rules) | Carried **cargo** drops on death, lootable by the killer (section 6.3); equipped gear still never drops |
| Wallet identity | `docs/prd/woc/wallet-link.md` | Season deposits/settlement (server boundary only, section 12.2) |
| Agents / automation | Headless RL env, one sim in three hosts | The agent server realm (12.6) and the economy wind tunnel (12.7) |

## 4. The zone: factionless flagging and the danger gradient

### 4.1 Flagging (opt-in by entering, everyone-hostile)
- Entry is a **teleport into the band** from the PvP window; it is a free, deliberate
  action (a short cast, cancellable). There is no faction, no team, no color.
- `isHostileTo(a, b)` gains one Frontier clause: **true when both `a` and `b` are
  players physically inside the Frontier band** (no team comparison). This is the
  Wilderness "you are flagged the instant you are in here" rule.
- No hostility bleed: teleporting out (the Leave channel, or death) ends hostility
  immediately, because the band check does it for free. No overworld flagging in v1.
- **Leave is a 10 s channel**, interrupted by damage and blocked while in combat:
  entry is free, but the exit is never an escape button mid-fight (hearthstone-style).
  This is what keeps a fight a fight.
- Pets and companions are hostile to every other player exactly as their owner is.
- Duels are disabled inside the Frontier (everyone is already hostile; a duel is
  meaningless here).

### 4.2 The safe hub (one, neutral)
- A single **safe hub** sits at the shallow mouth of the band (the only safe ground in
  the zone). It holds the **Honor Quartermaster** (the same vendor as
  `pvp-honor-and-quartermaster.md`, restocked here), the **turn-in officer** (section
  6.4), guards, and the respawn graveyard.
- The hub perimeter is a **safe zone**: no player-vs-player damage lands inside it, and
  guards (elite, leash to the hub) punish anyone who tries to camp the graveyard. You
  are safe at the hub and nowhere else.

### 4.3 Depth: deeper is deadlier and richer (the Wilderness gradient)
A single scalar, **depth**, is derived purely from how far into the band a position is
(distance from the hub along the band), bucketed into a few tiers. Depth is a pure
function of position, identical across hosts. It drives:
- **Node richness (section 6.1):** common ore at the shallow edge; the uncommon and
  rare nodes, and the relic caches, only spawn deep.
- **Spawn danger:** shallow tiers have low-level neutral mobs; deep tiers have the
  elites, the rares, and the world-boss ruin.
- **Single- vs multi-combat:** the shallow tiers are **single-combat** (you can be
  engaged by one player at a time, like the Wilderness singles zones); the deep tiers
  are **multi-combat** (any number of players can pile on one target at once). The
  border is marked in-world (a visible landmark line) and on the zone map. Going deep
  for the rich nodes means accepting that a group can collapse on you.
- **Death cost:** identical everywhere (you drop your cargo, section 6.3); depth raises
  the *odds* of dying, not the penalty. The gradient is "richer + more likely to die",
  not "harsher death", which keeps the rule honest and the map readable.

Depth replaces the old two-base team geometry: instead of Azure vs Crimson at opposite
ends, there is one safe mouth and an increasingly lawless interior.

### 4.4 Death and respawn
- Dying to a player or a mob in the Frontier: release and respawn at the **hub
  graveyard** (the one safe spot). A short respawn timer; no gear loss.
- Carried cargo drops on death (section 6.3). Equipped gear never drops (PvE rule
  preserved: the risked layer is cargo, not your character's gear).

## 5. Single- vs multi-combat (the engagement rule)

The one genuinely new combat rule the Wilderness gradient needs, kept in its own
section because it touches `isHostileTo` / target validation, not just content:
- In **single-combat** tiers, a player who is already in a player-vs-player fight
  cannot be targeted by a third player until that fight ends (a short "in-fight" lock,
  the RuneScape singles rule). One-on-one is protected.
- In **multi-combat** tiers, there is no such lock: anyone can attack anyone, and pile-
  ons are the point. This is where groups dominate and solo play is highest-risk,
  highest-reward.
- The lock is a pure predicate on sim state (who is in-fight with whom, and the
  attacker's depth tier), evaluated in the same place hostility is; deterministic, no
  rng. It is the mechanical spine of the "deeper is deadlier" promise.

## 6. Resources: harvest, carry, extract

### 6.1 Nodes
A new sim concept: the **resource node**, a stationary interactable entity with charge,
spawned from declarative content records, richer the deeper it sits (section 4.3).
- Node types (working set): **Frostvein Ore** (common, shallow and everywhere),
  **Emberbloom** (uncommon, deep cluster spawns), **Ancient Relic Cache** (rare, deep
  only, marked on the zone map for everyone when it spawns, so the whole zone converges
  on it: a fight, by design).
- Harvesting is a **channel** (3 s common, 6 s rare), interrupted by damage or
  movement. Contested by design: you are stationary and visible while gathering, and a
  stealth opener on a mid-channel gatherer is allowed (getting sapped at a node is the
  point).
- Nodes have 1 to 3 charges, deplete on harvest, respawn on a `respawnMult`-style timer
  via the zone `Rng` from a spawn-point pool (same pattern as mob camps).
- Node picks, charges, and respawn draws all go through the zone `Rng`; identical
  across hosts.

### 6.2 Carried cargo
- Harvested resources go into a separate **cargo hold**, not the inventory: capacity 10
  units, visible on the character model (a bulge/pack scaling with load) and as a HUD
  counter.
- Cargo cannot be traded, mailed, banked, or listed. It exists only in the Frontier.
- Teleporting out of the zone with cargo forfeits it (announced in the Leave confirm
  dialog). The only way to realize value is the turn-in officer at the hub. Carrying a
  full bag to the hub, past everyone who wants it, IS the objective.

### 6.3 Dropping and looting (full loot of the risked layer)
- On death, the victim's **entire cargo** drops as a lootable satchel for 60 s,
  lootable by **any other player** (there are no teams; the killer and anyone else
  present can grab it, fastest finger). This is the Wilderness full-loot rule scoped to
  the carried layer: your gear is safe, your haul is not.
- The satchel is a world entity; holding the field after a kill is how you actually
  collect, which is why the deep multi-combat tiers reward groups.

### 6.4 Turn-in
- The turn-in officer at the hub converts cargo: base rate 2 honor per common unit, 5
  per uncommon, 25 per relic, plus a copper stipend. Rates are content data.
- Turn-ins feed the hourly **zone score** (section 8.4, now a solo/zone-wide leader
  metric, not a team score).

## 7. Zone honor sources (on top of `pvp-honor-and-quartermaster.md`)

Honor, its DR machinery, and `grantHonor` are defined in the honor PRD. The Frontier
adds these **sources**, all routed through the same `grantHonor` so DR and the
soulbound rule apply uniformly:

| Source | Honor | Notes |
|---|---|---|
| **Open-world player kill** | **2x** the Fiesta base | The headline premium for fighting in the lawless zone. Same per-victim DR schedule (100% / 50% / 25% / 0, resets hourly) and level gating (0 for victims 5+ levels below the killer) as the base honor rules |
| Assist (damaged victim within 10 s) | 2x the base assist | Same DR |
| Resource turn-in | 2 / 5 / 25 per unit | Section 6.4 |
| Rare spawn kill (participation) | 15 | Personal-loot-style eligibility, reuses the world-boss contributor logic |
| Frontier world boss (participation) | 100 | Once per boss per day, `worldBossDaily` gate |
| Hourly event participation / win | 10 to 50 | Per event definition, section 8 |

- The 2x kill premium is a single zone multiplier passed to `grantHonor`; it needs
  nothing new in the honor system beyond that function already existing.
- Anti-farm carries over unchanged: level-difference gating, per-victim DR, no honor
  for kills between party members (defense in depth).

## 8. Hourly events

### 8.1 Framework
- A Frontier **event scheduler** in the sim, generalizing the `worldBossNextAt`
  pattern: every 3600 sim-seconds, draw the next event from a weighted rotation via the
  zone `Rng` (no repeat of the previous; some events, like the world boss, are on fixed
  rotation slots).
- Hourly means **sim-time hours**, keeping headless/offline determinism. On the live
  server sim-time tracks wall clock closely, so players get a predictable "top of the
  hour" rhythm.
- 5 minutes before an event: zone-wide announcement (stable event key + values,
  re-localized client-side via `sim_i18n.ts`, never English from the sim). The HUD
  shows a countdown.
- Events last 10 to 15 minutes, then the zone returns to baseline.

### 8.2 v1 event rotation (ship these, all factionless)
1. **Resource Rush**: all nodes respawn instantly, double charges, double yield. The
   whole zone converges on the node fields, deep and shallow.
2. **Bloodmoon**: player kills award double honor (stacking with the standing 2x, so a
   Bloodmoon open-world kill is 4x a Fiesta kill), and every player is pinged on the
   zone map every 10 s. Nowhere to hide.
3. **The Caravan**: a neutral NPC caravan crosses the zone on a fixed route; it drops a
   large cargo pile when destroyed. A free-for-all scramble to burst it and grab the
   drop, then hold the field.
4. **Relic Surge**: 5 Ancient Relic Caches spawn deep at once, all marked on the map.
5. **Rare Hunt**: three named rare elites (Frontier-exclusive loot roll groups) spawn
   at announced deep landmarks.
6. **Warlord of the Frontier** (fixed slot, every 6th hour): the Frontier world boss
   spawns at the central ruin (the deepest point). Everyone wants the personal loot and
   the 100 honor; nobody can safely tank it while the rest of the zone hunts them.

### 8.3 Event backlog (post-v1 candidates, factionless)
- **King of the Hill**: capture-and-hold the central tower; the current holder gets a
  personal +10% honor aura while they hold it (solo/party hold, not team).
- **Supply Drop**: one high-value chest at a random marked point, opened by a long
  contested channel (reuse the delve lockpick minigame as the opener).
- **Bounty Hour**: the current top honor earner in the zone is marked with a bounty;
  killing them pays 100 honor and clears the mark (the Wilderness "target on the richest
  player" dynamic).
- **Fog of War**: heavy weather, nameplate/render draw distance halved, stealth
  detection reduced.
- **Sudden Death**: respawn timers triple for the duration; every kill matters.
- **Gold Vein**: one super-node (deep) with 20 charges and a 10 s channel per harvest; a
  fortune if you can hold it, a magnet for everyone if you can't.
- **The Vault Opens**: the hourly zone-score leader (8.4) gets 10 minutes of access to a
  vault room with a loot boss, guarded from everyone else by a gate only the leader (and
  party) can pass.
- **Night of the Dead** (seasonal): PvE wave defense at the hub perimeter; players may
  cooperate against the waves or knife each other for the drops.

### 8.4 Zone score (solo/leaderboard, not team)
Each hour accumulates a **per-player** score (kills, turn-ins, event objectives). At the
hour boundary the top scorer(s) get an honor payout and a short cosmetic banner buff,
and the score feeds future events (The Vault Opens, Bounty Hour). This gives the hour a
narrative arc and a "who's winning the zone right now" read, without any team structure.

## 9. Player-facing surfaces (IWorld first)

Extend `IWorld` (`src/world_api.ts`) before touching either world, implement in both
`Sim` and `ClientWorld`:
- `frontierState()`: honor balance (from the honor PRD), cargo load, active/next event +
  countdown, my current depth tier + single/multi-combat flag, zone-score standing.
- Wire entity additions: node/satchel/caravan entity kinds, cargo-load visual scalar.
  (No `frontierTeam`; there are no teams.) Enemy players in the zone tint hostile on
  nameplates/target frames (one hostile color, not blue/red).
- Commands: `frontier_enter`, `frontier_leave`, `gather_node`, `loot_satchel`,
  `turn_in_cargo` (dispatched in `server/game.ts` like `enter_dungeon`).

HUD (each its own module the HUD composes, not new `hud.ts` banner sections):
- PvP window (`G`): the Arena window gains a Frontier section (Enter/Leave, honor
  balance, next-event countdown) beside the Ashen Coliseum and Fiesta queues. The
  keybind label updates from "Arena" to a PvP label (i18n key change, completeness gate
  applies).
- Frontier widget (in-zone): honor, cargo 0-10, event countdown, depth tier +
  single/multi-combat indicator, zone-score standing.
- Zone map layer: the hub, node fields by depth, the single/multi-combat border, event
  markers, Bloodmoon pings, relic-cache markers.
- Vendor window reuse with honor prices (from the honor PRD); FCT shows honor gains like
  XP.

## 10. Invariant compliance checklist

- **Determinism**: all node spawns, event draws, depth (a pure function of position) via
  the zone `Rng` / pure math; hourly timers on sim-time; daily gates via `ctx.utcDay`.
  No wall-clock.
- **Sim purity**: everything above the render line lives in `src/sim/` (a new
  `src/sim/frontier/` directory with an `index.ts` barrel + local CLAUDE.md); zero
  DOM/Three imports; `tests/architecture.test.ts` stays green.
- **Server authority**: honor grants, cargo, turn-ins, hostility, depth, and event state
  all resolve in the server's sim; the client renders.
- **i18n**: sim/server emit stable keys + values; new item names need locale coverage
  (`tests/localization_coverage`); event/mechanic names go through the `sim_i18n.ts`
  matcher; new HUD chrome hits the completeness gate; level-20 vendor gear (from the
  honor PRD) hits exact `expectedStatBudget`.
- **Content as data**: nodes, events, rares, depth thresholds, prices are records in
  `src/sim/content/frontier.ts` merged by `data.ts`; regenerate `/wiki` content
  (`npm run wiki:content`), mind spoiler-safety for rares/boss.
- **Classic fidelity + original naming**: honor DR and level-gating come from the honor
  PRD; the Wilderness gradient (depth, single/multi-combat, full loot of the carried
  layer) is deliberately RuneScape-flavored, not classic-WoW, and named in original
  terms (no cloned proper nouns; see the ip-scrub note in the team memory).
- **Token firewall**: no wallet, token, or settlement code or imports anywhere in
  `src/sim/` (extend `tests/architecture.test.ts` with this scan). The sim's vocabulary
  ends at cargo, honor, copper.

## 11. Phasing

Honor + Quartermaster + the Warfare PvP stat shipped first as their own feature
(`pvp-honor-and-quartermaster.md`, #1817 on release/v0.25.0). The Frontier phases
below build on that shipped system.

| Phase | Scope | Acceptance |
|---|---|---|
| F1. Zone skeleton | Frontier band + G-window enter/leave teleport, factionless auto-flagging (both-in-band -> hostile), single/multi-combat lock, the safe hub, depth gradient, hub graveyard, 2x honor on kills via `grantHonor` | Two clients in the zone can fight and earn 2x honor; `isHostileTo` + depth + single-combat-lock tests; parity goldens |
| F2. Economy | Nodes (depth-tiered), gather channel, cargo, death drop (loot-by-anyone), turn-in officer, hub Quartermaster restock | Full harvest-carry-die-loot-turn-in loop deterministic in a headless test |
| F3. Events | Event scheduler + the six v1 events, zone score, HUD countdown | Seeded sim replays the same event sequence; each event has a sim test |
| F4. Apex | Frontier world boss, rare trio, cosmetics/titles, zone map layer, wiki content | Boss daily gate works; i18n gates green at PR tier |
| F5. Wind tunnel | Season config format + headless exploit-agent harness (section 12.7) | Harness runs seeded seasons in CI; kill-trading and node-botting show sub-threshold profit |
| F6. Staked season pilot | One 2-week bracketed season on a dedicated staked shard; deposits/settlement via the wallet boundary; season leaderboard + settlement stories | Season settles correctly end to end on a testnet dry run first; every settlement idempotent and auditable; wind-tunnel gate passed |
| F7. Agent server | Sanctioned-automation realm, agent-entered staked seasons, mixed exhibition events | Agents connect via WS or env API and complete a season; agent entrants marked on leaderboards |

## 12. The $WOC stakes layer

The free Frontier above is a complete feature and ships on its own merits. This section
is what turns the same loop risk-native. Design reference: the degen-gaming thesis
(deposit to play, no skillshots, incomplete information, continuous risk/reward,
adversarial robustness) and Cambria's season cadence. The pitch in one line: **make
money by being good at World of ClaudeCraft.**

### 12.1 Two loops, one design
- **Free loop** (sections 4 to 9): always on, every realm, play stakes. It is the
  on-ramp, the practice arena, and the stake multiplier: the level, gear, and talents a
  character earns in free play determine its efficiency in staked play.
- **Staked seasons**: scheduled, bounded runs (2 weeks, Cambria's cadence) on dedicated
  staked shards. Entry is a $WOC deposit; extraction settles back to $WOC at season end.
  Bounded seasons before any 24/7 persistent staked world: every season is an economic
  experiment with a settlement date, and a bad parameter dies with its season instead of
  compounding.

### 12.2 The token firewall (invariant, not preference)
$WOC never enters `src/sim/`. The sim speaks cargo units, honor, and copper; the server
boundary maps wallet deposits to season entries and sim outcomes to settlements,
building on the verified wallet identity from `docs/prd/woc/wallet-link.md`. What the
firewall buys:
- The three-host guarantee survives: offline and headless run the identical season rules
  with play stakes, which is what makes 12.7 possible at all.
- `tests/architecture.test.ts` stays meaningful and gains the token scan.
- A structural firewall for the regulatory question (12.9): the game is complete and
  playable with zero money attached; the stakes layer is a server-side mapping on top.

### 12.3 Honor is soulbound; cargo is the stake
Two assets, two jobs, never crossed:
- **Honor** is identity (defined in `pvp-honor-and-quartermaster.md`): titles, vendor
  unlock rights, lifetime milestones. Never tradeable, never bridgeable, in free or
  staked play. The moment honor is liquid, every kill-DR rule becomes wash-trading
  security instead of game balance, and the identity moat (the thing that retains
  players who are down money) is for sale.
- **Cargo** is the stake: in a staked season the deposit converts to season entry plus
  season-scoped gear risk, resources extracted convert back to $WOC at settlement, and
  death drops carried value to the killer exactly as in the free loop. Full-loot honesty
  applies to the carried layer only, never to the soulbound layer: you can lose a season,
  you cannot lose who you are in the game.

### 12.4 Rake and sinks
The house edge is the classic MMO sink set, reframed and tunable per season in the
season config (data, not code): the turn-in tax, durability loss on death (repairs cost
season currency), consumables, and the season entry fee. Tuning principle, stated as a
requirement: **tune for longevity, not take**. Extraction-heavy economies eat their fish
and die; every rake change must pass the wind tunnel (12.7) with fish-survival metrics,
not just house-revenue metrics.

### 12.5 Brackets and new-player protection
- Seasons are **stake-bracketed** (minnow / standard / shark by deposit size), so new
  depositors fight each other and not season veterans running juiced characters.
- Staked play requires level 20 (the free zone is where you get there and learn the loop
  with play stakes first).
- Brackets invite smurfing (sharks in minnow brackets with fresh wallets). Mitigations
  are economic (bracket payouts scale with bracket size, so farming minnows pays minnow
  money) plus wallet-age/history heuristics at the server boundary; not claimed fully
  solvable, claimed tunable, and a standing wind-tunnel scenario.

### 12.6 Agents are first-class: the agent server
Posture: **embrace**. This repo ships a headless RL env as a feature; pretending the
game is unbottable would be self-delusion with a settlement date. Instead:
- **The agent server**: a dedicated realm (realm-flag config, surfaced in
  `REALM_DIRECTORY`) where automation is sanctioned. Agents connect through the normal WS
  protocol or the headless env API and play the same authoritative sim.
- **Agent-entered staked seasons** run on the agent server: my agent, my stake, my
  strategy. Leaderboards mark agent entrants and their authors. A product nobody else
  has: degen gaming for the agent-builder crowd, and the RL env flips from liability to
  developer surface.
- **Human realms**: staked brackets are human-only by policy. Enforcement is economic
  first (entry stakes make sybil farming a capital cost; DR and brackets cap the yield),
  moderation second, never claimed perfect. The honest offer to a caught botter: your
  playstyle has a home, it is the agent server, take your stake there.
- **Mixed exhibition seasons** (humans and agents in one labeled bracket) as scheduled
  spectacle, not the default.

### 12.7 The economy wind tunnel
A deliverable with tests, not an aspiration: a headless harness (`headless/` + the season
config) that runs many seeded seasons with scripted adversarial agents (kill-traders,
node-botters, cargo-launderers, sybil rings, shark pods hunting minnows) against a
candidate season configuration, and reports extraction rate, honor inflation, new-player
survival/retention proxies, and winnings concentration. It runs in CI for any change to
season parameters. The structural advantage the deterministic sim buys: **Cambria tunes
its economy on paying players; we tune ours in CI.** The same harness doubles as the
smurfing and rake regression suite.

### 12.8 Spectacle, scarcity, and GTM
- **Relics go scarce**: the Ancient Relic Cache tier (6.1) upgrades in staked seasons to
  limited-count legendary drops (fixed mint per season). The asymmetric-upside slot: the
  improbable extraction clip that markets the game.
- **Make winners legible**: season leaderboards (the `K` leaderboard window grows a
  season tab), a kill/extraction feed, and settlement-day stories (biggest extraction,
  best comeback, top agent author). Emergent PvP drama is free perpetual content; give it
  surfaces.
- Event scheduling doubles as spectacle: Warlord hour and Bloodmoon are when streams tune
  in.

### 12.9 Regulatory posture (honest, brief)
Real-money entry plus chance-weighted outcomes is regulated gambling in many
jurisdictions, and the no-skillshots design pushes outcomes toward dice, the wrong
direction for a skill-game classification. Jurisdiction strategy, geofencing, and
licensing are a business decision with counsel that gates any staked season going live;
out of scope for this PRD. In scope: the token firewall (12.2) and the
complete-without-money free loop are the strongest structural mitigations, so they are
invariants regardless of how the legal question resolves.

## 13. Future hooks (explicitly deferred)
- `REALM_TYPE='PvP'` shard where overworld zones use Frontier flagging.
- Frontier resources as crafting mats when professions land.
- Fortress-siege event (its own PRD).
- 24/7 persistent staked world (only if bounded seasons prove the economy).
- Spectator mode + betting on agent seasons (prediction-market layer; own PRD, own
  regulatory analysis).
- Cross-realm event calendar alignment.

## 14. Decisions and open questions

Resolved in this revision:
1. **Factionless.** No teams. Everyone in the band is hostile to everyone; you opt in by
   entering. (Replaces the Azure/Crimson design of v1/v2.)
2. **Danger gradient.** Depth (distance into the band) drives node richness, spawn
   danger, and single- vs multi-combat. One safe hub at the mouth, lawless interior.
3. **2x honor on open-world kills**, on top of the Fiesta base from the honor PRD.
4. Entry level: 15+ for the free zone; hard 20 for staked seasons (12.5).
5. Cargo on teleport-out: forfeit, no tax exit.
6. Stealth openers on mid-channel gatherers: allowed.
7. Offline worlds: the Frontier exists offline with nodes, rares, and events (play
   stakes); staked seasons are online-only on dedicated shards.
8. Agent posture: embrace, via the agent server (12.6).

Still open:
1. Depth tier count and thresholds, and exactly where the single/multi-combat border
   sits (a tuning + map-readability call).
2. Whether the 2x kill premium is a flat 2x or scales with depth (deeper kill = more
   honor). Lean: flat 2x in F1, measure, consider depth-scaling later.
3. Honor cap per day/week, or let DR do the work? (Lean: no cap in the free loop,
   measure; the wind tunnel answers this for staked seasons.)
4. Bracket boundaries and payout curves for the first staked season (a wind-tunnel
   output, not a taste call).
5. Season deposit denomination and custody mechanics (the `docs/prd/woc/` settlement doc
   owns this).
6. Does the free Frontier ship to all realms before season 1, or launch together? (Lean:
   free first; it is the funnel and the playtest.)
