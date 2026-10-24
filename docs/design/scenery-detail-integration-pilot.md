# Scenery detail integration pilot, 14 October 2026

Historical failed pilot, retained as evidence. Current recovery and rollout work
is tracked in [Scenery distance rollout](scenery-distance-rollout.md).

Status at the end of this pilot: local opt-in. Wider rollout withheld after visual acceptance failed.
The five geometry profiles exist, but they are not approved defaults or a completed
whole-world graphics upgrade. No push, merge or deployment.

## Behavior and scope

`SceneryDetailSession` in `src/render/scenery_detail.ts` partitions static instances
by camera distance. Generated index buffers retain the exact material objects,
vertex attributes, UVs and normals. Source matrices, colors, occluder fades and
visibility remain authoritative. Approaching restores full detail by 60 yards;
outward hysteresis avoids boundary chatter. `scenery_detail_shadow.ts` restores
the original geometry/count for shadow draws. Existing sprite handoffs, lighting,
AO, texture settings, cel policy and horizon limits remain unchanged.

| Preset | 0-60 yd | 60-120 yd | 120-240 yd | 240-480 yd | Beyond 480 yd |
| --- | --- | --- | --- | --- | --- |
| Low | Full | Strong reduction | Very simple | Minimum | Minimum |
| Medium | Full | Fuller | Strong reduction | Very simple | Minimum |
| High | Full | Full | Fuller | Strong reduction | Very simple |
| Ultra | Full | Full | Light reduction | Fuller | Strong reduction |
| Insane | Full | Full | Full | Light reduction | Fuller |

The initial slice covers field trees/rocks planted in Thornpeak or Palmreach,
jungle features and Evergarden giant trees visible from these scenes. Other ordinary
zone scenery, towns, small clutter and unsupported meshes retain existing behavior.
Palm-only foliage batches receive the stronger regional reduction; mixed batches
keep the ordinary policy. Targets are error-bounded aspirations, not hard counts.
There are no new giant sprites. This preserves visibility rather than implementing
the earlier aggressive 60-yard cutoff, so that experiment's savings do not carry
over automatically. Cross-zone ordinary scenery still escapes this pilot's budget.

Preparation runs one source-model/level per background queue unit; shared source
indices are cached across batches. Full geometry stands in until ready. Teardown
restores sources and releases owned buffers. This is not offline asset LOD baking,
and first-use upload/simplification hitch parity remains unqualified.

Default `GFX.sceneryDetail` is false for every preset. To compare, reload with
`?gfx=low&cel=on&celbands=3&gfxo=sceneryDetail:0` versus the same URL with
`sceneryDetail:1`. Other presets accept the same flag.

## Measured Low results

FPS below is aggregate submitted frames divided by measured elapsed time. Compare
within a row only. Both arms use three-band cel; "stock" in raw filenames means
existing scenery, not the original unbanded lighting look.

| Device | Preset | Scene | Order | Existing FPS | Detail FPS |
| --- | --- | --- | --- | ---: | ---: |
| Mac | low | thornpeak | forward | 107.85 | 105.48 |
| Mac | low | beach | forward | 131.08 | 123.74 |
| Mac | low | thornpeak | reverse | 90.73 | 88.04 |
| Mac | low | beach | reverse | 84.97 | 81.80 |
| Redmi | low | thornpeak | forward | 22.29 | 23.80 |
| Redmi | low | beach | forward | 19.31 | 23.86 |
| Redmi | low | thornpeak | reverse | 22.40 | 23.60 |
| Redmi | low | beach | reverse | 19.28 | 23.90 |

Mac uses two simultaneous uncapped ANGLE Metal targets at 1600 by 900 and reversed
browser launch order. Redmi 12 5G uses the same owned Chrome page at 899 by 394 and
reversed setting order. Two ten-second windows per setting/scene, fixed noon,
fixed camera/buffer/quality, governor off, no active or pending preparation or new
programs in accepted samples. Uptime is recorded per run. The initial phone
preparation timeout has no accepted pair. Continuations preserve accepted rows;
the consecutive candidate arms reuse its prepared page. These are warm throughput
comparisons, not cold-entry or display-smoothness measurements.

Redmi Palmreach improves from 19.31 to 23.86 FPS forward and 19.28 to 23.90
reversed, clearly above the roughly 10% noise threshold in both orders. Thornpeak
changes from 22.29 to 23.80 and 22.40 to 23.60, within that threshold. No phone
60 FPS result is established. All 32 accepted windows pass the final evidence
audit; one phone timing block was excluded for preparation.

The Mac has no clear speed gain in either order. Added draws plausibly offset
geometry savings, but exclusive CPU/GPU attribution was not measured. In its
forward Palmreach sample, submitted geometry falls from 2,391,977 to 1,527,757
triangles while draw calls rise from 301 to 379. Thornpeak falls from 2,064,119 to
1,895,239 triangles while calls rise from 426 to 464. Do not treat triangle savings
as equivalent FPS savings or compare absolute FPS between runs.

## Visual decision and next work

The inspected Low images fail acceptance: distant Evergarden giant canopies lose
most foliage and expose bare branches, and some far Palmreach crowns become sparse
or fragmented. Nearby trees, ground and character materials remain recognizable;
unchanged material identity alone does not ensure an acceptable silhouette. Do not
ship this reduction policy. The Medium preparation run was stopped after this
failure, with no accepted timings; High, Ultra and Insane performance qualification
was not run. All five profiles have regression coverage, not device acceptance.

Next: preserve connected canopy silhouettes with suitable coarse representations,
reduce the draw-call growth, and remove cross-zone gaps in scenery budgeting before
repeating the two-scene acceptance gate. Keep the measured aggressive distance
study as a separate performance reference. Whole-world rollout, day/night and moving
handoffs, sustained combat, cold-entry parity and phone 60 FPS remain open.

## Matched screenshots

| Device / scene | Existing | Candidate |
| --- | --- | --- |
| mac / thornpeak | [Existing](../screenshots/scenery-detail-pilot/mac-low-thornpeak-stock.webp) | [Candidate](../screenshots/scenery-detail-pilot/mac-low-thornpeak-detail.webp) |
| mac / beach | [Existing](../screenshots/scenery-detail-pilot/mac-low-beach-stock.webp) | [Candidate](../screenshots/scenery-detail-pilot/mac-low-beach-detail.webp) |
| phone / thornpeak | [Existing](../screenshots/scenery-detail-pilot/phone-low-thornpeak-stock.webp) | [Candidate](../screenshots/scenery-detail-pilot/phone-low-thornpeak-detail.webp) |
| phone / beach | [Existing](../screenshots/scenery-detail-pilot/phone-low-beach-stock.webp) | [Candidate](../screenshots/scenery-detail-pilot/phone-low-beach-detail.webp) |

## Verification and evidence

- `npx vitest run tests/scenery_detail.test.ts tests/scenery_detail_shadow.test.ts tests/scenery_geometry_lod.test.ts tests/zone_feature_sweep.test.ts tests/gfx_override_core.test.ts tests/architecture.test.ts tests/monolith_budget.test.ts`: 176 pass, one pre-existing graphics-settings hash failure. The comparison against HEAD confirms all old settings are unchanged; its baseline produces the same mismatching hashes.
- `npx tsc --noEmit`: pass. Task-file Biome checks and `git diff --check`: pass, with existing non-null/style warnings.
- `node tmp/scenery-detail/build-v2.mjs`: minified build passes. Research-only offline entry and diagnostic helper, verified content-hashed media. Timings use explicit 0/1 overrides. The final build additionally disables the default and lazy-loads the simplifier only on opt-in; warm FPS was not rerun for this startup-only loading change. Candidate geometry is unchanged.
- `GATE_SELECT_BASE=8569e1f63d9 GATE_MAX_WORKERS=2 NODE_OPTIONS=--max-old-space-size=8192 node scripts/gate_select.mjs`: freshness/SFX/security pass; stops on the unchanged `tests/static_instance_cells.test.ts` callback-return lint error. Later stages unrun. Merge readiness is not established.
- The final lazy-loading change passes 19 targeted tests, TypeScript and its minified build; its manifest marks the simplifier as a dynamic entry. A real-browser smoke confirms no simplifier request/default session when disabled, and loaded/prepared indices on opt-in, without page errors.
- Scoped GPU/lifecycle review found no remaining implementation blocker. Visual acceptance remains failed.

Local report: `tmp/scenery-detail/report.html`. Raw evidence:
`mac-v2.json`, `phone-final.json`, the preserved phone attempts and stop records,
`build-v2-provenance.json`, source-settings comparison, screenshots and logs in the
same directory. The initial unpaired build-v1 pilot is not comparative evidence.
Phone wake ownership and its Mac sleep assertion remain active after testing.
