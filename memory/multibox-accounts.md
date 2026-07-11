---
name: multibox-accounts
description: The dedicated multibox accounts/characters on Claudemoon, shared password, who's banned, and the configs
metadata:
  type: project
---

User runs box accounts on the live Claudemoon realm, all password **ryze12**. The server's bans are
**player-report -> human GM review** (no automated detector), plus an auto suspicious-registration
report (with IP) on every signup. Bans correlate with cumulative playtime, NOT logout timing — see
[[multibox-staggered-logout]]. As of 2026-06-17, FOUR accounts are banned.

| Account | Character | Class | Status |
|---|---|---|---|
| ryze2 | ryzehunts | hunter (~L8) | ok — solo, agentic brain |
| ryze3 | ryzeheal | priest (L14) | ok — ryze duo + companion |
| ryze4 | ryzetank | warrior (L15) | ok — ryze duo leader |
| ryze5 | ryzemage | mage (L9) | ok — solo |
| pala1 | Pontius | paladin | ok — psduo TANK (heal-capable but tanks) |
| sham2 | Shims | shaman | ok — psduo healer |
| ryze6 | ryzelock | warlock | **BANNED** |
| warr1 | Durgan | warrior | **BANNED** |
| sham1 | Tovak | shaman | **BANNED** |

Banned accounts scrubbed from every config + `.env` + `multibox.tokens.json`. Treat accounts as
expendable. As of 2026-06-17 the ryze accounts hit the per-account `/api/login` brute-force throttle
("rate limited") from repeated relaunches/token captures — use the session scheduler to space logins.

Configs (all `extends multibox.world.json`): `multibox.ryzeduo.json` (ryze4+ryze3),
`multibox.ryzemage.json` (ryze5 solo), `multibox.ryzehunts.json` (ryze2 solo), `multibox.psduo.json`
(pala1 Pontius tank + sham2 Shims heal). Fleet = `multibox.fleet.json`.

Tooling: `scripts/companion.mjs` (ryze3 follows a HUMAN-played ryzetank), `scripts/multibox_chat.mjs`
(two-way whisper relay → dashboard 💬 Chat tab + idle fidget), `scripts/multibox_scheduler.mjs`
(human-cadence sessions + sleep window). Brain `multibox_brain.mjs`: `followAnchor`/`TUNABLES.spread`
(anti-lockstep), `healerRole` (a heal-capable TANK still tanks). Prod is Turnstile-gated → tokens via
the sink workflow [[multibox-turnstile-tokens]]. See [[agent-play-setup]] for driver + protocol facts.
