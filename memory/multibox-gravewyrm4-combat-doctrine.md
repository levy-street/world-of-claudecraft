---
name: multibox-gravewyrm4-combat-doctrine
description: How the gravewyrm4 farm party should fight packs - focus fire + hunter pet off-tanks + hunter survives
metadata:
  type: feedback
---

The gravewyrm4 fleet ([[multibox-accounts]], party in `scripts/multibox.gravewyrm4.json`)
kept overpulling Sanctum packs (3 mobs vs maxEngage 1) and wiping, with **swifter (the
hunter) dying first** because loose adds peeled onto the squishy puller.

Operator's required doctrine for these multi-mob pulls:
1. **Focus fire** - the whole party kills ONE mob at a time (the tank's focus). Already
   implemented in `multibox_brain.mjs` via the `state.focusId` lock + the `tankHasLead`
   gate (DPS wait for the warrior to build a threat lead before piling on). Keep it.
2. **swifter sends their pet** - the hunter's pet OFF-TANKS a loose add (the extra mob the
   tank hasn't grabbed) so it is never on the hunter. Wired in `multibox_brain.mjs`: if the
   pet is DEAD, `pet_revive` it (throttled ~5s; the corpse must still exist) and THEN set
   it `pet_mode` `defensive`; keep it in auto-taunt/hold mode (`pet_auto_taunt` with
   `enabled:true` - it needs the explicit boolean), then `pet_attack` + `pet_taunt` the
   loose add (refreshed ~3s). Detect the pet on the wire via `e.own === hunter.id`
   (dead pet = same with `e.dead`).
3. **swifter doesn't die** - the hunter holds RANGE and kites: Wing Clip (L10, melee) /
   Concussive Shot (L8, ranged) to slow whatever reaches him, then step back. He must not
   stand in melee.

**Why:** swifter is cloth-squishy ranged DPS + designated puller; without the pet eating
the extra mob and a slow to peel, an add kills him and the wipe cascades.

**How to apply / GAP:** the pet logic is a NO-OP unless swifter actually has a **tamed
pet** (`tame_beast`). The brain does NOT auto-tame, and there are no tameable beasts in
the Sanctum - the operator must tame a beast in the open world BEFORE the run (and
`revive_pet` if it dies). If "swifter sends their pet" still doesn't fire, check that a
pet entity exists (`e.own === swifter.id` on the wire). See [[multibox-staggered-logout]]
and [[multibox-gravewyrm4-logout-ryzemage]] for the rest of this fleet's config.
