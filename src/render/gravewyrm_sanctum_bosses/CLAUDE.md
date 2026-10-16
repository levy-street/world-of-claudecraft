# src/render/gravewyrm_sanctum_bosses: the Sanctum's three boss fights, drawn

Korgath the Bound, Grand Necromancer Velkhar and Korzul the Gravewyrm
(`docs/design/dungeon-rework/gravewyrm_sanctum.md` section 6). Hosted by
`render/rift_death_zone.ts`; the bodies themselves are `characters/sanctum_boss_looks.ts`.
The environment (lake plates' static ice, the vault pools, the pillars, the Calving Face)
is `render/gravewyrm_sanctum/` and the trash fx `render/gravewyrm_sanctum_fx/`: other
owners, never edited from here.

| Module | Role |
|---|---|
| `boss_model_core.ts` | PURE (`RENDER_PURE_CORES`): the three art-guide bodies measured (URLs, sim scales, Idle bounds, gait refs, clip contact beats, Korgath's anchor bones and their rest spots, Korzul's mouth and shard), and the presentation gesture ids. |
| `boss_fx_core.ts` | PURE (`RENDER_PURE_CORES`): the cast specs (which bar lays which shape at the sim's size, in the threat palette), the chain sag and whip, the shackle glow, the plate looks and refreeze clock, the breath's plate pick, the Inferno's pulse fill, the landing shadow, the Unquenched countdown. |
| `sanctum_boss_art.ts` | Shaders and procedural geometry (plates, meltwater, rings, shadow, chain links, the Held ice, the Wyrm's Eye canvas, the wyrm fire ramp). |
| `sanctum_boss_fx.ts` | `SanctumBossFx`: binds pooled slots to the boss casts and encounter objects each scan, draws the frame, plays the beat bursts, sends the presentation gestures (Korgath's broken arm chains, Korzul's frozen stance and takeoff, Velkhar's thaw). |

Contract: every state is read from IWorld entities, keyed on
`sim/encounters/gravewyrm_sanctum/boss_ids.ts` (cast ids, aura ids, object template ids
and `scale`/`facing`), so offline and online draw the same. A claimed `spellfx` skips the
renderer's own handling, so this layer replays the boss's clip for it through
`playGesture` (ChainBreak, ChainYank, Roar, Hit, BreakFree).

Korzul's Break Free (the sim's `korzul_emerge_plan.ts`): his body stays hidden from his
pull until the BreakFree clip's burst beat (`KORZUL_BURST_AT`, `korzulBodyView`), the
same frame the face's frozen wyrm goes (`render/gravewyrm_sanctum/sanctum_face_core.ts`
`frozenWyrmShown`); the cinematic's clock is read off the bar, its beats played once
(`emergeCuesBetween`: the burst, the takeoff, the Land one-shot), his shadow follows him
down (`emergeShadow`) and the touchdown cracks the plates white for a moment
(`plateShock`, render only).

Rules: the telegraphs are the shared kit in the threat palette on every tier
(fairness); particles, steam and rune glow thin on the low tier (`density`). Every
mesh and material is built once in the constructor under one root attached through
`attachSceneGroupGated`; unlit shader materials only, no light. Floor rungs from
`floorVfxRenderOrder('encounter', n)` (registered strict in
`tests/floor_vfx_layer.test.ts`).

Tests: `tests/gravewyrm_sanctum_boss_fx_core.test.ts`,
`tests/gravewyrm_sanctum_boss_models.test.ts`.
