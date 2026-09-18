# Eastbrook first-quest handoff

The 12 September playtest revision keeps the ferry landing and distributes starter
givers around the town square, with optional golden guidance and profession trainer
titles. Manual acceptance, objectives, XP, rewards and graduation rules are unchanged.

## Current behavior

Implemented on `feature/eastbrook-handoff` against `release/v0.43.0`. The branch is
the pull request under review; nothing here is deployed.

The ferry retains its original landing at (-4.5, -101.5), facing -0.87 radians.
The five starter givers occupy separate positions around the square:

| NPC | Position (x, z) | Setting |
| --- | --- | --- |
| Marshal Redbrook | (-1, -93) | Noticeboard side |
| Apothecary Lin | (-11, -89) | North green |
| Trader Wilkes | (-25, -94) | Market edge |
| Fisherman Brandt | (-25, -104) | West edge |
| Foreman Odell | (-16, -111) | South edge |

Neighboring givers are approximately ten yards apart, with clear approaches and
road clearance. Crafting stations remain in their established positions. The central
monument can obscure some cross-square sightlines; the acceptance rule is accessible,
spaced positions rather than a tightly packed group visible from one point.

Every tutorial-island-to-town crossing by a character who has not yet finished Wolves
at the Door opens the existing managed ferry dialog with **Turn guidance on** and
**Turn guidance off** buttons, followed by the return-bell note (the ride may have been
a misclick). The choice persists on this device and can be changed under **Options,
Interface, Combat, Eastbrook golden guidance**. Escape leaves the saved preference
unchanged. Guidance starts enabled by default and remains independent of per-character
quest tracking. Once the quest is done the guidance has nothing left to draw, so the
crossing shows the plain return-bell note once per device instead (the one-shot that
existed before this change), never the choice.

The follow-up button polish uses the shared gold primary and dark secondary button
primitives, with equal-width columns that stack on narrow windows. Both labels can
wrap and both controls retain a 44-pixel minimum touch target and visible keyboard focus.
The choice shell is 480 pixels wide, clamped to the viewport on narrow windows.

When enabled, a gold marker and trail point from the ferry to Marshal before accepting
Wolves at the Door. Confirmed acceptance sends the trail around the graveyard to Wolf
Run; ready state reverses it to Marshal. The rendered curve follows (-1, -93),
(-14.5, -72.5), (-14.5, -53.5), (-10, 6). The authored camp ring remains 28.5 yards.
Hand-in removes the guide; abandoning restores Marshal's offer marker. Untracking,
switching guidance off, death/ghost state and leaving Eastbrook suppress it. Online
pending hand-in retains the return route until server acknowledgment. Graphics
rebuilds retain the live settings and tracking readers.

Actual profession-service NPCs have localized `<Profession Trainer>` subtitles on
nameplates and matching dialogue titles. The explicit roster includes Darva, Marlow,
Ottilie, Gizzel, Hesk, Verane, Jessica, Teasel, Hollis, Verbena, Odell and Haldren.
Lin and Brandt have no profession-training service and retain their ordinary titles.

Profession discovery exclamation markers disappear from nameplates, minimap and map.
This covers `q_prof_*` and farm-objective quests: Jessica's **First Furrow** was the
missed case because it is `q_farm_intro`. Quests remain available through dialogue,
and active/ready hand-ins plus ordinary combat offers on mixed givers remain visible.
This is a standing rule for every profession onboarding quest in every zone on all
three hosts (the trainer subtitle is how a trade is discovered now), not a rollout
flag; reverting it is deleting the `isProfessionQuest` branch in
`src/sim/quests/ambient_quest_marker.ts`. The Renown deed that triggers on the smith's
introduction quest is therefore found through the trainer's dialogue rather than a
marker, which is intended.

## Visual and interaction evidence

The isolated browser probe uses the real ferry event and HUD popup, with a controlled
level-3 offline character. On and Off persist through fresh Settings instances;
Escape closes without changing the choice. Emulated landscape touch can choose Off,
close the backdrop and use the next touch. No page errors were recorded. These checks
are not a native-device test or a human timing measurement.

- [Revised square and Marshal marker](../screenshots/eastbrook-vale-rebuild/handoff-experiment/revised-square-guidance-on.png)
- [Arrival choice](../screenshots/eastbrook-vale-rebuild/handoff-experiment/revised-guidance-choice-desktop.png)
- [Guidance disabled](../screenshots/eastbrook-vale-rebuild/handoff-experiment/revised-square-guidance-off.png)
- [Accepted wolf route](../screenshots/eastbrook-vale-rebuild/handoff-experiment/revised-wolves-route.png)
- [Jessica's trainer subtitle](../screenshots/eastbrook-vale-rebuild/handoff-experiment/revised-jessica-trainer.png)
- [Landscape touch choice](../screenshots/eastbrook-vale-rebuild/handoff-experiment/revised-guidance-choice-mobile.png)
- [Polished guidance buttons, desktop](../screenshots/eastbrook-vale-rebuild/handoff-experiment/polished-guidance-desktop.png)
- [Polished guidance buttons, touch](../screenshots/eastbrook-vale-rebuild/handoff-experiment/polished-guidance-mobile.png)

The button follow-up browser check measured both controls at 210 by 44 pixels on
desktop and landscape touch, without label overflow. Tab then Enter chose Off;
touch chose On and released the modal backdrop. No page errors were recorded.

The rendered Catmull-Rom route passed 2,000 samples for collision, water, fences and
slope. A direct line from the new Marshal position crossed the graveyard, so the guide
uses the clear detour. Earlier direct-route walking measurements apply only to the
superseded dock cluster and are not evidence for this revised route.

Moving NPCs also moves their existing terrain calm pads. Geometry and height-parity
fixtures were refreshed after visual and collision review without changing their
precision or acceptance rules. Runtime-only polish provenance was re-sealed using
the canonical tool. All four historical JSON files retain identical capture data,
identity and performance values outside their provenance blocks. The live Lin camera
contract follows her new stand.

## Verification and remaining gate

Current revision checks (counts overlap; these are not a unique total):

| Command / scope | Result |
| --- | --- |
| `npx vitest run tests/options_view.test.ts tests/eastbrook_wolves_guidance_core.test.ts tests/eastbrook_guidance_choice.test.ts tests/managed_window_close_registry.test.ts tests/mobile_window_coverage.test.ts` | 85 passed |
| `npx vitest run tests/terrain_chunk_geometry.test.ts tests/terrain_height_parity.test.ts tests/eastbrook_polish_capture_contract.test.ts tests/eastbrook_polish_artifact_integrity.test.ts tests/monolith_budget.test.ts` | 54 passed |
| Trainer labels, real nameplate painter, ambient markers, entity display and architecture | 160 passed |
| Generic minimap/map/nameplate marker regressions | 199 passed |
| Canvas, heraldry and dialogue regressions | 91 passed |
| Settings, popup, guidance core/painter/lifecycle, renderer composition, arrival, shell and localization | 297 passed initially; five Options expectations needed the new setting added, then the entire Options suite passed in the 85-test run above |
| `./node_modules/.bin/turbo run i18n:gen check:types build:env build:server build:bot build:bundle --ui=stream --concurrency=2` | All seven tasks passed; client, server, bot and admin checks/builds included |
| `npx vitest run tests/monolith_budget.test.ts tests/client_shell.test.ts` | 156 passed after final formatting |
| `npm run security:gate` | Passed: 8,906 files, zero high flags after recorded priors |
| Scoped `biome check --files-max-size=4000000` and `git diff --check` | Passed after formatting; inherited lint warnings remain |

Button-polish follow-up: the guidance-choice, greeting, CSS validity/token/color,
focus and mobile-coverage suites passed all 58 tests. `npm run check:ts`,
`npm run build:bundle` and scoped Biome checks passed. The frontend review found no
confirmed defects; the full pre-merge gate status below is unchanged.

The popup and trainer strings have five required non-Latin translations; other
untranslated locales use English fallback pending release fill. Generated i18n and
wiki content were rebuilt. Read-only cross-platform review found no outstanding
issues in ferry events, live preferences, confirmed quest state or trainer markers.

**Review round (16 September).** The branch was merged with the current
`release/v0.43.0` tip and taken through the repository's reviewers (QA checklist,
sim architecture, frontend seam, content obligations). Changes from that round: the
guidance choice is gated on the character's own Wolves at the Door state (done means
the plain return-bell one-shot, as before this change) and the return-bell text is
back in the rendered body; the unused `eastbrookArrivalNote` key is gone and every
pre-existing locale row this branch had re-worded is reverted (overlays change only
for the new keys); the mainland guide answers a finished quest from `questsDone`
before the zone scan or any online `questState` read; the trainer label is a named
`*_core` pinned in the architecture sweep; the renderer factory requires the live
`Settings`; the generic nameplate marker contract and the minimap/map cooldown
agreement are pinned again on synthetic non-profession quests beside the new
profession cases; the marshal steps a yard further from the noticeboard so its posting
point is a full interact range clear of him (the noticeboard interaction suite pins
that) and the layout suite pins the five givers' road clearance; and the parity
goldens are re-minted for the moved givers (the walked player's position only, rng
draws unchanged).

The selective merge gate (`node scripts/gate_select.mjs`) runs on the merged tip before
the pull request leaves draft; its result is recorded on the pull request, which is the
record of truth for whether this revision passed.

Native-device testing, human first-loop timing and simultaneous-arrival contention
remain rollout checks. This work does not establish a retention improvement.


## Measurement contract for rollout

Use first eligible arrival as the experiment origin, separately from the graduation
deed. Record actual client/server exposure versions and retain the signup-based
graduation series. Verify existing telemetry coverage before designing additional
events; database changes require the repository performance review.

Primary outcome: an Eastbrook combat quest hand-in within 60 minutes of arrival,
including players who never accept a quest in the denominator. Use an explicit
Eastbrook combat quest allowlist rather than treating every non-island quest as combat.
Inspect arrival, acceptance, first objective progress, objectives complete and hand-in
as separate transitions wherever telemetry supports them.

Secondary outcomes are combat completion within 24 hours, a new session during hours
24 to 48, and level 5 within 72 hours. Include only observations mature enough for each
window. Report class, platform and paid/organic breakdowns with sample sizes. Watch
deaths, failed arrivals and hand-ins, and profession participation as guardrails.

Shared-world NPC movement makes account-level randomization of the whole package
unsuitable without supported world isolation. A versioned before/after comparison is
the default proposal; it does not isolate individual components or establish causation.
Use at least a full week of exposure for weekday coverage, then wait for outcome
maturity and assess uncertainty. Version checks are preferable to assuming every
native client updates within 48 hours.

The earlier 61.4% figure is eventual observed non-island quest completion after
graduation, not day-0 completion. Its later-return measure has no fixed upper window.
Recompute matched-window baselines before using either as an experiment comparator.

Understand the separately monitored graduation decline before rollout. Auto-accept,
graduation auto-hand-in, rewards and difficulty tuning remain separate changes.

## Pre-change investigation

The release baseline places Marshal at (-58, -102), approximately 54 yards from the
ferry landing. The authored `playerStart` at (-94, -58) is the offline and editor spawn;
a real new character arrives at the ferry landing, which is the walk this change
shortens. The browser probe exercised fresh offline entry, ferry travel and
manual wolves acceptance without page errors. Captures are under
`docs/screenshots/eastbrook-vale-rebuild/handoff-experiment/`.

A deterministic seed-42 combat probe used level-3 Hunter, Warrior and Mage characters
with normal starter equipment plus the tutorial ring and pouch. Each survived eight
level-2 wolves, earned real quest credit and handed in the quest. Each also obtained
a quest-gated boar hide through ordinary corpse interaction, without harvesting.
Damage, HP and resource values were not overridden during combat.

This was an isolated scripted combat probe with travel and competition excluded, not
a human playtest or proof of a ten-minute first-loop target. The evidence supports
retaining difficulty while testing navigation. Multiplayer camp contention and
production retention still require observation after the appropriate validation and
rollout steps.
