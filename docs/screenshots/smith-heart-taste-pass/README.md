# Smith's Heart: the taste pass

Three presentation-only changes to the raid (design doc section 5.27). Nothing under `src/sim/`
or `server/` is touched: no placement, collider, telegraph or timing moved.

Every pair is the same camera on the same spot: one shot of a fixed route through a raid
clear, captured from the untouched raid branch (before) and from this change (after).

## The Breath's storm

Seen still by still beside the other rooms, the Breath was the one vein at a single pale
value, so its guardian, its lightning and every telegraph had nothing dark to stand
against. Its air is now a dark neutral slate, its key an overcast's, its floor a dark matte
slate, and its painted storm deck hangs low with a cold rift on the raid's one sun.

- Walking onto the Storm Cornice: [before](before-01-cornice-arrival.jpg),
  [after](after-01-cornice-arrival.jpg).
- The Guardian of the Breath's fight: [before](before-02-cornice-fight.jpg),
  [after](after-02-cornice-fight.jpg). The guardian, the tornado, the lance's marker and
  the open rim's red edge all stand off the floor more than they did.
- The Wind Bridge: [before](before-03-wind-bridge.jpg), [after](after-03-wind-bridge.jpg).

## The light-rivers as veins of light

Three of the four floor rivers drew as flat translucent bands; the Heat's was already the
Hearth's seam of fire. The Hammer's, the Breath's and the Quench's are now a groove with a
thread of the vein's own colour, lying still until its guardian falls, and the bright ribbon
that runs once a guardian falls pools in its channel with feathered lips.

- The Hammer's river asleep, down the Grand Stair: [before](before-04-grand-stair-river.jpg),
  [after](after-04-grand-stair-river.jpg).
- The Breath's river asleep, on the Ring: [before](before-05-ring-river-asleep.jpg),
  [after](after-05-ring-river-asleep.jpg).
- All four veins lit: [before](before-06-ring-rivers-lit.jpg),
  [after](after-06-ring-rivers-lit.jpg). A lit river still reads far brighter than a dim
  one; that gap is pinned in `tests/smith_heart_river_veins.test.ts`.

## The hub's sky under the cliffs' line

The main map's sky panorama is pressed down behind the Ring's cliffs, so wherever the sky
showed under about 25 degrees (down a vein's mouth, from the Balcony) the dome read the
painting's last row: a flat brown band. The painting's own low clouds are now eased down to
the horizon there; over the cliffs nothing moves.

- From the Ring's east rim, west down the Heat's mouth: [before](before-07-hub-sky.jpg),
  [after](after-07-hub-sky.jpg). (The dim river in the foreground is the second change.)

## The lowest graphics preset, and a phone

Route information and progress draw on every tier, so both changes were checked where the
scene has the least help: [the Storm Cornice](low-tier-cornice.jpg) and
[a dim river on the Ring](low-tier-ring-river.jpg) on the lowest preset, and the same two on
a phone in landscape with the touch HUD, [before](mobile-before-cornice.jpg) and
[after](mobile-after-cornice.jpg), [before](mobile-before-ring-river.jpg) and
[after](mobile-after-ring-river.jpg).

## How these were taken

Offline, headless Chrome on a 1920x1080 viewport (saved here at 960x540), the highest
graphics preset unless a frame says otherwise, a level 20 warrior in the dev kit, driven by
`/dev heart ...` verbs (`enter`, `tp`, `kill trash`, `breath pull`, `breath tornado`,
`kill guardians`). The before frames come from the raid branch at the commit this change
sits on, served side by side. No code was changed for the capture.
