# Hunter, Shaman, and Priest v0.29.0 PBE todo

Status: active PBE work list

Integration PR: #2218

Release baseline: `682df1b7b` from `release/v0.29.0`, merged into this isolated integration
worktree by `5129a2b1f`.

Latest completed slices: training-dummy and raid-level DPS balance harnesses, Fieldcraft and
Vespers tuning, safe level 20 default bars, persistence coverage for those bars, and the first
English tooltip clarity pass. Final fixed-head validation is still required.

Scope: Hunter, Shaman, and Priest, including all nine specializations, their shared talent rows,
their player-facing states, and the new rotation and starter action-bar work requested after the
first PBE review.

This is the execution order. Finish correctness and measurement before broad tuning. Finish the
English tooltip audit after mechanics and numbers stop moving.

Detailed One Button priorities and exact level 20 templates are in
[`docs/design/one-button-and-spec-bars-v029.md`](../design/one-button-and-spec-bars-v029.md).

## Definition of done

- [x] Every spec owns only its intended spells and clears old spec state on change, death, relog,
      reconnect, and loadout swap.
- [x] Every owned-spec damage, healing, mitigation, threat, and resource result is measured in the
      shared 1-target and 3-target harness.
- [x] Every level 20 spec has a useful default action bar that is applied only when safe.
- [ ] Approved DPS specs have a spellbook `One Button` action with a documented and tested priority
      list.
- [ ] Every new English spell, talent, aura, proc, and mechanic tooltip is plain, exact, and backed
      by live scaling tests.
- [ ] Mobile, desktop, reduced-motion, low-graphics, offline, online, and headless behavior agree.
- [x] PBE feedback is retested on the same fixed gear and target setup.
- [ ] The integration branch passes the required targeted checks and full gate before merge.

## 1. Lock the baseline and test harness

- [x] Record the exact #2218 commit used for each PBE measurement.
- [x] Use the same level 20 gear, target level, target armor, buffs, talents, pet, and weapon setup
      for every comparison.
- [x] Add a 60 sec single-target sustained test.
- [x] Add a 15 sec single-target burst test.
- [x] Add a 60 sec 3-target sustained test.
- [x] Add a 15 sec 3-target burst test.
- [x] Add 120 sec single-target raid profiles at levels 22, 23, and 24 using Nythraxis's real armor
      curve without running encounter mechanics.
- [x] Record total DPS, per-target DPS, damage by source, resource remaining, cooldown use, and the
      number of rotational buttons pressed.
- [x] Record landed hits, misses, dodges, parries, resists, and critical hits in every DPS profile.
- [x] Add a fixed healer damage profile and record HPS, mana, overhealing, prepared healing, and
      emergency recovery time.
- [x] Add a Warspirit off-tank scenario and record incoming damage, threat, forced-target uptime,
      and time to lose threat after leaving Stonebound.
- [ ] Keep results for release classes beside these nine specs so elite difficulty is not tuned
      only around possibly overtuned redesigns.

## 2. Correctness and state cleanup

- [x] Show Tithefiend damage in floating combat text and attribute it to the Priest in meters.
- [x] Replace every remaining player-facing `Smite` label with `Scouring Hymn` while keeping the
      saved internal id stable.
- [x] Keep Overdraw to one tracker in the aura list. The current branch already deduplicates the
      tracker; a regression test now pins that behavior.
- [x] Show persistent engine states without a one-day duration. This covers Flow State, Overdraw,
      Thunder charges, Warspirit cadence, and the other long-lived Hunter and Shaman counters.
- [x] Confirm Gloamveil uses the existing untimed form display.
- [x] Show permanent states as permanent. Do not display a one-day duration for Flow State,
      Gloamveil, Overdraw tracking, or similar states.
- [x] Clear Flow State when the Shaman changes spec. The existing cleanup was correct and now has
      a direct regression test.
- [x] Audit every spec-only aura, bank, link, guardian, posture, proc counter, and action
      replacement for cleanup on spec change.
- [x] Repeat the cleanup audit for death, release, disconnect, reconnect, relog, loadout change,
      and character load.
- [x] Confirm removed wrong-spec actions are cleared from saved action bars and cannot be cast by a
      forged client command.
- [ ] Confirm transformed actions keep the saved slot and return to the base action after the state
      ends.
- [x] Change every active Shaman spec weapon enhancement from 5 min to 30 min.
- [x] Confirm one weapon posture replaces the other and never leaves both active.

## 3. One Button spellbook feature

This is a new gameplay automation feature. It needs Levy or Fernando approval before it lands on
PBE. Keep it as one incremental feature behind existing ability and command seams.

### Product rules

- [ ] Add one visible spellbook action named `One Button` for each approved DPS specialization.
- [ ] Explain in its tooltip that each press uses the highest-priority available rotational action.
- [ ] Keep the player responsible for targeting and positioning.
- [ ] Do not automate movement, interrupts, defensive cooldowns, crowd control, dispels, taunts,
      long travel, resurrection, pet taming, or encounter-specific utility.
- [ ] Decide whether major offensive cooldowns are automatic, opt-in, or excluded. Default to
      excluded until PBE approves automatic use.
- [ ] Never queue an ability the player does not know or that belongs to another spec.
- [ ] Never bypass range, line of sight, cost, cooldown, cast, channel, target, pet, weapon, aura,
      or global cooldown rules.
- [ ] Return one clear reason when no rotational action is usable.
- [ ] Do not add another resource bar or hidden resource.
- [ ] Keep priority logic deterministic and shared across offline, online, server, and headless
      hosts.

### Rotation records

- [ ] Store each approved priority list as data or a small pure resolver, not a hardcoded branch in
      the HUD or `sim.ts`.
- [ ] Record the ideal single-target priority for Packlord.
- [ ] Record the ideal 3-target priority for Packlord.
- [ ] Record the ideal single-target priority for Coldsight.
- [ ] Record the ideal 3-target priority for Coldsight.
- [ ] Record the ideal single-target priority for Fieldcraft.
- [ ] Record the ideal 3-target priority for Fieldcraft.
- [ ] Record the ideal single-target priority for Thundercall.
- [ ] Record the ideal 3-target priority for Thundercall.
- [ ] Record the ideal single-target priority for Warspirit.
- [ ] Record the ideal 3-target priority for Warspirit.
- [ ] Record the ideal single-target priority for Vespers.
- [ ] Record the ideal 3-target priority for Vespers.
- [ ] Decide whether Doctrine receives a damage-only version or is excluded because it is a hybrid
      healer.
- [ ] Exclude Benison and Spiritmend unless a separate healer-assist design is approved.

### One Button tests

- [ ] Add fail-first tests for spellbook ownership and wrong-spec rejection.
- [ ] Test every priority step with the higher-priority actions available and unavailable.
- [ ] Test no-resource, no-target, wrong-range, dead-pet, missing-pet, moving, silenced, disarmed,
      and line-of-sight cases.
- [ ] Test 1-target and 3-target decisions.
- [ ] Test that a press casts only one action and spends resources once.
- [ ] Test channels and cast times without clipping or free follow-up casts.
- [ ] Test same-seed event and damage parity across the direct action and One Button path.
- [ ] Test server authority and reject a forged request for an action outside the selected
      priority record.
- [ ] Test action-bar, keybind, controller, and mobile action-ring use.
- [ ] Add an English tooltip that names what the button does and what it deliberately leaves to the
      player.

## 4. Level 20 default action bars

Apply a default bar when a player first selects a spec at level 20 or when an empty bar is repaired.
Do not overwrite a player-customized bar.

### Shared rules

- [x] Define the exact empty-bar and first-spec-selection conditions.
- [x] Preserve a saved customized bar, including a deliberately empty saved bar.
- [x] Replace only a missing bar or the exact untouched template generated for the previous spec.
- [x] Keep the same functional categories in the same positions where practical: core action,
      spender, area action, interrupt, movement, defense, heal, major cooldown, and utility.
- [x] Keep the highest-frequency actions in the easiest keyboard and mobile positions.
- [ ] Put `One Button` in a visible starter slot when the spec owns it, without replacing the manual
      rotation.
- [x] Include no unlearned, talent-dependent, or wrong-spec action in a base template.
- [x] Resolve each template against the character's actually known actions before applying it.
- [x] Make template application deterministic across offline, online, load, respec, and imported
      loadouts.
- [ ] Add a player setting or one-time reset command only if PBE shows that automatic repair is not
      enough.

### Hunter templates

- [x] Packlord has a tested manual-first level 20 template built from its known actions.
- [x] Coldsight has a tested manual-first level 20 template built from its known actions.
- [x] Fieldcraft has a tested manual-first level 20 template built from its known actions.
- [ ] Decide whether guises live on the main bar, a secondary bar, or a stance strip.
- [ ] Keep Wildbond, Patch Up, and Release Companion reachable without crowding the main rotation.

### Shaman templates

- [x] Thundercall has a tested manual-first level 20 template built from its known actions.
- [x] Warspirit has a tested manual-first level 20 template built from its known actions.
- [x] Spiritmend has a tested manual-first level 20 template built from its known actions.
- [x] Keep Galeheart and Stonebound beside each other so the damage and off-tank posture choice is
      obvious.
- [x] Do not put a DPS One Button action on Spiritmend by default.

### Priest templates

- [x] Doctrine has a tested manual-first level 20 template built from its known actions.
- [x] Benison has a tested manual-first level 20 template built from its known actions.
- [x] Vespers has a tested manual-first level 20 template built from its known actions.
- [ ] Decide whether Doctrine gets a One Button slot only after its hybrid role decision is made.
- [ ] Keep emergency healing visible on every Priest template without crowding the DPS loop.

### Action-bar tests

- [x] Add a table-driven expected template for all nine specs.
- [x] Add relog, reconnect, and imported-loadout action-bar coverage.
- [x] Test first sync, spec change, repeat selection, level-up to 20, and saved customized or empty
      bars.
- [x] Test that no saved customized slot is overwritten.
- [x] Test that an untouched generated template is swapped on spec change.
- [x] Test that templates contain only actions the selected level 20 spec actually knows.
- [x] Test desktop bars, controller access, and mobile action-ring reachability. The first 11
      actions stay on the default-visible desktop row, the first eight manual actions have default
      controller bindings, and every populated action is reachable through the mobile pager.
- [ ] Decide through PBE whether desktop players should see the secondary utility row by default.
      Today it remains an option, so actions after slot 11 are saved but hidden until enabled.

## 5. Hunter PBE work

### Packlord, Beast Mastery

- [x] Treat Pack Command as the non-retail name for the Kill Command generator role.
- [x] On a successful living-pet hit, Pack Command generates Focus and one Pack Ferocity stack.
- [x] Keep Pack Command from granting anything on a miss, invalid target, missing pet, or dead pet.
- [x] Make Pack Ferocity a visible Hunter-owned buff with three stages.
- [x] Give each stage a visible pet size and red-tint increase without changing collision, reach,
      or pathing.
- [x] Increase all current pet-originated damage by 10% per Pack Ferocity stack.
- [x] Apply the bonus to pet basic attacks, Pack Command, pet cleaves, pet claps, and Unleash Beast.
      Stampede must use the same helper if that separate feature is approved.
- [x] Do not apply Ferocity to the Hunter's direct weapon damage.
- [x] Resolve Pack Command with the pre-cast Ferocity state, then add its new stack.
- [x] At three stacks, replace Pack Command with Unleash Beast in the same saved action slot.
- [x] Make Unleash Beast use the full Ferocity bonus for its strike and clap, consume all three
      stacks, enter its separate 25% frenzy, then return the pet to its calm size and color.
- [x] Make Fell Shot a deliberate Focus spender instead of the only repeated filler.
- [x] Add Stampede as a Packlord offensive cooldown that summons temporary beasts to attack the
      selected target without pet micromanagement.
- [x] Credit Stampede damage to the Hunter in meters and show it in floating combat text.
- [x] Decide whether Stampede snapshots Ferocity or reads it live. Use one rule in combat and the
      tooltip.
- [x] While Stampede is on cooldown, let successful Pack Commands trigger a visible Stampede Ready
      proc that resets the cooldown and makes the action glow.
- [x] Do not allow the reset proc while Stampede beasts are active.
- [x] Add deterministic bad-luck protection after the approved number of failed Pack Commands. The
      current design range is five to six failures.
- [x] Retest the manual Packlord loop after Ferocity damage lands and keep it inside the approved
      single-target and three-target Hunter bands.
- [x] Retest the manual Packlord loop with Stampede in the deterministic 1-target and 3-target
      balance scenarios.
- [ ] Retest the One Button loop after that separate feature is approved and implemented.

### Coldsight, Marksmanship

- [x] Keep Overdraw to one tracker in the aura list.
- [x] Replace its one-day display with an untimed counter state.
- [x] Confirm Measured Shot remains the deliberate Focus generator.
- [x] Confirm Long Draw is the main Focus spender and respects movement and cast interruption.
- [x] Confirm Fevered Draw can move while channeling and does not double-count tooltip damage.
- [x] Retest Cold Focus duration, Focus generation, Long Draw cost, and cast-time changes.
- [x] Compare single-target and 3-target output after the shared Overdraw fix.

### Fieldcraft, Survival

- [x] Reduce Guttering Strike or Gutting Strike spam from the reported 150 DPS outlier.
- [x] Reduce empowered Woundrend from the reported 300 DPS outlier.
- [x] Keep the Trailbreak into Bloodhook re-entry interaction.
- [x] Keep Bloodhook as movement to the enemy, never a pull of the enemy.
- [x] Keep the range and blocked-geometry checks.
- [x] Keep the melee-led bleed, trap, explosive, and disengage identity.
- [x] Audit Bloodhook, Bloodhook Wound, Woundrend, Shrapnel Charge, Bloodtrail Assault, and Hunting
      Momentum against the shared scaling rules.
- [x] Scale Bloodhook Wound as 34 base damage plus 26% of Ranged Attack Power over 12 sec in four
      ticks, with the restored Survival damage bonus applying to the whole wound and the Trailbreak
      re-entry hit retaining its separate scaling.
- [x] Replace `primary wound` with plain English in every player-facing description.
- [x] Test Bloodhook tooltip values at two Ranged Attack Power values after scaling lands.

#### Bloodhook DPS balance

- [x] Set a per-cast damage budget for Bloodhook's base bleed, optional re-entry hit, and
      Bloodtrail spread. Its movement utility must count as part of the spell's power budget.
- [x] Measure Bloodhook alone and inside the full Fieldcraft rotation in the 15 sec and 60 sec
      1-target tests. Record base bleed damage, Ranged Attack Power contribution, re-entry damage,
      and cooldown-normalized DPS separately.
- [x] Repeat the measurement with 3 targets. Confirm Bloodtrail spread and Shrapnel interactions
      stay within the shared area-damage target and do not grow more than intended.
- [x] Tune the flat bleed and Ranged Attack Power coefficient separately so Bloodhook is useful at
      level 5, scales with level 20 gear, and does not become the largest rotational damage source.
- [x] Add deterministic tests that pin the chosen 1-target and 3-target damage budgets at low and
      high Ranged Attack Power, including normal entry and Trailbreak re-entry.

## 6. Shaman PBE work

### Thundercall, Elemental

- [ ] Preserve the current burst feel while bringing the reported 200 sustained and 260 burst DPS
      into the shared target range.
- [ ] Confirm exactly which spells build Thunder and which spells spend it.
- [ ] Confirm Earthen Jolt and Faultwake spend the bank only after a valid cast resolves.
- [ ] Keep defensive Thunder Ward charges separate from offensive Thunder charges.
- [x] Add the separately approved Skybranch follow-up as a three-target Thundercall builder that
      grants one Thunder per landed cast and never per bounce.
- [ ] Treat extra shock interactions as a separate follow-up after the base bank is clear.

### Warspirit, Enhancement

- [ ] Preserve the liked instant-spell flexibility and reported 170 DPS feel.
- [ ] Keep Galeheart as the damage posture and Stonebound as the explicit off-tank posture.
- [ ] Confirm dual-wield main-hand and off-hand hits advance one deterministic cadence.
- [ ] Prevent echoes from advancing or recursively triggering the cadence.
- [ ] Remove every Stonebound armor, mitigation, threat, control, and smoothing effect when the
      posture ends.
- [x] Benchmark damage, mitigation, and threat before changing numbers.

### Spiritmend, Restoration

- [ ] Preserve the liked Mending Current loop.
- [ ] Confirm Mending Waters creates an owned current on the healed ally.
- [ ] Confirm Tidecall immediately heals and enlarges that current.
- [x] Add Unleash Weapon as a 15-second single-target current consume with a tested one-hit guard.
- [ ] PBE-tune Unleash Weapon's 125% burst and 50% effective-healing guard.
- [ ] Confirm Cascading Mend consumes every owned current on every ally it reaches.
- [ ] Keep another Shaman's currents separate.
- [ ] Test the normal heal when an ally has no prepared current.
- [x] Add the separately approved Ancestors' Return as a seven-second, out-of-combat group revive.

### Shared Shaman

- [x] Change weapon enhancement duration to 30 min.
- [x] Fix Flow State so its ready state is shown without a timer and never survives a spec change.
- [x] Put Unleash Weapon on all three default bars and resolve it through the active spec weapon
      enhancement.
- [ ] PBE-tune Pyrebrand damage, Galeheart attack speed, Stonebound mitigation, and Lifespring
      healing without changing the shared action contract.
- [ ] Rewrite every level 20 talent tooltip with exact spec-specific outcomes.
- [ ] Retest weapon, Flow State, and talent state through relog and reconnect.

## 7. Priest PBE work

### Vespers, Shadow

- [x] Raise normal rotation damage before adding more power to Tithefiend.
- [x] Compare Vespers with other DPS specs in both 1-target and 3-target tests.
- [x] Recheck Vespers against the level 22 to 24 raid profiles. Keep its current damage because it
      remains above the median DPS band without overtaking the top result.
- [x] Reduce Tithefiend mana restoration to 1% maximum mana per hit so it does not create
      effectively infinite mana.
- [x] Show every Tithefiend hit in floating combat text and credit it to the Priest in meters.
- [ ] Add depth through one existing Shadow spell interacting with Effigy or Gloomtithe rather
      than adding another button by default.
- [ ] Keep Effigy ownership, movement, replacement, and cleanup deterministic.
- [x] Explain exactly how Effigy is applied, how echoes choose targets, how Gloomtithe is earned,
      its five-stack cap, and what Call Tithefiend consumes.
- [ ] Keep the rotation mobile friendly.

### Doctrine, Discipline

- [ ] Do not tune Doctrine by comparing it only with the currently weak Vespers result.
- [x] Benchmark damage and healing together in fixed one-ally and three-ally profiles.
- [ ] Agree on the hybrid role target before tuning the measured result.
- [x] Measure damage conversion, emergency direct healing, mana, and group recovery.
- [ ] Add absorb accounting so Psalm of Warding's contribution is included beside effective HPS.
- [ ] Decide whether its One Button option is a damage priority helper or whether hybrid play stays
      fully manual.
- [ ] Preserve the fresh damage-to-clean-healing play style.

### Benison, Holy

- [ ] Run real dungeon tests before changing Solemn Prayer or Seraphic Vigil.
- [ ] Test whether Solemn Prayer needs a longer cast time.
- [ ] Test whether Seraphic Vigil needs more than its current 30 sec duration.
- [x] Measure fixed one-ally and three-ally healing, overhealing, mana, and emergency recovery.
- [ ] Measure angel timing and group recovery in a real dungeon run.
- [ ] Preserve the strong group-healing identity without making normal dungeon damage irrelevant.

### Shared Priest

- [x] Replace all visible English `Smite` labels with `Scouring Hymn`.
- [x] Confirm Gloamveil uses the existing untimed form display.
- [x] Audit cleanup for Doctrine links, Seraphic Vigils, Effigies, Gloomtithe, Tithefiends, and
      capstone state.

## 8. Final English tooltip audit

Use `docs/design/tooltip-writing.md` and the tooltip skill. Do this after the mechanics and balance
numbers above are locked. Edit English sources first. Do not hand-edit locale overlays or generated
resolved catalogs.

### Required content for every tooltip

- [x] State the target and main action plainly for the new nine-spec mechanics and talent rows.
- [x] Show exact live damage, healing, absorb, resource, duration, cooldown, charge, stack, radius,
      and target-cap values.
- [x] State important triggers, reset rules, consumption rules, and failure conditions.
- [x] State or correctly resolve Spell Power, Attack Power, Ranged Attack Power, weapon damage,
      maximum-health, pet-state, or flat scaling.
- [x] For periodic effects touched in this pass, state whether the number is total damage or per
      tick.
- [x] Remove unexplained terms such as `primary wound`, `valid impact`, `spec relationship`, and
      `calculated healing`.
- [ ] Keep ability names consistent across the spellbook, action bar, aura frame, talent window,
      combat log, floating combat text, meters, and guide.
- [x] Test the custom scaling tooltips touched by the pass at two power values and compare them
      with the combat result.

### Hunter spell and state inventory

- [ ] Shared: Harrier's Guise, Venom Barb, Fell Shot, Rattling Shot, Fettering Slash, Trailbreak,
      Wildheart, Shellskin, Frostjaw Trap, Wildbond, Release Companion, Patch Up, Marten's Guise,
      Courser's Guise, Volley, and Hushing Shot.
- [ ] Packlord: Pack Command, Pack Ferocity, Unleash Beast, Howling Rage, Stampede, Stampede Ready,
      and every temporary beast damage source.
- [ ] Coldsight: Measured Shot, Long Draw, Fevered Draw, Cold Focus, and Overdraw.
- [ ] Fieldcraft: Bloodhook, Bloodhook Wound, Gutting Strike, Hunting Momentum, Woundrend, Shrapnel
      Charge, Bloodtrail Assault, and the re-entry payoff.
- [ ] Hunter talents: Tactical Retreat, Enduring Courser, Predator's Pace, Receding Shell, Shared
      Recovery, Beastguard, Double Hush, Binding Payload, Crippling Pursuit, Efficient Rhythm,
      Trapcraft, Guise Mastery, Apex Instinct, Shell and Fang, Pack Rally, Overdraw, Chain Reaction,
      and Fang Chorus.

### Shaman spell and state inventory

- [ ] Shared: Arc Bolt, Mending Waters, Earthen Jolt, Thunder Ward, Cinder Jolt, Rime Jolt,
      Shadewolf, and Storm Chorus.
- [ ] Thundercall: Pyrebrand Weapon, Thunder charges, Faultwake, and Primal Mastery.
- [ ] Warspirit: Galeheart Weapon, Stonebound Weapon, Ancestral Strike, Stormcast, cadence echoes,
      and off-tank threat or mitigation states.
- [ ] Spiritmend: Lifespring Weapon, Mending Current, Tidecall, and Cascading Mend.
- [ ] Shaman talents: Wolfstep, Gathering Winds, Flowing Elements, Stoneward, Warded Elements,
      Ancestral Mending, Fault Rebuke, Rime Lock, Gripping Earth, Flow State, Imbue Mastery, Ward
      Cycle, Primal Exaltation, Wayfarer Grace, Ancestral Bulwark, Deep Reservoir, Echoing Elements,
      and Living Weapon.

### Priest spell and state inventory

- [ ] Shared: Scouring Hymn, Whispered Prayer, Litany of Resolve, Dirge of Decay, Psalm of Warding,
      Lingering Grace, Mindfracture, Solemn Prayer, Litany of Woe, Urgent Prayer, Veilstep, and
      Terror Canticle.
- [ ] Doctrine: Scouring Mercy, Doctrine link, converted healing, and any damage-priority One Button
      state if approved.
- [ ] Benison: Choirmend, Sunburst Canticle, Seraphic Vigil, angel trigger, and angel recovery.
- [ ] Vespers: Gloamveil, Effigy, Effigy echoes, Gloomtithe, Call Tithefiend, Tithefiend damage, and
      Tithefiend mana return.
- [ ] Priest talents: Sheltering Step, Veil Unbound, Processional Grace, Last Prayer, Shattered
      Psalm, Wounded Halo, Hushword, Lingering Dread, Binding Psalm, Stilled Mind, Measured Faith,
      Living Covenant, Anointing, Martyr's Aegis, Choir of Deliverance, Twin Covenant, Second Verse,
      and Incarnate Spirit.

## 9. Dungeon and unrelated follow-ups

Keep these outside the nine-spec fix unless a separate PR is approved.

- [ ] Benchmark elite and dungeon scaling with unchanged release classes before raising global mob
      health or damage.
- [ ] Investigate Gravewyrm normal and heroic difficulty as its own balance task.
- [ ] Fix dungeon reset being blocked by unlooted loot as its own bug-fix PR.
- [ ] Audit weak wand auto-attack scaling as its own combat-balance task.
- [x] Add the approved Shaman group revive utility follow-up to this PBE integration candidate.
- [x] Add the approved Thundercall Chain Lightning rotation follow-up to this PBE integration
      candidate.
- [ ] Consider more shock interactions only after current Thunder generation and spending are
      clear.

## 10. Final validation and handoff

### Review-driven fixes completed

- [x] Make Apex Instinct's major window last its authored duration instead of displaying for more
      than a minute.
- [x] Reject Call Tithefiend before spending mana or starting its cooldown when no living enemy has
      the Priest's Dirge of Decay.
- [x] Make Reset Action Bar restore the selected level 20 spec's curated bar.
- [x] Route healer balance pressure through normal damage and absorb handling so Doctrine shields
      count in the test.
- [x] Apply Survival's restored passive damage bonus to Bloodhook and Shrapnel Charge.
- [x] Show normal pet and Tithefiend damage in the owning player's floating combat text and combat
      log while keeping ordinary pets separate in the damage meter.
- [x] Stop permanent Shaman engine states from rebuilding network snapshots every update.
- [x] Make Stormcast spend half mana without also consuming Clearcasting.
- [x] Respect normal taunt immunity when Stonebound Weapon applies its threat effect.
- [x] Preserve retained Shaman talent state when a different talent row changes.
- [x] Apply Thunder's damage multiplier to Faultwake's Spell Power contribution.
- [x] Require real three-target damage in the balance harness and bound Vespers sustained damage.
- [x] Cancel a Hunter projectile when its caster changes away from the projectile's owning spec.
- [x] Retune Bloodhook after restored passive scaling so Fieldcraft remains inside its approved
      single-target band.

### Deliberate follow-ups and human checks

- [ ] Decide with design whether Pack Command and Unleash Beast wait for the pet to reach melee
      range, move the pet instantly, or retain their current command-range hit behavior.
- [ ] Decide whether customized action bars need a separate saved profile for every spec. The safe
      default and reset paths are implemented; changing persisted bar storage is a larger follow-up.
- [ ] Decide whether Measured Shot should grant Focus when its projectile reaches an immune target.
- [ ] Add live calculated numbers to the remaining custom pet and Shrapnel tooltips if the tooltip
      UI gains a supported custom-effect formatter.
- [ ] Complete human PBE checks and screenshots on desktop, mobile portrait, mobile landscape,
      reduced motion, and low graphics.
- [ ] Obtain reviewer signoff before moving the pull request out of draft.

- [x] Run focused mechanic tests for Hunter, Shaman, and Priest.
- [x] Run spec ownership, hotbar, tooltip consistency, scaling, cleanup, snapshot, parity,
      localization, guide, architecture, and talent tests touched by the work.
- [x] Run `npx tsc --noEmit`.
- [x] Run changed-file formatting and copy checks.
- [ ] Run mobile portrait and landscape checks for action bars, spellbook, One Button, aura states,
      and long tooltips.
- [ ] Run desktop checks for the same surfaces.
- [ ] Run reduced-motion and low-graphics checks for every actionable state.
- [x] Regenerate owned generated artifacts through their normal commands.
- [x] Run `npm run gate` on the fixed final head.
- [ ] Update the #2218 PR body with the final PBE measurements, screenshots, fails-before and
      passes-after bug evidence, and remaining separate follow-ups.
- [ ] Keep #2218 current with `release/v0.29.0` through review until merge or explicit closure.
