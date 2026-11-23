# Gourdlight Eve exploration pumpkins

The collection in `src/sim/content/gourdlight_pumpkins.ts` covers the normal
overworld zones. Tutorial, dungeon, raid and battleground spaces are excluded.
Pumpkins use the existing seasonal city's carved pumpkin model, scaled up
(`HAUNTED_PUMPKIN_SCALE` in `src/render/haunted_pumpkin_core.ts`) so a hunt
pumpkin reads as a quest object from a distance rather than street dressing,
with personal materials: an undiscovered pumpkin breathes a soft, slow beacon
through its whole rind (`hauntedPumpkinBeacon`, one period of a few seconds in
the kit's own candle colour, so it reads from any side and never washes out on
the Lambert tier by day), and a discovered pumpkin stays candle-lit for its finder
with the light back in the carved face. Reduced motion holds the beacon at its
mid level instead of pulsing. Both states read the same at every graphics tier
and in daylight. City decorations are independent, keep their natural size and
nervous candle flicker, and grant no collection credit.

The ordinary object interaction validates the active event, living character,
reach, inventory capacity and previous discovery on the authoritative simulation.
Each accepted discovery gives one Gourdlight Sweet. Another player can discover
the same object independently. Repeated clicks cannot earn additional sweets.

The quest tracker and touch strip show local-zone and worldwide progress without
publishing locations. Completion grants the zero-Renown seasonal Feat
`feat_pumpkin_hunter` (Pumpkin Hunter), whose permanent cosmetic title is
`the Hollow`. Like the Gourdlight title writs, it pages on the Reliquary Titles page
under the locked every-non-hidden-title rule (`docs/design/reliquary.md`).

`HAUNTED_PUMPKIN_EDITION` owns the edition independently of daily reset. A bounded,
allowlisted current-edition ledger travels in the existing seasonal character
save fragment, together with the normal inventory snapshot. There is no database
query or immediate save for each click. Closing the event preserves discoveries;
changing the edition replaces the collection ledger but never removes an earned
Feat or title. New yearly collections must receive an explicit edition decision.

Older binaries do not preserve the new save field when writing a character.
After enabling discoveries, do not route a character through an older writer
without accepting that its current collection progress can be lost on rollback.

## Naming review

Reviewed 2026-10-17 using exact phrases and component words, including searches
against Warcraft, RuneScape, Guild Wars 2, FFXIV, ESO, Diablo and Path of Exile wiki
domains. Haunted Pumpkin, Pumpkin Hunter and the Hollow are ordinary descriptive
English, with no coined franchise term. Generic wording is allowed by
`docs/design/naming-audit.md`; this is a naming screen, not a legal clearance.
The same words appear in unrelated game names, including
[Haunted Pumpkin](https://forevermuffin.itch.io/haunted-pumpkin) and
[The Hollow](https://store.steampowered.com/app/4381460/The_Hollow/).
