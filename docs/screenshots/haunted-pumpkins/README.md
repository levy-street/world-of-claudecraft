# Haunted Pumpkins visual evidence

Captured in the actual offline client using `scripts/haunted_pumpkin_shot.mjs`
against the Halloween worktree, with the existing carved pumpkin GLB and real
screen picking. The rig asserts the picked reserved entity id, clicks it, and
requires the personal discovery ledger to advance. Both completed captures
reported no page errors. Local auth probes returned expected 502s with no server
running; they did not affect offline gameplay.

- [Desktop before](desktop-before.png)
- [Desktop ignition](desktop-ignition.png)
- [Desktop after](desktop-after.png)
- [Touch before](mobile-landscape-before.png)
- [Touch ignition](mobile-landscape-ignition.png)
- [Touch after](mobile-landscape-after.png)
- [Portrait orientation guard](mobile-portrait-after.png)
- [High preset, night before](high-night/desktop-before.png)
- [High preset, night ignition](high-night/desktop-ignition.png)
- [High preset, night after](high-night/desktop-after.png)

Portrait intentionally displays the game's existing rotate-to-landscape guard.
The touch tracker uses its strip instead of the desktop `qt-body`; the capture
shows zone and world progress in that strip. The desktop capture was preset 2,
with the real renderer and GPU. A separate preset-4 night run also completed
screen picking and discovery with no page errors. Both material tiers are unit
tested; the captures show the actual shipping GLB and existing VFX pools.
