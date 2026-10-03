# src/sim/encounters/hollow_crypt: the Hollow Crypt finale

Morthen's entrance at the Rite Ring and the Knellwyrm his dying rite summons
(`docs/design/dungeon-rework/hollow_crypt.md`, the fourth pass), ticked once per
claim by `tickCryptEncounters` (`index.ts`), called from `instances/dungeons.ts`
`updateInstances` right after the Bastion and Temple encounters.

| Module | Role |
|---|---|
| `ids.ts` | Leaf: ids, cast and aura ids, object templates, tuning and the pure geometry (`morthenEntranceHeight`, `strafeLane`, `inStrafeLane`, `wyrmArrivalPose`). The renderer and tests key on it. |
| `claim.ts` | The live crypt claims and the crypt's ephemeral encounter objects; the claim-generic reads are the Bastion's, re-exported. |
| `morthen_rise.ts` | The entrance: entombed (hidden, non-hostile, immune) until a player steps into the ring, then wakes, rise, proclaim, descend, land; `encounterHeld` keeps the mob AI off him until the fight. |
| `knellwyrm.ts` | The finale: the burning ritual circle, the flight in from the sky, the touchdown blast, then Pyre Strafe (a burning lane) and Dread Bellow (knockback, Bared Ribs) over the drake kit its template carries; the deed; the exit portal opens on its death (`bossExitPortal.after`). |

Rules:
- Deterministic: victims are hashed (`kitHash`), fixed DT countdowns; the only rng
  draws are damage rolls, in claim-player order.
- Every visible state rides existing entity fields (cast bars, heights, facing, the
  `crypt_entombed` concealment aura, encounter objects), so the online client mirrors
  it with no wire or IWorld change. The renderer withholds the view of a concealed
  entity (`src/render/quest_object_gate_core.ts`).
- The entrance plays once per claim (`Entity.cryptRite` on Morthen); after a wipe he
  stands at the altar. The finale plays once, after he falls.
- Tests: `tests/hollow_crypt_finale.test.ts`; dev: `/dev crypt rise [skip]`,
  `/dev crypt wyrm`, `/dev crypt trigger <strafe|bellow>`.
