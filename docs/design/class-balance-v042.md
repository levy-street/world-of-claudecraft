# v0.42.0 class balance proposal

Status: implementation authorized on 7 September 2026. Reuben approved implementing the full proposal with Sonnet workers and Codex review. The research below records the starting design and calibration evidence; implementation and validation progress is tracked in class-balance-v042-progress.md.

Final calibration is recorded in [measured results](class-balance-v042-results.md). Groveheart uses a 1.05 primary factor plus the corrected Wildbloom replant calculation, superseding the 1.20 starting trial below.

## Scope and decisions

This proposal covers all 13 requested specializations. It replaces the earlier finisher-gated Skulduggery opener and capped, target-centered Vespers refresh.

| Spec | Requested outcome | Recommended approach |
| --- | --- | --- |
| Spiritmend shaman | +10% healing | Amplify complete primary heals and HoT snapshots; Current inherits the increase once. |
| Sunmender paladin | +10% healing | Holy-only primary healing, including Aegis; Beacon and Dawn Echo inherit once. |
| Groveheart druid | +20% healing | Direct heals, HoTs and new replants; existing HoT harvests inherit once. |
| Wildfang druid | +10% damage | Feral-only AP and offensive ability tuning; measure Wolf and Bruin separately. |
| Thundercall shaman | +10% damage | Elemental-only damage and Spell Power riders; retain resource/vent cadence. |
| Ruination warlock | +10% damage | Owner spells, demon/Pyre melee and an explicit Pyre Aura adjustment. |
| Knifework rogue | +10% damage | Assassination-only AP plus offensive ability tuning, preserving resource mechanics. |
| Fieldcraft hunter | +10% damage | Survival-only AP plus offensive ability tuning, including resulting pet inheritance. |
| Necromancy warlock | +20% damage | Owner and undead army together; stronger bank inputs, unchanged Ossuary payout fractions. |
| Doctrine priest | +30% damage, improved healer viability | Discipline-only personal damage; useful fallback conversion and a bounded friendly Scouring Mercy rescue. |
| Vespers priest | Damage/maintenance buff | Paid Dirge reapplication refreshes every eligible mob within priest range, with no target cap. Correct existing Dirge SP scaling. |
| Skulduggery rogue | Nerf sustained damage, reward stealth | Stronger immediate true-stealth opener, weaker ordinary output and repeatable Gloam strike. Trial sustained target: about -10%. |
| Coldsight hunter | +10% damage and more decisions | Moderate offensive tuning plus a banked choice after a completed Fevered Draw, within the same +10% budget. |

Approved implementation decisions:

- Doctrine remains a healer. Its +30% request appeared under DPS and is interpreted as damage; healing viability has separate criteria.
- Wildfang's requested damage increase applies to both Wolf and Bruin. It does not independently increase their durability.
- Skulduggery's first few seconds should improve, while sustained output declines. A stronger first strike does not mean a stronger entire 15-second burst window.
- Numeric tuning uses the game's existing shared PvE/PvP rules, with dedicated PvP checks. Vespers' new secondary refresh targets mobs, matching the request, and does not propagate to enemy players.
- Coldsight's mobile-friendly shot option and Doctrine's rescue cleave were approved with this proposal. Fell Shot has no movement requirement.

Broad health/stamina changes and professions changes are outside this proposal.

## Evidence and source baseline

Research uses fetched release/v0.42.0 at 357b1932c2ca5eee11cadf520b7caaf61c141196, rechecked during this research. Production comparison is v0.41.4 at 511ee2e1fa541eaa4a7b6efb464e586d077084ad. Class baseline coefficients match, but release has older general cast-queue/resurrection behavior. Freeze the integration SHA again before implementation; do not attribute branch drift to tuning.

Relevant contracts: [class design rules](class-design-rules.md), [spell balance framework](spell-balance-framework.md), [release tracker #3780](https://github.com/levy-street/world-of-claudecraft/issues/3780).

Read-only production research used the [Parses MCP](https://parses.worldofclaudecraft.com/mcp): metadata, encounter boards, rankings, fights and damage/healing breakdowns.

- **Doctrine's screenshot cohort does not measure level-20 performance.** The nine qualifying 0.41.x entries across the currently rankable boards are levels 6-15, three characters, normal dungeons. Seven have zero damage. The other two are approximately 26.1 DPS. [Level-6 example](https://parses.worldofclaudecraft.com/#/fight/69703); [level-15 example](https://parses.worldofclaudecraft.com/#/fight/78704).
- **HPS is effective healing and excludes shields.** Absorbed damage is attributed to its recipient, not the shield caster. Some fully overhealed periodic ticks are not emitted, so historical gross healing cannot be reconstructed completely. Source: server/parse/fights.ts::noteHeal and parse-service participantRates.
- **Skulduggery's excess is substantially sustained output.** Two level-20 normal Nythraxis parses with identical gear/talents show Melee at 50.7%/58.4%, Lurker's Strike at 24.6%/23.3%, and Red Ribbon at 11.4%/15.3%. The higher parse also has 11% external Requital Aura contribution. Do not interpret their 248.94/193.82 DPS difference as pure skill. [Fight 78225](https://parses.worldofclaudecraft.com/#/fight/78225); [fight 78192](https://parses.worldofclaudecraft.com/#/fight/78192).
- **Dirge of Decay is the persistent DoT.** Its internal ID is shadow_word_pain, duration 18 seconds, interval 3 seconds, range 30 yards. Litany of Woe is a three-second channel.
- **A single shot buff cannot deliver Coldsight's total increase.** One level-20 sample has only 12% Long Draw and about 61% Auto plus owner-folded Melee. Gear/ownership caveats prevent treating this as an optimal universal distribution. [Fight 71441](https://parses.worldofclaudecraft.com/#/fight/71441).

## How the buffs stay within their intended specs

SPEC_BASELINES in src/sim/content/spec_baselines.ts and computeTalentModifiers select committed class/spec. Choice talents are class-wide, so changes to their behavior still need a class-and-spec guard. Sunmender intentionally has no legacy baseline entry; retain its existing mastery/support ownership.

Existing modifiers are additive. resolveTalentHitMult uses 1 + global bonus + ability bonus. Adding 0.10 does not generally mean 10% more total output. White attacks do not receive meleeDmgPct, pets have separate scaling, and hunter pets inherit owner ranged AP.

Use a small, precomputed **offensive-only tuning component** alongside the existing resolution:

1. Keep legacy modifiers and utility behavior intact. Add the candidate offensive adjustment only to damage effect magnitudes and the matching runtime SP/AP/weapon riders. Do not blindly increase the old global bucket: scaleEffect also applies that bucket to some armor/stat buffs.
2. Use existing spec-only AP fields where the proposal deliberately includes autos. Avoid shared class stats, Agility, weapon normalization, shared poison literals and global pet inheritance.
3. Adjust pets through the owning player's committed spec; identify explicit bypasses such as Pyre Aura.
4. Preserve a factor of one/zero extra bonus for every untargeted spec and no-spec character, including identical rounding and RNG behavior.
5. Keep primary and copied output distinct. Do not blanket-multiply dealDamage or applyHeal: callers mix new amounts and amounts derived from already resolved output.

Important copy cases:

| Mechanic | Treatment |
| --- | --- |
| Ruinous Brand, Lich pierce, Ossuary | Their resolved/final source damage grows; do not amplify the payout again. |
| Wildfang Redharvest and Fieldcraft wound cash-outs | Distinguish new damage from consumed stored bleed damage; count the stored component once. |
| Thundercall Echoing Elements | It snapshots damage calculated before dealDamage. Preserve that resolution order; do not assume every echo is already final. |
| Vespers Second Verse | It snapshots an Effigy echo into a DoT without a finalDamage flag. A broad late damage multiplier could double it. |
| Mending Current, Beacon, Dawn Echo, Overbloom | Stronger primary healing feeds the existing fractions; no second independent buff. |

A 20% increase applied to both a source and its copied payout becomes 44%. Tests must verify originating amounts and copies separately.

External buffs, shared item procs, fixed-health utility, shield sizes, mitigation and resource formulas are not independently retuned. Natural consequences - higher threat, damage conversion, larger Current-derived shields, more Ossuary bank input - must be measured and disclosed.

## Healing: complete primary amounts, then existing mechanics

Starting primary-healing factors are Spiritmend 1.10, Sunmender 1.10 and Groveheart 1.20. Cache the class-qualified factor during modifier computation; never walk talent rows per tick.

Apply one pure helper to the complete raw primary amount after base, Healing Power and existing cast/talent modifiers, before crit/target healing resolution or storage in a HoT/pool. A factor of one must preserve the original value exactly.

Runtime coverage:

- effect_dispatch.ts: direct heals, first-hop chain healing, primary area healing, stored HoT ticks and fixed consumeAura healing.
- casting_lifecycle.ts: primary healing channel ticks.
- paladin_aegis.ts: channel ticks and final heal.
- druid_engines.ts::replantWildbloom: newly applied replant.
- paladin_talents.ts::unleashPerpetualSun: its primary flat heal for Sunmender only.

Ordinary HoT ticks in combat/auras.ts bypass applyHeal and directly use the stored aura value. Scaling only applyHeal would miss them.

### Spiritmend +10%

Increase Mending Waters, Tidecall, Cascading Mend, direct/periodic toolkit healing and the primary amounts deposited into Mending Current. Keep deposit fractions, the 30%-max-HP cap, harvest fractions and Springmender set behavior unchanged.

Current's ticks, harvest and derived shield naturally benefit from larger deposits. Do not multiply them a second time. Leave shared fixed-health Stoneward/Ancestral Mending utility unchanged.

At level 20 with 100 Healing Power and empty choice rows, the current raw Mending Waters range is 361-403. Multiplying the completed packet by 1.10 projects 397-443 before crit, target modifiers or overheal.

### Sunmender +10%

Increase Holy-owned primary healing, including Mending Light, Dawn's Embrace, Solar Invocation, Aegis and Perpetual Sun. Beacon and Dawn Echo transfer the stronger primary healing under their existing rules.

Aegis currently omits the talent healing multiplier from its SP rider. Reproduce and correct that inconsistency first, then count its contribution toward the final budget. Do not independently enlarge absorbs or Faithwarden/Dawnreaver healing.

Example raw Mending Light range at the same diagnostic inputs: 276-308 projects to 304-339.

### Groveheart +20%

Increase direct heals and every new class HoT snapshot, including Regrowth and Rejuvenation. Overbloom consumes already improved stored HoTs; only its newly planted Wildbloom gets a new primary calculation.

Replanted Wildbloom currently omits talent/HoT multipliers on its Healing Power rider. Fix it using the normal application calculation and count that correction toward the +20% target. Preserve Verdance application rules.

Example Rejuvenation tick at the diagnostic inputs: 135 projects to 162.

These factors are exact primary-spell amplification before rounding/caps. They do not guarantee identical effective HPS gains when allies are healthy, mana is exhausted, utility/procs contribute, or Current is capped. Measure the eligible output share and pressure. Start with 1.10/1.20, then fit the total budget after the scaling fixes; do not silently stack a full buff on a large bug fix.

## Straightforward damage packages

The table records actual exploratory simulation results, not accepted shipping coefficients. Delta means additive change to the existing bonus. The eventual offensive-only implementation must reproduce the damage result while excluding utility collateral.

| Spec | First candidate | Before → candidate mean DPS | Relative change |
| --- | --- | ---: | ---: |
| Wildfang, Wolf | Feral AP bonus +0.10; offensive physical ability bonus +0.15 | 136.55 → 151.08 | +10.64% |
| Thundercall | Elemental offensive spell bonus +0.13 | 131.92 → 144.85 | +9.80% |
| Ruination | Destruction owner spell bonus +0.11; pet bonus +0.10 | 188.96 → 206.78 | +9.43% |
| Knifework | Assassination AP 0.36 → 0.57; offensive ability bonus 0.22 → 0.32 | 203.05 → 223.09 | +9.87% |
| Fieldcraft | Survival AP 0.15 → 0.22; offensive ability bonus 0.30 → 0.45 | 146.34 → 160.93 | +9.97% |
| Necromancy | Demonology owner spell bonus 0.10 → 0.32; baseline pet bonus 0.15 → 0.42 | 187.06 → 222.60 | +19.00% |

All table rows use 120-second profiles. Different specs use different harness fixtures; these absolute DPS figures must not be compared as a class ranking. The protocol and limitations are below.

Specific implementation details:

- **Wildfang:** apply the offensive changes only to feral. Autos receive the AP change; form attacks and bleeds receive their intended offensive scaling. Do not change shared CAT_FORM_DAMAGE_MULT, Wild Apex, health, armor or Marrowbreak's max-health shield. The same candidate gave +9.53% mean damage in a preliminary 30-second Bruin probe, but individual seed changes were large because rage/rotation changed RNG consumption. Wolf and Bruin need separate acceptance.
- **Thundercall:** include complete Arc/Jolt, damaging totem and vent payloads plus SP riders. Preserve Thunder generation, vent ratios, Echo rates, haste and mana. The scratch candidate changed neither mana endpoint.
- **Ruination:** spell and ordinary pet tuning misses Pyre Aura. tickPyreGuardian directly deals flat 60 damage without petDamageMult. Add an explicit destruction-only 60 → 66 starting adjustment. This refinement was not included in the +9.43% result. Summon impact already follows owner scaling; Pyre melee follows pet scaling. Ruinous Brand fractions and Wrack generation stay intact.
- **Knifework:** use the AP/ability blend so white attacks and the active wound/finisher loop both benefit. Do not change shared poison coefficients or Venom Ritual/resource refunds. Three-seed 15/60/120-second gains were +9.72/+9.86/+9.87%.
- **Fieldcraft:** the AP/ability blend covers the hunter and the resulting pet inheritance. Do not add another blanket pet buff or increase Agility/avoidance. Audit Shrapnel, re-entry, Bloodhook and wound copies. Three-seed 15/60/120-second gains were +9.45/+9.86/+9.97%.
- **Necromancy:** the common owner multiplier becomes 1.10 → 1.32; mastery plus baseline pet scaling becomes 1.35 → 1.62. Include Bone Mage, Gravewing, Lich and other owned undead, plus Reaping Command. Essence Reap's existing 0.08 ability bonus dilutes its gain; the damage-only equivalent of 0.08 → 0.096 produces 1.18 → 1.416, exactly +20% before other bonuses. That refinement is arithmetic, not separately simulated. Stronger army damage already increases Ossuary; retain bank/cash-out/healing fractions. Measure both cold-start and legitimately prepared pulls.

Shared equipment-proc damage was unchanged in these probes and can dilute the total increase. Do not edit a shared proc to close a fractional gap.

## Skulduggery: stronger actual stealth, weaker repeatable damage

Current Gloam gives repeated free any-angle Lurker access, an Edge weapon bonus, a six-second Veil window and Dusk Economy half-cost actions. A true-stealth opener currently banks Gloam instead of receiving the detonation reward.

Recommended first candidate:

1. On an actual stealth Lurker's Strike, double its weapon-strike component and flat strike bonus before normal damage resolution. Pay the reward immediately. Gloam/Veil access alone does not qualify. Snapshot actual stealth before it breaks; the true-stealth bonus and Veiled Edge cannot stack on one hit. Keep the intended dagger/behind requirement for the stronger opener, including when a Gloam bank exists.
2. Reduce repeatable Gloam Edge from +100% to +50% of the weapon component in the non-set case.
3. Reduce subtlety AP bonus 0.12 → 0, offensive physical ability bonus 0.08 → 0.04, and its Ambush-specific offensive bonus 0.16 → 0.
4. Keep Gloam generation, free detonation, generous angles, Veil duration and Dusk Economy cost cadence initially. Avoid a shared resource cut with nonlinear effects on all rogue builds.

Scratch results using the exact equipment IDs and talents from fight 78192, character 116838:

| Measurement, mean of three seeds | Current | Candidate | Change |
| --- | ---: | ---: | ---: |
| Initial true-stealth Lurker hit | 252.7 | 391.0 | +54.7% |
| First repeatable Gloam Lurker hit | 371.3 | 230.0 | -38.1% |
| 120-second DPS without starting stealth | 203.50 | 184.31 | -9.43% |
| 120-second DPS including starting stealth | 230.17 | 204.66 | -11.09% |

With the true opener, cumulative damage was higher in the first 1/3/6 seconds by approximately 27.8%/15.2%/4.5%; the full 15-second total was 9.77% lower. This matches a frontloaded identity with weaker follow-through.

The intended decisions are choosing the opener's victim and timing, connecting during a vulnerability window, spending Smokestep offensively versus retaining its escape, and carrying Gloam through downtime instead of wasting its window. No finisher condition delays the stealth payoff, and no new button is required.

These experiments used a deliberately simple current loop: Gloam/Veil Lurker, Tempo maintenance and Red Ribbon. They do not prove an optimal skilled rotation or all talent/set outcomes. Before adoption, compare practiced and simplified policies, true stealth and repeatable windows, front/back positioning, 0/2/4pc, crit burst, resets and PvP. For Ashveil 4pc, trial the same halving of the repeatable Edge bonus, +200% → +100%, while keeping the true-stealth reward distinct. This set candidate and Smokestep during Veil are unmeasured. A large first-hit increase requires a measured PvP ceiling.

## Vespers: reapply Dirge once to refresh every eligible mob

After successfully reapplying Dirge of Decay to a mob already carrying your active Dirge, refresh your existing Dirges on **all living hostile mobs within your current Dirge range**, centered on the priest. Current range is 30 yards. There is no target cap and no requirement to be close to the primary target or be an Effigy.

Recommended exact behavior:

- Initial application still requires one cast per mob. Clean targets and expired DoTs are not spread/recreated by the secondary refresh.
- Only the casting priest's auras qualify. Check current hostility, line of sight, life and range at the successful application.
- Include the 30-yard boundary; exclude just outside. Two mobs 29 yards on opposite sides of the priest both qualify.
- Preserve each DoT's next tick time and same-tick Gloom guard; refreshing never grants an instant tick.
- Resnapshot the freshly resolved Dirge damage payload on recipients so repeated maintenance cannot preserve an obsolete damage snapshot indefinitely.
- Refresh to the normal 18 seconds without shortening a longer existing duration. Carry any time above 18 seconds as already-used Living Covenant extension allowance, within its existing 24-second maximum. Do not reset the full six-second allowance while also preserving extended time.
- Keep an existing own Effigy consistent with the refreshed Dirge lifetime. Do not create/rebind Effigies or grant immediate Gloomtithe.

The successful application seam must capture the old primary aura before replacement. An after-cast hook alone cannot reliably distinguish first application, refresh and failure. Use a small priest helper and the existing spatial hostilesInRadius query once per paid refresh. Reuse source-aware aura replacement/events. No recurring whole-world tick scan is needed.

Keep the existing additional-target limit on Effigy **damage echoes** separate. Refreshing all Dirges does not increase that echo cap, create Gloom from every DoT, or multiply Tithefiend mana returns.

Also correct VESPERS_DOT_DAMAGE_MULT = 1.10 reaching authored Dirge damage but not its runtime SP rider. That is a real single-target correction; the range-wide mechanic itself mainly frees multi-target maintenance casts. Do not claim a flat single-target DPS gain for it.

For N maintained targets, upkeep changes from roughly N casts per refresh cycle to one. This intentionally saves (N - 1) GCDs and their mana, allowing more attacks and potentially a larger established DoT field. Test 1/3/5/10 targets and a large pack above the old echo cap, including opposite-side targets, walls, failed application, near-due ticks, multiple priests and extension loops.

## Coldsight: bank a useful shot choice after Fevered Draw

Recommended first candidate:

1. Add 0.10 to marksmanship's offensive ability bonus, with no AP or blanket pet increase. The isolated numeric change gave about +4.5% total damage.
2. Fully completing Fevered Draw grants one visible, non-stacking opportunity lasting 10 seconds.
3. Spend it on a **Long Draw with +50% complete hit damage** when able to stand and cast, or a **Fell Shot with +75% damage** while moving. These spend the same opportunity. The Long Draw branch has exploratory simulation evidence; the Fell branch remains an unmeasured starting value.
4. Retain normal focus costs, cooldowns and cast times. No guaranteed crit, reset or extra Cold Focus extension.

With the numerical change and stationary Long Draw payoff together, three-seed 15/60/120-second gains were +10.16/+11.17/+9.97%. At 120 seconds that was 145.48 → 159.98 DPS. The mechanic is included in the requested +10%, not added on top.

Do not use only a faster cast as the reward: runtime RAP scaling depends on resolved cast time, and GCD/Cold Focus floors can remove the expected gain. A damage rider gives a clear payoff while preserving the cast's existing scaling.

Implementation belongs in hunter_coldsight.ts plus the actual channel-completion seam. onCastCompleted currently fires when a channel starts; it cannot grant a completion reward. Interrupted, canceled or incompletely delivered channels must not grant the opportunity.

Reserve the opportunity on an accepted follow-up cast, commit its bonus to that cast, and prevent another queued action from spending it. Rejecting a cast must not consume it; an accepted cast that is later interrupted spends it. Expiry after a valid reservation must not remove the promised bonus. A repeated Fevered Draw may refresh one opportunity but cannot stack it.

Show the charge on the existing aura/action-bar surface. Audit Overdraw/Chain Reaction copies explicitly so the extra damage cannot create another proc chain. Compare stationary, moving and target-swap policies; the moving option must remain useful without outperforming a well-timed Long Draw in its ideal situation. Test focus caps, movement, interruption, expiry, target death, Overdraw, all capstones, 0/2/4pc, pet contribution and sibling hunter output.

## Doctrine: strengthen the damage-healing loop and add group rescue

Keep Doctrine a tank/spot healer that chooses between dealing damage for conversion and direct emergency healing. The current parse cohort is insufficient to justify lowering Twin Covenant.

Recommended initial package:

1. **Target +30% total personal damage** with a discipline-only damage factor, starting at 1.30 on eligible primary packets. Cover Hymn/Smite, hostile Scouring Mercy, Mindfracture, Dirge and wand output. Shared item/external proc contributions remain unchanged and are reported. Do not claim +30% total from buffing only its two Holy conversion spells.
2. Keep baseline one 30%-conversion link, Twin's two 70% links, their 30-second duration and Emberscreed bonuses initially. Stronger eligible Holy attacks naturally produce more conversion healing; do not add another blanket Doctrine healing multiplier.
3. Broaden the existing 15% fallback to operate when no valid injured linked ally exists. Pay one fallback to the lowest-health eligible injured party/raid player, not one per full/missing link. When an injured link exists, use normal conversion without an additional fallback. Do not route around a heal absorb by pretending an injured recipient is full.
4. Add a friendly **Scouring Mercy rescue cleave**: after healing the selected ally, heal up to two other nearby injured party/raid players for 50% of the effective primary heal each, within 10 yards of that primary ally. Keep 75 mana and the eight-second cooldown. Cap three total recipients for both five-player and raid groups.
5. Cleave copies are noncrit, cannot trigger weapon procs, re-echo, create links or multiply source bonuses again. Select by missing-health fraction then stable entity ID; preserve target-side healing/absorb rules. Use an explicit copied-heal resolution helper or secondary-target modifier step: applyHeal(alreadyResolved=true) currently skips both source and target multipliers, so that flag alone cannot satisfy this behavior. A fully overhealed primary produces no rescue copies.

Recommend valid conversion recipients be living friendly players in the current group within the priest's 30-yard Psalm reach, with deterministic fallback ordering. **This is also a targeting correction:** the existing conversion loop does not enforce current group/range membership. Test and disclose lost out-of-range/stale-link healing rather than counting the whole package as an unconditional healing buff.

Do not grant Benison's Choirmend or Sunburst Canticle wholesale: both are explicitly holy-only. Doctrine retains optional Choir of Deliverance for occasional broad recovery. The proposed rescue gives routine three-player recovery while retaining tank/spot-healer identity.

For one injured linked tank, 30% stronger triggering damage raises potential conversion by 30%, before healing demand and other effects. Twin's two links also inherit stronger attacks; this may substantially improve healing and must be measured before any additional link-rate change.

Evaluate 1/5/10-player demand, tank spikes, distributed damage, own shields actually consumed, deaths, recovery time, mana and damage. Include all capstones, Emberscreed 0/2/4pc and multiple priests. A later two-baseline-link redesign remains an option only if this package fails proper level-20 testing; it is not the initial recommendation.

## Delivery phases after design agreement

### 1. Establish reliable before-change fixtures

Outcome: a trustworthy reference for every target and its siblings.

Use current legal ordinary gear, optimized gear and profession gear as separate profiles. Freeze exact equipment, rows, level, mitigation, buffs, source ownership and 24 paired seeds. Fail invalid talent allocations; do not silently substitute rows or drop zero-output runs.

Extend the real-Sim probes with current rotations, both Wildfang forms, Sunmender, proper Doctrine conversion play, and actual five-target support. Add practiced and simplified policies for the two gameplay changes. Attribute pet/copy output at event time so deaths/despawns do not lose ownership.

Run 180-second single target, 60-second burst and 60-second five-target finite-resource profiles per the measurement contract, plus movement and encounter checks. Healers need fixed tank/spread-damage schedules, including sustained pressure and mana exhaustion.

Exit: recorded baseline results and valid policies. No database or production changes are needed.

### 2. Primary scaling and numeric class slices

Outcome: complete primary amounts receive the intended spec-only adjustment.

Reproduce the three scaling gaps first: Wildbloom replant, Aegis and Dirge SP. Record original → corrected → tuned output. Add the narrow offensive/healing seams and explicit custom sources, one owner per shared file.

Tests cover full base-plus-power amounts, autos, pets, channels, HoTs, copies, caps, no-spec, leveling, respec and equipment changes. Pin untouched sibling packets at identical inputs; compare sibling aggregate profiles separately, recognizing that changed kills/procs can alter global RNG consumption.

Exit: competent sustained profiles within a proposed two percentage points of the target, with uncertainty reported. Burst, AoE, healing effectiveness and PvP are separate evidence. Do not widen bands or stack bug fixes silently.

### 3. Four gameplay slices

Outcome: Skulduggery frontload, range-wide Dirge, Coldsight shot choice and Doctrine rescue each work independently.

Each slice includes real-path tests for grants, consumption, ownership, timing and copies; visible state where needed; accurate English tooltips; and wiki updates. Preserve saved talent IDs. Any new simulation state/interface must have Sim/ClientWorld, command/snapshot and headless parity in the same slice.

Exit: no repeated grants, stale reservations, unbounded extension, duplicated source scaling or unintended recipients; practiced play has meaningful timing/target decisions and the combined budget remains in range.

### 4. Integrated QA and PBE validation

Outcome: reviewed implementation with explicit evidence and remaining risks.

Run scoped suites, then the applicable checks from docs/qa-gate.md. Relevant existing families include:

- spec_baselines, talent_full_hit_scaling;
- priest_doctrine, priest_vespers, priest_talent_mechanics;
- shaman_spiritmend, shaman_thundercall and their engine suites;
- paladin_aegis, paladin_beacon, druid_engines;
- rogue_engines, hunter_spec_loops;
- warlock_anchor_destruction/demonology and owned_class_balance;
- ability_tooltip_consistency, ability_tooltip_talents and affected set-bonus suites.

Typical scoped command: npm test -- tests/spec_baselines.test.ts tests/talent_full_hit_scaling.test.ts, adding the owning class suites per slice. Follow the repository's current typecheck/build/i18n commands; npm run wiki:content refreshes generated content. Run node scripts/gate_select.mjs or the deeper npm run gate when the canonical gate requires it. No implementation gate was run for this research artifact.

Use the tooltip skill for actual copy. Current tooltip SP calculations have talent/AoE/channel discrepancies in the affected healing paths: display the same completed amount calculation used by combat. Pass read-only tuning metadata with resolved abilities, preserving existing authoritative state. Applied aura tooltips read their stored value.

Request focused sim architecture/test coverage review, parity review if state changes and frontend review for new readiness UI. Do not expand this task into parse-service schema or shield-attribution storage changes.

PBE comparison must control level, encounter, difficulty, build, gear, duration and external buffs, reporting unique-character counts and uncertainty. These requested relative changes alone do not prove all DPS specs meet the design's 10-15% parity goal.

## Research protocol, commands and limits

The research worktree contains only this untracked proposal. Sim experiments changed baseline objects or wrapped calls in isolated scratch processes; gameplay files were not edited. These are sensitivity experiments, not validated production implementations.

| Experiment | Protocol and limitations |
| --- | --- |
| Caster/Wolf, 16 runs | Seeds 42/1337, 120 seconds, level-22 Nythraxis armor, existing frozen owned-class/warlock fixtures. Warlock probe includes prepared summons/resources. Caster mana endpoints unchanged; warlock starvation zero. |
| Bruin, four runs | Same two seeds, 30-second existing live-mob probe. Mean damage 2340 → 2563. Large per-seed variation. Raw arm labels were overwritten by the probe; labelled receipt reconstructs before/candidate from preserved loop order. |
| Knifework/Fieldcraft/Coldsight numeric, 63 runs | Seeds 4242/777/1313, 15/60/120 seconds. Empty ambient world. Rogue level-20 dummy with 798 armor; hunters level-22 Nythraxis. Identical equipped IDs per before/candidate pair. Rogue epic-picker reference gear and Venom Dividend/Second Shadow; hunters frozen PBE gear and no choice rows. |
| Skulduggery, 36 runs | Same three seeds/durations, level-20 dummy/798 armor, behind target. Fight 78192 equipment/talents, no external raid buffs. With/without initial stealth, simple rotation, no offensive cooldowns or damaging finishers. Wrappers model the candidate at existing effect/aura seams. |
| Coldsight shot choice, 27 runs | Same hunter profile, baseline/numeric/Long Draw mechanic arms. Stationary only; no target death/incoming damage. Wrapper detects completion heuristically and spends at impact. Real implementation must reserve at accepted cast and test completion explicitly. |
| Healing arithmetic | Level 20, no choice rows, 100 Healing Power, current modifiers/ranks. Candidate amounts are round(raw × factor), not changed-gameplay healing simulations. |

Existing healer diagnostic probes also exposed invalid acceptance assumptions: the three-ally Doctrine policy churns links and rarely attacks; Groveheart uses neither Regrowth nor Overbloom and produces substantial overheal. They diagnose the harness, not class ceilings. Owned-class multi-target helpers currently support one or three targets, not the required five.

Scratch receipts (temporary local evidence, not permanent repository assets):

- /tmp/woc-v042-balance-research/  -  public API client and saved fights.
- /tmp/woc-caster-balance-sweep.ts, .mjs, .jsonl.
- /tmp/woc-bruin-balance-sweep.ts, .mjs, .jsonl and -labelled.json.
- /tmp/woc-rh-matrix.ts and /tmp/woc-rh-matrix-results.jsonl.
- /tmp/woc-skulduggery-frontload.ts and /tmp/woc-skulduggery-frontload-results.jsonl.
- /tmp/woc-coldsight-read.ts and /tmp/woc-coldsight-read-results.jsonl.
- /tmp/woc-rh-research-commands.txt  -  exact bundle/run commands.
- /tmp/woc-v042-healing-concrete.md  -  raw-primary/display inventory and arithmetic.

Experiments bundled pinned source with the main checkout's installed esbuild, then ran node on the resulting .mjs file. Command shape:

    <main-checkout>/node_modules/.bin/esbuild /tmp/woc-rh-matrix.ts --bundle --platform=node --format=esm --outfile=/tmp/woc-rh-matrix.mjs
    node /tmp/woc-rh-matrix.mjs > /tmp/woc-rh-matrix-results.jsonl

The caster entries used equivalent esbuild.buildSync options, additionally target: node22. All completed probe commands exited successfully. The parent independently read scripts and recomputed reported numeric, caster, Skulduggery and Coldsight aggregate changes from JSON receipts.

At research completion, no commits, pushes, PRs, gameplay changes, merges or deployments had been performed. Reuben subsequently authorized implementation of this proposal; see class-balance-v042-progress.md for current delivery state.
