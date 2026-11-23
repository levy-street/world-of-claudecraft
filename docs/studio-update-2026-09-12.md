# Studio update 2026-09-12: Tidehold fixes and the Castle B stair audit

This snapshot carries the Tidehold building fixes from 2026-09-11 and 12.

## Bank

The awning over the shop window is a small kit gable cut at the wall. Its
plaster end wall used to hang inside the overhang, short of the post, and
read from the street as a dark triangle floating over the wares. The end
wall is deleted after the cut, so the lean-to has open ends. Bounds are
unchanged.

## The hall (the church)

The pews sat lengthways at feast tables, sideways to the throne. They are
now four rows a side facing the dais, the candelabra stand on the side walls
between the rows, and the two tables flank the dais as credence tables.
Collision follows the new layout.

## Castle B

Every flight is now a single stepped block of the walls' stone, so the
stairs join the stone bake and read like the walls instead of flat grey
wedges with smeared tile edges. The raking parapets are solid bands of slab
stone. The ceiling joists stop at each stairwell (they used to cross every
flight at head height) and the balustrade that stood across the landing of
the back wall flight is gone.

The hall flight now starts 3.6 kit units behind the front wall, over a
standable box at the hall deck's height, so there is floor to walk onto it.
The back wall flight starts 2 units further east, which leaves a walkway
from the landing along the back wall onto the middle floor. Both flights are
shorter and steeper.

Two collision holes were found by the new walk test and closed: the
Warden's floor stopped at the inner face of the front wall so the balcony
doorway had no floor, and each wing landing left a hairline crack against
its floor box. The castle sits exactly at the caps, 64 boxes and 16 ramps.

Upper storey furniture and tiles stay loaded anywhere inside the castle
(keepStoreys on its interior reveal spec); only the roof hides.

## Tests

tests/tidehold_castle_b_flights.test.ts samples every flight against the
installed colliders (step size, no drops, summit height, 2 yd of head room)
and then walks the level paths between each flight and the floor it serves.

## Build chain notes

scripts/assets/blender_tidehold/README.md has a 2026-09-11 section with the
recipes and the traps hit (thin bands in the shared stone bake, the parapet
pocket shadow, vertex AO on slab stone, the ramp cap).
