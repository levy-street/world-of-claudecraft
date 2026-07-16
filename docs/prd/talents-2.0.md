# Talents 2.0: Choice Rows

Status: DESIGN LOCKED, BUILD GREENLIT (owner, 2026-07-02). This document is
the complete build spec: structure, primitives, all 27 signatures, full row
content for all 9 classes, and the execution plan.
Research: 4-way codex fan-out over the codebase (2026-07-02, release/v0.18.0).

## Locked decisions (owner: ryan-foo)
- **Replace**, not coexist. The point trees (234 nodes, ranks, prereqs, gates)
  are scrapped. Specs, signature abilities, masteries, and loadouts remain.
- **Row levels: 5, 8, 11, 14, 17, 20.** Six choices, one every 3 levels,
  starting early so leveling feels choiceful. Spec selection stays at level 10.
- Rows are class-wide (not per-spec): 9 classes x 6 rows x 3 options = 162
  options at full rollout. Pilot: warrior + mage (36 options).
- Every option must change a decision the player makes in combat: a new
  active, a cast/playstyle transform, or a strong situational passive. A row
  where all 3 options are flat stat mods is rejected in review.
- RL env exposure: deferred (same as talents today; rows act on the env only
  through recomputed ability slots).
- Public wiki: out of scope, ignore.
- **Signatures must be real** (owner review, 2nd pass): a spec's signature
  ability must be exclusive to that spec, never an ability the class learns
  baseline. Audit found only warrior's 3 signatures are real, the other 24
  fake. Fix: mechanism (A) everywhere, a NEW grant-only classic talent spell
  per spec (Holy Shock, Combustion, Shadowform, Arcane Power, ...); no
  baseline kit demotions, nobody loses an ability they have today.
- **No spec stat trees** (recommended, confirmed direction): spec passive
  identity lives entirely in the (kept) mastery; rows are selectable skills.
  No residual point/stat tree of any kind.

---

## Part 1: Total account of the current talent system

### Shape and economy
- 9 classes, each with 26 nodes: 8 shared class-tree nodes plus 3 spec trees of
  6 nodes each. 234 nodes total.
- Node kinds: 188 passive, 36 choice (pick 1 of 3, 108 options), 10 active
  grants (plus each spec's signature ability grant).
- Rows 0..3 per tree, gated by `pointsGate` and `requires`.
- Points: `FIRST_TALENT_LEVEL = 10`, one point per level, 11 points at
  `MAX_LEVEL = 20` (`talentPointsAtLevel`, src/sim/content/talents.ts:206).
- Spec selection is separate from point spending; a spec grants its signature
  ability and a mastery effect.

### Data model and engine
- Content: `TalentNode` / `TalentEffect` in src/sim/content/talents.ts:26, data
  in talents_classic.ts and talents_warrior.ts, registered in `TALENTS`.
- `TalentEffect` has exactly four field groups: `stats` (StatModEffect),
  `grant` ({ability, rank}), `ability` (AbilityModEffect[]: dmgPct, flatDmg,
  costPct, cooldownPct, castPct, buffPct), `global` (meleeDmgPct, spellDmgPct,
  healPct, threatPct). There is NO proc or conditional effect type; every
  "proc-flavored" talent name is implemented as a static modifier.
- Player state: `TalentAllocation` {spec, ranks, choices} on `PlayerMeta`
  (src/sim/sim.ts:667), never on `Entity`.
- Hot path: `recomputeTalents` (src/sim/progression/talents.ts:54) is the ONLY
  tree walk. It bakes `TalentModifiers`, then `recalcPlayerStats`
  (src/sim/entity.ts:158) and `refreshKnownAbilities`. Combat only reads
  resolved `KnownAbility` numbers (`applyTalentMods`,
  src/sim/content/classes.ts:3581); no per-tick talent logic.
- Grants work generically: `mods.grants` feeds `abilitiesKnownAt`
  (src/sim/content/classes.ts:3611), bypassing level gates.
- Validation: `validateAllocation` (src/sim/content/talents.ts:367); changes
  blocked in combat and arena (src/sim/progression/talents.ts:63); respec free;
  `repairAllocation` (talents.ts:447) heals stale persisted builds on load.
- Determinism: talent application draws no RNG.

### UI, tooltips, i18n
- `TalentsWindow` (src/ui/talents_window.ts) renders from a pure view model
  (`buildTalentsView`, src/ui/talents_view.ts) off a staged clone of
  `IWorld.talents`; commits via loadout save/switch.
- Tooltips: `tTalent` + `effectDescription` (src/ui/talent_i18n.ts) GENERATE
  descriptions from effect data for non-English locales; English prose is
  locked to effect numbers by tests/talent_tooltip_accuracy.test.ts.
- New talent i18n cost: `titleOverrides` per non-English locale (21 languages)
  unless the name matches an ability name; descriptions are generated, but a
  NEW effect field needs `effectDescription` templates in every locale once.
- Icons are procedural with fallback for unknown ids.

### Three hosts, wire, persistence
- IWorld facet `IWorldTalents` (src/world_api/talents.ts): talents, talentSpec,
  talentRole, loadouts, activeLoadout, talentPoints(), applyTalents(),
  respec(), setSpec(), save/switch/deleteLoadout(). Sim delegates to
  progression/talents.ts; ClientWorld mirrors the `tal` heavy delta field and
  sends command frames; the server validates through the same shared sim
  module (server/game.ts:2616).
- Persistence: `CharacterState.talents/loadouts/activeLoadout` inside the
  `characters.state` JSONB, repaired on load (src/sim/sim.ts:1233). No SQL.
- Fiesta standardizes/restores talents (src/sim/social/fiesta.ts:209); delve
  augments already implement a "pick 1 of N" flow.

### The critique (why replace)
188 of 234 nodes are passive stat nudges; the 36 existing choice nodes mostly
offer "+8% X vs +5% Y". Only 10 nodes plus spec signatures change the action
bar. Many talents are filler that does not read as a decision (the operator's
own words: "a lot of the talents dont even make sense"). This is the classic
tree problem MoP's redesign answered; we answer it the same way.

---

## Part 2: Structure (build this first)

### Content model
New file `src/sim/content/choice_rows.ts` (data in per-class files or one
`choice_rows_classic.ts`, mirroring how talents_classic.ts works today):

```ts
export const CHOICE_ROW_LEVELS = [5, 8, 11, 14, 17, 20] as const;
export type ChoiceRowLevel = (typeof CHOICE_ROW_LEVELS)[number];

export interface ChoiceRowOption {
  id: string;              // globally unique, e.g. 'war_r5_heroic_leap'
  name: string;            // English; prefer == granted ability name (i18n free)
  description: string;     // English authored; non-English generated
  icon: string;
  effect: TalentEffect;    // SAME effect vocabulary as today, extended below
}

export interface ChoiceRow {
  level: ChoiceRowLevel;
  theme: string;           // dev-facing label ('mobility', 'control', ...)
  options: [ChoiceRowOption, ChoiceRowOption, ChoiceRowOption];
}

export interface ClassChoiceRows { rows: ChoiceRow[]; } // exactly 6, one per level
export const CHOICE_ROWS: Record<ClassId, ClassChoiceRows>;
```

### Allocation model (replaces ranks/choices in place)
`TalentAllocation` is EDITED, not paralleled, so every existing seam (wire
`tal` field, JSONB persistence, loadouts, fiesta, IWorld surface) is reused:

```ts
export interface TalentAllocation {
  spec: string | null;                   // unchanged
  rows: Partial<Record<ChoiceRowLevel, string>>; // level -> option id
}
```

- `validateAllocation(alloc, cls, level)`: every picked row exists for the
  class, the option id belongs to that row, `level >= row.level`, at most one
  pick per row. No points, no prereqs, no gates.
- `repairAllocation`: drops unknown/illegal picks; CRUCIALLY, old persisted
  builds with `ranks`/`choices` fields simply lose them (spec is kept), which
  is the one-time forced respec of the migration. Same for saved loadouts.
- `talentPointsAtLevel` is retired; the UI shows "picks made / rows unlocked".
- Combat/arena lock, free respec (clear rows), spec-at-10: unchanged.
- `computeTalentModifiers` folds spec mastery + signature grant + the picked
  options' effects into the SAME baked `TalentModifiers`; the hot path,
  `applyTalentMods`, `abilitiesKnownAt`, and `recalcPlayerStats` are untouched
  except for the new effect fields below.

### New sim primitives (the closed set, no generic proc engine in v1)
The pilot content is fully expressible with the existing vocabulary (grants,
ability dmg/cost/cooldown/cast/buff mods, stats, globals) plus five narrow
primitives. Each lands test-first with its own parity scenario; any new
`ctx.rng` draw is a deliberate golden regen isolated to its PR.

- **P1 interrupt** (Pummel, Counterspell): new `AbilityEffect`
  `{ type: 'interrupt'; lockout: number }`. On a casting, non-physical target:
  `cancelCast` (casting_lifecycle.ts:144) + apply the EXISTING `lockout` aura
  kind (types.ts:173, today a mob on-hit mechanic at types.ts:910) for the
  interrupted school. Emits a SimEvent for FCT/combat log. Machinery
  (school lockouts breaking matching casts) already runs in `updateCasting`.
- **P2 castWhileMoving** (Firestarter Scorch): new `AbilityModEffect` field
  `castWhileMoving?: true` baked onto `KnownAbility`. The movement cast-cancel
  (sim.ts:2763) and the cast-start movement rule consult the resolved flag.
  No RNG.
- **P3 empower-next** (Presence of Mind and friends): new one-charge
  self-aura family consumed at the next matching action. Variants: next cast
  instant (Presence of Mind, Elemental Mastery, Nature's Swiftness), next
  cast free (Inner Focus), next attack guaranteed crit (Cold Blood: the aura
  simply forces the crit roll to 100%, per owner), next summon instant
  (Fel Domination). One consumption hook at cast/attack start. No RNG.
- **P4 vs-rooted conditionals** (Ice Lance, Shatter): `isRooted`
  (src/sim/combat/cc.ts:23) already exists. Two narrow fields:
  `directDamage.vsRootedMult?: number` (Ice Lance triples on frozen) and
  `GlobalModEffect.critVsRooted?: number` (Shatter crit bonus, checked where
  crit rolls against the target). Crit roll order unchanged; only the chance
  input varies, so parity impact is content-gated.
- **P5 addEffects transform** (Warbringer: Charge also roots): new
  `AbilityModEffect` field `addEffects?: AbilityEffect[]`, appended during
  `applyTalentMods` so combat dispatch sees them as ordinary resolved effects.

Future (explicitly out of v1): generic proc triggers (onKill/onCrit), execute
threshold transforms, duration mods.

### Migration mechanics (replace)
- Delete: TalentNode rank/prereq/gate model + the 234-node content +
  `talentPointsAtLevel` + tree UI geometry. Keep: spec model, signatures,
  masteries, loadouts, all commands and wire shape (`applyTalents` now
  carries `rows`), `tal` delta field, persistence path.
- Old JSONB saves and loadouts: repaired on load to `{spec, rows: {}}`; the
  player re-picks 6 rows (free). One release note.
- Tests: talents.test.ts / talents_view.test.ts / talent_tooltip_accuracy /
  progression tests rewritten against rows; `titleOverrides` for the 234 dead
  nodes removed; localization gates re-run.
- UI: `TalentsWindow` becomes a 6-row picker (augment-offer visual language,
  one card per option, staged edits, same loadout bar); `buildTalentsView`
  replaced by a much smaller `buildChoiceRowsView` pure model. Level-up toast
  at 5/8/11/14/17/20: "New talent choice available".

### File map (from the parity research, trimmed to the replace path)
- src/sim/content/talents.ts (types + validation rewrite), choice_rows data
  files, delete talents_classic.ts/talents_warrior.ts content.
- src/sim/progression/talents.ts (apply/repair/respec against rows).
- src/sim/sim.ts (PlayerMeta/CharacterState fields, load repair, save).
- src/sim/types.ts + combat/casting_lifecycle.ts + combat/effect_dispatch.ts +
  combat/damage.ts + content/classes.ts (P1-P5).
- server/game.ts (wire normalizer for `rows`), src/net/online.ts (mirror).
- src/world_api/talents.ts (allocation type; surface otherwise unchanged).
- src/ui/talents_window.ts + new choice_rows_view.ts, talent_i18n.ts
  (manifest + effectDescription templates for P1/P2/P4/P5), game.ts chrome.
- Gates: npm test, architecture, localization_fixes, localization_coverage,
  world_api_parity, command_schema, snapshots, parity goldens, build.

### No spec stat trees: spec = signature + mastery, rows = the choices
Recommendation (accepted direction): do NOT keep any per-spec stat tree.
Reasons:
- Stat trees are exactly the filler being deleted; reintroducing a small one
  recreates the "+1% nodes that dont make sense" problem at smaller scale
  and doubles the balance surface next to 162 row options.
- Passive spec identity already has a home: the mastery (kept, and its
  numbers can be retuned in the same pass since every spec def is being
  edited for the signature fix anyway). If leveling needs more passive feel,
  scale the mastery mildly with level (e.g. mastery reaches full strength at
  20) instead of adding nodes.
- Players who want set-and-forget still get it: each row deliberately
  carries one plain-but-strong passive option.
So the whole player-facing model is: pick a spec at 10 (signature ability +
mastery), pick 1 of 3 at levels 5/8/11/14/17/20. Nothing else.

### All-27 extension (owner: 2026-07-07)

Owner extended impactful masteries to every spec. The prior PR B pass already
covered 10 specs; this follow-up updates the remaining 13. Warrior arms,
warrior fury, warrior protection, and shaman elemental were already strong
and remain unchanged.

| Spec | New mastery fields |
|---|---|
| paladin/protection | global: threatPct 0.5; stats: armorPct 0.2 |
| paladin/retribution | global: meleeDmgPct 0.2, spellDmgPct 0.2 |
| hunter/marksmanship | global: meleeDmgPct 0.2; stats: crit 0.03 |
| hunter/survival | global: meleeDmgPct 0.15; stats: agiPct 0.15 |
| mage/arcane | global: spellDmgPct 0.15, spellHastePct 0.1 |
| rogue/assassination | global: dotDmgPct 0.2; stats: crit 0.03 |
| rogue/subtlety | global: critDmgPct 0.4; stats: agiPct 0.1 |
| priest/holy | global: healPct 0.2 |
| priest/shadow | global: dotDmgPct 0.15, spellDmgPct 0.1 |
| shaman/enhancement | global: meleeHastePct 0.1, meleeDmgPct 0.1 |
| druid/balance | global: spellDmgPct 0.15, spellHastePct 0.1 |
| druid/feral | global: meleeDmgPct 0.15, dotDmgPct 0.15, threatPct 0.2 |
| warlock/destruction | global: critDmgPct 0.5; stats: crit 0.02 |

### Mastery rating readiness (owner directive 2026-07-07)

Every spec's mastery must be improvable by a FUTURE mastery stat (an item
rating like haste/crit rating; NOT implemented yet). The model, WoW-style:
each spec has exactly ONE designated scalable mastery axis; the rating
multiplies that axis's magnitude (the shipped value is the base at zero
rating); any other component of the mastery (armor, max health, the static
secondary) does NOT scale. The rating lands in a later itemization PR; this
section fixes the per-spec axis NOW so no mastery ships in a shape the
rating cannot scale. Owner exemplars: combat scales its 10% attack speed,
frost scales its 25% Frost spell damage, fire scales how much harder its
crits land.

Frost was reshaped for this (2026-07-07): its mastery is now "+25% Frost
spell damage" via ability-scoped mods on the frost kit (frostbolt,
frost_nova; ability-scoped so the mage's fire/arcane baseline spells stay
untouched) plus the static +10% armor. The crit-vs-rooted-or-chilled
identity moves to a Shatter-style row option in the flip content (the P4
machinery stays).

The designated scalable axis per spec (base value = shipped magnitude):

| Spec | Scalable axis | Base |
|---|---|---|
| warrior/arms | melee ability damage (meleeDmgPct) | 15% |
| warrior/fury | crit chance (crit) | 10% |
| warrior/prot | threat (threatPct) | 50% |
| paladin/holy | heal crit damage (critDmgPct on heals) | +50% (2x) |
| paladin/protection | threat (threatPct) | 50% |
| paladin/retribution | Holy + physical ability damage (paired meleeDmgPct + spellDmgPct, scale together) | 20% |
| hunter/beast_mastery | pet damage (petDmgPct) | 35% |
| hunter/marksmanship | physical ability damage (meleeDmgPct) | 20% |
| hunter/survival | physical ability damage (meleeDmgPct) | 15% |
| mage/arcane | spell damage (spellDmgPct) | 15% |
| mage/fire | spell crit damage (critDmgPct) | +50% (2x) |
| mage/frost | Frost spell damage (frost-kit ability dmgPct) | 25% |
| rogue/assassination | bleed damage (dotDmgPct) | 20% |
| rogue/combat | attack speed (meleeHastePct) | 10% |
| rogue/subtlety | crit damage (critDmgPct) | +40% |
| priest/discipline | shield absorb (absorbPct) | 30% |
| priest/holy | healing done (healPct) | 20% |
| priest/shadow | damage-over-time damage (dotDmgPct) | 15% |
| shaman/elemental | spell damage (spellDmgPct) | 15% |
| shaman/enhancement | attack speed (meleeHastePct) | 10% |
| shaman/restoration | heal mana efficiency (heal-kit costPct) | -20% |
| warlock/affliction | damage-over-time damage (dotDmgPct) | 20% |
| warlock/demonology | damage redirected to demon (petDmgSharePct) | 20% |
| warlock/destruction | spell crit damage (critDmgPct) | +50% (2x) |
| druid/balance | spell damage (spellDmgPct) | 15% |
| druid/feral | melee ability damage (meleeDmgPct) | 15% |
| druid/restoration | heal-over-time healing (hotHealPct) | 25% |

Implementation note for the future rating PR: the axis is a CONVENTION over
the existing mastery effect data (scale the named field, or the named
per-ability set for frost and resto shaman), applied where masteries
accumulate (the same level-scaling multiplier site in content/talents.ts).
No new SpecDef field ships until that PR needs one; do not pre-add
scaffolding.

### Spec signature fairness (audit + fix)

Audit method: a signature is REAL only if its ability id is absent from
`CLASSES[cls].abilities` (the baseline leveling kit, classes.ts:30), i.e.
reachable only through `mods.grants`. Result across all 27 specs:

- Real (grant-only): warrior arms/fury/prot (mortal_strike, bloodthirst,
  shield_slam). These are also the classic-era 31-point talents: the pattern
  to copy.
- Fake, WORTHLESS (baseline with learnLevel <= 10, already known when spec
  unlocks at 10): eviscerate (1), lightning_bolt (1), healing_wave (1),
  demon_skin (1), judgement (4), power_word_shield (6), arcane_missiles (8),
  tame_beast (10), wing_clip (10), drain_life (10), bear_form (10).
- Fake, EARLY-ACCESS ONLY (baseline learnLevel 12-20, the grant is a head
  start that evaporates by cap): flash_of_light (12), regrowth (14),
  righteous_fury (16), aimed_shot (16), scorch (16), ambush (16),
  mind_flay (16), starfire (18), ice_barrier (20), adrenaline_rush (20),
  flash_heal (20), stormstrike (20), shadowburn (20).

Fix (owner decision): mechanism (A) everywhere. Every spec gets a NEW
grant-only signature ability, preferring the classic-era spec talent spell
(matches the repo's classic-fidelity rule and the warrior precedent). The old
fake signature returns to being a plain kit ability. NO baseline kit
demotions: no existing character loses an ability they have today.

| Spec | Today (fake) | New signature (all grant-only, all NEW defs) |
|---|---|---|
| paladin/holy | flash_of_light | Holy Shock (instant heal or damage) |
| paladin/protection | righteous_fury | Holy Shield (block/absorb active) |
| paladin/retribution | judgement | Repentance (single-target incapacitate) |
| hunter/beast_mastery | tame_beast | Bestial Wrath (pet enrage active) |
| hunter/marksmanship | aimed_shot | Trueshot Aura (party ranged AP aura) |
| hunter/survival | wing_clip | Wyvern Sting (sleep sting) |
| mage/arcane | arcane_missiles | Arcane Power (+20% spell dmg active) |
| mage/fire | scorch | Combustion (next fire spells crit) |
| mage/frost | ice_barrier | Cone of Cold (instant frost cone AoE) |
| rogue/assassination | eviscerate | Cold Blood (next attack guaranteed crit) |
| rogue/combat | adrenaline_rush | Blade Flurry (strikes cleave for 12s) |
| rogue/subtlety | ambush | Hemorrhage (bleed strike) |
| priest/discipline | power_word_shield | Power Infusion (ally +spell dmg active) |
| priest/holy | flash_heal | Holy Nova (AoE heal + damage) |
| priest/shadow | mind_flay | Shadowform (form: +shadow dmg, -phys taken) |
| shaman/elemental | lightning_bolt | Elemental Mastery (next spell instant, P3) |
| shaman/enhancement | stormstrike | Shamanistic Rage (dmg reduction + mana regen) |
| shaman/restoration | healing_wave | Nature's Swiftness (next heal instant, P3) |
| warlock/affliction | drain_life | Siphon Life (DoT that heals you) |
| warlock/demonology | demon_skin | Fel Domination (next summon instant, P3) |
| warlock/destruction | shadowburn | Conflagrate (consume Immolate, instant burst) |
| druid/balance | starfire | Moonkin Form (form machinery exists) |
| druid/feral | bear_form | Feral Charge (charge machinery exists) |
| druid/restoration | regrowth | Swiftmend (consume a HoT, instant heal) |

Implementation notes (owner directives, keep these cheap):
- **Moonkin Form**: existing form machinery (bear_form) sim-side; the render
  treatment is just a translucent tint on the character, no new model.
- **Shadowform**: same form machinery; render treatment is a purplish tint.
  The tint/translucency treatment is ONE render feature (form -> tint map in
  src/render/, reading form state through IWorld) shared by Shadowform,
  Moonkin Form, and reusable later (Metamorphosis, Avenging Wrath glows).
- **Wyvern Sting**: reuses the existing gouge mechanic, i.e. the
  `incapacitate` aura kind (src/sim/combat/cc.ts:18), applied at range.
  No new CC machinery.
- **Cold Blood**: just 100% crit on the next attack (the P3 guaranteed-crit
  variant forces the existing crit roll to certainty). Nothing fancier.
- **Feral Charge**: just the charge mechanic. NOTE: druids already have
  baseline `bear_charge` at level 10 (bear-form only), so the signature is
  the any-form variant with a 1s root rider (P5), distinct id `feral_charge`.

Other notes:
- The empower-next primitive (P3) powers five signatures plus a priest row
  option: Presence of Mind, Elemental Mastery, Nature's Swiftness, Cold
  Blood, Fel Domination, Inner Focus.
- One shared narrow mechanic, consume-aura-for-instant-effect, powers both
  Swiftmend (consume HoT, heal) and Conflagrate (consume Immolate, damage).
- Soul Link (damage sharing with the demon) noted as a future demo upgrade
  if Fel Domination proves too thin; rejected for v1 on machinery cost.
- i18n: 24 new signature ability defs plus the granted actives across all
  classes each need a name and description in every locale (localization
  gates); English lands with the content, maintainer fills locales at
  release. Budget it.
- These 24 spec-def edits ride the same PR wave as the row content per class
  (the spec() defs live in the same content files being rewritten anyway).

### Phasing
Superseded by the owner's five-PR structure in Part 4: mechanics first
(PR1 casting mechanics, PR2 Flamestrike + ground targeting + conditionals),
then signature fairness under the existing system (PR3), then the dormant
row engine + UI (PR4), and only then the full 6-row tree flip (PR5).

---

## Part 2b: S2 reconciliation of the built row content (owner-directed, 2026-07-07)

The flip ships as ONE PR (the original PR5 shape): the row engine (S1) plus
the 54 rows / 162 options (S2) together, since a dormant engine has no
player value and every extra PR pays the fork-CI approval tax. The engine
lands and is fully gated INSIDE the PR before the content commits stack on
it. The content source is the BUILT rows on feature/talents-2-0-fun-pass
(choice_rows_classic.ts, 162 options), reconciled against the shipped
#1543 base by the four rules below. This section is the reconciliation:
apply it verbatim when porting.

### Rule 1: no row option may grant a spec signature (3 hits, replacements)

Rows are class-wide; granting one spec's signature to the other two specs
destroys signature identity. The three offenders and their replacements
(each keeps the row's theme and the "changes a combat decision" bar):

- war_r14_mortal_strike (granted mortal_strike, the arms signature).
  REPLACE: "Crippling Blows" [mod]: Bladed Gyre (whirlwind) also applies
  the hamstring slow to everything it hits (addEffects, P5 machinery).
  Keeps the r14 damage-row theme without touching the signature.
- pal_r14_crusader_strike (granted crusader_strike, the ret signature).
  REPLACE: "Swift Verdicts" [mod]: Verdict (judgement) cooldown -40% and
  cost -20%. Plain-but-strong, per the one-plain-option-per-row rule.
- wlk_r20_metamorphosis (granted metamorphosis, the demonology signature).
  REPLACE: "Grimoire of Haste" [mod]: your demon gains +20% attack speed
  and +10% damage (pet buff vocabulary from the Dread Aspect rework).

### Rule 2: names adopt the LOCKED NAME-MAP coinages (42 hits, pure lookup)

Every denylisted option name already has a locked replacement in
ip-refactor/NAME-MAP.md; no fresh coinage is needed or allowed:

Amplify Curse=Deepened Hex, Ancestral Guidance=Guiding Spirits,
Ardent Defender=Deathless Ardor, Bane=Hastened Doom,
Berserker Rage=Seething Fury, Concussion=Fault Line,
Demonic Resilience=Unyielding Pact, Desperate Prayer=Last Prayer,
Deterrence=Bristleguard, Efficiency=Lean Quiver,
Elemental Fury=Earthen Fury, Fel Concentration=Unbroken Focus,
Ferocity=Redmaw, Furor=Wildsurge, Improved Corruption=Improved Blackrot,
Improved Fortitude=Improved Litany of Resolve,
Improved Ghost Wolf=Improved Shadewolf, Improved Gouge=Improved Eye Jab,
Improved Life Tap=Improved Hard Bargain,
Improved Lightning Shield=Improved Thunder Ward,
Improved Renew=Improved Lingering Grace, Improved Wrath=Improved Wildbolt,
Inner Focus=Stilled Mind, Innervate=Lifesap, Last Stand=Eleventh Hour,
Meditation=Nocturns, Metamorphosis=Dread Aspect (option replaced anyway,
Rule 1), Mortal Strike=Maiming Strike (option replaced anyway, Rule 1),
Permafrost=Deep Rime, Preparation=Contingency,
Presence of Mind=Racing Mind, Relentless Strikes=Ceaseless Cuts,
Ruin=Desolation, Seal Fate=Final Notice, Shadow Mastery=Umbral Mastery,
Shadowstep=Shadeslip, Shatter=Brittlebreak (COLLISION, see Rule 4),
Silence=Silent Treatment, Survival Instincts=Deathless Will,
Thick Hide=Calloused Hide, Vampiric Embrace=Leeching Dirge,
Whirlwind=Bladed Gyre.

Granted NEW ability defs in the rows (glaive_toss, kill_shot,
roll_the_bones, sw_death, drain_soul, tigers_fury, ...) are NOT on the
denylist scanner but MUST NOT ship verbatim WoW names either (the scanner
gap): coin each in the NAME-MAP voice at port time and extend the map.

### Rule 3: retune against the shipped masteries (numbers)

The fun-pass rows were tuned against the interim flat masteries
(+15-25% everywhere). The shipped identity masteries are similar in
effective magnitude, and an axis-overlap scan of all 162 options found
ZERO options stacking a class's designated mastery-rating axis through
global fields, so the bulk of the numbers stand. The specific retunes:

- No row option may add to its class's designated mastery axis (the
  Mastery rating readiness table above): the future rating must be the
  only way to scale that axis. Enforce in review at port time; the S2 port
  adds a guard test mirroring the axis scan.
- mag frost rows: the crit-vs-rooted/chilled identity moves here (the
  Shatter-style option), since the frost mastery is now Frost-kit damage.
  Option effect: critVsRooted 0.15 (the P4 machinery is live and unused).
- Permafrost (now Deep Rime): keep the fun-pass PRD's crank verdict
  (chill slow 0.4 to 2.0 equivalent, re-expressed against current chill
  values at port time).
- rogue combat rows: any flat melee-damage option is fine (the mastery
  axis is attack SPEED); an attack-speed option is NOT (axis overlap).
  The fun-pass rows have none; keep it that way.
- resto shaman rows: mana-cost options must not stack the heal-kit
  costPct axis; throughput or utility options only.
- The caster school-band starting values (open question at the bottom of
  the fun-pass PRD) are now ANSWERED by the mastery axes: a school-band
  row option is allowed only for schools OFF the spec's axis (e.g. a fire
  mage frost-utility band), never amplifying the axis school.

### Rule 4: display-name collisions to resolve at port time

- "Brittlebreak" is BOTH the frost mastery name and the map's locked
  rename for the Shatter talent. The mastery keeps it (shipped); the
  Shatter-style row option needs a distinct name: use "Deep Rime" for the
  chill option and coin the crit-vs-controlled option fresh in the map
  voice at port time (extend the NAME-MAP with the new row).
- "Gloamveil" is the shadow mastery AND the map's Shadowform rename; the
  ability shipped as "Gloamveil Form" (#1543). Row options referencing the
  form use "Gloamveil Form".
- The 5 ground spells (Flamestrike, Rain of Fire, Volley, Hurricane,
  Earthquake) are baseline since #1064; the built rows already replaced
  their old option slots, verify no regression at port.

## Part 3: Row content, all 9 classes (fable draft, numbers illustrative;
warrior + mage are the pilot and land first)

Notation: [grant NEW] = new ability definition in classes.ts; [grant] =
existing ability id; [P#] = uses primitive above; [mod] = existing vocabulary.
Every granted ability's option name matches the ability name (i18n free).

### Warrior (kit: charge, heroic_strike, rend, thunder_clap, hamstring,
bloodrage, overpower, execute, slam, cleave, defensive_stance, sunder_armor,
taunt, shouts; signatures mortal_strike/bloodthirst/shield_slam; the old tree
grants whirlwind and berserker_rage return as row options)

- **L5 Onslaught (openers/mobility)**
  1. Juggernaut [mod]: Charge cooldown -50%. You open with it on cooldown.
  2. Heroic Leap [grant NEW]: leap to a ground target, small AoE damage,
     20s cd. Uses the existing ground-target mechanic.
  3. Warbringer [P5]: Charge also roots the target for 1.5s.
- **L8 Warcraft (control)**
  1. Pummel [grant NEW, P1]: interrupt, 4s school lockout, 10s cd, costs 10
     rage. The warrior becomes a caster answer.
  2. Concussive Clap [P5]: Thunder Clap also roots targets hit for 1s.
  3. Crippling Strikes [mod]: Hamstring costs 66% less. Kiting/peeling kit.
- **L11 Bloodlust (resource/sustain)**
  1. Berserker Rage [grant]: the old tree capstone, now a choice.
  2. Furious Bloodrage [mod]: Bloodrage cooldown -50%, its rage gain +50%.
  3. Commanding Presence [mod]: Battle Shout and Commanding Shout effects
     +50% (buffPct). The group-utility pick.
- **L14 Arms Master (throughput identity)**
  1. Mortal Strike [grant + mod]: grants Mortal Strike; if you already know
     it (Arms), its damage +15%. (The operator's explicit ask: MS via talent.)
  2. Whirlwind [grant]: the old Fury tree grant, now anyone's AoE pick.
  3. Executioner [mod]: Execute costs 50% less and deals +20%. You fish for
     execute windows.
- **L17 Bulwark (survival)**
  1. Shield Wall [grant NEW]: -50% damage taken for 10s, 3min cd.
  2. Last Stand [grant NEW]: +30% max HP for 15s (heals the added amount),
     3min cd.
  3. Iron Hide [mod]: armor +12%, always on. The passive pick.
- **L20 Avatar (capstone)**
  1. Bladestorm [grant NEW]: 4s channel, whirlwind damage every tick, immune
     to roots while channeling. Channel + AoE machinery exists.
  2. Avatar [grant NEW]: +20% damage and root immunity for 20s, 3min cd.
  3. Rallying Cry [grant NEW]: party gains +15% max HP for 10s, 3min cd.

### Mage (kit: fireball, frostbolt, fire_blast, arcane_missiles, polymorph,
frost_nova, arcane_explosion, scorch, pyroblast, ice_barrier, armors,
conjures; signatures arcane_missiles/scorch/ice_barrier; old tree grant
frost_nova is baseline here since Frost Nova is already in the kit)

- **L5 Spellcraft (playstyle)**
  1. Firestarter [P2]: Scorch is castable while moving. (The operator's
     explicit ask; scorch is the Fire signature, so this is the fire-mage
     movement kit.)
  2. Impulse [mod]: Fire Blast cooldown -50%. Instant-weaving on the run.
  3. Mana Attunement [mod]: all spell costs -10%. The plain-but-real pick.
- **L8 Counterplay (control)**
  1. Counterspell [grant NEW, P1]: interrupt, 6s school lockout, 24s cd,
     instant. (The operator's explicit ask: interrupts via talents.)
  2. Ice Nova [mod]: Frost Nova cooldown -40% and damage +50%.
  3. Quick Wits [mod]: Polymorph cast time -50%. CC actually lands mid-fight.
- **L11 Shatter (the freeze package, the operator's explicit ask)**
  1. Ice Lance [grant NEW, P4]: instant, cheap, deals 3x damage to rooted
     (frozen) targets. Nova -> Lance becomes a combo.
  2. Shatter [P4]: +30% crit chance against rooted targets. Nova -> Frostbolt
     crit fishing.
  3. Permafrost [mod]: Ice Barrier absorbs +40%. The defensive frost pick
     (Ice Barrier stays baseline for all mages, so this is live for anyone).
- **L14 Tempo**
  1. Presence of Mind [grant NEW, P3]: next spell with a cast time is
     instant, 60s cd. (The operator's explicit ask.) Instant Pyroblast.
  2. Hot Streak [mod]: Pyroblast cast time -50%. The sustained version.
  3. Netherwind [P2]: Arcane Missiles are channelable while moving. (Was
     "Arcane Power" until that became the arcane signature.)
- **L17 Survival**
  1. Blink [grant NEW]: teleport 15yd forward, breaks roots, 15s cd.
  2. Ice Block [grant NEW]: immune to all damage 8s, cannot act, 4min cd.
  3. Battlemage Armor [mod]: armor +10%, max HP +5%. The passive pick.
- **L20 Capstone**
  1. Deep Freeze [grant NEW]: stun a rooted target 4s + heavy damage, 30s cd.
     Completes the freeze package (stun auras exist).
  2. Meteor [grant NEW]: big ground-target AoE nuke + burn DoT, 45s cd.
  3. Evocation [grant NEW]: 6s channel restoring 40% mana, 2min cd.

### The remaining 7 classes (draft v1, numbers illustrative, same notation)

Cross-class rule: every class gets exactly one interrupt-family OPTION (not
baseline), so bringing the interrupt is a build decision. Kits below were
extracted from classes.ts with learn levels; nothing references an ability
that does not exist unless marked [grant NEW].

**Paladin** (kit: seals, holy_light, devotion_aura, judgement,
blessing_of_might, divine_protection, hammer_of_justice, lay_on_hands,
flash_of_light, exorcism, consecration, righteous_fury, retribution_aura)
- L5: Crusader's Zeal [mod] (Judgement cd -40%) / Blessed Momentum [P2]
  (Holy Light castable while moving) / Vengeful Exorcism [mod]
  (Exorcism dmg +25%, cost -25%)
- L8: Rebuke [grant NEW, P1] (interrupt, 4s lockout, 12s cd) /
  Fist of Justice [mod] (Hammer of Justice cd -40%) /
  Consecrated Ground [mod] (Consecration dmg +30%, cost -30%)
- L11: Divine Wisdom [mod] (heals cost -15%) / Guardian's Favor [mod]
  (Divine Protection and Lay on Hands cd -33%) / Greater Blessing [mod]
  (Blessing of Might effect +50%)
- L14: Crusader Strike [grant NEW] (instant strike, 6s cd) /
  Holy Wrath [grant NEW] (AoE holy nuke, 20s cd) /
  Righteous Cause [mod] (Seal and Judgement dmg +15%)
- L17: Divine Shield [grant NEW] (full immunity 8s, cannot attack, 5min cd) /
  Sacred Ward [mod] (Devotion Aura +50%, Lay on Hands +30%) /
  Ardent Defender [stats] (armor +10%, max HP +8%, the plain pick)
- L20: Avenging Wrath [grant NEW] (+20% dmg and healing 20s, 3min cd; gold
  tint via the form-tint render feature) / Hammer of Wrath [grant NEW]
  (ranged holy execute below 20% HP) / Aura Mastery [mod] (auras +60%)

**Hunter** (kit: raptor_strike, aspect_of_the_hawk/monkey/cheetah,
serpent_sting, arcane_shot, concussive_shot, mongoose_bite, wing_clip,
aimed_shot, rapid_fire, tame/dismiss/revive pet)
- L5: Improved Serpent Sting [mod] (+30%) / Quick Shots [mod]
  (Arcane Shot cd -40%) / Aspect Mastery [mod] (Hawk and Monkey +40%)
- L8: Counter Shot [grant NEW, P1] (interrupt shot, 4s lockout, 20s cd; the
  operator's original example) / Frost Trap [grant NEW] (ground trap, roots
  3s) / Improved Concussive [mod] (Concussive Shot cd -40%)
- L11: Mend Pet [grant NEW] (channel pet heal; reuses the warlock demon-heal
  channel machinery) / Efficiency [mod] (shots cost -15%) /
  Feign Death [grant NEW] (threat wipe, 30s cd)
- L14: Multi-Shot [grant NEW] (hits up to 3 targets) / Sniper Training [mod]
  (Aimed Shot cast -30%, dmg +10%) / Serpent's Venom [P5]
  (Arcane Shot also applies a short sting DoT)
- L17: Deterrence [grant NEW] (+50% dodge 10s, 2min cd) / Master Tamer [mod]
  (Tame Beast and Revive Pet cast -50%) / Thick Hide [stats]
  (armor +10%, dodge +2%, the plain pick)
- L20: Improved Volley [mod] (Volley damage +30%, cost -20%; Volley is
  baseline via PR #1064) / Rapid Killing [mod] (Rapid Fire cd -50%, effect
  +25%) / Aspect of the Wild [grant NEW] (party nature-flavored AP aura)

**Rogue** (kit: sinister_strike, eviscerate, backstab, gouge, evasion,
slice_and_dice, sprint, kidney_shot, ambush, stealth, garrote, cheap_shot,
sap, poisons, expose_armor, rupture, vanish, blind, adrenaline_rush)
- L5: Relentless Strikes [mod] (Sinister Strike cost -20%) /
  Improved Backstab [mod] (+25%) / Opportunist [mod]
  (Ambush and Garrote +25%)
- L8: Kick [grant NEW, P1] (interrupt, 4s lockout, 10s cd) /
  Improved Gouge [mod] (cd -30%, cost -30%) / Improved Kidney Shot [mod]
  (cost -25%)
- L11: Preparation [grant NEW] (resets Sprint/Evasion/Vanish cooldowns,
  5min cd; one narrow cooldown-reset mechanic) / Endurance [mod]
  (Sprint and Evasion cd -30%) / Improved Slice and Dice [mod] (effect +25%)
- L14: Seal Fate [mod] (Eviscerate and Rupture +20%) /
  Ghostly Strike [grant NEW] (strike + brief dodge buff) /
  Deadly Brew [mod] (poisons +30%)
- L17: Cloak of Shadows [grant NEW] (-75% spell damage taken 5s, 90s cd;
  reuses the Shield Wall damage-taken-reduction aura) / Improved Evasion
  [mod] (effect +30%, cd -20%) / Cheat Death [stats]
  (max HP +10%, dodge +3%, the plain pick)
- L20: Shadowstep [grant NEW] (teleport behind target, 24s cd; Blink tech) /
  Adrenaline Junkie [mod] (Adrenaline Rush cd -40%) /
  Master Assassin [stats] (crit +5%, the plain-strong pick)

**Priest** (kit: smite, lesser_heal, power_word_fortitude,
shadow_word_pain, power_word_shield, renew, mind_blast, heal, mind_flay,
flash_heal)
- L5: Searing Light [mod] (Smite +25%) / Improved Renew [mod] (+25%) /
  Twisted Faith [mod] (Shadow Word: Pain +20%)
- L8: Silence [grant NEW] (4s silence, 30s cd; silence auras exist, this is
  the priest interrupt-equivalent) / Psychic Scream [grant NEW]
  (AoE fear 4s; fear machinery exists) / Improved Shield [mod]
  (Power Word: Shield absorb +25%)
- L11: Inner Focus [grant NEW, P3] (next spell costs 0 mana) /
  Meditation [mod] (heals cost -15%) / Vampiric Embrace [P5]
  (Mind Blast also heals you for 30% of its damage)
- L14: Mind Melt [mod] (Mind Blast cd -40%) / Greater Heal [mod]
  (Heal +25%, cast -15%) / Pain and Suffering [mod]
  (Shadow Word: Pain and Mind Flay +15%)
- L17: Desperate Prayer [grant NEW] (instant self-heal, 90s cd) /
  Improved Fortitude [mod] (Power Word: Fortitude +50%) /
  Inner Fire [stats] (armor +10%, spirit +3, the plain pick)
- L20: Prayer of Healing [grant NEW] (party AoE heal) /
  Mind Sear [grant NEW] (AoE shadow channel) / Blessed Recovery [mod]
  (Flash Heal cast -25%, cost -25%)

**Shaman** (kit: lightning_bolt, rockbiter/flametongue/frostbrand imbues,
healing_wave, earth_shock, lightning_shield, flame_shock, frost_shock,
ghost_wolf, stormstrike)
- L5: Concussion [mod] (Lightning Bolt +15%) / Improved Lightning Shield
  [mod] (+40%) / Imbue Mastery [mod] (weapon imbues +30%)
- L8: Improved Earth Shock [P5 + P1] (Earth Shock also interrupts, 2s
  lockout; the classic shaman interrupt as a build choice) /
  Frost Bind [P5] (Frost Shock also roots 1s) / Shock Efficiency [mod]
  (all shocks cost -20%)
- L11: Ancestral Guidance [mod] (Healing Wave cast -20%) /
  Elemental Attunement [mod] (Lightning Bolt cost -20%) /
  Healing Stream [grant NEW] (a HoT; hot effect exists)
- L14: Chain Lightning [grant NEW] (hits up to 3 targets) /
  Improved Flame Shock [mod] (+30%) / Weapon Fury [stats] (AP +10%)
- L17: Earthbind [grant NEW] (AoE root 2s around you) /
  Improved Ghost Wolf [mod] (Ghost Wolf instant) /
  Elemental Warding [stats] (armor +8%, max HP +8%, the plain pick)
- L20: Bloodlust [grant NEW] (party haste 15s, 5min cd; reuses the Slice
  and Dice haste-aura machinery) / Elemental Fury [stats] (crit +5%) /
  Tidal Waves [mod] (Healing Wave +20%, cost -10%)

**Warlock** (kit: shadow_bolt, demon_skin, immolate, corruption, life_tap,
curse_of_agony, drain_life, fear, searing_pain, shadowburn, summons)
- L5: Bane [mod] (Shadow Bolt cast -20%; the properly balanced cast
  reduction the operator asked for) / Improved Corruption [mod]
  (Corruption instant; the classic five-rank talent as one choice) /
  Improved Immolate [mod] (+25%)
- L8: Spell Lock [grant NEW, P1] (interrupt, 5s lockout, 24s cd; felhunter
  flavor) / Howl of Terror [grant NEW] (AoE fear 3s) /
  Curse of Exhaustion [grant NEW] (30% move slow; chill machinery)
- L11: Improved Life Tap [mod] (+30%) / Fel Concentration [mod]
  (Drain Life +25%) / Demon Armor [mod] (Demon Skin +40%)
- L14: Amplify Curse [mod] (Curse of Agony +25%) / Ruin [mod]
  (Searing Pain and Shadowburn +20%) / Shadow Mastery [global]
  (spell damage +6%, the plain-strong pick)
- L17: Death Coil [grant NEW] (instant horror that heals you) /
  Improved Fear [mod] (Fear cast -30%) / Demonic Resilience [stats]
  (max HP +10%, the plain pick)
- L20: Chaos Bolt [grant NEW] (huge fire nuke) / Metamorphosis [grant NEW]
  (+armor +damage form 20s; form machinery + demon tint via the form-tint
  render feature) / Curse Mastery [mod]
  (Corruption and Curse of Agony +20%)

**Druid** (kit: wrath, healing_touch, mark_of_the_wild, moonfire,
rejuvenation, thorns, entangling_roots, bear_form + bear kit, cat_form +
cat kit, regrowth, barkskin, starfire, travel_form, faerie_fire, hibernate,
insect_swarm, and more; the largest kit, 31 abilities)
- L5: Improved Wrath [mod] (cast -20%) / Ferocity [mod]
  (Claw and Rake cost -20%) / Nature's Bounty [mod] (Rejuvenation +25%)
- L8: Skull Bash [grant NEW, P1] (interrupt, 15s cd, usable in forms) /
  Improved Roots [mod] (Entangling Roots cost -30%, cast -30%) /
  Brutal Bash [mod] (Bash cd -30%)
- L11: Innervate [grant NEW] (restore 30% mana over 10s, 3min cd) /
  Furor [mod] (form shifts cost -50%) / Improved Mark [mod]
  (Mark of the Wild +40%)
- L14: Savage Fury [mod] (Ferocious Bite and Rip +20%) / Moonfury [mod]
  (Starfire and Moonfire +15%) / Empowered Touch [mod]
  (Healing Touch +20%, cast -10%)
- L17: Improved Barkskin [mod] (effect +40%, cd -25%) /
  Frenzied Regeneration [grant NEW] (bear heal over 10s) /
  Survival of the Fittest [stats] (armor +10%, max HP +5%, the plain pick)
- L20: Improved Hurricane [mod] (Hurricane damage +30%, cost -20%; Hurricane
  is baseline via PR #1064) / Berserk [grant NEW] (+30% melee damage 15s,
  3min cd) / Tranquility [grant NEW] (channeled party heal)

---

## Part 4: Execution plan, FIVE PHASED PRs (owner directive)

Structure (owner): mechanics land first, each PR is standalone-shippable and
valuable on its own, and only PR5 turns on the 6-row choice tree. Per the
repo's model-routing policy: fable-5 owns design, taste, and final review of
every diff; gpt-5.5 (via `codex exec`) implements the well-specified slices.
Build in the clean worktree, branch `feature/talents-2-0` (or one branch per
PR stacked on the release base). Every PR lands green on the full gate list
before the next starts.

**PR1: casting mechanics (interrupt, empower-next, cast-while-moving).**
- P1 interrupt effect (reuses the existing school-lockout aura kind),
  P3 empower-next aura family (instant / free / guaranteed-crit / summon
  variants), P2 castWhileMoving flag.
- All content-unused by players, so parity goldens must NOT change.
- Optional garnish for standalone value: give 1-2 existing dungeon caster
  mobs an interrupt cast so players feel the mechanic as counterplay.
- Tests: tests/talent_primitives.test.ts (cancel + lockout semantics,
  one-charge consumption, rng-draw-count invariance of guaranteed crit).
- Reviewed decisions carried forward to the content PRs:
  - The dedicated interrupt SimEvent (FCT "Interrupted!", combat-log
    attribution) lands with the first player-facing interrupt (PR3 or PR5),
    not in PR1; until then cancelCast's castStop + the aura event suffice.
  - Interrupt ABILITIES must be physical school (Pummel/Kick/Counter Shot
    pattern): a non-physical targeted ability rides the projectile+resist
    path and lands too late to be a reliable interrupt. Counterspell/Spell
    Lock are defined as school 'physical' mechanically (arcane/shadow visual
    only) or the projectile path gets an instant flag later.
  - Parity scenarios exercising the new rng-visible behavior ride the first
    content PR that uses each primitive (content-unused primitives provably
    leave goldens untouched, which PR1's gate asserts directly).
  - A next_cast_free charge consumed by queueing an on-next-swing ability is
    NOT refunded if the queue is toggled off or the swing never lands; a
    charge consumed at cast completion is lost on a resist (matches classic
    mana-on-resist semantics). Both are accepted, documented semantics.
  - Interrupt effects add no threat/combat entry by themselves; interrupt
    content should pair the effect with a strike or add threat explicitly.

**PR2: targeted and conditional effects. STATUS: split and largely done.**
- Ground targeting is carried by the pre-existing PR #1064 (ground-targeted
  casting + Flamestrike/Rain of Fire/Volley/Hurricane/Earthquake as baseline
  spells, full i18n, server-clamped targetMode 'position', IWorld
  castAbilityAt). Rebased onto the current release base 2026-07-02, ratchet
  pins bumped, 278 tests green, and functionally validated in the live
  client by scripts/ground_target_flamestrike_shot.mjs (zone clamps to range
  along the aim line, mob takes zone damage). Later row/capstone abilities
  (Meteor, Frost Trap, Heroic Leap, Earthbind) reuse targetMode 'position'.
- CONTENT FALLOUT of #1064 on Part 3: Volley (hunter) and Hurricane (druid)
  become BASELINE spells, so their L20 row options are replaced (see Part 3;
  a row must never grant an ability the class already has).
- P4 vs-rooted conditionals (vsRootedMult on directDamage, critVsRooted
  global via the playerMods accessor) and P5 addEffects transform: DONE,
  content-unused, on branch feature/talents-2-0-pr2 (stacked on PR1 #1305;
  its PR opens when #1305 lands). Goldens untouched.

**PR3: signature fairness (real spec spells under the EXISTING system).**
- The 24 new grant-only signature abilities from the table above (Holy
  Shock, Combustion, Shadowform, Arcane Power, Cone of Cold, Cold Blood,
  Conflagrate, Swiftmend, ...), wired as spec signatures in the CURRENT
  talents 1.0 spec defs. Old fake signatures return to plain kit abilities.
- Carries the shared narrow mechanics these spells need: consume-aura
  (Swiftmend/Conflagrate), incapacitate-at-range (Wyvern Sting via gouge
  mechanic), feral_charge (charge reuse + root rider, distinct from
  baseline bear_charge), and the render form-tint feature (translucent
  Moonkin, purple Shadowform; one form -> tint map in src/render/).
- Standalone value: picking a spec grants a REAL new spell from day one,
  before rows even exist. Biggest i18n chunk (24 ability defs).
- Several signatures exercise PR1/PR2 primitives (Cold Blood -> P3 crit,
  Elemental Mastery / Nature's Swiftness / Fel Domination -> P3 variants),
  proving them in production before the tree flip.

**PR4: the row engine and UI, dormant.**
- Row content model (CHOICE_ROW_LEVELS, ChoiceRow types), TalentAllocation
  gains `rows` (ranks/choices remain temporarily for back-compat),
  validation/repair for rows, progression layer, wire normalizer + mirror +
  snapshot delta, persistence round-trip, and the row picker UI + view
  model + level-up toasts.
- DORMANT: every class's row list is empty, so the window keeps showing the
  old trees and nothing player-visible changes. Engine is fully tested
  against fixture content (world_api_parity, command_schema, snapshots,
  view-model, a11y).

**PR5: the tree flip (full 6-row content, old trees deleted).**
- All 54 rows / 162 options from Part 3 (warrior + mage reviewed first
  within the PR, then the other 7), their granted actives, tooltip accuracy
  tests, row i18n manifest.
- Delete the point trees: 234 nodes, ranks/prereqs/gates model,
  talentPointsAtLevel, tree UI geometry, dead tests and titleOverrides.
- `TalentAllocation` drops ranks/choices for good; persisted saves and
  loadouts repair to `{spec, rows}` (free re-pick), release note.
- Full gate sweep + npm run build + golden regen as needed.

Review gate on every PR: fresh coverage-review subagent over the diff, then
fable pass/fail. Checks: npx vitest run <slice tests>, architecture test,
S3 i18n guard (tests/localization_fixes.test.ts), parity goldens, and
npm run build on PR4/PR5.
