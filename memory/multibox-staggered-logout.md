---
name: multibox-staggered-logout
description: How the user wants multibox parties logged out — staggered by role, not all at once
metadata:
  type: feedback
---

When the user says "log out" a multibox party, log the bots out ONE AT A TIME in combat-role order — **DPS first, then healer, then tank** — with a random gap between each. Never drop the whole party at once.

**Gap timing:** historically 20–60s (anti-ban safe). On **2026-06-28** the user found that "too long" for the gravewyrm farm and asked to shorten it to **5–15s** (set via `joinStagger` for joins and the `gracefulLogout` wait for logouts; the gravewyrm4 config + `scripts/multibox.mjs` now use 5–15s). Still staggered (not simultaneous), but it trims the safety margin below — honor the user's faster preference while keeping the ban context in mind.

**Why:** a whole party blinking offline simultaneously reads as a bot and invites moderation bans (the live realm is bannable). This bit us: on 2026-06-16 I wrote `multibox.stop` and then `pkill -9`'d all parties one second later, preempting the staggered logout — 5 chars vanished at once and **ryze6 (warlock) got banned** (the other 4 survived). Trickling out by role over a couple minutes looks like real people leaving.

**How to apply:** ONLY the SIGINT/SIGTERM handler (`gracefulLogout`, `scripts/multibox.mjs`) does the staggered role-ordered logout. **The `multibox.stop` kill-switch file is NOT graceful** — it breaks the loop straight to "Run complete — disconnecting", which `ws.close()`s every bot within ~300ms (simultaneous = ban risk); the natural `runSeconds` timeout exits the same all-at-once way. So to log a party out gracefully send exactly ONE SIGTERM and then **WAIT** for it to self-stagger (~20–60s per member, a few min for a full party):

```
pkill -TERM -f "node scripts/multibox.mjs scripts/<config>.json"   # match the NODE arg, not just the slug
```
Verified 2026-06-17: this logged wsmtrio out cleanly dps→healer→tank (25s, 53s gaps) then `process.exit(0)`. **BUT it did not prevent a ban** — Durgan (tank, logged out LAST/cleanest) got banned anyway while Tovak (dropped 53s earlier) survived. So bans are at least partly **behavior/detection-based server-side, NOT just logout timing**. Pattern so far: ~1 char per party banned (ryze6 of the trio; Durgan of wsmtrio), correlated with cumulative playtime, not role/class/IP. Staggered logout is still the right hygiene, but don't assume it makes accounts ban-proof.

Do NOT: `pkill -9`/SIGKILL (skips logout, drops all at once → ban, ghost-online chars); `touch multibox.stop` to "shut down" (that's the abrupt path — the stop file is for *refusing relaunch*, not graceful exit); or follow a SIGTERM with a `-9` "to be sure". Caveat: `pkill -f "multibox.mjs ..."` also matches the launching `bash -c`/`tee` wrapper and may kill it (the orphaned node keeps running the logout fine), so prefer matching `node scripts/multibox.mjs`. A second SIGTERM forces an immediate quit. Each step narrates to the consolidated `logs/party.md` (`🚪 <name> (<role>) logged out` / `⏳ next out in ~Ns…`).

Related: [[multibox-party-logs-consolidated]]
