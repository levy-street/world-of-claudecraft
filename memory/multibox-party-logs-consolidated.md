---
name: multibox-party-logs-consolidated
description: User wants all multibox parties logged to one shared party.md (single dashboard tab)
metadata:
  type: feedback
---

The user wants ALL multibox parties to write to the one shared `logs/party.md` (the single "party" tab on the :8099 dashboard), interleaved and distinguished by each party's `tag` emoji (🟦A, 🟥B). Do NOT split parties into per-config log files — they explicitly asked to consolidate after a per-party split confused them ("I don't see B under party").

**How to apply:** `scripts/multibox.mjs` sets `partyPath = logs/${cfg.partyLog ?? 'party.md'}`. Leave `partyLog` unset in configs so everything lands in `party.md`. The startup banner APPENDS (`▶️ session start`) rather than truncating, so a shared file isn't wiped when a 2nd party starts. A config CAN set `"partyLog": "party.foo.md"` to break one party out into its own tab, but default is consolidated.

Related: [[multibox-staggered-logout]]
