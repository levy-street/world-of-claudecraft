# Talents 2.0: Local Validation Guide

Everything below is on the branch stack; the play build merges it all onto
release/v0.19.0. Status of each slice, how it was verified, and how you can
validate it yourself in the client.

## What was tested, and how (honest inventory)

| Slice | Automated proof | Screenshots |
|---|---|---|
| Foundation primitives (MERGED as #1305) | 16 unit cases + pvp_safety + parity goldens untouched | YES: asserted live-client scripts (interrupt lockout, Scorch-while-moving, guaranteed crit) |
| Ground targeting + 6 spells (in #1305) | ground_target_cast suite + 278-test battery | YES: reticle, Flamestrike tooltip + burst ring, 4 ground spells mid-effect |
| 24 spec signatures (PR3 branch) | signature_mechanics + talents suites | YES: 14-scene asserted roster (Holy Nova, Conflagrate, Swiftmend, Feral Charge, Cold Blood crit, forms...) |
| Form tints | architecture + visual scripts | YES: purple Shadowform, translucent Moonkin |
| Row engine + picker (PR4/PR5) | choice_rows suites, snapshots, ratchets | YES: picker tab picking Firestarter through the real DOM |
| Waves B1/B2 (7 classes' rows) | wave tests + 2 coverage reviews + fix passes | NO dedicated shots (unit/parity coverage only) |
| Wave C | 2 new parity goldens + the 6561-build sweep | Report: docs/balance/row-sweep.md |
| Wave D (the flip) | 379-test battery + parity + coverage review + fix pass | Picker shot only; no dedicated flip shots |

Every screenshot came from a script that ASSERTS its scene before shooting
(a red assertion cannot produce the image). The scripts are committed; you
can re-run any of them (section 4).

## 1. Setup (one time)

The stack expects a clean checkout; do not merge into a branch with local
changes. From this repo:

```bash
git fetch fork
git worktree add ../woc-play fork/talents... # SKIP: use the branch below
git worktree add ../woc-play && cd ../woc-play   # if worktree add needs a ref:
# The canonical play branch (full epic merged onto release/v0.19.0) lives in
# the session worktree /tmp/woc-gt-wt as 'talents-2-0-on-v19'. To recreate it
# yourself from scratch:
git checkout -b my-talents-test origin/release/v0.19.0
git merge fork/feature/talents-2-0-pr5
# conflicts, if any, are only in generated i18n files; resolve with:
npm run i18n:gen && node scripts/i18n_resolved_hash.mjs --write && npm run wiki:content
git add -A && git commit -m "test merge"
ln -s ../world-of-claudecraft/node_modules node_modules   # if a fresh worktree
npm run dev   # client on :5173
```

Shortcut: the session's play server is already running at
http://localhost:5173 from /tmp/woc-gt-wt (branch talents-2-0-on-v19).

## 2. Fast character prep

Create an offline character (any class). Then in the browser devtools
console (F12):

```js
window.__game.sim.setPlayerLevel(20);   // or 11 to feel the row unlocks
```

Level 5/8/11/14/17/20 each fire a "New talent choice available!" banner.

## 3. The validation walkthrough

### A. The flip itself (Wave D)
1. Press N. The Talents window shows SPECIALIZATION and CHOICES tabs only.
   There are NO point trees anywhere. CHOICES is the default tab.
2. CHOICES: six rows (5/8/11/14/17/20), three cards each, icons + tooltips.
   Locked rows are dimmed with "Unlocks at level N". Click to pick: instant,
   gold highlight.
3. Clear button = free respec (all picks drop, re-pick freely).
4. Export a build string; Clear; Import the string: the picks come back
   (imports APPLY, server-authoritatively).
5. Old-save migration: any pre-flip character loads with spec kept, tree
   points silently gone, rows empty (the one-time free respec).

### B. Ground targeting (merged #1305)
1. Mage at 20: Flamestrike is baseline. Press its button: a school-colored
   reticle follows your cursor on the terrain, dims beyond 30yd (the clamp
   preview), sized to the blast radius.
2. Click to detonate: orange AoE ring flashes at the point + fire splash;
   NO lingering zone. Escape/right-click cancels aiming.
3. Warlock Rain of Fire / hunter Volley / druid Hurricane (channels) and
   shaman Earthquake (lingering zone) use the same aiming.

### C. Signatures (PR3)
Pick a spec at 10 (SPECIALIZATION tab): a real spec-exclusive spell lands.
Spot checks:
- priest/shadow: Shadowform: you turn PURPLE (render tint) + spell power.
- druid/balance: Moonkin Form: TRANSLUCENT.
- warlock/destruction: cast Immolate, then Conflagrate consumes it for burst
  (Conflagrate errors with "Nothing to consume." without your Immolate up).
- druid/restoration: Rejuvenation on a friend, then Swiftmend eats the HoT
  for an instant heal.
- rogue/assassination: Cold Blood then any attack: guaranteed crit.

### D. Row content spot checks (Waves A/B1/B2)
- mage r5 Firestarter: Scorch keeps casting WHILE YOU HOLD W (every other
  cast still cancels on movement).
- mage r11 Ice Lance after Frost Nova: 3x damage on rooted targets (compare
  the numbers rooted vs unrooted).
- mage r17 Blink: 15yd teleport that BREAKS roots, and STOPS at fences,
  walls, and locked delve doors (try blinking through the delve portcullis:
  you stop short; that is the anti-exploit sweep).
- warrior r8 Pummel / mage r8 Counterspell etc: every class has ONE
  interrupt option. Interrupts only work on consenting PvP targets
  (duel/arena) or casting mobs: outside a duel they no-op on players by
  design (#96).
- priest r8 Psychic Scream: feared enemies actually RUN (fixed overnight).
- rogue r20 Shadowstep: lands ADJACENT to your target, never past it.
- hunter r14 Multi-Shot, shaman r14 Chain Lightning: radius AoE (target
  caps are a documented deviation).

### E. Balance
Read docs/balance/row-sweep.md: all 6561 builds enumerated; class medians
18.2-38.4 dummy DPS; no build >40% over its class median. Re-run yourself:

```bash
node scripts/row_build_sweep.mjs   # ~11 minutes
```

## 4. Re-run any proof script yourself

All need `npm run dev` running; pass GAME_URL if not :5173. Each prints
per-scene JSON assertions and exits non-zero on any failure.

```bash
node scripts/choice_rows_picker_shot.mjs          # the picker end-to-end
node scripts/pr2_flamestrike_showcase.mjs         # tooltip + burst + reticle
node scripts/pr2_ground_spells_shots.mjs          # the other 4 ground spells
node scripts/talent_primitives_shots.mjs          # interrupt/empower/mobile-cast
node scripts/pr2_primitives_shots.mjs             # vs-rooted 3x, shatter crit
node scripts/pr3_signature_roster_shots.mjs       # 14 signature scenes
node scripts/pr3_form_tints_shot.mjs              # purple/translucent forms
```

Committed screenshot evidence: docs/screenshots/talents-2-0/{pr1,pr2,pr3a,pr3b}
(and docs/screenshots/pr2_*.png on the foundation branch).

## 5. The full test suites

```bash
npx vitest run tests/choice_rows.test.ts tests/talents.test.ts \
  tests/talents_pr5_wave_a.test.ts tests/signature_mechanics.test.ts \
  tests/talent_primitives.test.ts tests/ground_target_cast.test.ts
npx vitest run tests/parity          # 165 tests incl. the 2 new scenarios
npm test                             # everything (expect known load flakes)
```

## 6. What still deserves eyes (known, documented)

- Waves B1/B2/D have no dedicated screenshots (full automated coverage
  only); say the word and a codex screenshot sweep for the 7 new classes'
  rows can run like the earlier ones.
- Documented mechanic deviations (Ice Block is a big absorb, not immunity;
  Multi-Shot/Chain Lightning are radius AoE; Feign Death became a passive)
  are listed in the wave commit messages: approve or queue real machinery.
- Tuning watch-items from the sweep report: the freeze package, priest
  Silence, mobile-Scorch kiting (control value is not dummy-measurable).
- Merge order now that #1305 is in: PR3 (signatures) opens next, then PR4
  (engine), then PR5 (rows + flip).
