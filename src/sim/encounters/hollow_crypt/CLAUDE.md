# src/sim/encounters/hollow_crypt: the Hollow Crypt boss fights

The three wing bosses (Sexton Marrow, the Lady of the Bonechill, Cantor Ilvane),
Morthen's entrance and three-act fight at the Rite Ring and the Knellwyrm his
dying rite summons
(`docs/design/dungeon-rework/hollow_crypt.md` section 5), ticked once per
claim by `tickCryptEncounters` (`index.ts`), called from `instances/dungeons.ts`
`updateInstances` right after the Bastion and Temple encounters.

| Module | Role |
|---|---|
| `ids.ts` | Leaf: ids, cast and aura ids, object templates, tuning and the pure geometry (`morthenEntranceHeight`, `strafeLane`, `inStrafeLane`, `wyrmArrivalPose`). The renderer and tests key on it. |
| `claim.ts` | The live crypt claims and the crypt's ephemeral encounter objects; the claim-generic reads are the Bastion's, re-exported. |
| `boss_state.ts` | Type-only leaf: the wing bosses' fight states (`Entity.cryptBossFight`). |
| `marrow_ids.ts`, `marrow.ts` | Sexton Marrow in the Bell Yard: Shovelful (a locked cone), Measured for the Grave (a mark, then a persistent Open Grave: Grave Dirt), the Burial Toll at 66 and 33 percent (the stride to the bell rope, immune, three peals, every grave raises a Restless Bones); heroic Gravedigger's Blow, Grave Vigor, Unquiet Earth; the A Tidy Churchyard deed. |
| `lady_ids.ts`, `lady.ts`, `lady_lanterns.ts`, `lady_embrace.ts`, `lady_ice.ts` | The Lady of the Bonechill (boss id `rimeweb`, frozen): Bride's Lament and the three grave lanterns (two to a lantern, dark after a Lament, Lingering Lament stacks), the Frozen Embrace (a CARRIED body, src/sim/carried_body.ts: set down when hurt enough, dropped otherwise), the Rime Path and the Bridal Freeze (slippery ground, src/sim/slippery_ground.ts); heroic burning-out lanterns and a two-player Embrace; the Nobody Left Hanging deed. |
| `ilvane_ids.ts`, `ilvane.ts`, `ilvane_organ.ts` | Cantor Ilvane and the Hollow Choir: the Dirge of the Hollow (kickable through `ILVANE_CAST_SCHOOLS` in mob/healer_channel.ts; completed, the trash engine's G6 line-of-sight nova `novaVictims`), Harmony, the Bone Organ's note lanes, Crescendo; heroic Encore and Unbroken Verse; the Hush Now deed. |
| `morthen_ids.ts` | Leaf: Morthen's fight ids, auras, object templates (the candles, the Grasp rings, the Bound Soul orb), `MORTHEN_TUNING` (every number), the arena spots (`RITE_CANDLE_SPOTS`, `RITE_ALCOVE_SPOTS`, `candleBodySpot`) and the pure tests (`graveChillAt`, `inGraspRing`). |
| `morthen.ts` | Morthen's fight after his entrance: the Calling (the telegraphed Shadow Pulse bar, Gravecall), the Rite of the Unquiet at 65 percent (immune at the altar, Grave Chill, two Restless Bones; the fourth candle shatters the ward: an 8 s stun the encounter lays itself and a 25 percent vulnerability), his Last Rites at 35 percent (Reap the Unquiet, a locked 120 degree sweep); the Every Candle Lit deed; `resetMorthen` on a wipe or evade. |
| `morthen_gravecall.ts` | Gravecall: a Bound Soul from the next alcove (clockwise), the trash engine's G5 walker (`BOUND_SOUL_WALKER`, an 'event' launch rolling to Morthen alone; its arrival stacks Gorged on the Dead through `empower.maxStacks`, a body in its path takes it). |
| `morthen_candles.ts` | The four Remembrance Candles of the Rite: a usable body per dark candle (the `crypt_remembrance_candle` template's G3 'relight' use, held through hits), completions read off `Entity.kitUseCompletedBy`, the per-second drain on the lighter (a share of their own health, a channel's bites recounted from zero), heroic Name the Dead (the hashed Ledger order, the wrong candle snuffs the last lit one). |
| `morthen_grasp.ts` | Heroic Grasp of the Grave in every act: two hashed rings (the mark aura carries the radius), the hands erupt after the fuse (root and shadow inside). |
| `knellwyrm_knell.ts` | The Knellwyrm's heroic Burning Knell: it takes wing over the ring (`holdAloft`), marks half the ring (one `ctx.rng.int` per mark, never the last quarter), breathes over that half, three times, then lands; its other clocks wait. Hooked from `tickKnellwyrm`; ended by its reset and kill. |
| `morthen_rise.ts` | The entrance: entombed (hidden, non-hostile, immune) until a player steps into the ring, then wakes, rise, proclaim, descend, land; `encounterHeld` keeps the mob AI off him until the fight. |
| `knellwyrm.ts` | The finale: the burning ritual circle, the flight in from the sky, the touchdown blast, then Pyre Strafe (a burning lane) and Dread Bellow (knockback, Bared Ribs) over the drake kit its template carries; the deed; the exit portal opens on its death (`bossExitPortal.after`). |

Rules:
- Deterministic: victims are hashed (`kitHash`), fixed DT countdowns; the only rng
  draws are damage rolls, in claim-player order, and the Burning Knell's half (one
  draw at each mark, before that mark's damage rolls).
- Every visible state rides existing entity fields (cast bars, heights, facing, the
  `crypt_entombed` concealment aura, encounter objects), so the online client mirrors
  it with no wire or IWorld change. The renderer withholds the view of a concealed
  entity (`src/render/quest_object_gate_core.ts`).
- The entrance plays once per claim (`Entity.cryptRite` on Morthen); after a wipe he
  stands at the altar. The finale plays once, after he falls.
- Tests: `tests/hollow_crypt_morthen.test.ts`, `tests/hollow_crypt_knell.test.ts`,
  `tests/hollow_crypt_finale.test.ts`, `tests/hollow_crypt_marrow.test.ts`,
  `tests/hollow_crypt_lady.test.ts`, `tests/hollow_crypt_ilvane.test.ts`,
  `tests/slippery_ground.test.ts`; dev: `/dev crypt rise [skip]`, `/dev crypt wyrm`,
  `/dev crypt pull morthen`,
  `/dev crypt trigger <strafe|bellow|knell|shovel|grave|blow|toll|lament|embrace|freeze|dirge|organ|crescendo|pulse|gravecall|rite|candle|reap|grasp>`.
