# Festering Venom damage precision

Knifework's Redhanded changes the per-stack contribution. The tooltip now preserves
that value; combat still rounds once after multiplying by the stack count.

| Surface | Before | After |
| --- | --- | --- |
| Level 14, desktop hover | [4 per stack](before-desktop.png) | [4.28 per stack](after-desktop.png) |
| Level 20, mobile long press | [4 per stack](before-mobile.png) | [4.4 per stack](after-mobile.png) |

Baseline: release/v0.42.0 at `797b4f572b02f3cd9ef399d5ba20abb49309896a`, served
from a clean detached worktree. Both sides use the `ability-tooltip` capture recipe
in `scripts/pr_shot_targets.mjs`, Knifework, and the lowest graphics preset.
Mobile uses a real held touch on the spell icon. Desktop is 1600 by 900; mobile
is 844 by 390 CSS pixels at device scale 2.

The capture runner logged existing asset-preload errors on both the clean release
and fixed versions. The spellbook and tooltip rendered on both surfaces.

## Precision decision

The stacking contribution intentionally keeps up to two decimal places. At level
14, five stacks deal `round(4.28 * 5) = 21`; displaying `4.3` would instead imply
`round(4.3 * 5) = 22`. Trailing zeros are omitted, so the base value remains `4`
and the level-20 value remains `4.4`. Flat poison amounts retain their existing
one-decimal formatting. `tests/ability_imbue_text.test.ts` pins the displayed
values against actual damage at every stack count and checks locale punctuation.

## Shadeslip review follow-up

Both existing Shadeslip variants were rerun on
`049a3dbafa4762ab62614b71064c3d0801dbe846` after the review flagged the missing
mobile evidence. The capture uses the unchanged `ability-tooltip` production
recipe, including its tooltip-visible assertion on mobile.

| Variant | Viewport | Interaction | Evidence |
| --- | --- | --- | --- |
| `shadeslip` | 1600 by 900 | Desktop hover | [Desktop tooltip](shadeslip-desktop.png) |
| `shadeslip-mobile` | 844 by 390, device scale 2 | Real touch held for 1100 ms | [Mobile tooltip](shadeslip-mobile.png) |

Both captures passed with a visible Shadeslip tooltip containing the full
description and `Enemy or friendly target`. Mobile also reported touch emulation
enabled (`maxTouchPoints: 1`). The tooltip fits within both viewports; both images
were visually inspected. No target failures or page errors occurred. The runner
logged the existing asset-preload console notes described above.

The local runner filters the production registry to these two variants and adds
the text/touch assertions; it does not change either variant or its capture code.
Recorded command (exit 0, both screenshots captured):

```sh
GAME_URL=http://127.0.0.1:5191 DIFF_FILE=tmp/pr3778-review/tooltip.diff \
SHOTS_DIR=tmp/pr3778-review/shadeslip-review NAV_TIMEOUT_MS=180000 \
ENTRY_SELECTOR_TIMEOUT_MS=180000 node tmp/pr3778-review/shadeslip_shots.mjs
```

`pnpm exec vitest run tests/ability_imbue_text.test.ts tests/pr_shot_targets.test.ts
--maxWorkers=2` also passed: 48 tests across both files. This follow-up adds
documentation and screenshots only; runtime code and the recipe are unchanged.
