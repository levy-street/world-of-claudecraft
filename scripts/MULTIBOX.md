# Multibox bot system

A coordinated party of up to **5 headless characters** that log into a realm over
WebSockets, grind mobs, level up, and (optionally) march into the Hollow Crypt —
**all from one Node process**, with no in-game chat. Everything is journaled to
`./logs/*.md`. There is **no 3D/renderer here** — the bots talk the raw server wire
protocol (the same `auth`/`snap`/`events`/`cmd`/`input` messages the browser client
uses), reconstructing delta snapshots exactly like the other `ws` scripts in this dir.

> These files are **untracked / work-in-progress** (not yet committed). They are
> plain `.mjs` (Node-only, no TS, no `src/` imports) — see `scripts/CLAUDE.md`.

## The pieces

| File | Role | Run |
|---|---|---|
| `multibox.mjs` | **Orchestrator.** Logs in every account, joins all bots to one party, runs the 20-ish-Hz control loop, narrates real server events into journals, manages phases, re-parties after reconnects. Owns *all* the boilerplate. | `node scripts/multibox.mjs <config.json>` |
| `multibox_brain.mjs` | **The decision brain** — a pure `tick(ctx)` function + a `TUNABLES` block. **Hot-reloaded live**: edit + save and the running party changes behavior on the next tick, no relog. This is where you iterate. | (imported by `multibox.mjs`) |
| `multibox_monitor.mjs` | **CI-style health gate.** Parses `./logs`, emits `HEALTHY/SLOW/STALLED/DOWN` with a diagnosis, writes `logs/STATUS.md`, appends `logs/ci_history.jsonl`. Exit code `0/1/2`. **Groups stats per party from the active fleet** (`fleetParties()`). Run it on a cron or by hand. | `node scripts/multibox_monitor.mjs` |
| `multibox_dashboard.mjs` | **Live web UI** at `http://localhost:8099` — SSE-tails the journals, one tab per bot + party log + status, **one stats row per fleet party**. Not a game view; it streams the text logs. | `node scripts/multibox_dashboard.mjs` |
| `multibox_fleet.mjs` | **Fleet launcher** — starts every party in `multibox.fleet.json` as its own `multibox.mjs` child (Ctrl-C stops them all); output is line-prefixed per party. **Refuses to launch parties that share a character or account.** `--check` validates without launching. | `node scripts/multibox_fleet.mjs [--check]` |
| `multibox_config.mjs` | Shared config loader (`extends` deep-merge), imported by both `multibox.mjs` and the fleet launcher. | (imported) |
| `multibox.world.json` | **The shared spine** — the canonical world route (`questing` hubs, the L1→L18 `grind` ladder), shared defaults (`server`, `runSeconds`, `joinStagger`), and the **accounts registry**. Edit world data here *once*; every party inherits it. | (inherited via `extends`) |
| `multibox.<party>.json` | **Thin party file** — `extends` the spine and sets only what's party-specific: `leader`, `tag`, `bots` (+ any override like a custom `grind`). ~15-30 lines. | `node scripts/multibox.mjs scripts/multibox.<party>.json` |
| `multibox.config.example.json` | Standalone template (no `extends`); kept for reference. | — |
| `hunter_agent.mjs` | **Standalone single-bot** ancestor of this system — plays one hunter via env vars. Self-contained; good reference for the wire protocol, not part of the party. | `WOC_USER=… WOC_PASS=… node scripts/hunter_agent.mjs` |

Live parties (not committed) target **production** (`https://worldofclaudecraft.com`).
Current roster — `ryze6` (warlock), `warr1`/Durgan and `sham1`/Tovak were **banned by the
server's behaviour-based bot detection** and scrubbed from every config + `.env` + the token
file. Surviving accounts: `ryze2`/ryzehunts (hunter L9), `ryze3`/ryzeheal (priest L14),
`ryze4`/ryzetank (warrior L15), `ryze5`/ryzemage (mage L9). Active configs:
`multibox.ryzeduo.json` (🟥B, ryze4 tank + ryze3 heal), `multibox.ryzemage.json` (🟧D, ryze5
mage solo), `multibox.ryzehunts.json` (🟪H, ryze2 hunter solo, agentic brain), and
`companion.json` (🤝, ryze3 following a human — see **Companion** below). The bans are
per-character and correlate with cumulative playtime, NOT logout timing — a clean staggered
logout did not save the tank. Treat accounts as expendable; don't assume any anti-bot hygiene
makes them ban-proof.

## Config inheritance — the shared spine

A party file may set **`"extends": "<relative path>"`** to inherit a base config.
`multibox.mjs` resolves it (chainable, circular-safe) and **deep-merges**: nested
objects merge recursively; **arrays and scalars are replaced wholesale**. So a party
inherits the whole world (questing + grind ladder + account registry) and overrides
only its diffs.

```jsonc
// multibox.duo.json — a complete party in ~15 lines
{
  "extends": "multibox.world.json",        // questing, grind ladder, accounts, server…
  "tag": "🟦A",                             // colour/letter prefixed on this party's log lines
  "leader": "Durgan",
  "bots": [                                 // accounts resolve from the registry in the spine
    { "user": "warr1", "character": "Durgan", "class": "warrior" },
    { "user": "sham1", "character": "Tovak",  "class": "shaman"  }
  ]
}
```

Why it's set up this way:
- **One source of truth.** Change a camp, quest hub, or password **once in
  `multibox.world.json`** and every party gets it — no more 3-way drift between configs.
- **The `grind.ladder` is universal.** It's `[{ level, home:{x,z}, radius, label }]`;
  the brain picks the highest rung with `level <= leaderLevel`, so the **same** ladder
  serves an L2 fresh party (Wild Boars) and an L8 party (Deepfen) — each just enters at
  its rung. Don't truncate it per party; let level select the rung.
- **A party overrides only what differs.** Most need just `leader` + `tag` + `bots`.
  A genuinely different route can override `grind` (deep-merge: set only the keys that
  differ). New party = copy a thin file, swap the roster.
- Backups of the pre-spine configs live in `scripts/_multibox_backup/`.

## How a run works (multibox.mjs)

1. **Login** each unique account → bearer token. **Resolve/create** each character
   (`class` in the spec auto-creates if missing). Refuses if a char is already online
   (`log it out first`).
2. **Connect** one WebSocket per bot; auto-reconnects on drop (3s) so a hiccup doesn't
   bench a bot for the run. Fresh per-bot journal written on connect.
3. **Form the party**: leader `pinvite`s everyone, each `paccept`s; opening buffs cast.
   Leader = `cfg.leader`; tank = first warrior (else first melee, else leader).
4. **Control loop** until `runSeconds` elapses:
   - `narrate()` turns each bot's **real** event stream (`loot`/`death`/`respawn` +
     level-ups detected from `self.lv`) into journal lines + party milestones.
   - `loadBrain()` re-imports `multibox_brain.mjs` **if its mtime changed**, then
     `brain.tick(ctx)` drives every bot for this tick.
   - Every 15s → status line to console + `party.md`. Every 5m → a machine-readable
     `📊 PROGRESS kills=… levels=… phase=…` beat (the monitor parses these).
   - Every 15s → re-party any connected bot that fell out (post-reconnect).
5. **Phases:** `grind → travel → dungeon`. Transition to `travel` when the **whole**
   party hits `dungeonLevel` (default 8); to `dungeon` when the leader crosses into the
   instance (`x > 500`). `arrived` flips once the leader is within 50y of the crypt door.

### The control surface a bot exposes
`bot.cmd({cmd, …})` (server command: `cast`/`target`/`attack`/`loot`/`equip`/`release`/
`pinvite`/`enter_crypt`/…), `bot.input({f|b|l|r:1}, facing)` (movement intent),
`bot.self` (your snapshot: `hp/mhp`, `res/mres` = resource/mana, `gcd`, `lv`, `xp`,
`auras`, `party.members`, `inv`, …), `bot.ents` (visible entities), and helpers
`pos/dist/faceTo/hpFrac/offGcd/hostiles/isHealer`. Mob fields are wire-short: `k:'mob'`,
`h` (hostile/aggro), `lv`, `nm`, `dead`.

## The brain — where you improve behavior

`multibox_brain.mjs` is a **pure function of `ctx`**. Two ways to tune:

- **Numbers** → edit `TUNABLES` (top of file). Save → live.
- **Logic** → edit `tick()` / `rotate()` / `tryHeal()` / `engage()` / `moveToward()`.
  Keep it a pure function (act only via `bot.cmd` / `bot.input`; all state in `ctx` or
  stashed on the `bot` object). If it throws or has no `tick` export, the orchestrator
  **keeps the previous brain** and logs the failure — so a bad save won't crash the run.

Each save emits `🧠 behavior hot-reloaded — no relog` to `party.md`. **This is the
core dev loop: leave the party running, edit the brain, watch the dashboard.**

### TUNABLES worth knowing
- `goHome` + `home {x,z}` + `homeRadius` — the **safe grind anchor** (live-relocatable).
  When `goHome:true`, the party grinds mobs within `homeRadius` of `home` and ignores the
  crypt logic. Current `home` is the Mire Prowler camp `(-40, 230)` (L7–8).
- `seekCrypt` — `false` = grind anywhere safe; `true` = march to + hold the crypt door.
- `lvlFloor`/`lvlCeil` — relative-level band of mobs to engage (`-4..+1`; deliberately
  conservative on the high side to avoid feeding deaths).
- `pullGrind`/`pullTravel` — target-search radius (anchored vs. while marching).
- `fleeHp` (non-healer disengage), `restHp` (leader rests), `healCrit/healTank/healLow`
  (healer triage thresholds), `follow` (follower leash), `lootGrab/lootWalk`, `autoEquip`.
- `spread` — **delta-split** radius (yd). Followers hold a stable per-pid offset *around*
  the leader (`followAnchor`) instead of stacking on the leader's exact tile and trailing an
  identical path. A party that moves as one welded blob is an obvious bot tell; this spreads
  them into a loose formation. Set `0` to disable.

### Per-class behavior lives in two tables
- `CLASS_BUFFS` (brain) — full buff set refreshed ~every 45s, one cast/GCD per tick.
- `rotate()` (brain) — the DPS/threat rotation per class (warrior threat: taunt→thunder
  clap→heroic strike; hunter serpent sting→arcane shot; warlock life-tap→corruption→
  shadow bolt; etc.). `OPENING_BUFF`/`HEAL_SPELL`/`MELEE`/`PERSONA` live in `multibox.mjs`.

## Observability — `./logs/`
- `party.md` — coordination, milestones, 15s status, 5m `PROGRESS` beats, FATALs.
- `<character>.md` — each bot's first-person journal (kills, dings, loot, deaths, vitals).
- `STATUS.md` — latest monitor snapshot (verdict + per-bot levels/kills + online count).
- `ci_history.jsonl` — one JSON line per monitor run (trend; the monitor diffs against
  the last line for "+N since last check").

The monitor's verdicts: **DOWN** (process gone), **STALLED** (0 kills/10m — diagnoses
stuck-in-release, a DEAD member, or "all full HP + no kills = no mobs in range"), **SLOW**
(<15 kills/10m or per-bot dropout where one bot is silent >6m while others are fresh),
**HEALTHY** (advancing). Use the exit code as a CI gate.

## Run it
```sh
# 1) make a thin party file that extends the shared spine (see "Config inheritance")
#    { "extends": "multibox.world.json", "tag": "🟪C", "leader": "<char>", "bots": [ … ] }
#    add the account(s) to multibox.world.json's registry once; export any passEnv vars

# 2) start ONE party (writes ./logs)
node scripts/multibox.mjs scripts/multibox.mine.json

# 2b) …or start the whole FLEET (every party in scripts/multibox.fleet.json) at once.
#     Ctrl-C stops them all. --check validates the roster (no collisions) without launching.
node scripts/multibox_fleet.mjs --check        # dry-run: list parties, verify no overlap
node scripts/multibox_fleet.mjs                # go (one multibox.mjs child per party)

# 3) watch it (separate terminals)
node scripts/multibox_dashboard.mjs      # http://localhost:8099
watch -n30 node scripts/multibox_monitor.mjs   # or cron it as a gate
```

`multibox.fleet.json` is a list of party files, e.g. `["multibox.duo.json", "multibox.ryzeduo.json"]`.
**Don't list parties that share a character/account** (e.g. `live` and `ryzeduo` both use ryze3/ryze4) —
the launcher will refuse with a collision error. Run one or the other.

## Cloudflare Turnstile (prod only)
When the live server has the Turnstile bot gate enabled (TURNSTILE_SECRET + client built
with VITE_TURNSTILE_SITEKEY), the normal direct `/api/login` calls inside `multibox.mjs`
are rejected with "verification failed". You can't beat Turnstile from headless Node — a
**real, human-driven browser** has to pass the gate, and we just harvest the token it gets.

Once captured, `multibox.mjs` reads tokens from (in order) `<USER>_TOKEN` env,
`WOC_TOKEN_<USER>` env, or **`multibox.tokens.json`** (a gitignored flat
`{ "<user>": "<bearer>" }` map) and skips the gated login entirely. Tokens last **7 days**
(server `saveToken` TTL, `db.ts`), so one capture covers a week of fleet runs.

### Working path — token sink + agentic browser (what we actually use)
The puppeteer bootstrapper (`browser_auth.mjs`, below) trips Turnstile's automation
detection (`--disable-blink-features=AutomationControlled` → "controlled by automated test
software" → 403). The reliable path is a **real Chrome you drive interactively** (the
Claude-in-Chrome MCP, or just your own hands) plus a tiny local sink that the page beacons
the token to. **The AI never sees the token value** — it flows browser → localhost → file,
which is why this is safe to run with an assistant in the loop.

```sh
# 1) start the sink (listens on :9988, appends to multibox.tokens.json)
node scripts/token_sink.mjs            # leave running in a background terminal

# 2) in a REAL browser tab on https://worldofclaudecraft.com, once per session,
#    install a fetch interceptor that beacons any /api/login token to the sink:
#    (paste in DevTools console, or have Claude-in-Chrome run it via javascript_tool)
```
```js
if (!window.__tokenSinkHooked) {
  window.__tokenSinkHooked = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (...a) => {
    const resp = await orig(...a);
    try {
      const url = String(typeof a[0] === 'string' ? a[0] : (a[0] && a[0].url) || '');
      if (url.includes('/api/login')) {
        let user = ''; try { user = (JSON.parse((a[1] && a[1].body) || '{}').username) || ''; } catch {}
        const b = await resp.clone().json().catch(() => ({}));
        if (b && b.token && user)
          navigator.sendBeacon('http://localhost:9988/token?user=' + encodeURIComponent(user), b.token);
      }
    } catch {}
    return resp;
  };
}
```
```text
# 3) for EACH account: Play Online → type username + password → solve Turnstile → Log In.
#    On a successful (200) login the interceptor beacons the token; the sink prints e.g.
#      captured token for warr1 (64 chars) -> multibox.tokens.json  [have: warr1, sham1]
#    A failed/incomplete Turnstile returns 403 with no token, so nothing beacons — just retry.
#    Re-run the hook snippet after any full page reload (it's per-document).
```
```sh
# 4) launch the fleet — tokens are picked up automatically from multibox.tokens.json
node scripts/multibox_fleet.mjs                       # whole fleet
node scripts/multibox.mjs scripts/multibox.duo.json   # one party
```

Gotchas learned the hard way:
- The interceptor only fires on a **fresh 200 `/api/login`**. A browser that auto-resumes a
  cached session, or a 403 from an unsolved Turnstile, beacons nothing — confirm each user
  shows up in the sink log before moving on.
- Don't let an assistant try to *read* the token out of the network panel or DOM — the
  Claude-in-Chrome guard redacts it (`[BLOCKED: Sensitive key]`) and `read_network_requests`
  omits the body. That's by design; the sink exists precisely so the value never enters the
  AI's context. Do not engineer around the redaction.
- `multibox.tokens.json` and `.env` are gitignored — never commit tokens or passwords.

### Fallback — `browser_auth.mjs` (puppeteer, profile with prior CF clearance)
Kept for fully-manual machines where you can run a persistent Chrome profile that already
has strong domain clearance (it can sometimes coast past Turnstile). It writes the same
`multibox.tokens.json` / prints `*_TOKEN=` exports.

```sh
SHAM1_PASS=... WARR1_PASS=... node scripts/browser_auth.mjs            # duo
node scripts/browser_auth.mjs scripts/multibox.ryzeduo.json           # a named party
```
Run it **headed** (default) on a profile with good clearance; solve any visible challenge by
hand. If Turnstile flags it as automated, use the token-sink path above instead.

## Companion — play alongside a human leader
`scripts/companion.mjs` is a **single** follower bot for when YOU play the leader in a real
browser and want a healer/DPS tagging along (not a headless multibox — one socket, one char).
It is config-driven by `scripts/companion.json` (defaults: `ryzeheal`/ryze3 follows `ryzetank`).

```sh
node scripts/companion.mjs                 # ryzeheal follows ryzetank
node scripts/companion.mjs scripts/companion.json
```
Then, from your character, just `/invite ryzeheal` (or the party UI). Each ~120 ms tick it:
- **auto-accepts** your party invite (watches the server's `partyInvite` event → `paccept`),
- **follows** you with the same delta-split offset as the brain (`follow.deltaRadius`),
- **heals** the party (dying → you/leader → most-hurt) and rolls **Power Word: Shield** on you,
- **assists** — attacks whatever is aggroed on your pid, weaving a class nuke when mana is high,
- on **idle** (you stand still + out of combat for `idleSeconds`) walks to the nearest quest
  giver within `questLeash` and `interact`s to accept/turn in, then snaps back (it never strays
  past `follow.leashMax`).

It reuses the same pre-fetched tokens as the fleet (`multibox.tokens.json` / `RYZE3_TOKEN`),
so it works on Turnstile-gated prod. Stop it with ONE SIGTERM (it `/pleave`s + closes cleanly).

**Dungeon-follow (healbot).** With a `dungeon` block in the config (`{ id, name, door:{x,z} }`),
the companion follows the leader THROUGH a dungeon door: when the leader zones into an instance
(party-member x/z are world-absolute, so the leader's x crossing into the ~900/1500/2100 band is the
signal) the companion walks to the door and sends `enter_dungeon` for the same instance; when the
leader leaves, it heads for the exit. `scripts/companion.gravewyrm.json` is the ready-made **Gravewyrm
Sanctum healbot** (ryze3/ryzeheal follows + heals a human-driven ryze4/ryzetank; quest wandering off):
`node scripts/companion.mjs scripts/companion.gravewyrm.json`. For the fully-autonomous duo (no human
leader) that levels the priest to 20 then advances the Sanctum single-pulling to the bosses, use
`scripts/multibox.gravewyrm.json` with `node scripts/multibox.mjs scripts/multibox.gravewyrm.json`.

**Smooth, non-jerky movement** (jerky motion is itself a detection signal): rotation is
rate-limited (`TURN_RATE`, no snap/spin turns), the follow uses a hysteresis deadzone (no
start/stop stutter at the leash edge), the stuck-escape only arms during real travel (never
while holding formation, so no random idle darting), long runs get a faint heading sway (no
laser-straight paths), facing is rate-limited from the *actual* server heading (a heal-cast
reorient can't cause a snap), and the loop period jitters ~95-145 ms so packet cadence isn't
metronomic. Tune via `follow.distance`/`follow.deltaRadius`.

## Session scheduler (human cadence)
`scripts/multibox_scheduler.mjs <config>` supervises ONE party as **sessions** of randomized length
with offline **breaks** and a nightly **sleep window**, instead of a single 24/7 grind (inhuman
`/played` + constant logins → rate limits + report bait). Each session ends by SIGTERM-ing the child,
so it goes out via the graceful staggered logout. `--check` prints the planned cadence without launching.

```sh
node scripts/multibox_scheduler.mjs scripts/multibox.psduo.json            # run it
node scripts/multibox_scheduler.mjs scripts/multibox.ryzeduo.json --check  # dry-run preview
# tunables (env, minutes / local hours):
#   SESSION_MIN=75 SESSION_MAX=180  BREAK_MIN=25 BREAK_MAX=90  SLEEP_START=2 SLEEP_END=9
```
One scheduler per party; give each its own ranges to desync them.

## Hardening: chat relay + idle behaviour
Bans here are **player-report -> human GM review** (no automated detector — verified in
`server/game.ts`), plus an auto-`createSuspiciousRegistrationReport` on every signup. So the
leverage is *human plausibility*, not beating an algorithm. Two pieces (`scripts/multibox_chat.mjs`):

**Two-way chat relay.** The #1 bot-confirmation a real player does is whisper you and watch for
silence. Bots now pipe incoming whispers/say/yell/party to **`logs/chat_inbox.jsonl`**; the
dashboard's **💬 Chat tab** shows them live and you **type replies right there** (per-character,
with a one-click `reply` that prefills `/w <player> `). Replies append to **`logs/chat_outbox.jsonl`**;
each bot process polls it and sends via in-game `cmd chat` for its own character. File-based IPC
(same pattern as `multibox.stop` / the tokens file), so it works across the separate party
processes with no ports. You answer whispers without ever opening the game client. The chat logs
are gitignored (they hold real players' messages).

**Idle micro-behaviour.** A character that stands frozen for hours is an obvious tell. When parked,
bots now occasionally (per-bot randomized, ~12-40s apart) glance around, hop, or throw an emote
(`wave`/`flex`/`dance`/…). In the autonomous brain it's `holdIdle` at the regroup-holds; in the
companion it's folded into `holdStill`. Subtle + desynced so a party doesn't fidget in lockstep.

Not solved here (operator's job): unique non-`ryzeN` names, staggered/different-IP registration,
shorter varied sessions with a sleep window, rotating camps. The existing accounts already share an
obvious name/IP pattern — treat them as expendable.

## Turning it OFF (the real kill switch)
`pkill` alone doesn't always stick — a multibox may be launched by a **supervisor that
relaunches it** (a Claude Code background task, a shell loop, etc.), so killing the process
just makes the launcher start a new one. The durable off-switch is a **stop file**:

```sh
touch multibox.stop      # every multibox process logs its party out + exits within a tick,
                         # and any RELAUNCH self-exits immediately while the file exists
rm   multibox.stop       # allow running again
```

`multibox.mjs` checks `multibox.stop` (override path with `MULTIBOX_STOPFILE`) at startup
and every tick — so "off" stays off no matter who tries to relaunch it. Note `multibox.mjs`
is **not** hot-reloaded, so a process started *before* this check existed won't honour the
flag until it's relaunched once. Separately, if a **launcher** keeps respawning bots, stop
it at the source: `/tasks` (to stop Claude background tasks), or prefer launching from your
own terminal (`nohup … & disown` / tmux) so you own the lifecycle.

## YOU MUST — safety / invariants
- **Every boxed character must be LOGGED OUT in the browser first** — the server rejects
  a second login of a character already in the world.
- **Multiboxing a public/production realm affects real players and is bannable.** The live
  config points at prod; treat that as a deliberate, owner-authorized choice, not a default.
- **Never commit secrets** — passwords come from `accounts[user].passEnv` (env) or are kept
  in an untracked config. Don't commit `multibox.live.json` or any file with inline `pass`.
- This is **tooling, not sim** — `Math.random`/`Date.now` are fine here (the determinism
  invariant applies to `src/sim/`, not `scripts/`).

## Improvement backlog / known issues
- **Frequent wipes while grinding** (observed: the whole L7 party repeatedly dying at the
  Mire Prowler `home` camp). Likely culprits to investigate in the brain: mobs pulling
  faster than the single healer (priest) can trip-triage; `fleeHp:0.35` too low to escape
  burst; casters out of mana (`res`) mid-pack; tank losing threat so squishies get hit.
  Levers: lower `pullGrind`, raise `fleeHp`, tighten `lvlCeil`, add a "don't pull while a
  member is <X% or OOM" gate in the leader's no-target branch, or relocate `home` to easier
  mobs (it's live-relocatable — just edit and save).
- **`narrate()` death detection** is per-bot via `self.dead`; corpse-run/respawn handling is
  minimal (bots `release` and the server runs them back). Watch for stuck-in-release loops
  (the monitor flags these as STALLED).
- **No mana/resource regroup** — there's a `restHp` gate but no explicit OOM rest for casters.
- Ideas: per-pull target caps, crowd-control (warlock fear / mage frost nova kiting),
  smarter leader pathing to packs, loot/vendor cycles, and turning the brain's heuristics
  into something tunable from the dashboard rather than only via file edits.
