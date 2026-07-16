# Weapon VFX Gen: the prompt playbook

Hand a batch of generated weapon models plus their design codex to a Claude agent and get
back rarity-tiered runtime effects (glow, particles, luminescence, cast light), authored,
wired into the live asset inspector, and visually verified one weapon at a time. This file
is the reusable recipe for that loop: the prompt to run, the contract the agent follows,
and where every piece lands in the repo.

The first run of this playbook produced the Hoarfrost (Epic) and Fallen Star (Legendary)
collections in `weapon_vfx.js`; the second run (the Full Set drop) completed Hoarfrost,
added the restrained Rare Emberwrought tier, and proved the loop on a dual-grip bow. Use
it again whenever a new collection drop needs effects.

## The prompt

Adapted from the original Fable 5 run. Swap the placeholders, paste the rest verbatim.

```
/goal using every weapon ASSET in <HANDOFF ZIP OR FOLDER>, read their corresponding
weapon skin description THEN greatly enhance them with lighting / particle /
luminescence etc (all the things you can think of) effects and display on the weapon
inspector -- ensure that your animation enhancements match the level of "rareness" of
each item. The specs are described in <DESIGN CODEX FILE>

alert me when each one is done to preview in the viewer -- make sure they are perfect
and legitimately cool (people would pay for them on the asset store and want to flex
in-game with these)
```

Inputs the prompt expects:

- **A handoff drop**: one folder or zip with `<key>.glb` + `<key>.jpg` + `<key>.position.json`
  per weapon (the shape `pipeline.mjs` emits). The position files carry the grip family and
  fine-tune the engine uses; VFX are authored in the GLB's canonical frame (grip at origin,
  blade along +Y) so they work standing and in-hand without touching that data.
- **A design codex**: the per-weapon skin descriptions plus the rarity ramp (which tiers get
  which effect classes). The Armory Codex is the reference example: Plain and Fine get NO
  effects, Rare gets an emissive glow, Epic gets glow + sparkle, Legendary gets
  glow + sparkle + shimmer with orbiting motes, aurora and cast light.

## The contract the agent follows

1. **Read everything first.** Every weapon in the drop, its lore line, its tier, and the
   codex's per-tier effect brief. Import any weapon missing from `public/models/weapons/`
   (GLB + icon + `KAYKIT_WEAPON_ACCESSORY` entry; grip overrides come from the position file).
2. **Author, do not bake.** Effects are runtime layers in `weapon_vfx.js`, never edits to
   the GLB or its textures: a per-weapon spec in `WEAPON_VFX` (components: `coreSprite`,
   `motes`, `aurora`, `drift`, `twinkles`, plus the automatic emissive de-bake, fresnel
   shell, cast light, backdrop and ground pool from the tier defaults in `TIERS`).
3. **Rarity is load-bearing.** A tier may never borrow a higher tier's kit: no orbit motes
   or aurora below Legendary, no effects at all on Plain and Fine. Flagship (hero) weapons
   sit at the top of their own tier, never above it.
4. **Prove every weapon in the inspector.** Open the live viewer deep link
   (`http://localhost:<port>/#a=<key>`), screenshot the pedestal at multiple moments, the
   held-by-knight view, and the VFX-off restore, and fix what looks wrong before moving on.
   The bar is: someone would pay for this on an asset store and flex it in-game.
5. **Alert per weapon.** As each weapon passes review, notify with its deep link so a human
   can preview it immediately; do not batch the reveal to the end.
6. **Keep the gates green.** `npx vitest run tests/asset_pipeline.test.ts
   tests/held_weapon_models.test.ts tests/architecture.test.ts`, biome on changed files,
   no em dashes or emojis in code or copy.

## Where the pieces live

| Piece | File |
|---|---|
| Tier presets (bloom, emissive window, light, float, scene dim) | `weapon_vfx.js` `TIERS` |
| Per-weapon effect specs | `weapon_vfx.js` `WEAPON_VFX` |
| Emissive de-bake (texture -> emissive map + darkened albedo) | `weapon_vfx.js` `deriveEmissive` |
| FX tuning channels (slider multipliers) | `weapon_vfx.js` `DEFAULT_TUNING` |
| Scene lighting presets (day, dusk, night, dungeon, snow) | `weapon_vfx.js` `SCENE_PRESETS` |
| Viewer integration (composer, float, toggle, banner) | `viewer_live.js` |
| Inspector UI (VFX toggle, fx sliders, scene select, deep links) | `viewer_template.html` |

## Reviewing a weapon by hand

Run `node scripts/asset_pipeline/pipeline.mjs library --serve --port 5180 --open`, click a
weapon (or open its `#a=<key>` deep link), then:

- **VFX checkbox** compares enhanced vs shipped-model looks in place.
- **FX TUNING sliders** scale each channel live (glow, bloom, light, core, motes, aurora,
  mist, sparkle, shell, pool); values persist, Reset returns to the authored 1.0x.
- **scene select** relights the stage (Showcase, Daylight field, Dusk, Moonlit night,
  Dungeon torchlight, Snowfield) to judge readability under game conditions, including on
  the held character.
- **held by** equips it on any class body through the real grip math; GRIP FIT still works
  with the rig attached.

If a slider setting reads better than the authored value, bake it back into that weapon's
spec in `WEAPON_VFX` (the sliders are preview multipliers, not persistence).
