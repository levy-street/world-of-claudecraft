---
name: gravewyrm-farm
description: How the recurring 5-man Gravewyrm Sanctum bot farm is run, monitored, and its loot policy
metadata:
  type: project
---

**DEFUNCT as of ~2026-06-29:** the prod realm flagged the user's multiboxing (same-IP multi-account detection) and is enforcing it, so this prod farm is retired. The user pivoted to LOCAL autonomous agents, see [[local-hunter-agents]]. (Do NOT help evade the IP detection to resume prod multiboxing.) History below kept for reference.

The user repeatedly runs an automated **5-man Gravewyrm Sanctum farm** (L20 elite instance) to maximize Korzul (final boss) clears and bank gear. This is an active, recurring task, not a one-off.

**Launch/monitor entry points (untracked scripts in `scripts/`):**
- Run it resiliently via `scripts/_farm_supervisor.sh` (nohup background) — it relaunches `node scripts/multibox.mjs scripts/multibox.gravewyrm4.json` as one 5-bot group for a 6h window (`runSeconds`/WINDOW), auto-retrying crashes/transient login errors.
- Live logs: `logs/party.md` (durable: boss kills `KORZUL DEFEATED`, loot `💎 ... looted:`, phase msgs) and `logs/_gravewyrm_session.out` (per-tick status lines + login).
- Orchestrator `scripts/multibox.mjs` is NOT hot-reloaded (relaunch to apply); the per-tick brain `scripts/multibox_brain.mjs` IS hot-reloaded on save (edit live, no relog).

**Current party — 4-MAN (`multibox.gravewyrm4.json`, supervisor CFG points here as of 2026-06-29):** **paladin TANK + leader** (pala1/Pontius — Protection: Righteous Fury aura + Consecration spam for threat; auto-picked as tank since it's the first melee and there's no warrior), **priest HEALER** (ryze3/ryzeheal — Renew + Lesser Heal + PW:Shield; `healerDps:false` per user = pure heals), **enh shaman melee DPS** (sham2/Shims — Stormstrike + Earth Shock), **hunter ranged DPS + puller** (ryze/swifter — auto-driven bot here, NOT the manual guest it was in the attunement), plus **ryzemage (mage) as an OPERATOR-CONTROLLED GUEST** (`combat.guests:["ryzemage"]` + a hot-reloadable `FARM_GUESTS` fallback in the brain so it applies with no relaunch). The bots INVITE ryzemage but never drive it: the leader re-invites it at the door (`inviteGuests`), and the muster HOLDS at the Sanctum door until it joins (`guestsMissing` + `F.guestWaitStart`, capped at `guestWaitMs` 180s so a no-show can't strand the farm), so it is in the group BEFORE they zone in. The operator drives its Frostbolt + Conjure Water — ryzemage is the WATER source + a 4th DPS, added back because the thin 4-man had NO water (0 drink events: `conjure_water` is mage-only) so the paladin OOM'd on the ~60-min Korzul fights. Consecration is KEPT for its Korzul damage (user: "consecration is worth it for the damage actually on korzul") — the mana fix is the mage, not cutting Consecration. The warrior (ryzetank) stays OFF the farm. Brain support: `'shaman'` is in the orchestrator `MELEE` set so the enh shaman closes for Stormstrike; the paladin tank's Consecration threat is enabled (`_farmNoThreat` false for tank); Righteous Fury auto-applies to the tank via CLASS_BUFFS. Note the paladin has NO taunt, so threat-grab off the hunter's pull is via Consecration/Seal proximity, slower than the old warrior taunt. The trio variant (`multibox.gravewyrm3.json`, paladin+priest+shaman, no hunter) is kept as an alternative but is not the supervisor default.

**Loot policy (binding):** the LEADER/TANK need-rolls everything; everyone else greeds (the `answerLootRolls` rule is now `b === leader ? need : greed`, generalized from the old warrior-only check). So gear consolidates on the tank — ryzetank in the 5-man, Pontius (paladin) in the trio.

**Operational gotchas:**
- Prod login is Turnstile-gated: bots use pre-fetched tokens in `multibox.tokens.json` (captured via a browser; AI never sees token values). Account ryze5 has a token.
- Character names are letters-only (no digits) — the mage character is `ryzemage`, not `ryze12`.
- A crashed/killed launch leaves "ghost online" characters that block relaunch; the orchestrator now reclaims them via `POST /api/characters/:id/takeover` and closes joined sockets cleanly on a mid-login fatal.
- Relogging mid-run disbands the party and abandons in-progress instance state; prefer hot-reloading the brain over relaunching while a run is making progress. See [[gravewyrm-farm-recovery]] for the in-instance recovery design.
