# Goblin Rocket Sled handoff

Status: implementation and focused build checks complete; full project QA gate intentionally deferred.

## Focused verification completed

- Final pre-handoff pass (2026-08-12): `npx vitest run tests/item_icons.test.ts tests/architecture.test.ts tests/mount_engine_state.test.ts tests/mount_visuals.test.ts tests/mounts.test.ts tests/profile_page.test.ts tests/reliquary_content.test.ts tests/sfx.test.ts tests/vfx.test.ts tests/goblin_rocket_sled_fx_core.test.ts` — 10 files, 362 tests passed.
- Final pre-handoff pass: `npx tsc --noEmit`, `node scripts/sfx_conform.mjs`, and `git diff --check` — all passed. Audio conformance reports only the repository's pre-existing advisory naming/loudness warnings; none involve the rocket-sled files.
- `npx vitest run tests/item_icons.test.ts tests/architecture.test.ts tests/mount_engine_state.test.ts tests/mount_visuals.test.ts tests/mounts.test.ts tests/profile_page.test.ts tests/reliquary_content.test.ts tests/sfx.test.ts tests/vfx.test.ts tests/goblin_rocket_sled_fx_core.test.ts` — 10 files, 356 tests passed.
- `npx tsc --noEmit` — passed.
- `node scripts/sfx_conform.mjs` — passed; only the repository's pre-existing advisory naming/loudness warnings remain.
- `git diff --check` — passed.
- Post-handoff jump feature: `npx vitest run tests/sfx.test.ts tests/mount_engine_state.test.ts tests/goblin_rocket_sled_fx_core.test.ts tests/vfx.test.ts tests/mount_visuals.test.ts tests/architecture.test.ts` — 6 files, 141 tests passed; TypeScript and `git diff --check` passed again.
- Jump attitude/standing-pressure follow-up: `npx vitest run tests/mount_visuals.test.ts tests/goblin_rocket_sled_fx_core.test.ts tests/vfx.test.ts tests/sfx.test.ts tests/architecture.test.ts` — 5 files, 131 tests passed; TypeScript and `git diff --check` passed again.
- Full gate — not run, by design.

## Reviewer entry points

- Live local preview: `http://localhost:5175/` (reuse the existing server; do not start another unless it is genuinely absent).
- Grant/mount: `/dev give reins_goblin_rocket_sled` or `/dev mounts`.
- Evergarden visual route: `/dev tp 320 810`.
- Accepted icon: `public/ui/items/reins_goblin_rocket_sled.webp`.
- Model design/evidence: this directory plus `scripts/assets/goblin_rocket_sled/`.

## Manual QA checklist

- Rider pelvis rests on the cushion; rider does not float or stand.
- Sled is stationary while parked and performs its subtle hover only while moving.
- Skis remain closed/watertight from front and rear views and do not z-fight.
- Side skull-and-crossbones decals follow the faceted rocket surface; black eyes remain visible.
- Idle exhaust is warm yellow; forward is orange and reverse is short blue-white with no detached gap.
- Forward flame mass spools for one second and hits full bore near the authored blowtorch transient.
- Forward and reverse start/loop/stop sets select correctly; authored loop seams do not fade.
- Rapid start/stop and forward/reverse changes retain the 40 ms transition crossfade without clicks.
- Dismount/remount leaves no exhaust particles, loops, or transition voices behind.
- Jumping suppresses only this mount's ordinary jump/land samples. An active directional sustain rises smoothly to 1.08x while airborne and returns to authored pitch on landing; start/stop takes never pitch.
- Takeoff produces a restrained hot spark kick; airborne jets lengthen, narrow, whiten at the core, and hunt gently against one another; touchdown produces one short broad compression cough.
- The sled and rider tip together around the vehicle origin: roughly 20–22 degrees nose-up after launch, about 12 degrees near apex, up to 4 degrees nose-down on descent, then a smooth flat landing recovery with no rider/cushion separation.
- A jump from complete rest uses only compact attached white-gold pressure cups, fast independent heat flicker, and restrained sparks—never the long forward or reverse cruising plumes. Landing gives one small orange pressure puff and returns to the warm idle nozzle glow.
- Jump during engine startup continues the unpitched startup and applies airborne pitch only if/when the sustain begins. Other mounts retain normal movement audio.
- Icon is readable in bags, tooltip, Reliquary, and action-slot/circular presentation.

## Required completion work

Read root and folder-local Markdown guidance before touching anything. Run the real project-selected gate (`node scripts/gate_select.mjs` or `npm run gate`) only after manual QA is accepted. Do not substitute a hand-picked test list for the final gate. Resolve every failure according to the owning folder guidance, then commit/push only when explicitly authorized.

## Known provenance note

The accepted icon master was supplied as `E:/goblin_rocket_sled_icon_v2.png`. Its exact generation prompt, model, and generation surface were not supplied, so `icon-provenance.json` records those fields honestly as unavailable instead of reconstructing them. Fill them from the original generation session if available; do not invent them.
