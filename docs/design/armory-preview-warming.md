# Why the Armory catalog is not warmed ahead of time

The store's weapon-skin preview used to be warmed on a schedule after world
entry, so the first card inspect would be fast. It is not any more. This is the
evidence, kept here because the reasoning is the whole justification for
deleting a shipped optimisation, and because a stale belief about it would
invite the schedule straight back.

Measured on one desktop at ultra, 2560x1440 and later 1920x1080 at DPR 1, on a
local client connected to production, 29 catalog skins.

## What the warming cost

About 2.1 to 2.6 seconds of live-frame hitches, paid by every online session,
for a window only some players ever open.

What it bought, stated precisely because the two halves differ: **no
transferable GPU benefit at all**, because program caches do not cross a WebGL
context and the Armory has its own; and a **secondary CPU benefit** that was
real, because the character-mode units populated process-wide caches (parsed
GLBs, material and derived-emissive) the world renderer also reads. That second
half is not lost, it is MOVED: those costs now land on the first sighting of a
remote player wearing a given skin, a few to seventy milliseconds each, and only
for skins actually seen. See the trade at the end of this document.

## Why no gentler schedule was available

The cost is POSITIONAL, not per skin. The same skin costs a second or nothing
depending only on where it sits in the walk:

| skin | at position 0 | moved later |
| --- | --- | --- |
| `brasscap_axe` | 1239 ms | 0 ms |
| `guildmark_arming_sword` | 1053 ms | 45 ms |

There are two one-time costs (the first unit to DRAW, about 0.9 s, and the first
unit carrying a VFX rig, about 0.5 s) plus a small tail per new program variant.
**24 of the 29 skins cost the live frame nothing at all.** No ordering avoids
paying the two, so a gentler schedule was never on the table.

Weapon-mode warming went first on the same reasoning: three separate hitches of
156, 107 and 91 ms spent to remove a single 131 ms hitch on a second click
inside a window the player had already opened, and that 131 ms was itself
measured on the catalogue's most expensive skin.

## What the block is made of

Of the first unit's 1103 ms block, about 200 ms is `getProgramParameter`, twelve
calls of roughly 17 ms, which is one frame at 60 Hz: driver link waiting, and
synchronous, so not `compileAsync`'s timer polls. Texture upload is 1.3 ms.
Uniform and attribute introspection is 0.2 ms, which refuted the first theory:
`compile()` links programs without calling the lazy `getUniforms()`, but the
introspection turns out to be cheap. The remaining roughly 630 ms is JavaScript,
and the complete GL program-setup surface is traced, so nothing untraced
plausibly accounts for it. What that JavaScript is remains unidentified.

## What removal costs, measured before and after

Over 360 s of play, same machine and window, for a player who never opens the
store:

| | before | after |
| --- | --- | --- |
| queue main-thread block | 2837.8 ms | 1627.9 ms |
| felt stutter | 16462 ms | 11549 ms |
| hitches over 100 ms | 39 | 28 |
| armory units in the ranking | 11 | 0 |

For a store visitor, the first card inspect costs about 945 ms on a click they
made, and every card after it is cheap: a second card measured 79 ms, a second
VFX card 141 ms. The per-card cost does not repeat, which was the test set in
advance for "this removal is a bad trade".

## The attempt that failed, so it is not tried again blindly

Building the Armory stage on the store-open click was meant to make the first
card cheap. It moved about 420 ms onto the launcher click and the first card got
MORE expensive (945 to 1195 ms) instead of falling. A second version that also
drew once moved the open to 929 ms and left the first card at 1131 ms.

Neither explains the fact underneath: **even with the stage prebuilt, the first
inspect cost more than with no warming at all.** Two mechanisms were checked in
source and cleared: the appearance-signature rig disposal in `applyAppearance`
(the appearance is unchanged, so it early-returns) and "the warm never draws"
(the second attempt drew and changed nothing).

Before a third attempt, instrument the store journey to capture the queue's unit
LABELS, so it can be seen whether the warming units ran at all and what they
cost. Do not change code before that exists.

## Accepted, unmeasured trade

The secondary CPU benefit named at the top is the one thing removal gives up.
The character-mode units populated process-wide caches (parsed GLBs, material
and derived-emissive) that the world renderer reads when it first sights a
remote player wearing a skin. Those costs move to first sighting, a few to
seventy milliseconds each, and only for skins actually seen, rather than being
paid up front for all 29 whether or not any of them is ever seen.

It is accepted rather than measured: no capture was taken of first-sighting cost
before and after. If it ever looks like it matters, that is the measurement to
take, and the fix would be to warm those CPU caches WITHOUT minting the second
WebGL context, which is a different seam from the one this document is about.

The world's own weapon-skin program warming is a separate entry in the
renderer's entry manifest (`vfx.weapon-skins`) and is unaffected.

One cost the second context no longer carries: three's default
`debug.checkShaderErrors` issues a synchronous `getProgramInfoLog` round trip on
every program's first use, and the Armory preview, the character preview, and
the portrait rig all kept it on long after `renderer.ts` turned it off for the
world context. All three now read the same `?shaderdebug` switch through
`shaderDebugRequested()` (`src/render/shader_debug_flag.ts`), so the first
inspect no longer blocks on the driver once per linked program. The saving is
not separately measured; the numbers above predate the change.
