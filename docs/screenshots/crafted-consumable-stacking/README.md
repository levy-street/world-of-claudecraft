# Crafted consumable stacking

Before: release/v0.45.0 at 55de7ffe926d781df7b2caee4314318c7ff730ac.
After: fix/crafted-item-stacking.

The same inventory contains 7 potions signed by Ana, 5 signed by Bru,
4 bread signed by Ana and 6 signed by Bru. Sorting now packs four slots
into two while retaining all 22 units and their makers. The JSON captures
record the resulting inventory composition.

Chrome checks at 1600x900 desktop and 844x390 touch landscape exercised
the market maker picker, keyboard focus containment, cancellation and
selection confirmation. Portrait captures at 390x844 retain the game's
existing rotate-to-landscape screen; portrait gameplay is not supported.
