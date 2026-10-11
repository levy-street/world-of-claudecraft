# Druid Cat Form mobility pass

Status: implemented. Follows `class-design-rules.md` (movement is shared utility that
stays outside the core rotation) and the v0.29 druid design (`druid-v029-class-design.md`).

## Problem

Wildfang had no mobility identity outside a 60 second Dash and one talent row. Cat Form
moved at caster speed, Fleet Form was a flat speed bonus that did nothing against a snare,
and the only tool that broke control (Wildshift) shared row 5 with Loping Stride and
Skylark, so a feral gave up either its sprint or its root break at level 5 and kept that
choice for the rest of the game.

## The four changes

1. **Cat Form moves 15% faster.** `moveSpeedMult` (`src/sim/player_motion.ts`) treats
   the `form_cat` aura as a speed aura at the fixed `CAT_FORM_MOVE_MULT` constant
   (`src/sim/types.ts`, beside `ENRAGE_MOVE_MULT`). The `form_cat` aura's value is the
   threat multiplier, not a speed, so the branch reads the constant and never `a.value`.
   The form passive is its own layer: it MULTIPLIES the strongest temporary speed buff
   (Dash in Cat Form is 1.15 x 1.5, the Loping Stride shift sprint is 1.15 x 1.6), while
   the temporary buffs themselves (Dash, Loping Stride, Fleet Form, Enrage) keep the
   classic-era rule among each other: the strongest applies, they never stack. The
   original pass folded the passive into that same `Math.max`, so any sprint replaced the
   form bonus instead of adding to it (a Cat that Dashed ran at a flat 150%, not 172.5%);
   `tests/druid_form_speed_stack.test.ts` pins the layered rule. Mount speed stays
   additive and slows still bite multiplicatively, exactly as before.
2. **Fleet Form breaks breakable roots and slows on cast, baseline.** `druidEngineOnCast`
   (`src/sim/combat/druid_engines.ts`) runs the shared `breakMovementControl` helper on
   every Fleet Form cast, with no talent required. Cat, Bruin, and Moonwing keep the
   Wildshift gate. Auras stamped `unbreakableControl` are skipped on both paths, and the
   aura-lost event emit is unchanged.
3. **Wildshift reworded** to the forms it still gates: "Shapeshifting into Cat, Bruin, or
   Moonwing Form removes breakable roots and slows." No mechanic change beyond change 2.
4. **Dash learns at 12 instead of 18.** Every other Dash number is unchanged (+50% for
   15 sec, 60 sec cooldown, off the global cooldown, Cat Form only).

The Cat Form and Fleet Form tooltips state the new rules (`src/sim/content/classes.ts`
and the English catalog `src/ui/i18n.catalog/abilities.ts`, same wording in both), and the
Cat Form buff-bar line (`hudChrome.auraEffect.wolfForm`, resolved in `src/ui/aura_effect.ts`)
states the speed the way the Fleet Form and Ember Form lines already state theirs.

## Reasoning

- **No throughput added.** None of the four changes adds damage, a passive damage line, a
  resource rule, or a new active. Changes 1 and 2 are always-on rules explained by the
  existing Cat Form and Fleet Form tooltips, which the passive budget in
  `class-design-rules.md` prefers over a separate player-facing passive. Change 3 is a
  reword and change 4 is a learn level.
- **Row 5 stays a real decision.** Loping Stride (burst speed on any shift) and Skylark
  (cast while moving) are untouched. Wildshift loses only the Fleet Form case, the case a
  feral used least, since shifting to Fleet already means leaving the fight. It keeps its
  value as the in-combat option: break a root without leaving your damage form.
- **Nothing is made redundant.** The 15% passive multiplies whatever temporary speed buff
  the Cat wears (Loping Stride to 184%, Dash to 172.5%, and party-sourced buffs such as
  Pack Rally the same way), so each sprint keeps its full stated value over the form and
  none of them is replaced by walking around in Cat Form. Mounting strips every form, so a
  mount (175% and up) is still the travel answer; Dash is a 15 sec combat sprint on a
  60 sec cooldown, not a mount.
- **Fleet Form's escape is a trade, not a free button.** 30 mana, no cooldown, and no
  abilities while shifted: the druid is moving at +40% with nothing to press, which is the
  classic era rule scoped to one form.
- **Dash at 12.** Cat Form is learned at 4 and Fleet Form at 11. A sprint at 18 arrived
  two levels before the cap, after most of the leveling PvP was over.
- **Balance contract untouched.** No damage coefficient moves, so the v0.42 Wildfang
  multiplier and the Cinderbark set bonus contract in `class-balance-v042-results.md` are
  unaffected. That doc still lists PvP stealth burst and Cat scenarios as PBE gaps.

## Interaction to know about

Stalk's 5% stealth penalty is multiplicative, so a stealthed Cat now moves at 0.95 times
1.15 of base run speed (about 9% faster than an unstealthed caster). The Stalk tooltip's
"5% slower" is relative to Cat Form, the form Stalk requires, and stays true. The pin in
`tests/druid_spell_pack.test.ts` records the new product. Stealth itself is out of scope
here; if a stealthed Cat should not outrun a walking caster, that is a Stalk decision for
the engage and control follow up below.

## Tests

- `tests/druid_engines.test.ts`: Fleet Form strips a breakable root and slow with no
  talent selected, leaves `unbreakableControl` auras, emits one aura-lost event per
  stripped control, and does so through the real cast path; Cat Form strips nothing
  without Wildshift and both with it; Bruin and Moonwing keep the gate.
- `tests/player_motion.test.ts`: `form_cat` alone yields 1.15 from the constant (not the
  aura value); plus Dash yields 1.725 (the product, never 1.5 flat or 1.65 additive), and
  two speed buffs together still read as the strongest one times the passive; a
  party-sourced buff gets the same layer; plus a 0.5 slow yields 0.575; plus a +60%
  mount yields 1.75; and the client dep shape agrees with the live Sim on both the bare
  and the stacked case, which is what keeps the online self extrapolator in lockstep
  with the server.
- `tests/druid_form_speed_stack.test.ts`: the reported cases through the real cast path
  (Loping Stride on the shift, Dash in Cat Form, Dash plus Loping Stride, a slow on top,
  Fleet Form untouched).
- `tests/choice_rows_redesign.test.ts`: the Wildshift wording, with Loping Stride and
  Skylark pinned unchanged.
- `tests/ability_tooltip_talents.test.ts`: Dash at 12 with every other number unchanged,
  the two reworded tooltips, and the sim def and English catalog carrying one wording.
- `tests/druid_spell_pack.test.ts` and `tests/ability_tooltip_consistency.test.ts`: the
  existing learn-level and prose-number pins updated for Dash at 12 and the 15.

## Localization note

The buff-bar line is a hand-named key, so its reword followed the new-key convention:
`hudChrome.auraEffect.formCat` is retired (removed from the English catalog, its rows removed
from every overlay) and `hudChrome.auraEffect.wolfForm` replaces it, with the five non-Latin
fills (zh_CN, zh_TW, ja_JP, ko_KR, ru_RU) the M16 wordy-copy rule requires, each composed from
that locale's form name and Fleet Form speed clause at the time; the other fifteen locales
are English-filled `pending` rows for the release fill.

The Cat Form rename (the authored cat PR, which also retitled this document) reworded the
English of these rows in place: `hudChrome.auraEffect.wolfForm`,
`hudChrome.auraEffect.bruinRushWindow`, `guide.classPage.formsWolfEngage`, the Wildshift row,
and the `cat_form`, `prowl`, `pounce`, `lunge`, `hamstring_bite` and `bruin_rush` ability
descriptions. The key names and the overlay fills still carry the wolf-era wording; they are
on that PR's release-time fill list.

The three id-keyed English values keep their existing keys, since ability and talent text is
keyed by id: `entities.abilities.cat_form.description` and
`entities.abilities.travel_form.description` (English in `src/ui/i18n.catalog/abilities.ts`,
translations in the `src/ui/i18n.locales/` overlays), and the Wildshift row description
`dru_r5_improved_wrath` (English in `src/sim/content/choice_rows_classic.ts`;
the non-English retained overrides live in
`src/ui/talent_i18n.row_description_overrides.ts`). Per
`docs/i18n-scaling/translation-workflow.md` ("Rewording an existing English value"), the
overlays and the talent overrides still carry translations of the old wording and are
recorded here for the next maintainer locale pass.

## Follow up (a separate PR: engage and control, measured apart from movement)

- The Onrush to Cat rider.
- A non-stealth Slinkstrike shape.
- A combo point stun finisher.
- Rogue parity work.
