# Shoulder pads on the WOC bodies: before and after

The offline client at the lowest graphics preset (headless Edge on SwiftShader), a
warrior of each body type in the Proving Shore start area wearing Reinforced
Pauldrons, and Marshal Redbrook (an NPC on the warrior's class body and kit) moved
beside the player. BEFORE is `feature/v045-integration` as it was; AFTER is this
branch, whose only runtime change is the rebuilt hand-keyed animation libraries.

- `compare-male.png`, `compare-female.png`: zoomed crops of the same frame, before
  and after, at idle (front, three quarter, side), mid-run, and beside the NPC.
- `before-*.png`, `after-*.png`: the full frames for the front and side idle and the
  NPC shot.

At idle the pads used to tip about 80 degrees, riding down the outside of the
arm; they now tip about 35, as the rig's own clips carry them, and sit on top of
the shoulder.
