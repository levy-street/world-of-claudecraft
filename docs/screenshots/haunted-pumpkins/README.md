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

## Size and beacon (feature/haunted-pumpkin-visibility)

The hunt pumpkin is now scaled up over the city kit's carved pumpkin and
breathes a slow warm beacon through its whole rind until found. Same rig,
same framing (`CAM_DIST=7 CAM_PITCH=0.7 PLAYER_DX=1.8 PLAYER_DZ=-2.2`), the
player standing behind the pumpkin so the camera sees its back, the side the
carved face never lights. Desktop day and mobile are preset 1 (the lowest,
Lambert tier); desktop night is preset 4, so the day/night grade applies.

| | Before | After |
| --- | --- | --- |
| Desktop, day, undiscovered | [before](size-glow-before-desktop-day.jpg) | [after](size-glow-after-desktop-day.jpg) |
| Desktop, night, undiscovered | [before](size-glow-before-desktop-night.jpg) | [after](size-glow-after-desktop-night.jpg) |
| Mobile landscape, undiscovered | [before](size-glow-before-mobile.jpg) | [after](size-glow-after-mobile.jpg) |
| Desktop, day, just found | | [after](size-glow-after-desktop-day-lit.jpg) |
| Desktop, night, just found | | [after](size-glow-after-desktop-night-lit.jpg) |

All six runs completed real screen picking and discovery with no page errors.

Portrait intentionally displays the game's existing rotate-to-landscape guard.
The touch tracker uses its strip instead of the desktop `qt-body`; the capture
shows zone and world progress in that strip. The desktop capture was preset 2,
with the real renderer and GPU. A separate preset-4 night run also completed
screen picking and discovery with no page errors. Both material tiers are unit
tested; the captures show the actual shipping GLB and existing VFX pools.
