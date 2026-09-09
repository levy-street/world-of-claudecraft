# src/ui/hud/aura_tracks/

Six opt-in HUD frames that answer six questions about the beneficial auras the
LOCAL player has out: am I covered, what is my rotation keeping up, what is
boosting me, how am I moving, who am I keeping up, and how much shield is left.
The enemy-side sibling is `src/ui/hud/target_dots/`; the two families share their
classifiers rather than each keeping a list.

| File | What it is |
|---|---|
| `aura_track_catalog.ts` | Which track each aura belongs to, DERIVED from `ABILITIES` at module load and keyed by the id a live aura carries. |
| `aura_track_descriptors.ts` | The six tracks as data: element id, storage key, setting key, label, row shape, `accepts()`, plus the frame-id prefix and its reverse lookup. |
| `aura_track_view.ts` | The one pure selection core all six share. Registered in `UI_PURE_CORES`. |
| `aura_track_painter.ts` | The one painter all six share. Three row shapes, writes only through `PainterHostWriters`. |
| `aura_track_host.ts` | `AuraTrackFamily`: composes one view + one painter per descriptor and owns the per-frame drive. Not a pure core (it constructs the painter). |
| `index.ts` | The barrel. The Hud imports from here; a PURE core (the unlock core) imports the descriptor module directly, never the barrel, because the barrel re-exports the painter. |

## The rules that are load-bearing

- **Membership is derived, never listed.** A hand-written list of spell ids is a
  second source of truth that goes stale the day someone adds a heal: the new
  spell joins no track and nothing fails. `buildCatalog()` reads `ABILITIES`, and
  `tests/aura_track_catalog.test.ts` pins the DERIVATION RULES (the duration
  ceiling, the cooldown line, each kind set) rather than a copy of the output, so
  a rule change has to be argued rather than absorbed. New content needs no edit
  here. A spell the rules cannot see gets a row in `EXCLUDED_IDS` or `FORCED`
  **with the reason written down**.
- **Keys are the ids the SIM applies, not ability ids.** An effect can name its
  own `auraId` (Raised Guard lands as `raised_guard_dr`, Hallowed Wall's shield
  as `holy_shield_absorb`), a second self-buff is kind-suffixed, an absorb beside
  a stasis takes `_absorb`. Those rules live in `src/sim/combat/aura_ids.ts` and
  the dispatcher calls the same functions, so one entry per qualifying EFFECT is
  an id a live aura can carry. The catalog test casts through a real `Sim` and
  checks every aura it leaves resolves; if you add an id rule to the dispatcher,
  add it to `aura_ids.ts`, not inline.
- **`AURA_TRACK_DURATION_CEILING_SEC = 60` is what keeps the long buffs out.**
  Everything shown is 60s or less; the next longest helpful buff is 600s, then
  1800s and 3600s, so the cutoff sits in a 10x gap and nothing is borderline.
- **Never a second classifier.** Ownership comes from `isOwnAura`
  (`src/sim/aura_classify.ts`), the toggle test from `isToggleAuraKind` and the
  final seconds from `isAuraExpiring` (both `src/ui/auras_view.ts`). The catalog
  admits a long-duration aura past the ceiling ONLY when `isToggleAuraKind` calls
  it a toggle, and that same answer is its row shape, so a catalog mode is always
  painted as a mode. A first cut had its own "long utility kind" rule and painted
  the hunter aspects as 1,800s countdowns. If you find yourself writing a list of
  toggles or a "who cast it" check, you are forking a classifier the aura strips
  already own.
- **`DEFENSIVE_COOLDOWN_SEC = 60` is the Defensives / Self line.** At or above it
  a protective self-buff is an emergency button; below it, rotational. The data
  leaves a clean gap: shortest defensive cooldown 60s, longest rotational 45s.
- **Order is stable, never by remaining time.** A tracker that re-sorts as timers
  tick moves the row you are reaching for, which is the one thing a refresh
  readout must not do. Self rows first, then allies; within a unit, by aura id.
- **Three row shapes, because the data has three.** `timer` drains with the
  clock. `points` drains with DAMAGE: an absorb's stored `value` IS its remaining
  shield (`src/sim/types.ts`), and its duration runs in parallel, so the points
  lead and the seconds ride behind them dimmed. `mode` has no number at all: a
  countdown under stealth is a lie the player reads as "this is about to leave
  me".
- **A points bar needs a denominator the sim does not store.** The core keeps a
  per-row high-water `peakPoints` and fills against it, and forgets a row's peak
  the tick the row disappears (not once the map has grown past some size: a solo
  player's own shield key would never have been evicted, and a fresh smaller
  shield read 75% full against the dead one's peak).
- **The off frame costs nothing.** All six ship off. `AuraTrackFamily.tick`
  resolves the six switches first and, when none is on, neither copies the
  entity roster nor walks a painter; a track that was just switched off gets one
  empty paint so its frame hides and is then skipped.
- **Nothing here is graphics-tier gated.** These are timers a player acts on, so
  the track's own setting is the only switch (root CLAUDE.md, gameplay-neutral
  graphics). The FPS governor must never reach them.
- **Every track is off by default,** and its frames-menu row drives its setting
  (`frameRowSettingKey` in `interface_unlock_core.ts` resolves the generated
  frame id back to the descriptor), so the two checkboxes over one frame are one
  state. Six frames appearing unasked would bury the world; each is opted into
  under INTERFACE > COMBAT.
- **Mobile is landscape-only, and an unsaved frame is never clamped.** The phone
  viewport is about 360px to 430px tall and `MovableFrame.applyPos` leaves the
  stylesheet in charge until a player has dragged a frame, so a CSS seat below
  the fold is a frame nobody can reach. The mobile seats are two columns of three
  in the top band beside the Target dots tracker, clear of the move stick; a new
  seat is checked at 844x390.

## Adding a seventh track

A row in `AURA_TRACKS`, its container in `index.html` and `play.html`, its
`BOOL_SETTINGS` key (and the `AuraTrackSettingKey` union), its options row, its
`hudChrome.auraTracks.*` label, and its CSS `--at-fill` colour plus a desktop and
a mobile seat. Nothing in `hud.ts`, `interface_unlock_core.ts` or either of the
two shared modules: the Hud composes by LOOPING the table, the frame specs and
the frames-menu setting routing are generated from it. If a change needs an edit
in `hud.ts`, the descriptor is missing a field.
