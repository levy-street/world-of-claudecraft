# The vein crystals: sources

The four small crystals that stand at the head of each vein's light river, one in each guardian's
arena (`public/models/props/smith_heart_vein_crystals.glb`; render
`src/render/smith_heart/vein_crystal.ts`, plan `vein_crystal_core.ts`). The owner's ask of
2026-11-26: cover the bare end of the light where it starts in each arena, and have a crystal grow
out of that spot when the guardian dies; "do the crystals similar to the ones in the middle", so
each is one element of the Ring's heart seal crystal (`../ring_crystal_src/README.md`) on its own.

`sheets/` holds the four ChatGPT turnaround sheets (FRONT, LEFT, BACK) as WebP, `prompts.json`
every sheet's exact prompt. Each sheet was made with the ring crystal's approved sheet and that
element's view of it attached, in one chat, so the four share one scale, style and collar. The
Tripo builds and the full-size images stay local (`tmp/arena_crystals/`).

| Crystal | Sheet | Tripo Studio setting | Credits |
|---|---|---|---|
| The Hammer's amber columns | `sheets/vein_crystal_hammer.webp` | Smart Mesh, P2.0, multiview (front, left, back), triangles, polycount 2000, four candidates; one texture pass | 100 + 30 |
| The Breath's storm prisms | `sheets/vein_crystal_breath.webp` | the same | 100 + 30 |
| The Quench's ice | `sheets/vein_crystal_quench.webp` | the same | 100 + 30 |
| The Heat's frozen flames | `sheets/vein_crystal_heat.webp` | the same | 100 + 30 |

## What the model is

One GLB, one painting, two nodes per vein. `<Vein>_Collar` is the low ring of dark slabs with the
element's light in its seams, plus a lid over the socket (dark stone, the element's light at its
middle), so the collar alone covers the floor while the guardian lives. `<Vein>_Crystal` is the rest:
hidden until the guardian dies, then grown by its own scale from the floor, its roots inside the
collar. Authored with the collar's radius 1, its underside on the floor and its front (+z) where the
lit seam is; the painter scales it (`VEIN_CRYSTAL.collarR`) and turns the front down the river.

The Blender step (`../build_smith_heart_vein_crystals.py`) sets each Tripo build in that frame
(rounding out a collar Tripo squeezed along one axis), parts the slab ring from the crystal by
height and radius, adds the lid, regrades every collar to the same dark granite (Tripo painted the
Heat's purple in its fire's light; the lit seams keep their colour), and lays the four paintings
into one 1024 atlas, a quadrant each.

## Rebuild

From the repo root, with the four Tripo exports at `tmp/arena_crystals/raw/<vein>.glb`:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --python docs/design/raid/kit/build_smith_heart_vein_crystals.py
```

```bash
node scripts/assets/build_assets.mjs scripts/assets/specs/smith_heart_vein_crystals.json
```

```bash
node scripts/assets/compress_glb_textures.mjs public/models/props/smith_heart_vein_crystals.glb
```

```bash
node scripts/build_media_manifest.mjs generate
```

The shipped file is pinned by `tests/smith_heart_vein_crystals.test.ts` (every vein's pair, the
frame, the triangle budget, one KTX2 painting, under the owner's 1 MB budget for a small object).
