# Hunter, Shaman, and Priest v0.28.0 Spell Implementation Plan

> Review companion: use the standalone
> [Talents 2.0 class design lab](../../prototypes/talents-v028/index.html) for a mobile-first comparison
> of all nine specializations. This document and the linked class PRDs remain authoritative.

Status: owner implementation plan; Shaman slice approved, Hunter and Priest pending
Owner: Ryze
Target: `release/v0.28.0`, then the assigned PBE wave for each class

## Base and relationship to PR #2163

This work is based on `release/v0.28.0` after PR #2163. The release branch contains merge commit
`32415eb61509113731633b51f396c7c3c2dae222`, and this implementation branch descends from it.

PR #2163 remains the passive specialization power floor. This program does not fold new spells,
rotation mechanics, procs, or talent rows into `SPEC_BASELINES`. The layers remain:

1. PR #2163 automatic passive restoration.
2. Existing specialization mastery.
3. Spec-specific spell kit and rotation mechanics from this program.
4. Class-wide Talents 2.0 choices.

The class redesign is a large content feature. Gameplay slices require approval from Levy or
Fernando before implementation and must pass through the listed PBE waves. Documentation and
fail-first test scaffolding may land independently.

The Shaman gameplay slice is approved by Levy as of 2026-07-20 and targets PBE Wave A. Hunter and
Priest gameplay slices still require their own explicit approval before implementation.

## Non-negotiable implementation rules

- New rotational spells are available only to their owning specialization.
- Shared class utility stays shared unless the class design explicitly changes it.
- A wrong-spec character cannot know, cast, place, or retain a spec-exclusive action.
- Respecializing removes old actions, auras, banks, links, guardians, weapon postures, and
  action-bar references before the new kit becomes active.
- Shipped internal ability ids remain stable. A display-name change edits the player-facing name
  and localization, not the id stored in character data.
- Existing abilities use `AbilityDef.specs` or `excludeSpecs` instead of a parallel gating system.
- A signature remains a `SpecDef.signature` grant. Other spec actions stay in the class ability
  list with an explicit `specs` gate and their real learn level.
- A shipped level 1 to 4 starter that hands off at specialization unlock uses `excludeSpecs` with
  `excludeSpecsAtLevel`, so the pre-specialization character is not left without a starter action.
- No new resource bar is added. Ferocity, Momentum, Thunder charges, Stormcast, Mending Currents,
  Doctrine, angels, Effigies, and Gloomtithe use auras or owner-scoped state.
- New behavior lives in small system modules behind `SimContext`. Declarative ability records stay
  in `src/sim/content/classes.ts`.
- Every actionable state has a persistent action, aura, party-frame, or target cue that works on
  mobile, reduced motion, and low graphics settings.

## Player-facing name and ownership matrix

Retail-shaped terminology may remain in internal ids for save compatibility. It must not be the
new player-facing name.

### Hunter

| Player-facing action or state | Internal strategy | Owner |
|---|---|---|
| Pack Command | New `pack_command` ability, spec gated | Packlord |
| Pack Ferocity | New Hunter-owned aura; pet scale, tint, and effects derive from it | Packlord |
| Unleash Beast | Pack Command action replacement at full Ferocity | Packlord |
| Howling Rage | Reuse shipped `bestial_wrath` id and signature grant | Packlord |
| Measured Shot | New `measured_shot` Focus generator | Coldsight |
| Long Draw | Reuse shipped `aimed_shot` id and add the Coldsight gate | Coldsight |
| Fevered Draw | Reuse shipped `rapid_fire` id and add the Coldsight gate | Coldsight |
| Cold Focus | New offensive cooldown and Coldsight signature | Coldsight |
| Bloodhook | New gap-closing bleed action and Fieldcraft signature | Fieldcraft |
| Gutting Strike | Reuse shipped `raptor_strike` id, then hand it off to Fieldcraft at level 5 | Fieldcraft after level 5 |
| Woundrend | Reuse shipped `mongoose_bite` id, remove its dodge requirement, and add the Fieldcraft gate | Fieldcraft |
| Shrapnel Charge | New target-centered explosive action | Fieldcraft |
| Bloodtrail Assault | New specialization cooldown | Fieldcraft |

Hunter pet care, Fell Shot, Rattling Shot, Fettering Slash, Hushing Shot, guises, Trailbreak,
Shellskin, Wildheart, and Frostjaw Trap remain shared.

Unleash Beast needs one reusable action-replacement seam. The hotbar slot keeps the Pack Command
binding while its resolved name, tooltip, icon state, and cast behavior change at full Ferocity.
This seam lands separately and cannot contain Packlord-specific tuning.

### Shaman

| Player-facing action or state | Internal strategy | Owner |
|---|---|---|
| Pyrebrand Weapon | Reuse `flametongue_weapon` and add the Thundercall gate | Thundercall |
| Thunder charges | New owner aura, separate from defensive Thunder Ward charges | Thundercall |
| Faultwake | Reuse `earthquake`, rename its display, and add the Thundercall gate | Thundercall |
| Primal Mastery | Reuse `elemental_mastery` and its signature grant | Thundercall |
| Galeheart Weapon | New enhancement ability and deterministic cadence | Warspirit |
| One-handed dual wield | Extend the existing spec-gated equipment permission and auto-attack cadence | Warspirit |
| Stonebound Weapon | Reuse `rockbiter_weapon`, then hand it off to Warspirit at level 5 | Warspirit after level 5 |
| Ancestral Strike | Reuse `stormstrike` and its signature grant | Warspirit |
| Stormcast | New owner aura earned by the melee cadence | Warspirit |
| Lifespring Weapon | New spec-gated enhancement ability | Spiritmend |
| Mending Current | New owner-scoped healing pool on each prepared ally | Spiritmend |
| Tidecall | New instant pool-building heal | Spiritmend |
| Cascading Mend | Reuse `chain_heal`, rename its display, and retain the signature grant | Spiritmend |

Arc Bolt, Mending Waters, Earthen Jolt, Cinder Jolt, Rime Jolt, Thunder Ward, and Shadewolf remain
shared. Rimebound Weapon is retired from new acquisition but its shipped id remains defined.

### Priest

| Player-facing action or state | Internal strategy | Owner |
|---|---|---|
| Scouring Mercy | New damage-or-heal signature | Doctrine |
| Doctrine link | New owner-scoped mark on one protected ally | Doctrine |
| Choirmend | New spec-gated large group heal | Benison |
| Sunburst Canticle | Reuse `holy_nova`, rename its display, and add the Benison gate | Benison |
| Seraphic Vigil | New attached angel signature | Benison |
| Effigy | New owner-scoped primary enemy link | Vespers |
| Gloomtithe | New five-stack owner aura | Vespers |
| Tithefiend | New autonomous temporary guardian and Vespers signature | Vespers |
| Gloamveil | Reuse `shadowform` as a Vespers-only form action | Vespers |

Scouring Hymn, the direct prayers, Psalm of Warding, Dirge of Decay, Mindfracture, and Litany of
Woe remain the starting shared Priest backbone. Their Doctrine, Benison, and Vespers riders are
spec gated even when the underlying spell remains shared. PBE may later narrow the shared damage
and healing kit, but that is a separate action-bar pruning decision.

## Implementation slices

Each slice is independently reviewable. No class loses a shipped action until its replacement is
present in the same slice.

### Slice 0: design, naming, and fail-first ownership matrix

- Land the class and specialization PRDs.
- Add the table-driven spec-kit test with the expected exclusive actions.
- Record the fail-before output against the release base.
- Do not change gameplay.

### Slice 1: shared spec-kit and action-replacement seams

- Reuse `AbilityDef.specs`, `excludeSpecs`, and `excludeSpecsAtLevel` for availability.
- Add a generic resolved action-replacement record for Pack Command and Unleash Beast.
- Sanitize invalid hotbar entries after a specialization change or loadout application.
- Add one cleanup callback per class system rather than class conditionals in `sim.ts`.
- Expose only the minimum replacement and cue state through the existing world facets.

### Slice 2: Hunter kit

- Land availability and display-name changes atomically with each replacement action.
- Implement Packlord in `src/sim/combat/hunter_packlord.ts`.
- Keep Coldsight mostly data driven unless Focus generation needs a small combat hook.
- Implement Fieldcraft in `src/sim/combat/hunter_fieldcraft.ts`.
- Add pet scale and tint as presentation only. Collision, reach, and pathing remain unchanged.
- Land the class-wide talent rows after all three baseline rotations work.

### Slice 3: Shaman kit

- Implement Thundercall in `src/sim/combat/shaman_thundercall.ts`.
- Implement Warspirit in `src/sim/combat/shaman_warspirit.ts`.
- Implement Spiritmend in `src/sim/combat/shaman_spiritmend.ts`.
- Extend the existing `canDualWield` spec gate to Warspirit for one-handed weapons only. Count
  landed main-hand and off-hand base swings toward one cadence, preserve canonical off-hand damage
  and miss rules, and sanitize the off-hand weapon through the existing path on respec.
- Keep Mending Current ownership keyed by Shaman and ally so one healer cannot consume another
  healer's pool.
- Apply every Stonebound armor, mitigation, threat, and forced-target rider only while the posture
  is active.
- Land the class-wide talent rows after all three baseline rotations work.

### Slice 4: Priest kit

- Implement Doctrine in `src/sim/combat/priest_doctrine.ts`.
- Implement Benison in `src/sim/combat/priest_benison.ts`.
- Implement Vespers in `src/sim/combat/priest_vespers.ts`.
- Use the shared guardian primitive for Tithefiend, but attached aura presentation for Seraphic
  Vigil.
- Prevent converted healing and echo damage from recursively triggering themselves.
- Land the class-wide talent rows after all three baseline rotations work.

### Slice 5: PBE balance and patch notes

- Compare each damage, healing, mitigation, and threat profile with shared class balance targets.
- Tune coefficients and cooldowns without changing the approved rotations.
- Validate mobile action count, target selection, and state visibility.
- Publish player-facing notes using only the custom names in this document.

## Automated test plan

### Spec ownership and action bars

Add `tests/class_spec_kits.test.ts` as a table-driven suite covering every row in the ownership
matrix:

- The owning specialization knows the action at its intended learn level.
- Both wrong specializations do not know it.
- No specialization cannot receive a spec-exclusive action through the class list.
- Signature grants appear only for their owning specialization.
- Level gates still apply to non-signature spec actions.
- The level 1 to 4 starter kit remains usable before specialization unlock.
- At the level 5 handoff, excluded starters disappear only from the intended specs.
- Respecializing removes every old exclusive action and adds only the new exclusive kit.
- Saved hotbar slots referencing removed actions are cleared or migrated deterministically.
- Exporting and importing a build cannot bypass spec ownership.
- Server-side allocation validation rejects a forged wrong-spec action path.

The suite must fail on the unmodified release base before the first availability change lands.

### Hunter mechanics

Add focused tests paired with the Hunter system modules:

- Pack Command grants Focus and one Ferocity stage only after a successful commanded hit.
- Invalid targets, missing pets, dead pets, and misses grant nothing.
- The Hunter owns the authoritative Ferocity stage; its buff stack, action replacement, and derived pet
  scale and tint remain synchronized.
- Unleash Beast consumes the bank once, claps once, cleaves deterministically, and then calms.
- Howling Rage reaches the approved empowered state without creating another button.
- Measured Shot grants Focus only after its successful impact.
- Coldsight movement and interrupted casts cannot create free Focus or spenders.
- Bloodhook respects range and blocked geometry, moves the Hunter rather than the enemy, and
  applies one primary bleed.
- Woundrend spends Focus, triggers one immediate bleed tick, and refreshes without duplicating the
  bleed.
- Shrapnel Charge selects targets deterministically and cannot recursively spread its wound.
- Trailbreak preserves Momentum and arms exactly one re-entry payoff.

### Shaman mechanics

Add focused tests paired with the Shaman system modules:

- Valid Arc Bolt impacts grant exactly one Thunder charge and invalid impacts grant none.
- Earthen Jolt and Faultwake consume the bank only after a valid resolved cast.
- Defensive Thunder Ward charges never spend or duplicate the offensive bank.
- Every valid third Warspirit melee step triggers one Galeheart event and one Stormcast state.
- Warspirit alone may equip a one-handed off-hand weapon, and landed swings from either hand feed
  the same cadence without letting echoes recurse.
- Galeheart echoes never advance the cadence or recursively proc.
- Stonebound removes Galeheart and applies every defensive rider as one visible tradeoff.
- Leaving Stonebound removes armor, mitigation, threat, forced-target, and smoothing riders.
- Mending Waters and Tidecall add to one capped Mending Current owned by the casting Shaman.
- Mending Current ticks subtract from the same stored amount later consumed by Cascading Mend.
- Cascading Mend consumes every reached owned pool once and leaves other Shamans' pools intact.
- An unprepared ally still receives canonical Cascading Mend healing.

### Priest mechanics

Add focused tests paired with the Priest system modules:

- Doctrine converts eligible damage into healing for the marked ally only.
- Scouring Mercy can damage an enemy or directly heal an ally without double resolution.
- No-enemy fallback healing remains usable and converted healing cannot recurse.
- Seraphic Vigil is attached to the selected ally, triggers once under its contract, and cleans up
  on respec or disconnect.
- Choirmend and Sunburst Canticle preserve their distinct cast and movement jobs.
- Mindfracture establishes or moves one valid Effigy and invalid casts do not move it.
- Effigy echoes select linked targets deterministically and never recurse.
- Gloomtithe caps at five, does not hide overflow, and is consumed once by Tithefiend.
- Tithefiend is autonomous, uses no pet controls, returns Mana only on valid strikes, and cleans up
  on every lifecycle exit.

### Cross-host, determinism, and presentation

- Run each mechanic twice with the same seed and compare state and event output.
- Add parity scenarios for any slice that changes combat results or random draw order.
- Prove wrong-spec state never appears in offline, authoritative server, or headless hosts.
- Test snapshot and reconnect cleanup for every bank, link, posture, and guardian.
- Regenerate guide content after every player-facing ability or specialization rename.
- Run localization coverage for every changed player-facing name and description.
- Verify mobile layouts never require precision ground placement for the baseline rotation.
- Verify reduced-motion and low-graphics modes retain every actionable cue.

## Required validation per gameplay slice

1. Record the relevant fail-first test against the slice base.
2. Run the paired module test and `tests/class_spec_kits.test.ts`.
3. Run talent, specialization, architecture, localization, guide, snapshot, and world-facet tests
   touched by the slice.
4. Run the parity suite and review every intentional state or combat-event change.
5. Run `npx tsc --noEmit` and the changed-file checks.
6. Run `npm run gate` before the PR is called ready.
7. Keep the PR current with `release/v0.28.0` through review and PBE feedback.

## Definition of done

- PR #2163 remains additive and unchanged.
- Every new rotation action has one owning specialization.
- No wrong-spec action or state survives selection, respec, loadout, reconnect, or persistence.
- Each specialization has a distinct baseline rotation before talent rows amplify it.
- All new player-facing names use the custom vocabulary in this plan.
- Every mechanic has fail-before and pass-after evidence.
- Mobile and reduced-motion players receive the same actionable information.
- Levy or Fernando has approved the gameplay slice and its PBE destination.
