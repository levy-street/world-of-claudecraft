# Fast travel: the Grand Teleport and the Hellgate

Two class gates that carry a GROUP. There is no hub-to-hub fast travel of any
kind (no flight paths, no waystones), by maintainer ruling on #3932: a mount
stays the free option for one traveller.

## The Grand Teleport (mage)

- **Data:** `src/sim/content/grand_teleports.ts`. ONE destination, Highwatch,
  as one ordinary mage class spell (`grand_teleport_highwatch`) learned at
  `GRAND_TELEPORT_LEARN_LEVEL` like the rest of the kit: no tome, no quest
  unlock, no per-city variants. The destination table is a list so a second
  city is a data row, never a new code path.
- **Cast:** `GRAND_TELEPORT_CAST_TIME` seconds, out of combat, consumes one
  Rune of Passage (`RUNE_OF_PASSAGE_ITEM_ID`, `RUNE_BUY_COPPER` from Trader
  Wilkes in Eastbrook and Provisioner Hale in Fenbridge). Opens a Grand Portal
  that stands for `GRAND_PORTAL_DURATION` seconds and admits only members of
  the mage's group at the moment of casting; a member who steps through lands
  at the authored landing through `displacePlayer`. Plain
  `GRAND_TELEPORT_COOLDOWN`.
- **Reagent seam:** `AbilityDef.reagent` (`src/sim/types.ts`). Refused without
  the reagent, re-checked at completion, removed at the ONE spend site beside
  the resource cost (`combat/casting_lifecycle.ts`). A summon that finds no
  footprint refunds the rune and clears the cooldown (`refundFailedSummon` in
  `combat/effect_dispatch.ts`).

## The Hellgate (warlock)

- **Data:** `src/sim/content/hellgate.ts`. One ability (`hellgate`) and the
  three-quest pact that teaches it (`HELLGATE_QUEST_ORDER`: Apothecary Lin,
  Scout Maren, Loremaster Caddis, warlock-only); `HELLGATE_FINAL_QUEST_ID` is
  the `requiresQuest` gate.
- **Cast:** `HELLGATE_CAST_TIME` seconds, out of combat, `HELLGATE_COOLDOWN`;
  the gate stands `HELLGATE_DURATION` seconds and the warlock who opened it
  clicks it while targeting a group member to pull them to it.
- **The toll:** `HELLGATE_BLEED_PCT` of max health a second and no natural
  regen (`HELLGATE_BLEED_AURA_ID`, `selfDotPctMax` with `noRegen`).
  `combat/auras.ts` ticks THAT aura id as a non-lethal toll (floored at 1 hp,
  no combat entry); every other self-sourced dot, Bad Air included, stays on
  `dealDamage`.

## The party gate seam

`src/sim/party_gate.ts` owns both objects: `Entity.partyGate` (runtime only)
records owner, party and eligible ids; the party join hook admits a late
joiner; `updatePartyGates` (head of `runDespawnDecay`) ends a Hellgate and its
toll when its warlock dies, while a Grand Portal outlives its mage. Neither
gate carries anyone onto or off an instanced plane. The renderer draws both
through `src/render/summoned_objects.ts`.

Obligations: i18n rows plus the five non-Latin fills, `sim_i18n.ts` rows for
the sim text, committed rune and Hellgate art with `mapping.json` provenance,
deed `prog_hellgate_pact` (the Grand Teleport is an ordinary level-up spell and
authors no deed). Pinned by `tests/party_gate.test.ts` and
`tests/summoned_object_visuals.test.ts`.
