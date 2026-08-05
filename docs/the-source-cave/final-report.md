# The Source Cave: what shipped

Historical record of how the feature was built and verified. It is not source of truth:
the living decisions are in [state.md](state.md), and where either disagrees with the
code, the code wins.

## The idea

Turn the project's own contributor leaderboard into conquerable content. Every person who
merged a PR stands in a room named after them, ranked by their real merged-PR count, and
the top contributor is the boss. It is a tribute that plays like a raid, and it refreshes
itself: a new contributor joins the roster at the next server restart, with no content
authoring at all.

Three properties were non-negotiable from the start, and they shaped every later decision:

- **The roster is real data, so it changes.** Nothing may assume a fixed headcount, and a
  contributor's promotion must not silently change encounter difficulty.
- **The sim is deterministic and shared by three hosts.** Generating a dungeon at runtime
  had to happen without perturbing the shared rng draw order or the entity id sequence that
  parity goldens pin.
- **Contributor logins are proper nouns.** They ride through the wire, the nameplates, and
  the chat rules verbatim, which cuts against the repo's normal "everything is a `t()` key"
  reflex and needed an explicit, documented amendment.

## Approach

The cave reuses the dungeon engine for semantics (entry, instance slots, lockout, door
trigger) and the delve system for its interior, because delves already solved
module-assembled geometry with runtime origins. It occupies a reserved index in the delve
x-band, so collider resolution comes for free. The full rationale and the decision list are
in [state.md](state.md).

Two designs were tried. The first was a chain of sealed rooms, abandoned once it turned out
there was no way to reach any module past the entrance. The replacement is a single square
arena with contributors in concentric rings around a centre button and seal, which is what
shipped and what [encirclement-waves.md](encirclement-waves.md) specifies.

The encounter went through the same correction. It began as a manual-pull fight and became
deterministic weak-to-strong waves with a reactive centre seal, after playtests showed the
manual model produced either a trivial single pull or an unreadable mass aggro.

## Surface added

52 new files, plus edits threaded through the sim, wire, render, ui, and server layers.

| Area | Count | Notes |
|---|---|---|
| `src/sim/source_cave/` plus `mob/mob_template.ts` | 22 | The feature core, behind the `SimContext` seam |
| `tests/` | 17 | Spec, clear, loot, access, encounter, wire, i18n, boot, and the pure cores |
| `src/render/` | 5 | Interior, reboot button, seal plus its pure state core, weapon scene |
| `scripts/` | 4 | The deterministic raid probe and the reboot E2E |
| `src/ui/` | 3 | Mob core, progress view, reboot yell localization |
| `server/` | 1 | Boot-time roster fetch and injection |

`mob_template.ts` is worth calling out because it is the one piece that is not cave-scoped.
Three copies of an inline `MOBS[...] ?? sourceCave.templates.find(...)` fallback had
accumulated, so on the rule of three they were extracted into `mobTemplateOf(ctx, mob)`,
which the whole mob-swing affix cascade now resolves through. That extraction is what lets
synthetic cave templates fire affixes at all, and it returns identical template objects for
static-table mobs, so parity goldens were untouched.

## How it was verified

- **A deterministic scripted-raid probe** (`scripts/source_cave_raid_probe.ts`,
  `npx tsx scripts/source_cave_probe_runner.ts`) runs full 10-player raid profiles across fixed seeds and
  reports clear rate, median clear time, deaths, and minimum healer mana. It is the reason
  the tuning is defensible rather than guessed: the current matrix is in
  [encirclement-waves.md](encirclement-waves.md), and it is regenerable, not a snapshot.
- **A real-browser E2E** (`scripts/source_cave_reboot_e2e.mjs`) drives the offline client
  and renderer through arrival, the button, the seal states, the wave opening, cohort wake,
  breach, lighting, the clear, and the chest.
- **The focused suites** listed in the surface table, plus the transversal ones this feature
  touches: architecture, localization, snapshots, IWorld parity, and the deterministic
  parity goldens.

Two findings are worth remembering because no test caught them:

- **A shared-tick crash reached a live playtest.** `isTrivialTo` and the idle proximity scan
  read `MOBS[mob.templateId]` unguarded, which is `undefined` for every cave mob, so
  standing near an idle contributor crashed the server tick. Found by playing, not by any
  agent or suite. It is the origin of `mobTemplateOf` and of the gotcha now recorded in
  [state.md](state.md).
- **Green tests were a false positive on i18n.** The S3 guard only sees literal strings at
  an emit site, and the well banter emitted a variable, so ten player-facing lines had no
  matcher and would have shipped as raw English in every language. The lesson recorded in
  [state.md](state.md) is to assert `localizeSimText()` per line per language rather than
  trust the guard.

## Deferred

Tracked as open items in [state.md](state.md): the themed rare's name still needs sign-off
(O2), the `/wiki` guide page does not exist (O4), and the Book of Deeds records were never
authored (O-deeds), which the repo rule requires for conquerable content.
