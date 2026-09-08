# Warrior area performance and forged steel

Development checkpoint, not AAA acceptance. Bladestorm and Reaping Arc now
have different performances built around their actual gameplay, using Tony's
Warrior reference board and the approved Battlecraft steel and copper palette.
The model keeps its original colors. Both attacks retain their full reach.

## Bladestorm

Three broad forged hooks rotate around the Warrior throughout the actual
channel, with raised copper cutting edges, scored dark steel faces, connecting
blue-gray wind, orbiting metal chips and short baked dust sprites. The center
stays open so the character can be read. A native braced weapon loop replaces
repeated ordinary chopping. The loop is seamless and keeps the feet planted.

The effect follows the living caster, including movement, and uses the actual
cast duration after haste. Each real damage pulse sends ground pressure through
the dust. Each real recipient separately receives a brief cutting imprint and
contact response. The final pulse still works when the channel state has just
cleared. Avoided attacks create no wound; absorption receives a collision flash.
Recipient count does not multiply caster animations or whole-area sounds.

The held silhouette uses the existing eight crest slots. If those slots are
occupied or the steel assets are cold, three compact cutting seams reserve the
front of the existing ribbon buffer before transient decorations. Eight admitted
storms use 1,056 of the existing 4,096 vertices for this fallback. No pool cap
was raised. Reduced motion freezes the rotation while retaining the footprint.

## Reaping Arc

One broad, tapered radial steel sweep marks the five-yard attack. A new native
greatblade performance loads, contacts at 0.15 seconds, follows through and
returns at 0.64 seconds. It does not also trigger the old high-speed body spin.
Offline checks sample the actual blade and preserve the native foot positions.
These checks establish forward contact and floor clearance, not a physical
blade collision with every target around the caster.

The primary sweep belongs to the cast. Recipient wounds use the existing
presentation sequencer and wait for the same 0.15-second contact frame, including
when the game delivers all recipient damage before that visual frame. They do
not replay the caster sweep, preparation sound or animation. This prevents
multiple targets from producing a stack of overlapping identical area effects.
At sequencer saturation, recipient decoration cannot evict an unplayed primary
cast. Excess recipient decoration is shed within the unchanged 24 slots rather
than triggering an early generic fallback. A 32-recipient regression retains
the primary sweep and 23 delayed contact imprints.

## World visibility

World review found that marked see-through scenery still wrote foreground
depth before transparent effects. Characters remained visible, but the storm
was rejected by the depth buffer. Browser isolation proved the cause: removing
only those scenery depth writes restored the storm; bypassing the opaque scene
capture did not. Missing assets, lost channel state and incorrect transforms
were separately ruled out.

The production fix draws those marked translucent scenery materials after
ordinary transparent content, retaining their existing depth writes and all
VFX depth tests. Stable group, explicit order, distance and object-ID ordering
remain unchanged inside each layer. This applies to every main-renderer quality
setting. A small renderer-construction module preserves WebGL2, supplied-context
identity and cleanup without growing the renderer coordinator.

A real-browser pixel test verifies that combat effects show through faded
scenery, opaque scenery still blocks them, and an additional solid wall still
blocks them. The same scene with the former stock ordering reproduces invisible
effects. Faded scenery can still tint content beneath its transparent overlay;
front/rear world views remain part of the art review.

## Review evidence and remaining work

Automated coverage includes actual event ordering, delayed recipient contact,
hit/absorb/avoid outcomes, the final channel pulse, moving anchors, missing
anchors, reduced motion, cleanup, native loop seams, geometry and existing
buffer limits under eight cold storms competing with transient effects.

The area stress harness checks supported preset IDs 1 through 6 and records the
resolved graphics profile. Advanced is the custom setting, not a fixed quality
tier. It uses real casts and the supported dev spawn command, and compares each
pulse with the recipients eligible at that pulse. World cases also use real
movement commands during the observed channel. Stepped captures do not measure
real-time frame pacing or establish auditory quality.

The matching Studio capture completes three real casts and 27 stills without
cast, page or context errors. The unchanged Bladed Gyre is included as a
regression reference. Pairs below use preset 4, yaw 1.9, pitch 0.4, distance 18,
with Reaping Arc at tick 4 and Bladestorm at tick 40.

| Ability | Before | Current development |
| --- | --- | --- |
| Reaping Arc | [Before](../screenshots/vfx-v25-warrior-area/cleave-before.png) | [After](../screenshots/vfx-v25-warrior-area/cleave-after.png) |
| Bladestorm | [Before](../screenshots/vfx-v25-warrior-area/bladestorm-before.png) | [After](../screenshots/vfx-v25-warrior-area/bladestorm-after.png) |

The current focused checkpoint passes 208 tests in 16 suites, plus the real
browser depth regression and existing context-recycle browser test. Types and
scoped Biome checks pass with warnings. A world monument shader independently
failed compilation because a local variable used GLSL's reserved `flat` keyword;
renaming its three uses preserves the calculation and passes its 28 tests.

The final stress matrix completes 16 casts and 64 stills with no page, shader,
cast, context or gameplay assertion errors. It covers all supported settings
1 through 6 in Studio, plus Low and Ultra in the world. Advanced resolves to
the current custom High profile. The 348 positive hits match actual eligible
recipients at each pulse; moving world storms correctly finish with 30 total
hits instead of the stationary Studio's 36. No recipient count was hardcoded
into the world assertions.

The world visibility examples use the same cast fixture, seed, camera and
1.5-second simulation point; scenery lighting/preparation can differ between
sessions, so these demonstrate visibility rather than a lighting comparison:
[before](../screenshots/vfx-v25-warrior-area/world-visibility-before.png) and
[after](../screenshots/vfx-v25-warrior-area/world-visibility-after.png).

The missing Insane setting from the earlier Warrior matrices is also backfilled:
nine real casts and 54 stills verify the resolved profile before and after each
cast with no errors. This covers Twinstrike, Red Harvest, Shieldcrack, Maiming
Strike, Early Grave, Bloodletting, Victory Rush, Redhand and Brute Swing.

Three further shader-initialization suites pass 29 tests after the creation
checks followed the new factory. Existing ordering assertions remain, and new
checks establish that the factory itself cannot compile or draw before graphics
initialization. The separate historical Warrior parity question is reconciled:
the unchanged replay, committed-golden and gameplay-coverage checks pass three
tests. The old five event hashes were already explained and committed in the
authorized snapshot; no golden or gameplay assertion was changed here.

A further rear-camera world review completes one moving cast and four stills
without errors. The forged storm remains visible around the recipients against
the harbor scenery, with normal depth testing retained.

Sustained repeated casting, broader terrain and camera review, dedicated area sound
polish, full-kit balance of visual weight and the two complete improvement
cycles remain required. No ability or kit is declared AAA complete here.
