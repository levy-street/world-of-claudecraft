# Training Dummy Preload Freeze: Postmortem

Date: 2026-07-17

Bug: teleporting near the zone3 ogre camp froze the client. Fixed in PR
#2078; the systemic backstop is tracked in issue #2079.

## Symptom

`/dev tp -90 668` (near the `thornpeak_ogre` war-camp in zone3) reliably froze
the client: the first frame rendered, then the screen stopped updating
entirely while sim ticks and audio kept running in the background. Reproduced
in both Chrome and Firefox, in offline mode.

## Exact error

```
Uncaught Error: character asset not preloaded: models/creatures/training_dummy.glb
    at resolvedGltf (assets.ts:530:17)
    at prepareVisual (assets.ts:884:16)
    at new CharacterVisual (visual.ts:221:18)
    at createCharacterVisual (index.ts:29:10)
    at Renderer.createView (renderer.ts:3457:18)
    at Renderer.createCandidateViews (renderer.ts:2146:12)
    at Renderer.sync (renderer.ts:4269:26)
    at perf.trace.mode (main.ts:2872:52)
    at PerfMonitor.trace (perf.ts:428:36)
    at main.ts:2872:14
```

Repeated on every single animation frame after the freeze started (192+
occurrences observed in one session), each with an identical stack.

## Why it looks like a freeze, not a crash

`requestAnimationFrame` keeps firing every frame (visible in the trace: `frame
@ main.ts:2761` -> `requestAnimationFrame` -> repeat), so the outer loop never
actually dies. But `Renderer.sync()` throws partway through
`createCandidateViews` on every single frame, before it finishes painting.
The screen never visually updates again, while the sim tick and audio (which
run earlier in the same frame, on a separate code path from the renderer)
keep working normally. That's why sound kept firing after the "freeze."

## Root cause

`training_dummy` is a zone3 camp near the ogre war-camp
(`{ mobId: 'training_dummy', center: { x: -40, z: 648 }, radius: 0, count: 1 }`,
the camp record in `src/sim/content/zone3.ts`), about 54 yards from the
teleport point.
Its model, `models/creatures/training_dummy.glb`, is deliberately marked
`lazyPreload: true` in `src/render/characters/manifest.ts` (it appears in
exactly one hub, so it was kept out of the eager boot sweep, the same
pattern the Combat Mech uses). Unlike the mech, nothing ever wired up the
matching "trigger the lazy load" call: `Renderer.createView` called
`resolvedGltf()` directly with no gate, so the moment a training_dummy
became a view candidate, the asset was never registered as preloaded and it
threw synchronously inside the render path with no surrounding try/catch.

The renderer's per-frame view-creation budget is priority-ordered
(`viewCandidatePriority` in `src/render/renderer.ts`): hostile mobs within
35 yards go first. The dummy is hostile despite being passive (the sim
deliberately keeps it attackable so it registers on damage meters;
`aggroRadius: 0` only disables aggro), but at about 54 yards out it sorts
into the beyond-35-yards bucket by distance, so the budget spends its first
frames on the ogres nearer the teleport point before reaching it. That's
why the freeze took a moment to appear and why initial reproduction
attempts felt timing-sensitive. Once the renderer did reach it,
the throw repeated every frame forever (the entity never gets marked as
having a created view, so it re-enters the candidate list every subsequent
frame), permanently stalling that frame's paint.

## How we confirmed it was pre-existing, not a regression

Initial testing was inconclusive: the bug reproduced repeatedly on the
`feature/mob-idle-sfx` branch but not on what was assumed to be a baseline,
which cast suspicion on the new idle mob-voice trigger code added on that
branch. That suspicion turned out to be a false lead: the "baseline" worktree
was accidentally still checked out at a stale commit from earlier in the same
session, dozens of commits behind the point `feature/mob-idle-sfx` actually
branched from (this repo moves fast, roughly 1000+ commits/week). The two
test servers were never running the same code, they were just at different
points in a fast-moving upstream, which is exactly the kind of gap that swallows
an unrelated fix or an unrelated regression between them.

Re-running the comparison against a baseline pinned to the EXACT commit
`feature/mob-idle-sfx` branched from (`9a5ce7a93`), with zero idle-sfx code
present, reproduced the identical error and freeze. That confirms the bug is
pre-existing in `release/v0.27.0` itself and entirely unrelated to the idle
mob-voice trigger work; no idle-sfx code appears anywhere in the stack trace.

## Fix

Adds `preloadTrainingDummyAssets()`/`trainingDummyAssetsReady()`
(`src/render/characters/assets.ts`), mirroring
`preloadMechAssets()`/`mechAssetsReady()` exactly, and gates
`Renderer.createView` (`src/render/renderer.ts`) the same way the mech is
already gated: trigger the load and defer that entity's view for a frame
instead of throwing. `training_dummy` was confirmed to be one of exactly two
`lazyPreload` visuals in the manifest (the mech is the other), so no other
creature camp shares this gap today.

## Follow-up (issue #2079)

Making `resolvedGltf` fail soft (log + skip that entity's view) instead of
throwing synchronously inside the per-frame render path would be a more
defensive backstop: it would stop ANY future missing-preload entry, for any
model added later without its own gate, from being able to freeze rendering
the same way this one did. Filed as issue #2079 rather than folded into
this fix.
