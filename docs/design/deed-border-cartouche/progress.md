# Deed Heraldry: progress

| Phase | Status | Notes |
|---|---|---|
| 1. Cartouche chassis | complete | Core + canvas rewire landed. extraLift is 14. Declutter Y is 32 / 34. |
| 2. QA: chassis | complete | Coverage map audited. Vacuous Object.keys pins replaced. E5/E7/E18/E22/E24 now have decisive assertions. Screenshots committed. Reviewers verified. `node scripts/gate_select.mjs` PASS (12 steps). |
| 3. Identity and family | complete | Motifs, Catalogue brass, picker swatches, inspect cartouche, ring clasp, E27-E36 tests. |
| 4. QA: cartouche identity | complete, visually superseded | Coverage map audited. Family screenshots under `phase-03/`. Reviewers READY WITH NOTES. `node scripts/gate_select.mjs` PASS (12 steps). Post-QA art review found the result too outline-led and reopened the feature. |
| 5. World Deed Heraldry | complete | One 18px forged seal + quiet name ribbon, secondary title line, one pure core, E37-E46 tests. No social-surface work. |
| 6. QA: world heraldry | complete: SHIP | Normal-distance and grayscale craft review passed. Live `phase-05/` album complete. E1-E46 audited, confirmed test gaps fixed forward, both reviewers READY, full 12-step gate green. |
| 7. Social reveal family | complete | Player/target name header, refined circle, inspect banner, picker seals + event previews. E47-E58 are mapped below. |
| 8. QA: full heraldry family | complete: READY WITH NOTES / SHIP WITH NOTES | E1-E58 audited. Final family album accepted. Focused suites, full selective gate, coverage, frontend, and gate-integrity reviews are green. |
| 9. v0.40 integration and plaque refinement | complete: SHIP WITH NOTES | Release v0.40 merged, E59-E63 audited, pointed plaque family accepted at world and interaction scales, final album complete, full 12-step gate green, both fresh reviewers READY. |
| Post-9. Five-pass craft polish | complete: SHIP WITH NOTES | Book alignment and protected plaque gap corrected; Inspect rebuilt as one ceremonial mantle; desktop, mobile, Parchment, forced colors, Unicode, all-badge, and borderless evidence accepted; both fresh reviewers READY. |
| Post-9. Second five-pass plaque convergence | complete: SHIP WITH NOTES | Shared forged material, scale-specific shoulders, keyed Inspect medallion and deed tab, picker cameo, final stress evidence, decisive coverage, and both fresh reviews accepted. |
| Post-9. Third five-pass final surface audit | complete: SHIP WITH NOTES | Complete live placement matrix accepted; tablet Inspect 3+1 honor rail fixed to 2x2; current v0.40 release merged; 42,006 core and 256 browser tests passed; all 12 gate steps and both fresh reviews are green. |

Contribution cleanup removed the eight completed per-phase execution prompts.
The durable art direction, implementation contract, QA ledger, and screenshot
albums remain in-tree; the prompt text remains available in git history.

Phase 4 closed technically on 2026-08-18. The same-day visual review returned
NEEDS ANOTHER PASS: the perimeter read as UI chrome, motifs vanished at normal
distance, inspect was a larger outline, the ring clasp resembled a checkbox,
and picker stripes did not communicate earned identity. The operator approved
the Deed Heraldry pivot in `art-direction.md`. Do not open the PR until Phase 8.

Phase 5 completed the world implementation on 2026-08-18. The old outline
cartouche core and test were intentionally replaced by one caller-owned heraldry
core. Phase 6, not Phase 5, owned live screenshot and normal-distance craft
acceptance; that audit is now recorded below.

Phase 6 completed on 2026-08-18 with a **SHIP** verdict. The live world token
passes at normal town distance before crop inspection, all four motifs remain
distinct in grayscale, and confirmed reviewer gaps were closed with test-only
fix-forward work.

Phase 7 completed implementation on 2026-08-18. The accepted seal, material,
and motif mapping now drives the player frame, valid player targets, inspect
banner, picker options, and event-driven world and interaction previews.

Phase 8 completed on 2026-08-18. The full Deed Heraldry family passed technical,
coverage, craft, responsive, accessibility, theme, tier-fairness, and live-flow
review. Final verdicts are **READY WITH NOTES** and **SHIP WITH NOTES**. The
notes are branch synchronization with the advanced release base and unrelated
headless mobile asset warnings; neither changes the accepted heraldry behavior.

Phase 9 completed on 2026-08-23 with a **SHIP WITH NOTES** verdict. The feature
is current with `origin/release/v0.40.0`, and the generated reference has been
translated into a convincing code-native pointed plaque without compromising
MMORPG readability, accessibility, graphics-tier fairness, or the world hot
path. The only notes are unrelated offline capture warnings and optional
platform-specific profiling listed below.

## Coverage map (filled by QA phases)

This table is a frozen Phase 4 history record, not current coverage. It
deliberately names cartouche tests and literals that Phase 5 retired. The
complete disposition ledger below is the current E1-E36 acceptance record and
maps every old pin to its retained invariant or E37-E46 replacement. Phase 8
re-audited all 36 dispositions against the release-base diff. E36 remains the
no-IWorld pin.

| Id | Historical test file / name | Phase 4 status only |
|---|---|---|
| E1 | `tests/nameplate_cartouche_core.test.ts` "hugs the name row with 9px x and 5px y pad and centers the name group" (`outer.w` 88, `outer.h` 26, `nameRowLeft` 285) | audited |
| E2 | `tests/nameplate_cartouche_core.test.ts` "keeps the title baseline 9px below the name row" (baseline 209 inside well); `tests/nameplate_canvas.test.ts` "E2: a worn border draws the title with the name, inside the well" (`text.draw` Y is `titleBaseline`, inside well) | audited |
| E3 | `tests/nameplate_cartouche_core.test.ts` "widens to the title and keeps the name group on screenX" (`outer.w` 118, name midpoint 320) | audited |
| E4 | `tests/nameplate_cartouche_core.test.ts` "centers the name baseline in the 24px row and keeps pad under the portrait" (pad under `nameRowTop + 24` is 5) | audited |
| E5 | `tests/nameplate_canvas.test.ts` "E5: a 15px holder badge stays inside the 16px row and does not kiss the well floor" (`outer.h` 26, clearance under 15 is 6); `tests/nameplate_ai_tag.test.ts` holder/dev badge `size` is 15 | audited |
| E6 | `tests/nameplate_cartouche_core.test.ts` "starts the name row after the top-left L-bracket arm" (`nameRowLeft` after arm, pad 9) | audited |
| E7 | `tests/nameplate_canvas.test.ts` "E7: AI and Cheater chips draw on the shared name baseline inside the well" (`[AI]` and `< Cheater >` Y === `nameBaseline`) | audited |
| E8 | `tests/nameplate_cartouche_core.test.ts` "does not clip a long measured name row" (`outer.w` 238) | audited |
| E9 | `tests/nameplate_canvas.test.ts` "E9: draws the dev-tier name outline after the well, never under it" (comment-stripped source order + well `fill` invocation before `devStyle` draw); `tests/nameplate_dev_glow.test.ts` outline-then-fill | audited |
| E10 | `tests/nameplate_cartouche_core.test.ts` "uses the 18px row height instead of a second layout" (`outer.h` 28) | audited |
| E11 | `tests/nameplate_canvas.test.ts` "E11: guild stays outside the plaque..." (`<The Testers>` Y > well bottom) | audited |
| E12 | `tests/nameplate_canvas.test.ts` "E12: HP, cast, combo, and raid-mark slots stay on their existing y-steps" (literal 10/7/9/31/47) plus raid-mark blit Y < clasp Y | audited |
| E13 | `tests/nameplate_canvas.test.ts` "E13: a dead player still draws the plaque when a border is worn" (well fill + 6 strokes, `hpVisible` false) | audited |
| E14 | `tests/nameplate_canvas.test.ts` "E14: stealth opacity applies to the plaque as well as the text" (0.55 and 0.55 * 0.4) | audited |
| E15 | `tests/nameplate_cartouche_core.test.ts` "returns an inactive record for an empty slug"; `tests/nameplate_canvas.test.ts` "E15: unknown and empty slugs draw no plaque"; `tests/nameplate_ai_tag.test.ts` title-deed `prog_veteran` -> `''` | audited |
| E16 | `tests/nameplate_canvas.test.ts` "uses system colors for actionable shapes and text in forced-colors mode" (no palette hex, no `#14110c`); `tests/deed_border_accent.test.ts` canvas forced-colors arm | audited |
| E17 | `tests/nameplate_cartouche_core.test.ts` "takes no dpr / uiScale field..." (comment-stripped source + input interface regex, extraLift 14); `tests/nameplate_canvas.test.ts` "E17: extraLift is applied in CSS pixels..." (no `cartoucheLift(state) *`, well Y identical at DPR 1 and 2) | audited |
| E18 | `tests/nameplate_ai_tag.test.ts` "E18: a hidden self plate with an emote never keeps a worn slug" (`border` `''`, emote url present) | audited |
| E19 | `tests/nameplate_canvas.test.ts` "E19: hostile name stays red inside the same slug metal..." (slug hexes on strokes, name `style.fill` is `#ff5555`) | audited |
| E20 | `tests/nameplate_ai_tag.test.ts` "resolves the border slug per entity..." (mob, NPC, and object planted with `col_reliquary_rank_5` still resolve `''`) | audited |
| E21 | `tests/nameplate_cartouche_core.test.ts` "leaves title geometry on the existing 11px / 9px step when inactive"; `tests/nameplate_canvas.test.ts` "E21: a borderless plate draws no well and no hardware" | audited |
| E22 | `tests/nameplate_canvas.test.ts` "E22: drawEmote and drawBase share extraLift..." (name Y and emote blit both move by 14; emote blit Y < clasp Y) | audited |
| E23 | `tests/nameplate_canvas.test.ts` "strokes the Book of Deeds accent as shapes, minting no new text sprite" (6 strokes, sprite count flat on every slug twice) | audited |
| E24 | `tests/nameplate_cartouche_core.test.ts` "bumps the same-row threshold and stack pitch by the extra lift" (32 / 34 literals); `tests/nameplate_declutter.test.ts` "E24: two plates 25px apart vertically now collide" (stack gap 34) | audited |
| E25 | `tests/nameplate_cartouche_core.test.ts` "takes no gfx, governor, or effects-profile argument"; `tests/deed_border_accent.test.ts` fairness path includes the core and forbids `--fx-shadow` / `gfxTier` / `data-fx-level` | audited |
| E26 | same fairness scan: identity strokes have no tier input; ring and inspect each have exactly one `--fx-shadow` `box-shadow`. Clasp has none. Low-preset screenshots show the well and hardware; high-preset ring shows bloom. | audited |
| E27 | `tests/deed_border_accent.test.ts` "E27: canvas metal is static; inspect and picker metal still read on parchment" (`PRESET_ORDER` classic/midnight/parchment/highContrast; theme emits no `--border-accent-*`; inspect and picker rules consume `var(--border-accent-*)` with no hex) | audited |
| E28 | `tests/deeds_border_picker.test.ts` "E28: picker None is empty, not a fake metal swatch"; "E28: the empty swatch rule paints no metal" (empty class, no style hex, `background: none`) | audited |
| E29 | `tests/deeds_border_picker.test.ts` "E29: earned options show the live 3-color swatch; active and 40x40 stay" (live palette vars, Deepward frame `#4fb3c8`, `.active`, `:focus-visible`, `body.mobile-touch .deed-title-option` 40x40) | audited |
| E30 | `tests/deed_border_accent.test.ts` "E30: inspect header is a CSS cartouche (well + edge + clasp) with forced-colors" (`--cartouche-pad-x:9px` / well `#14110c` / radius `6px`); `tests/inspect_window.test.ts` rendered style contains `--cartouche-well-fill:#14110c` and `--border-accent-frame:#f4ca43` | audited |
| E31 | `tests/deed_border_accent.test.ts` "E31: portrait ring stays a circle; clasp sits at 12 o clock under the level chip" (`::after` `border-radius: 50%`, clasp `left: 30px` / `top: -6px` / `transform: translate(-50%, -50%)` / `border-radius: 2px` / `z-index: 2`, chip 3, flash 4) | audited |
| E32 | `tests/nameplate_cartouche_core.test.ts` "dispatches four different motif kinds and four different line sets"; "would fail if two slugs emitted the same side-primitive set"; canvas E23 stroke count is 6 | audited |
| E33 | `tests/deed_border_accent.test.ts` "E33: Catalogue brass does not collide with Eternal Spoils gold or elite gold" (`#c9b17a` / `#2a2214` / `#f3ebcf` vs `#f4ca43` and `#f2c84b`); single-source color scan still green | audited |
| E34 | `tests/deed_border_accent.test.ts` "E34: cartouche identity adds no motion" (inspect, clasp, swatch, ring clasp have no animation/transition) | audited |
| E35 | `tests/deed_border_accent.test.ts` "E35: changing activeBorder busts the character sheet refresh signature" (`charSheetRefreshSig` moves on wear and on slug swap) | audited |
| E36 | `tests/deed_border_accent.test.ts` "E36: worn slug still arrives on entity.border with no world_api change"; `tests/nameplate_ai_tag.test.ts` `prog_prestige_10` -> `prestige_laurels`. The merge-base-to-worktree feature diff has no `src/world_api*`, `src/net/`, `server/`, or `src/sim/` files; the direct two-tree diff only exposes newer release-base work absent from this branch. | audited |

## Active coverage map (filled by Phases 5-8)

Build phases replace `unmapped` with named decisive tests. QA phases audit each
mapping and refuse a constant-self-comparison, source-presence-only assertion,
or a screenshot standing in for behavior coverage.

| Id | Owner | Test file / name | Status |
|---|---|---|---|
| E37 | Phase 5 | `tests/nameplate_heraldry_core.test.ts` "E37 world silhouette: one seal attached to one shallow name ribbon"; `tests/nameplate_canvas.test.ts` "E37/E40: pins the exact ribbon and $border seal path grammar for $name" across both row widths and all four slugs, plus the retired-perimeter assertion | audited |
| E38 | Phase 5 | `tests/nameplate_heraldry_core.test.ts` "E38 name and secondary title geometry"; `tests/nameplate_canvas.test.ts` "E38: the ribbon owns the name row and the equipped title stays outside" | audited |
| E39 | Phase 5 | `tests/nameplate_heraldry_core.test.ts` "E39 measured name-row variants stay centered and clear the seal"; `tests/nameplate_canvas.test.ts` "E39: Unicode, chips, and 15/24px badges stay centered and clear the seal" | audited |
| E40 | Phase 5 / 6 | Core four-identity suite; deed-accent static-owner suite; forced-color geometry fingerprints; exact Canvas path grammar for every slug; source pin requires exactly one canonical `borderMotifPrimitives(kind)` read and direct loop consumption | audited |
| E41 | Phase 5 | `tests/nameplate_canvas.test.ts` "E41: keeps guild below the health bar and outside the name ribbon" and "E41: pins every pair in the cast, HP, guild, quest, combo, raid, and emote y-walk" | audited |
| E42 | Phase 5 | Core inactive-state suite; canvas no-paint/title tests; `tests/nameplate_ai_tag.test.ts` "E42: empty, stale, removed, and title-reward ids clear the world heraldry slug" | audited |
| E43 | Phase 5 | Canvas death/stealth/reaction tests plus "E43: pairs ordinary 12px/16px/18px sizing against target 14px/18px/20px"; `tests/nameplate_ai_tag.test.ts` player-only and hidden-self tests | audited |
| E44 | Phase 5 | Core caller-owned/CSS-pixel suite; canvas shared-lift and DPR 1/2 tests | audited |
| E45 | Phase 5 | `tests/nameplate_declutter.test.ts` "E45: two heraldry plates 25px apart vertically clear at the accepted 28px pitch" and 95px left-seal boundary test | audited |
| E46 | Phase 5 / 6 | Runtime reference-stability probe; fail-closed TypeScript-AST call-graph scans for the core and canvas painter; planted allocation/helper escapes; flat sprite count; forced colors; expanded tier/GFX/preset/motion guards; architecture registry; monolith ratchet | audited |
| E47 | Phase 7 | `tests/unit_frame_painter.test.ts` "E47: writes one slug, palette, seal, and quiet header motif through elided writers" and "E47: clears every reveal slot for a borderless player"; `tests/deed_border_accent.test.ts` "E47/E48: only player and target documents expose the joint seal and header pattern hosts" | audited |
| E48 | Phase 7 | `tests/deed_border_accent.test.ts` "E48: only a player target may resolve a target-frame heraldry slug" and the player/target-only document-host test; `tests/unit_frame_painter.test.ts` "E48: an instance without the two optional heraldry hosts pays zero identity writes" | audited |
| E49 | Phase 7 | `tests/deed_border_accent.test.ts` "E49/E50: portraits stay circular, gameplay overlays win, and the hollow clasp is gone"; existing `tests/unit_frame.test.ts` full descriptor/title pass-through and `tests/unit_frame_painter.test.ts` elided HP/resource/absorb/title suites remain green | audited |
| E50 | Phase 7 | `tests/deed_border_accent.test.ts` "E49/E50: portraits stay circular, gameplay overlays win, and the hollow clasp is gone" pins no heraldry `::before`, circular ring, joint seal, and level/combat overlay order | audited |
| E51 | Phase 7 | `tests/inspect_view.test.ts` "E51: resolves a worn deed to its slug, motif, palette, and localized granting name"; `tests/inspect_window.test.ts` E51 canonical-style and rendered real-name/title/deed banner tests | audited |
| E52 | Phase 7 | `tests/inspect_window.test.ts` "E52: keeps the ceremonial banner compact beside the paperdoll stage"; `tests/deed_border_accent.test.ts` "E52/E53/E57: mobile stacks previews without hiding identity, and tiers scale bloom only" | audited |
| E53 | Phase 7 | `tests/deeds_border_picker.test.ts` E28 empty None plus "E53: earned options show the canonical seal and material; active and 40x40 stay"; mobile stack/tier test in `tests/deed_border_accent.test.ts` | audited |
| E54 | Phase 7 | `tests/deeds_border_picker.test.ts` "E54: hover and focus swap the live preview without equipping" and "E54: previewing None is genuinely empty and still does not unequip" | audited |
| E55 | Phase 7 | `tests/deed_border_accent.test.ts` "E55: every DOM seal derives from the canonical normalized primitives" suite, exact four path fingerprints, stable prebuilt paths, and one palette-owner scan | audited |
| E56 | Phase 7 / 8 | `tests/deed_border_accent.test.ts` "E56: canvas and social-surface metal stay independent of every theme" plus forced-color arms for unit, inspect, picker, and previews; live classic, parchment, and forced-color evidence is in `phase-07/` | audited |
| E57 | Phase 7 / 8 | `tests/deed_border_accent.test.ts` "E57: social heraldry adds no continuous motion" and the mobile/tier test, plus ring, seal, header, inspect, picker bloom-only and no-tier-selector pins; paired low/high evidence is in `phase-07/` | audited |
| E58 | Phase 7 / 8 | `tests/deed_border_accent.test.ts` "E58: worn slug still rides activeBorder/entity.border with one explicit picker command", existing character-sheet signature pin, and diff guard for sim/server/wire/IWorld paths; `live-qa-evidence.json` records reconnect restoration | audited |

## E1-E36 Phase 5 supersession ledger

This ledger is exhaustive. "Retained" means Phase 5 kept the behavior and its
test. "Superseded" means the old visual literal or cartouche-specific assertion
was intentionally removed and a named E37-E46 assertion now owns the invariant.
E29-E31 remain live only because Phase 7, not Phase 5, owns those social visuals.

| Id | Phase 4 pin disposition in Phase 5 |
|---|---|
| E1 | **Superseded by E37/E39.** Full plaque pad 9/5, radius 6, outer 88x26, and lift 14 became ribbon pad 7/1, radius 2, an 18px seal, and lift 8. Name content remains centered on `screenX`. |
| E2 | **Superseded by E38.** Title-inside-well geometry became the centered secondary line outside the ribbon. |
| E3 | **Superseded by E38.** Title width no longer widens world geometry; `NameplateHeraldryInput` has no `titleWidth`. |
| E4 | **Superseded by E39.** The 24px badge row no longer proves a 34px plaque or 5px floor; it proves a 26px ribbon with 1px vertical pad. |
| E5 | **Superseded by E39.** The 15px badge no longer proves old outer height 26 or 6px floor clearance; it stays centered in the 16px row and clear of the seal. |
| E6 | **Superseded by E39.** Top-left L-bracket arm clearance became an exact 4px gap between the seal edge and readable content. |
| E7 | **Superseded by E39.** AI and Cheater share the name baseline inside the ribbon, not the old well. |
| E8 | **Superseded by E39.** Old outer width 238 and 9px edge pad became measured content width plus 7px ribbon pad with the content midpoint still on `screenX`. |
| E9 | **Visual anchor superseded; ordering retained.** The ribbon fill, rather than the old well, must paint before the dev outline and readable name. |
| E10 | **Superseded by E43.** The current-target pin now proves an 18px row, 20px ribbon, and 14px name font instead of old outer height 28. |
| E11 | **Bounds superseded; ordering retained by E41.** Guild text stays below HP and outside the ribbon. |
| E12 | **Clasp-specific pin superseded by E41.** Cast/HP/quest/combo/raid/emote remain outside the token; steps 10/7/26/9/31/47 remain exact. |
| E13 | **Superseded by E43.** A dead wearer keeps the seal/ribbon token without relying on a six-stroke plaque count. |
| E14 | **Superseded by E43.** Stealth keeps 0.55 plate opacity; the ribbon product changed from `0.55 * 0.4` to `0.55 * 0.48`. |
| E15 | **Superseded by E42.** Empty/unknown state zeros ribbon, seal, joint, rivets, and motif transform rather than outer/brackets/clasp fields. |
| E16 | **Superseded by E46.** Forced colors map the new seal/ribbon to `Canvas`/`CanvasText`, with four geometry fingerprints retained without palette color. |
| E17 | **Superseded by E44.** `extraLift` changed from 14 to 8; CSS-pixel and DPR-independent behavior remains. |
| E18 | **Retained under E43.** Hidden self plus emote clears the worn slug and leaks no world identity. |
| E19 | **Old plaque wording/strokes superseded; reaction invariant retained by E43.** Hostile name stays red while slug metal is unchanged; friendly color also remains. |
| E20 | **Retained under E42/E43.** Mobs, NPCs, and objects never receive player heraldry. |
| E21 | **Old well/hardware fields superseded by E42.** Borderless paints no seal/ribbon and keeps the ordinary secondary-title path. |
| E22 | **Superseded by E44.** Base/emote shift changed from 14px and clasp clearance to one exact 8px lift with seal/ribbon clearance. |
| E23 | **Superseded by E46.** Exact six-stroke cartouche became code-native seal/ribbon shapes, four expected seal/rivet arcs, static motifs, and flat sprite count across slug flips. |
| E24 | **Superseded by E45.** X/Y/stack measurements are now 95/26/28 instead of 80/32/34. |
| E25 | **Visual description superseded; fairness retained by E46.** Seal, ribbon, motif, and structural edge have no profile, tier, or governor input. |
| E26 | **World visual description superseded; fairness retained by E46.** Identity remains complete at every preset; only the pre-existing social bloom may scale. |
| E27 | **Retained.** World material remains theme-independent; social parchment checks are unchanged. |
| E28 | **Retained.** Picker None remains empty. |
| E29 | **Not changed in Phase 5; deferred to Phase 7.** The current three-color picker swatch, active/focus semantics, and 40x40 touch floor remain enforced. |
| E30 | **Not changed in Phase 5; deferred to Phase 7.** Inspect keeps its current 9/5/6/0.4 cartouche chrome and forced-color behavior. |
| E31 | **Not changed in Phase 5; deferred to Phase 7.** Circular ring, old clasp, level chip, and combat-flash ordering remain enforced. |
| E32 | **Superseded by E40.** Tiny cartouche-coordinate side motifs became four deeply frozen, normalized, grayscale-distinct seal-face primitive sets. |
| E33 | **Retained.** Catalogue brass remains `#c9b17a`/`#2a2214`/`#f3ebcf`, distinct from Eternal Spoils and elite gold. |
| E34 | **Core path superseded; motion invariant retained by E46.** The world source is now `nameplate_heraldry_core.ts`; no animation or clock input was added. |
| E35 | **Retained.** `activeBorder` still invalidates the character-sheet refresh signature. |
| E36 | **Retained.** The deed slug still reaches `entity.border`; Phase 5 changes no sim, server, persistence, wire, or IWorld surface. |

## Art-direction pivot

- Approved reference:
  `docs/screenshots/deed-border-cartouche/direction/deed-heraldry-concept.png`.
- World recognition token: readable forged seal plus shallow midnight ribbon
  behind the name row only. Title returns outside.
- Interaction reveal: same seal/material on player and target name headers;
  circular portrait remains; gameplay bars remain standard.
- Inspect is the ceremonial reveal. Picker shows the actual seal/material and a
  live preview instead of stripes.
- Four slugs/motifs only. Catalogue brass remains distinct. Borderless stays
  clean. Identity exists on every tier. Runtime remains code-native and
  allocation-free on the world path.

## Phase 5 notes

- Tests were written first. The first full Phase 5 run was red as intended: 15
  failing assertions plus 2 import-failed suites because the new core/API did
  not exist, the old core still existed, and declutter still reported 80/32/34.
- World geometry is now owned only by
  `src/render/nameplate_heraldry_core.ts`. Normal 70x16 input at `(320, 200)`
  yields ribbon `{ x:278, y:183, w:84, h:18 }`, seal
  `{ x:263, y:183, size:18 }`, exact 3px seal/ribbon overlap, a 4px seal/content
  gap, title center 320, and title baseline 209 outside the ribbon.
- Accepted literals: ribbon pad 7/1, radius 2, well `#14110c` at 0.48, seal 18,
  overlap 3, extra lift 8, title step/baseline 11/9, and name baseline offset 5.
  Declutter is X/Y/stack 95/26/28.
- Catalogue, vault, ward, and laurel normalized primitives have one deeply
  frozen owner in `deed_border_view.ts`. The hot writer transforms them directly
  and creates no sprite, raster, gradient, filter, transformed array, closure,
  tier branch, or governor branch.
- `nameplate_canvas.ts` is 842 lines under its new 852-line ratchet. The old
  `nameplate_cartouche_core.ts` and paired test are deleted. Phase 7's
  `CARTOUCHE_CHROME_*` 9/5/6/0.4 values remain unchanged.
- Focused Phase 5 suite: 7 files, 196/196 tests passed. `npx tsc --noEmit`
  passed. `npm run ci:changed` passed with 12 pre-existing warnings; the scoped
  13-file Biome check passed with 5 pre-existing environment-variable warnings.
- The first clean full gate exposed one test-harness assumption: the screenshot
  reference scan tried to read the intentionally deleted, still-unstaged old
  core reported by `git ls-files`. The scan now excludes paths absent from the
  worktree while retaining its 6,000-file vacuity floor; its focused suite is
  25/25. The final `npm run gate` passed all 12 steps with 8 Vitest workers.
- `node scripts/gate_select.mjs` passed all 12 steps with 8 Vitest workers. Its
  selected Vitest portion passed 883 files / 15,980 tests, with 8 files / 80
  tests skipped.
- Fresh `woc_test_coverage` and `woc_frontend` reviews were READY with no
  actionable Phase 5 findings. At that handoff, Phase 6 still owned
  normal-distance hierarchy, four-motif grayscale distinction, and crowded
  live-image evidence; those checks are now closed below.
- No sim, server, persistence, wire, or IWorld file changed. No runtime image,
  slug, deed, title, lore, motif kind, or player-facing string was added.

## Phase 6 notes: SHIP

- Independent QA ran on 2026-08-18 in the requested worktree and branch,
  against `origin/release/v0.39.0`. `git status --short --branch` was the first
  command. The complete Phase 5 diff, every changed test, all E37-E46 mappings,
  the exhaustive E1-E36 supersession ledger, and the Phase 1/3 screenshot
  albums were reviewed. No sim, server, persistence, wire, or IWorld path is in
  the Phase 5 diff.
- Live capture used the booted client on `127.0.0.1:5187` with
  `npm run dev -- --host 127.0.0.1 --port 5187`, then temporary ignored harnesses
  `node tmp/phase6_distance_capture.mjs` and
  `node tmp/phase6_stress_capture.mjs`. The harnesses were removed after capture.
  Earned deed ids were seeded, then each reward was equipped through
  `sim.setActiveBorder`, the real Book of Deeds eligibility/equip validator; no
  arbitrary world-border slug was injected. The normal-distance read was judged
  and passed before any close crop was accepted.
- Normal-distance low-tier evidence:
  `docs/screenshots/deed-border-cartouche/phase-05/normal-curators_gilt-town-low.png`,
  `normal-reliquary_gilt-town-low.png`, `normal-deepward-town-low.png`,
  `normal-prestige_laurels-town-low.png`, and
  `normal-all-four-town-low.png`. Catalogue-vs-Eternal-Spoils evidence is
  `normal-catalogue-beside-eternal-spoils-low.png`.
- Only after that gate passed, the four seal crops were accepted:
  `docs/screenshots/deed-border-cartouche/phase-05/seal-crop-curators_gilt.png`,
  `seal-crop-reliquary_gilt.png`, `seal-crop-deepward.png`, and
  `seal-crop-prestige_laurels.png`. The deterministic grayscale comparison is
  `grayscale-four-seals.png` in Catalogue / Vault / Ward / Laurel order.
- Stress and control evidence in the same folder:
  `current-target-sized-nameplate-low.png`, `title-and-guild-low.png`,
  `no-title-low.png`, `long-unicode-name-low.png`,
  `all-badges-title-guild-bars-emote-low.png`, `borderless-control-low.png`,
  `two-nearby-bordered-after-declutter-low.png`,
  `graphics-comparison-low.png`, `graphics-comparison-high.png`,
  `graphics-comparison-low-vs-high.png`, and `forced-colors-active.png`.
  Forced colors was an actual Chrome DevTools `forced-colors: active` emulation
  (`matchMedia('(forced-colors: active)').matches === true`), not a mocked unit
  state.
- Craft verdict: the name reads first, the 18px seal second, and metal third.
  Catalogue page bars, Vault diamond/bar, Ward key, and Laurel fan remain
  distinct without color. The 7/1 ribbon stays quiet and shallow. Title, guild,
  HP/cast bars, markers, badges, and emotes remain outside and retain their
  existing layout. Borderless is clean; the 95/26/28 declutter literals keep two
  nearby bordered players clear. Low and high preserve the same identity, and
  the result reads as earned heraldry in a crowded town. No image generation was
  used for QA evidence.
- Fresh read-only `woc_frontend` review initially found one evidence-only blocker:
  the mail banner covered the high-tier `TIERPARITY` plate. The high leg and
  combined comparison were recaptured after dismissing the banner. Re-review
  returned **READY** and found the implementation/craft surface green, including
  forced colors, borderless, hierarchy, crowding, and the allocation/sprite/tier
  seams.
- Fresh read-only `woc_test_coverage` review initially returned NOT READY on two
  confirmed Phase 5 test gaps: bounded source-token lists could miss
  `Object.values` / `Object.entries` / `JSON.parse` / `.concat` or a newly called
  allocating helper, and the tests did not fully pin one canonical motif owner
  across all four exact Canvas grammars. Phase 6 fixed forward in tests only:
  `tests/helpers/hot_path_allocations.ts` now uses the TypeScript AST to walk
  reachable functions/methods, reject allocation syntax/APIs, and fail unknown
  bare, `this`, or property helper calls outside a narrow safe Canvas/Math/Object
  allowlist. Planted escape cases prove the scanner. Core and painter call graphs,
  exactly one `borderMotifPrimitives(kind)` lookup, direct primitive consumption,
  all four exact path grammars, and `GFX` / `gfxTier` / `fxTier` /
  `graphicsPreset` / `.animate()` fairness spellings are pinned. Re-review
  returned **READY** with high confidence and no remaining blocking coverage gap.
- Exact post-fix checks:
  - `npx tsc --noEmit`: PASS. Its first run after adding the helper caught one
    optional-body narrowing error in the test helper; an explicit body guard was
    added and the final run passed.
  - `npx vitest run tests/nameplate_heraldry_core.test.ts tests/nameplate_canvas.test.ts tests/deed_border_accent.test.ts`
    passed 3 files and 95/95 tests.
  - `npx vitest run tests/nameplate_heraldry_core.test.ts tests/nameplate_canvas.test.ts tests/nameplate_ai_tag.test.ts tests/nameplate_declutter.test.ts tests/deed_border_accent.test.ts tests/architecture.test.ts tests/monolith_budget.test.ts`
    passed 7 files and 203/203 tests.
  - `npx @biomejs/biome check --write scripts/pr_shot_targets.mjs src/render/nameplate_canvas.ts src/render/nameplate_declutter.ts src/render/nameplate_heraldry_core.ts src/styles/hud.css src/ui/deed_border_view.ts tests/helpers/hot_path_allocations.ts tests/architecture.test.ts tests/ci_workflow.test.ts tests/deed_border_accent.test.ts tests/monolith_budget.test.ts tests/nameplate_ai_tag.test.ts tests/nameplate_canvas.test.ts tests/nameplate_declutter.test.ts tests/nameplate_heraldry_core.test.ts`
    passed over 15 files, no fixes, five pre-existing screenshot-script env-var
    warnings.
  - `npm run i18n:gen`: PASS; UI/admin generated catalogs rewrote 0/26 files and
    pending remained 0.
  - `npx vitest run tests/architecture.test.ts tests/localization_fixes.test.ts tests/monolith_budget.test.ts tests/ci_workflow.test.ts`
    passed 4 files and 124 tests, with 3 expected skips.
  - `npm run ci:changed`: PASS over 20 selected files, no fixes, 12 pre-existing
    warnings.
  - `npm run gate`: PASS, all 12 steps green with 8 Vitest workers before the
    test-only reviewer fix-forward.
  - Initial `node scripts/gate_select.mjs`: PASS, all 12 steps; selected Vitest
    passed 883 files / 15,980 tests with 8 files / 80 tests skipped, plus 20
    browser files / 131 tests.
  - Final `node scripts/gate_select.mjs` after the fix-forward: PASS, all 12
    steps. The new unclassified helper correctly forced conservative full-suite
    mode: 2,853 files passed / 12 skipped; 39,534 tests passed / 2 expected fail /
    115 skipped; browser 20 files / 131 tests. Type/build/artifact steps passed;
    malware gate passed 6,275 files / 373 prior flags / 0 high.
  - `git diff --check`: PASS before and after QA changes.
- Remaining non-blocking risk: the allocation guard is fail-closed static AST
  analysis plus runtime reference-stability probing, not a heap profiler. Live
  screenshots use headless SwiftShader and seeded offline players rather than a
  production network crowd, though they exercise the real booted client,
  renderer, validator, declutter, preset, and forced-color paths. The optional
  world debug payload did not echo the active graphics preset, so the tier proof
  combines the seeded low/high setting, paired unobstructed live renders, and
  decisive no-tier-branch tests rather than a screenshot telemetry label.
- Final Phase 6 verdict: **SHIP**. Phase 7 may be started in a new session only;
  it was not implemented or begun here.

## Phase 7 notes

- Tests were written first for each surface. The initial focused runs failed on
  missing unit-frame reveal hosts and writes, absent inspect banner data, the
  old picker stripe structure, missing previews, and the retired clasp rules.
  Implementation followed those failures rather than weakening the assertions.
- `src/ui/deed_border_view.ts` remains the one family owner. It now derives one
  cached SVG path per existing normalized motif, stores that path with the
  palette record, and exports one attribute/style-token convention for every
  DOM surface. No second color, coordinate, slug, or silhouette table landed.
- The existing `UnitFramePainter` gained optional heraldry hosts. Player and
  target instances write the slug, motif path, well, and palette through the
  existing elided writers. Other instances omit the hosts and pay zero identity
  writes. `deedTargetBorderSlug` fails closed for every non-player target.
- `index.html` and `play.html` now give only player and target frames a joint
  seal plus name-header pattern host. The portrait remains circular, the hollow
  top clasp is removed, and the existing level and combat overlays remain above
  the structural ring. The name, title, sanction, reaction color, bars, absorb,
  cast, and debuff paths were not changed.
- Inspect resolves the real localized granting-deed name in
  `inspect_view.ts`. The painter renders a compact name/title/deed banner from
  the same seal, material, and motif. Borderless and remote cards keep their
  prior plain presentation.
- Earned Book options now show the canonical seal and a patterned material
  sample. None remains empty. Hover and focus repaint representative world and
  interaction previews only on those events. The sole
  `setActiveBorder` call remains inside the existing click action.
- `docs/design/deeds.md`, `docs/design/reliquary.md`, and
  `docs/design/graphics-settings-fairness.md` now describe the implemented
  family. `scripts/pr_shot_targets.mjs` has Phase 8 recipes for unit frames,
  inspect, picker preview, mobile, parchment, and low/high comparison. No Phase
  8 screenshot was captured or committed.
- Exact Phase 7 checks:
  - `npx tsc --noEmit` passed.
  - `npx vitest run tests/deed_border_accent.test.ts tests/nameplate_heraldry_core.test.ts tests/nameplate_canvas.test.ts tests/deeds_border_picker.test.ts tests/inspect_window.test.ts tests/inspect_view.test.ts tests/unit_frame_painter.test.ts tests/unit_frame.test.ts tests/localization_fixes.test.ts tests/i18n_completeness.test.ts tests/architecture.test.ts tests/monolith_budget.test.ts`
    passed 12 files, 340 tests, with 3 expected skips.
  - `npx vitest run tests/nameplate_ai_tag.test.ts tests/nameplate_declutter.test.ts tests/cheater_tag.test.ts tests/hud_update_drive.test.ts tests/deeds_view.test.ts tests/pr_shot_targets.test.ts`
    passed 6 files and 171 tests.
  - `npx @biomejs/biome check --write index.html play.html scripts/pr_shot_targets.mjs src/render/nameplate_canvas.ts src/render/nameplate_declutter.ts src/render/nameplate_heraldry_core.ts src/styles/components.css src/styles/hud.css src/styles/shell.css src/ui/deed_border_view.ts src/ui/deeds_window.ts src/ui/hud.ts src/ui/inspect_view.ts src/ui/inspect_window.ts src/ui/unit_frame_painter.ts tests/helpers/hot_path_allocations.ts tests/architecture.test.ts tests/ci_workflow.test.ts tests/deed_border_accent.test.ts tests/deeds_border_picker.test.ts tests/inspect_view.test.ts tests/inspect_window.test.ts tests/monolith_budget.test.ts tests/nameplate_ai_tag.test.ts tests/nameplate_canvas.test.ts tests/nameplate_declutter.test.ts tests/nameplate_dev_glow.test.ts tests/nameplate_heraldry_core.test.ts tests/unit_frame_painter.test.ts`
    passed over 29 files with no fixes on the final run and 8 pre-existing
    warnings.
  - `npm run ci:changed` passed over 20 selected files with 8 pre-existing
    warnings.
  - `git diff --check` passed. The release-base diff contains no `src/sim/`,
    `server/`, `src/net/`, `src/world_api.ts`, or `src/world_api/` path.
- Remaining risk belongs to Phase 8: the new social surfaces have not received
  live normal-distance family review, real-browser focus/hover inspection,
  final mobile/parchment/forced-colors captures, or the low/high bloom
  comparison. No selective gate or specialist QA review was run here because
  those are explicitly Phase 8 work.

## Phase 8 notes: READY WITH NOTES / SHIP WITH NOTES

- QA ran on 2026-08-18 in the requested worktree and branch against
  `origin/release/v0.39.0`. `git status --short --branch` was the first command.
  The complete working-tree diff, Phase 1, Phase 3, and accepted Phase 5 albums,
  both active coverage maps, and every E1-E58 disposition were reviewed before
  visual judgment.
- The normal-distance world gate passed before close craft. Evidence starts
  with `phase-07/12-all-four-world-normal-low.png`, followed by
  `13-all-four-world-tight-low.png`. Name remains first, seal second, and metal
  third. Catalogue, Vault, Ward, and Laurel stay distinct without relying on
  color. The world token remains the accepted Phase 5 seal and quiet ribbon.
- The final album is
  `docs/screenshots/deed-border-cartouche/phase-07/`. Its canonical surface
  frames are 01 through 11. Frames 12 through 13 cover world distance and
  close craft. Frames 14 through 17 are corrected real Book equip flows for all
  four rewards. Frames 18 through 21 are no-equip focus previews. Frames 22
  through 29 cover peer inspect, reconnect, borderless controls, forced colors,
  and the long German title plus Cheater target.
- Real-flow evidence is recorded in `phase-07/live-qa-evidence.json`. All four
  earned options were clicked through the Book of Deeds, each became active,
  and each drove its matching preview. The same session separately proved
  focus preview without equip, None unequip, owner and observer restoration
  after character serialization/re-entry, a bordered peer inspect, forced
  colors, and a localized long-title sanction line.
- Low/high evidence is `02-deed-heraldry-unit-frames-desktop-low.png` and
  `03-deed-heraldry-unit-frames-desktop-high.png`. The capture recipe now marks
  the preset as explicit, asserts preset 1/3, `data-fx-level` low/high, and
  `--fx-shadow` 0/1, freezes both desktop scenes through the real dev-only
  `/daynight day` input path, and removes any stray options overlay. Tests pin
  that structural identity never reads the tier; only `box-shadow` bloom reads
  `--fx-shadow`.
- Parchment evidence is `08-deed-border-picker-parchment.png` and
  `11-inspect-border-cartouche-parchment.png`. Confirmed low-contrast copy was
  fixed to use the dark-surface overlay token. The E56 test binds every tested
  background to the production well constant and actual CSS gradient/mix
  values, then enforces 4.5 contrast for option, preview name/deed, inspect
  title, and granting-deed copy. Inspect frames 09 through 11 now also exercise
  the existing long Armorcrafting title.
- Forced colors is real Chromium emulation:
  `matchMedia('(forced-colors: active)').matches` was true and frame 27 records
  player, target, and picker slugs as `deepward`. None remains empty. Identity
  edges use `CanvasText`; no gameplay data is hidden.
- Focused commands and outcomes:
  - `npx vitest run tests/nameplate_heraldry_core.test.ts tests/nameplate_canvas.test.ts tests/nameplate_ai_tag.test.ts tests/nameplate_declutter.test.ts tests/deed_border_accent.test.ts tests/architecture.test.ts tests/monolith_budget.test.ts`
    passed 7 files and 207 tests.
  - `npx vitest run tests/deed_border_accent.test.ts tests/nameplate_heraldry_core.test.ts tests/nameplate_canvas.test.ts tests/deeds_border_picker.test.ts tests/inspect_window.test.ts tests/inspect_view.test.ts tests/unit_frame_painter.test.ts tests/unit_frame.test.ts tests/localization_fixes.test.ts tests/i18n_completeness.test.ts tests/architecture.test.ts tests/monolith_budget.test.ts`
    passed 12 files and 341 tests, with 3 expected skips.
  - `npx vitest run tests/mobile_window_coverage.test.ts tests/mobile_window_layout.test.ts tests/mobile_window_transform.test.ts tests/i18n_completeness.test.ts tests/localization_fixes.test.ts tests/styles_extraction.test.ts tests/css_value_validity.test.ts tests/focus_visible_guard.test.ts tests/theme.test.ts tests/ui_effects_profile.test.ts tests/ui_effects_wiring.test.ts`
    passed 11 files and 216 tests, with 1 expected skip.
  - The final fix-forward run,
    `npx vitest run tests/deed_border_accent.test.ts tests/deeds_border_picker.test.ts tests/inspect_window.test.ts tests/pr_shot_targets.test.ts tests/ci_workflow.test.ts`,
    passed 5 files and 145 tests.
  - `npx vitest run tests/deed_border_accent.test.ts tests/pr_shot_targets.test.ts`
    passed 2 files and 74 tests after the final source-linked E56 pin.
  - `npx tsc --noEmit` and `git diff --check` passed.
  - `GATE_SELECT_BASE=origin/release/v0.39.0 node scripts/gate_select.mjs`
    passed all 12 selected steps on the final tree.
  - Changed-file Biome checks passed with the same eight pre-existing warnings:
    five screenshot-script environment warnings and three template-placeholder
    test warnings.
- Canonical capture command:
  `GAME_URL=http://127.0.0.1:5173 DIFF_FILE=/tmp/phase8-heraldry.diff SHOTS_DIR=docs/screenshots/deed-border-cartouche/phase-07 NAV_TIMEOUT_MS=180000 ENTRY_SELECTOR_TIMEOUT_MS=180000 node scripts/pr_screenshots.mjs`.
  Targeted ignored harnesses recaptured the high/mobile tier frames, corrected
  all four Book equip frames, and refreshed the final picker/inspect
  Parchment views. Those temporary harnesses were removed after capture.
- Confirmed review findings and fixes:
  - Coverage review found missing host nesting, target mirror, all-four motif,
    inspect cleanliness/motif/compactness, motion/bloom, and screenshot-recipe
    pins. Each was fixed forward in the owning test.
  - Frontend review found preview-label collision, wide touch stacking,
    forced-color edge loss, leaked theme state, Parchment dark-surface copy,
    and an undecidable tier pair. CSS, recipe seeds/assertions, and live frames
    were corrected without changing the approved design.
  - Gate-integrity review found that the screenshot-reference guard could
    silently omit missing paths, then that its first fix would fail a real
    sparse checkout. The final guard builds non-screenshot corpus candidates
    first, derives legitimate local unstaged deletions from Git, rejects every
    other absence, and retains the vacuity floor and cone set equality.
- Final fresh specialist results:
  - `woc_test_coverage`: **READY**. E1-E36 and E37-E58 are complete; no
    actionable coverage finding remains.
  - `woc_frontend`: **READY WITH NOTES / SHIP WITH NOTES**. No actionable
    craft, accessibility, responsive, hierarchy, fairness, or architecture
    defect remains.
  - `gate-integrity-reviewer`: **READY**. Both sparse-corpus findings are
    resolved and the workflow pin is 25/25.
- Architecture stayed in scope. The merge-base-to-worktree feature diff has no
  `src/sim/`, `server/`, `src/net/`, `src/world_api.ts`, or `src/world_api/`
  path. A direct two-tree diff exposes newer release-base changes absent from
  this branch; those are not Deed Heraldry changes. No deed, slug, motif,
  silhouette, lore, reward, gameplay power, generated runtime art, player copy,
  persistence, wire, net, or IWorld behavior was added.
- Remaining notes:
  - The branch is 12 commits ahead and 9 behind the now-advanced release base.
    Integrate the current release branch and rerun the gate before merge.
  - Three mobile captures logged 18 skipped unrelated NPC assets. None overlaps
    a reviewed player, target, picker, or inspect surface. The album manifest
    records them explicitly.
  - Browser axe, a dedicated mobile E2E pass, and ARM3 wall-clock profiling were
    not separately rerun. The canonical browser suite, architecture/performance
    pins, headless mobile captures, and deterministic hot-path guards passed.
- Final Phase 8 verdict: **READY WITH NOTES** technically and **SHIP WITH
  NOTES** visually. Both permit shipping, so Phase 8 is complete. No commit,
  stage, push, or PR action was performed.

## Phase 9 notes: v0.40 integration and plaque refinement

- The first command was `git status --short --branch`; the worktree was clean
  before release integration. `git merge --no-edit origin/release/v0.40.0`
  completed without conflict as merge commit `2e15170f9c`, with release parent
  `14ab2e8630`. `git rev-list --left-right --count
  origin/release/v0.40.0...HEAD` returned `0 17`.
- `pnpm install --frozen-lockfile` passed. The immediate post-merge baseline
  passed `npm run i18n:gen`, a 16-file / 459-test focused suite,
  `npx tsc --noEmit`, and `git diff --check`; generated i18n files were not
  rewritten.
- The generated direction remains reference-only. The accepted implementation
  now reads as a shared pointed plaque family: a compact world form, a mirrored
  target form, a full name-header interaction form, and a larger ceremonial
  inspect form. No new imagegen output or runtime image was needed.
- E59-E63 coverage:
  - E59: `tests/deed_heraldry_plaque_core.test.ts` pins frozen compact, mirror,
    and ceremonial clip paths to one fixed 8px tip / 4px notch authority and
    binds the world core to the same measurements.
  - E60: `tests/nameplate_heraldry_core.test.ts` pins accepted world geometry;
    `tests/nameplate_canvas.test.ts` pins the exact six-point Canvas2D path,
    inset glint order, seal joint, motif primitives, and absence of the old
    rounded perimeter.
  - E61: `tests/deed_heraldry_plaque_core.test.ts` pins player/target host
    nesting, mirror direction, full bar-column width, and centered name.
    Existing E47-E50 unit painter and semantic tests remain green.
  - E62: the same family test pins picker and inspect hosts, sprite-free static
    CSS, and all three silhouettes. Existing E51-E57 contrast, responsive,
    forced-colors, and tier tests remain green.
  - E63: `tests/pr_shot_targets.test.ts` pins crash-probe removal on all four
    isolated browser boot paths before variant storage seeds.
- Confirmed fix-forward work:
  - The world rounded ribbon was replaced with a hand-built shallow six-point
    plaque. The core remains pure and caller-owned; the painter uses no runtime
    image, gradient, filter, animation, tier/governor input, or per-call
    container syntax. One static inset line supplies the worked-metal glint.
  - Player and target plaques now span their existing name-header columns,
    center the identity line, and mirror correctly. Portraits, level, title,
    sanction, health, resource, absorb, cast, auras, and target-of-target remain
    outside and unchanged.
  - Inspect widened its ceremonial plaque from 420px to 450px and the seal from
    34px to 40px while staying below 15 percent of the 400px paperdoll stage.
  - The world well alpha moved from 0.48 to 0.62 so the plaque reads against a
    crowded town without allowing metal or pattern to outrank the name.
  - The first canonical mobile tier capture failed because v0.40's
    `woc_entry_probe` correctly interpreted the previous harness-owned
    `page.close()` as a killed world, then stepped the next seeded preset down.
    `scripts/pr_screenshots.mjs` now clears only that intentional close probe on
    every isolated page before `beforeLoad`. The rerun captured all four
    variants with the asserted preset 1/3 and low/high states.
- Deterministic commands and outcomes:
  - `npx vitest run tests/pr_shot_targets.test.ts
    tests/deed_heraldry_plaque_core.test.ts
    tests/nameplate_heraldry_core.test.ts tests/nameplate_canvas.test.ts
    tests/deed_border_accent.test.ts tests/deeds_border_picker.test.ts
    tests/deeds_window.test.ts tests/inspect_window.test.ts
    tests/inspect_view.test.ts tests/unit_frame_painter.test.ts
    tests/unit_frame.test.ts tests/architecture.test.ts
    tests/monolith_budget.test.ts` passed 13 files and 385 tests after reducing
    `nameplate_canvas.ts` back to its 852-line ceiling.
  - `npx tsc --noEmit` and `git diff --check` passed.
  - `npm run ci:changed` passed over 31 files with 13 pre-existing release-base
    warnings for undeclared screenshot env vars and literal template
    placeholders.
  - `GATE_SELECT_BASE=origin/release/v0.40.0 node scripts/gate_select.mjs`
    selected full mode and passed all 12 steps with 8 workers: 2,986 test files
    passed and 12 skipped; 41,995 tests passed, 2 expected failures, and 115
    skipped; 28 browser test files passed; all typecheck, production build,
    generated artifact, malware, and changed-file checks were green.
- Live-client commands:
  - Canonical unit frames:
    `GAME_URL=http://127.0.0.1:5187
    SHOTS_DIR=docs/screenshots/deed-border-cartouche/phase-09
    DIFF_FILE=tmp/plaque-unit.diff NAV_TIMEOUT_MS=120000
    ENTRY_SELECTOR_TIMEOUT_MS=60000 node scripts/pr_screenshots.mjs`.
  - The ignored, removed-after-use target harness drove the repository's real
    `enterOfflineGame` plus canonical picker/inspect recipes for desktop,
    mobile, Parchment, and Chromium forced-colors emulation. A second ignored
    harness spawned four real offline peers and equipped each through
    `setActiveBorder` for the normal-distance town frame.
- The final album is
  `docs/screenshots/deed-border-cartouche/phase-09/`. Normal distance was judged
  first in `all-four-world-normal-low.png`; only then were
  `all-four-world-crop.png`, `all-four-world-grayscale.png`, and
  `all-four-color-grayscale-comparison.png` created. Name reads first, seal
  second, and metal third. Catalogue pages, Vault diamond, Ward key, and Laurel
  fan remain distinct without color.
- Low/high evidence is
  `01-deed-heraldry-unit-frames-desktop-low.png` and
  `02-deed-heraldry-unit-frames-desktop-high.png`; neither is occluded. Mobile
  and Parchment are 03 and 04. Picker and inspect desktop/mobile/Parchment
  frames use their descriptive filenames. Real forced-colors evidence is
  `forced-colors-player-target-picker.png`, with the media query active and
  player, target, and picker all reporting `curators_gilt`.
- `live-qa-evidence.json` records release ids, all four deed/slug pairs, normal
  distance order, grayscale reads, tier assertions, forced-colors state, and
  exact screenshot paths. The canonical manifest records non-blocking offline
  proxy 502s and seven skipped unrelated mobile NPC models.
- No sim, server, persistence, wire, net, world API, or IWorld feature path
  changed. No deed, slug, motif, title, lore, gameplay power, player-facing
  string, generated runtime art, sparkle, or animation was added.
- Fresh read-only `woc_test_coverage` and `woc_frontend` reviews both returned
  **READY** with high confidence and no remaining blocking or non-blocking
  findings. Frontend accepted normal-distance hierarchy, grayscale identity,
  interaction framing, mobile, Parchment, forced colors, bloom-only fairness,
  accessibility semantics, and allocation-free world rendering.
- Coverage initially found that E63 counted four cleanup calls without proving
  their order. `tests/pr_shot_targets.test.ts` now slices all four page-creation
  arms independently and requires `newPage`, then probe cleanup, then the first
  storage seed or navigation. Coverage re-review confirmed that moving or
  removing any cleanup now fails. The same review identified a misleading
  primitive-identity assertion around an unused silhouette getter; the dead
  getter was removed and the test now honestly pins one frozen literal table.
- After those review fixes, the 13-file focused suite again passed 385 tests,
  `npx tsc --noEmit` and `git diff --check` passed, and `npm run ci:changed`
  again passed over 31 files with the same 13 pre-existing warnings.
- Remaining risks: the offline manifest contains proxy 502 messages and seven
  skipped unrelated mobile NPC models. Browser axe, a dedicated mobile E2E
  pass, and ARM3 wall-clock profiling were not separately rerun. The canonical
  28-file browser suite, deterministic accessibility/responsive coverage,
  allocation guards, typechecks, production build, and full gate passed.
- Final Phase 9 verdict: **SHIP WITH NOTES**. No implementation or evidence
  blocker remains. No stage, push, or PR action was performed.

## Post-Phase 9 notes: five-pass craft polish

- This was a polish session, not a new feature phase. It preserved the four
  slugs, motifs, deeds, palettes, gameplay data, strings, and code-native asset
  contract.
- Pass 1 pinned the two reported defects before production changes. The Book
  interaction-preview motif was 7px above the 34px header center, and the Book
  world-preview seal overlapped its plaque by 3px. The world core now owns a
  protected 2px seal/plaque gap with a hidden 2px joint bridge; unit-frame and
  Book motifs use `top:50%` plus `translateY(-50%)`; both Book preview plaques
  keep the same 2px gap.
- Pass 2 harmonized the world, player/target, unit-frame, and picker family
  without changing the intentional portrait/seal hardware joint. The world
  core remains pure and caller-owned. No per-call object, array, path, raster,
  sprite, gradient, filter, animation, graphics-tier, or governor branch was
  added.
- Pass 3 rebuilt Inspect as one ceremonial identity composition. A 60px clipped
  plaque face sits inside a centered 620px host, while the 56px seal remains an
  unclipped sibling overlapping the shoulder by 14px. Name, optional title,
  and localized deed stay in one ellipsizing identity stack. Standing and the
  existing holder, Discord, developer, and curator badges are collected into
  one responsive honor rail. No visible copy or remote-card markup changed.
- Pass 4 completed the responsive and theme treatment. Mobile keeps the card in
  a centered column and narrows the mantle without hiding identity. Parchment
  uses panel-aware honor tiles while the earned plaque keeps its fixed dark
  heraldry well. Forced colors uses Canvas and CanvasText with no shadows. The
  equipment heading gained engraved hairlines and the paperdoll stage now uses
  a quiet neutral keyline, class-colored haze, and pedestal rather than a loud
  class border. Equipment slots and gameplay bars were not decorated.
- Pass 5 reviewed live results at normal gameplay scale before crop inspection,
  then checked desktop, mobile, Parchment, low/high, long Unicode, all badges,
  borderless, and actual Chromium forced-colors. The all-badge measurement was
  face `578x60`, seal `56x56`, rail `620x133.53125`, four honors, and no
  horizontal overflow.
- Live-client commands and evidence:
  - `GAME_URL=http://127.0.0.1:5187
    SHOTS_DIR=tmp/deed-heraldry-five-pass/pass-02
    DIFF_FILE=tmp/deed-heraldry-pass-02.diff NAV_TIMEOUT_MS=30000
    ENTRY_SELECTOR_TIMEOUT_MS=30000 node scripts/pr_screenshots.mjs` produced
    the seven world, unit-frame, picker, mobile, and Parchment files under
    `tmp/deed-heraldry-five-pass/pass-02/`. It was intentionally stopped after
    those scoped targets, so the process exit was 130 rather than a completed
    full recipe run.
  - `GAME_URL=http://127.0.0.1:5187
    SHOTS_DIR=tmp/deed-heraldry-five-pass/pass-04
    DIFF_FILE=tmp/deed-heraldry-pass-03.diff NAV_TIMEOUT_MS=30000
    ENTRY_SELECTOR_TIMEOUT_MS=30000 node scripts/pr_screenshots.mjs` completed
    the five canonical Inspect desktop, mobile, and Parchment captures.
  - A temporary ignored live-browser harness, removed after use, added
    `inspect-all-badges-long-unicode.png`, `inspect-borderless-control.png`, and
    `inspect-forced-colors-all-badges.png` to the same pass-04 directory. The
    forced-colors capture asserted `matchMedia('(forced-colors: active)')`.
- Deterministic checks:
  - `npx vitest run tests/nameplate_heraldry_core.test.ts
    tests/nameplate_canvas.test.ts tests/deed_heraldry_plaque_core.test.ts`
    passed 3 files and 67 tests after the geometry fix.
  - `npx vitest run tests/inspect_window.test.ts
    tests/deed_border_accent.test.ts
    tests/deed_heraldry_plaque_core.test.ts` passed 3 files and 78 tests after
    the ceremonial Inspect rebuild.
  - The proportional 19-file UI, architecture, mobile, theme, and painter list
    passed 459 tests. `pnpm run check:ts` and `git diff --check` passed.
  - The first final `GATE_SELECT_BASE=origin/release/v0.40.0 node
    scripts/gate_select.mjs` stopped only at changed-file formatting. After
    formatting, its full suite found one stale `charscreen_css.test.ts` source
    pin for the old model-stage border. The test was corrected to pin the
    neutral showcase edge plus class-color outline and haze; `npx vitest run
    tests/charscreen_css.test.ts` then passed 18 tests.
  - The final `GATE_SELECT_BASE=origin/release/v0.40.0 node
    scripts/gate_select.mjs` selected `mode=full` and passed all 12 merge-gate
    steps: 2,986 test files passed and 12 skipped; 41,998 tests passed, 2
    expected failures, and 115 skipped; all 28 browser files and 256 browser
    tests passed; typechecks, builds, artifacts, security scans, and changed-file
    checks were green.
  - Final `pnpm run ci:changed` and `git diff --check` passed. The changed-file
    check retained 13 known warnings for screenshot environment variables and
    literal template placeholders.
- Remaining evidence notes: the canonical offline captures logged expected
  local proxy 502 messages and unrelated unavailable NPC models. None obscures
  a reviewed plaque, picker, or Inspect surface. Screenshots remain ignored
  working evidence under `tmp/`; the durable Phase 9 album remains under
  `docs/screenshots/deed-border-cartouche/phase-09/`.
- Fresh read-only `woc_frontend` review returned **READY** with no production
  finding. It accepted the normal-distance hierarchy, protected seal gap,
  centered picker motifs, desktop/mobile/Parchment Inspect composition, long
  Unicode, all badges, borderless control, actual forced colors, grayscale seal
  identity, bloom-only low/high fairness, and the sprite-free/allocation-free
  implementation seams. Its only non-blocking note was offline proxy and
  unavailable background-creature noise in the pass-04 capture manifest.
- Fresh read-only `woc_test_coverage` review initially found six test-strength
  gaps: shared picker centering, exact Inspect face/seal sibling placement,
  distinct standing-row children, mobile Inspect composition, the class-color
  producer, and Parchment/forced-colors honor treatment. All six were fixed
  forward in tests without changing production behavior. The post-fix command
  `npx vitest run tests/deed_heraldry_plaque_core.test.ts
  tests/inspect_window.test.ts tests/deed_border_accent.test.ts
  tests/charscreen_css.test.ts` passed 4 files and 96 tests. The broader
  20-file heraldry, painter, Inspect, mobile, style, architecture, and theme
  slice passed 477 tests; `pnpm run check:ts`, `pnpm run ci:changed`, and
  `git diff --check` passed. The fresh re-review returned **READY** with high
  confidence and no remaining coverage finding, weakened assertion, focused
  test, or new skip.
- Final post-Phase 9 verdict: **SHIP WITH NOTES**. The result meets the craft,
  MMORPG hierarchy, responsiveness, accessibility, theme, graphics-fairness,
  sprite-free, and allocation-free bars. The notes are evidence-environment
  hygiene only: ignored working screenshots, offline proxy 502 messages, and
  unrelated unavailable background models. No new feature phase was begun.

## Post-Phase 9 notes: second five-pass plaque convergence

- This was a second independent craft loop over the existing four-reward
  family. It added no deed, slug, motif, title, lore, player-facing string,
  runtime image, gameplay state, wire field, persistence path, or new feature
  phase.
- Pass 1 froze the compact gameplay geometry. World rendering was left
  unchanged. Player and target frames preserve the intentional portrait/seal
  joint while adding 2px of seam-side header compensation, which increases the
  seal/plaque optical air to 3px without moving bars, titles, markers, or
  status information.
- Pass 2 refined the shared cold-surface metal. Compact and mirrored plaques
  retain their 8px point and 4px notch; the ceremonial face uses symmetric
  16px shoulders; the quiet deed tab uses symmetric 10px shoulders. Two fixed
  rivets, restrained 135-degree grain, a clipped inset keyline, and a round
  finishing rim use static CSS only. The world hot path remains unchanged,
  sprite-free, and allocation-free.
- Pass 3 rebuilt the Inspect mantle around the reference hierarchy. The host is
  `580x72`, the near-black face is `60px` high, the `64x64` medallion overlaps
  the shoulder by 16px through a blackened collar, and the localized granting
  deed sits in an attached `260x18` provenance tab. Name and optional title
  remain centered in the face; the motif is a subordinate watermark. The honor
  cards remain one responsive collection on a shortened 1px rail, while the
  paperdoll and equipment remain the dominant content.
- Pass 4 harmonized the Book. Both live previews are centered in one column;
  the world plaque caps at 220px and the interaction plaque at 260px without
  compression. The portrait-left preview now uses the outward compact shape,
  and its 34px cameo uses the existing dark heraldry well plus a metal inset so
  it no longer becomes an empty white disc on Parchment. Option semantics,
  focus, active state, localized labels, and the 40x40 touch floor did not
  change.
- Pass 5 judged the normal-distance world and unit-frame hierarchy before
  reviewing ceremonial crops, then checked desktop, mobile, Parchment, long
  Unicode with and without title, all four honors, borderless, actual Chromium
  forced colors, and low/high bloom-only fairness. Name reads first, seal
  second, and metal third; the paperdoll remains primary in Inspect.
- Initial red contracts used
  `npx vitest run tests/deed_heraldry_plaque_core.test.ts
  tests/inspect_window.test.ts tests/deed_border_accent.test.ts` and produced
  eight intended failures with 72 passes. After implementation,
  `npx vitest run tests/deed_heraldry_plaque_core.test.ts
  tests/inspect_window.test.ts tests/deed_border_accent.test.ts
  tests/charscreen_css.test.ts` passed 4 files and 98 tests.
- The broader command
  `npx vitest run tests/pr_shot_targets.test.ts
  tests/deed_heraldry_plaque_core.test.ts
  tests/nameplate_heraldry_core.test.ts tests/nameplate_canvas.test.ts
  tests/deed_border_accent.test.ts tests/deeds_border_picker.test.ts
  tests/deeds_window.test.ts tests/inspect_window.test.ts
  tests/inspect_view.test.ts tests/unit_frame_painter.test.ts
  tests/unit_frame.test.ts tests/charscreen_css.test.ts
  tests/mobile_window_coverage.test.ts tests/mobile_window_layout.test.ts
  tests/mobile_window_transform.test.ts tests/css_value_validity.test.ts
  tests/theme.test.ts tests/ui_effects_profile.test.ts
  tests/architecture.test.ts tests/monolith_budget.test.ts` passed 20 files and
  504 tests. `pnpm run check:ts`, `pnpm run ci:changed`, and
  `git diff --check` passed.
- `npm run gate` passed all 12 full-mode steps with 8 workers: 2,986 test files
  passed and 12 skipped; 42,000 tests passed, 2 expected failures, and 115
  skipped; all 28 browser files and 256 browser tests passed; typechecks,
  builds, generated artifacts, malware scanning, and changed-file checks were
  green.
- Canonical second-loop evidence is under
  `tmp/deed-heraldry-five-pass/pass-05-second/`: files 03-06 cover low, high,
  mobile, and Parchment unit frames; files 07-09 cover the Book picker; files
  10-12 cover Inspect desktop, mobile, and Parchment. The final stress album is
  `tmp/deed-heraldry-five-pass/pass-05-second-final/`: title, no-title, long
  Unicode, all honors, borderless, forced colors, mobile, Parchment, and
  `evidence.json`. Its measurements record a `580x72` host, `532x60` face,
  `64x64` seal, `260x18` tab, and all four honors grouped.
- After the frontend reviewer noted that the Book cameo was still light on
  Parchment, the final canonical picker rerun wrote desktop, mobile, and
  Parchment frames 07-09 under
  `tmp/deed-heraldry-five-pass/pass-05-second-final-ui/`. The new dark cameo
  reads as keyed heraldic hardware in both dark and Parchment themes. The run
  was intentionally stopped after the scoped picker evidence, so it has no
  completed manifest.
- Fresh read-only `woc_frontend` returned **READY**. It accepted the forged
  Inspect hierarchy, long/no-title cases, honor rail, borderless behavior,
  responsive and Parchment layout, actual forced colors, unit-frame seam,
  sprite-free material, and bloom-only tier behavior. Its one nonblocking Book
  cameo note was fixed and visually recaptured.
- Fresh read-only `woc_test_coverage` found test-strength gaps in the new seal,
  material, Book, borderless, honor-rail, forced-colors, tier, Parchment, and
  selector-to-silhouette contracts. Tests were fixed forward without weakening
  prior coverage. The unused ceremonial-notch export was removed. The final
  re-review returned **READY** with high confidence and no remaining focused,
  skipped, deleted, or weak changed test.
- The evidence runs logged expected local proxy 502s and unrelated unavailable
  background-creature models. Every scoped frame completed and no message
  obscured the reviewed UI. Browser axe, a dedicated mobile E2E run, and ARM3
  wall-clock profiling were not separately rerun; the canonical browser suite,
  deterministic accessibility/responsive coverage, allocation guards, and
  full gate passed.
- During closeout, `origin/release/v0.40.0` advanced from merged base
  `14ab2e8630` to `788009b38d` through Warspirit-only commit `e197b852ff`.
  `git rev-list --left-right --count origin/release/v0.40.0...HEAD` now reports
  `2 20`. The hotfix does not overlap the heraldry files, but it must be
  integrated and the gate rerun before a PR.
- Final second-loop verdict: **SHIP WITH NOTES**. No heraldry implementation,
  craft, accessibility, responsive, fairness, performance, or test blocker
  remains. Notes are the expected offline evidence noise and the newly arrived
  release drift. No stage, commit, push, or PR action was performed for this
  second loop.

## Post-Phase 9 notes: Book of Deeds selected-row spacing

- A real offline Book flow reproduced the reported overlap on both desktop and
  mobile landscape. Adjacent border rows had a `4px` gap, while the
  shell-authoritative focus indicator reaches `5px` beyond the selected button
  (`3px` outline plus `2px` offset). The selected/focused ring therefore crossed
  the following row by `1px`; the preview itself retained a safe `10px` seam.
- A test-first contract was added in `tests/deeds_window.test.ts`. The initial
  command `npx vitest run tests/deeds_window.test.ts` produced the intended one
  failure with 54 passes. The contract reads the authoritative focus rule and
  independently requires at least `3px` of post-ring desktop air and `5px` of
  post-ring touch air. Its declaration parser requires the exact CSS property,
  so `column-gap`, custom properties, suffix properties, and commented-out
  declarations cannot satisfy it.
- The production fix changes only shelf spacing: `.deeds-titles` and
  `.deeds-borders` now use an `8px` desktop gap, with a `10px` mobile-touch
  override. Row height, option semantics, selection, focus, scroll behavior,
  previews, the pinned mobile filter bar, titles, swatches, strings, and
  gameplay data are unchanged.
- Follow-up visual review found a second, independent containment defect. The
  larger vertical gaps kept adjacent rows separate, but the shelf retained only
  `2px` of inline padding around a focus indicator that reaches `5px`. The
  selected row was therefore cut off by `3px` at both scroll-shelf edges on
  desktop and mobile. The follow-up test-first run
  `npx vitest run tests/deeds_window.test.ts` produced the intended one failure
  with 54 passes because the shelf had no explicit inline-clearance contract.
- The forward fix adds `padding-inline: 8px` to both desktop shelves and a
  `10px` mobile-touch override. The same regression test now derives the
  authoritative `3px` outline plus `2px` offset, pins the resulting `5px`
  reach, evaluates effective row gap and inline padding in declaration order,
  and checks inline start and inline end independently. It accounts for gap and
  padding shorthands, logical and physical side overrides, duplicate
  declarations, and priority, while forbidding `!important` in the base and
  touch shelf rules so their cross-rule cascade remains deterministic. This
  rejects one-sided values such as `8px 0` as well as custom, suffix,
  wrong-axis, stale-first-declaration, and base-versus-touch priority escapes.
- Live post-fix selection of Eternal Spoils measured four consecutive `8px`
  gaps on desktop and four `10px` gaps at `844x390` mobile landscape. The
  selected row was also the focused row after the click and DOM rebuild. This
  leaves `3px` of visible desktop air and `5px` of visible mobile air outside
  the full focus ring. Durable evidence is in the final album at
  `matrix/07-book-desktop-all-elements.png`,
  `matrix/26-book-mobile-compact-landscape.png`,
  `matrix/28-book-mobile-tablet-landscape.png`, and
  `matrix/30-book-mobile-small-landscape.png`.
- A second real-client pass used the same offline Book flow and selected
  Eternal Spoils after the DOM rebuild. Desktop measured the row at
  `678..1058` inside a `670..1066` shelf: `8px` inset minus the `5px` focus
  reach leaves `3px` clear on both sides. Mobile at `844x390`, DPR 2, measured
  the row at `34..810` inside a `24..820` shelf: `10px` inset leaves `5px`
  clear on both sides. The durable final-album frames above supersede the
  intermediate capture directory.
- Focused verification passed:
  `npx vitest run tests/deeds_window.test.ts
  tests/deed_border_accent.test.ts tests/deed_heraldry_plaque_core.test.ts`
  (3 files, 106 tests), followed by the broader deeds/CSS/mobile slice (6
  files, 143 tests). The final strengthened single-file contract passed all 55
  tests. `npm run ci:changed`, `npx tsc --noEmit`, Biome, and
  `git diff --check` passed; changed-file output retained only known warnings.
- `npm run gate` passed all 12 full-mode steps with 8 workers: 2,986 test files
  passed and 12 skipped; 42,001 tests passed, 2 expected failures, and 115
  skipped; all 28 browser files and 256 browser tests passed. Typechecks,
  Svelte diagnostics, client/server/env/bot builds, i18n and manifest
  freshness, changed-file checks, and malware scanning were green. One earlier
  gate attempt stopped at changed-file formatting for the new test helper and
  was corrected with `npx biome format --write tests/deeds_window.test.ts`.
  The next attempt was explicitly interrupted during Vitest when the reviewer
  found the final cross-rule priority escape. After that test-only hardening,
  the 55-test targeted rerun, TypeScript, Biome, and `git diff --check` passed,
  followed by the complete successful gate above.
- Fresh read-only `woc_frontend` review returned **READY** with no finding. It
  accepted desktop density, the mobile pinned-filter/scroll composition, and
  the visible selected-row clearance in both final frames. Fresh read-only
  `woc_test_coverage` found and verified fixes for exact-property, asymmetric
  inline, source-order shorthand, row-gap, and cross-rule priority false
  positives. Its final mutation audit returned **READY** with high confidence,
  no focused or skipped test, and no remaining finding.
- Final row-spacing verdict: **SHIP WITH NOTES**. The selected-row overlap is
  resolved on desktop and mobile with decisive regression coverage. At this
  checkpoint the branch still had release drift; the subsequent final surface
  audit integrated it before PR closeout.

## Post-Phase 9 notes: third five-pass final surface audit

- Five independent craft passes reviewed the reward at normal MMORPG distance
  before crops, then across the complete world, player frame, target frame,
  Book, Inspect, responsive, theme, forced-colors, borderless, Unicode,
  all-honor, and graphics-tier matrix. The accepted hierarchy remains name
  first, seal second, metal third. Catalogue pages, Vault diamond/bar, Ward
  key, and Laurel fan remain distinct without color; the dark plaque stays
  shallow and quiet; titles, guilds, bars, markers, emotes, and unrelated
  equipment UI remain outside and unchanged.
- The audit found one confirmed production defect. At `1180x820` tablet size,
  the mobile `width: 100%` override widened `.inspect-honor-rail` to `1160px`,
  allowing an unbalanced 3+1 auto-fit layout. The test-first forward fix in
  `src/styles/hud.mobile.css` removes the honor rail from that full-width rule
  so the base `width: min(100%, 620px)` remains authoritative. The final live
  measurement is two `300px` columns with no root, banner, or vertical
  overflow. World and live unit geometry were deliberately left frozen.
- The durable evidence root is
  `docs/screenshots/deed-border-cartouche/phase-09/final-five-pass/` (54 files).
  `README.md` is the review ledger. Its exact groups are `canonical/` (11
  official targets), `matrix/` (34 raw placement/state captures), and
  `overview/` (8 contact/grayscale sheets). The fastest review paths are:
  `overview/canonical-contact-sheet.png`,
  `overview/matrix-world-unit-contact.png`,
  `overview/matrix-book-contact.png`,
  `overview/matrix-inspect-contact.png`,
  `overview/matrix-theme-contact.png`,
  `overview/responsive-contact-sheet.png`,
  `overview/world-all-four-color-grayscale.png`, and
  `overview/world-all-four-grayscale.png`.
- Raw world/unit evidence is `matrix/01-world-all-four-normal-low.png`,
  `02-world-current-target-and-unit-frames.png`, and
  `03-unit-frame-prestige_laurels.png` through
  `06-unit-frame-reliquary_gilt.png`. Book evidence is
  `07-book-desktop-all-elements.png`, all four selected states at `08` through
  `11`, and `12-book-borderless-none.png`. Inspect evidence is all four rewards
  at `13` through `16`, `17-inspect-long-unicode-no-title-all-honors.png`,
  `18-inspect-borderless-control.png`, and `19-inspect-remote-control.png`.
  Theme/accessibility evidence is the Book and Inspect pairs at `20` Parchment,
  `22` Midnight, `23` High Contrast, plus
  `24-forced-colors-book.png` and `25-forced-colors-inspect.png`. Responsive
  evidence is `26` through `31` for compact/tablet/small landscape and
  `32-mobile-portrait-real-rotate-state.png`. The fixed tablet frame is
  `matrix/29-inspect-mobile-tablet-landscape.png`.
- The official album was recaptured after release integration with:
  `GAME_URL=http://127.0.0.1:5187
  SHOTS_DIR=tmp/deed-heraldry-five-pass/audit-current/post-release-canonical
  DIFF_FILE=tmp/deed-heraldry-five-pass/audit-current/heraldry.diff
  NAV_TIMEOUT_MS=60000 ENTRY_SELECTOR_TIMEOUT_MS=60000 node
  scripts/pr_screenshots.mjs`. It exited 0 with 11 screenshots. The custom
  placement matrix used `GAME_URL=http://127.0.0.1:5187
  SHOTS_DIR=tmp/deed-heraldry-five-pass/audit-current/matrix node
  tmp/deed-heraldry-five-pass/audit-current/capture_matrix.mjs` and completed
  all 34 frames. Tablet remeasurement used the same harness with `MODE=tablet`
  and `SHOTS_DIR=tmp/deed-heraldry-five-pass/audit-current/tablet-fixed`.
- Capture-only noise was limited to expected offline proxy 502s and existing
  skipped non-preloaded NPC models. No message, missing model, or generated
  concept obscured the reviewed heraldry UI. No generated art was used as QA
  evidence and no runtime image asset was added.
- Release commits through `origin/release/v0.40.0@b39b16022e` were integrated
  by merge commit `98589bb615dedfb4eb86d0078be81080152269b2`. The final
  `git rev-list --left-right --count HEAD...origin/release/v0.40.0` result is
  `21 0`: 21 ahead, 0 behind. The incoming Warlock and Warspirit tests and
  implementation are preserved; there is no semantic release reversion.
- Focused verification passed:
  `npx vitest run tests/deed_border_accent.test.ts
  tests/inspect_window.test.ts tests/deed_heraldry_plaque_core.test.ts
  tests/deeds_window.test.ts tests/unit_frame_painter.test.ts
  tests/mobile_window_coverage.test.ts tests/mobile_window_layout.test.ts
  tests/mobile_window_transform.test.ts tests/css_value_validity.test.ts
  tests/charscreen_css.test.ts` (10 files, 229 tests). `npx tsc --noEmit`,
  `npm run ci:changed`, Biome on the changed plaque CSS/tests, and
  `git diff --check` passed; changed-file output retained only known warnings.
- `node scripts/gate_select.mjs` selected full mode against
  `origin/release/v0.40.0` and passed all 12 steps with 8 Vitest workers. The
  core suite passed 2,986 files with 12 skipped, 42,006 tests with 2 expected
  failures and 115 skipped. Browser regressions passed 28 files and 256 tests.
  TypeScript/Svelte diagnostics, env/server/bot builds, client bundle, i18n,
  wiki/media/manifests, backdrop survival, changed-file checks, and security
  checks were green. Expected output noise included unavailable localStorage,
  canvas, localhost services, and deliberately injected error paths.
- Fresh read-only `woc_frontend` review returned **READY**. It accepted the
  normal-distance and grayscale hierarchy, player/target seams, Book
  containment, Inspect edge cases and fixed tablet 2x2, all four themes,
  forced colors, low/high fairness, rotate state, semantics, and the
  code-native allocation-free world path. No frontend defect remains.
- Fresh read-only `woc_test_coverage` review returned **READY** with high
  confidence after mutation testing. Fix-forward coverage now scans every
  mobile honor-rail rule and grid shorthand, the complete Book shelf cascade
  and edge geometry, every graphics-tier `--fx-shadow` use across relevant
  sheets, and all 14 unknown-slug unit-frame clears. E37-E63 and the complete
  E1-E36 supersession ledger remain decisive; no weakened, deleted, focused,
  or skipped changed test remains.
- Contribution closeout removed the eight obsolete per-phase execution prompts
  and the accidental final-album `.DS_Store`. About 88 MB of ignored,
  intermediate capture files were moved to the macOS Trash after their durable
  evidence was retained in the 54-file final album. The art direction,
  implementation contract, QA ledger, and all referenced screenshot albums
  remain in-tree.
- After that cleanup, `node scripts/gate_select.mjs` again selected full mode
  against `origin/release/v0.40.0` and passed all 12 steps. Core Vitest passed
  2,986 files with 12 skipped and 42,006 tests with 2 expected failures and 115
  skipped. Browser regressions passed 28 files and 256 tests. TypeScript,
  Svelte diagnostics, env/server/bot/client builds, artifacts, i18n, backdrop,
  changed-file, and malware checks were green.
- The final closeout `woc_test_coverage` review returned **READY** with high
  confidence and no finding. The final `woc_frontend` review found only stale
  pre-authorization wording in `state.md`; that documentation gap was corrected
  before commit, with no runtime or craft finding.
- Final third-loop verdict: **SHIP WITH NOTES**. The only remaining risk is
  physical-device validation of notched-iOS hardware safe-area insets; browser
  emulation proves the responsive rotate state but cannot reproduce every
  device cutout. This is not a plaque implementation blocker. The operator
  authorized task-scoped commits, push, and a PR targeting
  `release/v0.40.0`; no additional feature phase or runtime content began.

## Phase 3 notes

- Motif kinds: catalogue / vault / ward / laurel. Four distinct line sets in the cartouche core. Canvas strokes those primitives; no second layout.
- `curators_gilt` is antique brass `#c9b17a` / `#2a2214` / `#f3ebcf`. Does not collide with `reliquary_gilt` `#f4ca43` or elite/quest `#f2c84b`.
- Inspect header is a CSS cartouche (well + edge + clasp). Portrait ring stays a circle; clasp is `::before` at 12 o'clock, z-index 2.
- Picker reuses `.deed-title-option`. Earned options show a 3-color swatch. None is empty.
- Shot recipes added: `deed-border-picker` and `inspect-border-cartouche`. Phase 4 owns the album.
- No sim / server / wire / IWorld change. No new player-facing strings. No Phase 4 screenshots.

## Phase 4 notes

- E1-E36 each name a decisive test. Phase 1 rows still pass after motifs and Catalogue brass. No Phase 1-3 test was weakened or deleted.
- Phase 4 fix-forward: E29 Deepward `#4fb3c8` literal; E30 chrome literals (`9px` / `#14110c` / `6px`); E31 clasp `transform: translate(-50%, -50%)` and `border-radius: 2px`; Reliquary rewards-ladder wording now says cartouche; picker `when` no longer lists the shared `components.css` sheet; CI sparse cone includes `docs/screenshots/deed-border-cartouche/`.
- Fairness: identity on every tier. Low preset tokens were `data-fx-level=low` / `--fx-shadow: 0`. High preset 3 booted (`data-fx-level=high` / `--fx-shadow: 1`). Forced-colors OS setting was not toggled; the unit pin is the evidence (Puppeteer rejected `forced-colors` emulation).
- Screenshots live under `docs/screenshots/deed-border-cartouche/phase-03/`. Official recipes: `nameplate-border`, `deed-border-picker` (desktop / mobile / parchment), `inspect-border-cartouche` (desktop / mobile / parchment). Extra album via the same `enter_offline_game` + low-preset seed: four slugs, Catalogue vs Eternal Spoils, borderless control, player and target rings, inspect name crop, high-preset pair.
- Reviewers (fresh, read-only, vs `origin/release/v0.39.0`): `qa-checklist`, `test-coverage-auditor`, `frontend-seam-reviewer`. Confirmed gate and coverage findings were fixed and re-tested. Non-blocking notes: motif writers mint a small per-plate array/closure; the ring painter writes unused pad/radius/alpha chrome vars that elide after first paint.
- `node scripts/gate_select.mjs` PASS (12 steps, selective, 8 workers).
- No sim / server / wire / IWorld change. No new player-facing strings.

## Phase 2 notes

- extraLift is 14. Declutter Y is 32 / 34. Well fill is `#14110c` at 0.4.
- Phase 2 fixed confirmed chassis gaps only: vacuous `Object.keys(input())` pins, missing 15px / AI-Cheater / self-hide / 25px declutter / shared-lift assertions. No Phase 1 test was weakened or deleted.
- Fairness: core and canvas take no gfx / governor / effects-profile argument. Identity draws on every tier. Only the existing portrait-ring bloom rides `--fx-shadow`.
- Forced-colors: unit pin is the evidence (OS setting was not toggled). No palette hex survives.
- Screenshots live under `docs/screenshots/deed-border-cartouche/phase-01/`. Seeded at `graphicsPreset: 1`. A headless SwiftShader boot of preset 5/6 did not reach the world hook, so the high-preset bloom comparison is the existing unit pin (identity has no tier input; only the CSS ring bloom reads `--fx-shadow`). Forced-colors uses the same unit pin.
- Reviewers (fresh, read-only, vs `origin/release/v0.39.0`): `qa-checklist`, `test-coverage-auditor`, `frontend-seam-reviewer`. Confirmed findings were fixed and re-tested.
- No sim / server / wire / IWorld change. No new player-facing strings. No Phase 3 identity in the tree.
