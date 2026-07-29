---
name: blender-anim-pipeline
description: Author new GLB animation clips for World of ClaudeCraft rigs (locomotion, attacks, casts, ability-specific motions, hit reactions, deaths, emotes) without inventing a new dispatch mechanism. Use when a class, mob family, or NPC needs a distinct clip instead of sharing a generic one, when growing coverage per issue #2889's large-scale animation authoring initiative, or when picking a batch (per class, per creature family, per ability set) for a follow-up PR. Covers the primary pose-sample-and-blend technique and the headless-Blender escalation path for poses no donor clip can supply.
user-invocable: true
---

# Animation authoring: pose-sample-and-blend, with a Blender escalation path

Full mechanics reference: `scripts/anim/pose_blend.mjs` (the shared module every consumer
imports; read its JSDoc before writing a new build script). This skill is the operating
procedure and the decision of when to escalate past it.

## Scope check first

This is for **new authored clips on rigs this repo already ships** (`public/models/chars/`,
`public/models/creatures/`). A brand-new creature or player skin needs the `asset-pipeline`
skill first (rig + base clip vocabulary); this skill only adds MORE clips to a rig that
already has a donor clip library baked in.

## Why two techniques, not one

Issue #2889 proposed a Blender MCP server driving new clip authoring at scale (1000+ clips).
Investigation found:

- No `blender-mcp` server is connected to this project, and no script in this repo invokes a
  `blender` binary. Blender-driven authoring is genuinely new tooling, not a wired-up path.
- `scripts/build_bow_anims.mjs` (merged, live in production, powers the hunter's bow-draw
  clip) is an existing, dependency-free precedent for authoring brand new clips WITHOUT
  Blender: it samples poses already baked into a rig's OWN clip library at chosen timestamps,
  blends between them with hand-authored easing, and bakes the result into a new clip wired
  through the ordinary `animUrls` + `ClipMap` mechanism.

So: **pose-sample-and-blend is the primary technique** for the large majority of this
initiative's scope (a class or creature family needing a distinct clip almost always has a
rig that already ships adjacent donor poses: an idle, a windup, a hold, a gesture). **Headless
Blender is the escalation path**, used only when no donor clip anywhere in the rig's shipped
library can supply the pose the new clip needs (a genuinely novel silhouette: a new weapon
grip angle, a creature-specific pose no shipped clip approximates).

Both land through the exact same seam: an `animUrls` GLB entry consumed by an existing or new
`VisualDef`/`ClipMap` in `src/render/characters/manifest.ts`. Neither technique touches
`src/render/renderer.ts` as the animation driver, and neither adds a dispatch path outside
`visualKeyFor` / `ClipMap` / `VisualDef` (issue #2889's own acceptance criteria).

## Technique 1: pose-sample-and-blend (default, no new dependency)

### 1. Pick the batch

Batches are scoped by class, creature family, or ability set, chosen so each batch's
`manifest.ts` edits are disjoint object literals (independent PRs, low merge-conflict risk).
Evidence a batch is worth doing:

- A class has few or no `attackByAbility` overrides across its kit (grep `manifest.ts` for the
  class's `player_<class>` block; count entries against `src/sim/content/classes.ts`'s
  ability list for that class).
- A creature family's `ClipMap` constant (e.g. `FLOATING`, `BIPED14`, `ENEMY7`) is shared BY
  REFERENCE across many unrelated mob templates (`grep -n "clips: <CONST>" manifest.ts`); a
  family with a distinct silhouette or role deserves its own attack instead of the generic set.

### 2. Inventory the donor rig's own clip library

Every technique-1 clip is sampled from poses the target GLB ALREADY ships. Inspect what is
available before writing any timeline:

```js
import { createGlbIO, indexClip } from './scripts/anim/pose_blend.mjs';
const doc = await createGlbIO().read('public/models/.../<rig>.glb');
console.log(doc.getRoot().listAnimations().map((a) => a.getName()));
```

Cross-reference against `manifest.ts`'s existing `ClipMap` for that rig: clips already wired
into `idle`/`walk`/`attack`/etc are documented donors; clips NOT named anywhere in the
`ClipMap` (an unused gesture, an alternate attack) are free raw material, same as
`build_elemental_anims.mjs` reusing golelingevolved.glb's shipped-but-unwired `No`/`Yes`
gestures.

### 3. Author the timeline

`scripts/anim/pose_blend.mjs` exports the full toolkit: `indexClip` (donor channel index),
`samplePose` (a full pose at time t), `poseValue` (channel lookup with fallback),
`mergePoses` (merge several donor poses into one fallback so a bone any donor animates always
resolves to something instead of `null`, see the doc comment for why a single-pose fallback is
often incomplete), `pushPoseRamp` (append an eased blend between two static poses),
`blendValue`/`lerpV`/`slerpQ`/`easeOutCubic`/`easeInOutQuad` (the underlying math), and
`bakeClip` + `stripToAnimationsOnly` (bake the authored timeline into a new mesh-free
AnimationClip GLB). `scripts/build_mage_ability_anims.mjs` and `scripts/build_elemental_anims.mjs`
are the worked examples: read one end to end before writing a new consumer.

Write the new script as `scripts/build_<class-or-family>_anims.mjs`, following the header
comment convention those two use (what's being authored, which donor poses, WHY each clip
reads the way it does, usage + output path). Support `--preview` (writes mesh+skin+clips to
`tmp/` for a full-rig sanity render) alongside the stripped, mesh-free production output.

### 4. Bake, review, wire

```
node scripts/build_<name>_anims.mjs --preview   # tmp/<name>_preview.glb: full rig + all clips
node scripts/build_<name>_anims.mjs             # production: public/models/.../<name>_anims.glb
```

Review the preview for the same quality bar the `asset-pipeline` skill holds static assets to:
**no foot sliding, no T-pose pops, correct loop points, no broken limbs mid-blend**. A
`null` reaching `slerpQ`/`lerpV` (the `mergePoses` trap above) throws loudly at bake time; a
plausible-but-wrong pose does not; render the preview and look before wiring it in. In-engine
verification (a screenshot or a live spawn) is the final gate, not the preview render alone.

Wire the clip into `src/render/characters/manifest.ts`:
- New clip on an EXISTING `ClipMap` the target already uses (adding a distinct attack to one
  member of a shared family, like the elemental): define a new `ClipMap` constant that spreads
  the shared one and overrides just the changed field (`ELEMENTAL_FLOATING` is the pattern),
  and point only the target `VisualDef` at it. Do not touch the shared constant itself, or
  every OTHER family sharing it changes too.
- New ability-specific casts on a class: add `attackByAbility` entries to that class's
  `VisualDef.clips`, keyed by real ability ids from `src/sim/content/classes.ts`.
- Every new clip's donor GLB gets listed in the `VisualDef.animUrls` array (mesh-free clip
  donors compose with the rig's base GLB at load time, same as `bow_anims.glb`).

### 5. Tests, build, gate

- A contract test parsing the shipped GLB's JSON chunk for the new clip names plus the
  `manifest.ts` source for the wiring (the pattern: `tests/weapon_skins.test.ts`'s "bow skin
  attack animation" describe block). Add one per batch.
- `node scripts/build_media_manifest.mjs generate` (auto in `npm run build`; dev needs no
  regen) so the new GLB preloads.
- `npx tsc --noEmit`, the new contract test, `tests/character_clipmaps.test.ts`, and
  `tests/architecture.test.ts` (sim purity: build scripts live under `scripts/`, never import
  from `src/sim/`).

## Technique 2: headless Blender (escalation only)

Use this ONLY when step 2 above finds no donor clip in the rig's shipped library that gets
close to the needed pose. This tooling does not exist in this repo yet; the first PR that
actually needs it also adds the script this section describes.

- **Inputs:** the target rig's GLB (for bone names/rest pose) plus a written pose spec
  (per-bone rotation/position targets, or a small set of named key poses): no reference
  video or mocap capture is assumed, this is scripted keyframe authoring, not tracking.
- **Invocation:** `blender --background --python scripts/anim/blender_bake_<name>.py -- <args>`.
  The Python script imports the GLB via Blender's glTF importer, sets bone transforms at
  authored keyframe times using Blender's own quaternion/vector interpolation (never
  hand-rolled slerp inside the Blender script; that duplicates `pose_blend.mjs` math for no
  reason), and exports via Blender's glTF exporter to a mesh-free clip GLB in the same shape
  `bakeClip` produces (only an `AnimationClip` + the bone node hierarchy, no mesh/skin).
- **Retarget correctness:** verify bone names in the exported clip match the target rig's
  names EXACTLY (Blender's importer can rename on collision); a mismatch silently fails to
  bind at runtime rather than erroring at build time, so this is checked by hand, not assumed.
- **Review checklist (same bar as technique 1, plus):** no foot sliding across the authored
  loop, no root-motion drift (the rig's root bone returns to its start position/orientation at
  a clip's loop point unless the clip is deliberately one-shot), no T-pose pops at any sampled
  frame, retarget bone names verified against the target GLB.
- **Where output lands:** identical to technique 1: `public/models/.../<name>_anims.glb`,
  wired via `animUrls` + `ClipMap`/`attackByAbility` in `manifest.ts`, same test/build/gate
  steps. The two techniques are indistinguishable to the renderer; only the authoring path
  differs.
- **Authoring-time only:** Blender is never a runtime or build dependency of the shipped
  client; this path runs locally when authoring a batch, the same way the `asset-pipeline`
  skill's Tripo calls are authoring-time, not part of `npm run build`.

## Tracking the 1000+ clip target across batches

This is a multi-PR initiative (issue #2889's own acceptance criteria: batches "trackable
across multiple PRs instead of one"). Each batch PR:
- Names its class/creature-family/ability-set scope and a rough clip count.
- Touches disjoint `manifest.ts` object literals from every other in-flight batch (new
  `ClipMap` constants, new `attackByAbility` keys on ONE class) to keep merge conflicts near
  zero.
- Ships its own build script, GLB(s), contract test, and screenshots, following the recipe
  above end to end. Do not land a batch's tooling without also landing a reviewed clip using
  it: an unused script is not progress toward the target.
