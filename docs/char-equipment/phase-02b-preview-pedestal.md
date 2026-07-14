# Phase 2b: Preview pedestal + equipment-visual base seam

Goal (render-domain, user-approved 2026-07-11): the character preview stands on a real 3D stone pedestal inside the character window, and `CharacterVisual` gains the equipment-visual base seam so armor-on-model can be added later without rework. Armor meshes themselves stay deferred: the model keeps showing class rig + skin + mainhand weapon only.

## Design contract

### 1. Pedestal (`src/render/characters/pedestal.ts`, new module)

- A procedural stone pedestal mesh (think: low cylinder platform with a rim, matching the mockup's round stone dais). Procedural geometry + procedural material consistent with the repo's approach: NO new GLB, texture, or HDRI files (the media manifest must not change; `npm run asset:budget` stays untouched).
- Export a single builder, e.g. `export function buildPedestal(): THREE.Group` (exact material/vertex detail is the implementer's judgment; keep it cheap: this renders in the always-on preview rAF loop, so no per-frame allocations and modest poly count).
- Style: dark stone with a subtle top highlight so the character reads against it; must look right in the window's dark panel. Verify visually against the mockup via the screenshot script.

### 2. `CharacterPreview` opt-in (in `src/render/characters/preview.ts`)

- New method `setPedestal(visible: boolean)`, default OFF. Lazily builds via `buildPedestal()` on first enable, adds/removes it from the preview `scene`, positions it under the model's feet.
- Camera framing: the existing fit uses the model's `Box3`; frame on the MODEL as today (the pedestal sits below and may extend slightly out of frame at the bottom, like the mockup). Do not let enabling the pedestal change how large the character renders.
- `captureCloseup()` (player-card headshot, preview.ts:307) must be unaffected; if the pedestal could appear in any capture path, hide it during capture and restore after.
- The pedestal is enabled for EVERY mount into the character window's own `#char-model-preview` container, and off everywhere else. Disambiguation (resolved in Phase 2b QA): the char window's own inline cosmetic skin row (`Hud.renderCharSkinPicker`, whose swatch click handlers re-mount into that SAME `#char-model-preview` element) IS a char-window mount and correctly keeps the pedestal on, so an in-window skin swap does not flicker the pedestal away. The consumers that keep pedestal OFF are the ones that mount a DIFFERENT container or a separate `CharacterPreview` instance: the PRE-GAME char-select / char-create preview (`src/main.ts`, its own `CharacterPreview` and `renderSkinPicker` into `#online-skin-row` / `#offline-skin-row`) and the cosmetic skin-event overlay (`Hud.openSkinEvent`, which mounts into `.se-preview`). Enumerate them by grepping `mountCharPreview` and `new CharacterPreview`; the rule is "char-window mount only (i.e. into `#char-model-preview`), default off everywhere else."
- Dispose cleanly in `destroy()` (geometry/material released with the tracked context).

### 3. Hud wiring

`Hud.mountCharPreview` (hud.ts:11734-11760) gains a way for the char-window mount to enable the pedestal (an options parameter or a call after mount, implementer's choice, but the skin-picker path and any other existing call sites must not change behavior). The char window painter itself still never imports `CharacterPreview` (the existing source-scan tests forbid it); the enable lives in Hud, like the rest of the preview lifecycle.

### 4. Equipment-visual base seam (defer the visuals, land the path)

- `src/render/characters/preview_appearance.ts`: `PreviewAppearance` gains an optional `equippedItems?: Partial<Record<EquipSlot, string>>` field. Keep `appearanceSignature`/`previewAppearanceVisual` correct for the new field (signature must change when equipment changes so future armor swaps re-render; extend `tests/preview_appearance.test.ts` accordingly).
- `src/render/characters/visual.ts`: new method `CharacterVisual.setEquipment(equipped: Partial<Record<EquipSlot, string>>)` that (today) stores the map on the instance and applies ONLY the existing mainhand path (delegate to the existing `setWeapon(equipped.mainhand ?? null)` behavior, visual.ts:463). Document with a comment that per-slot armor attachment lands here later. No visual change beyond the weapon today.
- `CharacterPreview.setAppearance` (preview.ts:127) passes `equippedItems` through when provided; `Hud.mountCharPreview` supplies `world.equipment` for the char-window mount so the data path is live end to end even though only the weapon renders.
- Do NOT touch the main renderer's per-frame entity diff (renderer.ts 4434-4441) or the wire mirror; the seam is preview-scoped until the armor feature arrives.

### 5. Tests

- Extend `tests/preview_appearance.test.ts`: signature stability with/without `equippedItems`, signature changes when an equipped item id changes, unchanged behavior when the field is absent.
- `CharacterVisual`/`CharacterPreview` are GLB-and-WebGL-heavy; do not force a unit test that mocks Three wholesale. Cover what is pure (appearance signature), assert the weapon delegation if a cheap seam exists, and verify the rest visually: `node scripts/char_equipment_shot.mjs` shows the pedestal under the character in the desktop shot, and a manual skin-picker check shows NO pedestal there.
- If any new pure logic module emerges (only if genuinely pure), name it `*_view`/`*_core` and register it in `RENDER_PURE_CORES` (`tests/architecture.test.ts`); otherwise skip registration, plain render modules are not scanned.

## Starter Prompt

```
This is Phase 2b of the Character Equipment Screen feature: Preview pedestal + equipment seam.

Model: Opus 4.8, xhigh effort. Harness: Claude Code. No ultracode.

Goal: 3D stone pedestal under the character in the char-window preview (off everywhere else),
plus the equipment-visual base seam (PreviewAppearance.equippedItems -> CharacterVisual
.setEquipment) with weapon-only rendering today.

STEP 0 - PRE-FLIGHT: git status clean, feat/char-equipment, Phase 2 QA PASS per progress.md.
Read docs/char-equipment/state.md yourself. Memory scan: verify-in-game-with-clear-sightlines,
meshy rig scale (context only; you are adding NO new GLBs).

STEP 1 - LOAD CONTEXT:
Spawn one Explore agent to read and summarize:
- docs/char-equipment/phase-02b-preview-pedestal.md (this file)
- src/render/characters/preview.ts (whole: scene setup, framing, animate loop, captureCloseup,
  setAppearance, destroy) and preview_appearance.ts + tests/preview_appearance.test.ts
- src/render/characters/visual.ts: constructor, assembleModel, setWeapon (:463), dispose path
- src/render/characters/index.ts (barrel) + src/render/characters/CLAUDE.md
- src/ui/hud.ts 11690-11770 (mountCharPreview + all its call sites: grep mountCharPreview)
- src/render/CLAUDE.md (performance discipline; procedural material conventions; how other
  procedural geometry in src/render builds materials without asset files)
- tests/architecture.test.ts RENDER_PURE_CORES block
Return: the preview scene/camera/framing mechanics, every CharacterPreview consumer and
mountCharPreview call site, the setWeapon flow, disposal conventions, and one example of
existing procedural geometry+material to imitate.

STEP 2 - EXECUTE (inline, one coherent render slice):
Implement the design contract exactly: pedestal module, setPedestal opt-in (default off,
char-window mount only), captureCloseup guard, equipment seam (appearance field + signature,
setEquipment storing + weapon delegation, pass-through in setAppearance and mountCharPreview),
disposal. Then verify in the running app: pedestal present + character framed like before in
the char window, absent in the skin picker and any other preview surface, drag-rotate still
smooth, equip/unequip a weapon updates the model as before.

INVARIANTS IN PLAY:
- NO new asset files (GLB/texture/HDRI); the media manifest and asset budget are untouched.
- Single WebGL context preserved; no second rAF loop; no per-frame allocations in animate.
- Default-off pedestal: every non-char-window consumer renders byte-identically.
- The char window painter and pure cores still never import CharacterPreview or three
  (existing source scans); Hud owns the enable.
- Do not touch renderer.ts entity diffing, src/sim, src/net, server, src/world_api*, the wire.
- No em/en dashes or emojis.

OUT OF SCOPE: armor meshes on the model (deferred feature; only the seam lands), pedestal in
other windows, lighting overhauls, any UI markup/CSS change.

STEP 3 - VALIDATION + REVIEW:
- npx tsc --noEmit
- npx vitest run tests/preview_appearance.test.ts tests/architecture.test.ts
- npx vitest run tests/char_window.test.ts tests/char_window_frame.test.ts (prove no UI drift)
- npm run ci:changed
- node scripts/char_equipment_shot.mjs (pedestal visible, framing unchanged vs the Phase 2 shot)
- Manual: skin picker + player card show no pedestal; weapon swap still updates the preview.
- qa-checklist agent (COVERAGE prompt). No sim/server/net reviewers (render-only diff).

STEP 4 - COMMIT CADENCE:
- feat(render): procedural pedestal for the character window preview
- feat(render): equipment-visual base seam on CharacterVisual and PreviewAppearance
- docs(char): mark phase 2b complete

STEP 5 - ACCEPTANCE CRITERIA:
- [ ] Pedestal under the character in the char window; character framing/size unchanged
- [ ] Pedestal absent in every other preview surface and in captureCloseup output
- [ ] PreviewAppearance.equippedItems + setEquipment landed; signature tests green; weapon-only
      rendering confirmed unchanged
- [ ] No new asset files; asset manifest diff empty
- [ ] Full validation list green

STEP 6 - DOC UPDATES: progress.md (Phase 2b), state.md (new render files, the seam API as landed).

STEP 7 - FINAL RESPONSE: status, files, validation, verdicts, handoff for Phase 2b QA.

STOPPING RULES:
- Stop and ask if the pedestal cannot be added without changing framing for other consumers.
- Stop and ask if the seam requires touching renderer.ts or the wire (it must not).
```

## QA Starter Prompt

```
This is Phase 2b QA of the Character Equipment Screen feature: verify pedestal + seam.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

STEP 0: git status clean. Read docs/char-equipment/state.md.
STEP 1: Explore agent: phase-02b file, progress.md, the Phase 2b diff, preview/visual/
preview_appearance as landed, all CharacterPreview consumers.
STEP 2 - AUDIT (parallel, COVERAGE):
Correctness agent: default-off proven at every consumer (enumerate call sites from a fresh
grep, not the phase notes); captureCloseup clean; disposal complete (no leaked geometry on
destroy); framing unchanged (compare Phase 2 vs 2b screenshots); setEquipment delegates
mainhand exactly like the old path; no renderer.ts / manifest / asset diffs.
Test-coverage agent: signature tests decisive (changed-item case present); no UI-suite drift;
alloc discipline in the animate path (read the diff for per-frame news).
STEP 3 - FIX all BLOCKING/SHOULD-FIX; rerun validation; commit fixes.
STEP 4: progress.md + state.md; commit.
STEP 5 - FINAL RESPONSE: verdict, counts, handoff for Phase 3.
```
