---
name: duo-density-ceiling
description: psduo (paladin tank + shaman healer, no DPS) structurally can't avoid deaths at dense L11 Mirefen/cult blob camps
metadata:
  type: project
---

The **psduo** party (Pontius paladin tank + Shims shaman healer, `multibox.psduo.json`)
has a hard survivability ceiling at the dense L11 Mirefen swamp / Gravecaller cult camps
(drowned 90,420 · trolls -80,420 · cult 15,470), which spawn 7–8-mob blobs.

**Why deaths are unavoidable there:** a melee tank + healer with **no DPS, no CC, and no
ranged pull** must walk *into* the cluster to engage, proximity-aggroing 7–8 at once. Slow
kills (paladin melee + mana-gated shaman nuke) mean mobs stay alive and out-damage the heals.
Each death → graveyard rez far south (z~300) → long runback = the "running back and forth"
the operator hates.

**Tuning applied (reduced deaths ~10×, not to zero — `scripts/multibox_brain.mjs`):**
heal-range-priority healer positioning, mana-reserve (`healerNukeMana`), combat-gated quest-runs,
bounded healer standoff, engagement cap (`maxEngage`), death-avoid camp switching (`deathAvoidCap`),
lake-bypass (no swimming), `campRadiusMax`. See those tunables/comments.

**The fix that actually works: the TRIO** (`multibox.psm.json`, +ryze5 mage DPS) — it cleared
these same camps at ~28k xp/h with **no death spiral**, because the mage's fast kills keep the
live-mob count low. The operator chose the duo; if zero-deaths matters more than 2-box, re-run
the trio. Otherwise the duo's residual deaths are "die and regroup" under `dieFreely`.

Related: [[agent-play-setup]] [[multibox-accounts]] [[multibox-staggered-logout]]
