# Warlock overhaul

Status: living design document

Branch: `feature/warlock-overhaul`

Base: `release/v0.31.0`

Comparative archetype research and the prioritized gap audit live in
[`warlock-specialization-research.md`](./warlock-specialization-research.md).

## Goal

Rebuild the Warlock as three complete, equally supported damage specializations with
distinct combat identities, rotations, strengths, weaknesses, and talent decisions.
This is an identity overhaul, not a numerical tuning pass.

The work should preserve existing characters and action bars wherever practical. Stable
internal identifiers should remain in place even when a player-facing name or theme
changes.

## Shared design rules

All three specializations must receive equal design support:

- The same number of specialization talent nodes.
- The same row and column structure.
- The same point gates and total point budget.
- The same number of passive, active, and choice opportunities.
- Comparable power at equivalent investment.
- A signature ability and a mastery that materially affect the rotation.

Equal structure does not mean identical effects. Each tree should reinforce its own
combat identity.

The shared class tree must contain tools that are useful to all three specializations.
It must not quietly favor one specialization through school-specific or pet-specific
bonuses.

Every percentage and base value remains provisional until it is tested through the
same deterministic benchmark and multi-seed Monte Carlo suite.

## Shared Warlock foundation

The common kit is smaller and clearer than the complete specialization kits:

- Hard Bargain as health-to-mana conversion.
- Harrow as crowd control.
- Fiendhide as the active armor buff.
- Umbral Anchor as shared tactical mobility: place a return rune, then consume it to
  teleport back from within 40 yards.
- Abyssal Gag as the shared interrupt.

Damage fillers, periodic damage, summons, and repeatable self-healing belong to the
specialization kits rather than the shared foundation.

The overhaul must measure the healer burden created by Life Tap. Mana gained is not free
when another player must restore the health spent.

## Shared class talent rows

The Warlock uses the existing Talents V2 model: choose one specialization, then choose
one of three class-wide options at levels 5, 8, 11, 14, 17, and 20. Every option must
remain live for Affliction, Necromancy, and Destruction.

| Level | Job | Options |
|---:|---|---|
| 5 | Mobility | Grave Rhythm shortens Umbral Anchor; Blacktide grants 40% movement speed for 4 sec after returning; Sacrilegious March is a toggled 35% speed increase that drains 2% maximum health each second and ends at 20% health. |
| 8 | Crowd control | Abyssal Gag unlocks the interrupt early and upgrades it to a 4 sec silence; Dread Chorus supplies area fear; Leaden Hex stacks a 5% slow up to 15%, then the next damaging spell roots for 1.5 sec and consumes the stacks. |
| 11 | Survival | Pact Deepened strengthens Fiendhide; Sanguine Covenant trades 10% current health for a 30% maximum-health absorb; Deep Hunger grants 15% damage reduction and damage-pushback immunity while channeling Consume. Deep Hunger needs a Necromancy replacement now that Consume is not part of that kit. |
| 14 | Resource behavior | Deepened Hex discounts the active spec's generator; Blood Credit improves Hard Bargain's mana return; Shadow Credit grants one or two free generators when at least 40% or 80% of the specialization resource is spent at once. |
| 17 | Major offense | Grand Malediction shortens the active spec's signature setup cooldown; Ashen Focus shortens generator casts by 20% after standing still for 1 sec; Hexstorm periodically makes the next generator instant. |
| 20 | Capstone utility | Unbroken Ritual turns casting time into class and specialization cooldown recovery; Forbidden Reflection permits one repeat of the first eligible Warlock cooldown used in each 60 sec window, excluding Soulwell and Army of the Dead; Abyssal Rift pulls enemies within 8 yards, deals heavy Shadow damage, and stuns non-bosses for 2 sec. |

Stable `wlk_r*` option identifiers are retained so persisted allocations repair to the
new class-wide behavior instead of losing their row selections.

## Affliction

### Identity

Affliction is an active curse conductor, not a conventional damage-over-time
specialization. It names one enemy with Evil Eye, turns actions by enemies and allies
into Condemnation, then chooses when to spend the entire pool with Sentence. Its pressure
comes from reading the encounter and engineering dangerous situations rather than
maintaining a checklist of periodic effects.

### Core gameplay

- Condemnation is an integer resource from 0 to 100, displayed in a dedicated HUD meter.
- The whole pool expires after 20 seconds without generation. Every generation event
  refreshes that timer; moving Evil Eye does not.
- Evil Eye marks exactly one primary enemy. Recasting it moves the mark while preserving
  the current Condemnation amount and expiry.
- The Maledict Eye is Affliction's sole companion. Maledict Gaze attacks only the
  selected primary Eye every 2.5 seconds in combat; it never auto-pulls and uses a
  direct green-and-violet ray rather than a generic projectile.
- Needle of Fate applies Evil Eye only when no living primary mark exists. It generates
  Condemnation only when it strikes an enemy bearing one of the caster's Eyes.
- Litany of Guilt turns Condemnation gains into bounded cleave around the primary Eye
  without creating secondary Eyes or replacing Coven's major multi-target window.
- Enemy attacks, Consume, Cursed Accomplice, Hex of Violence, Cruel Pact, Vicarious
  Suffering, and Coven all provide distinct ways to generate Condemnation.
- Sentence requires the primary Evil Eye and consumes the entire pool. Its damage and
  extra effects escalate at 20, 50, 80, and 100 Condemnation. To contain endgame burst,
  its level scaling flattens after level 16 and reaches a 0.8 multiplier at level 20.
- Coven is the deliberate multi-target cooldown: it creates up to four temporary
  secondary Eyes, which generate at half strength and receive Sentence echoes.

### Ability progression

| Level | Ability | Mana | Cast | Cooldown | Range | Condemnation and behavior |
|---|---|---:|---:|---:|---:|---|
| 5 | Evil Eye | 15 | Instant | 1 sec | 30 | Moves the single primary Eye. Does not generate or refresh Condemnation. |
| 5 | Maledict Gaze | Passive | -- | -- | 30 | The companion attacks the selected primary Eye for 5/9/14 Shadow damage at levels 5/12/20. Possession halves its 2.5 sec attack interval. |
| 5 | Needle of Fate | 25/30/35 | 1.5 sec | None | 30 | Deals 18-22, 32-38, or 48-56 Shadow damage at levels 5, 12, and 20. Generates 5 on the primary Eye. |
| 5 | Sentence | 40 | Instant | None | 30 | Requires at least 20 and the primary Eye. Consumes the full pool, uses 138/400/750/1100 base damage at 20/50/80/100, flattens its scaling after level 16, and generates 35% of normal threat. |
| 7 | Cursed Accomplice | 40 | Instant | None | 40 | With no allied player selected, links the Maledict Eye and its Gaze generates 2. With an allied player selected, their damage to an Eye generates 3. One link; at most once every 2 sec. |
| 9 | Consume | 40/55/70 | 5 sec channel | None | 20 | Shared Warlock spell with five ticks for 7/12/17 damage at levels 9, 14, and 20. It transfers 70% of that damage as health; Affliction transfers the full amount and generates 2 Condemnation per primary-Eye tick plus 5 on completion. |
| 11 | Litany of Guilt | 50/65 | Instant | 20 sec | 30 | For 8 sec, Condemnation gains damage up to four other enemies within 8 yards of the primary Eye, at most once per second. |
| 12 | Hex of Violence | 55 | Instant | 15 sec | 30 | For 8 sec, the enemy's next three damaging actions each generate 7 and retaliate for 22 Shadow damage. |
| 14 | Cruel Pact | 0 | Instant | 20 sec | Self | Replaces Hard Bargain for Affliction. Sacrifices 12% maximum health, restores 15% maximum mana, and generates 20 Condemnation. Unusable at or below 20% health. |
| 16 | Vicarious Suffering | 50 | Instant | 30 sec | 40 | Marks self or an ally for 8 sec. Hostile hits generate 3 each, up to 15 total. Self-casts reduce damage by 20%; allied casts redirect up to 20% without taking the Warlock below 15% health. |
| 13 | Possess the Evil Eye | 75 | Instant, off GCD | 45 sec | 30 | Grants 35 Condemnation and possesses the primary Eye for 15 sec. Needle casts in 1 sec and generates 2 extra, Consume can move, and Sentence deals 25% more damage. Its 60% delayed echo tapers to 30% across levels 17-20. |
| 20 | Hour of Judgment | 0 | Instant, off GCD | 90 sec | 30 | Grants 40 Condemnation and three Fate Threads, activates Possession for 15 sec, doubles primary-Eye generation, increases Sentence damage by 20%, and makes the first Sentence refund 50 Condemnation. |
| 20 | Coven | 120 | Instant | 90 sec | 30 | Requires the primary Eye. Adds up to four secondary Eyes for 15 sec within 15 yards. |

At 50 Condemnation, Sentence heals the Warlock for 20% of primary damage dealt. At 80,
it also deals 35% splash damage within 8 yards. At 100, it deals 20% more damage to
players and bosses, and executes non-elite normal enemies below 20% health.

Secondary Eyes generate 50% of the normal amount, rounded to the nearest whole point per
event, and receive a 35% Sentence echo. The shared resource remains capped at 100.

### Strengths

- Encounter-reactive resource generation.
- Planned burst with a visible risk-reward timer.
- Strong synergy with allies without copying their damage.
- Self-healing and emergency health-for-power conversion.
- A level-20 multi-target window without permanent multi-DoT maintenance.

### Weaknesses

- Losing the whole pool after 20 seconds of inactivity.
- Sentence commits the complete pool, so poor timing is expensive.
- Lower generation when enemies cannot act or allies cannot reach the Eye.
- Evil Eye placement and target switching demand attention.
- Cruel Pact replaces Hard Bargain at level 14 and combines its mana return with
  Affliction's health-paid Condemnation generation.

### Talent directions

The tree should offer equally viable paths for:

- Faster but riskier Condemnation generation.
- Stronger ally, pet, and enemy-action manipulation.
- Sentence thresholds, echoes, and spending decisions.
- Vitality stealing and personal survival.

The shared choice rows must resolve through each specialization's actual kit. Deepened
Hex empowers Needle of Fate, Essence Reap, or Gloom Bolt; Hexstorm can make the next of
those generators instant; Grand Malediction reduces the signature setup cooldown of
Affliction, Necromancy, or Destruction rather than granting a dead spell-specific bonus.

## Demonology internal ID, Necromancy player identity

### Compatibility rule

Keep the internal specialization ID `demonology` unless a migration proves that every
persisted build, action bar, command, guide reference, and network surface can safely
change. The player-facing specialization may be renamed to Necromancy or another agreed
name without changing that internal ID.

### Identity

Necromancy commands one persistent guardian and chooses two persistent undead for its
Dominion. The Warlock prepares souls, chooses a servant composition, and coordinates a
power window instead of playing as another direct-damage caster.

### Core gameplay

- Maintain one persistent guardian.
- Generate Soul Fragments through Essence Reap and enemy deaths.
- Spend fragments to fill two Dominion slots with unique Skeletal Warrior, Bone Mage,
  or Gravewing servants. Recasting an active archetype or summoning into a full
  Dominion does nothing and spends no resources.
- Funeral Harvest grants one fragment from an enemy recently damaged by the Warlock or
  their undead, with a three-second internal cooldown.
- Reaping Command spends two fragments to make every active undead strike the selected
  target in unison, retaining each servant's cleave profile.
- Dominion servants persist until slain, sacrificed, dismissed, or the specialization
  changes. They have no upkeep timer.
- Army of the Dead is the level-16 assault summon. It tears open a grave portal and
  raises a temporary Warrior, Bone Mage, and Gravewing for 20 seconds in addition to
  the current Dominion. The chosen servants remain afterward.
- Keep the owner kit focused: Gloom Bolt, Burning Pact, Blackrot, Hex of Anguish,
  Consume, and Sear are not available to committed Necromancy.
- Soul Lance enters at level 9 as an 8 sec caster-owned nuke. It costs mana, not
  Soul Fragments, and contributes another 50% of its landed damage to Ossuary Mark.
- Ossuary Mark enters at level 12. It stores 20% of landed damage from the
  Necromancer and their undead for 12 sec, can be detonated early, and turns a
  marked death into a 6 yard burst plus one Soul Fragment.
- Corpse Explosion is an 8 sec ground-targeted conversion. It sacrifices Bone Mage
  first, Skeletal Warrior second, and Gravewing only as a last resort. Duplicates of the
  same archetype are ordered by remaining duration, health percentage, and entity ID.
  Graveguard is never eligible. The open Dominion slot can be filled by any archetype.
- Let minion choice or talent choices alter the damage profile.
- Redirect part of incoming damage to the persistent guardian.
- Sacrifice a minion for health, mana, defense, or immediate damage.
- Transform Metamorphosis into a Lich Form or similar command window.

Soul Fragments should initially be evaluated as deterministic aura stacks. A new primary
resource is justified only if aura stacks cannot provide clear gameplay and UI.

### Strengths

- Strong planned damage windows.
- High combined owner and minion damage.
- Best Warlock durability.
- Flexible minion utility.

### Weaknesses

- Loses substantial output when the guardian dies or cannot connect.
- Requires setup before its main damage window.
- More affected by pet pathing and target switching.
- Direct caster damage should trail Destruction.

### Talent directions

The tree should offer equally viable paths for:

- A two-servant composition selected from distinct damage and utility profiles.
- One empowered guardian or champion.
- Sacrificing minions to empower the Warlock.

### Technical limits

Avoid an unlimited permanent army. Keep one persistent guardian and exactly two bounded
Dominion slots with one servant per archetype. Army of the Dead adds one complete
temporary wave for 20 seconds without altering those persistent slots. Confirm
pathfinding, target selection, owner death behavior, threat, network snapshots, and
entity cleanup in tests.

## Destruction

### Identity

Destruction is the Warlock's direct burst caster. It combines fire and shadow, prepares
targets with Burning Pact, and converts that setup into critical strikes and executions.

### Core gameplay

- Maintain Burning Pact when its remaining periodic value matters.
- Use Conflagrate as a deliberate conversion of Burning Pact, not an automatic cooldown
  press that always destroys valuable damage.
- Cast Gloom Bolt or another direct spell as sustained filler.
- Use Duskfire as an instant burst or execute tool.
- Use Rain of Fire for clustered targets.
- Build toward a visible burst window based on critical strikes or destructive charges.

### Strengths

- Immediate and planned burst.
- Execute damage.
- Strong clustered area damage.
- Clear priority rotation.

### Weaknesses

- Loses more output while moving.
- Lower self-healing than Affliction.
- Higher mana pressure or setup cost.
- Vulnerable to interrupted long casts.

### Talent directions

The tree should offer equally viable paths for:

- Critical strike burst.
- Burning Pact and Conflagrate interaction.
- Duskfire execution and shadow damage.

## Existing summons and compatibility

The current summoned creatures should not be deleted as a first step. Their internal
ability and creature identifiers may already be referenced by action bars, tests, guide
content, or saved state.

During implementation, classify every current summon as one of:

- A shared utility demon.
- A Necromancy guardian.
- A temporary cooldown summon.
- A compatibility-only ability that remains resolvable but is no longer newly granted.

Player-facing names and visuals can change independently after compatibility is pinned.

## Balance benchmark

Establish a no-change baseline before the first tuning change. Run every specialization
with equivalent gear tier, valid optimized talents, and a rotation that represents its
actual design.

Use at least these encounter profiles:

1. A stationary target at short, medium, and long durations.
2. Normal Nythraxis with near-Heroic gear.
3. A movement and target-switching encounter.
4. A clustered multi-target encounter.

Use multiple deterministic seeds per profile. Report:

- Player DPS.
- Pet and temporary minion DPS.
- Combined DPS.
- Burst-window and sustained DPS.
- Time to full ramp.
- DoT uptime and early refresh loss.
- Mana remaining and Life Tap count.
- Health spent through Life Tap.
- Self-healing and absorbs.
- External healing required.
- Guardian and temporary minion uptime.
- Death rate and kill rate.

Never compare Demonology or Necromancy through owner damage alone.

## Implementation sequence

### Phase 1: baseline and contracts

- Pin the current Warlock kit, talents, summons, persistence surfaces, and action-bar IDs.
- Replace simplistic benchmark rotations with specialization-aware decisions.
- Add multi-seed output and separate owner, pet, and total damage.
- Record the baseline before behavior changes.

### Phase 2: shared class foundation

- Decide the shared ability kit.
- Rebuild the class talent tree without specialization bias.
- Add tests for every shared active and choice.

### Phase 3: one specialization at a time

- Implement Affliction and validate its ramp, sustain, and movement profile.
- Implement Necromancy and validate every minion lifecycle and combined damage path.
- Implement Destruction and validate setup, burst, execution, and movement weakness.

Each specialization must be playable and tested before starting the next one.

### Phase 4: parity, presentation, and balance

- Update ability and talent tooltips.
- Update icons, effects, guide content, and English localization sources.
- Verify offline, server, and headless parity.
- Run the multi-seed benchmark after every tuning group.
- Run the complete contribution gate before proposing the pull request.

## Decisions to make together

These questions remain intentionally open:

- Final player-facing name for the Necromancy specialization.
- Undead, spectral, demonic, or mixed visual language.
- Which summon remains the shared baseline companion.
- Exact Soul Fragment generation and spending rules.
- Whether Conflagrate consumes Burning Pact, copies it, or converts its remaining damage.
- Final tuning for Condemnation generation, Sentence thresholds, and Coven echoes.
- The final shared defensive and raid utility package.
- Which specialization should lead on single-target, multi-target, and short burst by
  what measured margin.

No production values should be finalized until these identity decisions are resolved.
