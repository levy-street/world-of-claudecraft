# Smith's Heart: the light crossfades between rooms

Walking from one of the raid's rooms into the next (a vein into the Ring, the Ring into
a vein, the hop into the Heart), the room's light used to change in one frame: its fog,
the key and fill lights' colours and strengths, the rim and the key light's direction all
snapped to the new room's while the raid's own sky took about a second to blend. Now the
whole look crossfades over one second (smoothstep), the key light swinging round over the
top so the shadows turn with it. The way into the raid and out of it still cuts.

## Frames

One walk up the East Stair from the Quench's first landing into the Ring, the camera
crossing from the Quench's aurora night into the Ring's dusk. Every frame is the same spot.

- Before: the scene held [the Quench's light](before-01-quench-light.jpg) right up to the
  crossing, then jumped to [the Ring's](before-02-ring-light.jpg) in one frame.
- After: the same second passes through [16 percent](after-01-fade-16.jpg),
  [38 percent](after-02-fade-38.jpg) and [62 percent](after-03-fade-62.jpg) of the fade
  before settling on exactly the Ring's light (`before-02`, which is also the fade's
  last frame).

Captured offline in the app's built-in browser on a 1280x720 viewport, saved at 800x450 (`/dev heart enter`,
`/dev heart tp quench`, auto-run west). To catch the in-between frames the page clock
was slowed (each `requestAnimationFrame` timestamp scaled) from the crossing on, so the
light and the sky blend slowed together; each frame's fade progress was read from the
renderer as it was taken. No code was changed for the capture.

## Measured in real time

A real-time walk across the same crossing, sampled every frame at 30 fps: the crossing
frame still shows the Quench exactly (fog `#34466a`, sun 1.9, hemisphere 1.45); the values
then ease across and land on the Ring's preset exactly at 1.0 s (fog `#686a72`, sun 2.55,
hemisphere 2.6, sun colour `#ffdab0`), the key light's height peaking near 0.79 midway.
No `live-program` gpu-prep event fired across the session's crossings and teleports: the
fade only rewrites uniforms the settle already wrote, on the one sun and hemisphere.

## Implementation

- `src/render/fog_scene_fade_core.ts`: the policy (only a settle between two Smith's
  Heart rooms fades, `SMITH_HEART_ROOM_FADE_SECONDS`), the smoothstep, the look and key
  direction blends, the fade clock. Pure; `tests/fog_scene_fade_core.test.ts`.
- `src/render/fog_scene_fade.ts`: reads the look before a settle and after it, puts the
  old one back and steps toward the new one each frame. `tests/fog_scene_fade.test.ts`,
  which also pins the renderer's wiring.
- `src/render/renderer.ts`: the settle edge routes through the fade, steps it each frame,
  turns the key light through it, and drops it on the rift's per-frame rig.
