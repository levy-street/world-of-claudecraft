# Warlock specialization comparative research

Status: design research, based on the live level-20 implementation on 2026-07-30.

This document compares World of ClaudeCraft's Affliction, Necromancy, and Destruction
specializations with related archetypes in other games. It extracts useful combat
decisions rather than copying names, rotations, or complete kits.

## Executive conclusion

The three specializations do not need the same kind of expansion:

| Specialization | Current state | Most important missing layer | What not to add |
| --- | --- | --- | --- |
| Necromancy | The new Soul Lance and Ossuary Mark loop gives the owner meaningful combat between summons. | Death must have a spatial presence, and army composition must change more than damage delivery. | Another summon button or another standalone nuke. |
| Affliction | Evil Eye and Condemnation create a distinctive reactive curse conductor. | The victim needs a persistent, visible state of deterioration that is part of the Condemnation loop. | A conventional checklist of three or four independent damage-over-time effects. |
| Destruction | Ruin, Desolation, Brand, Rain of Fire, and Pyre Colossus already form a complete siege-caster loop. | Clean up the pet inventory, improve progression pacing, and make every payoff feel catastrophic through presentation. | Another resource, another maintenance effect, or another permanent pet. |

Necromancy has the largest remaining mechanical gap. Affliction has the clearest
identity-expression gap. Destruction needs the least new mechanics.

## Method

The audit uses the abilities actually returned by `abilitiesKnownAt()` at level 20,
not only the intended inventory in design prose. This matters because the current
implementation still exposes some legacy spells which earlier design decisions intend
to remove.

The comparison set was selected to cover distinct interpretations of each fantasy:

- Minion command, corpse economy, sacrifice, and transformation.
- Curses, spreading pressure, condition conversion, and self-inflicted risk.
- Hard-cast burst, builder-spender pacing, delayed impact, ground control, and
  multi-target conversion.

The useful unit of comparison is a combat verb or decision. Raw ability count is not a
quality target.

## Cross-game findings

### Necromancy archetypes

#### Diablo II, Diablo III, and Diablo IV

Diablo's Necromancers consistently join three systems:

1. A conventional resource for owner-cast spells.
2. Corpses as a second, spatial resource.
3. An army which can be commanded, customized, or sacrificed.

Diablo III describes Essence, corpses, minions, curses, health sacrifice, and the chain
reaction that begins after the first death as parts of one class identity. Its active
kit includes Corpse Explosion, Corpse Lance, Command Skeletons, Devour, Revive, and
Bone Spirit. Devour can turn corpses into Essence, health, cost reduction, or even
consume minions. [Diablo III Necromancer overview](https://kr.diablo3.blizzard.com/en-gb/class/necromancer/),
[Diablo III progression](https://kr.diablo3.blizzard.com/en-us/class/necromancer/progression),
[Diablo III Devour](https://eu.diablo3.blizzard.com/en-gb/class/necromancer/active/devour)

Diablo IV makes the two-resource model explicit: Essence pays for ordinary skills,
while corpses occupy battlefield positions and can raise minions or power attacks.
The Book of the Dead then makes army composition a build decision: warriors, mages,
and golems have variants, upgrades, and sacrifice tradeoffs.
[Diablo IV Necromancer deep dive](https://news.blizzard.com/en-us/article/23816542/diablo-iv-quarterly-updatejune-2022)

The 2026 Diablo IV revision strengthens direct command. Warriors are raised from
corpses and can be ordered onto targets, mages are purchased with Essence, and
Sacrifice can retain a weaker army when the player wants minions primarily for
support or tanking. This is valuable because minion choice changes both the economy
and the command loop, not only passive damage.
[Diablo IV 2026 class changes](https://news.blizzard.com/en-us/article/24267729/prepare-for-the-reckoning-lord-of-hatred-draws-near)

#### Guild Wars 2

Guild Wars 2 turns nearby deaths and selected skills into Life Force. Different
Necromancer specializations spend the same resource in fundamentally different ways:

- Core Death Shroud supplies a temporary second health pool and a replacement skill
  bar.
- Reaper Shroud becomes an offensive melee form.
- Scourge places shades which reproduce commands at remote locations.
- Harbinger accepts lower maximum health for a more aggressive form.

This shows why a transformation is stronger when it changes available verbs and risk,
not only damage and cast-speed multipliers.
[Guild Wars 2 Life Force](https://wiki.guildwars2.com/wiki/Life_force),
[Guild Wars 2 Shroud](https://wiki.guildwars2.com/wiki/Shroud),
[Guild Wars 2 Scourge](https://wiki.guildwars2.com/wiki/Scourge),
[Guild Wars 2 Harbinger Shroud](https://wiki.guildwars2.com/wiki/Harbinger_Shroud)

Its ordinary minions also have a useful interaction contract: some can be ordered to
perform a special attack and others can be sacrificed for an effect. The summon button
therefore remains relevant after the creature appears.
[Guild Wars 2 minions](https://wiki.guildwars2.com/wiki/Minions)

#### Last Epoch

Last Epoch demonstrates that minion customization can produce radically different
play without adding more hotbar buttons. Skeletal Mages can become one larger Archmage
instead of several bodies. Dread Shade buffs minions while consuming their health and
can be transformed into a single-target buff, an area aura, a taunt, a defensive pact,
or a death chain. Sacrifice converts an existing minion into immediate area damage.
[Last Epoch Necromancer skills](https://support.lastepoch.com/hc/en-us/articles/46363167297563-Necromancer-Skills),
[Last Epoch Necromancer skill trees](https://support.lastepoch.com/hc/en-us/articles/46362910971547-Necromancer-Skill-Tree)

The important lesson is not the size of its talent trees. It is that one summoned body
can be a resource, a risk, a locus for an aura, or an active weapon.

#### The Elder Scrolls Online and Grim Dawn

The Elder Scrolls Online spreads the corpse theme across offense, defense, and healing.
The class page describes corpses as a resource used to empower attacks, protect the
caster, and restore allies. This makes death a class-wide grammar rather than the cost
of one summon.
[The Elder Scrolls Online classes](https://www.elderscrollsonline.com/en-gb/classes)

Grim Dawn combines skeletons with direct vitality theft, disease, rot, and Reap Spirit,
an owner-cast attack which creates an aggressive spirit. That last pattern is especially
relevant to Soul Lance: a caster action can feed the army fantasy without becoming
another summon-management button.
[Grim Dawn Necromancer](https://www.grimdawn.com/guide/character/masteries/necromancer/)

### Affliction archetypes

#### World of Warcraft

Modern World of Warcraft Affliction is still a generator-spender specialization, but
its resource is supported by persistent ailments. Current play maintains effects such
as Agony and Corruption, spends shards on Unstable Affliction, pools for a Darkglare
window, and can refresh damage-over-time effects while moving. Its identity therefore
remains visible on the victim even while the player is not spending.
[Current Affliction rotation reference](https://www.wowhead.com/fr/guide/classes/warlock/affliction/rotation-cooldowns-pve-dps)

This comparison does not imply that World of ClaudeCraft should restore a multi-DoT
checklist. It does show that an Affliction victim should appear afflicted between the
setup and payoff.

#### Path of Exile

Essence Drain and Contagion form a two-step relationship: one applies damaging,
life-returning decay, while the other spreads it when an affected enemy dies. Wither
stacks vulnerability and slows rather than being another copy of the same damage
effect. The result has application, amplification, death payoff, and sustain as
different verbs.
[Path of Exile 2.1 skill announcement](https://webcdn.pathofexile.com/forum/view-thread/1489915/filter-account-type/staff)

Hexblast supplies a second pattern: build a curse state, then consume it for a more
powerful direct event and an area shockwave. This validates the setup-and-sentence
direction of World of ClaudeCraft Affliction, while also showing why the curse state
itself needs strong feedback.
[Path of Exile Hexblast explanation](https://www.pathofexile.com/forum/view-thread/2934168)

#### Last Epoch Warlock

Last Epoch makes curse count a scaling axis. Damage, defense, leech, cast speed, and
secondary triggers can all depend on whether or how heavily a target is cursed. It
also uses self-curse and health costs to turn forbidden power into risk.
[Last Epoch Warlock passives](https://support.lastepoch.com/hc/en-us/articles/46363418691739-Warlock-Passive-Tree)

Its active skill trees demonstrate interaction rather than upkeep:

- Chaos Bolts can refresh curses or trigger another curse.
- Soul Feast requires cursed targets, pulls fragments back to the caster, and can
  spread curses.
- Profane Veil can consume minions, apply curses to both sides, or convert danger into
  mobility and defense.
- Chthonic Fissure creates a persistent source which releases spirits and spreads
  ailments.

[Last Epoch Warlock skills](https://support.lastepoch.com/hc/en-us/articles/46363182371611-Warlock-Skills),
[Last Epoch Warlock skill trees](https://support.lastepoch.com/hc/en-us/articles/46362965632027-Warlock-Skill-Tree)

#### Guild Wars 2 and Grim Dawn

Guild Wars 2 Scourge uses remote shades as extensions of the caster, turns enemy boons
into harmful conditions, and can convert pressure into ally protection. Core
Necromancer traits also let condition damage return health and let corruption skills
harm the caster as part of their cost.
[Guild Wars 2 Scourge](https://wiki.guildwars2.com/wiki/Scourge),
[Guild Wars 2 Necromancer traits](https://wiki.guildwars2.com/wiki/List_of_necromancer_traits),
[Guild Wars 2 Corruption skills](https://wiki.guildwars2.com/wiki/Corruption)

Grim Dawn's Occultist combines a spreading plague, defense-breaking curses, a
life-draining sigil, a familiar, and possession. Its useful lesson is that "affliction"
can be expressed through spread, debilitation, and theft without requiring every
button to be a periodic damage effect.
[Grim Dawn Occultist](https://www.grimdawn.com/guide/character/masteries/occultist/)

### Destruction archetypes

#### World of Warcraft

World of Warcraft Destruction has a durable core:

- Incinerate and Conflagrate generate shards.
- Chaos Bolt and Rain of Fire compete for those shards.
- Immolate provides persistent setup.
- Shadowburn rewards correctly predicting a death.
- Havoc turns a second target into a temporary efficiency window.
- Infernal adds impact, area pressure, and resource or spender interactions.

[Current Destruction rotation reference](https://www.icy-veins.com/wow/destruction-warlock-pve-dps-rotation-cooldowns-abilities)

World of ClaudeCraft already implements equivalents for nearly all of these decisions.
Ruinous Brand is more bounded than Havoc, which is appropriate for the smaller level-20
game and easier to balance.

#### Final Fantasy XIV Black Mage

Black Mage is useful as a hard-cast comparison rather than a thematic template. It
alternates a high-output, high-cost fire state with a recovery state, rewards
maintaining its state long enough to earn additional resources, and uses limited
instant-cast tools to solve movement without removing cast commitment.
[Final Fantasy XIV Black Mage job guide](https://na.finalfantasyxiv.com/jobguide/blackmage/)

The lesson is that a stationary caster needs planned relief and a visible cadence.
It does not need unrestricted casting while moving. Desolation, Conflagrate charges,
Duskfire, and Umbral Anchor can serve that role in World of ClaudeCraft.

#### Lost Ark Sorceress

Lost Ark's Igniter pattern builds a meter, then commits it to a short window which
reduces cooldowns and raises critical output. Its delayed, heavy spells make encounter
knowledge part of burst execution.
[Lost Ark Sorceress balance reference](https://www.playlostark.com/en-gb/game/releases/arkesia-ignited)

This supports a visible preparation-and-release rhythm, but copying its separate burst
meter would be redundant beside Ruin and Desolation.

#### Grim Dawn and Diablo II: Reign of the Warlock

Grim Dawn's Demolitionist uses fire as battlefield geometry: persistent ground fire,
mines, thrown explosives, stuns, and large-area fragmentation. Its identity comes as
much from where destruction happens as from damage numbers.
[Grim Dawn Demolitionist](https://www.grimdawn.com/guide/character/masteries/demolitionist/)

Diablo II's 2026 Warlock divides demon binding, hexed weapons, and Arts of Chaos. The
Chaos tree combines hellfire and void projectiles with Miasma, Apocalypse, and a
vacuum-like Abyss. It reinforces the visual expectation that high-level destructive
magic should alter the battlefield.
[Diablo II Reign of the Warlock](https://news.blizzard.com/en-us/article/24243863/rain-annihilation-in-reign-of-the-warlock)

## Audit of the current World of ClaudeCraft kits

### Necromancy

#### Current level-20 kit

- Shared class tools: Fiendhide, Hard Bargain, Umbral Anchor, Harrow, and Abyssal Gag.
- Owner offense: Essence Reap, Soul Lance, Ossuary Mark, and Corpse Explosion.
- Army: Graveguard, Skeletal Warrior, Bone Mage, Gravewing, Unholy Command, and
  Reaping Command.
- Warrior, Bone Mage, and Gravewing are persistent, unique Dominion choices with two
  available slots. Their ability tooltips state their passive and Reaping benefits.
- Army of the Dead always raises a temporary Warrior, Bone Mage, and Gravewing through
  one grave portal; the chosen Dominion servants remain when it closes.
- Death and conversion: Funeral Harvest and Sacrifice Undead.
- Defense and signature window: Bone Armor and Lich Form.

Soul Lance and Ossuary Mark solve the most obvious prior problem. The owner now does
more than generate fragments and wait for servants. Owner and undead damage converge
on the same marked target, and an early detonation, natural expiration, or marked death
creates different timing outcomes.

#### Coverage

| Design need | Coverage | Evidence |
| --- | --- | --- |
| Persistent guardian | Complete | Graveguard |
| Bounded army choice | Complete | Two persistent Dominion slots chosen from Warrior, Mage, and Gravewing |
| Direct command | Complete | Reaping Command and Unholy Command |
| Owner-cast damage loop | Complete | Essence Reap, Soul Lance, and Ossuary Mark |
| Death payoff | Complete | Funeral Harvest and Ossuary Mark deaths create Soul Fragments |
| Corpse geography | Complete | Corpse Explosion converts a chosen Dominion servant into damage at the selected location |
| Meaningful army composition | Complete | Reaping Command grants role-specific taunt, defense, slow, vulnerability, and cleave riders |
| Minion conversion | Complete | Sacrifice Undead converts a servant into health, while Corpse Explosion converts one into aimed area damage |
| Transformation | Complete | Lich Form makes Soul Lance pierce up to two nearby enemies for 50% of landed damage |
| Necromancer-specific control | Intentionally light | Generic Harrow and Abyssal Gag cover class control |

#### Necromancy findings and follow-through

##### Priority 0 (implemented): servant conversion at a selected point

The first Corpse Explosion prototype used short-lived Death Echoes left by enemy deaths.
Playtesting exposed two problems: the level-11 spell arrived before its level-12 echo
generators, and boss usability depended on maintaining an extra spatial resource.

The implemented direction converts the army itself while preserving ground targeting:

- The player selects any valid point within range.
- Corpse Explosion chooses Bone Mage first, Skeletal Warrior second, and Gravewing only
  as a last resort.
- Duplicates of one archetype are ordered by remaining duration, health percentage, and
  entity ID so temporary servants and deterministic ties remain predictable.
- Graveguard remains excluded from both damage conversion and Dominion composition.
- The resulting open slot can be filled by any unique missing archetype. The player is
  not forced to resummon the sacrificed archetype.
- Soul Fragments remain the economy for summons and Reaping Command.

This keeps the positioning decision, makes army composition a consumable choice, and
works consistently on bosses without adding corpse entities or another persistent world
resource.

##### Priority 0 (implemented): composition-dependent command outcomes

Reaping Command already preserves each servant's attack profile. Its next step should
make role composition change the command result, not merely the damage shape:

- Graveguard can brace, taunt, or strengthen owner damage redirection.
- Skeletal Warriors can pin or expose the target for the next servant strike.
- Bone Mages can rupture Ossuary Mark storage or splash a bounded amount.
- Gravewing can replace the normal command with a unique sweep.

This should extend Reaping Command or servant passives, not add one command button per
minion.

##### Priority 1 (implemented): make Lich Form transformative

Lich Form currently grants fragments, owner damage, cast speed, and army throughput.
Those numbers create power, but the player performs the same actions.

During Lich Form, one or two existing verbs should change in a clearly visible way.
Examples include a piercing Soul Lance, an Essence Reap which tears through several
targets, or a stronger servant conversion. The form should not replace
the full action bar, but it should be recognizable from play as well as from the model.

##### Priority 1 (implemented): remove resummon maintenance

Warrior, Bone Mage, and Gravewing now persist without upkeep timers. Dominion has two
slots and permits only one of each archetype, so the player chooses a composition
instead of cycling every summon button. Army of the Dead preserves that composition
and always adds one complete temporary wave.

##### Priority 2: broaden sacrifice through talents

Sacrifice Undead currently means "one body becomes health." The eventual talent tree
can offer mutually exclusive conversions into defense, mana, immediate area damage,
or a guardian-focused build. This is a talent opportunity after the baseline command
and death layers are sound, not a reason to add more baseline buttons.

#### Necromancy recommendation

Ground-targeted servant conversion, composition-dependent Reaping Command,
transformative Lich Form, and persistent two-slot Dominion are now implemented. The
remaining baseline question is play feel: test deliberate composition changes before
deciding whether broader sacrifice conversions belong in the specialization talent tree.

### Affliction

#### Current level-20 kit

- Shared class tools: Fiendhide, Consume, Umbral Anchor, Harrow, and Abyssal Gag.
- Core curse loop: Evil Eye, Maledict Gaze, Needle of Fate, Fate Threads, Condemnation,
  and Sentence.
- Reactive generation: Cursed Accomplice, Hex of Violence, Cruel Pact, and Vicarious
  Suffering.
- Multi-target and power windows: Litany of Guilt, Possess the Evil Eye, Hour of
  Judgment, and Coven.

The spec has a genuinely distinct identity. Condemnation comes from what the
Warlock, enemy, companion, and one selected ally do around Evil Eye. Sentence asks
when to commit the entire pool. It is not a weak copy of World of Warcraft Affliction.

#### Coverage

| Design need | Coverage | Evidence |
| --- | --- | --- |
| Primary cursed victim | Complete | Evil Eye |
| Visible resource and timed risk | Complete | Condemnation and its 20-second expiry |
| Setup and payoff | Complete | Needle and Sentence thresholds |
| Enemy-action manipulation | Complete | Hex of Violence |
| One-ally interaction | Complete | Cursed Accomplice and Vicarious Suffering |
| Sustain and forbidden cost | Complete | Consume and Cruel Pact |
| Multi-target expression | Complete but late | Litany at 11 and Coven at 20 |
| Major offensive cooldown | Complete | Hour of Judgment concentrates generation, Threads, Possession, and a one-use Sentence refund |
| Persistent deterioration | Complete | Fate Threads visibly coil around the victim and alter Consume or Sentence |
| More than one spending decision | Complete | Consume converts Threads into generation; Sentence consumes retained Threads for damage |
| Kit purity | Complete | Burning Pact and Sear are no longer committed Affliction abilities |

#### Affliction findings and follow-through

##### Priority 0 (implemented): make Fate Threads the visible affliction layer

Affliction deliberately rejects multi-DoT maintenance, so the solution should not be
Agony plus Corruption plus another timer. Fate Threads are the correct existing seam:
Needle creates them, their duration is bounded, and Consume converts them into more
Condemnation.

They should become a first-class victim state:

- Give each Thread a visible tether, pulse, or progressive Eye corruption.
- Expose its stacks and remaining duration in the target feedback.
- Let the victim's actions, Consume, or Sentence produce a bounded consequence from
  Threads.
- Preserve a choice between consuming Threads for generation and retaining them for
  a different Sentence or reactive benefit.

This creates the sensation that fate is tightening around the target without turning
the spec into timer maintenance.

##### Priority 0 (implemented): remove identity-diluting legacy spells

The actual Affliction spellbook still contains Burning Pact and Sear. Neither is part
of the documented Condemnation loop. They should either gain a clear Eye or Thread
interaction or be removed from committed Affliction.

Removal is preferable unless testing exposes a real hole in leveling, mana recovery,
or damage while Condemnation is unavailable. A generic filler added only to occupy a
global cooldown weakens the specialization.

##### Priority 1: add a second Sentence outcome through talents

Baseline Sentence can remain the only Condemnation spender. The eventual talent tree
should change what full commitment means:

- Concentrated judgment for one primary victim.
- A bounded spread or echo path.
- A sustain path which converts part of the sentence into health or mana.

These should be mutually exclusive modifications of Sentence, not three additional
spenders.

##### Priority 1: improve death transition before Coven

Moving Evil Eye already preserves Condemnation, which is strong. The missing feel is
the victim's curse ending without an event. A marked death can briefly empower the next
Eye placement, preserve Fate Threads in converted form, or create a small visual lash
to the next target. This must not become automatic screen-wide spread.

##### Priority 2: clarify ally ownership in presentation

Only one grouped ally can be the Cursed Accomplice, as intended. The linked player,
Warlock, and other raid members need distinct feedback so a 20-player raid never
suggests that several players are feeding Condemnation. This is primarily UI and VFX
work, not a mechanics expansion.

#### Affliction recommendation

Fate Threads now provide the persistent visual and mechanical affliction layer, while
Burning Pact and Sear have been removed from the committed kit. Future work should be
talent variations of Sentence and death-transition playtesting, not another baseline
curse.

### Destruction

#### Current level-20 kit

- Core offense: Gloom Bolt, Burning Pact, Conflagrate, Ruinbolt, Duskfire, Ruinous
  Brand, and Rain of Fire.
- Major summon: Pyre Colossus, its two-second fire aura, and one Ruin generated per second.
- Shared tools: Fiendhide, Hard Bargain, Consume, Umbral Anchor, Harrow, and Abyssal
  Gag.
- Permanent summons: Emberkin and the taunting Gloomshade.

The current combat loop is mechanically mature:

- Gloom Bolt and Conflagrate build Ruin.
- Burning Pact gives Conflagrate a preparation target.
- Desolation changes the next main spender.
- Ruinbolt and Rain of Fire create single-target versus ground-area expenditure.
- Duskfire rewards a correct execution read.
- Ruinous Brand creates a bounded single-target or two-target copy decision.
- Pyre Colossus creates a thirty-second burn-and-resource window instead of being an
  unrelated damage-over-time pet.

#### Coverage

| Design need | Coverage | Evidence |
| --- | --- | --- |
| Builder-spender loop | Complete | Ruin generation and three costs |
| Hard-cast payoff | Complete | Ruinbolt |
| Planned cast relief | Complete | Desolation and Conflagrate charges |
| Execute | Complete | Duskfire and its refund |
| Single-target versus area choice | Complete | Ruinbolt versus Rain of Fire |
| Two-target conversion | Complete | Ruinous Brand |
| Major catastrophic summon | Complete | Pyre Colossus plus its periodic fire aura and Ruin generation |
| Movement weakness with limited answers | Complete | Long casts plus bounded instant tools and Umbral Anchor |
| Permanent pet identity | Complete | Emberkin is the offensive companion; Gloomshade is the solo taunt option |
| Mid-level spender choice | Complete | Rain of Fire gains an early rank at 12 and its full rank at 18 |
| Presentation parity | Complete | Burning Pact, Conflagrate, Duskfire, Brand, Rain of Fire, and Pyre Colossus use bespoke VFX |

#### Destruction findings and follow-through

##### Priority 0 (implemented): finish the permanent-pet cleanup

The Warlock now publishes only the summons that serve the agreed class and
specialization identities:

- Emberkin is the shared level 1 companion before specialization and becomes
  Destruction-only once a specialization is chosen at level 5.
- Gloomshade is Destruction's permanent solo tank option.
- Pyre Colossus is Destruction's temporary major summon.

Duskborn, Spellhound, Warfiend, and Wraithborn were removed from the Warlock class and
pet catalogs instead of remaining hidden behind specialization exclusions. This was
implementation cleanup, not a need for replacement abilities.

##### Priority 0 (implemented): treat impact presentation as part of the mechanics

Destruction already has enough buttons. Its remaining identity gap is how strongly
those buttons communicate preparation and release. Future additions and revisions
must include:

- A distinct cast preparation silhouette.
- A readable projectile, falling object, beam, or ground telegraph.
- A high-quality impact with controlled screen shake, light, and residue where
  supported.
- Persistent area feedback for Rain of Fire, Brand, and summon zones.
- Clear state feedback for Ruin, Desolation, and Brand charges.
- Audio timing which makes a delayed impact readable before it lands.

Ruinbolt and Pyre Colossus establish the quality floor. A mechanically correct generic
flash is not a finished Destruction spell.

##### Priority 1 (implemented): smooth the level 10 to 18 expenditure path

At level 10, Ruinbolt is the only general Ruin spender. Duskfire at 14 is conditional,
and Brand at 16 modifies direct damage rather than offering another ordinary spend.
Rain of Fire does not arrive until 18.

One of these changes can solve the progression gap without adding a new max-level
button:

- Introduce a weaker early rank of Rain of Fire before level 18.
- Let an existing early spell spend Ruin for bounded cleave.
- Move the first Rain of Fire rank earlier and reserve its full duration or Desolation
  interaction for level 18.

##### Priority 1 (implemented): strengthen Burning Pact's visual and tactical readability

Burning Pact matters because Conflagrate advances one future tick rather than deleting
the effect. The player must be able to read whether meaningful damage remains without
opening a tooltip or relying on an invisible timer. The target effect should visibly
decay through stages, and Conflagrate should tear one stage forward.

This is primarily feedback. No additional maintenance spell is required.

##### Priority 2: preserve deterministic identity

The earlier overhaul notes mention critical-strike burst, while the shipped
Destruction design calls itself a deterministic siege caster. The current mechanics
support the latter. Do not add random critical proc dependencies merely to imitate
another game.

If controlled volatility is desired later, it should be a talent path which changes
Desolation or Brand. The baseline rotation should remain predictable enough that
players can plan Brand, Duskfire, and Pyre Colossus windows.

#### Destruction recommendation

The pet cleanup, early Rain of Fire rank, staged Burning Pact feedback, and bespoke
core-spell VFX are implemented. Do not add another baseline damage spell until
playtesting shows a concrete rotational hole.

## Comparative priority

| Order | Work | Status | Reason |
| ---: | --- | --- | --- |
| 1 | Necromancy Death Echo design and prototype | Implemented | Adds the largest missing combat verb: death as geography. |
| 2 | Necromancy composition-dependent Reaping Command | Implemented | Makes summon choice active without adding buttons. |
| 3 | Affliction Fate Thread presentation and interaction | Implemented | Makes the victim feel afflicted while preserving the unique non-checklist identity. |
| 4 | Affliction removal or integration of Burning Pact and Sear | Implemented | Removes live spellbook dilution before talents amplify the wrong kit. |
| 5 | Destruction permanent-pet cleanup | Implemented | Aligns implementation with the already agreed class inventory. |
| 6 | Destruction progression and VFX pass | Implemented | Fixes feel and leveling without inflating the max-level rotation. |
| 7 | Lich Form transformation revision | Implemented | Deepens an existing high-level window after the base Necromancy loop is stable. |
| 8 | Specialization talent work | Pending playtest | Talents should deepen complete identities, not patch missing baseline verbs. |

## Future ability acceptance contract

Unless explicitly waived, a newly integrated ability is not complete when only its
simulation effect works. Its acceptance criteria must include presentation appropriate
to the ability:

- A bespoke cast or activation cue.
- A readable travel, target, or area telegraph when applicable.
- A bespoke impact.
- Persistent state feedback for marks, channels, ground areas, summons, and
  transformations.
- Cleanup on expiration, death, spec switch, and disconnection.
- Correct visibility for owner, ally, hostile, and spectator perspectives.
- Performance-safe particle and entity limits.
- Tests for gameplay behavior plus targeted renderer or event coverage where the
  presentation has a dedicated path.

The VFX must communicate the mechanic. More particles without clearer timing or state
do not satisfy this contract.
