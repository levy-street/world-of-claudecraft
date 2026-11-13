# The Hammer vein's painted kit: sources

Built to the owner's style guide (design doc section 5.22). `paintings/` and `sheets/`
are the ChatGPT images as WebP. The Tripo builds stay local (`tmp/hammer_env/models/`).

To rebuild, put each Tripo build at `<jobs>/<name>/raw.glb`, then run:

```bash
node scripts/assets/smith_heart_hammer_env_kit/prepare_sources.mjs docs/design/raid/kit/hammer_env_src/paintings <jobs> tmp/hammer_env
```

Then Blender and `build.mjs` as the header of
`scripts/assets/smith_heart_hammer_env_kit/build.mjs` says.

| Model | Sheet | Tripo P2 task | Face limit | Credits |
|---|---|---|---|---|
| `Env_CliffTall` | `sheets/hv_sheet_cliff_tall.webp` | `9d89d16f-2927-46e6-b942-18f9fba0a35a` | 2500 | 110 |
| `Env_CliffWide` | `sheets/hv_sheet_cliff_wide.webp` | `03a11e42-f705-4b53-87dc-65dad2402f1f` | 2500 | 110 |
| `Env_Arcade` | `sheets/hv_sheet_arcade.webp` | `949248fa-ea84-4704-90a9-f28f62691512` | 3500 | 110 |
| `Env_Outcrop` | `sheets/hv_sheet_outcrop.webp` | `6cf88cfc-dafd-41ad-a204-9d523073e273` | 2000 | 110 |

## The prompts

Each attached the owner's concept paintings as the style reference. A sheet also
attached a mob turnaround for its layout.

- **Textures** (`hv_paving`, `hv_arena`, `hv_cliff`, `hv_moss`, `hv_block`, `hv_iron`): "a
  perfectly seamless tileable square game texture", top-down or front-on with no
  perspective, flat lighting, no objects or text, then the surface: flagstones in uneven
  courses; large irregular cracked arena flags; a quarried cliff of angular planes; olive
  moss dabs; cut stone courses; old forged iron with rust.
- **`hv_banner`**: a single tattered red banner, flat and front-on, on flat magenta (keyed
  out by `prepare_sources.mjs`).
- **`hv_sky`**: a dusk panorama, 2:1, seamless left to right, its lower third a violet haze.
- **Sheets**: "a three-view orthographic turnaround sheet of ONE game environment asset",
  FRONT, LEFT and BACK at one scale on one ground line, flat dark navy, no floor shadow, no
  labels, then the asset: a tall cliff stack; a broad bluff; a
  ruined three-arch arcade; a stepped outcrop with loose boulders.
